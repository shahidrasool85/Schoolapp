-- Phase 11: Behaviour, pastoral, and safeguarding foundation.
-- Additive. Does not weaken FORCE RLS, tenant context, hostname tenancy,
-- membership revalidation, teacher assigned-only access, guardianship /
-- portal_access, student self-only access, student portal policy, current
-- primary-enrolment checks, break-glass, or audit controls.
-- Treats migrations 0001–0024 as immutable.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('behaviour.read', 'School-wide behaviour incident and achievement read'),
  ('behaviour.record', 'Record behaviour incidents for authorised pupils'),
  ('behaviour.manage', 'School-wide behaviour configuration and lifecycle management'),
  ('behaviour.read_assigned', 'Read behaviour records for assigned pupils only'),
  ('behaviour.positive.record', 'Record positive behaviour / achievements for authorised pupils'),
  ('pastoral.read', 'School-wide pastoral concern read'),
  ('pastoral.manage', 'Create, assign, and manage pastoral concerns and interventions'),
  ('pastoral.read_assigned', 'Read pastoral concerns for assigned pupils only'),
  ('safeguarding.read', 'Read safeguarding concerns and chronology'),
  ('safeguarding.record', 'Record safeguarding concerns and chronology entries'),
  ('safeguarding.manage', 'Manage safeguarding cases, status, and restricted attachments'),
  ('safeguarding.assign', 'Assign safeguarding concerns to a DSL / safeguarding lead')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'behaviour.read'),
    ('school.admin', 'behaviour.record'),
    ('school.admin', 'behaviour.manage'),
    ('school.admin', 'behaviour.positive.record'),
    ('school.admin', 'pastoral.read'),
    ('school.admin', 'pastoral.manage'),
    ('school.admin', 'safeguarding.read'),
    ('school.admin', 'safeguarding.record'),
    ('school.admin', 'safeguarding.manage'),
    ('school.admin', 'safeguarding.assign'),
    ('school.headteacher', 'behaviour.read'),
    ('school.headteacher', 'behaviour.record'),
    ('school.headteacher', 'behaviour.manage'),
    ('school.headteacher', 'behaviour.positive.record'),
    ('school.headteacher', 'pastoral.read'),
    ('school.headteacher', 'pastoral.manage'),
    ('school.headteacher', 'safeguarding.read'),
    ('school.headteacher', 'safeguarding.record'),
    ('school.headteacher', 'safeguarding.manage'),
    ('school.headteacher', 'safeguarding.assign'),
    ('school.teacher', 'behaviour.read_assigned'),
    ('school.teacher', 'behaviour.record'),
    ('school.teacher', 'behaviour.positive.record')
) as x(role_key, perm)
  on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Notification types
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
    'general'
  ));

-- ---------------------------------------------------------------------------
-- Catalogues
-- ---------------------------------------------------------------------------

