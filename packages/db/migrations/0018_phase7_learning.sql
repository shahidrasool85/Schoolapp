-- Phase 7: Teaching & Learning / LMS core.
-- Additive. Does not weaken FORCE RLS, tenant context, hostname tenancy,
-- membership revalidation, teacher assigned-only access, guardianship /
-- portal_access, student self-only access, student portal policy, current
-- primary-enrolment checks, break-glass, or audit controls.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('lms.assignments.read', 'School-wide learning work read / oversight'),
  ('lms.assignments.read_assigned', 'Read learning work for assigned classes and pupils'),
  ('lms.assignments.read_own_children', 'Parent: read authorised children''s learning work'),
  ('lms.assignments.read_self', 'Student: read own assigned learning work'),
  ('lms.submissions.read', 'School-wide learning submissions read'),
  ('lms.submissions.read_assigned', 'Read submissions for assigned classes and pupils'),
  ('lms.submissions.mark', 'School-wide marking and feedback'),
  ('lms.submissions.mark_assigned', 'Mark submissions for assigned classes and pupils'),
  ('lms.submissions.read_self', 'Student: read own submissions'),
  ('lms.submissions.read_own_children', 'Parent: read authorised children''s submission status'),
  ('lms.resources.manage', 'School-wide learning resource management'),
  ('lms.resources.manage_assigned', 'Manage resources on assigned learning work')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'lms.assignments.read'),
    ('school.admin', 'lms.assignments.manage'),
    ('school.admin', 'lms.submissions.read'),
    ('school.admin', 'lms.submissions.mark'),
    ('school.admin', 'lms.resources.read'),
    ('school.admin', 'lms.resources.manage'),
    ('school.headteacher', 'lms.assignments.read'),
    ('school.headteacher', 'lms.submissions.read'),
    ('school.headteacher', 'lms.submissions.mark'),
    ('school.headteacher', 'lms.resources.manage'),
    ('school.teacher', 'lms.assignments.read_assigned'),
    ('school.teacher', 'lms.submissions.read_assigned'),
    ('school.teacher', 'lms.submissions.mark_assigned'),
    ('school.teacher', 'lms.resources.manage_assigned'),
    ('school.parent', 'lms.assignments.read_own_children'),
    ('school.parent', 'lms.submissions.read_own_children'),
    ('school.student', 'lms.assignments.read_self'),
    ('school.student', 'lms.submissions.read_self')
) as x(role_key, perm)
  on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Notification types + idempotency
-- ---------------------------------------------------------------------------

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'homework_assigned',
    'homework_due',
    'result_published',
    'teacher_feedback',
    'school_announcement',
    'attendance_concern',
    'competition_challenge',
    'report_available',
    'admissions_update',
    'learning_assigned',
    'learning_due',
    'learning_feedback',
    'learning_resubmission',
    'general'
  ));

alter table notifications
  add column if not exists idempotency_key text;

create unique index if not exists notifications_idempotency_uq
  on notifications (organisation_id, recipient_user_id, idempotency_key)
  where idempotency_key is not null;

drop function if exists create_inbox_notification(uuid, uuid, uuid, text, text, text, text, jsonb);

