-- Phase 14: school activities (trips, clubs, consents, participants).
-- Additive. Does not weaken FORCE RLS, tenant context, hostname tenancy,
-- membership revalidation, teacher assigned-only access, guardianship /
-- portal_access, student self-only access, student portal policy, current
-- primary-enrolment checks, safeguarding capabilities, break-glass, audit,
-- timetable, or Phase 13 object-storage controls.
-- Treats migrations 0001–0029 as immutable.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('activities.read', 'School-wide activity / trip / club read'),
  ('activities.read_assigned', 'Read activities assigned to the staff member or their classes'),
  ('activities.manage', 'School-wide activity create / edit'),
  ('activities.manage_assigned', 'Create and manage own or assigned activities'),
  ('activities.publish', 'Publish, close, complete, cancel, or archive activities'),
  ('activities.participants.read', 'Read participant, eligibility, and waiting-list lists'),
  ('activities.participants.manage', 'Manually add, promote, or withdraw participants'),
  ('activities.responses.read', 'Read parent / pupil activity responses'),
  ('activities.responses.manage', 'Record offline consent and override responses'),
  ('activities.medical_summary.read', 'Read limited activity safety / emergency summaries'),
  ('activities.read_own_children', 'Parent: read and respond for authorised children'),
  ('activities.read_self', 'Student: read own visible activities and self-sign-up where enabled')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'activities.read'),
    ('school.admin', 'activities.manage'),
    ('school.admin', 'activities.publish'),
    ('school.admin', 'activities.participants.read'),
    ('school.admin', 'activities.participants.manage'),
    ('school.admin', 'activities.responses.read'),
    ('school.admin', 'activities.responses.manage'),
    ('school.admin', 'activities.medical_summary.read'),
    ('school.headteacher', 'activities.read'),
    ('school.headteacher', 'activities.manage'),
    ('school.headteacher', 'activities.publish'),
    ('school.headteacher', 'activities.participants.read'),
    ('school.headteacher', 'activities.participants.manage'),
    ('school.headteacher', 'activities.responses.read'),
    ('school.headteacher', 'activities.responses.manage'),
    ('school.headteacher', 'activities.medical_summary.read'),
    ('school.teacher', 'activities.read_assigned'),
    ('school.teacher', 'activities.manage_assigned'),
    ('school.teacher', 'activities.participants.read'),
    ('school.teacher', 'activities.responses.read'),
    ('school.staff', 'activities.read_assigned'),
    ('school.parent', 'activities.read_own_children'),
    ('school.student', 'activities.read_self')
) as x(role_key, perm)
  on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select org_role.id, rp.permission_key
from roles sys
join role_permissions rp on rp.role_id = sys.id
join roles org_role on org_role.key = sys.key and org_role.organisation_id is not null
where sys.organisation_id is null
  and rp.permission_key like 'activities.%'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Notification types / categories
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
    'announcement_published',
    'announcement_important',
    'announcement_acknowledgement',
    'calendar_upcoming',
    'pastoral_assigned',
    'safeguarding_assigned',
    'pastoral_follow_up',
    'behaviour_follow_up',
    'activity_published',
    'activity_updated',
    'activity_cancelled',
    'activity_consent_required',
    'activity_deadline',
    'activity_place_confirmed',
    'activity_waitlisted',
    'activity_promoted',
    'activity_assignment',
    'general'
  ));

alter table notifications drop constraint if exists notifications_category_check;
alter table notifications add constraint notifications_category_check
  check (category in (
    'homework',
    'results',
    'feedback',
    'announcement',
    'attendance',
    'competition',
    'reports',
    'admissions',
    'calendar',
    'behaviour',
    'pastoral',
    'safeguarding',
    'activities',
    'general'
  ));

-- Calendar may point at a canonical school_activity without duplicating it.
alter table school_events drop constraint if exists school_events_related_kind_check;
alter table school_events add constraint school_events_related_kind_check
  check (related_kind in (
    'none', 'academic_year', 'term', 'class', 'year_group',
    'assessment', 'assignment', 'admissions_open_day', 'school_activity'
  ));

-- Phase 13 stored-object domain for activity documents.
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
    'activity'
  ));

-- ---------------------------------------------------------------------------
-- Activity type catalogue
-- ---------------------------------------------------------------------------

