-- Phase 13: production object storage, stored-object registry, and real file
-- metadata columns. Additive. Does not weaken FORCE RLS, tenant context,
-- hostname tenancy, membership revalidation, teacher assigned-only access,
-- guardianship / portal_access, student self-only access, student portal
-- policy, current primary-enrolment checks, safeguarding capabilities,
-- break-glass, or audit controls.
-- Treats migrations 0001–0027 as immutable.

-- ---------------------------------------------------------------------------
-- Central stored-object registry (bytes live in object storage, not Postgres)
-- ---------------------------------------------------------------------------

create table stored_objects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  domain text not null
    check (domain in (
      'admissions_form',
      'admissions_application',
      'student_document',
      'learning_resource',
      'learning_submission',
      'pastoral',
      'safeguarding'
    )),
  owner_record_id uuid not null,
  storage_backend text not null
    check (storage_backend in ('filesystem', 's3')),
  storage_key text not null check (char_length(storage_key) between 1 and 500),
  original_filename text not null check (char_length(trim(original_filename)) between 1 and 200),
  content_type text not null check (char_length(content_type) between 1 and 120),
  byte_size bigint not null check (byte_size >= 0),
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'rejected', 'deleted')),
  scan_status text not null default 'unscanned'
    check (scan_status in ('unscanned', 'pending', 'clean', 'rejected')),
  sensitivity text not null default 'standard'
    check (sensitivity in ('standard', 'confidential', 'safeguarding')),
  uploaded_by uuid references users (id),
  uploaded_at timestamptz,
  deleted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, storage_key)
);

create index stored_objects_org_domain_idx
  on stored_objects (organisation_id, domain, owner_record_id);
create index stored_objects_cleanup_idx
  on stored_objects (status, expires_at)
  where status in ('pending', 'deleted');

create trigger stored_objects_updated_at before update on stored_objects
  for each row execute function set_updated_at();

alter table stored_objects enable row level security;
alter table stored_objects force row level security;

drop policy if exists stored_objects_tenant_isolation on stored_objects;
create policy stored_objects_tenant_isolation on stored_objects
for all
using (
  app_tenant_matches(organisation_id)
  and case domain
    when 'safeguarding' then safeguarding_row_allowed(organisation_id)
    when 'pastoral' then (
      actor_has_permission(app_current_user_id(), organisation_id, 'pastoral.read')
      or actor_has_permission(app_current_user_id(), organisation_id, 'pastoral.manage')
      or actor_has_permission(app_current_user_id(), organisation_id, 'pastoral.read_assigned')
    )
    else true
  end
)
with check (
  app_tenant_matches(organisation_id)
  and case domain
    when 'safeguarding' then safeguarding_row_allowed(organisation_id)
    when 'pastoral' then (
      actor_has_permission(app_current_user_id(), organisation_id, 'pastoral.read')
      or actor_has_permission(app_current_user_id(), organisation_id, 'pastoral.manage')
      or actor_has_permission(app_current_user_id(), organisation_id, 'pastoral.read_assigned')
    )
    else true
  end
);

grant select, insert, update, delete on stored_objects to schoolapp_app;

create or replace view organisation_storage_usage
with (security_invoker = true) as
select
  organisation_id,
  count(*)::int as file_count,
  coalesce(sum(byte_size), 0)::bigint as total_bytes
from stored_objects
where status = 'active'
group by organisation_id;

grant select on organisation_storage_usage to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Expand storage_backend checks to include filesystem
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'c'
      and pg_get_constraintdef(oid) ilike '%storage_backend%'
      and pg_get_constraintdef(oid) ilike '%unconfigured%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table student_documents
  add constraint student_documents_storage_backend_check
  check (storage_backend in ('unconfigured', 's3', 'filesystem'));
alter table learning_resources
  add constraint learning_resources_storage_backend_check
  check (storage_backend in ('unconfigured', 's3', 'filesystem'));
alter table learning_submission_attachments
  add constraint learning_submission_attachments_storage_backend_check
  check (storage_backend in ('unconfigured', 's3', 'filesystem'));
alter table announcement_resources
  add constraint announcement_resources_storage_backend_check
  check (storage_backend in ('unconfigured', 's3', 'filesystem'));
alter table school_event_resources
  add constraint school_event_resources_storage_backend_check
  check (storage_backend in ('unconfigured', 's3', 'filesystem'));

-- ---------------------------------------------------------------------------
-- Domain table links
-- ---------------------------------------------------------------------------