create function create_inbox_notification(
  p_organisation_id uuid,
  p_recipient_user_id uuid,
  p_actor_user_id uuid,
  p_type text,
  p_category text,
  p_title text,
  p_body text,
  p_action_target jsonb,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_actor uuid;
begin
  if p_organisation_id is distinct from app_current_organisation_id()
     and not (
       app_is_platform_admin()
       and app_current_organisation_id() is null
     ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;

  v_actor := app_current_user_id();
  if v_actor is not null then
    p_actor_user_id := v_actor;
    if not app_is_platform_admin() and not exists (
      select 1 from organisation_memberships m
      where m.organisation_id = p_organisation_id
        and m.user_id = v_actor
        and m.status = 'active'
        and m.ended_at is null
    ) then
      raise exception 'tenant_context_membership_required' using errcode = '42501';
    end if;
  end if;

  if p_recipient_user_id is null or char_length(trim(p_title)) < 1 or char_length(trim(p_body)) < 1 then
    return null;
  end if;
  if not exists (
    select 1 from organisation_memberships m
    where m.organisation_id = p_organisation_id
      and m.user_id = p_recipient_user_id
      and m.status in ('active', 'invited')
      and m.ended_at is null
  ) then
    return null;
  end if;

  if p_idempotency_key is not null then
    insert into notifications (
      organisation_id, recipient_user_id, type, category, title, body, action_target, created_by, idempotency_key
    ) values (
      p_organisation_id,
      p_recipient_user_id,
      coalesce(p_type, 'general'),
      coalesce(p_category, 'general'),
      left(trim(p_title), 200),
      left(trim(p_body), 500),
      p_action_target,
      p_actor_user_id,
      p_idempotency_key
    )
    on conflict (organisation_id, recipient_user_id, idempotency_key)
      where idempotency_key is not null
    do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id
      from notifications
      where organisation_id = p_organisation_id
        and recipient_user_id = p_recipient_user_id
        and idempotency_key = p_idempotency_key;
    end if;
    return v_id;
  end if;

  insert into notifications (
    organisation_id, recipient_user_id, type, category, title, body, action_target, created_by
  ) values (
    p_organisation_id,
    p_recipient_user_id,
    coalesce(p_type, 'general'),
    coalesce(p_category, 'general'),
    left(trim(p_title), 200),
    left(trim(p_body), 500),
    p_action_target,
    p_actor_user_id
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function create_inbox_notification(
  uuid, uuid, uuid, text, text, text, text, jsonb, text
) from public;
grant execute on function create_inbox_notification(
  uuid, uuid, uuid, text, text, text, text, jsonb, text
) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Work types
-- ---------------------------------------------------------------------------

create table learning_work_types (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null
    check (key in (
      'homework',
      'classwork',
      'revision',
      'project',
      'reading',
      'practice',
      'assessment_preparation'
    ) or key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order int not null default 0,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organisation_id, key)
);

-- ---------------------------------------------------------------------------
-- Assignments (canonical learning work — no single class_id)
-- ---------------------------------------------------------------------------

create table learning_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 20000),
  work_type_id uuid not null references learning_work_types (id),
  subject_id uuid references subjects (id),
  academic_year_id uuid not null references academic_years (id),
  intended_year_group_id uuid references year_groups (id),
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  due_at timestamptz,
  available_from timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'closed', 'archived')),
  published_at timestamptz,
  published_by uuid references users (id),
  closed_at timestamptz,
  closed_by uuid references users (id),
  archived_at timestamptz,
  archived_by uuid references users (id),
  estimated_duration_minutes int
    check (estimated_duration_minutes is null or estimated_duration_minutes between 1 and 10080),
  maximum_marks numeric(8, 2)
    check (maximum_marks is null or maximum_marks > 0),
  submission_required boolean not null default true,
  teacher_notes text check (teacher_notes is null or char_length(teacher_notes) <= 10000)
);

create index learning_assignments_org_status_idx
  on learning_assignments (organisation_id, status, due_at);

create table learning_assignment_status_history (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  assignment_id uuid not null references learning_assignments (id),
  previous_status text,
  new_status text not null,
  actor_user_id uuid references users (id),
  note text,
  created_at timestamptz not null default now()
);

create table learning_assignment_targets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  assignment_id uuid not null references learning_assignments (id) on delete cascade,
  target_type text not null check (target_type in ('class', 'year_group', 'student')),
  class_id uuid references classes (id),
  year_group_id uuid references year_groups (id),
  student_profile_id uuid references student_profiles (id),
  created_at timestamptz not null default now(),
  created_by uuid references users (id),
  check (
    (target_type = 'class' and class_id is not null and year_group_id is null and student_profile_id is null)
    or (target_type = 'year_group' and year_group_id is not null and class_id is null and student_profile_id is null)
    or (target_type = 'student' and student_profile_id is not null and class_id is null and year_group_id is null)
  )
);

create unique index learning_assignment_targets_class_uq
  on learning_assignment_targets (assignment_id, class_id)
  where class_id is not null;
create unique index learning_assignment_targets_year_group_uq
  on learning_assignment_targets (assignment_id, year_group_id)
  where year_group_id is not null;
create unique index learning_assignment_targets_student_uq
  on learning_assignment_targets (assignment_id, student_profile_id)
  where student_profile_id is not null;

