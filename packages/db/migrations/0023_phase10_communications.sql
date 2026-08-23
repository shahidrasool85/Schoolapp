-- Phase 10: Communications, announcements, and school calendar.
-- Additive. Does not weaken FORCE RLS, tenant context, hostname tenancy,
-- membership revalidation, teacher assigned-only access, guardianship /
-- portal_access, student self-only access, student portal policy, current
-- primary-enrolment checks, break-glass, or audit controls.
-- Treats migrations 0001–0022 as immutable.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('announcements.read', 'School-wide announcement read / oversight'),
  ('announcements.read_assigned', 'Read announcements relevant to assigned classes, pupils, or staff audience'),
  ('announcements.manage', 'School-wide announcement create / edit / archive'),
  ('announcements.manage_assigned', 'Create and manage own announcements for assigned classes and pupils'),
  ('announcements.publish', 'Publish or schedule announcements'),
  ('announcements.broadcast', 'Target whole-school / all-staff / all-parent / all-student / year-group audiences'),
  ('announcements.acknowledgements.read', 'Read acknowledgement and read-state reporting'),
  ('announcements.read_own_children', 'Parent: read authorised children''s announcements'),
  ('announcements.read_self', 'Student: read own relevant announcements'),
  ('calendar.read', 'School-wide calendar read / oversight'),
  ('calendar.read_assigned', 'Read calendar events relevant to assigned classes, pupils, or staff audience'),
  ('calendar.manage', 'School-wide calendar create / edit'),
  ('calendar.manage_assigned', 'Create and manage own calendar events for assigned classes and pupils'),
  ('calendar.manage_school', 'School-wide calendar management including holidays and whole-school events'),
  ('calendar.read_own_children', 'Parent: read authorised children''s calendar events'),
  ('calendar.read_self', 'Student: read own relevant calendar events')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'announcements.read'),
    ('school.admin', 'announcements.manage'),
    ('school.admin', 'announcements.publish'),
    ('school.admin', 'announcements.broadcast'),
    ('school.admin', 'announcements.acknowledgements.read'),
    ('school.admin', 'calendar.read'),
    ('school.admin', 'calendar.manage'),
    ('school.admin', 'calendar.manage_school'),
    ('school.headteacher', 'announcements.read'),
    ('school.headteacher', 'announcements.manage'),
    ('school.headteacher', 'announcements.publish'),
    ('school.headteacher', 'announcements.broadcast'),
    ('school.headteacher', 'announcements.acknowledgements.read'),
    ('school.headteacher', 'calendar.read'),
    ('school.headteacher', 'calendar.manage'),
    ('school.headteacher', 'calendar.manage_school'),
    ('school.teacher', 'announcements.read_assigned'),
    ('school.teacher', 'announcements.manage_assigned'),
    ('school.teacher', 'calendar.read_assigned'),
    ('school.teacher', 'calendar.manage_assigned'),
    ('school.admissions', 'announcements.read_assigned'),
    ('school.admissions', 'calendar.read_assigned'),
    ('school.staff', 'announcements.read_assigned'),
    ('school.staff', 'calendar.read_assigned'),
    ('school.parent', 'announcements.read_own_children'),
    ('school.parent', 'calendar.read_own_children'),
    ('school.student', 'announcements.read_self'),
    ('school.student', 'calendar.read_self')
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
    'general'
  ));

-- ---------------------------------------------------------------------------
-- Event type catalogue
-- ---------------------------------------------------------------------------

create table school_event_types (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null
    check (key in (
      'school_holiday',
      'inset_day',
      'parents_evening',
      'assembly',
      'sports_day',
      'open_day',
      'trip',
      'exam',
      'class_event',
      'club',
      'meeting'
    ) or key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order int not null default 0,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organisation_id, key)
);

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------

create table announcements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  title text not null check (char_length(trim(title)) between 1 and 200),
  body text not null check (char_length(trim(body)) between 1 and 20000),
  priority text not null default 'normal'
    check (priority in ('normal', 'important', 'urgent')),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'published', 'expired', 'archived')),
  publish_at timestamptz,
  published_at timestamptz,
  published_by uuid references users (id),
  expires_at timestamptz,
  acknowledgement_required boolean not null default false,
  pinned boolean not null default false,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references users (id),
  check (expires_at is null or publish_at is null or expires_at > publish_at),
  check (status <> 'scheduled' or publish_at is not null)
);