alter table student_documents
  add column if not exists stored_object_id uuid references stored_objects (id),
  add column if not exists original_filename text,
  add column if not exists deleted_at timestamptz;

alter table admissions_form_documents
  add column if not exists stored_object_id uuid references stored_objects (id),
  add column if not exists deleted_at timestamptz;

alter table admissions_documents
  add column if not exists stored_object_id uuid references stored_objects (id),
  add column if not exists storage_backend text not null default 'unconfigured'
    check (storage_backend in ('unconfigured', 's3', 'filesystem')),
  add column if not exists deleted_at timestamptz;

alter table learning_resources
  add column if not exists stored_object_id uuid references stored_objects (id),
  add column if not exists original_filename text,
  add column if not exists checksum_sha256 text,
  add column if not exists deleted_at timestamptz;

alter table learning_submission_attachments
  add column if not exists stored_object_id uuid references stored_objects (id),
  add column if not exists checksum_sha256 text,
  add column if not exists deleted_at timestamptz;

alter table pastoral_record_attachments
  add column if not exists stored_object_id uuid references stored_objects (id),
  add column if not exists original_filename text,
  add column if not exists checksum_sha256 text,
  add column if not exists deleted_at timestamptz;

alter table safeguarding_attachments
  add column if not exists stored_object_id uuid references stored_objects (id),
  add column if not exists original_filename text,
  add column if not exists checksum_sha256 text,
  add column if not exists deleted_at timestamptz;

grant update on safeguarding_attachments to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Public admissions document registration (pending → complete)
-- ---------------------------------------------------------------------------

