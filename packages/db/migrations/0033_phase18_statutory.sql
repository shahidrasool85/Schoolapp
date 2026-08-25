-- Phase 18: UK statutory pupil data, census snapshots, and reporting exports.
-- Additive. Does not weaken FORCE RLS, tenant context, hostname tenancy,
-- membership revalidation, teacher assigned-only access, guardianship /
-- portal_access, student self-only access, student portal policy,
-- safeguarding capabilities, break-glass, audit, object-storage controls,
-- messaging, or Phase 17 UI contracts.
-- Treats migrations 0001–0032 as immutable.
-- This is census-readiness, not a DfE COLLECT submission product.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('statutory.read', 'Read school statutory profile, census workspace, and data-quality results'),
  ('statutory.manage', 'Maintain school statutory identifiers and census configuration'),
  ('statutory.validate', 'Run statutory data-quality validation'),
  ('statutory.census.create', 'Create census runs and generate snapshots'),
  ('statutory.census.finalise', 'Finalise a census snapshot as ready for export'),
  ('statutory.census.export', 'Export census-ready files from a snapshot'),
  ('reports.pupils.read', 'Read pupil-roll reports'),
  ('reports.attendance.read', 'Read statutory attendance summary reports'),
  ('reports.admissions.read', 'Read admissions and enrolment reports'),
  ('reports.send.read', 'Read SEND / additional-needs reports (also requires students.additional_needs.read)'),
  ('reports.exports.create', 'Create school-wide CSV/XML report exports'),
  ('pupils.statutory.read', 'Read a pupil statutory record'),
  ('pupils.statutory.manage', 'Maintain a pupil statutory record and FSM periods')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'statutory.read'),
    ('school.admin', 'statutory.manage'),
    ('school.admin', 'statutory.validate'),
    ('school.admin', 'statutory.census.create'),
    ('school.admin', 'statutory.census.finalise'),
    ('school.admin', 'statutory.census.export'),
    ('school.admin', 'reports.pupils.read'),
    ('school.admin', 'reports.attendance.read'),
    ('school.admin', 'reports.admissions.read'),
    ('school.admin', 'reports.send.read'),
    ('school.admin', 'reports.exports.create'),
    ('school.admin', 'pupils.statutory.read'),
    ('school.admin', 'pupils.statutory.manage'),
    ('school.headteacher', 'statutory.read'),
    ('school.headteacher', 'statutory.validate'),
    ('school.headteacher', 'statutory.census.export'),
    ('school.headteacher', 'reports.pupils.read'),
    ('school.headteacher', 'reports.attendance.read'),
    ('school.headteacher', 'reports.admissions.read'),
    ('school.headteacher', 'reports.send.read'),
    ('school.headteacher', 'reports.exports.create'),
    ('school.headteacher', 'pupils.statutory.read'),
    ('school.admissions', 'reports.admissions.read'),
    ('school.admissions', 'reports.pupils.read')
) as x(role_key, perm)
  on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select org_role.id, rp.permission_key
