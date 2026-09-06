-- B3: per-organisation automatic-email presentation (logo) and attachments.
-- Additive. Wording overrides stay on organisation_transactional_email_templates
-- (B2 DELETE "Use system default" must not drop logo/attachment configuration).
-- Bytes stay in object storage via stored_objects; this migration does not
-- rewrite mail_outbox, admissions, existing template rows, or stored_objects data.

-- ---------------------------------------------------------------------------
-- stored_objects domain for school-provided automatic-email documents
-- ---------------------------------------------------------------------------

alter table stored_objects drop constraint if exists stored_objects_domain_check;
alter table stored_objects add constraint stored_objects_domain_check
  check (domain in (
    'admissions_form',
    'admissions_application',
    'student_document',
    'learning_resource',
    'learning_submission',
    'pastoral',
    'safeguarding',
    'activity',
    'message',
    'branding',
    'profile_photo',
    'transactional_email'
  ));

-- ---------------------------------------------------------------------------
-- Presentation settings (survive wording-row DELETE)
-- ---------------------------------------------------------------------------

create table organisation_transactional_email_settings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  template_key text not null,
  show_school_logo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references users (id) on delete set null,
  constraint organisation_transactional_email_settings_org_key
    unique (organisation_id, template_key),
  constraint organisation_transactional_email_settings_key_check
    check (template_key in (
      'admissions_enquiry_received',
      'admissions_application_received'
    ))
);

create trigger organisation_transactional_email_settings_updated_at
  before update on organisation_transactional_email_settings
  for each row execute function set_updated_at();

select install_tenant_isolation('organisation_transactional_email_settings');

grant select, insert, update, delete on organisation_transactional_email_settings to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Template attachments (survive wording-row DELETE)
-- ---------------------------------------------------------------------------

create table organisation_transactional_email_template_attachments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  template_key text not null,
  stored_object_id uuid not null references stored_objects (id) on delete restrict,
  display_filename text not null
    check (char_length(trim(display_filename)) between 1 and 180),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  created_by_user_id uuid references users (id) on delete set null,
  constraint organisation_transactional_email_template_attachments_key_check
    check (template_key in (
      'admissions_enquiry_received',
      'admissions_application_received'
    )),
  constraint organisation_transactional_email_template_attachments_unique
    unique (organisation_id, template_key, stored_object_id)
);

create index organisation_transactional_email_template_attachments_lookup_idx
  on organisation_transactional_email_template_attachments
    (organisation_id, template_key, sort_order, created_at, id);

create index organisation_transactional_email_template_attachments_object_idx
  on organisation_transactional_email_template_attachments (stored_object_id);

select install_tenant_isolation('organisation_transactional_email_template_attachments');

grant select, insert, update, delete
  on organisation_transactional_email_template_attachments to schoolapp_app;

-- Same-organisation + school-provided-document-only. Never attach another
-- tenant's object or admissions/pupil/medical/safeguarding files.
create or replace function enforce_transactional_email_attachment_object()
returns trigger
language plpgsql
as $$
declare
  v_org uuid;
  v_domain text;
begin
  select organisation_id, domain
    into v_org, v_domain
  from stored_objects
  where id = new.stored_object_id;

  if not found then
    raise exception 'attachment_object_missing' using errcode = '23503';
  end if;
  if v_org is distinct from new.organisation_id then
    raise exception 'attachment_org_mismatch' using errcode = '23514';
  end if;
  if v_domain is distinct from 'transactional_email' then
    raise exception 'attachment_domain_invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger organisation_transactional_email_template_attachments_object
  before insert or update on organisation_transactional_email_template_attachments
  for each row execute function enforce_transactional_email_attachment_object();

create or replace function enforce_transactional_email_attachment_count()
returns trigger
language plpgsql
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from organisation_transactional_email_template_attachments
  where organisation_id = new.organisation_id
    and template_key = new.template_key
    and id is distinct from new.id;
  if v_count >= 5 then
    raise exception 'attachment_limit_exceeded' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger organisation_transactional_email_template_attachments_count
  before insert or update on organisation_transactional_email_template_attachments
  for each row execute function enforce_transactional_email_attachment_count();

-- Worker and public-form enqueue run without tenant GUC. Same pattern as
-- get_organisation_transactional_email_template.
create or replace function get_organisation_transactional_email_settings(
  p_organisation_id uuid,
  p_template_key text
)
returns table (
  show_school_logo boolean
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select s.show_school_logo
      from organisation_transactional_email_settings s
      where s.organisation_id = p_organisation_id
        and s.template_key = p_template_key
        and (
          public.app_current_organisation_id() is null
          or s.organisation_id is not distinct from public.app_current_organisation_id()
        )
    ),
    true
  );
$$;

revoke all on function get_organisation_transactional_email_settings(uuid, text) from public;
grant execute on function get_organisation_transactional_email_settings(uuid, text) to schoolapp_app;

create or replace function get_organisation_transactional_email_attachments(
  p_organisation_id uuid,
  p_template_key text
)
returns table (
  id uuid,
  stored_object_id uuid,
  display_filename text,
  sort_order integer,
  storage_key text,
  content_type text,
  byte_size bigint,
  object_status text,
  object_domain text,
  deleted_at timestamptz
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select
    a.id,
    a.stored_object_id,
    a.display_filename,
    a.sort_order,
    so.storage_key,
    so.content_type,
    so.byte_size,
    so.status,
    so.domain,
    so.deleted_at
  from organisation_transactional_email_template_attachments a
  join stored_objects so
    on so.id = a.stored_object_id
   and so.organisation_id = a.organisation_id
  where a.organisation_id = p_organisation_id
    and a.template_key = p_template_key
    and (
      public.app_current_organisation_id() is null
      or a.organisation_id is not distinct from public.app_current_organisation_id()
    )
  order by a.sort_order, a.created_at, a.id;
$$;

revoke all on function get_organisation_transactional_email_attachments(uuid, text) from public;
grant execute on function get_organisation_transactional_email_attachments(uuid, text) to schoolapp_app;
