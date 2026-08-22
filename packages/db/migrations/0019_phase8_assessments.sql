-- Phase 8: Formal assessments, results, reporting periods, targets, and reports.
-- Additive. Does not weaken FORCE RLS, tenant context, hostname tenancy,
-- membership revalidation, teacher assigned-only access, guardianship /
-- portal_access, student self-only access, student portal policy, current
-- primary-enrolment checks, break-glass, or audit controls.
-- Distinct from Phase 7 learning_marks and Phase 4 admissions_assessments.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('assessments.read', 'School-wide formal assessment read / oversight'),
  ('assessments.read_assigned', 'Read formal assessments for assigned classes and pupils'),
  ('assessments.manage', 'School-wide formal assessment management'),
  ('assessments.manage_assigned', 'Create and manage formal assessments for assigned classes'),
  ('results.read', 'School-wide formal result read'),
  ('results.read_assigned', 'Read formal results for assigned classes and pupils'),
  ('results.enter', 'School-wide formal result entry'),
  ('results.enter_assigned', 'Enter formal results for assigned classes and pupils'),
  ('results.review', 'Review or moderate formal results'),
  ('results.publish', 'Publish/release formal results'),
  ('results.read_own_children', 'Parent: read authorised children''s released formal results'),
  ('results.read_self', 'Student: read own released formal results'),
  ('reports.read', 'School-wide progress report read'),
  ('reports.read_assigned', 'Read progress reports for assigned pupils'),
  ('reports.manage', 'School-wide progress report management'),
  ('reports.manage_assigned', 'Create and edit progress reports for assigned pupils'),
  ('reports.review', 'Review or approve progress reports'),
  ('reports.publish', 'Publish progress reports'),
  ('reports.read_own_children', 'Parent: read authorised children''s published reports'),
  ('reports.read_self', 'Student: read own published reports'),
  ('academic.oversight', 'School-wide academic assessment/results/reports oversight')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'assessments.read'),
    ('school.admin', 'assessments.manage'),
    ('school.admin', 'results.read'),
    ('school.admin', 'results.enter'),
    ('school.admin', 'results.review'),
    ('school.admin', 'results.publish'),
    ('school.admin', 'reports.read'),
    ('school.admin', 'reports.manage'),
    ('school.admin', 'reports.review'),
    ('school.admin', 'reports.publish'),
    ('school.admin', 'academic.oversight'),
    ('school.headteacher', 'assessments.read'),
    ('school.headteacher', 'assessments.manage'),
    ('school.headteacher', 'results.read'),
    ('school.headteacher', 'results.enter'),
    ('school.headteacher', 'results.review'),
    ('school.headteacher', 'results.publish'),
    ('school.headteacher', 'reports.read'),
    ('school.headteacher', 'reports.manage'),
    ('school.headteacher', 'reports.review'),
    ('school.headteacher', 'reports.publish'),
    ('school.headteacher', 'academic.oversight'),
    ('school.teacher', 'assessments.read_assigned'),
    ('school.teacher', 'assessments.manage_assigned'),
    ('school.teacher', 'results.read_assigned'),
    ('school.teacher', 'results.enter_assigned'),
    ('school.teacher', 'reports.read_assigned'),
    ('school.teacher', 'reports.manage_assigned'),
    ('school.parent', 'results.read_own_children'),
    ('school.parent', 'reports.read_own_children'),
    ('school.student', 'results.read_self'),
    ('school.student', 'reports.read_self')
) as x(role_key, perm)
  on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Assessment type catalogue
-- ---------------------------------------------------------------------------

create table academic_assessment_types (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null
    check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null,
  sort_order int not null default 0,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organisation_id, key)
);

-- ---------------------------------------------------------------------------
-- Grade / attainment schemes
-- ---------------------------------------------------------------------------

create table academic_grade_schemes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null
    check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null,
  scheme_kind text not null
    check (scheme_kind in (
      'percentage',
      'letter',
      'numeric',
      'teacher_judgement',
      'age_related',
      'school_defined'
    )),
  subject_id uuid references subjects (id),
  year_group_id uuid references year_groups (id),
  is_numeric boolean not null default false,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create table academic_grade_scheme_levels (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  scheme_id uuid not null references academic_grade_schemes (id) on delete cascade,
  code text not null,
  label text not null,
  sort_order int not null default 0,
  numeric_value numeric(8, 2),
  min_percentage numeric(5, 2),
  max_percentage numeric(5, 2),
  created_at timestamptz not null default now(),
  unique (scheme_id, code),
  unique (scheme_id, sort_order),
  check (min_percentage is null or (min_percentage >= 0 and min_percentage <= 100)),
  check (max_percentage is null or (max_percentage >= 0 and max_percentage <= 100)),
  check (
    min_percentage is null
    or max_percentage is null
    or min_percentage <= max_percentage
  )
);

-- ---------------------------------------------------------------------------
-- Reporting periods (not assumed to be exactly three terms)
-- ---------------------------------------------------------------------------