from roles sys
join role_permissions rp on rp.role_id = sys.id
join roles org_role on org_role.key = sys.key and org_role.organisation_id is not null
where sys.organisation_id is null
  and (
    rp.permission_key like 'statutory.%'
    or rp.permission_key like 'reports.pupils.%'
    or rp.permission_key like 'reports.attendance.%'
    or rp.permission_key like 'reports.admissions.%'
    or rp.permission_key like 'reports.send.%'
    or rp.permission_key like 'reports.exports.%'
    or rp.permission_key like 'pupils.statutory.%'
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Attendance statutory mapping (canonical internal codes remain the source)
-- ---------------------------------------------------------------------------

alter table attendance_codes
  add column if not exists statutory_category text;

update attendance_codes
set statutory_category = category
where statutory_category is null;

alter table attendance_codes
  alter column statutory_category set default 'present';

alter table attendance_codes
  alter column statutory_category set not null;

alter table attendance_codes
  drop constraint if exists attendance_codes_statutory_category_check;

alter table attendance_codes
  add constraint attendance_codes_statutory_category_check
  check (statutory_category in (
    'present',
    'late',
    'authorised_absence',
    'unauthorised_absence',
    'not_required'
  ));

-- ---------------------------------------------------------------------------
-- Versioned official code sets (platform-owned; schools cannot redefine)
-- ---------------------------------------------------------------------------

create table statutory_code_sets (
  id uuid primary key default gen_random_uuid(),
  catalogue text not null
    check (catalogue in (
      'ethnicity',
      'language',
      'enrolment_status',
      'send_provision',
      'leaving_reason',
      'school_phase',
      'establishment_type',
      'establishment_status',
      'sex',
      'looked_after'
    )),
  version text not null check (char_length(trim(version)) between 4 and 16),
  label text not null check (char_length(trim(label)) between 1 and 80),
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (catalogue, version)
);

create unique index statutory_code_sets_one_current
  on statutory_code_sets (catalogue)
  where is_current;

create table statutory_codes (
  id uuid primary key default gen_random_uuid(),
  code_set_id uuid not null references statutory_code_sets (id) on delete cascade,
  code text not null check (char_length(trim(code)) between 1 and 16),
  name text not null check (char_length(trim(name)) between 1 and 120),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  unique (code_set_id, code)
);

grant select on statutory_code_sets to schoolapp_app;
grant select on statutory_codes to schoolapp_app;

insert into statutory_code_sets (catalogue, version, label, is_current)
select x.catalogue, '2025-2026', 'England School Census 2025/26 (Schoolapp subset)', true
from (
  values
    ('ethnicity'),
    ('language'),
    ('enrolment_status'),
    ('send_provision'),
    ('leaving_reason'),
    ('school_phase'),
    ('establishment_type'),
    ('establishment_status'),
    ('sex'),
    ('looked_after')
) as x(catalogue);

insert into statutory_codes (code_set_id, code, name, sort_order)
select s.id, c.code, c.name, c.sort_order
from statutory_code_sets s
join (
  values
    ('sex', 'M', 'Male', 1),
    ('sex', 'F', 'Female', 2),
    ('enrolment_status', 'C', 'Current (single registration)', 1),
    ('enrolment_status', 'G', 'Guest pupil', 2),
    ('enrolment_status', 'M', 'Main — dual registration', 3),
    ('enrolment_status', 'S', 'Subsidiary — dual registration', 4),
    ('enrolment_status', 'F', 'FE college', 5),
    ('send_provision', 'N', 'No special educational need', 1),
    ('send_provision', 'K', 'SEN support', 2),
    ('send_provision', 'E', 'Education, health and care plan', 3),
    ('looked_after', 'none', 'Not looked after', 1),
    ('looked_after', 'looked_after', 'Looked after / child in care', 2),
    ('looked_after', 'previously_looked_after', 'Previously looked after', 3),
    ('school_phase', 'PS', 'Primary', 1),
    ('school_phase', 'MP', 'Middle deemed primary', 2),
    ('school_phase', 'MS', 'Middle deemed secondary', 3),
    ('school_phase', 'SS', 'Secondary', 4),
    ('school_phase', 'AT', 'All-through', 5),
    ('establishment_type', '01', 'Community school', 1),
    ('establishment_type', '02', 'Voluntary aided school', 2),
    ('establishment_type', '03', 'Voluntary controlled school', 3),
    ('establishment_type', '06', 'Foundation school', 4),
    ('establishment_type', '11', 'Other independent school', 5),
    ('establishment_status', '1', 'Open', 1),
    ('establishment_status', '2', 'Closed', 2),
    ('establishment_status', '3', 'Open, but proposed to close', 3),
    ('establishment_status', '4', 'Proposed to open', 4),
    ('leaving_reason', 'SC', 'Transfer to another school', 1),
    ('leaving_reason', 'FE', 'Further education / other provider', 2),
    ('leaving_reason', 'HE', 'Elective home education', 3),
    ('leaving_reason', 'EM', 'Emigrated', 4),
    ('leaving_reason', 'DE', 'Deceased', 5),
    ('leaving_reason', 'PE', 'Permanent exclusion (placeholder)', 6),
    ('leaving_reason', 'OT', 'Other', 7),
    ('ethnicity', 'WBRI', 'White — British', 1),
    ('ethnicity', 'WIRI', 'White — Irish', 2),
    ('ethnicity', 'WIRT', 'White — Irish Traveller', 3),
    ('ethnicity', 'WOTH', 'White — any other White background', 4),
    ('ethnicity', 'MWBC', 'Mixed — White and Black Caribbean', 5),
    ('ethnicity', 'MWBA', 'Mixed — White and Black African', 6),
    ('ethnicity', 'MWAS', 'Mixed — White and Asian', 7),
    ('ethnicity', 'MOTH', 'Mixed — any other Mixed background', 8),
    ('ethnicity', 'AIND', 'Asian — Indian', 9),
    ('ethnicity', 'APKN', 'Asian — Pakistani', 10),
    ('ethnicity', 'ABAN', 'Asian — Bangladeshi', 11),
    ('ethnicity', 'AOTH', 'Asian — any other Asian background', 12),
    ('ethnicity', 'BCRB', 'Black — Caribbean', 13),
    ('ethnicity', 'BAFR', 'Black — African', 14),
    ('ethnicity', 'BOTH', 'Black — any other Black background', 15),
    ('ethnicity', 'CHNE', 'Chinese', 16),
    ('ethnicity', 'OOTH', 'Any other ethnic group', 17),
    ('ethnicity', 'REFU', 'Refused', 18),
    ('ethnicity', 'NOBT', 'Information not yet obtained', 19),
    ('language', 'ENG', 'English', 1),
    ('language', 'ENB', 'Believed to be English', 2),
    ('language', 'OTB', 'Believed to be other than English', 3),
    ('language', 'URD', 'Urdu', 4),
    ('language', 'PAN', 'Panjabi', 5),
    ('language', 'ARA', 'Arabic', 6),
    ('language', 'SOM', 'Somali', 7),
    ('language', 'BEN', 'Bengali', 8),
    ('language', 'POL', 'Polish', 9),
    ('language', 'POR', 'Portuguese', 10),
    ('language', 'YOR', 'Yoruba', 11),
    ('language', 'TAM', 'Tamil', 12),
    ('language', 'GUJ', 'Gujarati', 13),
    ('language', 'ZHO', 'Chinese', 14),
    ('language', 'FRA', 'French', 15),
    ('language', 'SPA', 'Spanish', 16),
    ('language', 'NOT', 'Information not obtained', 17),
    ('language', 'REF', 'Refused', 18)
) as c(catalogue, code, name, sort_order)
  on s.catalogue = c.catalogue and s.version = '2025-2026';

-- ---------------------------------------------------------------------------
-- School statutory profile
-- ---------------------------------------------------------------------------

create table organisation_statutory_profiles (
  organisation_id uuid primary key references organisations (id),
  statutory_name text,
  establishment_number text check (establishment_number is null or establishment_number ~ '^\d{4}$'),
  local_authority_number text check (local_authority_number is null or local_authority_number ~ '^\d{3}$'),
  urn text check (urn is null or urn ~ '^\d{6}$'),
  school_phase text,
  establishment_type text,
  establishment_status text,
  address_line1 text,
  address_line2 text,
  address_town text,
  address_postcode text,
  telephone text,
  email text,
  timezone text not null default 'Europe/London',
  default_census_type text not null default 'autumn'
    check (default_census_type in ('autumn', 'spring', 'summer')),
  code_set_version text not null default '2025-2026',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id)
);

