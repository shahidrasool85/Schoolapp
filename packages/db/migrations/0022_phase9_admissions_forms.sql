-- Phase 9: public admissions forms, campaigns, submissions, and conversion mapping.
-- Does not alter Phase 1–8 migrations. New tenant tables use FORCE RLS.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('admissions.forms.read', 'Read admissions form configuration and public URLs'),
  ('admissions.forms.manage', 'Create, edit, publish and duplicate public admissions forms'),
  ('admissions.campaigns.read', 'Read admissions source/campaign labels and counts'),
  ('admissions.campaigns.manage', 'Create and manage admissions source/campaign labels'),
  ('admissions.public_submissions.read', 'Read public form submissions and captured answers'),
  ('students.additional_needs.read', 'Read student medical/additional needs captured from admissions'),
  ('students.additional_needs.manage', 'Manage student medical/additional needs')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'admissions.forms.read'),
    ('school.admin', 'admissions.forms.manage'),
    ('school.admin', 'admissions.campaigns.read'),
    ('school.admin', 'admissions.campaigns.manage'),
    ('school.admin', 'admissions.public_submissions.read'),
    ('school.admin', 'students.additional_needs.read'),
    ('school.admin', 'students.additional_needs.manage'),
    ('school.headteacher', 'admissions.forms.read'),
    ('school.headteacher', 'admissions.campaigns.read'),
    ('school.headteacher', 'admissions.public_submissions.read'),
    ('school.headteacher', 'students.additional_needs.read'),
    ('school.admissions', 'admissions.forms.read'),
    ('school.admissions', 'admissions.forms.manage'),
    ('school.admissions', 'admissions.campaigns.read'),
    ('school.admissions', 'admissions.campaigns.manage'),
    ('school.admissions', 'admissions.public_submissions.read'),
    ('school.admissions', 'students.additional_needs.read'),
    ('school.admissions', 'students.additional_needs.manage')
) as x(role_key, perm) on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

-- Anonymous public actions may not have a user actor.
alter table audit_events
  alter column actor_user_id drop not null;

-- ---------------------------------------------------------------------------
-- Canonical student fields reused on conversion
-- ---------------------------------------------------------------------------

alter table student_profiles
  add column if not exists gender text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists address_town text,
  add column if not exists address_postcode text;

alter table admissions_application_contacts
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists address_town text,
  add column if not exists address_postcode text,
  add column if not exists is_emergency boolean not null default false,
  add column if not exists authorised_collection boolean not null default false;

alter table admissions_applications
  add column if not exists gender text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists address_town text,
  add column if not exists address_postcode text,
  add column if not exists completeness_status text
    check (completeness_status in ('draft', 'submitted', 'missing_documents', 'complete'));

-- ---------------------------------------------------------------------------
-- Campaigns / sources
-- ---------------------------------------------------------------------------

create table admissions_campaigns (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  public_code text not null,
  label text not null,
  description text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, public_code)
);

create trigger admissions_campaigns_updated_at before update on admissions_campaigns
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Forms
-- ---------------------------------------------------------------------------

create table admissions_forms (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  public_id uuid not null default gen_random_uuid(),
  slug text not null,
  form_type text not null
    check (form_type in (
      'enquiry', 'application', 'open_day', 'waiting_list', 'scholarship', 'sixth_form', 'nursery'
    )),
  name text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'unpublished')),
  opens_at timestamptz,
  closes_at timestamptz,
  success_title text,
  success_text text,
  privacy_notice_url text,
  privacy_notice_text text,
  allowed_academic_year_ids uuid[] not null default '{}',
  allowed_year_group_ids uuid[] not null default '{}',
  published_at timestamptz,
  unpublished_at timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, public_id),
  unique (organisation_id, form_type, slug)
);

create index admissions_forms_org_status_idx
  on admissions_forms (organisation_id, form_type, status);

create trigger admissions_forms_updated_at before update on admissions_forms
  for each row execute function set_updated_at();

create table admissions_form_sections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  form_id uuid not null references admissions_forms (id) on delete cascade,
  section_key text not null,
  title text not null,
  helper_text text,
  sort_order integer not null default 0,
  enabled boolean not null default true,
  unique (form_id, section_key)
);

