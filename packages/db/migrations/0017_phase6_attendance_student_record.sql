-- Phase 6: attendance, student portal policy, student document metadata.
-- Additive. Does not weaken FORCE RLS, tenant context, guardian/teacher
-- restrictions, hostname tenancy, or admissions conversion.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('attendance.record.read', 'School-wide attendance read'),
  ('attendance.record.correct', 'Correct existing attendance marks'),
  ('attendance.record.read_self', 'Student: read own attendance'),
  ('attendance.config.manage', 'Manage attendance sessions and codes'),
  ('students.portal_access.manage', 'Manage student portal enablement policy'),
  ('students.documents.read', 'Read student document metadata'),
  ('students.documents.manage', 'Create and update student document metadata'),
  ('students.documents.read_own_children', 'Parent: read explicitly shared child documents'),
  ('students.documents.read_self', 'Student: read explicitly shared own documents')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'attendance.record.read'),
    ('school.admin', 'attendance.record.manage'),
    ('school.admin', 'attendance.record.correct'),
    ('school.admin', 'attendance.config.manage'),
    ('school.admin', 'students.portal_access.manage'),
    ('school.admin', 'students.documents.read'),
    ('school.admin', 'students.documents.manage'),
    ('school.headteacher', 'attendance.record.read'),
    ('school.headteacher', 'attendance.record.correct'),
    ('school.headteacher', 'students.documents.read'),
    ('school.student', 'attendance.record.read_self'),
    ('school.parent', 'students.documents.read_own_children'),
    ('school.student', 'students.documents.read_self')
) as x(role_key, perm)
  on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Student portal policy (school default → year group → class → pupil)
-- Class and pupil override tables are implemented for evaluation/API safety;
-- School Admin UI in this phase covers school default + year group.
-- ---------------------------------------------------------------------------

create table student_portal_policies (
  organisation_id uuid primary key references organisations (id),
  default_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id)
);

create table student_portal_year_group_overrides (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  year_group_id uuid not null references year_groups (id),
  enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year_group_id),
  unique (organisation_id, year_group_id)
);

create table student_portal_class_overrides (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  class_id uuid not null references classes (id),
  enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id),
  unique (organisation_id, class_id)
);

create table student_portal_student_overrides (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_profile_id),
  unique (organisation_id, student_profile_id)
);

select install_tenant_isolation('student_portal_policies');
select install_tenant_isolation('student_portal_year_group_overrides');
select install_tenant_isolation('student_portal_class_overrides');
select install_tenant_isolation('student_portal_student_overrides');

grant select, insert, update, delete on student_portal_policies to schoolapp_app;
grant select, insert, update, delete on student_portal_year_group_overrides to schoolapp_app;
grant select, insert, update, delete on student_portal_class_overrides to schoolapp_app;
grant select, insert, update, delete on student_portal_student_overrides to schoolapp_app;

drop trigger if exists student_portal_policies_updated_at on student_portal_policies;
create trigger student_portal_policies_updated_at before update on student_portal_policies
  for each row execute function set_updated_at();

drop trigger if exists student_portal_year_group_overrides_updated_at on student_portal_year_group_overrides;
create trigger student_portal_year_group_overrides_updated_at before update on student_portal_year_group_overrides
  for each row execute function set_updated_at();

drop trigger if exists student_portal_class_overrides_updated_at on student_portal_class_overrides;
create trigger student_portal_class_overrides_updated_at before update on student_portal_class_overrides
  for each row execute function set_updated_at();

drop trigger if exists student_portal_student_overrides_updated_at on student_portal_student_overrides;
create trigger student_portal_student_overrides_updated_at before update on student_portal_student_overrides
  for each row execute function set_updated_at();

create or replace function student_portal_year_group_overrides_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from year_groups g
    where g.id = new.year_group_id and g.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists student_portal_year_group_overrides_same_org_tg on student_portal_year_group_overrides;
create trigger student_portal_year_group_overrides_same_org_tg
  before insert or update on student_portal_year_group_overrides
  for each row execute function student_portal_year_group_overrides_same_org_tg();

create or replace function student_portal_class_overrides_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from classes c
    where c.id = new.class_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists student_portal_class_overrides_same_org_tg on student_portal_class_overrides;
create trigger student_portal_class_overrides_same_org_tg
  before insert or update on student_portal_class_overrides
  for each row execute function student_portal_class_overrides_same_org_tg();

create or replace function student_portal_student_overrides_same_org_tg()
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
  return new;
end;
$$;