create trigger organisation_statutory_profiles_updated_at
  before update on organisation_statutory_profiles
  for each row execute function set_updated_at();

select install_tenant_isolation('organisation_statutory_profiles');
grant select, insert, update on organisation_statutory_profiles to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Pupil statutory record (canonical identity stays on student_profiles / users)
-- ---------------------------------------------------------------------------

create table student_statutory_profiles (
  student_profile_id uuid primary key references student_profiles (id) on delete cascade,
  organisation_id uuid not null references organisations (id),
  legal_surname text,
  legal_forename text,
  middle_names text,
  sex text,
  upn text,
  former_upn text,
  ethnicity_code text,
  language_code text,
  enrolment_status_code text,
  date_of_admission date,
  date_of_leaving date,
  leaving_reason_code text,
  previous_school_name text,
  send_provision_code text,
  looked_after_status text not null default 'none'
    check (looked_after_status in ('none', 'looked_after', 'previously_looked_after')),
  service_child boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id),
  check (date_of_leaving is null or date_of_admission is null or date_of_leaving >= date_of_admission)
);

create unique index student_statutory_profiles_upn_idx
  on student_statutory_profiles (organisation_id, upn)
  where upn is not null;

create index student_statutory_profiles_org_idx
  on student_statutory_profiles (organisation_id);