create or replace function register_public_form_document(
  p_organisation_id uuid,
  p_form_type text,
  p_slug text,
  p_token_hash text,
  p_public_id uuid,
  p_field_key text,
  p_filename text,
  p_content_type text,
  p_byte_size integer,
  p_storage_key text,
  p_storage_backend text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_form admissions_forms%rowtype;
  v_sub admissions_form_submissions%rowtype;
  v_id uuid := gen_random_uuid();
  v_object_id uuid := gen_random_uuid();
  v_purpose text;
  v_safe_name text;
  v_key text;
  v_backend text;
begin
  select * into v_form
  from admissions_forms
  where organisation_id = p_organisation_id
    and form_type = p_form_type
    and slug = p_slug;
  if not found or not public_form_is_accepting(v_form) then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;
  select * into v_sub
  from admissions_form_submissions
  where organisation_id = p_organisation_id
    and form_id = v_form.id
    and public_id = p_public_id
    and draft_token_hash = p_token_hash
    and completeness_status = 'draft'
    and (draft_expires_at is null or draft_expires_at > now());
  if not found then
    raise exception 'public_form_draft_invalid' using errcode = 'P0002';
  end if;
  select coalesce(document_purpose, 'other') into v_purpose
  from admissions_form_fields
  where form_id = v_form.id
    and field_key = p_field_key
    and organisation_id = p_organisation_id
    and enabled
    and question_type = 'file';
  if not found then
    raise exception 'validation_failed' using errcode = '23514';
  end if;
  v_safe_name := left(regexp_replace(coalesce(nullif(trim(p_filename), ''), 'document'), '[^a-zA-Z0-9._ -]+', '_', 'g'), 180);
  if v_safe_name is null or btrim(v_safe_name) = '' then
    v_safe_name := 'document';
  end if;
  v_backend := case
    when p_storage_backend in ('filesystem', 's3') then p_storage_backend
    else 'filesystem'
  end;
  v_key := 'org/' || p_organisation_id::text || '/admissions/forms/' || v_sub.id::text || '/' || v_object_id::text;
  insert into stored_objects (
    id, organisation_id, domain, owner_record_id, storage_backend, storage_key,
    original_filename, content_type, byte_size, status, scan_status, sensitivity,
    expires_at
  ) values (
    v_object_id, p_organisation_id, 'admissions_form', v_sub.id, v_backend, v_key,
    v_safe_name, coalesce(nullif(p_content_type, ''), 'application/octet-stream'),
    greatest(coalesce(p_byte_size, 0), 0), 'pending', 'unscanned', 'confidential',
    now() + interval '24 hours'
  );
  insert into admissions_form_documents (
    id, organisation_id, submission_id, field_key, purpose, original_filename, content_type,
    byte_size, storage_key, storage_backend, stored_object_id
  ) values (
    v_id, p_organisation_id, v_sub.id, p_field_key, v_purpose, v_safe_name, p_content_type,
    p_byte_size, v_key, v_backend, v_object_id
  );
  return jsonb_build_object(
    'id', v_id,
    'submissionId', v_sub.id,
    'storedObjectId', v_object_id,
    'storageKey', v_key
  );
end;
$$;

revoke all on function register_public_form_document(
  uuid, text, text, text, uuid, text, text, text, integer, text, text
) from public;
grant execute on function register_public_form_document(
  uuid, text, text, text, uuid, text, text, text, integer, text, text
) to schoolapp_app;

create or replace function complete_public_form_document(
  p_organisation_id uuid,
  p_token_hash text,
  p_public_id uuid,
  p_document_id uuid,
  p_checksum text,
  p_byte_size integer,
  p_content_type text,
  p_scan_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_doc admissions_form_documents%rowtype;
  v_sub admissions_form_submissions%rowtype;
begin
  select * into v_doc
  from admissions_form_documents
  where id = p_document_id and organisation_id = p_organisation_id;
  if not found then
    raise exception 'public_form_draft_invalid' using errcode = 'P0002';
  end if;
  select * into v_sub
  from admissions_form_submissions
  where id = v_doc.submission_id
    and organisation_id = p_organisation_id
    and public_id = p_public_id
    and draft_token_hash = p_token_hash
    and completeness_status = 'draft'
    and (draft_expires_at is null or draft_expires_at > now());
  if not found then
    raise exception 'public_form_draft_invalid' using errcode = 'P0002';
  end if;
  update stored_objects
     set status = 'active',
         checksum_sha256 = p_checksum,
         byte_size = p_byte_size,
         content_type = coalesce(nullif(p_content_type, ''), content_type),
         scan_status = coalesce(nullif(p_scan_status, ''), scan_status),
         uploaded_at = now(),
         expires_at = null
   where id = v_doc.stored_object_id
     and organisation_id = p_organisation_id
     and status = 'pending';
  if not found then
    raise exception 'public_form_draft_invalid' using errcode = 'P0002';
  end if;
  update admissions_form_documents
     set byte_size = p_byte_size,
         content_type = coalesce(nullif(p_content_type, ''), content_type)
   where id = v_doc.id;
  return jsonb_build_object('id', v_doc.id, 'storedObjectId', v_doc.stored_object_id);
end;
$$;

revoke all on function complete_public_form_document(
  uuid, text, uuid, uuid, text, integer, text, text
) from public;
grant execute on function complete_public_form_document(
  uuid, text, uuid, uuid, text, integer, text, text
) to schoolapp_app;

create or replace function reject_public_form_document(
  p_organisation_id uuid,
  p_document_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update stored_objects so
     set status = 'rejected', deleted_at = now()
    from admissions_form_documents d
   where d.id = p_document_id
     and d.organisation_id = p_organisation_id
     and so.id = d.stored_object_id
     and so.organisation_id = p_organisation_id
     and so.status = 'pending';
end;
$$;

revoke all on function reject_public_form_document(uuid, uuid) from public;
grant execute on function reject_public_form_document(uuid, uuid) to schoolapp_app;

create or replace function delete_public_form_document(
  p_organisation_id uuid,
  p_token_hash text,
  p_public_id uuid,
  p_document_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_doc admissions_form_documents%rowtype;
  v_sub admissions_form_submissions%rowtype;
begin
  select * into v_doc
  from admissions_form_documents
  where id = p_document_id and organisation_id = p_organisation_id and deleted_at is null;
  if not found then
    raise exception 'public_form_draft_invalid' using errcode = 'P0002';
  end if;
  select * into v_sub
  from admissions_form_submissions
  where id = v_doc.submission_id
    and organisation_id = p_organisation_id
    and public_id = p_public_id
    and draft_token_hash = p_token_hash
    and completeness_status = 'draft'
    and (draft_expires_at is null or draft_expires_at > now());
  if not found then
    raise exception 'public_form_draft_invalid' using errcode = 'P0002';
  end if;
  update admissions_form_documents
     set deleted_at = now()
   where id = v_doc.id;
  update stored_objects
     set status = 'deleted', deleted_at = now()
   where id = v_doc.stored_object_id and organisation_id = p_organisation_id;
  return jsonb_build_object('id', v_doc.id, 'storageKey', v_doc.storage_key, 'storedObjectId', v_doc.stored_object_id);
end;
$$;

revoke all on function delete_public_form_document(uuid, text, uuid, uuid) from public;
grant execute on function delete_public_form_document(uuid, text, uuid, uuid) to schoolapp_app;
