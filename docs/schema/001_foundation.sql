-- Schoolapp foundation schema (PROPOSED — not applied).
-- Review artefact for Phase 1. No application code is scaffolded in this phase.
-- PostgreSQL 16+.
--
-- Runtime rules (enforced in Phase 1, encoded here as the intended DDL):
-- Tenant context is SET LOCAL / set_config(..., is_local := true) only.
-- Clients never set app.organisation_id; only set_tenant_context() does.
-- Memberships are revalidated inside set_tenant_context() against the DB.
-- Tenant tables: ENABLE + FORCE ROW LEVEL SECURITY.
-- Runtime role (schoolapp_app): NOT table owner, NO BYPASSRLS.
-- Owner role (schoolapp_owner): BYPASSRLS, used only for migrations and the
-- SECURITY DEFINER bootstrap functions (set_tenant_context, list_memberships_for_user).
-- audit_events: INSERT/SELECT only for the app role; no UPDATE/DELETE.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Roles (illustrative; Phase 1 migrations should create equivalently)
-- ---------------------------------------------------------------------------
-- schoolapp_owner : owns tables, runs migrations, BYPASSRLS (bootstrap functions)
-- schoolapp_app   : runtime, NOBYPASSRLS, not owner
--
-- do $$
-- begin
--   if not exists (select 1 from pg_roles where rolname = 'schoolapp_app') then
--     create role schoolapp_app nologin nobypassrls;
--   end if;
-- end $$;

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

-- Tenant isolation predicate reused by policies.
create or replace function app_tenant_matches(p_organisation_id uuid)
returns boolean
language sql
stable
as $$
  select
    app_is_platform_admin()
    or (
      p_organisation_id is not null
      and p_organisation_id = app_current_organisation_id()
    );
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Placeholder: DfE URN, establishment number, Companies House, etc.
-- No uniqueness/validation product behaviour yet.
create table organisation_identifiers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  system text not null, -- 'dfe_urn', 'dfe_number', 'companies_house', 'custom'
  identifier text not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, system),
  unique (system, identifier)
);

-- Placeholder: typed school settings. Keep jsonb for forwards-compatible keys.
create table organisation_settings (
  organisation_id uuid primary key references organisations (id),
  academic_year_start_month smallint not null default 9
    check (academic_year_start_month between 1 and 12),
  locale text not null default 'en-GB',
  extras jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Placeholder: per-school feature flags (leaderboards, AI, student login, …).
-- No flag evaluation engine in this phase.
create table organisation_feature_flags (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  flag_key text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, flag_key)
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

-- Formal audit (not application logging). Append-only for the runtime role.
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations (id),
  actor_user_id uuid not null references users (id),
  actor_membership_id uuid references organisation_memberships (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  request_id uuid,
  occurred_at timestamptz not null default now(),
  -- Optional tamper-evidence (populate later if product owner requires hash chain)
  prev_hash bytea,
  row_hash bytea
);

create index audit_events_org_occurred_idx
  on audit_events (organisation_id, occurred_at desc);

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
-- Billing placeholders (no payment processing)
-- ---------------------------------------------------------------------------

create table billing_accounts (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'closed')),
  extras jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organisation_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null unique references organisations (id),
  billing_account_id uuid references billing_accounts (id),
  plan_key text,
  status text not null default 'none'
    check (status in ('none', 'trial', 'active', 'past_due', 'cancelled')),
  seats_licensed integer,
  current_period_end timestamptz,
  extras jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Academic structure (year-scoped; students are not permanently in one class)
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
  key text not null, -- 'autumn', 'spring', 'summer', or school-defined
  name text not null,
  starts_on date not null,
  ends_on date not null,
  sort_order int not null,
  created_at timestamptz not null default now(),
  unique (academic_year_id, key)
);

