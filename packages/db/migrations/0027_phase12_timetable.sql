-- Phase 12: Timetable, lessons, rooms, and school-day scheduling.
-- Additive. Does not weaken FORCE RLS, tenant context, hostname tenancy,
-- membership revalidation, teacher assigned-only access, guardianship /
-- portal_access, student self-only access, student portal policy, current
-- primary-enrolment checks, break-glass, or audit controls.
-- Treats migrations 0001–0026 as immutable.
--
-- Recurring timetable definitions + date-specific exceptions are resolved
-- at query time. This migration does not eagerly insert per-date lesson rows.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('timetable.read', 'School-wide timetable read / oversight'),
  ('timetable.read_assigned', 'Read timetable for assigned or covered classes only'),
  ('timetable.manage', 'Create and edit recurring timetable entries'),
  ('timetable.manage_school', 'Configure school-day profiles, periods, and school-wide timetable'),
  ('timetable.rooms.read', 'Read the organisation room / location catalogue'),
  ('timetable.rooms.manage', 'Create and manage rooms / teaching locations'),
  ('timetable.cover.read', 'Read teacher cover and timetable exceptions'),
  ('timetable.cover.manage', 'Assign cover and record date-specific timetable exceptions'),
  ('timetable.read_own_children', 'Parent: read authorised children''s timetable'),
  ('timetable.read_self', 'Student: read own timetable')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'timetable.read'),
    ('school.admin', 'timetable.manage'),
    ('school.admin', 'timetable.manage_school'),
    ('school.admin', 'timetable.rooms.read'),
    ('school.admin', 'timetable.rooms.manage'),
    ('school.admin', 'timetable.cover.read'),
    ('school.admin', 'timetable.cover.manage'),
    ('school.headteacher', 'timetable.read'),
    ('school.headteacher', 'timetable.manage'),
    ('school.headteacher', 'timetable.manage_school'),
    ('school.headteacher', 'timetable.rooms.read'),
    ('school.headteacher', 'timetable.rooms.manage'),
    ('school.headteacher', 'timetable.cover.read'),
    ('school.headteacher', 'timetable.cover.manage'),
    ('school.teacher', 'timetable.read_assigned'),
    ('school.teacher', 'timetable.rooms.read'),
    ('school.teacher', 'timetable.cover.read'),
    ('school.parent', 'timetable.read_own_children'),
    ('school.student', 'timetable.read_self')
) as x(role_key, perm)
  on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- School day profiles and periods
-- ---------------------------------------------------------------------------

create table school_day_profiles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  academic_year_id uuid not null references academic_years (id),
  name text not null check (char_length(trim(name)) between 1 and 80),
  weekdays smallint[] not null
    check (
      cardinality(weekdays) >= 1
      and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    ),
  starts_at time not null,
  ends_at time not null,
  is_active boolean not null default true,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create index school_day_profiles_org_year_idx
  on school_day_profiles (organisation_id, academic_year_id, is_active);