drop trigger if exists student_portal_student_overrides_same_org_tg on student_portal_student_overrides;
create trigger student_portal_student_overrides_same_org_tg
  before insert or update on student_portal_student_overrides
  for each row execute function student_portal_student_overrides_same_org_tg();

create or replace function student_portal_is_enabled(
  p_organisation_id uuid,
  p_student_profile_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_enabled boolean;
  v_year_group_id uuid;
  v_class_id uuid;
begin
  if p_organisation_id is null or p_student_profile_id is null then
    return false;
  end if;

  if nullif(current_setting('app.organisation_id', true), '') is not null
     and app_current_organisation_id() is distinct from p_organisation_id
     and not app_is_platform_admin() then
    return false;
  end if;

  if not exists (
    select 1 from student_profiles sp
    where sp.id = p_student_profile_id and sp.organisation_id = p_organisation_id
  ) then
    return false;
  end if;

  select enabled into v_enabled
  from student_portal_student_overrides
  where organisation_id = p_organisation_id
    and student_profile_id = p_student_profile_id;
  if found then
    return v_enabled;
  end if;

  select form.class_id into v_class_id
  from student_profiles sp
  left join academic_years ay
    on ay.organisation_id = sp.organisation_id and ay.is_current
  left join lateral (
    select cm.class_id
    from class_memberships cm
    join classes c on c.id = cm.class_id
    where cm.student_profile_id = sp.id
      and cm.ended_on is null
      and c.class_type = 'form'
      and ay.id is not null
      and cm.academic_year_id = ay.id
    limit 1
  ) form on true
  where sp.id = p_student_profile_id
    and sp.organisation_id = p_organisation_id;

  if v_class_id is not null then
    select enabled into v_enabled
    from student_portal_class_overrides
    where organisation_id = p_organisation_id and class_id = v_class_id;
    if found then
      return v_enabled;
    end if;
  end if;

  select se.year_group_id into v_year_group_id
  from student_enrolments se
  join academic_years ay on ay.id = se.academic_year_id and ay.is_current
  where se.student_profile_id = p_student_profile_id
    and se.organisation_id = p_organisation_id
    and se.is_primary
    and se.ended_on is null
  limit 1;

  if v_year_group_id is not null then
    select enabled into v_enabled
    from student_portal_year_group_overrides
    where organisation_id = p_organisation_id and year_group_id = v_year_group_id;
    if found then
      return v_enabled;
    end if;
  end if;

  select default_enabled into v_enabled
  from student_portal_policies
  where organisation_id = p_organisation_id;
  return coalesce(v_enabled, false);
end;
$$;

create or replace function student_portal_is_enabled_for_user(
  p_organisation_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile_id uuid;
begin
  if p_organisation_id is null or p_user_id is null then
    return false;
  end if;
  if nullif(current_setting('app.organisation_id', true), '') is not null
     and app_current_organisation_id() is distinct from p_organisation_id
     and not app_is_platform_admin() then
    return false;
  end if;
  select id into v_profile_id
  from student_profiles
  where organisation_id = p_organisation_id and user_id = p_user_id;
  if v_profile_id is null then
    return false;
  end if;
  return student_portal_is_enabled(p_organisation_id, v_profile_id);
end;
$$;

revoke all on function student_portal_is_enabled(uuid, uuid) from public;
grant execute on function student_portal_is_enabled(uuid, uuid) to schoolapp_app;
revoke all on function student_portal_is_enabled_for_user(uuid, uuid) from public;
grant execute on function student_portal_is_enabled_for_user(uuid, uuid) to schoolapp_app;

create or replace function local_auth_lookup_alias(p_slug citext, p_alias citext)
returns table (
  user_id uuid,
  password_hash text,
  full_name text,
  user_kind text,
  status text,
  organisation_id uuid
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select u.id, c.password_hash, u.full_name, u.user_kind, u.status, o.id
  from organisations o
  join user_login_aliases a
    on a.organisation_id = o.id
   and a.alias = p_alias
  join users u on u.id = a.user_id
  join user_credentials c on c.user_id = u.id
  join organisation_memberships m
    on m.user_id = u.id
   and m.organisation_id = o.id
   and m.status = 'active'
   and m.ended_at is null
  join student_profiles sp
    on sp.user_id = u.id
   and sp.organisation_id = o.id
  join academic_years ay
    on ay.organisation_id = o.id
   and ay.is_current
  join student_enrolments se
    on se.student_profile_id = sp.id
   and se.academic_year_id = ay.id
   and se.is_primary
   and se.ended_on is null
  where o.slug = p_slug
    and o.status = 'active'
    and student_portal_is_enabled(o.id, sp.id)
  limit 1;
$$;

revoke all on function local_auth_lookup_alias(citext, citext) from public;
grant execute on function local_auth_lookup_alias(citext, citext) to schoolapp_app;

create or replace function provision_student(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_legal_name text,
  p_preferred_name text,
  p_admission_number text,
  p_date_of_birth date,
  p_academic_year_id uuid,
  p_year_group_id uuid,
  p_class_id uuid,
  p_house_id uuid,
  p_login_alias citext,
  p_password_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
  v_profile_id uuid;
  v_started date;
begin
  if not actor_has_permission(p_actor_user_id, p_organisation_id, 'students.profiles.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_legal_name is null or char_length(trim(p_legal_name)) < 1 then
    raise exception 'student_name_required' using errcode = '22023';
  end if;

  if p_year_group_id is not null then
    if not exists (
      select 1 from year_groups
      where id = p_year_group_id and organisation_id = p_organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  end if;

  if p_academic_year_id is not null then
    if not exists (
      select 1 from academic_years y
      where y.id = p_academic_year_id and y.organisation_id = p_organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    if p_year_group_id is null then
      raise exception 'year_group_required' using errcode = '22023';
    end if;
  end if;

  -- Aliases/passwords may exist while portal access is disabled. Authentication
  -- is blocked by student_portal_is_enabled, not by the presence of credentials.
  if p_login_alias is not null then
    if p_password_hash is null or char_length(p_password_hash) < 16 then
      raise exception 'student_password_required' using errcode = '22023';
    end if;
  end if;

  insert into users (full_name, preferred_name, user_kind, status, date_of_birth)
  values (trim(p_legal_name), nullif(trim(p_preferred_name), ''), 'student', 'active', p_date_of_birth)
  returning id into v_user_id;

  if p_password_hash is not null and p_login_alias is not null then
    insert into user_credentials (user_id, password_hash) values (v_user_id, p_password_hash);
  end if;

  insert into organisation_memberships (organisation_id, user_id, status)
  values (p_organisation_id, v_user_id, 'active');

  insert into membership_roles (membership_id, role_id)
  select m.id, r.id
  from organisation_memberships m
  join roles r on r.organisation_id is null and r.key = 'school.student'
  where m.organisation_id = p_organisation_id and m.user_id = v_user_id;

  if p_login_alias is not null then
    insert into user_login_aliases (organisation_id, user_id, alias)
    values (p_organisation_id, v_user_id, p_login_alias);
  end if;

  insert into student_profiles (
    organisation_id, user_id, admission_number, enrolment_status, legal_name
  ) values (
    p_organisation_id,
    v_user_id,
    nullif(trim(p_admission_number), ''),
    case when p_academic_year_id is null then 'admitted' else 'enrolled' end,
    trim(p_legal_name)
  ) returning id into v_profile_id;

  if p_academic_year_id is not null then
    select starts_on into v_started
    from academic_years
    where id = p_academic_year_id;

    insert into student_enrolments (
      organisation_id, student_profile_id, academic_year_id, year_group_id, house_id,
      status, is_primary, placement_kind, started_on
    ) values (
      p_organisation_id, v_profile_id, p_academic_year_id, p_year_group_id, p_house_id,
      'enrolled', true, 'primary', v_started
    );

    if p_class_id is not null then
      insert into class_memberships (
        organisation_id, class_id, student_profile_id, academic_year_id, started_on
      ) values (
        p_organisation_id, p_class_id, v_profile_id, p_academic_year_id, v_started
      );
    end if;
  end if;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id,
    p_actor_user_id,
    'student.profile.created',
    'student_profile',
    v_profile_id,
    jsonb_build_object(
      'legalName', trim(p_legal_name),
      'admissionNumber', p_admission_number,
      'userId', v_user_id
    )
  );

  return v_profile_id;
end;
$$;

revoke all on function provision_student(
  uuid, uuid, text, text, text, date, uuid, uuid, uuid, uuid, citext, text
) from public;
grant execute on function provision_student(
  uuid, uuid, text, text, text, date, uuid, uuid, uuid, uuid, citext, text
) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Attendance configuration and marks
-- ---------------------------------------------------------------------------

create table attendance_session_types (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null
    check (key ~ '^[a-z0-9_]+$' and char_length(key) between 1 and 32),
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order integer not null default 0,
  typical_start_time time,
  typical_end_time time,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create table attendance_codes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  code text not null check (char_length(trim(code)) between 1 and 16),
  name text not null check (char_length(trim(name)) between 1 and 80),
  category text not null
    check (category in (
      'present',
      'late',
      'authorised_absence',
      'unauthorised_absence',
      'not_required'
    )),
  requires_late_minutes boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, code),
  check (
    (category = 'late' and requires_late_minutes)
    or (category <> 'late' and not requires_late_minutes)
  )
);

create table attendance_marks (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  academic_year_id uuid not null references academic_years (id),
  session_type_id uuid not null references attendance_session_types (id),
  mark_date date not null,
  attendance_code_id uuid not null references attendance_codes (id),
  reason text check (reason is null or char_length(reason) <= 200),
  note text check (note is null or char_length(note) <= 1000),
  parent_visible_note text check (parent_visible_note is null or char_length(parent_visible_note) <= 500),
  late_minutes smallint check (late_minutes is null or (late_minutes >= 0 and late_minutes <= 180)),
  class_id uuid references classes (id),
  year_group_id uuid references year_groups (id),
  recorded_by uuid not null references users (id),
  recorded_at timestamptz not null default now(),
  last_corrected_by uuid references users (id),
  last_corrected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, student_profile_id, mark_date, session_type_id)
);

create table attendance_mark_revisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  mark_id uuid not null references attendance_marks (id),
  attendance_code_id uuid not null references attendance_codes (id),
  reason text,
  note text,
  parent_visible_note text,
  late_minutes smallint,
  class_id uuid,
  year_group_id uuid,
  recorded_by uuid not null references users (id),
  recorded_at timestamptz not null,
  superseded_at timestamptz not null default now(),
  superseded_by uuid not null references users (id)
);

create index attendance_marks_date_idx
  on attendance_marks (organisation_id, mark_date, session_type_id);

create index attendance_marks_student_idx
  on attendance_marks (organisation_id, student_profile_id, mark_date);

create index attendance_marks_class_idx
  on attendance_marks (organisation_id, class_id, mark_date);

create index attendance_mark_revisions_mark_idx
  on attendance_mark_revisions (mark_id, superseded_at);

select install_tenant_isolation('attendance_session_types');
select install_tenant_isolation('attendance_codes');
select install_tenant_isolation('attendance_marks');
select install_tenant_isolation('attendance_mark_revisions');

grant select, insert, update on attendance_session_types to schoolapp_app;
grant select, insert, update on attendance_codes to schoolapp_app;
grant select, insert, update on attendance_marks to schoolapp_app;
grant select, insert on attendance_mark_revisions to schoolapp_app;

drop trigger if exists attendance_session_types_updated_at on attendance_session_types;
create trigger attendance_session_types_updated_at before update on attendance_session_types
  for each row execute function set_updated_at();

drop trigger if exists attendance_codes_updated_at on attendance_codes;
create trigger attendance_codes_updated_at before update on attendance_codes
  for each row execute function set_updated_at();

drop trigger if exists attendance_marks_updated_at on attendance_marks;
create trigger attendance_marks_updated_at before update on attendance_marks
  for each row execute function set_updated_at();

create or replace function attendance_marks_write_tg()
returns trigger
language plpgsql
as $$
declare
  v_requires_minutes boolean;
  v_starts date;
  v_ends date;
  v_actor uuid;
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
  select starts_on, ends_on into v_starts, v_ends
  from academic_years
  where id = new.academic_year_id;
  if new.mark_date < v_starts or new.mark_date > v_ends then
    raise exception 'attendance_date_outside_year' using errcode = '22023';
  end if;
  if not exists (
    select 1 from attendance_session_types s
    where s.id = new.session_type_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  select requires_late_minutes into v_requires_minutes
  from attendance_codes
  where id = new.attendance_code_id and organisation_id = new.organisation_id;
  if not found then
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
  if v_requires_minutes then
    if new.late_minutes is null then
      new.late_minutes := 0;
    end if;
  else
    new.late_minutes := null;
  end if;

  v_actor := app_current_user_id();
  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.recorded_by := v_actor;
    end if;
    if new.recorded_by is null then
      raise exception 'attendance_actor_required' using errcode = '22023';
    end if;
    new.recorded_at := coalesce(new.recorded_at, now());
    new.last_corrected_by := null;
    new.last_corrected_at := null;
    return new;
  end if;

  new.id := old.id;
  new.organisation_id := old.organisation_id;
  new.student_profile_id := old.student_profile_id;
  new.academic_year_id := old.academic_year_id;
  new.session_type_id := old.session_type_id;
  new.mark_date := old.mark_date;
  new.recorded_by := old.recorded_by;
  new.recorded_at := old.recorded_at;

  if (new.attendance_code_id, new.reason, new.note, new.parent_visible_note, new.late_minutes)
     is distinct from
     (old.attendance_code_id, old.reason, old.note, old.parent_visible_note, old.late_minutes)
  then
    if v_actor is null then
      raise exception 'attendance_actor_required' using errcode = '22023';
    end if;
    insert into attendance_mark_revisions (
      organisation_id, mark_id, attendance_code_id, reason, note, parent_visible_note,
      late_minutes, class_id, year_group_id, recorded_by, recorded_at, superseded_by
    ) values (
      old.organisation_id, old.id, old.attendance_code_id, old.reason, old.note,
      old.parent_visible_note, old.late_minutes, old.class_id, old.year_group_id,
      old.recorded_by, old.recorded_at, v_actor
    );
    new.last_corrected_by := v_actor;
    new.last_corrected_at := now();
  else
    new.last_corrected_by := old.last_corrected_by;
    new.last_corrected_at := old.last_corrected_at;
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_marks_write_tg on attendance_marks;
create trigger attendance_marks_write_tg
  before insert or update on attendance_marks
  for each row execute function attendance_marks_write_tg();

create or replace function attendance_mark_revisions_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from attendance_marks m
    where m.id = new.mark_id and m.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_mark_revisions_same_org_tg on attendance_mark_revisions;
create trigger attendance_mark_revisions_same_org_tg
  before insert or update on attendance_mark_revisions
  for each row execute function attendance_mark_revisions_same_org_tg();

-- ---------------------------------------------------------------------------
-- Student document metadata (no binary in Postgres)
-- ---------------------------------------------------------------------------

create table student_documents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  title text not null check (char_length(trim(title)) between 1 and 200),
  document_type text not null
    check (document_type in (
      'report', 'letter', 'consent', 'support', 'school_record', 'other'
    )),
  storage_backend text not null default 'unconfigured'
    check (storage_backend in ('unconfigured', 's3')),
  storage_key text check (storage_key is null or char_length(storage_key) between 1 and 500),
  content_type text check (content_type is null or char_length(content_type) <= 120),
  byte_size bigint check (byte_size is null or byte_size >= 0),
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'),
  visibility text not null default 'staff'
    check (visibility in ('staff', 'staff_and_parents', 'staff_parents_and_student')),
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index student_documents_student_idx
  on student_documents (organisation_id, student_profile_id, created_at desc);

select install_tenant_isolation('student_documents');

grant select, insert, update on student_documents to schoolapp_app;

drop trigger if exists student_documents_updated_at on student_documents;
create trigger student_documents_updated_at before update on student_documents
  for each row execute function set_updated_at();

create or replace function student_documents_same_org_tg()
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
  return new;
end;
$$;

drop trigger if exists student_documents_same_org_tg on student_documents;
create trigger student_documents_same_org_tg
  before insert or update on student_documents
  for each row execute function student_documents_same_org_tg();

-- ---------------------------------------------------------------------------
-- Per-organisation defaults
-- ---------------------------------------------------------------------------

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
    organisation_id, code, name, category, requires_late_minutes, sort_order
  ) values
    (p_organisation_id, 'present', 'Present', 'present', false, 1),
    (p_organisation_id, 'late', 'Late', 'late', true, 2),
    (p_organisation_id, 'authorised', 'Authorised absence', 'authorised_absence', false, 3),
    (p_organisation_id, 'unauthorised', 'Unauthorised absence', 'unauthorised_absence', false, 4),
    (p_organisation_id, 'not_required', 'Not required', 'not_required', false, 5)
  on conflict (organisation_id, code) do nothing;
end;
$$;

revoke all on function ensure_organisation_phase6_defaults(uuid) from public;
grant execute on function ensure_organisation_phase6_defaults(uuid) to schoolapp_app;

create or replace function organisations_phase6_defaults_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform ensure_organisation_phase6_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists organisations_phase6_defaults_tg on organisations;
create trigger organisations_phase6_defaults_tg
  after insert on organisations
  for each row execute function organisations_phase6_defaults_tg();

insert into student_portal_policies (organisation_id, default_enabled)
select id, false from organisations
on conflict (organisation_id) do nothing;

insert into student_portal_year_group_overrides (organisation_id, year_group_id, enabled)
select organisation_id, id, true
from year_groups
where student_login_enabled
on conflict (year_group_id) do nothing;

select ensure_organisation_phase6_defaults(id) from organisations;