create table half_terms (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  term_id uuid not null references terms (id),
  name text not null, -- 'First half', 'Second half'
  starts_on date not null,
  ends_on date not null,
  sort_order int not null,
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

-- A class exists for one academic year. It is not a permanent home for a pupil.
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

create index classes_org_year_idx
  on classes (organisation_id, academic_year_id);

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

-- Person-at-this-school. No class_id. Current year group is derived from
-- student_enrolments for the current academic year.
create table student_profiles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  user_id uuid references users (id),
  admission_number text,
  enrolment_status text not null default 'admitted'
    check (enrolment_status in ('prospective', 'admitted', 'enrolled', 'left', 'alumni')),
  legal_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index student_profiles_org_admission_number_idx
  on student_profiles (organisation_id, admission_number)
  where admission_number is not null;

-- Historical year-group (and optional house) placement per academic year.
create table student_enrolments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  academic_year_id uuid not null references academic_years (id),
  year_group_id uuid not null references year_groups (id),
  house_id uuid references houses (id),
  status text not null default 'enrolled'
    check (status in ('planned', 'enrolled', 'withdrawn', 'completed')),
  started_on date not null,
  ended_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_profile_id, academic_year_id)
);

create index student_enrolments_org_year_idx
  on student_enrolments (organisation_id, academic_year_id);

-- Dated student ↔ class link. History is retained (ended_on set on leave).
create table class_memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  class_id uuid not null references classes (id),
  student_profile_id uuid not null references student_profiles (id),
  academic_year_id uuid not null references academic_years (id),
  started_on date not null,
  ended_on date,
  created_at timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on)
);

create unique index class_memberships_active_idx
  on class_memberships (class_id, student_profile_id)
  where ended_on is null;

create index class_memberships_student_idx
  on class_memberships (student_profile_id, academic_year_id);

-- Dated staff ↔ class assignment (form tutor, subject teacher, …).
create table class_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  class_id uuid not null references classes (id),
  staff_profile_id uuid not null references staff_profiles (id),
  assignment_role text not null
    check (assignment_role in ('form_tutor', 'co_tutor', 'subject_teacher', 'head_of_year', 'other')),
  started_on date not null,
  ended_on date,
  created_at timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on)
);

create unique index class_staff_assignments_active_idx
  on class_staff_assignments (class_id, staff_profile_id, assignment_role)
  where ended_on is null;

-- What a class teaches. Form classes may have zero rows; teaching groups typically one+.
create table class_subjects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  class_id uuid not null references classes (id),
  subject_id uuid not null references subjects (id),
  created_at timestamptz not null default now(),
  unique (class_id, subject_id)
);

-- Guardian / parent relationship at a school. Extra columns are placeholders
-- for later workflows (restricted contact has no product behaviour yet).
create table guardianships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  guardian_user_id uuid not null references users (id),
  relationship text not null default 'other',
  has_parental_responsibility boolean not null default false,
  is_emergency_contact boolean not null default false,
  lives_with_student boolean not null default false,
  restricted_contact boolean not null default false,
  portal_access boolean not null default true,
  priority smallint not null default 1,
  started_on date,
  ended_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_profile_id, guardian_user_id)
);

create index guardianships_guardian_user_id_idx
  on guardianships (guardian_user_id);

-- Placeholder: no notification delivery yet.
create table notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  user_id uuid not null references users (id),
  channel text not null
    check (channel in ('email', 'push', 'in_app')),
  category text not null, -- 'attendance', 'homework', 'announcements', …
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, user_id, channel, category)
);

-- ---------------------------------------------------------------------------
-- Inter-school competition governance (placeholder only)
-- No RLS policy will allow joining pupil data across organisations.
-- ---------------------------------------------------------------------------

create table inter_school_competition_networks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'disabled'
    check (status in ('disabled', 'planned', 'active')),
  extras jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table inter_school_competition_network_members (
  id uuid primary key default gen_random_uuid(),
  network_id uuid not null references inter_school_competition_networks (id),
  organisation_id uuid not null references organisations (id),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'withdrawn')),
  data_sharing_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (network_id, organisation_id)
);