create table school_day_periods (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  school_day_profile_id uuid not null references school_day_profiles (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  short_code text check (short_code is null or char_length(trim(short_code)) between 1 and 20),
  period_type text not null
    check (period_type in ('teaching', 'registration', 'break', 'lunch', 'assembly', 'other')),
  starts_at time not null,
  ends_at time not null,
  sort_order int not null default 0,
  attendance_session_type_id uuid references attendance_session_types (id),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create index school_day_periods_profile_idx
  on school_day_periods (school_day_profile_id, sort_order, starts_at);

-- ---------------------------------------------------------------------------
-- Rooms / locations
-- ---------------------------------------------------------------------------

create table rooms (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  name text not null check (char_length(trim(name)) between 1 and 80),
  short_code text not null check (char_length(trim(short_code)) between 1 and 20),
  building text check (building is null or char_length(trim(building)) between 1 and 80),
  location_detail text check (location_detail is null or char_length(trim(location_detail)) between 1 and 200),
  capacity int check (capacity is null or capacity > 0),
  location_type text not null default 'teaching'
    check (location_type in ('teaching', 'non_teaching')),
  is_active boolean not null default true,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, short_code)
);

create index rooms_org_active_idx on rooms (organisation_id, is_active, name);

-- ---------------------------------------------------------------------------
-- Recurring timetable definitions
-- ---------------------------------------------------------------------------

create table timetable_entries (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  academic_year_id uuid not null references academic_years (id),
  term_id uuid references terms (id),
  school_day_period_id uuid references school_day_periods (id),
  weekday smallint not null check (weekday between 1 and 7),
  starts_at time not null,
  ends_at time not null,
  class_id uuid not null references classes (id),
  year_group_id uuid references year_groups (id),
  subject_id uuid references subjects (id),
  room_id uuid references rooms (id),
  lesson_type text not null default 'lesson'
    check (lesson_type in ('lesson', 'registration', 'assembly', 'other')),
  is_active boolean not null default true,
  effective_from date not null,
  effective_until date,
  staff_notes text check (staff_notes is null or char_length(staff_notes) <= 2000),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  check (effective_until is null or effective_until >= effective_from)
);

create index timetable_entries_org_year_weekday_idx
  on timetable_entries (organisation_id, academic_year_id, weekday, is_active);
create index timetable_entries_class_idx
  on timetable_entries (organisation_id, class_id, weekday);
create index timetable_entries_room_idx
  on timetable_entries (organisation_id, room_id, weekday)
  where room_id is not null;

create table timetable_entry_teachers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  timetable_entry_id uuid not null references timetable_entries (id) on delete cascade,
  staff_profile_id uuid not null references staff_profiles (id),
  participation_role text not null default 'teacher'
    check (participation_role in ('teacher', 'co_teacher', 'teaching_assistant', 'support')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (timetable_entry_id, staff_profile_id)
);

create index timetable_entry_teachers_staff_idx
  on timetable_entry_teachers (organisation_id, staff_profile_id);

-- ---------------------------------------------------------------------------
-- Date-specific exceptions and cover
-- ---------------------------------------------------------------------------

create table timetable_exceptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  timetable_entry_id uuid references timetable_entries (id) on delete cascade,
  exception_date date not null,
  exception_type text not null
    check (exception_type in (
      'cancelled', 'room_changed', 'teacher_changed', 'replacement', 'school_closure', 'special_activity'
    )),
  replacement_room_id uuid references rooms (id),
  replacement_subject_id uuid references subjects (id),
  replacement_starts_at time,
  replacement_ends_at time,
  replacement_lesson_type text
    check (replacement_lesson_type is null or replacement_lesson_type in ('lesson', 'registration', 'assembly', 'other')),
  parent_visible_note text check (parent_visible_note is null or char_length(parent_visible_note) <= 400),
  staff_notes text check (staff_notes is null or char_length(staff_notes) <= 2000),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  check (
    replacement_starts_at is null
    or replacement_ends_at is null
    or replacement_starts_at < replacement_ends_at
  ),
  check (
    (exception_type = 'school_closure' and timetable_entry_id is null)
    or (exception_type <> 'school_closure' and timetable_entry_id is not null)
  )
);

create unique index timetable_exceptions_entry_date_type_idx
  on timetable_exceptions (timetable_entry_id, exception_date, exception_type)
  where timetable_entry_id is not null;

create unique index timetable_exceptions_org_closure_date_idx
  on timetable_exceptions (organisation_id, exception_date)
  where exception_type = 'school_closure' and timetable_entry_id is null;

create table timetable_covers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  timetable_entry_id uuid not null references timetable_entries (id) on delete cascade,
  cover_date date not null,
  original_staff_profile_id uuid not null references staff_profiles (id),
  covering_staff_profile_id uuid not null references staff_profiles (id),
  reason text check (reason is null or char_length(reason) <= 400),
  staff_notes text check (staff_notes is null or char_length(staff_notes) <= 2000),
  assigned_by uuid references users (id),
  assigned_at timestamptz not null default now(),
  check (original_staff_profile_id <> covering_staff_profile_id),
  unique (timetable_entry_id, cover_date, original_staff_profile_id)
);

create index timetable_covers_covering_idx
  on timetable_covers (organisation_id, covering_staff_profile_id, cover_date);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

select install_tenant_isolation('school_day_profiles');
select install_tenant_isolation('school_day_periods');
select install_tenant_isolation('rooms');
select install_tenant_isolation('timetable_entries');
select install_tenant_isolation('timetable_entry_teachers');
select install_tenant_isolation('timetable_exceptions');
select install_tenant_isolation('timetable_covers');

grant select, insert, update, delete on school_day_profiles to schoolapp_app;
grant select, insert, update, delete on school_day_periods to schoolapp_app;
grant select, insert, update, delete on rooms to schoolapp_app;
grant select, insert, update, delete on timetable_entries to schoolapp_app;
grant select, insert, update, delete on timetable_entry_teachers to schoolapp_app;
grant select, insert, update, delete on timetable_exceptions to schoolapp_app;
grant select, insert, update, delete on timetable_covers to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Same-organisation integrity
-- ---------------------------------------------------------------------------