create trigger student_statutory_profiles_updated_at
  before update on student_statutory_profiles
  for each row execute function set_updated_at();

select install_tenant_isolation('student_statutory_profiles');
grant select, insert, update on student_statutory_profiles to schoolapp_app;

create table student_fsm_periods (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id) on delete cascade,
  started_on date not null,
  ended_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users (id),
  check (ended_on is null or ended_on >= started_on)
);

create index student_fsm_periods_student_idx
  on student_fsm_periods (organisation_id, student_profile_id, started_on);

create trigger student_fsm_periods_updated_at
  before update on student_fsm_periods
  for each row execute function set_updated_at();

select install_tenant_isolation('student_fsm_periods');
grant select, insert, update, delete on student_fsm_periods to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Census runs and immutable snapshots
-- ---------------------------------------------------------------------------

create table census_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  academic_year_id uuid not null references academic_years (id),
  census_type text not null check (census_type in ('autumn', 'spring', 'summer')),
  census_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'validating', 'ready', 'exported', 'superseded', 'archived')),
  current_snapshot_version integer not null default 0,
  snapshot_schema_version integer not null default 1,
  code_set_version text not null default '2025-2026',
  error_count integer not null default 0,
  warning_count integer not null default 0,
  information_count integer not null default 0,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalised_at timestamptz,
  finalised_by uuid references users (id),
  exported_at timestamptz,
  exported_by uuid references users (id)
);

create index census_runs_org_idx
  on census_runs (organisation_id, census_date desc, created_at desc);

create unique index census_runs_one_active_per_date
  on census_runs (organisation_id, academic_year_id, census_type, census_date)
  where status not in ('superseded', 'archived');

create trigger census_runs_updated_at
  before update on census_runs
  for each row execute function set_updated_at();

select install_tenant_isolation('census_runs');
grant select, insert, update on census_runs to schoolapp_app;

create table census_snapshot_schools (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  census_run_id uuid not null references census_runs (id) on delete cascade,
  snapshot_version integer not null,
  statutory_name text,
  establishment_number text,
  local_authority_number text,
  urn text,
  school_phase text,
  establishment_type text,
  establishment_status text,
  address_line1 text,
  address_town text,
  address_postcode text,
  timezone text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (census_run_id, snapshot_version)
);

select install_tenant_isolation('census_snapshot_schools');
grant select, insert on census_snapshot_schools to schoolapp_app;

create table census_snapshot_pupils (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  census_run_id uuid not null references census_runs (id) on delete cascade,
  snapshot_version integer not null,
  student_profile_id uuid not null references student_profiles (id),
  admission_number text,
  upn text,
  former_upn text,
  legal_surname text,
  legal_forename text,
  middle_names text,
  preferred_name text,
  date_of_birth date,
  sex text,
  ethnicity_code text,
  language_code text,
  enrolment_status_code text,
  year_group_code text,
  class_name text,
  date_of_admission date,
  date_of_leaving date,
  leaving_reason_code text,
  send_provision_code text,
  fsm_eligible boolean not null default false,
  looked_after_status text,
  service_child boolean,
  on_roll boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (census_run_id, snapshot_version, student_profile_id)
);

create index census_snapshot_pupils_run_idx
  on census_snapshot_pupils (census_run_id, snapshot_version);

select install_tenant_isolation('census_snapshot_pupils');
grant select, insert on census_snapshot_pupils to schoolapp_app;