create table academic_reporting_periods (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  academic_year_id uuid not null references academic_years (id),
  term_id uuid references terms (id),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'planned'
    check (status in ('planned', 'open', 'closed', 'published')),
  publish_starts_on date,
  publish_ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (
    publish_starts_on is null
    or publish_ends_on is null
    or publish_ends_on >= publish_starts_on
  ),
  unique (academic_year_id, name)
);

-- ---------------------------------------------------------------------------
-- Formal assessments
-- ---------------------------------------------------------------------------

create table academic_assessments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  academic_year_id uuid not null references academic_years (id),
  reporting_period_id uuid references academic_reporting_periods (id),
  title text not null,
  subject_id uuid not null references subjects (id),
  year_group_id uuid not null references year_groups (id),
  assessment_type_id uuid not null references academic_assessment_types (id),
  assessment_date date not null,
  due_on date,
  maximum_marks numeric(8, 2),
  weighting numeric(6, 3),
  grade_scheme_id uuid references academic_grade_schemes (id),
  status text not null default 'draft'
    check (status in ('draft', 'open', 'completed', 'reviewed', 'published', 'archived')),
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  opened_at timestamptz,
  opened_by uuid references users (id),
  completed_at timestamptz,
  completed_by uuid references users (id),
  reviewed_at timestamptz,
  reviewed_by uuid references users (id),
  published_at timestamptz,
  published_by uuid references users (id),
  archived_at timestamptz,
  archived_by uuid references users (id),
  internal_notes text,
  source_learning_assignment_id uuid references learning_assignments (id) on delete set null,
  check (maximum_marks is null or maximum_marks > 0),
  check (weighting is null or (weighting >= 0 and weighting <= 100)),
  check (due_on is null or due_on >= assessment_date)
);

create table academic_assessment_status_history (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  assessment_id uuid not null references academic_assessments (id) on delete cascade,
  previous_status text,
  new_status text not null,
  actor_user_id uuid references users (id),
  created_at timestamptz not null default now()
);

create table academic_assessment_classes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  assessment_id uuid not null references academic_assessments (id) on delete cascade,
  class_id uuid not null references classes (id),
  unique (assessment_id, class_id)
);

-- Snapshot of pupils included when the assessment is opened (and later additions).
create table academic_assessment_inclusions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  assessment_id uuid not null references academic_assessments (id) on delete cascade,
  student_profile_id uuid not null references student_profiles (id),
  class_id uuid references classes (id),
  included_at timestamptz not null default now(),
  unique (assessment_id, student_profile_id)
);

-- ---------------------------------------------------------------------------
-- Formal results (not learning_marks)
-- ---------------------------------------------------------------------------

create table academic_results (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  assessment_id uuid not null references academic_assessments (id) on delete cascade,
  student_profile_id uuid not null references student_profiles (id),
  raw_score numeric(8, 2),
  maximum_score numeric(8, 2),
  percentage numeric(6, 2)
    generated always as (
      case
        when raw_score is not null and maximum_score is not null and maximum_score > 0
          then round((raw_score / maximum_score) * 100, 2)
        else null
      end
    ) stored,
  grade_scheme_level_id uuid references academic_grade_scheme_levels (id),
  teacher_judgement text,
  comment text,
  review_status text not null default 'entered'
    check (review_status in ('entered', 'reviewed', 'approved')),
  internal_review_note text,
  released_to_student boolean not null default false,
  released_to_parent boolean not null default false,
  entered_by uuid not null references users (id),
  entered_at timestamptz not null default now(),
  amended_by uuid references users (id),
  amended_at timestamptz,
  reviewed_by uuid references users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_profile_id),
  check (raw_score is null or raw_score >= 0),
  check (maximum_score is null or maximum_score > 0),
  check (raw_score is null or maximum_score is null or raw_score <= maximum_score)
);

create table academic_result_revisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  result_id uuid not null references academic_results (id) on delete cascade,
  raw_score numeric(8, 2),
  maximum_score numeric(8, 2),
  grade_scheme_level_id uuid,
  teacher_judgement text,
  comment text,
  review_status text not null,
  released_to_student boolean not null,
  released_to_parent boolean not null,
  changed_by uuid not null references users (id),
  changed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Academic targets
-- ---------------------------------------------------------------------------

create table academic_targets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  academic_year_id uuid not null references academic_years (id),
  subject_id uuid not null references subjects (id),
  grade_scheme_id uuid references academic_grade_schemes (id),
  target_level_id uuid references academic_grade_scheme_levels (id),
  target_value text,
  baseline_level_id uuid references academic_grade_scheme_levels (id),
  baseline_value text,
  note text,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  amended_by uuid references users (id),
  amended_at timestamptz,
  unique (student_profile_id, academic_year_id, subject_id)
);

-- ---------------------------------------------------------------------------
-- Progress reports
-- ---------------------------------------------------------------------------