-- ---------------------------------------------------------------------------
-- set_tenant_context: the only supported way to set tenant GUCs.
-- is_local := true  => transaction-scoped; discarded on COMMIT/ROLLBACK.
-- Membership is always revalidated against organisation_memberships unless
-- a verified platform admin is entering an explicit organisation context.
-- Owner MUST be a BYPASSRLS role (schoolapp_owner). Runtime role is not.
-- ---------------------------------------------------------------------------

create or replace function set_tenant_context(
  p_user_id uuid,
  p_organisation_id uuid,
  p_is_platform_admin boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_is_platform_admin boolean := false;
begin
  if p_user_id is null then
    raise exception 'tenant_context_user_required' using errcode = '28000';
  end if;

  if p_is_platform_admin then
    select exists (
      select 1 from platform_admins pa where pa.user_id = p_user_id
    ) into v_is_platform_admin;

    if not v_is_platform_admin then
      raise exception 'tenant_context_not_platform_admin' using errcode = '42501';
    end if;
  end if;

  if p_organisation_id is not null and not v_is_platform_admin then
    if not exists (
      select 1
      from organisation_memberships m
      where m.user_id = p_user_id
        and m.organisation_id = p_organisation_id
        and m.status = 'active'
        and m.ended_at is null
    ) then
      raise exception 'tenant_context_membership_required' using errcode = '42501';
    end if;
  end if;

  -- Transaction-local only. Never set is_local := false.
  perform set_config('app.user_id', p_user_id::text, true);
  perform set_config(
    'app.organisation_id',
    coalesce(p_organisation_id::text, ''),
    true
  );
  perform set_config(
    'app.is_platform_admin',
    case when v_is_platform_admin then 'true' else 'false' end,
    true
  );
end;
$$;

revoke all on function set_tenant_context(uuid, uuid, boolean) from public;
-- grant execute on function set_tenant_context(uuid, uuid, boolean) to schoolapp_app;

-- Called WITHOUT tenant context (e.g. GET /api/v1/me/memberships).
-- Must be SECURITY DEFINER so it can read memberships before SET LOCAL.
create or replace function list_memberships_for_user(p_user_id uuid)
returns table (
  membership_id uuid,
  organisation_id uuid,
  organisation_name text,
  organisation_slug citext,
  status text
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select
    m.id,
    m.organisation_id,
    o.name,
    o.slug,
    m.status
  from organisation_memberships m
  join organisations o on o.id = m.organisation_id
  where m.user_id = p_user_id
    and m.ended_at is null;
$$;

revoke all on function list_memberships_for_user(uuid) from public;
-- grant execute on function list_memberships_for_user(uuid) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- updated_at triggers (representative)
-- ---------------------------------------------------------------------------

create trigger organisations_updated_at
  before update on organisations
  for each row execute function set_updated_at();

create trigger organisation_settings_updated_at
  before update on organisation_settings
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

create trigger student_enrolments_updated_at
  before update on student_enrolments
  for each row execute function set_updated_at();

create trigger guardianships_updated_at
  before update on guardianships
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helpers: ENABLE + FORCE + tenant isolation policy
-- ---------------------------------------------------------------------------

create or replace function install_tenant_isolation(p_table regclass)
returns void
language plpgsql
as $$
declare
  v_name text := p_table::text;
  v_policy text := replace(v_name, '.', '_') || '_tenant_isolation';
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('alter table %s force row level security', p_table);
  execute format(
    'drop policy if exists %I on %s',
    v_policy,
    p_table
  );
  execute format(
    $sql$
      create policy %I on %s
      for all
      using (app_tenant_matches(organisation_id))
      with check (app_tenant_matches(organisation_id))
    $sql$,
    v_policy,
    p_table
  );
end;
$$;

select install_tenant_isolation('organisation_identifiers');
select install_tenant_isolation('organisation_settings');
select install_tenant_isolation('organisation_feature_flags');
select install_tenant_isolation('organisation_memberships');
select install_tenant_isolation('invitations');
select install_tenant_isolation('audit_events');
select install_tenant_isolation('external_identifiers');
select install_tenant_isolation('organisation_subscriptions');
select install_tenant_isolation('academic_years');
select install_tenant_isolation('terms');
select install_tenant_isolation('half_terms');
select install_tenant_isolation('year_groups');
select install_tenant_isolation('houses');
select install_tenant_isolation('subjects');
select install_tenant_isolation('classes');
select install_tenant_isolation('staff_profiles');
select install_tenant_isolation('student_profiles');
select install_tenant_isolation('student_enrolments');
select install_tenant_isolation('class_memberships');
select install_tenant_isolation('class_staff_assignments');
select install_tenant_isolation('class_subjects');
select install_tenant_isolation('guardianships');
select install_tenant_isolation('notification_preferences');
select install_tenant_isolation('inter_school_competition_network_members');

-- roles: system templates (organisation_id is null) readable when no tenant
-- mismatch; school-custom roles are tenant-scoped.
alter table roles enable row level security;
alter table roles force row level security;

create policy roles_tenant_isolation on roles
  for all
  using (
    organisation_id is null
    or app_tenant_matches(organisation_id)
  )
  with check (
    organisation_id is null
    or app_tenant_matches(organisation_id)
  );

-- Bootstrap tables used by set_tenant_context / list_memberships_for_user
-- still have FORCE RLS (see organisation_memberships above). Those functions
-- are SECURITY DEFINER owned by schoolapp_owner (BYPASSRLS). The runtime role
-- never has BYPASSRLS.

alter table platform_admins enable row level security;
alter table platform_admins force row level security;

create policy platform_admins_self on platform_admins
  for select
  using (
    app_is_platform_admin()
    or user_id = app_current_user_id()
  );

-- organisations: once context is set, only the current org (or platform admin).
-- Pre-context listing uses list_memberships_for_user().
alter table organisations enable row level security;
alter table organisations force row level security;

create policy organisations_current_context on organisations
  for all
  using (
    app_is_platform_admin()
    or id = app_current_organisation_id()
  )
  with check (
    app_is_platform_admin()
    or id = app_current_organisation_id()
  );

-- users: self, or users visible in the current tenant via memberships.
alter table users enable row level security;
alter table users force row level security;

create policy users_self_or_current_tenant on users
  for all
  using (
    app_is_platform_admin()
    or id = app_current_user_id()
    or exists (
      select 1
      from organisation_memberships m
      where m.user_id = users.id
        and m.organisation_id = app_current_organisation_id()
        and m.status = 'active'
    )
  )
  with check (
    app_is_platform_admin()
    or id = app_current_user_id()
  );

-- Inter-school networks are platform-scoped governance metadata, not a
-- pupil data plane. Runtime should not SELECT these from school roles.
alter table inter_school_competition_networks enable row level security;
alter table inter_school_competition_networks force row level security;

create policy inter_school_networks_platform_admin on inter_school_competition_networks
  for all
  using (app_is_platform_admin())
  with check (app_is_platform_admin());

alter table billing_accounts enable row level security;
alter table billing_accounts force row level security;

create policy billing_accounts_platform_admin on billing_accounts
  for all
  using (app_is_platform_admin())
  with check (app_is_platform_admin());

-- ---------------------------------------------------------------------------
-- Privileges (illustrative)
-- ---------------------------------------------------------------------------
-- revoke update, delete on audit_events from schoolapp_app;
-- grant insert, select on audit_events to schoolapp_app;
-- Parent vs staff visibility (own children vs classmates) remains an
-- application-layer check in Phase 1, with tests that a parent cannot
-- read classmates. Promote to narrower RLS/DB roles when the class model
-- is exercised in production-like tests.

-- ---------------------------------------------------------------------------
-- Seed keys (system roles) — applied in a later data migration
-- ---------------------------------------------------------------------------
-- platform.super_admin (platform_admins table)
-- school.admin, school.headteacher, school.teacher, school.admissions,
-- school.staff, school.parent, school.student