create table school_activity_types (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null
    check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order int not null default 0,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create index school_activity_types_org_idx
  on school_activity_types (organisation_id, is_active, sort_order);

-- ---------------------------------------------------------------------------
-- Canonical school activities
-- ---------------------------------------------------------------------------

create table school_activities (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  academic_year_id uuid references academic_years (id),
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 20000),
  activity_type_id uuid not null references school_activity_types (id),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'closed', 'completed', 'cancelled', 'archived')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  location text check (location is null or char_length(location) <= 200),
  external_address text check (external_address is null or char_length(external_address) <= 500),
  meeting_point text check (meeting_point is null or char_length(meeting_point) <= 200),
  return_point text check (return_point is null or char_length(return_point) <= 200),
  capacity int check (capacity is null or capacity >= 0),
  response_deadline_at timestamptz,
  allow_responses_after_deadline boolean not null default false,
  consent_required boolean not null default false,
  parent_response_required boolean not null default false,
  student_signup_enabled boolean not null default false,
  student_visible boolean not null default true,
  parent_visible boolean not null default true,
  occurrence_kind text not null default 'one_off'
    check (occurrence_kind in ('one_off', 'recurring')),
  recurrence_weekdays smallint[]
    check (
      recurrence_weekdays is null
      or (
        cardinality(recurrence_weekdays) >= 1
        and recurrence_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
      )
    ),
  recurrence_until date,
  consent_version int not null default 1 check (consent_version >= 1),
  staff_notes text check (staff_notes is null or char_length(staff_notes) <= 20000),
  parent_notes text check (parent_notes is null or char_length(parent_notes) <= 20000),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 2000),
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_by uuid references users (id),
  published_at timestamptz,
  closed_by uuid references users (id),
  closed_at timestamptz,
  completed_by uuid references users (id),
  completed_at timestamptz,
  cancelled_by uuid references users (id),
  cancelled_at timestamptz,
  archived_by uuid references users (id),
  archived_at timestamptz,
  check (ends_at >= starts_at),
  check (
    response_deadline_at is null
    or response_deadline_at <= ends_at
  ),
  check (
    occurrence_kind = 'one_off'
    or (recurrence_weekdays is not null and recurrence_until is not null)
  )
);

create index school_activities_org_status_idx
  on school_activities (organisation_id, status, starts_at);
create index school_activities_org_type_idx
  on school_activities (organisation_id, activity_type_id, starts_at);

create trigger school_activities_updated_at before update on school_activities
  for each row execute function set_updated_at();

create table school_activity_status_history (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  activity_id uuid not null references school_activities (id),
  previous_status text,
  new_status text not null,
  actor_user_id uuid references users (id),
  created_at timestamptz not null default now()
);

create index school_activity_status_history_activity_idx
  on school_activity_status_history (activity_id, created_at);

-- ---------------------------------------------------------------------------
-- Targeting (intent) vs eligibility snapshot
-- ---------------------------------------------------------------------------

create table school_activity_targets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  activity_id uuid not null references school_activities (id) on delete cascade,
  target_type text not null check (target_type in (
    'whole_school', 'year_group', 'class', 'student', 'staff_member'
  )),
  class_id uuid references classes (id),
  year_group_id uuid references year_groups (id),
  student_profile_id uuid references student_profiles (id),
  staff_user_id uuid references users (id),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  check (
    (target_type = 'whole_school' and class_id is null and year_group_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'year_group' and year_group_id is not null and class_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'class' and class_id is not null and year_group_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'student' and student_profile_id is not null and class_id is null and year_group_id is null and staff_user_id is null)
    or (target_type = 'staff_member' and staff_user_id is not null and class_id is null and year_group_id is null and student_profile_id is null)
  )
);

create unique index school_activity_targets_whole_school_uidx
  on school_activity_targets (activity_id)
  where target_type = 'whole_school';
create unique index school_activity_targets_year_group_uidx
  on school_activity_targets (activity_id, year_group_id)
  where target_type = 'year_group';
create unique index school_activity_targets_class_uidx
  on school_activity_targets (activity_id, class_id)
  where target_type = 'class';
create unique index school_activity_targets_student_uidx
  on school_activity_targets (activity_id, student_profile_id)
  where target_type = 'student';
create unique index school_activity_targets_staff_uidx
  on school_activity_targets (activity_id, staff_user_id)
  where target_type = 'staff_member';