create table academic_reports (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  academic_year_id uuid not null references academic_years (id),
  reporting_period_id uuid not null references academic_reporting_periods (id),
  status text not null default 'draft'
    check (status in ('draft', 'submitted_for_review', 'approved', 'published', 'archived')),
  general_comment text,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  submitted_by uuid references users (id),
  reviewed_at timestamptz,
  reviewed_by uuid references users (id),
  published_at timestamptz,
  published_by uuid references users (id),
  archived_at timestamptz,
  archived_by uuid references users (id),
  unique (student_profile_id, reporting_period_id)
);

create table academic_report_sections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  report_id uuid not null references academic_reports (id) on delete cascade,
  subject_id uuid not null references subjects (id),
  teacher_user_id uuid references users (id),
  attainment_summary text,
  progress_judgement text,
  teacher_comment text,
  target_next_steps text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, subject_id)
);

create table academic_report_status_history (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  report_id uuid not null references academic_reports (id) on delete cascade,
  previous_status text,
  new_status text not null,
  actor_user_id uuid references users (id),
  created_at timestamptz not null default now()
);

-- Frozen published content. Later working-copy edits do not change this row.
create table academic_report_publications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  report_id uuid not null references academic_reports (id) on delete cascade,
  payload jsonb not null,
  published_by uuid not null references users (id),
  published_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

select install_tenant_isolation('academic_assessment_types');
select install_tenant_isolation('academic_grade_schemes');
select install_tenant_isolation('academic_grade_scheme_levels');
select install_tenant_isolation('academic_reporting_periods');
select install_tenant_isolation('academic_assessments');
select install_tenant_isolation('academic_assessment_status_history');
select install_tenant_isolation('academic_assessment_classes');
select install_tenant_isolation('academic_assessment_inclusions');
select install_tenant_isolation('academic_results');
select install_tenant_isolation('academic_result_revisions');
select install_tenant_isolation('academic_targets');
select install_tenant_isolation('academic_reports');
select install_tenant_isolation('academic_report_sections');
select install_tenant_isolation('academic_report_status_history');
select install_tenant_isolation('academic_report_publications');

grant select, insert, update, delete on academic_assessment_types to schoolapp_app;
grant select, insert, update, delete on academic_grade_schemes to schoolapp_app;
grant select, insert, update, delete on academic_grade_scheme_levels to schoolapp_app;
grant select, insert, update, delete on academic_reporting_periods to schoolapp_app;
grant select, insert, update, delete on academic_assessments to schoolapp_app;
grant select, insert on academic_assessment_status_history to schoolapp_app;
revoke update, delete on academic_assessment_status_history from schoolapp_app;
grant select, insert, update, delete on academic_assessment_classes to schoolapp_app;
grant select, insert on academic_assessment_inclusions to schoolapp_app;
revoke update, delete on academic_assessment_inclusions from schoolapp_app;
grant select, insert, update on academic_results to schoolapp_app;
revoke delete on academic_results from schoolapp_app;
grant select, insert on academic_result_revisions to schoolapp_app;
revoke update, delete on academic_result_revisions from schoolapp_app;
grant select, insert, update on academic_targets to schoolapp_app;
revoke delete on academic_targets from schoolapp_app;
grant select, insert, update on academic_reports to schoolapp_app;
revoke delete on academic_reports from schoolapp_app;
grant select, insert, update, delete on academic_report_sections to schoolapp_app;
grant select, insert on academic_report_status_history to schoolapp_app;
revoke update, delete on academic_report_status_history from schoolapp_app;
grant select, insert on academic_report_publications to schoolapp_app;
revoke update, delete on academic_report_publications from schoolapp_app;

drop trigger if exists academic_reporting_periods_updated_at on academic_reporting_periods;
create trigger academic_reporting_periods_updated_at before update on academic_reporting_periods
  for each row execute function set_updated_at();

drop trigger if exists academic_assessments_updated_at on academic_assessments;
create trigger academic_assessments_updated_at before update on academic_assessments
  for each row execute function set_updated_at();

drop trigger if exists academic_results_updated_at on academic_results;
create trigger academic_results_updated_at before update on academic_results
  for each row execute function set_updated_at();

drop trigger if exists academic_targets_updated_at on academic_targets;
create trigger academic_targets_updated_at before update on academic_targets
  for each row execute function set_updated_at();

drop trigger if exists academic_reports_updated_at on academic_reports;
create trigger academic_reports_updated_at before update on academic_reports
  for each row execute function set_updated_at();

drop trigger if exists academic_report_sections_updated_at on academic_report_sections;
create trigger academic_report_sections_updated_at before update on academic_report_sections
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Same-organisation integrity
-- ---------------------------------------------------------------------------