-- Snapshot of pupils assigned at publish (and later added targets).
-- Original assignment relationship is preserved if a pupil later changes class.
create table learning_assignment_recipients (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  assignment_id uuid not null references learning_assignments (id) on delete cascade,
  student_profile_id uuid not null references student_profiles (id),
  source_target_id uuid references learning_assignment_targets (id) on delete set null,
  class_id uuid references classes (id),
  year_group_id uuid references year_groups (id),
  assigned_at timestamptz not null default now(),
  unique (assignment_id, student_profile_id)
);

create index learning_assignment_recipients_student_idx
  on learning_assignment_recipients (organisation_id, student_profile_id);

-- ---------------------------------------------------------------------------
-- Resources (metadata / URL; no binary bytes in PostgreSQL)
-- ---------------------------------------------------------------------------

create table learning_resources (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  title text not null check (char_length(trim(title)) between 1 and 200),
  resource_kind text not null
    check (resource_kind in ('pdf', 'worksheet', 'image', 'url', 'video', 'document')),
  url text
    check (url is null or (char_length(url) between 8 and 2000 and url ~* '^https?://')),
  storage_backend text not null default 'unconfigured'
    check (storage_backend in ('unconfigured', 's3')),
  storage_key text,
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  check (url is not null or storage_key is not null)
);

create table learning_assignment_resources (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  assignment_id uuid not null references learning_assignments (id) on delete cascade,
  resource_id uuid not null references learning_resources (id) on delete cascade,
  sort_order int not null default 0,
  unique (assignment_id, resource_id)
);

-- ---------------------------------------------------------------------------
-- Submissions + revisions + marks
-- ---------------------------------------------------------------------------

create table learning_submissions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  assignment_id uuid not null references learning_assignments (id),
  student_profile_id uuid not null references student_profiles (id),
  status text not null default 'not_started'
    check (status in (
      'not_started',
      'in_progress',
      'submitted',
      'returned',
      'resubmission_requested',
      'completed'
    )),
  current_revision_id uuid,
  submitted_at timestamptz,
  submitted_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_profile_id)
);

create table learning_submission_revisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  submission_id uuid not null references learning_submissions (id),
  revision_number int not null check (revision_number >= 1),
  text_response text check (text_response is null or char_length(text_response) <= 20000),
  comment text check (comment is null or char_length(comment) <= 2000),
  submitted_at timestamptz not null default now(),
  submitted_by uuid not null references users (id),
  unique (submission_id, revision_number)
);

alter table learning_submissions
  add constraint learning_submissions_current_revision_fk
  foreign key (current_revision_id) references learning_submission_revisions (id);

create table learning_submission_attachments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  revision_id uuid not null references learning_submission_revisions (id),
  filename text not null check (char_length(trim(filename)) between 1 and 200),
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  storage_backend text not null default 'unconfigured'
    check (storage_backend in ('unconfigured', 's3')),
  storage_key text,
  created_at timestamptz not null default now()
);

create table learning_marks (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  submission_id uuid not null references learning_submissions (id),
  score numeric(8, 2),
  maximum_marks numeric(8, 2),
  feedback text check (feedback is null or char_length(feedback) <= 10000),
  released_to_student boolean not null default false,
  released_to_parent boolean not null default false,
  resubmission_requested boolean not null default false,
  marked_by uuid not null references users (id),
  marked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id),
  check (score is null or score >= 0),
  check (maximum_marks is null or maximum_marks > 0),
  check (score is null or maximum_marks is null or score <= maximum_marks)
);

-- ---------------------------------------------------------------------------
-- Tenant isolation
-- ---------------------------------------------------------------------------

select install_tenant_isolation('learning_work_types');
select install_tenant_isolation('learning_assignments');
select install_tenant_isolation('learning_assignment_status_history');
select install_tenant_isolation('learning_assignment_targets');
select install_tenant_isolation('learning_assignment_recipients');
select install_tenant_isolation('learning_resources');
select install_tenant_isolation('learning_assignment_resources');
select install_tenant_isolation('learning_submissions');
select install_tenant_isolation('learning_submission_revisions');
select install_tenant_isolation('learning_submission_attachments');
select install_tenant_isolation('learning_marks');