create table admissions_form_fields (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  form_id uuid not null references admissions_forms (id) on delete cascade,
  section_id uuid not null references admissions_form_sections (id) on delete cascade,
  field_key text not null,
  field_kind text not null check (field_kind in ('canonical', 'custom')),
  canonical_key text,
  question_type text not null
    check (question_type in (
      'short_text', 'long_text', 'email', 'phone', 'date', 'number',
      'single_choice', 'multiple_choice', 'yes_no', 'declaration', 'file',
      'guardian_group', 'address_group'
    )),
  label text not null,
  helper_text text,
  required boolean not null default false,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  options jsonb not null default '[]'::jsonb,
  document_purpose text
    check (document_purpose in (
      'birth_certificate', 'passport_id', 'previous_school_report',
      'send_support', 'proof_of_address', 'other'
    ) or document_purpose is null),
  unique (form_id, field_key)
);

-- ---------------------------------------------------------------------------
-- Submissions
-- ---------------------------------------------------------------------------

create table admissions_form_submissions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  public_id uuid not null default gen_random_uuid(),
  form_id uuid not null references admissions_forms (id),
  form_type text not null,
  completeness_status text not null default 'draft'
    check (completeness_status in ('draft', 'submitted', 'missing_documents', 'complete')),
  enquiry_id uuid references admissions_enquiries (id),
  application_id uuid references admissions_applications (id),
  campaign_id uuid references admissions_campaigns (id),
  source_code text,
  answers jsonb not null default '{}'::jsonb,
  canonical_snapshot jsonb not null default '{}'::jsonb,
  declaration_snapshot jsonb,
  draft_token_hash text,
  draft_expires_at timestamptz,
  submitted_at timestamptz,
  client_ip_hash text,
  idempotency_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, public_id)
);

create unique index admissions_form_submissions_idempotency_idx
  on admissions_form_submissions (form_id, idempotency_hash)
  where idempotency_hash is not null;

create index admissions_form_submissions_form_idx
  on admissions_form_submissions (organisation_id, form_id, created_at desc);

create index admissions_form_submissions_campaign_idx
  on admissions_form_submissions (organisation_id, campaign_id);

create trigger admissions_form_submissions_updated_at before update on admissions_form_submissions
  for each row execute function set_updated_at();

create table admissions_form_documents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  submission_id uuid not null references admissions_form_submissions (id) on delete cascade,
  field_key text not null,
  purpose text not null default 'other',
  original_filename text not null,
  content_type text,
  byte_size integer,
  storage_backend text not null default 'unconfigured',
  storage_key text,
  created_at timestamptz not null default now()
);

create table student_additional_needs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  allergies text,
  medical_conditions text,
  medication text,
  dietary_requirements text,
  send_notes text,
  source_application_id uuid references admissions_applications (id),
  source_submission_id uuid references admissions_form_submissions (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_profile_id)
);

create trigger student_additional_needs_updated_at before update on student_additional_needs
  for each row execute function set_updated_at();

alter table admissions_enquiries
  add column if not exists public_form_id uuid references admissions_forms (id),
  add column if not exists campaign_id uuid references admissions_campaigns (id);

alter table admissions_applications
  add column if not exists public_form_id uuid references admissions_forms (id),
  add column if not exists campaign_id uuid references admissions_campaigns (id);

-- ---------------------------------------------------------------------------
-- Same-organisation integrity
-- ---------------------------------------------------------------------------