create or replace function timetable_same_org_academic_year(p_organisation_id uuid, p_academic_year_id uuid)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1 from academic_years
    where id = p_academic_year_id and organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function school_day_profiles_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  perform timetable_same_org_academic_year(new.organisation_id, new.academic_year_id);
  return new;
end;
$$;

create or replace function school_day_periods_same_org_tg()
returns trigger
language plpgsql
as $$
declare
  profile_org uuid;
  session_org uuid;
begin
  select organisation_id into profile_org
  from school_day_profiles
  where id = new.school_day_profile_id;
  if profile_org is distinct from new.organisation_id then
    raise exception 'organisation_mismatch' using errcode = 'P0001';
  end if;
  if new.attendance_session_type_id is not null then
    select organisation_id into session_org
    from attendance_session_types
    where id = new.attendance_session_type_id;
    if session_org is distinct from new.organisation_id then
      raise exception 'organisation_mismatch' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create or replace function school_day_profiles_weekday_overlap_tg()
returns trigger
language plpgsql
as $$
begin
  if new.is_active and exists (
    select 1
    from school_day_profiles other
    where other.organisation_id = new.organisation_id
      and other.academic_year_id = new.academic_year_id
      and other.is_active
      and other.id is distinct from new.id
      and other.weekdays && new.weekdays
  ) then
    raise exception 'school_day_weekday_overlap' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function timetable_entries_same_org_tg()
returns trigger
language plpgsql
as $$
declare
  year_org uuid;
  term_org uuid;
  term_year uuid;
  period_org uuid;
  class_org uuid;
  class_year uuid;
  class_year_group uuid;
  subject_org uuid;
  room_org uuid;
  year_group_org uuid;
  year_starts date;
  year_ends date;
begin
  select organisation_id, starts_on, ends_on
    into year_org, year_starts, year_ends
  from academic_years
  where id = new.academic_year_id;
  if year_org is distinct from new.organisation_id then
    raise exception 'organisation_mismatch' using errcode = 'P0001';
  end if;
  if new.effective_from < year_starts or new.effective_from > year_ends
     or (new.effective_until is not null and (new.effective_until < year_starts or new.effective_until > year_ends)) then
    raise exception 'timetable_dates_outside_year' using errcode = 'P0001';
  end if;
  if new.term_id is not null then
    select organisation_id, academic_year_id into term_org, term_year
    from terms
    where id = new.term_id;
    if term_org is distinct from new.organisation_id or term_year is distinct from new.academic_year_id then
      raise exception 'organisation_mismatch' using errcode = 'P0001';
    end if;
  end if;
  if new.school_day_period_id is not null then
    select organisation_id into period_org
    from school_day_periods
    where id = new.school_day_period_id;
    if period_org is distinct from new.organisation_id then
      raise exception 'organisation_mismatch' using errcode = 'P0001';
    end if;
  end if;
  select organisation_id, academic_year_id, year_group_id
    into class_org, class_year, class_year_group
  from classes
  where id = new.class_id;
  if class_org is distinct from new.organisation_id or class_year is distinct from new.academic_year_id then
    raise exception 'organisation_mismatch' using errcode = 'P0001';
  end if;
  if new.year_group_id is not null then
    select organisation_id into year_group_org
    from year_groups
    where id = new.year_group_id;
    if year_group_org is distinct from new.organisation_id then
      raise exception 'organisation_mismatch' using errcode = 'P0001';
    end if;
  elsif class_year_group is not null then
    new.year_group_id := class_year_group;
  end if;
  if new.subject_id is not null then
    select organisation_id into subject_org from subjects where id = new.subject_id;
    if subject_org is distinct from new.organisation_id then
      raise exception 'organisation_mismatch' using errcode = 'P0001';
    end if;
  end if;
  if new.room_id is not null then
    select organisation_id into room_org from rooms where id = new.room_id;
    if room_org is distinct from new.organisation_id then
      raise exception 'organisation_mismatch' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create or replace function timetable_entry_teachers_same_org_tg()
returns trigger
language plpgsql
as $$
declare
  entry_org uuid;
  staff_org uuid;