create index announcements_org_status_idx
  on announcements (organisation_id, status, publish_at desc);

create table announcement_status_history (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  announcement_id uuid not null references announcements (id),
  previous_status text,
  new_status text not null,
  actor_user_id uuid references users (id),
  created_at timestamptz not null default now()
);

create table announcement_targets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  announcement_id uuid not null references announcements (id) on delete cascade,
  target_type text not null check (target_type in (
    'whole_school', 'staff', 'parents', 'students', 'year_group', 'class', 'student', 'staff_member'
  )),
  class_id uuid references classes (id),
  year_group_id uuid references year_groups (id),
  student_profile_id uuid references student_profiles (id),
  staff_user_id uuid references users (id),
  created_at timestamptz not null default now(),
  created_by uuid references users (id),
  check (
    (target_type = 'whole_school' and class_id is null and year_group_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'staff' and class_id is null and year_group_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'parents' and class_id is null and year_group_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'students' and class_id is null and year_group_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'year_group' and year_group_id is not null and class_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'class' and class_id is not null and year_group_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'student' and student_profile_id is not null and class_id is null and year_group_id is null and staff_user_id is null)
    or (target_type = 'staff_member' and staff_user_id is not null and class_id is null and year_group_id is null and student_profile_id is null)
  )
);

create unique index announcement_targets_audience_uq
  on announcement_targets (announcement_id, target_type)
  where target_type in ('whole_school', 'staff', 'parents', 'students');
create unique index announcement_targets_class_uq
  on announcement_targets (announcement_id, class_id)
  where class_id is not null;
create unique index announcement_targets_year_group_uq
  on announcement_targets (announcement_id, year_group_id)
  where year_group_id is not null;
create unique index announcement_targets_student_uq
  on announcement_targets (announcement_id, student_profile_id)
  where student_profile_id is not null;
create unique index announcement_targets_staff_uq
  on announcement_targets (announcement_id, staff_user_id)
  where staff_user_id is not null;

create table announcement_recipients (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  announcement_id uuid not null references announcements (id) on delete cascade,
  user_id uuid not null references users (id),
  audience_role text not null check (audience_role in ('staff', 'parent', 'student')),
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  acknowledged_at timestamptz,
  unique (announcement_id, user_id)
);

create index announcement_recipients_user_idx
  on announcement_recipients (organisation_id, user_id, announcement_id);

create table announcement_recipient_subjects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  announcement_id uuid not null references announcements (id) on delete cascade,
  user_id uuid not null references users (id),
  student_profile_id uuid not null references student_profiles (id),
  class_id uuid references classes (id),
  year_group_id uuid references year_groups (id),
  unique (announcement_id, user_id, student_profile_id)
);

create table announcement_resources (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  announcement_id uuid not null references announcements (id) on delete cascade,
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
  sort_order int not null default 0,
  check (url is not null or storage_key is not null)
);

-- ---------------------------------------------------------------------------
-- School events
-- ---------------------------------------------------------------------------

create table school_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 20000),
  event_type_id uuid not null references school_event_types (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  location text check (location is null or char_length(location) <= 200),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'published', 'cancelled', 'archived')),
  publish_at timestamptz,
  published_at timestamptz,
  published_by uuid references users (id),
  related_kind text not null default 'none'
    check (related_kind in (
      'none', 'academic_year', 'term', 'class', 'year_group',
      'assessment', 'assignment', 'admissions_open_day'
    )),
  related_id uuid,
  resource_url text
    check (resource_url is null or (char_length(resource_url) between 8 and 2000 and resource_url ~* '^https?://')),
  acknowledgement_required boolean not null default false,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references users (id),
  cancelled_at timestamptz,
  cancelled_by uuid references users (id),
  check (ends_at >= starts_at),
  check (status <> 'scheduled' or publish_at is not null),
  check (related_kind = 'none' or related_id is not null)
);

create index school_events_org_range_idx
  on school_events (organisation_id, status, starts_at);

create table school_event_status_history (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  event_id uuid not null references school_events (id),
  previous_status text,
  new_status text not null,
  actor_user_id uuid references users (id),
  created_at timestamptz not null default now()
);