create or replace function admissions_forms_child_org_tg()
returns trigger
language plpgsql
as $$
begin
  if new.form_id is not null and not exists (
    select 1 from admissions_forms f
    where f.id = new.form_id and f.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  -- NEW.section_id is only valid on admissions_form_fields. Nested IF avoids
  -- evaluating that field on sections (PL/pgSQL still plans AND subqueries).
  if tg_table_name = 'admissions_form_fields' then
    if not exists (
      select 1 from admissions_form_sections s
      where s.id = new.section_id and s.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger admissions_form_sections_org_tg
  before insert or update on admissions_form_sections
  for each row execute function admissions_forms_child_org_tg();

create trigger admissions_form_fields_org_tg
  before insert or update on admissions_form_fields
  for each row execute function admissions_forms_child_org_tg();

create or replace function admissions_form_submissions_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from admissions_forms f
    where f.id = new.form_id and f.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.enquiry_id is not null and not exists (
    select 1 from admissions_enquiries e
    where e.id = new.enquiry_id and e.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.application_id is not null and not exists (
    select 1 from admissions_applications a
    where a.id = new.application_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.campaign_id is not null and not exists (
    select 1 from admissions_campaigns c
    where c.id = new.campaign_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger admissions_form_submissions_org_tg
  before insert or update on admissions_form_submissions
  for each row execute function admissions_form_submissions_org_tg();

create or replace function admissions_form_documents_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from admissions_form_submissions s
    where s.id = new.submission_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger admissions_form_documents_org_tg
  before insert or update on admissions_form_documents
  for each row execute function admissions_form_documents_org_tg();

create or replace function student_additional_needs_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from student_profiles p
    where p.id = new.student_profile_id and p.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger student_additional_needs_org_tg
  before insert or update on student_additional_needs
  for each row execute function student_additional_needs_org_tg();

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

select install_tenant_isolation('admissions_campaigns');
select install_tenant_isolation('admissions_forms');
select install_tenant_isolation('admissions_form_sections');
select install_tenant_isolation('admissions_form_fields');
select install_tenant_isolation('admissions_form_submissions');
select install_tenant_isolation('admissions_form_documents');
select install_tenant_isolation('student_additional_needs');

grant select, insert, update, delete on
  admissions_campaigns,
  admissions_forms,
  admissions_form_sections,
  admissions_form_fields
to schoolapp_app;

grant select, insert, update on
  admissions_form_submissions,
  admissions_form_documents,
  student_additional_needs
to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Public read / write (SECURITY DEFINER; org must already be host-resolved)
-- ---------------------------------------------------------------------------

create or replace function public_form_is_accepting(p_form admissions_forms)
returns boolean
language plpgsql
stable
as $$
begin
  if p_form.status is distinct from 'published' then
    return false;
  end if;
  if p_form.opens_at is not null and p_form.opens_at > now() then
    return false;
  end if;
  if p_form.closes_at is not null and p_form.closes_at < now() then
    return false;
  end if;
  return true;
end;
$$;

create or replace function get_published_admissions_form(
  p_organisation_id uuid,
  p_form_type text,
  p_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_form admissions_forms%rowtype;
  v_org organisations%rowtype;
  v_branding jsonb;
begin
  select * into v_org from organisations where id = p_organisation_id and status = 'active';
  if not found then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;
  select * into v_form
  from admissions_forms
  where organisation_id = p_organisation_id
    and form_type = p_form_type
    and slug = p_slug;
  if not found or not public_form_is_accepting(v_form) then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;
  select coalesce(extras->'branding', '{}'::jsonb) into v_branding
  from organisation_settings
  where organisation_id = p_organisation_id;

  return jsonb_build_object(
    'form', jsonb_build_object(
      'publicId', v_form.public_id,
      'slug', v_form.slug,
      'formType', v_form.form_type,
      'name', v_form.name,
      'description', v_form.description,
      'opensAt', v_form.opens_at,
      'closesAt', v_form.closes_at,
      'successTitle', v_form.success_title,
      'successText', v_form.success_text,
      'privacyNoticeUrl', v_form.privacy_notice_url,
      'privacyNoticeText', v_form.privacy_notice_text,
      'allowedAcademicYearIds', to_jsonb(v_form.allowed_academic_year_ids),
      'allowedYearGroupIds', to_jsonb(v_form.allowed_year_group_ids)
    ),
    'organisation', jsonb_build_object(
      'id', v_org.id,
      'slug', v_org.slug,
      'name', v_org.name
    ),
    'branding', v_branding,
    'academicYears', coalesce((
      select jsonb_agg(jsonb_build_object('id', y.id, 'name', y.name) order by y.starts_on desc)
      from academic_years y
      where y.organisation_id = p_organisation_id
        and (
          coalesce(array_length(v_form.allowed_academic_year_ids, 1), 0) = 0
          or y.id = any (v_form.allowed_academic_year_ids)
        )
    ), '[]'::jsonb),
    'yearGroups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'code', g.code) order by g.sort_order)
      from year_groups g
      where g.organisation_id = p_organisation_id
        and (
          coalesce(array_length(v_form.allowed_year_group_ids, 1), 0) = 0
          or g.id = any (v_form.allowed_year_group_ids)
        )
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'sectionKey', s.section_key,
          'title', s.title,
          'helperText', s.helper_text,
          'sortOrder', s.sort_order,
          'fields', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'fieldKey', f.field_key,
                'fieldKind', f.field_kind,
                'canonicalKey', f.canonical_key,
                'questionType', f.question_type,
                'label', f.label,
                'helperText', f.helper_text,
                'required', f.required,
                'sortOrder', f.sort_order,
                'options', f.options,
                'documentPurpose', f.document_purpose
              )
              order by f.sort_order, f.label
            )
            from admissions_form_fields f
            where f.section_id = s.id and f.enabled
          ), '[]'::jsonb)
        )
        order by s.sort_order, s.title
      )
      from admissions_form_sections s
      where s.form_id = v_form.id and s.enabled
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function get_published_admissions_form(uuid, text, text) from public;
grant execute on function get_published_admissions_form(uuid, text, text) to schoolapp_app;

create or replace function get_public_admissions_draft(
  p_organisation_id uuid,
  p_form_type text,
  p_slug text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_form admissions_forms%rowtype;
  v_sub admissions_form_submissions%rowtype;
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
    and draft_token_hash = p_token_hash
    and completeness_status = 'draft'
    and (draft_expires_at is null or draft_expires_at > now());
  if not found then
    raise exception 'public_form_draft_invalid' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'publicId', v_sub.public_id,
    'answers', v_sub.answers,
    'completeness', v_sub.completeness_status
  );
end;
$$;

revoke all on function get_public_admissions_draft(uuid, text, text, text) from public;
grant execute on function get_public_admissions_draft(uuid, text, text, text) to schoolapp_app;

create or replace function next_admissions_reference_unrestricted(
  p_organisation_id uuid,
  p_kind text
)
returns text
language plpgsql
as $$
declare
  v_year int := extract(year from current_date)::int;
  v_n int;
  v_prefix text;
begin
  if p_kind not in ('enquiry', 'application') then
    raise exception 'invalid_admissions_kind' using errcode = '22023';
  end if;
  v_prefix := case p_kind when 'enquiry' then 'ENQ' else 'APP' end;
  insert into admissions_counters (organisation_id, kind, year, last_value)
  values (p_organisation_id, p_kind, v_year, 1)
  on conflict (organisation_id, kind, year)
  do update set last_value = admissions_counters.last_value + 1
  returning last_value into v_n;
  return v_prefix || '-' || v_year::text || '-' || lpad(v_n::text, 4, '0');
end;
$$;

create or replace function submit_public_admissions_form(
  p_organisation_id uuid,
  p_form_type text,
  p_slug text,
  p_answers jsonb,
  p_canonical jsonb,
  p_declaration jsonb,
  p_campaign_code text,
  p_source_code text,
  p_is_draft boolean,
  p_draft_token_hash text,
  p_existing_public_id uuid,
  p_ip_hash text,
  p_idempotency_hash text,
  p_completeness text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_form admissions_forms%rowtype;
  v_org organisations%rowtype;
  v_campaign admissions_campaigns%rowtype;
  v_sub admissions_form_submissions%rowtype;
  v_enquiry_id uuid;
  v_application_id uuid;
  v_enquiry_ref text;
  v_application_ref text;
  v_child jsonb := coalesce(p_canonical->'child', '{}'::jsonb);
  v_guardians jsonb := coalesce(p_canonical->'guardians', '[]'::jsonb);
  v_primary jsonb;
  v_notes text := nullif(p_canonical->>'notes', '');
  v_year uuid;
  v_group uuid;
  v_guardian jsonb;
begin
  select * into v_org from organisations where id = p_organisation_id and status = 'active';
  if not found then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;
  select * into v_form
  from admissions_forms
  where organisation_id = p_organisation_id
    and form_type = p_form_type
    and slug = p_slug
  for update;
  if not found or not public_form_is_accepting(v_form) then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;

  if p_campaign_code is not null and length(trim(p_campaign_code)) > 0 then
    select * into v_campaign
    from admissions_campaigns
    where organisation_id = p_organisation_id
      and public_code = lower(trim(p_campaign_code))
      and enabled;
  end if;

  if p_idempotency_hash is not null then
    select * into v_sub
    from admissions_form_submissions
    where form_id = v_form.id
      and organisation_id = p_organisation_id
      and idempotency_hash = p_idempotency_hash;
    if found and v_sub.completeness_status is distinct from 'draft' then
      return jsonb_build_object(
        'publicId', v_sub.public_id,
        'completeness', v_sub.completeness_status,
        'enquiryId', v_sub.enquiry_id,
        'applicationId', v_sub.application_id,
        'formType', v_form.form_type,
        'replayed', true
      );
    end if;
  end if;

  if p_existing_public_id is not null then
    select * into v_sub
    from admissions_form_submissions
    where organisation_id = p_organisation_id
      and form_id = v_form.id
      and public_id = p_existing_public_id
    for update;
    if not found
       or v_sub.draft_token_hash is distinct from p_draft_token_hash
       or v_sub.completeness_status is distinct from 'draft'
       or (v_sub.draft_expires_at is not null and v_sub.draft_expires_at <= now()) then
      raise exception 'public_form_draft_invalid' using errcode = 'P0002';
    end if;
  end if;

  v_year := nullif(v_child->>'intendedAcademicYearId', '')::uuid;
  v_group := nullif(v_child->>'intendedYearGroupId', '')::uuid;
  if v_year is not null and not exists (
    select 1 from academic_years y where y.id = v_year and y.organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if v_group is not null and not exists (
    select 1 from year_groups g where g.id = v_group and g.organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if coalesce(array_length(v_form.allowed_academic_year_ids, 1), 0) > 0
     and v_year is not null
     and not (v_year = any (v_form.allowed_academic_year_ids)) then
    raise exception 'validation_failed' using errcode = '23514';
  end if;
  if coalesce(array_length(v_form.allowed_year_group_ids, 1), 0) > 0
     and v_group is not null
     and not (v_group = any (v_form.allowed_year_group_ids)) then
    raise exception 'validation_failed' using errcode = '23514';
  end if;

  if jsonb_typeof(v_guardians) = 'array' and jsonb_array_length(v_guardians) > 0 then
    v_primary := v_guardians->0;
    for v_guardian in select value from jsonb_array_elements(v_guardians)
    loop
      if coalesce((v_guardian->>'primaryContact')::boolean, false) then
        v_primary := v_guardian;
      end if;
    end loop;
  end if;

  if not p_is_draft and v_form.form_type = 'enquiry' then
    if coalesce(nullif(v_child->>'legalName', ''), '') = ''
       or coalesce(nullif(v_primary->>'fullName', ''), '') = '' then
      raise exception 'validation_failed' using errcode = '23514';
    end if;
    v_enquiry_ref := next_admissions_reference_unrestricted(p_organisation_id, 'enquiry');
    insert into admissions_enquiries (
      organisation_id, reference, status, pupil_legal_name, pupil_preferred_name, date_of_birth,
      intended_academic_year_id, intended_year_group_id, guardian_full_name, guardian_email,
      guardian_telephone, enquiry_date, source, notes, public_form_id, campaign_id, extra_fields
    ) values (
      p_organisation_id,
      v_enquiry_ref,
      'open',
      v_child->>'legalName',
      nullif(v_child->>'preferredName', ''),
      nullif(v_child->>'dateOfBirth', '')::date,
      v_year,
      v_group,
      v_primary->>'fullName',
      nullif(v_primary->>'email', ''),
      nullif(v_primary->>'phone', ''),
      current_date,
      coalesce(v_campaign.label, nullif(p_source_code, ''), 'website'),
      v_notes,
      v_form.id,
      v_campaign.id,
      jsonb_build_object('canonical', p_canonical, 'publicForm', true)
    )
    returning id into v_enquiry_id;
  elsif not p_is_draft and v_form.form_type = 'application' then
    if coalesce(nullif(v_child->>'legalName', ''), '') = '' then
      raise exception 'validation_failed' using errcode = '23514';
    end if;
    if v_sub.application_id is not null then
      v_application_id := v_sub.application_id;
      perform set_config('app.admissions_transition_reason', 'Public application submitted', true);
      update admissions_applications
      set pupil_legal_name = v_child->>'legalName',
          pupil_preferred_name = nullif(v_child->>'preferredName', ''),
          date_of_birth = nullif(v_child->>'dateOfBirth', '')::date,
          intended_academic_year_id = v_year,
          intended_year_group_id = v_group,
          intended_entry_date = nullif(v_child->>'proposedStartDate', '')::date,
          previous_school = nullif(v_child->>'previousSchool', ''),
          current_school = nullif(v_child->>'currentSchool', ''),
          gender = nullif(v_child->>'gender', ''),
          address_line1 = nullif(v_child->'address'->>'line1', ''),
          address_line2 = nullif(v_child->'address'->>'line2', ''),
          address_town = nullif(v_child->'address'->>'town', ''),
          address_postcode = nullif(v_child->'address'->>'postcode', ''),
          source = coalesce(v_campaign.label, nullif(p_source_code, ''), source, 'website'),
          extra_fields = jsonb_build_object('canonical', p_canonical, 'publicForm', true),
          public_form_id = v_form.id,
          campaign_id = coalesce(v_campaign.id, campaign_id),
          completeness_status = p_completeness,
          status = 'submitted',
          submitted_at = now(),
          updated_at = now()
      where id = v_application_id and organisation_id = p_organisation_id;
    else
      v_application_ref := next_admissions_reference_unrestricted(p_organisation_id, 'application');
      perform set_config('app.admissions_transition_reason', 'Public application submitted', true);
      insert into admissions_applications (
        organisation_id, reference, status, pupil_legal_name, pupil_preferred_name, date_of_birth,
        intended_academic_year_id, intended_year_group_id, intended_entry_date, previous_school,
        current_school, application_date, submitted_at, source, extra_fields, public_form_id,
        campaign_id, gender, address_line1, address_line2, address_town, address_postcode,
        completeness_status
      ) values (
        p_organisation_id,
        v_application_ref,
        'submitted',
        v_child->>'legalName',
        nullif(v_child->>'preferredName', ''),
        nullif(v_child->>'dateOfBirth', '')::date,
        v_year,
        v_group,
        nullif(v_child->>'proposedStartDate', '')::date,
        nullif(v_child->>'previousSchool', ''),
        nullif(v_child->>'currentSchool', ''),
        current_date,
        now(),
        coalesce(v_campaign.label, nullif(p_source_code, ''), 'website'),
        jsonb_build_object('canonical', p_canonical, 'publicForm', true),
        v_form.id,
        v_campaign.id,
        nullif(v_child->>'gender', ''),
        nullif(v_child->'address'->>'line1', ''),
        nullif(v_child->'address'->>'line2', ''),
        nullif(v_child->'address'->>'town', ''),
        nullif(v_child->'address'->>'postcode', ''),
        p_completeness
      )
      returning id into v_application_id;
    end if;

    delete from admissions_application_contacts
    where application_id = v_application_id and organisation_id = p_organisation_id;

    if jsonb_typeof(v_guardians) = 'array' then
      for v_guardian in select value from jsonb_array_elements(v_guardians)
      loop
        insert into admissions_application_contacts (
          organisation_id, application_id, full_name, email, telephone, relationship,
          is_primary, has_parental_responsibility, address_line1, address_line2,
          address_town, address_postcode
        ) values (
          p_organisation_id,
          v_application_id,
          v_guardian->>'fullName',
          nullif(v_guardian->>'email', ''),
          nullif(v_guardian->>'phone', ''),
          coalesce(nullif(v_guardian->>'relationship', ''), 'other'),
          coalesce((v_guardian->>'primaryContact')::boolean, false),
          coalesce((v_guardian->>'parentalResponsibility')::boolean, false),
          nullif(v_guardian->'address'->>'line1', ''),
          nullif(v_guardian->'address'->>'line2', ''),
          nullif(v_guardian->'address'->>'town', ''),
          nullif(v_guardian->'address'->>'postcode', '')
        );
      end loop;
    end if;

    if p_canonical ? 'emergency' and coalesce(p_canonical->'emergency'->>'fullName', '') <> '' then
      insert into admissions_application_contacts (
        organisation_id, application_id, full_name, telephone, relationship,
        is_primary, has_parental_responsibility, is_emergency, authorised_collection
      ) values (
        p_organisation_id,
        v_application_id,
        p_canonical->'emergency'->>'fullName',
        nullif(p_canonical->'emergency'->>'telephone', ''),
        coalesce(nullif(p_canonical->'emergency'->>'relationship', ''), 'other'),
        false,
        false,
        true,
        coalesce((p_canonical->'emergency'->>'authorisedCollection')::boolean, false)
      );
    end if;
  elsif p_is_draft and v_form.form_type = 'application' and v_sub.application_id is null
        and coalesce(nullif(v_child->>'legalName', ''), '') <> '' then
    v_application_ref := next_admissions_reference_unrestricted(p_organisation_id, 'application');
    perform set_config('app.admissions_transition_reason', 'Public application draft', true);
    insert into admissions_applications (
      organisation_id, reference, status, pupil_legal_name, pupil_preferred_name, date_of_birth,
      intended_academic_year_id, intended_year_group_id, source, extra_fields, public_form_id,
      campaign_id, completeness_status
    ) values (
      p_organisation_id,
      v_application_ref,
      'draft',
      v_child->>'legalName',
      nullif(v_child->>'preferredName', ''),
      nullif(v_child->>'dateOfBirth', '')::date,
      v_year,
      v_group,
      coalesce(v_campaign.label, nullif(p_source_code, ''), 'website'),
      jsonb_build_object('canonical', p_canonical, 'publicForm', true),
      v_form.id,
      v_campaign.id,
      'draft'
    )
    returning id into v_application_id;
  else
    v_enquiry_id := v_sub.enquiry_id;
    v_application_id := v_sub.application_id;
  end if;

  if v_sub.id is null then
    insert into admissions_form_submissions (
      organisation_id, form_id, form_type, completeness_status, enquiry_id, application_id,
      campaign_id, source_code, answers, canonical_snapshot, declaration_snapshot,
      draft_token_hash, draft_expires_at, submitted_at, client_ip_hash, idempotency_hash
    ) values (
      p_organisation_id,
      v_form.id,
      v_form.form_type,
      p_completeness,
      v_enquiry_id,
      v_application_id,
      v_campaign.id,
      coalesce(v_campaign.public_code, nullif(p_source_code, '')),
      coalesce(p_answers, '{}'::jsonb),
      coalesce(p_canonical, '{}'::jsonb),
      p_declaration,
      case when p_is_draft then p_draft_token_hash else null end,
      case when p_is_draft then now() + interval '7 days' else null end,
      case when p_is_draft then null else now() end,
      p_ip_hash,
      p_idempotency_hash
    )
    returning * into v_sub;
  else
    update admissions_form_submissions
    set answers = coalesce(p_answers, answers),
        canonical_snapshot = coalesce(p_canonical, canonical_snapshot),
        declaration_snapshot = case when p_is_draft then declaration_snapshot else p_declaration end,
        completeness_status = p_completeness,
        enquiry_id = coalesce(v_enquiry_id, enquiry_id),
        application_id = coalesce(v_application_id, application_id),
        campaign_id = coalesce(v_campaign.id, campaign_id),
        source_code = coalesce(v_campaign.public_code, nullif(p_source_code, ''), source_code),
        draft_token_hash = case when p_is_draft then p_draft_token_hash else null end,
        draft_expires_at = case when p_is_draft then now() + interval '7 days' else null end,
        submitted_at = case when p_is_draft then submitted_at else now() end,
        client_ip_hash = coalesce(p_ip_hash, client_ip_hash),
        idempotency_hash = coalesce(p_idempotency_hash, idempotency_hash),
        updated_at = now()
    where id = v_sub.id
    returning * into v_sub;
  end if;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id,
    null,
    case
      when p_is_draft then 'admissions.form.draft_saved'
      when v_form.form_type = 'enquiry' then 'admissions.enquiry.submitted_public'
      else 'admissions.application.submitted_public'
    end,
    'admissions_form_submission',
    v_sub.id,
    jsonb_build_object(
      'formId', v_form.id,
      'formType', v_form.form_type,
      'slug', v_form.slug,
      'publicId', v_sub.public_id,
      'completeness', p_completeness,
      'campaignCode', v_campaign.public_code,
      'declarationCaptured', p_declaration is not null and not p_is_draft
    )
  );

  return jsonb_build_object(
    'publicId', v_sub.public_id,
    'completeness', v_sub.completeness_status,
    'enquiryId', v_sub.enquiry_id,
    'applicationId', v_sub.application_id,
    'enquiryReference', v_enquiry_ref,
    'applicationReference', v_application_ref,
    'formType', v_form.form_type,
    'replayed', false
  );
end;
$$;

revoke all on function submit_public_admissions_form(
  uuid, text, text, jsonb, jsonb, jsonb, text, text, boolean, text, uuid, text, text, text
) from public;
grant execute on function submit_public_admissions_form(
  uuid, text, text, jsonb, jsonb, jsonb, text, text, boolean, text, uuid, text, text, text
) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Conversion: reuse canonical fields without copying custom answers
-- ---------------------------------------------------------------------------

create or replace function apply_admissions_canonical_conversion(
  p_organisation_id uuid,
  p_application_id uuid,
  p_student_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_app admissions_applications%rowtype;
  v_sub admissions_form_submissions%rowtype;
  v_canonical jsonb;
  v_medical jsonb;
  v_contact admissions_application_contacts%rowtype;
begin
  select * into v_app
  from admissions_applications
  where id = p_application_id and organisation_id = p_organisation_id;
  if not found then
    return;
  end if;
  select * into v_sub
  from admissions_form_submissions
  where application_id = p_application_id
    and organisation_id = p_organisation_id
  order by submitted_at desc nulls last, created_at desc
  limit 1;

  v_canonical := coalesce(v_sub.canonical_snapshot, v_app.extra_fields->'canonical', '{}'::jsonb);
  v_medical := coalesce(v_canonical->'medical', '{}'::jsonb);

  update student_profiles
  set legal_name = coalesce(nullif(legal_name, ''), v_app.pupil_legal_name),
      gender = coalesce(gender, v_app.gender),
      address_line1 = coalesce(address_line1, v_app.address_line1),
      address_line2 = coalesce(address_line2, v_app.address_line2),
      address_town = coalesce(address_town, v_app.address_town),
      address_postcode = coalesce(address_postcode, v_app.address_postcode),
      updated_at = now()
  where id = p_student_profile_id and organisation_id = p_organisation_id;

  update users u
  set preferred_name = coalesce(u.preferred_name, v_app.pupil_preferred_name),
      date_of_birth = coalesce(u.date_of_birth, v_app.date_of_birth),
      updated_at = now()
  from student_profiles p
  where p.id = p_student_profile_id
    and p.organisation_id = p_organisation_id
    and u.id = p.user_id;

  if v_medical <> '{}'::jsonb then
    insert into student_additional_needs (
      organisation_id, student_profile_id, allergies, medical_conditions, medication,
      dietary_requirements, send_notes, source_application_id, source_submission_id
    ) values (
      p_organisation_id,
      p_student_profile_id,
      nullif(v_medical->>'allergies', ''),
      nullif(v_medical->>'conditions', ''),
      nullif(v_medical->>'medication', ''),
      nullif(v_medical->>'dietary', ''),
      nullif(v_medical->>'sendNotes', ''),
      p_application_id,
      v_sub.id
    )
    on conflict (student_profile_id) do update
    set allergies = coalesce(student_additional_needs.allergies, excluded.allergies),
        medical_conditions = coalesce(student_additional_needs.medical_conditions, excluded.medical_conditions),
        medication = coalesce(student_additional_needs.medication, excluded.medication),
        dietary_requirements = coalesce(student_additional_needs.dietary_requirements, excluded.dietary_requirements),
        send_notes = coalesce(student_additional_needs.send_notes, excluded.send_notes),
        source_application_id = coalesce(student_additional_needs.source_application_id, excluded.source_application_id),
        source_submission_id = coalesce(student_additional_needs.source_submission_id, excluded.source_submission_id),
        updated_at = now();
  end if;

  for v_contact in
    select * from admissions_application_contacts
    where application_id = p_application_id
      and organisation_id = p_organisation_id
      and email is not null
      and not is_emergency
  loop
    if not exists (
      select 1 from guardianships g
      join users u on u.id = g.guardian_user_id
      where g.student_profile_id = p_student_profile_id
        and g.organisation_id = p_organisation_id
        and g.ended_on is null
        and u.email = v_contact.email
    ) then
      begin
        perform link_guardian(
          v_app.converted_by,
          p_organisation_id,
          p_student_profile_id,
          v_contact.email,
          v_contact.full_name,
          v_contact.relationship,
          v_contact.has_parental_responsibility,
          v_contact.is_emergency,
          false,
          false,
          case when v_contact.is_primary then 1 else 2 end::smallint
        );
      exception when others then
        null;
      end;
    end if;
  end loop;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id,
    v_app.converted_by,
    'admissions.form.submission_mapped',
    'admissions_application',
    p_application_id,
    jsonb_build_object(
      'studentProfileId', p_student_profile_id,
      'mapped', jsonb_build_array('identity', 'address', 'guardians', 'additional_needs')
    )
  );
end;
$$;

revoke all on function apply_admissions_canonical_conversion(uuid, uuid, uuid) from public;
grant execute on function apply_admissions_canonical_conversion(uuid, uuid, uuid) to schoolapp_app;

create or replace function admissions_application_converted_map_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.converted_student_profile_id is not null
     and old.converted_student_profile_id is null then
    perform apply_admissions_canonical_conversion(
      new.organisation_id,
      new.id,
      new.converted_student_profile_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists admissions_application_converted_map_tg on admissions_applications;
create trigger admissions_application_converted_map_tg
  after update of converted_student_profile_id on admissions_applications
  for each row execute function admissions_application_converted_map_tg();

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
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_form admissions_forms%rowtype;
  v_sub admissions_form_submissions%rowtype;
  v_id uuid;
  v_purpose text;
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
    and completeness_status = 'draft';
  if not found then
    raise exception 'public_form_draft_invalid' using errcode = 'P0002';
  end if;
  select coalesce(document_purpose, 'other') into v_purpose
  from admissions_form_fields
  where form_id = v_form.id and field_key = p_field_key and organisation_id = p_organisation_id and enabled;
  if not found then
    raise exception 'validation_failed' using errcode = '23514';
  end if;
  insert into admissions_form_documents (
    organisation_id, submission_id, field_key, purpose, original_filename, content_type,
    byte_size, storage_key, storage_backend
  ) values (
    p_organisation_id, v_sub.id, p_field_key, v_purpose, p_filename, p_content_type,
    p_byte_size, p_storage_key, p_storage_backend
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function register_public_form_document(
  uuid, text, text, text, uuid, text, text, text, integer, text, text
) from public;
grant execute on function register_public_form_document(
  uuid, text, text, text, uuid, text, text, text, integer, text, text
) to schoolapp_app;