create table census_validation_issues (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  census_run_id uuid references census_runs (id) on delete cascade,
  snapshot_version integer,
  source text not null default 'live' check (source in ('live', 'snapshot')),
  rule_key text not null,
  severity text not null check (severity in ('error', 'warning', 'information')),
  entity_type text not null,
  entity_id uuid,
  field text,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index census_validation_issues_run_idx
  on census_validation_issues (census_run_id, snapshot_version, severity);

create index census_validation_issues_live_org_idx
  on census_validation_issues (organisation_id, source, created_at desc);

select install_tenant_isolation('census_validation_issues');
grant select, insert, delete on census_validation_issues to schoolapp_app;

create table data_exports (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  export_kind text not null
    check (export_kind in (
      'pupil_roll',
      'attendance_summary',
      'admissions_enrolment',
      'send_additional_needs',
      'census_snapshot',
      'census_ready'
    )),
  format text not null check (format in ('csv', 'xml')),
  census_run_id uuid references census_runs (id),
  snapshot_version integer,
  row_count integer not null default 0,
  filters jsonb not null default '{}'::jsonb,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now()
);

create index data_exports_org_idx
  on data_exports (organisation_id, created_at desc);

select install_tenant_isolation('data_exports');
grant select, insert on data_exports to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Same-organisation integrity and immutability
-- ---------------------------------------------------------------------------

create or replace function phase18_same_org_student(p_organisation_id uuid, p_student_id uuid)
returns void
language plpgsql
as $$
declare
  v_org uuid;
begin
  if p_student_id is null then
    return;
  end if;
  select organisation_id into v_org from student_profiles where id = p_student_id;
  if v_org is null or v_org is distinct from p_organisation_id then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
end;
$$;

create or replace function phase18_same_org_year(p_organisation_id uuid, p_year_id uuid)
returns void
language plpgsql
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from academic_years where id = p_year_id;
  if v_org is null or v_org is distinct from p_organisation_id then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
end;
$$;

create or replace function phase18_statutory_same_org_tg()
returns trigger
language plpgsql
as $$
declare
  v_org uuid;
  v_status text;
begin
  if tg_table_name = 'student_statutory_profiles' then
    perform phase18_same_org_student(new.organisation_id, new.student_profile_id);
  elsif tg_table_name = 'student_fsm_periods' then
    perform phase18_same_org_student(new.organisation_id, new.student_profile_id);
  elsif tg_table_name = 'census_runs' then
    perform phase18_same_org_year(new.organisation_id, new.academic_year_id);
  elsif tg_table_name in ('census_snapshot_schools', 'census_snapshot_pupils', 'census_validation_issues', 'data_exports') then
    if new.census_run_id is not null then
      select organisation_id into v_org from census_runs where id = new.census_run_id;
      if v_org is null or v_org is distinct from new.organisation_id then
        raise exception 'organisation_mismatch' using errcode = '23514';
      end if;
    end if;
    if tg_table_name = 'census_snapshot_pupils' then
      perform phase18_same_org_student(new.organisation_id, new.student_profile_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists student_statutory_profiles_org_tg on student_statutory_profiles;
create trigger student_statutory_profiles_org_tg
  before insert or update on student_statutory_profiles
  for each row execute function phase18_statutory_same_org_tg();

drop trigger if exists student_fsm_periods_org_tg on student_fsm_periods;
create trigger student_fsm_periods_org_tg
  before insert or update on student_fsm_periods
  for each row execute function phase18_statutory_same_org_tg();

drop trigger if exists census_runs_org_tg on census_runs;
create trigger census_runs_org_tg
  before insert or update on census_runs
  for each row execute function phase18_statutory_same_org_tg();

drop trigger if exists census_snapshot_schools_org_tg on census_snapshot_schools;
create trigger census_snapshot_schools_org_tg
  before insert or update on census_snapshot_schools
  for each row execute function phase18_statutory_same_org_tg();

drop trigger if exists census_snapshot_pupils_org_tg on census_snapshot_pupils;
create trigger census_snapshot_pupils_org_tg
  before insert or update on census_snapshot_pupils
  for each row execute function phase18_statutory_same_org_tg();

drop trigger if exists census_validation_issues_org_tg on census_validation_issues;
create trigger census_validation_issues_org_tg
  before insert or update on census_validation_issues
  for each row execute function phase18_statutory_same_org_tg();

drop trigger if exists data_exports_org_tg on data_exports;
create trigger data_exports_org_tg
  before insert or update on data_exports
  for each row execute function phase18_statutory_same_org_tg();

create or replace function phase18_snapshot_immutable_tg()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_run uuid;
begin
  v_run := coalesce(new.census_run_id, old.census_run_id);
  select status into v_status from census_runs where id = v_run;
  if tg_op = 'INSERT' then
    if v_status in ('ready', 'exported', 'superseded', 'archived') then
      raise exception 'census_snapshot_immutable' using errcode = '23514';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    if v_status in ('ready', 'exported', 'superseded', 'archived') then
      raise exception 'census_snapshot_immutable' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists census_snapshot_pupils_immutable_tg on census_snapshot_pupils;
create trigger census_snapshot_pupils_immutable_tg
  before insert or update or delete on census_snapshot_pupils
  for each row execute function phase18_snapshot_immutable_tg();

drop trigger if exists census_snapshot_schools_immutable_tg on census_snapshot_schools;
create trigger census_snapshot_schools_immutable_tg
  before insert or update or delete on census_snapshot_schools
  for each row execute function phase18_snapshot_immutable_tg();

create or replace function phase18_actor_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'census_runs' and tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.created_by := app_current_user_id();
    elsif new.created_by is null then
      raise exception 'statutory_actor_required' using errcode = '23514';
    end if;
  elsif tg_table_name = 'data_exports' and tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.created_by := app_current_user_id();
    elsif new.created_by is null then
      raise exception 'statutory_actor_required' using errcode = '23514';
    end if;
  elsif tg_table_name in ('organisation_statutory_profiles', 'student_statutory_profiles') then
    if app_current_user_id() is not null then
      new.updated_by := app_current_user_id();
    end if;
  elsif tg_table_name = 'student_fsm_periods' and tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.created_by := app_current_user_id();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists organisation_statutory_profiles_actor_tg on organisation_statutory_profiles;
create trigger organisation_statutory_profiles_actor_tg
  before insert or update on organisation_statutory_profiles
  for each row execute function phase18_actor_tg();

drop trigger if exists student_statutory_profiles_actor_tg on student_statutory_profiles;
create trigger student_statutory_profiles_actor_tg
  before insert or update on student_statutory_profiles
  for each row execute function phase18_actor_tg();

drop trigger if exists student_fsm_periods_actor_tg on student_fsm_periods;
create trigger student_fsm_periods_actor_tg
  before insert or update on student_fsm_periods
  for each row execute function phase18_actor_tg();

drop trigger if exists census_runs_actor_tg on census_runs;
create trigger census_runs_actor_tg
  before insert on census_runs
  for each row execute function phase18_actor_tg();

drop trigger if exists data_exports_actor_tg on data_exports;
create trigger data_exports_actor_tg
  before insert on data_exports
  for each row execute function phase18_actor_tg();

-- Keep Phase 6 org defaults mapping internal attendance codes to statutory categories.
create or replace function ensure_organisation_phase6_defaults(p_organisation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if nullif(current_setting('app.organisation_id', true), '') is not null
     and app_current_organisation_id() is distinct from p_organisation_id
     and not app_is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into student_portal_policies (organisation_id, default_enabled)
  values (p_organisation_id, false)
  on conflict (organisation_id) do nothing;

  insert into attendance_session_types (
    organisation_id, key, name, sort_order, typical_start_time, typical_end_time
  ) values
    (p_organisation_id, 'am', 'AM', 1, '09:00', '12:00'),
    (p_organisation_id, 'pm', 'PM', 2, '13:00', '15:30')
  on conflict (organisation_id, key) do nothing;

  insert into attendance_codes (
    organisation_id, code, name, category, statutory_category, requires_late_minutes, sort_order
  ) values
    (p_organisation_id, 'present', 'Present', 'present', 'present', false, 1),
    (p_organisation_id, 'late', 'Late', 'late', 'late', true, 2),
    (p_organisation_id, 'authorised', 'Authorised absence', 'authorised_absence', 'authorised_absence', false, 3),
    (p_organisation_id, 'unauthorised', 'Unauthorised absence', 'unauthorised_absence', 'unauthorised_absence', false, 4),
    (p_organisation_id, 'not_required', 'Not required', 'not_required', 'not_required', false, 5)
  on conflict (organisation_id, code) do nothing;
end;
$$;
