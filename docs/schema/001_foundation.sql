-- Schoolapp foundation schema (PROPOSED — not applied).
-- Review artefact for Phase 1. Later modules add tables in separate migrations.
-- PostgreSQL 16+. Enable RLS on all tenant tables before handling real pupil data.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Session variables set by the API after authentication (never by clients):
--   select set_config('app.user_id', '<uuid>', true);
--   select set_config('app.organisation_id', '<uuid>', true);
--   select set_config('app.is_platform_admin', 'true'|'false', true);

create or replace function app_current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

create or replace function app_current_organisation_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.organisation_id', true), '')::uuid;
$$;

create or replace function app_is_platform_admin()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.is_platform_admin', true), 'false') = 'true';
$$;

-- ---------------------------------------------------------------------------
-- Platform
-- ---------------------------------------------------------------------------

create table organisations (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  name text not null,
  legal_name text,
  country_code char(2) not null default 'GB',
  timezone text not null default 'Europe/London',
  status text not null default 'provisioning'
    check (status in ('provisioning', 'active', 'suspended', 'closed')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key, -- equals auth provider subject
  email citext unique,
  username citext unique,
  full_name text not null,
  preferred_name text,
  user_kind text not null
    check (user_kind in ('platform_admin', 'staff', 'parent', 'student')),
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  date_of_birth date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform_admins (
  user_id uuid primary key references users (id),
  created_at timestamptz not null default now()
);

create table organisation_memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  user_id uuid not null references users (id),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (organisation_id, user_id)
);

create index organisation_memberships_user_id_idx
  on organisation_memberships (user_id);

create table permissions (
  key text primary key,
  description text not null,
  created_at timestamptz not null default now()
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations (id),
  key text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, key)
);

-- System roles use organisation_id IS NULL; unique index for those:
create unique index roles_system_key_idx
  on roles (key)
  where organisation_id is null;

create table role_permissions (
  role_id uuid not null references roles (id) on delete cascade,
  permission_key text not null references permissions (key),
  primary key (role_id, permission_key)
);

create table membership_roles (
  membership_id uuid not null references organisation_memberships (id) on delete cascade,
  role_id uuid not null references roles (id),
  primary key (membership_id, role_id)
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  email citext,
  invited_user_id uuid references users (id),
  intended_role_keys text[] not null default '{}',
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations (id),
  actor_user_id uuid references users (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_org_created_idx
  on audit_events (organisation_id, created_at desc);

create table external_identifiers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  entity_type text not null,
  entity_id uuid not null,
  system text not null,
  identifier text not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, system, identifier)
);

-- ---------------------------------------------------------------------------
-- Academic structure
-- ---------------------------------------------------------------------------

create table academic_years (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  name text not null, -- '2026/27'
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, name)
);

create table terms (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  academic_year_id uuid not null references academic_years (id),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now()
);

create table year_groups (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  code text not null, -- 'R', '3', '8'
  name text not null, -- 'Year 3'
  key_stage smallint,
  sort_order int not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, code)
);

create table houses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  name text not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, name)
);

create table subjects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null, -- 'mathematics'
  name text not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  academic_year_id uuid not null references academic_years (id),
  year_group_id uuid references year_groups (id),
  name text not null,
  class_type text not null default 'form'
    check (class_type in ('form', 'teaching')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table staff_profiles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  user_id uuid not null references users (id),
  job_title text,
  employee_number text,
  started_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);

create table student_profiles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  user_id uuid references users (id),
  admission_number text,
  year_group_id uuid references year_groups (id),
  house_id uuid references houses (id),
  enrolment_status text not null default 'admitted'
    check (enrolment_status in ('prospective', 'admitted', 'enrolled', 'left', 'alumni')),
  legal_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index student_profiles_org_admission_number_idx
  on student_profiles (organisation_id, admission_number)
  where admission_number is not null;

create table class_enrolments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  class_id uuid not null references classes (id),
  student_profile_id uuid not null references student_profiles (id),
  academic_year_id uuid not null references academic_years (id),
  created_at timestamptz not null default now(),
  unique (class_id, student_profile_id)
);

create table guardianships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  guardian_user_id uuid not null references users (id),
  relationship text not null default 'other',
  has_parental_responsibility boolean not null default false,
  portal_access boolean not null default true,
  priority smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_profile_id, guardian_user_id)
);

create index guardianships_guardian_user_id_idx
  on guardianships (guardian_user_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (representative)
-- ---------------------------------------------------------------------------

create trigger organisations_updated_at
  before update on organisations
  for each row execute function set_updated_at();

create trigger users_updated_at
  before update on users
  for each row execute function set_updated_at();

create trigger organisation_memberships_updated_at
  before update on organisation_memberships
  for each row execute function set_updated_at();

create trigger student_profiles_updated_at
  before update on student_profiles
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS (illustrative — enable on every tenant table in Phase 1)
-- ---------------------------------------------------------------------------

alter table student_profiles enable row level security;
alter table student_profiles force row level security;

create policy student_profiles_isolation
  on student_profiles
  for all
  using (
    app_is_platform_admin()
    or organisation_id = app_current_organisation_id()
  )
  with check (
    app_is_platform_admin()
    or organisation_id = app_current_organisation_id()
  );

-- Parent restriction (example): additional policy or view used by parent API.
-- Application still filters by guardianship; this is a second line of defence.

create policy student_profiles_parent_select
  on student_profiles
  for select
  using (
    app_is_platform_admin()
    or (
      organisation_id = app_current_organisation_id()
      and (
        -- staff with membership in this org (narrower staff checks live in the API)
        exists (
          select 1
          from organisation_memberships m
          where m.organisation_id = student_profiles.organisation_id
            and m.user_id = app_current_user_id()
            and m.status = 'active'
        )
      )
    )
  );

-- NOTE: Combining staff-wide select with parent-only select requires careful
-- policy design (OR across policies in Postgres). Phase 1 must include tests
-- that a parent cannot SELECT classmates. Prefer separate DB roles
-- (app_staff vs app_parent) if a single policy set becomes too broad.

-- ---------------------------------------------------------------------------
-- Seed keys (system roles) — applied in a later data migration
-- ---------------------------------------------------------------------------
-- platform.super_admin (platform_admins table)
-- school.admin, school.headteacher, school.teacher, school.admissions,
-- school.staff, school.parent, school.student