begin
  select organisation_id into entry_org from timetable_entries where id = new.timetable_entry_id;
  select organisation_id into staff_org from staff_profiles where id = new.staff_profile_id;
  if entry_org is distinct from new.organisation_id or staff_org is distinct from new.organisation_id then
    raise exception 'organisation_mismatch' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function timetable_exceptions_same_org_tg()
returns trigger
language plpgsql
as $$
declare
  entry_org uuid;
  room_org uuid;
  subject_org uuid;
begin
  if new.timetable_entry_id is not null then
    select organisation_id into entry_org from timetable_entries where id = new.timetable_entry_id;
    if entry_org is distinct from new.organisation_id then
      raise exception 'organisation_mismatch' using errcode = 'P0001';
    end if;
  end if;
  if new.replacement_room_id is not null then
    select organisation_id into room_org from rooms where id = new.replacement_room_id;
    if room_org is distinct from new.organisation_id then
      raise exception 'organisation_mismatch' using errcode = 'P0001';
    end if;
  end if;
  if new.replacement_subject_id is not null then
    select organisation_id into subject_org from subjects where id = new.replacement_subject_id;
    if subject_org is distinct from new.organisation_id then
      raise exception 'organisation_mismatch' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create or replace function timetable_covers_same_org_tg()
returns trigger
language plpgsql
as $$
declare
  entry_org uuid;
  original_org uuid;
  covering_org uuid;
begin
  select organisation_id into entry_org from timetable_entries where id = new.timetable_entry_id;
  select organisation_id into original_org from staff_profiles where id = new.original_staff_profile_id;
  select organisation_id into covering_org from staff_profiles where id = new.covering_staff_profile_id;
  if entry_org is distinct from new.organisation_id
     or original_org is distinct from new.organisation_id
     or covering_org is distinct from new.organisation_id then
    raise exception 'organisation_mismatch' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger school_day_profiles_same_org
  before insert or update on school_day_profiles
  for each row execute function school_day_profiles_same_org_tg();

create trigger school_day_profiles_weekday_overlap
  before insert or update on school_day_profiles
  for each row execute function school_day_profiles_weekday_overlap_tg();

create trigger school_day_periods_same_org
  before insert or update on school_day_periods
  for each row execute function school_day_periods_same_org_tg();

create trigger timetable_entries_same_org
  before insert or update on timetable_entries
  for each row execute function timetable_entries_same_org_tg();

create trigger timetable_entry_teachers_same_org
  before insert or update on timetable_entry_teachers
  for each row execute function timetable_entry_teachers_same_org_tg();

create trigger timetable_exceptions_same_org
  before insert or update on timetable_exceptions
  for each row execute function timetable_exceptions_same_org_tg();

create trigger timetable_covers_same_org
  before insert or update on timetable_covers
  for each row execute function timetable_covers_same_org_tg();

-- ---------------------------------------------------------------------------
-- Actor stamping
-- ---------------------------------------------------------------------------

create or replace function timetable_lock_created_by()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.created_by := app_current_user_id();
    elsif new.created_by is null then
      raise exception 'timetable_actor_required' using errcode = 'P0001';
    end if;
  elsif tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create or replace function timetable_lock_assigned_by()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.assigned_by := app_current_user_id();
      new.assigned_at := now();
    elsif new.assigned_by is null then
      raise exception 'timetable_actor_required' using errcode = 'P0001';
    end if;
  elsif tg_op = 'UPDATE' then
    new.assigned_by := old.assigned_by;
    new.assigned_at := old.assigned_at;
  end if;
  return new;
end;
$$;

create trigger school_day_profiles_created_by
  before insert or update on school_day_profiles
  for each row execute function timetable_lock_created_by();

create trigger school_day_periods_created_by
  before insert or update on school_day_periods
  for each row execute function timetable_lock_created_by();

create trigger rooms_created_by
  before insert or update on rooms
  for each row execute function timetable_lock_created_by();

create trigger timetable_entries_created_by
  before insert or update on timetable_entries
  for each row execute function timetable_lock_created_by();

create trigger timetable_exceptions_created_by
  before insert or update on timetable_exceptions
  for each row execute function timetable_lock_created_by();

create trigger timetable_covers_assigned_by
  before insert or update on timetable_covers
  for each row execute function timetable_lock_assigned_by();

create trigger school_day_profiles_updated_at
  before update on school_day_profiles
  for each row execute function set_updated_at();

create trigger school_day_periods_updated_at
  before update on school_day_periods
  for each row execute function set_updated_at();