grant select, insert, update, delete on learning_work_types to schoolapp_app;
grant select, insert, update, delete on learning_assignments to schoolapp_app;
grant select, insert on learning_assignment_status_history to schoolapp_app;
revoke update, delete on learning_assignment_status_history from schoolapp_app;
grant select, insert, update, delete on learning_assignment_targets to schoolapp_app;
grant select, insert on learning_assignment_recipients to schoolapp_app;
revoke update, delete on learning_assignment_recipients from schoolapp_app;
grant select, insert, update, delete on learning_resources to schoolapp_app;
grant select, insert, update, delete on learning_assignment_resources to schoolapp_app;
grant select, insert, update on learning_submissions to schoolapp_app;
revoke delete on learning_submissions from schoolapp_app;
grant select, insert on learning_submission_revisions to schoolapp_app;
revoke update, delete on learning_submission_revisions from schoolapp_app;
grant select, insert on learning_submission_attachments to schoolapp_app;
revoke update, delete on learning_submission_attachments from schoolapp_app;
grant select, insert, update on learning_marks to schoolapp_app;
revoke delete on learning_marks from schoolapp_app;

drop trigger if exists learning_assignments_updated_at on learning_assignments;
create trigger learning_assignments_updated_at before update on learning_assignments
  for each row execute function set_updated_at();

drop trigger if exists learning_submissions_updated_at on learning_submissions;
create trigger learning_submissions_updated_at before update on learning_submissions
  for each row execute function set_updated_at();

drop trigger if exists learning_marks_updated_at on learning_marks;
create trigger learning_marks_updated_at before update on learning_marks
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Same-organisation integrity
-- ---------------------------------------------------------------------------