create table behaviour_incident_categories (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order int not null default 0,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create table behaviour_action_categories (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order int not null default 0,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create table positive_behaviour_categories (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order int not null default 0,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create table behaviour_locations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order int not null default 0,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create table pastoral_concern_categories (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order int not null default 0,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create table safeguarding_concern_categories (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order int not null default 0,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, key)
);

-- ---------------------------------------------------------------------------
-- Behaviour incidents
-- ---------------------------------------------------------------------------

create table behaviour_incidents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  occurred_at timestamptz not null,
  category_id uuid not null references behaviour_incident_categories (id),
  location_id uuid references behaviour_locations (id),
  class_id uuid references classes (id),
  description text not null check (char_length(trim(description)) between 1 and 8000),
  severity text not null default 'low' check (severity in ('low', 'medium', 'high')),
  action_taken text check (action_taken is null or char_length(trim(action_taken)) between 1 and 4000),
  follow_up_required boolean not null default false,
  follow_up_due_on date,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  parent_visible boolean not null default false,
  student_visible boolean not null default false,
  parent_contacted boolean not null default false,
  parent_contacted_at timestamptz,
  parent_contact_summary text check (parent_contact_summary is null or char_length(parent_contact_summary) <= 500),
  recorded_by uuid not null references users (id),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (follow_up_due_on is null or follow_up_required)
);

create index behaviour_incidents_org_student_idx
  on behaviour_incidents (organisation_id, student_profile_id, occurred_at desc);
create index behaviour_incidents_org_status_idx
  on behaviour_incidents (organisation_id, status, occurred_at desc);

create table behaviour_incident_related_pupils (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  incident_id uuid not null references behaviour_incidents (id) on delete cascade,
  student_profile_id uuid not null references student_profiles (id),
  created_at timestamptz not null default now(),
  unique (incident_id, student_profile_id)
);

create table behaviour_incident_witnesses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  incident_id uuid not null references behaviour_incidents (id) on delete cascade,
  student_profile_id uuid references student_profiles (id),
  staff_user_id uuid references users (id),
  display_name text check (display_name is null or char_length(trim(display_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  check (
    (student_profile_id is not null and staff_user_id is null)
    or (student_profile_id is null and staff_user_id is not null)
    or (student_profile_id is null and staff_user_id is null and display_name is not null)
  )
);

create table behaviour_incident_revisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  incident_id uuid not null references behaviour_incidents (id),
  actor_user_id uuid references users (id),
  changed_fields text[] not null default '{}',
  previous_status text,
  new_status text,
  created_at timestamptz not null default now()
);

create table behaviour_actions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  incident_id uuid references behaviour_incidents (id),
  category_id uuid not null references behaviour_action_categories (id),
  notes text check (notes is null or char_length(notes) <= 4000),
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  action_on date not null,
  completed_on date,
  parent_contacted boolean not null default false,
  parent_contacted_at timestamptz,
  parent_contact_summary text check (parent_contact_summary is null or char_length(parent_contact_summary) <= 500),
  recorded_by uuid not null references users (id),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index behaviour_actions_org_student_idx
  on behaviour_actions (organisation_id, student_profile_id, action_on desc);

create table behaviour_action_revisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  action_id uuid not null references behaviour_actions (id),
  actor_user_id uuid references users (id),
  previous_status text,
  new_status text,
  created_at timestamptz not null default now()
);

create table positive_behaviour_records (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  occurred_on date not null,
  category_id uuid not null references positive_behaviour_categories (id),
  class_id uuid references classes (id),
  description text check (description is null or char_length(description) <= 2000),
  parent_visible boolean not null default false,
  student_visible boolean not null default false,
  recorded_by uuid not null references users (id),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index positive_behaviour_org_student_idx
  on positive_behaviour_records (organisation_id, student_profile_id, occurred_on desc);

-- ---------------------------------------------------------------------------
-- Pastoral
-- ---------------------------------------------------------------------------

create table pastoral_concerns (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  category_id uuid not null references pastoral_concern_categories (id),
  concern_on date not null,
  summary text not null check (char_length(trim(summary)) between 1 and 240),
  detailed_notes text check (detailed_notes is null or char_length(detailed_notes) <= 8000),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  assigned_staff_user_id uuid references users (id),
  status text not null default 'open' check (status in ('open', 'monitoring', 'resolved', 'closed')),
  follow_up_due_on date,
  attendance_related boolean not null default false,
  attendance_from date,
  attendance_to date,
  parent_contacted boolean not null default false,
  parent_contacted_at timestamptz,
  parent_contact_summary text check (parent_contact_summary is null or char_length(parent_contact_summary) <= 500),
  raised_by uuid not null references users (id),
  raised_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pastoral_concerns_org_student_idx
  on pastoral_concerns (organisation_id, student_profile_id, concern_on desc);
create index pastoral_concerns_org_status_idx
  on pastoral_concerns (organisation_id, status, follow_up_due_on);

create table pastoral_concern_revisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  concern_id uuid not null references pastoral_concerns (id),
  actor_user_id uuid references users (id),
  previous_status text,
  new_status text,
  previous_assigned_staff_user_id uuid,
  new_assigned_staff_user_id uuid,
  created_at timestamptz not null default now()
);

create table pastoral_interventions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  concern_id uuid not null references pastoral_concerns (id),
  intervention_type text not null check (intervention_type in (
    'pupil_meeting', 'parent_meeting', 'parent_contact', 'mentoring',
    'support_plan', 'internal_referral', 'review'
  )),
  responsible_staff_user_id uuid not null references users (id),
  action_on date not null,
  outcome text check (outcome is null or char_length(outcome) <= 4000),
  next_review_on date,
  notes text check (notes is null or char_length(notes) <= 4000),
  recorded_by uuid not null references users (id),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pastoral_record_attachments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  parent_kind text not null check (parent_kind in (
    'incident', 'positive', 'action', 'pastoral_concern', 'pastoral_intervention'
  )),
  parent_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  storage_backend text not null default 'unconfigured',
  storage_key text,
  content_type text,
  byte_size int,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Safeguarding (separate category; stricter access)
-- ---------------------------------------------------------------------------

create table safeguarding_concerns (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  arose_at timestamptz not null,
  category_id uuid not null references safeguarding_concern_categories (id),
  factual_description text not null check (char_length(trim(factual_description)) between 1 and 8000),
  immediate_action_taken text check (immediate_action_taken is null or char_length(immediate_action_taken) <= 4000),
  assigned_safeguarding_lead_user_id uuid references users (id),
  status text not null default 'open' check (status in ('open', 'monitoring', 'referred_internal', 'closed')),
  follow_up_due_on date,
  recorded_by uuid not null references users (id),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index safeguarding_concerns_org_student_idx
  on safeguarding_concerns (organisation_id, student_profile_id, arose_at desc);
create index safeguarding_concerns_org_status_idx
  on safeguarding_concerns (organisation_id, status, follow_up_due_on);

create table safeguarding_concern_revisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  concern_id uuid not null references safeguarding_concerns (id),
  actor_user_id uuid references users (id),
  previous_status text,
  new_status text,
  previous_assigned_user_id uuid,
  new_assigned_user_id uuid,
  created_at timestamptz not null default now()
);

create table safeguarding_chronology_entries (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  concern_id uuid not null references safeguarding_concerns (id),
  occurred_at timestamptz not null,
  entry_type text not null check (entry_type in (
    'note', 'action', 'decision', 'contact', 'review', 'amendment'
  )),
  factual_note text not null check (char_length(trim(factual_note)) between 1 and 8000),
  action_outcome text check (action_outcome is null or char_length(action_outcome) <= 4000),
  actor_user_id uuid not null references users (id),
  amendment_of_id uuid references safeguarding_chronology_entries (id),
  superseded boolean not null default false,
  recorded_at timestamptz not null default now()
);

create index safeguarding_chronology_concern_idx
  on safeguarding_chronology_entries (organisation_id, concern_id, occurred_at);

create table safeguarding_attachments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  concern_id uuid not null references safeguarding_concerns (id),
  chronology_entry_id uuid references safeguarding_chronology_entries (id),
  title text not null check (char_length(trim(title)) between 1 and 200),
  storage_backend text not null default 'unconfigured',
  storage_key text,
  content_type text,
  byte_size int,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

select install_tenant_isolation('behaviour_incident_categories');
select install_tenant_isolation('behaviour_action_categories');
select install_tenant_isolation('positive_behaviour_categories');
select install_tenant_isolation('behaviour_locations');
select install_tenant_isolation('pastoral_concern_categories');
select install_tenant_isolation('safeguarding_concern_categories');
select install_tenant_isolation('behaviour_incidents');
select install_tenant_isolation('behaviour_incident_related_pupils');
select install_tenant_isolation('behaviour_incident_witnesses');
select install_tenant_isolation('behaviour_incident_revisions');
select install_tenant_isolation('behaviour_actions');
select install_tenant_isolation('behaviour_action_revisions');
select install_tenant_isolation('positive_behaviour_records');
select install_tenant_isolation('pastoral_concerns');
select install_tenant_isolation('pastoral_concern_revisions');
select install_tenant_isolation('pastoral_interventions');
select install_tenant_isolation('pastoral_record_attachments');

-- Safeguarding tables: tenant match AND an explicit safeguarding capability.
-- Permissive policies OR together, so these are written as a single policy
-- rather than stacking on install_tenant_isolation.
create or replace function safeguarding_row_allowed(p_organisation_id uuid)
returns boolean
language sql
stable
as $$
  select
    app_tenant_matches(p_organisation_id)
    and (
      actor_has_permission(app_current_user_id(), p_organisation_id, 'safeguarding.read')
      or actor_has_permission(app_current_user_id(), p_organisation_id, 'safeguarding.record')
      or actor_has_permission(app_current_user_id(), p_organisation_id, 'safeguarding.manage')
      or actor_has_permission(app_current_user_id(), p_organisation_id, 'safeguarding.assign')
    );
$$;

revoke all on function safeguarding_row_allowed(uuid) from public;
grant execute on function safeguarding_row_allowed(uuid) to schoolapp_app;

create or replace function install_safeguarding_isolation(p_table regclass)
returns void
language plpgsql
as $$
declare
  v_name text := p_table::text;
  v_policy text := replace(v_name, '.', '_') || '_safeguarding_isolation';
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('alter table %s force row level security', p_table);
  execute format('drop policy if exists %I on %s', v_policy, p_table);
  execute format(
    $sql$
      create policy %I on %s
      for all
      using (safeguarding_row_allowed(organisation_id))
      with check (safeguarding_row_allowed(organisation_id))
    $sql$,
    v_policy,
    p_table
  );
end;
$$;

select install_safeguarding_isolation('safeguarding_concerns');
select install_safeguarding_isolation('safeguarding_concern_revisions');
select install_safeguarding_isolation('safeguarding_chronology_entries');
select install_safeguarding_isolation('safeguarding_attachments');

grant select, insert, update, delete on behaviour_incident_categories to schoolapp_app;
grant select, insert, update, delete on behaviour_action_categories to schoolapp_app;
grant select, insert, update, delete on positive_behaviour_categories to schoolapp_app;
grant select, insert, update, delete on behaviour_locations to schoolapp_app;
grant select, insert, update, delete on pastoral_concern_categories to schoolapp_app;
grant select, insert, update, delete on safeguarding_concern_categories to schoolapp_app;
grant select, insert, update, delete on behaviour_incidents to schoolapp_app;
grant select, insert, delete on behaviour_incident_related_pupils to schoolapp_app;
grant select, insert, delete on behaviour_incident_witnesses to schoolapp_app;
grant select, insert on behaviour_incident_revisions to schoolapp_app;
grant select, insert, update, delete on behaviour_actions to schoolapp_app;
grant select, insert on behaviour_action_revisions to schoolapp_app;
grant select, insert, update, delete on positive_behaviour_records to schoolapp_app;
grant select, insert, update, delete on pastoral_concerns to schoolapp_app;
grant select, insert on pastoral_concern_revisions to schoolapp_app;
grant select, insert, update, delete on pastoral_interventions to schoolapp_app;
grant select, insert, update, delete on pastoral_record_attachments to schoolapp_app;
grant select, insert, update on safeguarding_concerns to schoolapp_app;
grant select, insert on safeguarding_concern_revisions to schoolapp_app;
grant select, insert, update on safeguarding_chronology_entries to schoolapp_app;
grant select, insert on safeguarding_attachments to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

create or replace function phase11_same_org_student(p_organisation_id uuid, p_student_id uuid)
returns void
language plpgsql
as $$
begin
  if p_student_id is not null and not exists (
    select 1 from student_profiles s
    where s.id = p_student_id and s.organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
end;
$$;

create or replace function phase11_same_org_class(p_organisation_id uuid, p_class_id uuid)
returns void
language plpgsql
as $$
begin
  if p_class_id is not null and not exists (
    select 1 from classes c
    where c.id = p_class_id and c.organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
end;
$$;

create or replace function phase11_same_org_staff(p_organisation_id uuid, p_user_id uuid)
returns void
language plpgsql
as $$
begin
  if p_user_id is not null and not exists (
    select 1
    from organisation_memberships m
    where m.organisation_id = p_organisation_id
      and m.user_id = p_user_id
      and m.status = 'active'
      and m.ended_at is null
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
end;
$$;

create or replace function phase11_lock_recorded_by()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.organisation_id := old.organisation_id;
    new.recorded_by := old.recorded_by;
    new.recorded_at := old.recorded_at;
  elsif app_current_user_id() is not null then
    new.recorded_by := app_current_user_id();
    new.recorded_at := coalesce(new.recorded_at, now());
  elsif new.recorded_by is null then
    raise exception 'behaviour_actor_required' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function phase11_lock_raised_by()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.organisation_id := old.organisation_id;
    new.raised_by := old.raised_by;
    new.raised_at := old.raised_at;
  elsif app_current_user_id() is not null then
    new.raised_by := app_current_user_id();
    new.raised_at := coalesce(new.raised_at, now());
  elsif new.raised_by is null then
    raise exception 'pastoral_actor_required' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function behaviour_incidents_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  perform phase11_same_org_student(new.organisation_id, new.student_profile_id);
  perform phase11_same_org_class(new.organisation_id, new.class_id);
  if not exists (
    select 1 from behaviour_incident_categories c
    where c.id = new.category_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.location_id is not null and not exists (
    select 1 from behaviour_locations l
    where l.id = new.location_id and l.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if old.status = 'closed' then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
    if old.status = 'open' and new.status not in ('open', 'in_progress', 'resolved', 'closed') then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
    if old.status = 'in_progress' and new.status not in ('open', 'in_progress', 'resolved', 'closed') then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
    if old.status = 'resolved' and new.status not in ('open', 'resolved', 'closed') then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists behaviour_incidents_actor_tg on behaviour_incidents;
create trigger behaviour_incidents_actor_tg
  before insert or update on behaviour_incidents
  for each row execute function phase11_lock_recorded_by();

drop trigger if exists behaviour_incidents_integrity_tg on behaviour_incidents;
create trigger behaviour_incidents_integrity_tg
  before insert or update on behaviour_incidents
  for each row execute function behaviour_incidents_integrity_tg();

drop trigger if exists behaviour_incidents_updated_at on behaviour_incidents;
create trigger behaviour_incidents_updated_at
  before update on behaviour_incidents
  for each row execute function set_updated_at();

create or replace function behaviour_incidents_history_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status
     or old.severity is distinct from new.severity
     or old.description is distinct from new.description then
    insert into behaviour_incident_revisions (
      organisation_id, incident_id, actor_user_id, previous_status, new_status, changed_fields
    ) values (
      new.organisation_id,
      new.id,
      coalesce(app_current_user_id(), new.recorded_by),
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      case
        when tg_op = 'INSERT' then array['created']
        else array_remove(array[
          case when old.status is distinct from new.status then 'status' end,
          case when old.severity is distinct from new.severity then 'severity' end,
          case when old.description is distinct from new.description then 'description' end
        ], null)
      end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists behaviour_incidents_history_tg on behaviour_incidents;
create trigger behaviour_incidents_history_tg
  after insert or update on behaviour_incidents
  for each row execute function behaviour_incidents_history_tg();

create or replace function behaviour_related_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from behaviour_incidents i
    where i.id = new.incident_id and i.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  perform phase11_same_org_student(new.organisation_id, new.student_profile_id);
  if exists (
    select 1 from behaviour_incidents i
    where i.id = new.incident_id and i.student_profile_id = new.student_profile_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists behaviour_incident_related_pupils_same_org_tg on behaviour_incident_related_pupils;
create trigger behaviour_incident_related_pupils_same_org_tg
  before insert or update on behaviour_incident_related_pupils
  for each row execute function behaviour_related_same_org_tg();

create or replace function behaviour_witness_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from behaviour_incidents i
    where i.id = new.incident_id and i.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  perform phase11_same_org_student(new.organisation_id, new.student_profile_id);
  perform phase11_same_org_staff(new.organisation_id, new.staff_user_id);
  return new;
end;
$$;

drop trigger if exists behaviour_incident_witnesses_same_org_tg on behaviour_incident_witnesses;
create trigger behaviour_incident_witnesses_same_org_tg
  before insert or update on behaviour_incident_witnesses
  for each row execute function behaviour_witness_same_org_tg();

create or replace function behaviour_actions_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  perform phase11_same_org_student(new.organisation_id, new.student_profile_id);
  if new.incident_id is not null and not exists (
    select 1 from behaviour_incidents i
    where i.id = new.incident_id
      and i.organisation_id = new.organisation_id
      and i.student_profile_id = new.student_profile_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from behaviour_action_categories c
    where c.id = new.category_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if old.status in ('completed', 'cancelled') then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists behaviour_actions_actor_tg on behaviour_actions;
create trigger behaviour_actions_actor_tg
  before insert or update on behaviour_actions
  for each row execute function phase11_lock_recorded_by();

drop trigger if exists behaviour_actions_integrity_tg on behaviour_actions;
create trigger behaviour_actions_integrity_tg
  before insert or update on behaviour_actions
  for each row execute function behaviour_actions_integrity_tg();

drop trigger if exists behaviour_actions_updated_at on behaviour_actions;
create trigger behaviour_actions_updated_at
  before update on behaviour_actions
  for each row execute function set_updated_at();

create or replace function behaviour_actions_history_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into behaviour_action_revisions (
      organisation_id, action_id, actor_user_id, previous_status, new_status
    ) values (
      new.organisation_id,
      new.id,
      coalesce(app_current_user_id(), new.recorded_by),
      case when tg_op = 'INSERT' then null else old.status end,
      new.status
    );
  end if;
  return new;
end;
$$;

drop trigger if exists behaviour_actions_history_tg on behaviour_actions;
create trigger behaviour_actions_history_tg
  after insert or update on behaviour_actions
  for each row execute function behaviour_actions_history_tg();

create or replace function positive_behaviour_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  perform phase11_same_org_student(new.organisation_id, new.student_profile_id);
  perform phase11_same_org_class(new.organisation_id, new.class_id);
  if not exists (
    select 1 from positive_behaviour_categories c
    where c.id = new.category_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists positive_behaviour_actor_tg on positive_behaviour_records;
create trigger positive_behaviour_actor_tg
  before insert or update on positive_behaviour_records
  for each row execute function phase11_lock_recorded_by();

drop trigger if exists positive_behaviour_integrity_tg on positive_behaviour_records;
create trigger positive_behaviour_integrity_tg
  before insert or update on positive_behaviour_records
  for each row execute function positive_behaviour_integrity_tg();

drop trigger if exists positive_behaviour_updated_at on positive_behaviour_records;
create trigger positive_behaviour_updated_at
  before update on positive_behaviour_records
  for each row execute function set_updated_at();

create or replace function pastoral_concerns_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  perform phase11_same_org_student(new.organisation_id, new.student_profile_id);
  perform phase11_same_org_staff(new.organisation_id, new.assigned_staff_user_id);
  if not exists (
    select 1 from pastoral_concern_categories c
    where c.id = new.category_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if old.status = 'closed' then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pastoral_concerns_actor_tg on pastoral_concerns;
create trigger pastoral_concerns_actor_tg
  before insert or update on pastoral_concerns
  for each row execute function phase11_lock_raised_by();

drop trigger if exists pastoral_concerns_integrity_tg on pastoral_concerns;
create trigger pastoral_concerns_integrity_tg
  before insert or update on pastoral_concerns
  for each row execute function pastoral_concerns_integrity_tg();

drop trigger if exists pastoral_concerns_updated_at on pastoral_concerns;
create trigger pastoral_concerns_updated_at
  before update on pastoral_concerns
  for each row execute function set_updated_at();

create or replace function pastoral_concerns_history_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT'
     or old.status is distinct from new.status
     or old.assigned_staff_user_id is distinct from new.assigned_staff_user_id then
    insert into pastoral_concern_revisions (
      organisation_id, concern_id, actor_user_id,
      previous_status, new_status, previous_assigned_staff_user_id, new_assigned_staff_user_id
    ) values (
      new.organisation_id,
      new.id,
      coalesce(app_current_user_id(), new.raised_by),
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      case when tg_op = 'INSERT' then null else old.assigned_staff_user_id end,
      new.assigned_staff_user_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists pastoral_concerns_history_tg on pastoral_concerns;
create trigger pastoral_concerns_history_tg
  after insert or update on pastoral_concerns
  for each row execute function pastoral_concerns_history_tg();

create or replace function pastoral_interventions_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from pastoral_concerns c
    where c.id = new.concern_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  perform phase11_same_org_staff(new.organisation_id, new.responsible_staff_user_id);
  return new;
end;
$$;

drop trigger if exists pastoral_interventions_actor_tg on pastoral_interventions;
create trigger pastoral_interventions_actor_tg
  before insert or update on pastoral_interventions
  for each row execute function phase11_lock_recorded_by();

drop trigger if exists pastoral_interventions_integrity_tg on pastoral_interventions;
create trigger pastoral_interventions_integrity_tg
  before insert or update on pastoral_interventions
  for each row execute function pastoral_interventions_integrity_tg();

drop trigger if exists pastoral_interventions_updated_at on pastoral_interventions;
create trigger pastoral_interventions_updated_at
  before update on pastoral_interventions
  for each row execute function set_updated_at();

create or replace function safeguarding_concerns_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  perform phase11_same_org_student(new.organisation_id, new.student_profile_id);
  perform phase11_same_org_staff(new.organisation_id, new.assigned_safeguarding_lead_user_id);
  if not exists (
    select 1 from safeguarding_concern_categories c
    where c.id = new.category_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if old.status = 'closed' then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists safeguarding_concerns_actor_tg on safeguarding_concerns;
create trigger safeguarding_concerns_actor_tg
  before insert or update on safeguarding_concerns
  for each row execute function phase11_lock_recorded_by();

drop trigger if exists safeguarding_concerns_integrity_tg on safeguarding_concerns;
create trigger safeguarding_concerns_integrity_tg
  before insert or update on safeguarding_concerns
  for each row execute function safeguarding_concerns_integrity_tg();

drop trigger if exists safeguarding_concerns_updated_at on safeguarding_concerns;
create trigger safeguarding_concerns_updated_at
  before update on safeguarding_concerns
  for each row execute function set_updated_at();

create or replace function safeguarding_concerns_history_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT'
     or old.status is distinct from new.status
     or old.assigned_safeguarding_lead_user_id is distinct from new.assigned_safeguarding_lead_user_id then
    insert into safeguarding_concern_revisions (
      organisation_id, concern_id, actor_user_id,
      previous_status, new_status, previous_assigned_user_id, new_assigned_user_id
    ) values (
      new.organisation_id,
      new.id,
      coalesce(app_current_user_id(), new.recorded_by),
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      case when tg_op = 'INSERT' then null else old.assigned_safeguarding_lead_user_id end,
      new.assigned_safeguarding_lead_user_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists safeguarding_concerns_history_tg on safeguarding_concerns;
create trigger safeguarding_concerns_history_tg
  after insert or update on safeguarding_concerns
  for each row execute function safeguarding_concerns_history_tg();

create or replace function safeguarding_chronology_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if old.actor_user_id is distinct from new.actor_user_id
       or old.recorded_at is distinct from new.recorded_at
       or old.concern_id is distinct from new.concern_id
       or old.organisation_id is distinct from new.organisation_id
       or old.factual_note is distinct from new.factual_note
       or old.occurred_at is distinct from new.occurred_at
       or old.entry_type is distinct from new.entry_type then
      raise exception 'safeguarding_history_immutable' using errcode = '23514';
    end if;
    return new;
  end if;
  if not exists (
    select 1 from safeguarding_concerns c
    where c.id = new.concern_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.amendment_of_id is not null then
    if not exists (
      select 1 from safeguarding_chronology_entries e
      where e.id = new.amendment_of_id
        and e.organisation_id = new.organisation_id
        and e.concern_id = new.concern_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    update safeguarding_chronology_entries
       set superseded = true
     where id = new.amendment_of_id
       and organisation_id = new.organisation_id;
  end if;
  if app_current_user_id() is not null then
    new.actor_user_id := app_current_user_id();
    new.recorded_at := now();
  elsif new.actor_user_id is null then
    raise exception 'safeguarding_actor_required' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists safeguarding_chronology_integrity_tg on safeguarding_chronology_entries;
create trigger safeguarding_chronology_integrity_tg
  before insert or update on safeguarding_chronology_entries
  for each row execute function safeguarding_chronology_integrity_tg();

create or replace function safeguarding_attachments_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from safeguarding_concerns c
    where c.id = new.concern_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.chronology_entry_id is not null and not exists (
    select 1 from safeguarding_chronology_entries e
    where e.id = new.chronology_entry_id
      and e.organisation_id = new.organisation_id
      and e.concern_id = new.concern_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if app_current_user_id() is not null then
    new.created_by := app_current_user_id();
  end if;
  return new;
end;
$$;

drop trigger if exists safeguarding_attachments_same_org_tg on safeguarding_attachments;
create trigger safeguarding_attachments_same_org_tg
  before insert or update on safeguarding_attachments
  for each row execute function safeguarding_attachments_same_org_tg();

-- ---------------------------------------------------------------------------
-- Org defaults (SECURITY DEFINER, tenant re-check)
-- ---------------------------------------------------------------------------

create or replace function ensure_organisation_phase11_defaults(p_organisation_id uuid)
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
  if app_current_user_id() is not null and not app_is_platform_admin() and not exists (
    select 1 from organisation_memberships m
    where m.organisation_id = p_organisation_id
      and m.user_id = app_current_user_id()
      and m.status = 'active'
      and m.ended_at is null
  ) then
    raise exception 'tenant_context_membership_required' using errcode = '42501';
  end if;

  insert into behaviour_incident_categories (organisation_id, key, name, sort_order, is_system)
  values
    (p_organisation_id, 'disruption', 'Disruption', 1, true),
    (p_organisation_id, 'defiance', 'Defiance', 2, true),
    (p_organisation_id, 'unkindness', 'Unkindness', 3, true),
    (p_organisation_id, 'physical_incident', 'Physical incident', 4, true),
    (p_organisation_id, 'unsafe_behaviour', 'Unsafe behaviour', 5, true),
    (p_organisation_id, 'late_to_lesson', 'Late to lesson', 6, true),
    (p_organisation_id, 'equipment', 'Equipment', 7, true),
    (p_organisation_id, 'other', 'Other', 8, true)
  on conflict (organisation_id, key) do nothing;

  insert into behaviour_action_categories (organisation_id, key, name, sort_order, is_system)
  values
    (p_organisation_id, 'verbal_warning', 'Verbal warning', 1, true),
    (p_organisation_id, 'parent_contact', 'Parent contact', 2, true),
    (p_organisation_id, 'detention', 'Detention', 3, true),
    (p_organisation_id, 'restorative_conversation', 'Restorative conversation', 4, true),
    (p_organisation_id, 'loss_of_privilege', 'Loss of privilege', 5, true),
    (p_organisation_id, 'internal_intervention', 'Internal intervention', 6, true),
    (p_organisation_id, 'suspension_placeholder', 'Suspension (placeholder)', 7, true),
    (p_organisation_id, 'exclusion_placeholder', 'Exclusion (placeholder)', 8, true)
  on conflict (organisation_id, key) do nothing;

  insert into positive_behaviour_categories (organisation_id, key, name, sort_order, is_system)
  values
    (p_organisation_id, 'praise', 'Praise', 1, true),
    (p_organisation_id, 'merit', 'Merit', 2, true),
    (p_organisation_id, 'excellent_work', 'Excellent work', 3, true),
    (p_organisation_id, 'kindness', 'Kindness', 4, true),
    (p_organisation_id, 'leadership', 'Leadership', 5, true),
    (p_organisation_id, 'effort', 'Effort', 6, true),
    (p_organisation_id, 'attendance_achievement', 'Attendance achievement', 7, true)
  on conflict (organisation_id, key) do nothing;

  insert into behaviour_locations (organisation_id, key, name, sort_order, is_system)
  values
    (p_organisation_id, 'classroom', 'Classroom', 1, true),
    (p_organisation_id, 'playground', 'Playground', 2, true),
    (p_organisation_id, 'corridor', 'Corridor', 3, true),
    (p_organisation_id, 'dining_hall', 'Dining hall', 4, true),
    (p_organisation_id, 'assembly', 'Assembly', 5, true),
    (p_organisation_id, 'trip', 'Trip', 6, true),
    (p_organisation_id, 'other', 'Other', 7, true)
  on conflict (organisation_id, key) do nothing;

  insert into pastoral_concern_categories (organisation_id, key, name, sort_order, is_system)
  values
    (p_organisation_id, 'wellbeing', 'Wellbeing', 1, true),
    (p_organisation_id, 'attendance_concern', 'Attendance concern', 2, true),
    (p_organisation_id, 'friendship', 'Friendship / social', 3, true),
    (p_organisation_id, 'emotional_support', 'Emotional support', 4, true),
    (p_organisation_id, 'family_circumstance', 'Family circumstance', 5, true),
    (p_organisation_id, 'engagement', 'Engagement', 6, true),
    (p_organisation_id, 'repeated_behaviour', 'Repeated behaviour pattern', 7, true)
  on conflict (organisation_id, key) do nothing;

  insert into safeguarding_concern_categories (organisation_id, key, name, sort_order, is_system)
  values
    (p_organisation_id, 'general_concern', 'General concern', 1, true),
    (p_organisation_id, 'wellbeing_safety', 'Wellbeing / safety', 2, true),
    (p_organisation_id, 'disclosure', 'Disclosure', 3, true),
    (p_organisation_id, 'unexplained_injury', 'Unexplained injury', 4, true),
    (p_organisation_id, 'change_in_presentation', 'Change in presentation', 5, true),
    (p_organisation_id, 'home_circumstance', 'Home circumstance', 6, true),
    (p_organisation_id, 'other', 'Other', 7, true)
  on conflict (organisation_id, key) do nothing;
end;
$$;

revoke all on function ensure_organisation_phase11_defaults(uuid) from public;
grant execute on function ensure_organisation_phase11_defaults(uuid) to schoolapp_app;

create or replace function organisations_phase11_defaults_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform ensure_organisation_phase11_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists organisations_phase11_defaults_tg on organisations;
create trigger organisations_phase11_defaults_tg
  after insert on organisations
  for each row execute function organisations_phase11_defaults_tg();

select ensure_organisation_phase11_defaults(id) from organisations;