create trigger rooms_updated_at
  before update on rooms
  for each row execute function set_updated_at();

create trigger timetable_entries_updated_at
  before update on timetable_entries
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Conflict detection (cannot be bypassed via the API)
-- ---------------------------------------------------------------------------

create or replace function timetable_window_overlap(
  a_from date,
  a_until date,
  a_term_start date,
  a_term_end date,
  b_from date,
  b_until date,
  b_term_start date,
  b_term_end date
) returns boolean
language sql
immutable
as $$
  select
    greatest(a_from, coalesce(a_term_start, a_from))
      <= least(coalesce(a_until, 'infinity'::date), coalesce(a_term_end, 'infinity'::date),
               coalesce(b_until, 'infinity'::date), coalesce(b_term_end, 'infinity'::date))
    and greatest(b_from, coalesce(b_term_start, b_from))
      <= least(coalesce(b_until, 'infinity'::date), coalesce(b_term_end, 'infinity'::date),
               coalesce(a_until, 'infinity'::date), coalesce(a_term_end, 'infinity'::date));
$$;

create or replace function timetable_collect_entry_conflicts(p_entry timetable_entries)
returns jsonb
language plpgsql
stable
as $$
declare
  conflicts jsonb := '[]'::jsonb;
  rec record;
begin
  if not p_entry.is_active then
    return conflicts;
  end if;

  for rec in
    select
      other.id,
      other.class_id,
      other.room_id,
      other.starts_at,
      other.ends_at,
      'class'::text as kind
    from timetable_entries other
    left join terms ot on ot.id = other.term_id
    left join terms st on st.id = p_entry.term_id
    where other.organisation_id = p_entry.organisation_id
      and other.id is distinct from p_entry.id
      and other.is_active
      and other.weekday = p_entry.weekday
      and other.class_id = p_entry.class_id
      and other.academic_year_id = p_entry.academic_year_id
      and other.starts_at < p_entry.ends_at
      and other.ends_at > p_entry.starts_at
      and timetable_window_overlap(
        p_entry.effective_from, p_entry.effective_until, st.starts_on, st.ends_on,
        other.effective_from, other.effective_until, ot.starts_on, ot.ends_on
      )
  loop
    conflicts := conflicts || jsonb_build_array(jsonb_build_object(
      'kind', 'class',
      'message', 'This class is already scheduled at the same time',
      'entryId', rec.id,
      'classId', rec.class_id
    ));
  end loop;

  if p_entry.room_id is not null then
    for rec in
      select
        other.id,
        other.room_id,
        'room'::text as kind
      from timetable_entries other
      left join terms ot on ot.id = other.term_id
      left join terms st on st.id = p_entry.term_id
      where other.organisation_id = p_entry.organisation_id
        and other.id is distinct from p_entry.id
        and other.is_active
        and other.weekday = p_entry.weekday
        and other.room_id = p_entry.room_id
        and other.academic_year_id = p_entry.academic_year_id
        and other.starts_at < p_entry.ends_at
        and other.ends_at > p_entry.starts_at
        and timetable_window_overlap(
          p_entry.effective_from, p_entry.effective_until, st.starts_on, st.ends_on,
          other.effective_from, other.effective_until, ot.starts_on, ot.ends_on
        )
    loop
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'kind', 'room',
        'message', 'This room is already booked at the same time',
        'entryId', rec.id,
        'roomId', rec.room_id
      ));
    end loop;
  end if;

  for rec in
    select
      other.id,
      tet.staff_profile_id,
      'teacher'::text as kind
    from timetable_entry_teachers mine
    join timetable_entry_teachers tet
      on tet.staff_profile_id = mine.staff_profile_id
     and tet.organisation_id = mine.organisation_id
    join timetable_entries other on other.id = tet.timetable_entry_id
    left join terms ot on ot.id = other.term_id
    left join terms st on st.id = p_entry.term_id
    where mine.timetable_entry_id = p_entry.id
      and other.id is distinct from p_entry.id
      and other.is_active
      and other.weekday = p_entry.weekday
      and other.academic_year_id = p_entry.academic_year_id
      and other.starts_at < p_entry.ends_at
      and other.ends_at > p_entry.starts_at
      and timetable_window_overlap(
        p_entry.effective_from, p_entry.effective_until, st.starts_on, st.ends_on,
        other.effective_from, other.effective_until, ot.starts_on, ot.ends_on
      )
  loop
    conflicts := conflicts || jsonb_build_array(jsonb_build_object(
      'kind', 'teacher',
      'message', 'This teacher is already scheduled at the same time',
      'entryId', rec.id,
      'staffProfileId', rec.staff_profile_id
    ));
  end loop;

  return conflicts;