create table school_activity_eligible_pupils (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  activity_id uuid not null references school_activities (id) on delete cascade,
  student_profile_id uuid not null references student_profiles (id),
  source_target_id uuid references school_activity_targets (id) on delete set null,
  class_id uuid references classes (id),
  year_group_id uuid references year_groups (id),
  assigned_at timestamptz not null default now(),
  unique (activity_id, student_profile_id)
);

create index school_activity_eligible_org_student_idx
  on school_activity_eligible_pupils (organisation_id, student_profile_id);

-- ---------------------------------------------------------------------------
-- Staff assignments (activity-scoped, not school-wide RBAC)
-- ---------------------------------------------------------------------------

create table school_activity_staff (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  activity_id uuid not null references school_activities (id) on delete cascade,
  staff_user_id uuid not null references users (id),
  staff_role text not null default 'accompanying'
    check (staff_role in ('lead', 'trip_leader', 'accompanying', 'support')),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  unique (activity_id, staff_user_id)
);

create index school_activity_staff_user_idx
  on school_activity_staff (organisation_id, staff_user_id);

-- ---------------------------------------------------------------------------
-- Consent wording (current) + response snapshots
-- ---------------------------------------------------------------------------

create table school_activity_consent_clauses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  activity_id uuid not null references school_activities (id) on delete cascade,
  clause_key text not null check (clause_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  title text not null check (char_length(trim(title)) between 1 and 200),
  wording text not null check (char_length(trim(wording)) between 1 and 20000),
  required boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (activity_id, clause_key)
);

-- ---------------------------------------------------------------------------
-- Participants (registration) distinct from eligibility and consent history
-- ---------------------------------------------------------------------------

create table school_activity_participants (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  activity_id uuid not null references school_activities (id),
  student_profile_id uuid not null references student_profiles (id),
  registration_status text not null
    check (registration_status in (
      'expected', 'interested', 'confirmed', 'waitlisted', 'withdrawn', 'declined'
    )),
  waiting_list_position int check (waiting_list_position is null or waiting_list_position >= 1),
  attendance_status text
    check (attendance_status is null or attendance_status in (
      'expected', 'attended', 'absent', 'withdrawn'
    )),
  source text not null
    check (source in (
      'parent_consent', 'student_signup', 'staff_assigned', 'school_assigned', 'staff_offline'
    )),
  joined_at timestamptz not null default now(),
  confirmed_at timestamptz,
  withdrawn_at timestamptz,
  internal_note text check (internal_note is null or char_length(internal_note) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id, student_profile_id),
  check (
    (registration_status = 'waitlisted' and waiting_list_position is not null)
    or (registration_status <> 'waitlisted' and waiting_list_position is null)
  )
);

create index school_activity_participants_status_idx
  on school_activity_participants (activity_id, registration_status, waiting_list_position);
create index school_activity_participants_student_idx
  on school_activity_participants (organisation_id, student_profile_id);

create trigger school_activity_participants_updated_at before update on school_activity_participants
  for each row execute function set_updated_at();

create table school_activity_responses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  activity_id uuid not null references school_activities (id),
  student_profile_id uuid not null references student_profiles (id),
  actor_user_id uuid not null references users (id),
  guardian_user_id uuid references users (id),
  guardianship_id uuid references guardianships (id),
  channel text not null
    check (channel in ('parent_portal', 'student_portal', 'staff_offline')),
  response text not null
    check (response in ('pending', 'consented', 'declined', 'withdrawn')),
  is_effective boolean not null default true,
  comment text check (comment is null or char_length(comment) <= 4000),
  emergency_medical_acknowledged boolean not null default false,
  consent_version int not null check (consent_version >= 1),
  wording_snapshot jsonb not null default '[]'::jsonb,
  staff_note text check (staff_note is null or char_length(staff_note) <= 4000),
  responded_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawal_reason text check (withdrawal_reason is null or char_length(withdrawal_reason) <= 2000),
  created_at timestamptz not null default now()
);

create unique index school_activity_responses_effective_uidx
  on school_activity_responses (activity_id, student_profile_id)
  where is_effective;
create index school_activity_responses_activity_idx
  on school_activity_responses (activity_id, responded_at);

-- ---------------------------------------------------------------------------
-- Documents and parent-safe updates
-- ---------------------------------------------------------------------------