create table school_event_targets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  event_id uuid not null references school_events (id) on delete cascade,
  target_type text not null check (target_type in (
    'whole_school', 'staff', 'parents', 'students', 'year_group', 'class', 'student', 'staff_member'
  )),
  class_id uuid references classes (id),
  year_group_id uuid references year_groups (id),
  student_profile_id uuid references student_profiles (id),
  staff_user_id uuid references users (id),
  created_at timestamptz not null default now(),
  created_by uuid references users (id),
  check (
    (target_type = 'whole_school' and class_id is null and year_group_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'staff' and class_id is null and year_group_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'parents' and class_id is null and year_group_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'students' and class_id is null and year_group_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'year_group' and year_group_id is not null and class_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'class' and class_id is not null and year_group_id is null and student_profile_id is null and staff_user_id is null)
    or (target_type = 'student' and student_profile_id is not null and class_id is null and year_group_id is null and staff_user_id is null)
    or (target_type = 'staff_member' and staff_user_id is not null and class_id is null and year_group_id is null and student_profile_id is null)
  )
);

create unique index school_event_targets_audience_uq
  on school_event_targets (event_id, target_type)
  where target_type in ('whole_school', 'staff', 'parents', 'students');
create unique index school_event_targets_class_uq
  on school_event_targets (event_id, class_id)
  where class_id is not null;
create unique index school_event_targets_year_group_uq
  on school_event_targets (event_id, year_group_id)
  where year_group_id is not null;
create unique index school_event_targets_student_uq
  on school_event_targets (event_id, student_profile_id)
  where student_profile_id is not null;
create unique index school_event_targets_staff_uq
  on school_event_targets (event_id, staff_user_id)
  where staff_user_id is not null;

create table school_event_audience (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  event_id uuid not null references school_events (id) on delete cascade,
  user_id uuid not null references users (id),
  audience_role text not null check (audience_role in ('staff', 'parent', 'student')),
  unique (event_id, user_id)
);

create index school_event_audience_user_idx
  on school_event_audience (organisation_id, user_id, event_id);

create table school_event_audience_subjects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  event_id uuid not null references school_events (id) on delete cascade,
  user_id uuid not null references users (id),
  student_profile_id uuid not null references student_profiles (id),
  class_id uuid references classes (id),
  year_group_id uuid references year_groups (id),
  unique (event_id, user_id, student_profile_id)
);