end;
$$;

create or replace function timetable_raise_if_conflicts(p_conflicts jsonb)
returns void
language plpgsql
as $$
begin
  if p_conflicts is not null and jsonb_array_length(p_conflicts) > 0 then
    raise exception 'timetable_conflict'
      using errcode = 'P0001',
            detail = jsonb_build_object('conflicts', p_conflicts)::text;
  end if;
end;
$$;

create or replace function timetable_entries_conflict_tg()
returns trigger
language plpgsql
as $$
begin
  perform timetable_raise_if_conflicts(timetable_collect_entry_conflicts(new));
  return new;
end;
$$;

create or replace function timetable_entry_teachers_conflict_tg()
returns trigger
language plpgsql
as $$
declare
  entry timetable_entries;
begin
  select * into entry from timetable_entries where id = new.timetable_entry_id;
  perform timetable_raise_if_conflicts(timetable_collect_entry_conflicts(entry));
  return new;
end;
$$;

create or replace function timetable_covers_conflict_tg()
returns trigger
language plpgsql
as $$
declare
  entry timetable_entries;
  conflicts jsonb := '[]'::jsonb;
  rec record;
  cover_weekday smallint;
begin
  select * into entry from timetable_entries where id = new.timetable_entry_id;
  cover_weekday := extract(isodow from new.cover_date)::smallint;
  if entry.weekday is distinct from cover_weekday then
    raise exception 'timetable_cover_weekday_mismatch' using errcode = 'P0001';
  end if;
  if not entry.is_active
     or new.cover_date < entry.effective_from
     or (entry.effective_until is not null and new.cover_date > entry.effective_until) then
    raise exception 'timetable_cover_outside_entry' using errcode = 'P0001';
  end if;

  for rec in
    select other.id, tet.staff_profile_id
    from timetable_entry_teachers tet
    join timetable_entries other on other.id = tet.timetable_entry_id
    left join terms ot on ot.id = other.term_id
    left join terms st on st.id = entry.term_id
    where tet.staff_profile_id = new.covering_staff_profile_id
      and tet.organisation_id = new.organisation_id
      and other.id is distinct from entry.id
      and other.is_active
      and other.weekday = cover_weekday
      and other.academic_year_id = entry.academic_year_id
      and other.starts_at < entry.ends_at
      and other.ends_at > entry.starts_at
      and other.effective_from <= new.cover_date
      and (other.effective_until is null or other.effective_until >= new.cover_date)
      and (st.id is null or (st.starts_on <= new.cover_date and st.ends_on >= new.cover_date))
      and (ot.id is null or (ot.starts_on <= new.cover_date and ot.ends_on >= new.cover_date))
  loop
    conflicts := conflicts || jsonb_build_array(jsonb_build_object(
      'kind', 'teacher',
      'message', 'The covering teacher is already scheduled at the same time',
      'entryId', rec.id,
      'staffProfileId', rec.staff_profile_id
    ));
  end loop;

  for rec in
    select other.id, cover.covering_staff_profile_id
    from timetable_covers cover
    join timetable_entries other on other.id = cover.timetable_entry_id
    where cover.organisation_id = new.organisation_id
      and cover.id is distinct from new.id
      and cover.covering_staff_profile_id = new.covering_staff_profile_id
      and cover.cover_date = new.cover_date
      and other.starts_at < entry.ends_at
      and other.ends_at > entry.starts_at
  loop
    conflicts := conflicts || jsonb_build_array(jsonb_build_object(
      'kind', 'teacher',
      'message', 'The covering teacher already has cover at the same time',
      'entryId', rec.id,
      'staffProfileId', rec.covering_staff_profile_id
    ));
  end loop;

  perform timetable_raise_if_conflicts(conflicts);
  return new;
end;
$$;

create constraint trigger timetable_entries_conflict
  after insert or update on timetable_entries
  deferrable initially deferred
  for each row execute function timetable_entries_conflict_tg();

create constraint trigger timetable_entry_teachers_conflict
  after insert or update on timetable_entry_teachers
  deferrable initially deferred
  for each row execute function timetable_entry_teachers_conflict_tg();

create trigger timetable_covers_conflict
  before insert or update on timetable_covers
  for each row execute function timetable_covers_conflict_tg();