create or replace function learning_assignments_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from learning_work_types t
    where t.id = new.work_type_id and t.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from academic_years y
    where y.id = new.academic_year_id and y.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.subject_id is not null and not exists (
    select 1 from subjects s
    where s.id = new.subject_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.intended_year_group_id is not null and not exists (
    select 1 from year_groups g
    where g.id = new.intended_year_group_id and g.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_assignments_same_org_tg on learning_assignments;
create trigger learning_assignments_same_org_tg
  before insert or update on learning_assignments
  for each row execute function learning_assignments_same_org_tg();

create or replace function learning_assignment_targets_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from learning_assignments a
    where a.id = new.assignment_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.class_id is not null then
    if not exists (
      select 1 from classes c
      join learning_assignments a on a.id = new.assignment_id
      where c.id = new.class_id
        and c.organisation_id = new.organisation_id
        and c.academic_year_id = a.academic_year_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  end if;
  if new.year_group_id is not null and not exists (
    select 1 from year_groups g
    where g.id = new.year_group_id and g.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.student_profile_id is not null and not exists (
    select 1 from student_profiles s
    where s.id = new.student_profile_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_assignment_targets_same_org_tg on learning_assignment_targets;
create trigger learning_assignment_targets_same_org_tg
  before insert or update on learning_assignment_targets
  for each row execute function learning_assignment_targets_same_org_tg();

create or replace function learning_assignment_recipients_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from learning_assignments a
    where a.id = new.assignment_id and a.organisation_id = new.organisation_id
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
  if new.year_group_id is not null and not exists (
    select 1 from year_groups g
    where g.id = new.year_group_id and g.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_assignment_recipients_same_org_tg on learning_assignment_recipients;
create trigger learning_assignment_recipients_same_org_tg
  before insert or update on learning_assignment_recipients
  for each row execute function learning_assignment_recipients_same_org_tg();

create or replace function learning_assignment_resources_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from learning_assignments a
    where a.id = new.assignment_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from learning_resources r
    where r.id = new.resource_id and r.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_assignment_resources_same_org_tg on learning_assignment_resources;
create trigger learning_assignment_resources_same_org_tg
  before insert or update on learning_assignment_resources
  for each row execute function learning_assignment_resources_same_org_tg();

create or replace function learning_submissions_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from learning_assignments a
    where a.id = new.assignment_id and a.organisation_id = new.organisation_id
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
    select 1 from learning_assignment_recipients r
    where r.assignment_id = new.assignment_id
      and r.student_profile_id = new.student_profile_id
      and r.organisation_id = new.organisation_id
  ) then
    raise exception 'assignment_not_assigned' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_submissions_same_org_tg on learning_submissions;
create trigger learning_submissions_same_org_tg
  before insert or update on learning_submissions
  for each row execute function learning_submissions_same_org_tg();

create or replace function learning_submission_revisions_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from learning_submissions s
    where s.id = new.submission_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_submission_revisions_same_org_tg on learning_submission_revisions;
create trigger learning_submission_revisions_same_org_tg
  before insert on learning_submission_revisions
  for each row execute function learning_submission_revisions_same_org_tg();

create or replace function learning_submission_attachments_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from learning_submission_revisions r
    where r.id = new.revision_id and r.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_submission_attachments_same_org_tg on learning_submission_attachments;
create trigger learning_submission_attachments_same_org_tg
  before insert on learning_submission_attachments
  for each row execute function learning_submission_attachments_same_org_tg();

create or replace function learning_marks_same_org_tg()
returns trigger
language plpgsql
as $$
declare
  v_max numeric(8, 2);
begin
  if not exists (
    select 1 from learning_submissions s
    where s.id = new.submission_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  select a.maximum_marks into v_max
  from learning_submissions s
  join learning_assignments a on a.id = s.assignment_id
  where s.id = new.submission_id;
  if new.maximum_marks is null then
    new.maximum_marks := v_max;
  end if;
  if v_max is not null and new.maximum_marks is not null and new.maximum_marks > v_max then
    raise exception 'learning_score_out_of_range' using errcode = '23514';
  end if;
  if new.score is not null and v_max is not null and new.score > v_max then
    raise exception 'learning_score_out_of_range' using errcode = '23514';
  end if;
  if new.score is not null and new.maximum_marks is not null and new.score > new.maximum_marks then
    raise exception 'learning_score_out_of_range' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_marks_same_org_tg on learning_marks;
create trigger learning_marks_same_org_tg
  before insert or update on learning_marks
  for each row execute function learning_marks_same_org_tg();

-- ---------------------------------------------------------------------------
-- Status machines, immutable identity, actor stamps
-- ---------------------------------------------------------------------------

create or replace function learning_assignment_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select
    p_from = p_to
    or (p_from = 'draft' and p_to in ('published', 'archived'))
    or (p_from = 'published' and p_to in ('closed', 'archived'))
    or (p_from = 'closed' and p_to in ('published', 'archived'))
    or (p_from = 'archived' and p_to = 'closed');
$$;

create or replace function learning_submission_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select
    p_from = p_to
    or (p_from = 'not_started' and p_to in ('in_progress', 'submitted'))
    or (p_from = 'in_progress' and p_to in ('submitted'))
    or (p_from = 'submitted' and p_to in ('returned', 'completed', 'resubmission_requested'))
    or (p_from = 'returned' and p_to in ('completed', 'resubmission_requested'))
    or (p_from = 'resubmission_requested' and p_to in ('in_progress', 'submitted', 'returned', 'completed'))
    or (p_from = 'completed' and p_to in ('resubmission_requested'));
$$;

create or replace function learning_assignments_write_tg()
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
      raise exception 'learning_actor_required' using errcode = '22023';
    end if;
    new.published_at := null;
    new.published_by := null;
    new.closed_at := null;
    new.closed_by := null;
    new.archived_at := null;
    new.archived_by := null;
    return new;
  end if;

  new.id := old.id;
  new.organisation_id := old.organisation_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if not learning_assignment_status_allowed(old.status, new.status) then
    raise exception 'invalid_status_transition' using errcode = '23514';
  end if;

  if old.status is distinct from new.status then
    if new.status = 'published' then
      new.published_at := coalesce(old.published_at, now());
      new.published_by := coalesce(v_actor, old.published_by, new.published_by);
    elsif new.status = 'closed' then
      new.closed_at := now();
      new.closed_by := coalesce(v_actor, new.closed_by);
    elsif new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := coalesce(v_actor, new.archived_by);
    end if;
  else
    new.published_at := old.published_at;
    new.published_by := old.published_by;
    new.closed_at := old.closed_at;
    new.closed_by := old.closed_by;
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;

  return new;
end;
$$;

drop trigger if exists learning_assignments_write_tg on learning_assignments;
create trigger learning_assignments_write_tg
  before insert or update on learning_assignments
  for each row execute function learning_assignments_write_tg();

create or replace function learning_assignments_history_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into learning_assignment_status_history (
      organisation_id, assignment_id, previous_status, new_status, actor_user_id
    ) values (
      new.organisation_id,
      new.id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      coalesce(app_current_user_id(), new.published_by, new.closed_by, new.archived_by, new.created_by)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists learning_assignments_history_tg on learning_assignments;
create trigger learning_assignments_history_tg
  after insert or update on learning_assignments
  for each row execute function learning_assignments_history_tg();

create or replace function learning_submissions_write_tg()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
begin
  v_actor := app_current_user_id();
  if tg_op = 'INSERT' then
    if new.status is distinct from 'not_started' and new.status is distinct from 'in_progress' and new.status is distinct from 'submitted' then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
    if v_actor is not null and new.status in ('in_progress', 'submitted') then
      new.submitted_by := coalesce(new.submitted_by, v_actor);
    end if;
    return new;
  end if;

  new.id := old.id;
  new.organisation_id := old.organisation_id;
  new.assignment_id := old.assignment_id;
  new.student_profile_id := old.student_profile_id;
  new.created_at := old.created_at;

  if not learning_submission_status_allowed(old.status, new.status) then
    raise exception 'invalid_status_transition' using errcode = '23514';
  end if;

  if new.status in ('submitted') and v_actor is not null then
    new.submitted_by := v_actor;
    new.submitted_at := coalesce(new.submitted_at, now());
  elsif new.status is not distinct from old.status then
    new.submitted_by := old.submitted_by;
    if old.submitted_at is not null then
      new.submitted_at := old.submitted_at;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists learning_submissions_write_tg on learning_submissions;
create trigger learning_submissions_write_tg
  before insert or update on learning_submissions
  for each row execute function learning_submissions_write_tg();

create or replace function learning_submission_revisions_write_tg()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
begin
  v_actor := app_current_user_id();
  if v_actor is not null then
    new.submitted_by := v_actor;
    new.submitted_at := now();
  end if;
  if new.submitted_by is null then
    raise exception 'learning_actor_required' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_submission_revisions_write_tg on learning_submission_revisions;
create trigger learning_submission_revisions_write_tg
  before insert on learning_submission_revisions
  for each row execute function learning_submission_revisions_write_tg();

create or replace function learning_marks_write_tg()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
begin
  v_actor := app_current_user_id();
  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.marked_by := v_actor;
      new.marked_at := now();
    end if;
    if new.marked_by is null then
      raise exception 'learning_mark_actor_required' using errcode = '22023';
    end if;
    new.marked_at := coalesce(new.marked_at, now());
    return new;
  end if;

  new.id := old.id;
  new.organisation_id := old.organisation_id;
  new.submission_id := old.submission_id;
  if v_actor is not null then
    new.marked_by := v_actor;
    new.marked_at := now();
  else
    new.marked_by := old.marked_by;
  end if;
  return new;
end;
$$;

drop trigger if exists learning_marks_write_tg on learning_marks;
create trigger learning_marks_write_tg
  before insert or update on learning_marks
  for each row execute function learning_marks_write_tg();

-- ---------------------------------------------------------------------------
-- Org defaults
-- ---------------------------------------------------------------------------

create or replace function ensure_organisation_phase7_defaults(p_organisation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_organisation_id is null then
    return;
  end if;
  if nullif(current_setting('app.organisation_id', true), '') is not null
     and app_current_organisation_id() is distinct from p_organisation_id
     and not app_is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into learning_work_types (organisation_id, key, name, sort_order, is_system)
  values
    (p_organisation_id, 'homework', 'Homework', 1, true),
    (p_organisation_id, 'classwork', 'Classwork', 2, true),
    (p_organisation_id, 'revision', 'Revision', 3, true),
    (p_organisation_id, 'project', 'Project', 4, true),
    (p_organisation_id, 'reading', 'Reading', 5, true),
    (p_organisation_id, 'practice', 'Practice', 6, true),
    (p_organisation_id, 'assessment_preparation', 'Assessment preparation', 7, true)
  on conflict (organisation_id, key) do nothing;
end;
$$;

revoke all on function ensure_organisation_phase7_defaults(uuid) from public;
grant execute on function ensure_organisation_phase7_defaults(uuid) to schoolapp_app;

create or replace function organisations_phase7_defaults_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform ensure_organisation_phase7_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists organisations_phase7_defaults_tg on organisations;
create trigger organisations_phase7_defaults_tg
  after insert on organisations
  for each row execute function organisations_phase7_defaults_tg();

select ensure_organisation_phase7_defaults(id) from organisations;