create table school_event_resources (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  event_id uuid not null references school_events (id) on delete cascade,
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
  sort_order int not null default 0,
  check (url is not null or storage_key is not null)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

select install_tenant_isolation('school_event_types');
select install_tenant_isolation('announcements');
select install_tenant_isolation('announcement_status_history');
select install_tenant_isolation('announcement_targets');
select install_tenant_isolation('announcement_recipient_subjects');
select install_tenant_isolation('announcement_resources');
select install_tenant_isolation('school_events');
select install_tenant_isolation('school_event_status_history');
select install_tenant_isolation('school_event_targets');
select install_tenant_isolation('school_event_audience');
select install_tenant_isolation('school_event_audience_subjects');
select install_tenant_isolation('school_event_resources');

-- Recipient rows: tenant SELECT/INSERT, own-row UPDATE only. Do not also call
-- install_tenant_isolation (permissive policies OR together).
alter table announcement_recipients enable row level security;
alter table announcement_recipients force row level security;

create policy announcement_recipients_select
  on announcement_recipients
  for select
  using (app_tenant_matches(organisation_id));

create policy announcement_recipients_insert
  on announcement_recipients
  for insert
  with check (app_tenant_matches(organisation_id));

create policy announcement_recipients_update_own
  on announcement_recipients
  for update
  using (
    app_tenant_matches(organisation_id)
    and user_id = app_current_user_id()
  )
  with check (
    app_tenant_matches(organisation_id)
    and user_id = app_current_user_id()
  );

grant select, insert, update, delete on school_event_types to schoolapp_app;
grant select, insert, update, delete on announcements to schoolapp_app;
grant select, insert on announcement_status_history to schoolapp_app;
grant select, insert, update, delete on announcement_targets to schoolapp_app;
grant select, insert, delete on announcement_recipients to schoolapp_app;
grant update (read_at, acknowledged_at) on announcement_recipients to schoolapp_app;
grant select, insert, delete on announcement_recipient_subjects to schoolapp_app;
grant select, insert, update, delete on announcement_resources to schoolapp_app;
grant select, insert, update, delete on school_events to schoolapp_app;
grant select, insert on school_event_status_history to schoolapp_app;
grant select, insert, update, delete on school_event_targets to schoolapp_app;
grant select, insert, delete on school_event_audience to schoolapp_app;
grant select, insert, delete on school_event_audience_subjects to schoolapp_app;
grant select, insert, update, delete on school_event_resources to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Same-org + lifecycle helpers
-- ---------------------------------------------------------------------------

create or replace function communication_target_same_org(
  p_organisation_id uuid,
  p_class_id uuid,
  p_year_group_id uuid,
  p_student_profile_id uuid,
  p_staff_user_id uuid
)
returns void
language plpgsql
as $$
begin
  if p_class_id is not null and not exists (
    select 1 from classes c where c.id = p_class_id and c.organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if p_year_group_id is not null and not exists (
    select 1 from year_groups g where g.id = p_year_group_id and g.organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if p_student_profile_id is not null and not exists (
    select 1 from student_profiles s
    where s.id = p_student_profile_id and s.organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if p_staff_user_id is not null and not exists (
    select 1
    from organisation_memberships m
    where m.organisation_id = p_organisation_id
      and m.user_id = p_staff_user_id
      and m.status in ('active', 'invited')
      and m.ended_at is null
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
end;
$$;

create or replace function announcement_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select
    p_from = p_to
    or (p_from = 'draft' and p_to in ('scheduled', 'published', 'archived'))
    or (p_from = 'scheduled' and p_to in ('draft', 'published', 'archived'))
    or (p_from = 'published' and p_to in ('expired', 'archived'))
    or (p_from = 'expired' and p_to in ('archived'));
$$;

create or replace function school_event_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select
    p_from = p_to
    or (p_from = 'draft' and p_to in ('scheduled', 'published', 'cancelled', 'archived'))
    or (p_from = 'scheduled' and p_to in ('draft', 'published', 'cancelled', 'archived'))
    or (p_from = 'published' and p_to in ('cancelled', 'archived'))
    or (p_from = 'cancelled' and p_to in ('archived'));
$$;

create or replace function announcements_write_tg()
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
      raise exception 'communication_actor_required' using errcode = '22023';
    end if;
    new.published_at := null;
    new.published_by := null;
    new.archived_at := null;
    new.archived_by := null;
    new.updated_at := now();
    return new;
  end if;

  new.id := old.id;
  new.organisation_id := old.organisation_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if not announcement_status_allowed(old.status, new.status) then
    raise exception 'invalid_status_transition' using errcode = '23514';
  end if;

  if old.status is distinct from new.status then
    if new.status = 'published' then
      new.published_at := coalesce(old.published_at, now());
      new.published_by := coalesce(v_actor, old.published_by, new.published_by);
    elsif new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := coalesce(v_actor, new.archived_by);
    end if;
  else
    new.published_at := old.published_at;
    new.published_by := old.published_by;
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists announcements_write_tg on announcements;
create trigger announcements_write_tg
  before insert or update on announcements
  for each row execute function announcements_write_tg();

create or replace function announcements_history_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into announcement_status_history (
      organisation_id, announcement_id, previous_status, new_status, actor_user_id
    ) values (
      new.organisation_id,
      new.id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      coalesce(app_current_user_id(), new.published_by, new.archived_by, new.created_by)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists announcements_history_tg on announcements;
create trigger announcements_history_tg
  after insert or update on announcements
  for each row execute function announcements_history_tg();

create or replace function announcement_targets_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from announcements a
    where a.id = new.announcement_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  perform communication_target_same_org(
    new.organisation_id, new.class_id, new.year_group_id, new.student_profile_id, new.staff_user_id
  );
  if app_current_user_id() is not null then
    new.created_by := app_current_user_id();
  end if;
  return new;
end;
$$;

drop trigger if exists announcement_targets_same_org_tg on announcement_targets;
create trigger announcement_targets_same_org_tg
  before insert or update on announcement_targets
  for each row execute function announcement_targets_same_org_tg();

create or replace function announcement_recipients_write_tg()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
  v_required boolean;
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from announcements a
      where a.id = new.announcement_id and a.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    if new.read_at is not null or new.acknowledged_at is not null then
      raise exception 'recipient_state_invalid' using errcode = '23514';
    end if;
    return new;
  end if;

  new.id := old.id;
  new.organisation_id := old.organisation_id;
  new.announcement_id := old.announcement_id;
  new.user_id := old.user_id;
  new.audience_role := old.audience_role;
  new.delivered_at := old.delivered_at;

  v_actor := app_current_user_id();
  if v_actor is not null and new.user_id is distinct from v_actor then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if new.read_at is distinct from old.read_at then
    new.read_at := coalesce(old.read_at, now());
  end if;

  if new.acknowledged_at is distinct from old.acknowledged_at then
    select acknowledgement_required into v_required
    from announcements
    where id = new.announcement_id and organisation_id = new.organisation_id;
    if not coalesce(v_required, false) then
      raise exception 'acknowledgement_not_required' using errcode = '23514';
    end if;
    new.acknowledged_at := coalesce(old.acknowledged_at, now());
    new.read_at := coalesce(new.read_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists announcement_recipients_write_tg on announcement_recipients;
create trigger announcement_recipients_write_tg
  before insert or update on announcement_recipients
  for each row execute function announcement_recipients_write_tg();

create or replace function announcement_recipient_subjects_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from announcement_recipients r
    where r.announcement_id = new.announcement_id
      and r.user_id = new.user_id
      and r.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from student_profiles s
    where s.id = new.student_profile_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists announcement_recipient_subjects_same_org_tg on announcement_recipient_subjects;
create trigger announcement_recipient_subjects_same_org_tg
  before insert or update on announcement_recipient_subjects
  for each row execute function announcement_recipient_subjects_same_org_tg();

create or replace function announcement_resources_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from announcements a
    where a.id = new.announcement_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if app_current_user_id() is not null then
    new.created_by := app_current_user_id();
  end if;
  return new;
end;
$$;

drop trigger if exists announcement_resources_same_org_tg on announcement_resources;
create trigger announcement_resources_same_org_tg
  before insert or update on announcement_resources
  for each row execute function announcement_resources_same_org_tg();

create or replace function school_events_write_tg()
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
      raise exception 'communication_actor_required' using errcode = '22023';
    end if;
    if new.ends_at < new.starts_at then
      raise exception 'event_dates_invalid' using errcode = '23514';
    end if;
    if not exists (
      select 1 from school_event_types t
      where t.id = new.event_type_id and t.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    new.published_at := null;
    new.published_by := null;
    new.archived_at := null;
    new.archived_by := null;
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.updated_at := now();
    return new;
  end if;

  new.id := old.id;
  new.organisation_id := old.organisation_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if not school_event_status_allowed(old.status, new.status) then
    raise exception 'invalid_status_transition' using errcode = '23514';
  end if;
  if new.ends_at < new.starts_at then
    raise exception 'event_dates_invalid' using errcode = '23514';
  end if;
  if not exists (
    select 1 from school_event_types t
    where t.id = new.event_type_id and t.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;

  if old.status is distinct from new.status then
    if new.status = 'published' then
      new.published_at := coalesce(old.published_at, now());
      new.published_by := coalesce(v_actor, old.published_by, new.published_by);
    elsif new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := coalesce(v_actor, new.archived_by);
    elsif new.status = 'cancelled' then
      new.cancelled_at := now();
      new.cancelled_by := coalesce(v_actor, new.cancelled_by);
    end if;
  else
    new.published_at := old.published_at;
    new.published_by := old.published_by;
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
    new.cancelled_at := old.cancelled_at;
    new.cancelled_by := old.cancelled_by;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists school_events_write_tg on school_events;
create trigger school_events_write_tg
  before insert or update on school_events
  for each row execute function school_events_write_tg();

create or replace function school_events_history_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into school_event_status_history (
      organisation_id, event_id, previous_status, new_status, actor_user_id
    ) values (
      new.organisation_id,
      new.id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      coalesce(app_current_user_id(), new.published_by, new.archived_by, new.cancelled_by, new.created_by)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists school_events_history_tg on school_events;
create trigger school_events_history_tg
  after insert or update on school_events
  for each row execute function school_events_history_tg();

create or replace function school_event_targets_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from school_events e
    where e.id = new.event_id and e.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  perform communication_target_same_org(
    new.organisation_id, new.class_id, new.year_group_id, new.student_profile_id, new.staff_user_id
  );
  if app_current_user_id() is not null then
    new.created_by := app_current_user_id();
  end if;
  return new;
end;
$$;

drop trigger if exists school_event_targets_same_org_tg on school_event_targets;
create trigger school_event_targets_same_org_tg
  before insert or update on school_event_targets
  for each row execute function school_event_targets_same_org_tg();

create or replace function school_event_audience_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from school_events e
    where e.id = new.event_id and e.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists school_event_audience_same_org_tg on school_event_audience;
create trigger school_event_audience_same_org_tg
  before insert or update on school_event_audience
  for each row execute function school_event_audience_same_org_tg();

create or replace function school_event_audience_subjects_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from school_event_audience a
    where a.event_id = new.event_id
      and a.user_id = new.user_id
      and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from student_profiles s
    where s.id = new.student_profile_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists school_event_audience_subjects_same_org_tg on school_event_audience_subjects;
create trigger school_event_audience_subjects_same_org_tg
  before insert or update on school_event_audience_subjects
  for each row execute function school_event_audience_subjects_same_org_tg();

create or replace function school_event_resources_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from school_events e
    where e.id = new.event_id and e.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if app_current_user_id() is not null then
    new.created_by := app_current_user_id();
  end if;
  return new;
end;
$$;

drop trigger if exists school_event_resources_same_org_tg on school_event_resources;
create trigger school_event_resources_same_org_tg
  before insert or update on school_event_resources
  for each row execute function school_event_resources_same_org_tg();

-- ---------------------------------------------------------------------------
-- Request-time activation helper (SECURITY DEFINER, tenant re-check)
-- ---------------------------------------------------------------------------

create or replace function activate_due_communications(p_organisation_id uuid)
returns int
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count int := 0;
begin
  if p_organisation_id is distinct from app_current_organisation_id()
     and not (
       app_is_platform_admin()
       and app_current_organisation_id() is null
     ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
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

  update announcements
     set status = 'published'
   where organisation_id = p_organisation_id
     and status = 'scheduled'
     and publish_at is not null
     and publish_at <= now();
  get diagnostics v_count = row_count;

  update announcements
     set status = 'expired'
   where organisation_id = p_organisation_id
     and status = 'published'
     and expires_at is not null
     and expires_at <= now();

  update school_events
     set status = 'published'
   where organisation_id = p_organisation_id
     and status = 'scheduled'
     and publish_at is not null
     and publish_at <= now();

  return v_count;
end;
$$;

revoke all on function activate_due_communications(uuid) from public;
grant execute on function activate_due_communications(uuid) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Org defaults
-- ---------------------------------------------------------------------------

create or replace function ensure_organisation_phase10_defaults(p_organisation_id uuid)
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

  insert into school_event_types (organisation_id, key, name, sort_order, is_system)
  values
    (p_organisation_id, 'school_holiday', 'School holiday', 1, true),
    (p_organisation_id, 'inset_day', 'INSET day', 2, true),
    (p_organisation_id, 'parents_evening', 'Parents'' evening', 3, true),
    (p_organisation_id, 'assembly', 'Assembly', 4, true),
    (p_organisation_id, 'sports_day', 'Sports day', 5, true),
    (p_organisation_id, 'open_day', 'Open day', 6, true),
    (p_organisation_id, 'trip', 'Trip', 7, true),
    (p_organisation_id, 'exam', 'Exam / assessment', 8, true),
    (p_organisation_id, 'class_event', 'Class event', 9, true),
    (p_organisation_id, 'club', 'Club', 10, true),
    (p_organisation_id, 'meeting', 'Meeting', 11, true)
  on conflict (organisation_id, key) do nothing;
end;
$$;

revoke all on function ensure_organisation_phase10_defaults(uuid) from public;
grant execute on function ensure_organisation_phase10_defaults(uuid) to schoolapp_app;

create or replace function organisations_phase10_defaults_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform ensure_organisation_phase10_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists organisations_phase10_defaults_tg on organisations;
create trigger organisations_phase10_defaults_tg
  after insert on organisations
  for each row execute function organisations_phase10_defaults_tg();

select ensure_organisation_phase10_defaults(id) from organisations;