create table school_activity_documents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  activity_id uuid not null references school_activities (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  visibility text not null default 'staff'
    check (visibility in ('staff', 'staff_and_parents', 'staff_parents_and_student')),
  stored_object_id uuid references stored_objects (id),
  storage_backend text not null default 'filesystem',
  storage_key text,
  original_filename text,
  content_type text,
  byte_size bigint,
  checksum_sha256 text,
  deleted_at timestamptz,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now()
);

create index school_activity_documents_activity_idx
  on school_activity_documents (activity_id)
  where deleted_at is null;

create table school_activity_updates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  activity_id uuid not null references school_activities (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  parent_visible boolean not null default true,
  student_visible boolean not null default false,
  published_by uuid not null references users (id),
  published_at timestamptz not null default now()
);

create index school_activity_updates_activity_idx
  on school_activity_updates (activity_id, published_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

select install_tenant_isolation('school_activity_types');
select install_tenant_isolation('school_activities');
select install_tenant_isolation('school_activity_status_history');
select install_tenant_isolation('school_activity_targets');
select install_tenant_isolation('school_activity_eligible_pupils');
select install_tenant_isolation('school_activity_staff');
select install_tenant_isolation('school_activity_consent_clauses');
select install_tenant_isolation('school_activity_participants');
select install_tenant_isolation('school_activity_responses');
select install_tenant_isolation('school_activity_documents');
select install_tenant_isolation('school_activity_updates');

grant select, insert, update, delete on school_activity_types to schoolapp_app;
grant select, insert, update, delete on school_activities to schoolapp_app;
grant select, insert on school_activity_status_history to schoolapp_app;
grant select, insert, update, delete on school_activity_targets to schoolapp_app;
grant select, insert, update, delete on school_activity_eligible_pupils to schoolapp_app;
grant select, insert, update, delete on school_activity_staff to schoolapp_app;
grant select, insert, update, delete on school_activity_consent_clauses to schoolapp_app;
grant select, insert, update, delete on school_activity_participants to schoolapp_app;
grant select, insert, update on school_activity_responses to schoolapp_app;
grant select, insert, update on school_activity_documents to schoolapp_app;
grant select, insert on school_activity_updates to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Status transitions
-- ---------------------------------------------------------------------------

create or replace function school_activity_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select p_from = p_to
    or (p_from = 'draft' and p_to in ('published', 'cancelled', 'archived'))
    or (p_from = 'published' and p_to in ('closed', 'completed', 'cancelled', 'archived'))
    or (p_from = 'closed' and p_to in ('published', 'completed', 'cancelled', 'archived'))
    or (p_from = 'completed' and p_to in ('archived'))
    or (p_from = 'cancelled' and p_to in ('archived'))
    or (p_from = 'archived' and p_to in ('archived'));
$$;

create or replace function school_activity_write_tg()
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
      raise exception 'activity_actor_required' using errcode = '22023';
    end if;
    new.published_at := null;
    new.published_by := null;
    new.closed_at := null;
    new.closed_by := null;
    new.completed_at := null;
    new.completed_by := null;
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.archived_at := null;
    new.archived_by := null;
    return new;
  end if;

  new.id := old.id;
  new.organisation_id := old.organisation_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if not school_activity_status_allowed(old.status, new.status) then
    raise exception 'invalid_status_transition' using errcode = '23514';
  end if;

  if old.status is distinct from new.status then
    if new.status = 'published' then
      new.published_at := coalesce(old.published_at, now());
      new.published_by := coalesce(v_actor, old.published_by, new.published_by);
    elsif new.status = 'closed' then
      new.closed_at := now();
      new.closed_by := coalesce(v_actor, new.closed_by);
    elsif new.status = 'completed' then
      new.completed_at := now();
      new.completed_by := coalesce(v_actor, new.completed_by);
    elsif new.status = 'cancelled' then
      new.cancelled_at := now();
      new.cancelled_by := coalesce(v_actor, new.cancelled_by);
    elsif new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := coalesce(v_actor, new.archived_by);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists school_activity_write_tg on school_activities;
create trigger school_activity_write_tg
  before insert or update on school_activities
  for each row execute function school_activity_write_tg();

create or replace function school_activity_status_history_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into school_activity_status_history (
      organisation_id, activity_id, previous_status, new_status, actor_user_id
    ) values (
      new.organisation_id,
      new.id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      coalesce(app_current_user_id(), new.published_by, new.created_by)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists school_activity_status_history_tg on school_activities;
create trigger school_activity_status_history_tg
  after insert or update of status on school_activities
  for each row execute function school_activity_status_history_tg();

-- ---------------------------------------------------------------------------
-- Same-organisation integrity
-- ---------------------------------------------------------------------------

create or replace function school_activity_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from school_activity_types t
    where t.id = new.activity_type_id and t.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.academic_year_id is not null and not exists (
    select 1 from academic_years y
    where y.id = new.academic_year_id and y.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists school_activity_integrity_tg on school_activities;
create trigger school_activity_integrity_tg
  before insert or update on school_activities
  for each row execute function school_activity_integrity_tg();

create or replace function school_activity_target_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from school_activities a
    where a.id = new.activity_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.class_id is not null and not exists (
    select 1 from classes c where c.id = new.class_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.year_group_id is not null and not exists (
    select 1 from year_groups y where y.id = new.year_group_id and y.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.student_profile_id is not null and not exists (
    select 1 from student_profiles s
    where s.id = new.student_profile_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.staff_user_id is not null and not exists (
    select 1 from organisation_memberships m
    where m.organisation_id = new.organisation_id
      and m.user_id = new.staff_user_id
      and m.status = 'active'
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists school_activity_target_integrity_tg on school_activity_targets;
create trigger school_activity_target_integrity_tg
  before insert or update on school_activity_targets
  for each row execute function school_activity_target_integrity_tg();

create or replace function school_activity_child_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from school_activities a
    where a.id = new.activity_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if to_jsonb(new) ? 'student_profile_id'
     and new.student_profile_id is not null
     and not exists (
       select 1 from student_profiles s
       where s.id = new.student_profile_id and s.organisation_id = new.organisation_id
     ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists school_activity_eligible_org_tg on school_activity_eligible_pupils;
create trigger school_activity_eligible_org_tg
  before insert or update on school_activity_eligible_pupils
  for each row execute function school_activity_child_org_tg();

drop trigger if exists school_activity_participants_org_tg on school_activity_participants;
create trigger school_activity_participants_org_tg
  before insert or update on school_activity_participants
  for each row execute function school_activity_child_org_tg();

drop trigger if exists school_activity_responses_org_tg on school_activity_responses;
create trigger school_activity_responses_org_tg
  before insert or update on school_activity_responses
  for each row execute function school_activity_child_org_tg();

create or replace function school_activity_staff_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from school_activities a
    where a.id = new.activity_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from organisation_memberships m
    where m.organisation_id = new.organisation_id
      and m.user_id = new.staff_user_id
      and m.status = 'active'
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists school_activity_staff_integrity_tg on school_activity_staff;
create trigger school_activity_staff_integrity_tg
  before insert or update on school_activity_staff
  for each row execute function school_activity_staff_integrity_tg();

-- Capacity: never confirm more pupils than capacity (null = unlimited).
create or replace function school_activity_participants_capacity_tg()
returns trigger
language plpgsql
as $$
declare
  v_capacity int;
  v_confirmed int;
begin
  if new.registration_status is distinct from 'confirmed' then
    return new;
  end if;
  select capacity into v_capacity
    from school_activities
   where id = new.activity_id
     and organisation_id = new.organisation_id
   for update;
  if v_capacity is null then
    return new;
  end if;
  select count(*)::int into v_confirmed
    from school_activity_participants
   where activity_id = new.activity_id
     and organisation_id = new.organisation_id
     and registration_status = 'confirmed'
     and id is distinct from new.id;
  if v_confirmed >= v_capacity then
    raise exception 'activity_capacity_exceeded' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists school_activity_participants_capacity_tg on school_activity_participants;
create trigger school_activity_participants_capacity_tg
  before insert or update of registration_status on school_activity_participants
  for each row execute function school_activity_participants_capacity_tg();

-- Offline consent cannot claim a guardian identity.
create or replace function school_activity_response_channel_tg()
returns trigger
language plpgsql
as $$
begin
  if new.channel = 'staff_offline' then
    new.guardian_user_id := null;
    new.guardianship_id := null;
  end if;
  if new.channel = 'parent_portal' and new.guardian_user_id is null then
    raise exception 'activity_guardian_required' using errcode = '23514';
  end if;
  if new.channel = 'student_portal' then
    new.guardian_user_id := null;
    new.guardianship_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists school_activity_response_channel_tg on school_activity_responses;
create trigger school_activity_response_channel_tg
  before insert or update on school_activity_responses
  for each row execute function school_activity_response_channel_tg();

-- Emergency contacts for activity safety summaries. Reads restricted_contact
-- as table owner so schoolapp_app never needs SELECT on that column.
create or replace function list_activity_safety_contacts(
  p_organisation_id uuid,
  p_activity_id uuid
)
returns table (
  student_profile_id uuid,
  full_name text,
  relationship text,
  email text,
  is_emergency_contact boolean,
  has_parental_responsibility boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_organisation_id is distinct from app_current_organisation_id() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if app_current_user_id() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app_is_platform_admin() and not exists (
    select 1 from organisation_memberships m
    where m.organisation_id = p_organisation_id
      and m.user_id = app_current_user_id()
      and m.status = 'active'
      and m.ended_at is null
  ) then
    raise exception 'tenant_context_membership_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from school_activities a
    where a.id = p_activity_id and a.organisation_id = p_organisation_id
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not (
    actor_has_permission(app_current_user_id(), p_organisation_id, 'activities.medical_summary.read')
    or actor_has_permission(app_current_user_id(), p_organisation_id, 'activities.manage')
    or exists (
      select 1 from school_activity_staff s
      where s.activity_id = p_activity_id
        and s.organisation_id = p_organisation_id
        and s.staff_user_id = app_current_user_id()
    )
    or exists (
      select 1 from school_activities a
      where a.id = p_activity_id
        and a.organisation_id = p_organisation_id
        and a.created_by = app_current_user_id()
    )
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select g.student_profile_id,
         u.full_name,
         g.relationship,
         u.email::text,
         g.is_emergency_contact,
         g.has_parental_responsibility
    from guardianships g
    join users u on u.id = g.guardian_user_id
   where g.organisation_id = p_organisation_id
     and g.restricted_contact = false
     and (g.ended_on is null or g.ended_on >= current_date)
     and exists (
       select 1
         from school_activity_participants p
        where p.activity_id = p_activity_id
          and p.organisation_id = p_organisation_id
          and p.student_profile_id = g.student_profile_id
          and p.registration_status in ('confirmed', 'expected')
     )
   order by g.is_emergency_contact desc, g.priority, u.full_name;
end;
$$;

revoke all on function list_activity_safety_contacts(uuid, uuid) from public;
grant execute on function list_activity_safety_contacts(uuid, uuid) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Org defaults
-- ---------------------------------------------------------------------------

create or replace function ensure_organisation_phase14_defaults(p_organisation_id uuid)
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

  insert into school_activity_types (organisation_id, key, name, sort_order, is_system)
  values
    (p_organisation_id, 'trip', 'Trip', 1, true),
    (p_organisation_id, 'residential', 'Residential', 2, true),
    (p_organisation_id, 'visit', 'Visit', 3, true),
    (p_organisation_id, 'club', 'Club', 4, true),
    (p_organisation_id, 'after_school', 'After-school club', 5, true),
    (p_organisation_id, 'breakfast_club', 'Breakfast club', 6, true),
    (p_organisation_id, 'sports_fixture', 'Sports fixture', 7, true),
    (p_organisation_id, 'workshop', 'Workshop', 8, true),
    (p_organisation_id, 'performance', 'Performance', 9, true),
    (p_organisation_id, 'extracurricular', 'Extracurricular', 10, true),
    (p_organisation_id, 'other', 'Other', 11, true)
  on conflict (organisation_id, key) do nothing;
end;
$$;

revoke all on function ensure_organisation_phase14_defaults(uuid) from public;
grant execute on function ensure_organisation_phase14_defaults(uuid) to schoolapp_app;

create or replace function organisations_phase14_defaults_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform ensure_organisation_phase14_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists organisations_phase14_defaults_tg on organisations;
create trigger organisations_phase14_defaults_tg
  after insert on organisations
  for each row execute function organisations_phase14_defaults_tg();

select ensure_organisation_phase14_defaults(id) from organisations;