create or replace function academic_grade_schemes_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if new.subject_id is not null and not exists (
    select 1 from subjects s
    where s.id = new.subject_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.year_group_id is not null and not exists (
    select 1 from year_groups g
    where g.id = new.year_group_id and g.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists academic_grade_schemes_same_org_tg on academic_grade_schemes;
create trigger academic_grade_schemes_same_org_tg
  before insert or update on academic_grade_schemes
  for each row execute function academic_grade_schemes_same_org_tg();

create or replace function academic_grade_scheme_levels_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from academic_grade_schemes s
    where s.id = new.scheme_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists academic_grade_scheme_levels_same_org_tg on academic_grade_scheme_levels;
create trigger academic_grade_scheme_levels_same_org_tg
  before insert or update on academic_grade_scheme_levels
  for each row execute function academic_grade_scheme_levels_same_org_tg();

create or replace function academic_reporting_periods_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from academic_years y
    where y.id = new.academic_year_id and y.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.term_id is not null and not exists (
    select 1 from terms t
    where t.id = new.term_id
      and t.organisation_id = new.organisation_id
      and t.academic_year_id = new.academic_year_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists academic_reporting_periods_same_org_tg on academic_reporting_periods;
create trigger academic_reporting_periods_same_org_tg
  before insert or update on academic_reporting_periods
  for each row execute function academic_reporting_periods_same_org_tg();

create or replace function academic_assessments_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from academic_years y
    where y.id = new.academic_year_id and y.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from subjects s
    where s.id = new.subject_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from year_groups g
    where g.id = new.year_group_id and g.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from academic_assessment_types t
    where t.id = new.assessment_type_id and t.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.reporting_period_id is not null and not exists (
    select 1 from academic_reporting_periods p
    where p.id = new.reporting_period_id
      and p.organisation_id = new.organisation_id
      and p.academic_year_id = new.academic_year_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.grade_scheme_id is not null and not exists (
    select 1 from academic_grade_schemes s
    where s.id = new.grade_scheme_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.source_learning_assignment_id is not null and not exists (
    select 1 from learning_assignments a
    where a.id = new.source_learning_assignment_id
      and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists academic_assessments_same_org_tg on academic_assessments;
create trigger academic_assessments_same_org_tg
  before insert or update on academic_assessments
  for each row execute function academic_assessments_same_org_tg();

create or replace function academic_assessment_classes_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from academic_assessments a
    where a.id = new.assessment_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from classes c
    join academic_assessments a on a.id = new.assessment_id
    where c.id = new.class_id
      and c.organisation_id = new.organisation_id
      and c.academic_year_id = a.academic_year_id
      and c.year_group_id = a.year_group_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists academic_assessment_classes_same_org_tg on academic_assessment_classes;
create trigger academic_assessment_classes_same_org_tg
  before insert or update on academic_assessment_classes
  for each row execute function academic_assessment_classes_same_org_tg();

create or replace function academic_assessment_inclusions_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from academic_assessments a
    where a.id = new.assessment_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from student_profiles s
    where s.id = new.student_profile_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.class_id is not null and not exists (
    select 1 from classes c
    where c.id = new.class_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists academic_assessment_inclusions_same_org_tg on academic_assessment_inclusions;
create trigger academic_assessment_inclusions_same_org_tg
  before insert or update on academic_assessment_inclusions
  for each row execute function academic_assessment_inclusions_same_org_tg();

create or replace function academic_results_same_org_tg()
returns trigger
language plpgsql
as $$
declare
  v_max numeric(8, 2);
  v_scheme uuid;
begin
  if not exists (
    select 1 from academic_assessments a
    where a.id = new.assessment_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from student_profiles s
    where s.id = new.student_profile_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from academic_assessment_inclusions i
    where i.assessment_id = new.assessment_id
      and i.student_profile_id = new.student_profile_id
      and i.organisation_id = new.organisation_id
  ) then
    raise exception 'assessment_pupil_not_included' using errcode = '23514';
  end if;
  select a.maximum_marks, a.grade_scheme_id into v_max, v_scheme
  from academic_assessments a
  where a.id = new.assessment_id;
  if new.maximum_score is null then
    new.maximum_score := v_max;
  end if;
  if v_max is not null and new.maximum_score is not null and new.maximum_score > v_max then
    raise exception 'academic_score_out_of_range' using errcode = '23514';
  end if;
  if new.raw_score is not null and new.maximum_score is not null and new.raw_score > new.maximum_score then
    raise exception 'academic_score_out_of_range' using errcode = '23514';
  end if;
  if new.grade_scheme_level_id is not null then
    if v_scheme is null or not exists (
      select 1 from academic_grade_scheme_levels l
      where l.id = new.grade_scheme_level_id
        and l.scheme_id = v_scheme
        and l.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists academic_results_same_org_tg on academic_results;
create trigger academic_results_same_org_tg
  before insert or update on academic_results
  for each row execute function academic_results_same_org_tg();

create or replace function academic_result_revisions_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from academic_results r
    where r.id = new.result_id and r.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists academic_result_revisions_same_org_tg on academic_result_revisions;
create trigger academic_result_revisions_same_org_tg
  before insert on academic_result_revisions
  for each row execute function academic_result_revisions_same_org_tg();

create or replace function academic_targets_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from student_profiles s
    where s.id = new.student_profile_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from academic_years y
    where y.id = new.academic_year_id and y.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from subjects s
    where s.id = new.subject_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.grade_scheme_id is not null and not exists (
    select 1 from academic_grade_schemes s
    where s.id = new.grade_scheme_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.target_level_id is not null and not exists (
    select 1 from academic_grade_scheme_levels l
    where l.id = new.target_level_id
      and l.organisation_id = new.organisation_id
      and (new.grade_scheme_id is null or l.scheme_id = new.grade_scheme_id)
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.baseline_level_id is not null and not exists (
    select 1 from academic_grade_scheme_levels l
    where l.id = new.baseline_level_id
      and l.organisation_id = new.organisation_id
      and (new.grade_scheme_id is null or l.scheme_id = new.grade_scheme_id)
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists academic_targets_same_org_tg on academic_targets;
create trigger academic_targets_same_org_tg
  before insert or update on academic_targets
  for each row execute function academic_targets_same_org_tg();

create or replace function academic_reports_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from student_profiles s
    where s.id = new.student_profile_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from academic_years y
    where y.id = new.academic_year_id and y.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from academic_reporting_periods p
    where p.id = new.reporting_period_id
      and p.organisation_id = new.organisation_id
      and p.academic_year_id = new.academic_year_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists academic_reports_same_org_tg on academic_reports;
create trigger academic_reports_same_org_tg
  before insert or update on academic_reports
  for each row execute function academic_reports_same_org_tg();

create or replace function academic_report_sections_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from academic_reports r
    where r.id = new.report_id and r.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from subjects s
    where s.id = new.subject_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists academic_report_sections_same_org_tg on academic_report_sections;
create trigger academic_report_sections_same_org_tg
  before insert or update on academic_report_sections
  for each row execute function academic_report_sections_same_org_tg();

-- ---------------------------------------------------------------------------
-- Status machines, immutable identity, actor stamps
-- ---------------------------------------------------------------------------

create or replace function academic_assessment_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select
    p_from = p_to
    or (p_from = 'draft' and p_to in ('open', 'archived'))
    or (p_from = 'open' and p_to in ('completed', 'archived'))
    or (p_from = 'completed' and p_to in ('reviewed', 'published', 'open'))
    or (p_from = 'reviewed' and p_to in ('published', 'completed'))
    or (p_from = 'published' and p_to in ('archived'))
    or (p_from = 'archived' and p_to in ('published'));
$$;

create or replace function academic_report_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select
    p_from = p_to
    or (p_from = 'draft' and p_to in ('submitted_for_review', 'published', 'archived'))
    or (p_from = 'submitted_for_review' and p_to in ('approved', 'draft'))
    or (p_from = 'approved' and p_to in ('published', 'draft'))
    or (p_from = 'published' and p_to in ('archived'))
    or (p_from = 'archived' and p_to in ('published'));
$$;

create or replace function academic_assessments_write_tg()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
begin
  v_actor := app_current_user_id();
  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
    if new.created_by is null then
      raise exception 'academic_actor_required' using errcode = '22023';
    end if;
    new.opened_at := null;
    new.opened_by := null;
    new.completed_at := null;
    new.completed_by := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.published_at := null;
    new.published_by := null;
    new.archived_at := null;
    new.archived_by := null;
    return new;
  end if;

  new.id := old.id;
  new.organisation_id := old.organisation_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if not academic_assessment_status_allowed(old.status, new.status) then
    raise exception 'invalid_status_transition' using errcode = '23514';
  end if;

  if old.status is distinct from new.status then
    if new.status = 'open' then
      new.opened_at := coalesce(old.opened_at, now());
      new.opened_by := coalesce(v_actor, old.opened_by, new.opened_by);
    elsif new.status = 'completed' then
      new.completed_at := now();
      new.completed_by := coalesce(v_actor, new.completed_by);
    elsif new.status = 'reviewed' then
      new.reviewed_at := now();
      new.reviewed_by := coalesce(v_actor, new.reviewed_by);
    elsif new.status = 'published' then
      new.published_at := coalesce(old.published_at, now());
      new.published_by := coalesce(v_actor, old.published_by, new.published_by);
    elsif new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := coalesce(v_actor, new.archived_by);
    end if;
  else
    new.opened_at := old.opened_at;
    new.opened_by := old.opened_by;
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
    new.published_at := old.published_at;
    new.published_by := old.published_by;
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;

  return new;
end;
$$;

drop trigger if exists academic_assessments_write_tg on academic_assessments;
create trigger academic_assessments_write_tg
  before insert or update on academic_assessments
  for each row execute function academic_assessments_write_tg();

create or replace function academic_assessments_history_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into academic_assessment_status_history (
      organisation_id, assessment_id, previous_status, new_status, actor_user_id
    ) values (
      new.organisation_id,
      new.id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      coalesce(
        app_current_user_id(),
        new.published_by,
        new.reviewed_by,
        new.completed_by,
        new.opened_by,
        new.archived_by,
        new.created_by
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists academic_assessments_history_tg on academic_assessments;
create trigger academic_assessments_history_tg
  after insert or update on academic_assessments
  for each row execute function academic_assessments_history_tg();

create or replace function academic_results_write_tg()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
begin
  v_actor := app_current_user_id();
  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.entered_by := v_actor;
      new.entered_at := now();
    end if;
    if new.entered_by is null then
      raise exception 'academic_result_actor_required' using errcode = '22023';
    end if;
    new.entered_at := coalesce(new.entered_at, now());
    new.amended_by := null;
    new.amended_at := null;
    if new.review_status is distinct from 'entered' and new.review_status is distinct from 'reviewed' and new.review_status is distinct from 'approved' then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
    return new;
  end if;

  new.id := old.id;
  new.organisation_id := old.organisation_id;
  new.assessment_id := old.assessment_id;
  new.student_profile_id := old.student_profile_id;
  new.entered_by := old.entered_by;
  new.entered_at := old.entered_at;
  new.created_at := old.created_at;

  if v_actor is not null then
    if (
      new.raw_score is distinct from old.raw_score
      or new.maximum_score is distinct from old.maximum_score
      or new.grade_scheme_level_id is distinct from old.grade_scheme_level_id
      or new.teacher_judgement is distinct from old.teacher_judgement
      or new.comment is distinct from old.comment
      or new.review_status is distinct from old.review_status
      or new.released_to_student is distinct from old.released_to_student
      or new.released_to_parent is distinct from old.released_to_parent
      or new.internal_review_note is distinct from old.internal_review_note
    ) then
      new.amended_by := v_actor;
      new.amended_at := now();
    else
      new.amended_by := old.amended_by;
      new.amended_at := old.amended_at;
    end if;
    if new.review_status is distinct from old.review_status and new.review_status in ('reviewed', 'approved') then
      new.reviewed_by := v_actor;
      new.reviewed_at := now();
    elsif new.review_status is not distinct from old.review_status then
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
    end if;
  else
    new.amended_by := coalesce(new.amended_by, old.amended_by);
    new.amended_at := coalesce(new.amended_at, old.amended_at);
  end if;

  return new;
end;
$$;

drop trigger if exists academic_results_write_tg on academic_results;
create trigger academic_results_write_tg
  before insert or update on academic_results
  for each row execute function academic_results_write_tg();

create or replace function academic_results_revision_tg()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
begin
  if tg_op = 'UPDATE' and (
    new.raw_score is distinct from old.raw_score
    or new.maximum_score is distinct from old.maximum_score
    or new.grade_scheme_level_id is distinct from old.grade_scheme_level_id
    or new.teacher_judgement is distinct from old.teacher_judgement
    or new.comment is distinct from old.comment
    or new.review_status is distinct from old.review_status
    or new.released_to_student is distinct from old.released_to_student
    or new.released_to_parent is distinct from old.released_to_parent
  ) then
    v_actor := coalesce(app_current_user_id(), new.amended_by, old.entered_by);
    if v_actor is null then
      raise exception 'academic_result_actor_required' using errcode = '22023';
    end if;
    insert into academic_result_revisions (
      organisation_id, result_id, raw_score, maximum_score, grade_scheme_level_id,
      teacher_judgement, comment, review_status, released_to_student, released_to_parent,
      changed_by
    ) values (
      old.organisation_id, old.id, old.raw_score, old.maximum_score, old.grade_scheme_level_id,
      old.teacher_judgement, old.comment, old.review_status, old.released_to_student,
      old.released_to_parent, v_actor
    );
  end if;
  return new;
end;
$$;

drop trigger if exists academic_results_revision_tg on academic_results;
create trigger academic_results_revision_tg
  after update on academic_results
  for each row execute function academic_results_revision_tg();

create or replace function academic_targets_write_tg()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
begin
  v_actor := app_current_user_id();
  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
    if new.created_by is null then
      raise exception 'academic_actor_required' using errcode = '22023';
    end if;
    return new;
  end if;
  new.id := old.id;
  new.organisation_id := old.organisation_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if v_actor is not null then
    new.amended_by := v_actor;
    new.amended_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists academic_targets_write_tg on academic_targets;
create trigger academic_targets_write_tg
  before insert or update on academic_targets
  for each row execute function academic_targets_write_tg();

create or replace function academic_reports_write_tg()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
begin
  v_actor := app_current_user_id();
  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
    if new.created_by is null then
      raise exception 'academic_actor_required' using errcode = '22023';
    end if;
    new.submitted_at := null;
    new.submitted_by := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.published_at := null;
    new.published_by := null;
    new.archived_at := null;
    new.archived_by := null;
    return new;
  end if;

  new.id := old.id;
  new.organisation_id := old.organisation_id;
  new.student_profile_id := old.student_profile_id;
  new.academic_year_id := old.academic_year_id;
  new.reporting_period_id := old.reporting_period_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if not academic_report_status_allowed(old.status, new.status) then
    raise exception 'invalid_status_transition' using errcode = '23514';
  end if;

  if old.status is distinct from new.status then
    if new.status = 'submitted_for_review' then
      new.submitted_at := now();
      new.submitted_by := coalesce(v_actor, new.submitted_by);
    elsif new.status = 'approved' then
      new.reviewed_at := now();
      new.reviewed_by := coalesce(v_actor, new.reviewed_by);
    elsif new.status = 'published' then
      new.published_at := coalesce(old.published_at, now());
      new.published_by := coalesce(v_actor, old.published_by, new.published_by);
    elsif new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := coalesce(v_actor, new.archived_by);
    elsif new.status = 'draft' then
      new.submitted_at := old.submitted_at;
      new.submitted_by := old.submitted_by;
    end if;
  else
    new.submitted_at := old.submitted_at;
    new.submitted_by := old.submitted_by;
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
    new.published_at := old.published_at;
    new.published_by := old.published_by;
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;

  return new;
end;
$$;

drop trigger if exists academic_reports_write_tg on academic_reports;
create trigger academic_reports_write_tg
  before insert or update on academic_reports
  for each row execute function academic_reports_write_tg();

create or replace function academic_reports_history_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into academic_report_status_history (
      organisation_id, report_id, previous_status, new_status, actor_user_id
    ) values (
      new.organisation_id,
      new.id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      coalesce(
        app_current_user_id(),
        new.published_by,
        new.reviewed_by,
        new.submitted_by,
        new.archived_by,
        new.created_by
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists academic_reports_history_tg on academic_reports;
create trigger academic_reports_history_tg
  after insert or update on academic_reports
  for each row execute function academic_reports_history_tg();

create or replace function academic_report_sections_write_tg()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.organisation_id := old.organisation_id;
    new.report_id := old.report_id;
  end if;
  select status into v_status from academic_reports where id = new.report_id;
  if v_status in ('published', 'archived') then
    raise exception 'academic_report_locked' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists academic_report_sections_write_tg on academic_report_sections;
create trigger academic_report_sections_write_tg
  before insert or update or delete on academic_report_sections
  for each row execute function academic_report_sections_write_tg();

-- DELETE trigger needs OLD; rewrite as two functions is cleaner, but we handle both:
create or replace function academic_report_sections_lock_tg()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_report uuid;
begin
  v_report := case when tg_op = 'DELETE' then old.report_id else new.report_id end;
  select status into v_status from academic_reports where id = v_report;
  if v_status in ('published', 'archived') then
    raise exception 'academic_report_locked' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.organisation_id := old.organisation_id;
    new.report_id := old.report_id;
  end if;
  return new;
end;
$$;

drop trigger if exists academic_report_sections_write_tg on academic_report_sections;
drop trigger if exists academic_report_sections_lock_tg on academic_report_sections;
create trigger academic_report_sections_lock_tg
  before insert or update or delete on academic_report_sections
  for each row execute function academic_report_sections_lock_tg();

create or replace function academic_reports_lock_content_tg()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('published', 'archived') and new.status is not distinct from old.status then
    if new.general_comment is distinct from old.general_comment then
      raise exception 'academic_report_locked' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists academic_reports_lock_content_tg on academic_reports;
create trigger academic_reports_lock_content_tg
  before update on academic_reports
  for each row execute function academic_reports_lock_content_tg();

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: snapshot inclusions + org defaults
-- ---------------------------------------------------------------------------

create or replace function snapshot_academic_assessment_inclusions(p_assessment_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_year uuid;
  v_group uuid;
  v_count integer := 0;
begin
  select organisation_id, academic_year_id, year_group_id
    into v_org, v_year, v_group
  from academic_assessments
  where id = p_assessment_id;

  if v_org is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if nullif(current_setting('app.organisation_id', true), '') is not null
     and app_current_organisation_id() is distinct from v_org
     and not app_is_platform_admin() then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;

  insert into academic_assessment_inclusions (
    organisation_id, assessment_id, student_profile_id, class_id
  )
  select distinct
    v_org,
    p_assessment_id,
    cm.student_profile_id,
    cm.class_id
  from academic_assessment_classes ac
  join class_memberships cm
    on cm.class_id = ac.class_id
   and cm.organisation_id = v_org
   and cm.academic_year_id = v_year
   and (cm.ended_on is null or cm.ended_on >= current_date)
  where ac.assessment_id = p_assessment_id
    and ac.organisation_id = v_org
  on conflict (assessment_id, student_profile_id) do nothing;

  get diagnostics v_count = row_count;

  if not exists (
    select 1 from academic_assessment_classes
    where assessment_id = p_assessment_id
  ) then
    insert into academic_assessment_inclusions (
      organisation_id, assessment_id, student_profile_id, class_id
    )
    select distinct
      v_org,
      p_assessment_id,
      se.student_profile_id,
      form.class_id
    from student_enrolments se
    left join lateral (
      select cm.class_id
      from class_memberships cm
      join classes c on c.id = cm.class_id
      where cm.student_profile_id = se.student_profile_id
        and cm.organisation_id = v_org
        and cm.academic_year_id = v_year
        and (cm.ended_on is null or cm.ended_on >= current_date)
        and c.class_type = 'form'
      limit 1
    ) form on true
    where se.organisation_id = v_org
      and se.academic_year_id = v_year
      and se.year_group_id = v_group
      and se.is_primary
      and se.ended_on is null
      and se.status = 'enrolled'
    on conflict (assessment_id, student_profile_id) do nothing;
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end;
$$;

revoke all on function snapshot_academic_assessment_inclusions(uuid) from public;
grant execute on function snapshot_academic_assessment_inclusions(uuid) to schoolapp_app;

create or replace function ensure_organisation_phase8_defaults(p_organisation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_scheme uuid;
begin
  if p_organisation_id is null then
    return;
  end if;
  if nullif(current_setting('app.organisation_id', true), '') is not null
     and app_current_organisation_id() is distinct from p_organisation_id
     and not app_is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into academic_assessment_types (organisation_id, key, name, sort_order, is_system)
  values
    (p_organisation_id, 'class_test', 'Class test', 1, true),
    (p_organisation_id, 'end_of_unit', 'End-of-unit assessment', 2, true),
    (p_organisation_id, 'mock_exam', 'Mock exam', 3, true),
    (p_organisation_id, 'eleven_plus_practice', '11+ practice', 4, true),
    (p_organisation_id, 'spelling_test', 'Spelling test', 5, true),
    (p_organisation_id, 'reading_assessment', 'Reading assessment', 6, true),
    (p_organisation_id, 'teacher_assessment', 'Teacher assessment', 7, true),
    (p_organisation_id, 'practical_assessment', 'Practical assessment', 8, true),
    (p_organisation_id, 'baseline_assessment', 'Baseline assessment', 9, true)
  on conflict (organisation_id, key) do nothing;

  insert into academic_grade_schemes (organisation_id, key, name, scheme_kind, is_numeric, is_system)
  values
    (p_organisation_id, 'percentage', 'Percentage', 'percentage', true, true),
    (p_organisation_id, 'letter_grades', 'Letter grades', 'letter', false, true),
    (p_organisation_id, 'numeric_1_9', 'Numeric 1–9', 'numeric', true, true),
    (p_organisation_id, 'age_related', 'Age-related expectations', 'age_related', false, true)
  on conflict (organisation_id, key) do nothing;

  select id into v_scheme
  from academic_grade_schemes
  where organisation_id = p_organisation_id and key = 'letter_grades';
  if v_scheme is not null then
    insert into academic_grade_scheme_levels (organisation_id, scheme_id, code, label, sort_order, numeric_value)
    values
      (p_organisation_id, v_scheme, 'A_STAR', 'A*', 1, 8),
      (p_organisation_id, v_scheme, 'A', 'A', 2, 7),
      (p_organisation_id, v_scheme, 'B', 'B', 3, 6),
      (p_organisation_id, v_scheme, 'C', 'C', 4, 5),
      (p_organisation_id, v_scheme, 'D', 'D', 5, 4),
      (p_organisation_id, v_scheme, 'E', 'E', 6, 3),
      (p_organisation_id, v_scheme, 'U', 'U', 7, 0)
    on conflict (scheme_id, code) do nothing;
  end if;

  select id into v_scheme
  from academic_grade_schemes
  where organisation_id = p_organisation_id and key = 'numeric_1_9';
  if v_scheme is not null then
    insert into academic_grade_scheme_levels (organisation_id, scheme_id, code, label, sort_order, numeric_value)
    values
      (p_organisation_id, v_scheme, '9', '9', 1, 9),
      (p_organisation_id, v_scheme, '8', '8', 2, 8),
      (p_organisation_id, v_scheme, '7', '7', 3, 7),
      (p_organisation_id, v_scheme, '6', '6', 4, 6),
      (p_organisation_id, v_scheme, '5', '5', 5, 5),
      (p_organisation_id, v_scheme, '4', '4', 6, 4),
      (p_organisation_id, v_scheme, '3', '3', 7, 3),
      (p_organisation_id, v_scheme, '2', '2', 8, 2),
      (p_organisation_id, v_scheme, '1', '1', 9, 1)
    on conflict (scheme_id, code) do nothing;
  end if;

  select id into v_scheme
  from academic_grade_schemes
  where organisation_id = p_organisation_id and key = 'age_related';
  if v_scheme is not null then
    insert into academic_grade_scheme_levels (organisation_id, scheme_id, code, label, sort_order, numeric_value)
    values
      (p_organisation_id, v_scheme, 'WB', 'Working Below', 1, 1),
      (p_organisation_id, v_scheme, 'WT', 'Working Towards', 2, 2),
      (p_organisation_id, v_scheme, 'EX', 'Expected', 3, 3),
      (p_organisation_id, v_scheme, 'GD', 'Greater Depth', 4, 4)
    on conflict (scheme_id, code) do nothing;
  end if;
end;
$$;

revoke all on function ensure_organisation_phase8_defaults(uuid) from public;
grant execute on function ensure_organisation_phase8_defaults(uuid) to schoolapp_app;

create or replace function organisations_phase8_defaults_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform ensure_organisation_phase8_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists organisations_phase8_defaults_tg on organisations;
create trigger organisations_phase8_defaults_tg
  after insert on organisations
  for each row execute function organisations_phase8_defaults_tg();

select ensure_organisation_phase8_defaults(id) from organisations;
