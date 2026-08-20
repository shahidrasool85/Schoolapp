-- Phase 2: people and academic structure.
-- Identity writes remain SECURITY DEFINER. Tenant tables stay FORCE RLS.
-- Does not weaken Phase 1 grants, break-glass, or restricted_contact isolation.

-- ---------------------------------------------------------------------------
-- Settings and year-group catalogue
-- ---------------------------------------------------------------------------

alter table organisation_settings
  add column if not exists max_year_group_code text not null default '8';

alter table organisation_settings
  drop constraint if exists organisation_settings_max_year_group_code_check;

alter table organisation_settings
  add constraint organisation_settings_max_year_group_code_check
  check (max_year_group_code in (
    'N', 'R', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'
  ));

alter table year_groups
  add column if not exists student_login_enabled boolean not null default false;

create or replace function year_group_code_rank(p_code text)
returns integer
language sql
immutable
as $$
  select case
    when p_code = 'N' then -1
    when p_code = 'R' then 0
    when p_code ~ '^[0-9]+$' then p_code::integer
    else null
  end;
$$;

create or replace function year_group_key_stage(p_code text)
returns smallint
language sql
immutable
as $$
  select case
    when p_code in ('N', 'R') then 0
    when p_code in ('1', '2') then 1
    when p_code in ('3', '4', '5', '6') then 2
    when p_code in ('7', '8', '9') then 3
    when p_code in ('10', '11') then 4
    when p_code in ('12', '13') then 5
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- Org-scoped student login aliases (same identity as future parent/student apps)
-- ---------------------------------------------------------------------------

create table if not exists user_login_aliases (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  user_id uuid not null references users (id),
  alias citext not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, alias),
  unique (organisation_id, user_id)
);

create index if not exists user_login_aliases_user_id_idx
  on user_login_aliases (user_id);

select install_tenant_isolation('user_login_aliases');

grant select, insert, update on user_login_aliases to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Historical primary enrolment + one current academic year
-- ---------------------------------------------------------------------------

drop index if exists student_enrolments_one_primary_per_year;

create unique index if not exists student_enrolments_one_active_primary_per_year
  on student_enrolments (student_profile_id, academic_year_id)
  where is_primary and ended_on is null;

create unique index if not exists academic_years_one_current
  on academic_years (organisation_id)
  where is_current;

create unique index if not exists classes_year_name_idx
  on classes (academic_year_id, name);

create unique index if not exists staff_profiles_org_employee_number_idx
  on staff_profiles (organisation_id, employee_number)
  where employee_number is not null;

create index if not exists class_memberships_student_idx
  on class_memberships (student_profile_id, academic_year_id);

create index if not exists class_staff_assignments_staff_idx
  on class_staff_assignments (staff_profile_id);

create index if not exists student_enrolments_student_idx
  on student_enrolments (student_profile_id, academic_year_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists academic_years_updated_at on academic_years;
create trigger academic_years_updated_at before update on academic_years
  for each row execute function set_updated_at();

drop trigger if exists classes_updated_at on classes;
create trigger classes_updated_at before update on classes
  for each row execute function set_updated_at();

drop trigger if exists staff_profiles_updated_at on staff_profiles;
create trigger staff_profiles_updated_at before update on staff_profiles
  for each row execute function set_updated_at();

drop trigger if exists student_profiles_updated_at on student_profiles;
create trigger student_profiles_updated_at before update on student_profiles
  for each row execute function set_updated_at();

drop trigger if exists student_enrolments_updated_at on student_enrolments;
create trigger student_enrolments_updated_at before update on student_enrolments
  for each row execute function set_updated_at();

drop trigger if exists guardianships_updated_at on guardianships;
create trigger guardianships_updated_at before update on guardianships
  for each row execute function set_updated_at();

drop trigger if exists user_login_aliases_updated_at on user_login_aliases;
create trigger user_login_aliases_updated_at before update on user_login_aliases
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Integrity: same-organisation FKs and academic-year history
-- ---------------------------------------------------------------------------

create or replace function academic_years_one_current_tg()
returns trigger
language plpgsql
as $$
begin
  if new.is_current then
    update academic_years
    set is_current = false
    where organisation_id = new.organisation_id
      and id is distinct from new.id
      and is_current;
  end if;
  return new;
end;
$$;

drop trigger if exists academic_years_one_current_tg on academic_years;
create trigger academic_years_one_current_tg
  before insert or update of is_current on academic_years
  for each row
  when (new.is_current)
  execute function academic_years_one_current_tg();

create or replace function year_groups_validate_code_tg()
returns trigger
language plpgsql
as $$
declare
  v_max text;
begin
  if year_group_code_rank(new.code) is null then
    raise exception 'year_group_code_invalid' using errcode = '22023';
  end if;

  select max_year_group_code into v_max
  from organisation_settings
  where organisation_id = new.organisation_id;

  if v_max is not null
     and year_group_code_rank(new.code) > year_group_code_rank(v_max) then
    raise exception 'year_group_above_maximum' using errcode = '22023';
  end if;

  if new.key_stage is null then
    new.key_stage := year_group_key_stage(new.code);
  end if;
  if new.sort_order is null then
    new.sort_order := year_group_code_rank(new.code);
  end if;
  return new;
end;
$$;

drop trigger if exists year_groups_validate_code_tg on year_groups;
create trigger year_groups_validate_code_tg
  before insert or update of code, organisation_id, key_stage, sort_order on year_groups
  for each row execute function year_groups_validate_code_tg();

create or replace function classes_same_org_tg()
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
  if new.year_group_id is not null and not exists (
    select 1 from year_groups g
    where g.id = new.year_group_id and g.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists classes_same_org_tg on classes;
create trigger classes_same_org_tg
  before insert or update on classes
  for each row execute function classes_same_org_tg();

create or replace function terms_same_org_tg()
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
  return new;
end;
$$;

drop trigger if exists terms_same_org_tg on terms;
create trigger terms_same_org_tg
  before insert or update on terms
  for each row execute function terms_same_org_tg();

create or replace function half_terms_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from terms t
    where t.id = new.term_id and t.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists half_terms_same_org_tg on half_terms;
create trigger half_terms_same_org_tg
  before insert or update on half_terms
  for each row execute function half_terms_same_org_tg();

create or replace function student_enrolments_same_org_tg()
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
    select 1 from year_groups g
    where g.id = new.year_group_id and g.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.house_id is not null and not exists (
    select 1 from houses h
    where h.id = new.house_id and h.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.ended_on is not null and new.ended_on < new.started_on then
    raise exception 'enrolment_dates_invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists student_enrolments_same_org_tg on student_enrolments;
create trigger student_enrolments_same_org_tg
  before insert or update on student_enrolments
  for each row execute function student_enrolments_same_org_tg();

create or replace function class_memberships_integrity_tg()
returns trigger
language plpgsql
as $$
declare
  v_class_org uuid;
  v_class_year uuid;
  v_class_type text;
begin
  select organisation_id, academic_year_id, class_type
    into v_class_org, v_class_year, v_class_type
  from classes
  where id = new.class_id;

  if v_class_org is null or v_class_org is distinct from new.organisation_id then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if v_class_year is distinct from new.academic_year_id then
    raise exception 'class_year_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from student_profiles s
    where s.id = new.student_profile_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;

  if new.ended_on is null and v_class_type = 'form' then
    if exists (
      select 1
      from class_memberships cm
      join classes c on c.id = cm.class_id
      where cm.student_profile_id = new.student_profile_id
        and cm.academic_year_id = new.academic_year_id
        and cm.ended_on is null
        and c.class_type = 'form'
        and cm.id is distinct from new.id
    ) then
      raise exception 'student_already_in_form_class' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists class_memberships_integrity_tg on class_memberships;
create trigger class_memberships_integrity_tg
  before insert or update on class_memberships
  for each row execute function class_memberships_integrity_tg();

create or replace function class_staff_assignments_same_org_tg()
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
  if not exists (
    select 1 from staff_profiles s
    where s.id = new.staff_profile_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists class_staff_assignments_same_org_tg on class_staff_assignments;
create trigger class_staff_assignments_same_org_tg
  before insert or update on class_staff_assignments
  for each row execute function class_staff_assignments_same_org_tg();

create or replace function class_subjects_same_org_tg()
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
  if not exists (
    select 1 from subjects s
    where s.id = new.subject_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists class_subjects_same_org_tg on class_subjects;
create trigger class_subjects_same_org_tg
  before insert or update on class_subjects
  for each row execute function class_subjects_same_org_tg();

create or replace function guardianships_same_org_tg()
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

drop trigger if exists guardianships_same_org_tg on guardianships;
create trigger guardianships_same_org_tg
  before insert or update on guardianships
  for each row execute function guardianships_same_org_tg();

create or replace function staff_profiles_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from users u where u.id = new.user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

drop trigger if exists staff_profiles_same_org_tg on staff_profiles;
create trigger staff_profiles_same_org_tg
  before insert or update on staff_profiles
  for each row execute function staff_profiles_same_org_tg();

-- ---------------------------------------------------------------------------
-- Permission helper (no RLS bypass; reads via existing security definer)
-- ---------------------------------------------------------------------------

create or replace function actor_has_permission(
  p_user_id uuid,
  p_organisation_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from list_permissions_for_membership(p_user_id, p_organisation_id) p
    where p.permission_key = p_permission
  );
$$;

revoke all on function actor_has_permission(uuid, uuid, text) from public;
grant execute on function actor_has_permission(uuid, uuid, text) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Student-alias login (email login unchanged)
-- ---------------------------------------------------------------------------

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
  where o.slug = p_slug
    and o.status = 'active'
  limit 1;
$$;

revoke all on function local_auth_lookup_alias(citext, citext) from public;
grant execute on function local_auth_lookup_alias(citext, citext) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Invitation role validation + staff profile / user_kind on accept
-- ---------------------------------------------------------------------------

create or replace function create_school_invitation(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_email citext,
  p_role_keys text[]
)
returns table (
  invitation_id uuid,
  invitation_token text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_token text;
  v_id uuid;
begin
  if not actor_has_permission(p_actor_user_id, p_organisation_id, 'org.members.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_role_keys is null or array_length(p_role_keys, 1) is null then
    raise exception 'invalid_role_key' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_role_keys) as k(key)
    where k.key not in (select r.key from roles r where r.organisation_id is null)
  ) then
    raise exception 'invalid_role_key' using errcode = '22023';
  end if;

  if 'school.student' = any (p_role_keys) then
    raise exception 'student_invite_not_supported' using errcode = '22023';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into invitations (
    organisation_id, email, intended_role_keys, token_hash, expires_at, created_by
  ) values (
    p_organisation_id, p_email, p_role_keys, hash_invite_token(v_token),
    now() + interval '14 days', p_actor_user_id
  ) returning id into v_id;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id, p_actor_user_id, 'org.invitation.created', 'invitation', v_id,
    jsonb_build_object('email', p_email::text, 'roles', to_jsonb(p_role_keys))
  );

  invitation_id := v_id;
  invitation_token := v_token;
  return next;
end;
$$;

drop function if exists accept_invitation(text, text, text);

create or replace function accept_invitation(
  p_token text,
  p_full_name text,
  p_password_hash text
)
returns table (
  accepted_user_id uuid,
  accepted_organisation_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inv invitations%rowtype;
  v_user_id uuid;
  v_status text;
  v_kind text := 'staff';
  v_staff_roles text[] := array[
    'school.admin', 'school.headteacher', 'school.teacher', 'school.admissions', 'school.staff'
  ];
begin
  select * into v_inv
  from invitations
  where token_hash = hash_invite_token(p_token)
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'invitation_invalid' using errcode = 'P0002';
  end if;

  if v_inv.intended_role_keys && array['school.student']::text[]
     and not (v_inv.intended_role_keys && v_staff_roles) then
    v_kind := 'student';
  elsif v_inv.intended_role_keys && array['school.parent']::text[]
     and not (v_inv.intended_role_keys && v_staff_roles) then
    v_kind := 'parent';
  end if;

  select u.id, u.status into v_user_id, v_status
  from users u
  where u.email = v_inv.email;

  if v_user_id is null then
    if p_password_hash is null or char_length(p_password_hash) < 16 then
      raise exception 'invitation_password_required' using errcode = '22023';
    end if;
    insert into users (email, full_name, user_kind, status)
    values (v_inv.email, p_full_name, v_kind, 'active')
    returning id into v_user_id;
    insert into user_credentials (user_id, password_hash) values (v_user_id, p_password_hash);
  else
    if v_status <> 'active' then
      raise exception 'invitation_user_disabled' using errcode = '42501';
    end if;
  end if;

  insert into organisation_memberships (organisation_id, user_id, status)
  values (v_inv.organisation_id, v_user_id, 'active')
  on conflict (organisation_id, user_id) do update
    set status = 'active', ended_at = null, updated_at = now();

  insert into membership_roles (membership_id, role_id)
  select m.id, r.id
  from organisation_memberships m
  join roles r on r.organisation_id is null and r.key = any (v_inv.intended_role_keys)
  where m.organisation_id = v_inv.organisation_id and m.user_id = v_user_id
  on conflict do nothing;

  if v_inv.intended_role_keys && v_staff_roles then
    insert into staff_profiles (organisation_id, user_id)
    values (v_inv.organisation_id, v_user_id)
    on conflict (organisation_id, user_id) do nothing;
  end if;

  update invitations set accepted_at = now() where id = v_inv.id;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    v_inv.organisation_id,
    v_user_id,
    'org.invitation.accepted',
    'invitation',
    v_inv.id,
    jsonb_build_object('email', v_inv.email::text, 'roles', to_jsonb(v_inv.intended_role_keys))
  );

  return query select v_user_id, v_inv.organisation_id;
end;
$$;

grant execute on function accept_invitation(text, text, text) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Provision students, staff, and guardians (same global identity model)
-- ---------------------------------------------------------------------------

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
  v_login_enabled boolean := false;
  v_started date;
begin
  if not actor_has_permission(p_actor_user_id, p_organisation_id, 'students.profiles.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_legal_name is null or char_length(trim(p_legal_name)) < 1 then
    raise exception 'student_name_required' using errcode = '22023';
  end if;

  if p_year_group_id is not null then
    select student_login_enabled into v_login_enabled
    from year_groups
    where id = p_year_group_id and organisation_id = p_organisation_id;
    if not found then
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

  if p_login_alias is not null then
    if not v_login_enabled then
      raise exception 'student_login_disabled' using errcode = '22023';
    end if;
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

create or replace function provision_staff(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_email citext,
  p_full_name text,
  p_job_title text,
  p_employee_number text,
  p_role_keys text[],
  p_started_on date
)
returns table (
  staff_profile_id uuid,
  invitation_id uuid,
  invitation_token text,
  user_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
  v_profile_id uuid;
  v_roles text[] := coalesce(p_role_keys, array['school.teacher']::text[]);
  v_staff_roles text[] := array[
    'school.admin', 'school.headteacher', 'school.teacher', 'school.admissions', 'school.staff'
  ];
  v_token text;
  v_inv_id uuid;
begin
  if not actor_has_permission(p_actor_user_id, p_organisation_id, 'org.members.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_email is null or p_full_name is null or char_length(trim(p_full_name)) < 1 then
    raise exception 'staff_identity_required' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_roles) as k(key)
    where k.key <> all (v_staff_roles)
  ) then
    raise exception 'invalid_role_key' using errcode = '22023';
  end if;

  select u.id into v_user_id from users u where u.email = p_email;
  if v_user_id is null then
    insert into users (email, full_name, user_kind, status)
    values (p_email, trim(p_full_name), 'staff', 'active')
    returning id into v_user_id;
  end if;

  insert into organisation_memberships (organisation_id, user_id, status)
  values (p_organisation_id, v_user_id, 'invited')
  on conflict (organisation_id, user_id) do update
    set status = case
      when organisation_memberships.status = 'active' then 'active'
      else 'invited'
    end,
    ended_at = null,
    updated_at = now();

  insert into membership_roles (membership_id, role_id)
  select m.id, r.id
  from organisation_memberships m
  join roles r on r.organisation_id is null and r.key = any (v_roles)
  where m.organisation_id = p_organisation_id and m.user_id = v_user_id
  on conflict do nothing;

  insert into staff_profiles (
    organisation_id, user_id, job_title, employee_number, started_on
  ) values (
    p_organisation_id, v_user_id, nullif(trim(p_job_title), ''),
    nullif(trim(p_employee_number), ''), p_started_on
  )
  on conflict (organisation_id, user_id) do update
    set job_title = coalesce(excluded.job_title, staff_profiles.job_title),
        employee_number = coalesce(excluded.employee_number, staff_profiles.employee_number),
        started_on = coalesce(excluded.started_on, staff_profiles.started_on),
        updated_at = now()
  returning id into v_profile_id;

  if v_profile_id is null then
    select id into v_profile_id
    from staff_profiles
    where organisation_id = p_organisation_id and user_id = v_user_id;
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into invitations (
    organisation_id, email, invited_user_id, intended_role_keys, token_hash, expires_at, created_by
  ) values (
    p_organisation_id, p_email, v_user_id, v_roles, hash_invite_token(v_token),
    now() + interval '14 days', p_actor_user_id
  ) returning id into v_inv_id;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id,
    p_actor_user_id,
    'staff.profile.created',
    'staff_profile',
    v_profile_id,
    jsonb_build_object('email', p_email::text, 'roles', to_jsonb(v_roles), 'userId', v_user_id)
  );

  staff_profile_id := v_profile_id;
  invitation_id := v_inv_id;
  invitation_token := v_token;
  user_id := v_user_id;
  return next;
end;
$$;

revoke all on function provision_staff(uuid, uuid, citext, text, text, text, text[], date) from public;
grant execute on function provision_staff(uuid, uuid, citext, text, text, text, text[], date) to schoolapp_app;

create or replace function link_guardian(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_student_profile_id uuid,
  p_email citext,
  p_full_name text,
  p_relationship text,
  p_has_parental_responsibility boolean,
  p_is_emergency_contact boolean,
  p_lives_with_student boolean,
  p_portal_access boolean,
  p_priority smallint
)
returns table (
  guardianship_id uuid,
  invitation_id uuid,
  invitation_token text,
  guardian_user_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
  v_guard_id uuid;
  v_token text;
  v_inv_id uuid;
  v_has_credentials boolean := false;
begin
  if not actor_has_permission(p_actor_user_id, p_organisation_id, 'guardianships.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from student_profiles s
    where s.id = p_student_profile_id and s.organisation_id = p_organisation_id
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_email is null then
    raise exception 'guardian_email_required' using errcode = '22023';
  end if;

  select u.id into v_user_id from users u where u.email = p_email;
  if v_user_id is null then
    insert into users (email, full_name, user_kind, status)
    values (p_email, coalesce(nullif(trim(p_full_name), ''), p_email::text), 'parent', 'active')
    returning id into v_user_id;
  else
    select exists (select 1 from user_credentials c where c.user_id = v_user_id)
      into v_has_credentials;
  end if;

  insert into organisation_memberships (organisation_id, user_id, status)
  values (
    p_organisation_id,
    v_user_id,
    case when v_has_credentials then 'active' else 'invited' end
  )
  on conflict (organisation_id, user_id) do update
    set ended_at = null, updated_at = now();

  insert into membership_roles (membership_id, role_id)
  select m.id, r.id
  from organisation_memberships m
  join roles r on r.organisation_id is null and r.key = 'school.parent'
  where m.organisation_id = p_organisation_id and m.user_id = v_user_id
  on conflict do nothing;

  insert into guardianships (
    organisation_id, student_profile_id, guardian_user_id, relationship,
    has_parental_responsibility, is_emergency_contact, lives_with_student,
    restricted_contact, portal_access, priority, started_on
  ) values (
    p_organisation_id, p_student_profile_id, v_user_id, coalesce(nullif(p_relationship, ''), 'other'),
    coalesce(p_has_parental_responsibility, false),
    coalesce(p_is_emergency_contact, false),
    coalesce(p_lives_with_student, false),
    false,
    coalesce(p_portal_access, true),
    coalesce(p_priority, 1),
    current_date
  )
  returning id into v_guard_id;

  if not v_has_credentials then
    v_token := encode(gen_random_bytes(32), 'hex');
    insert into invitations (
      organisation_id, email, invited_user_id, intended_role_keys, token_hash, expires_at, created_by
    ) values (
      p_organisation_id, p_email, v_user_id, array['school.parent']::text[],
      hash_invite_token(v_token), now() + interval '14 days', p_actor_user_id
    ) returning id into v_inv_id;
  end if;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id,
    p_actor_user_id,
    'guardianship.created',
    'guardianship',
    v_guard_id,
    jsonb_build_object(
      'studentProfileId', p_student_profile_id,
      'guardianUserId', v_user_id,
      'relationship', coalesce(p_relationship, 'other')
    )
  );

  guardianship_id := v_guard_id;
  invitation_id := v_inv_id;
  invitation_token := v_token;
  guardian_user_id := v_user_id;
  return next;
end;
$$;

revoke all on function link_guardian(
  uuid, uuid, uuid, citext, text, text, boolean, boolean, boolean, boolean, smallint
) from public;
grant execute on function link_guardian(
  uuid, uuid, uuid, citext, text, text, boolean, boolean, boolean, boolean, smallint
) to schoolapp_app;

create or replace function seed_standard_year_groups(
  p_actor_user_id uuid,
  p_organisation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_max text;
  v_rank int;
  v_code text;
  v_inserted int := 0;
  v_rows int := 0;
begin
  if not actor_has_permission(p_actor_user_id, p_organisation_id, 'academic.structure.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select max_year_group_code into v_max
  from organisation_settings
  where organisation_id = p_organisation_id;
  v_max := coalesce(v_max, '8');
  v_rank := year_group_code_rank(v_max);

  insert into year_groups (organisation_id, code, name, key_stage, sort_order)
  select p_organisation_id, 'N', 'Nursery', 0, -1
  where year_group_code_rank('N') <= v_rank
  on conflict (organisation_id, code) do nothing;
  get diagnostics v_rows = row_count;
  v_inserted := v_inserted + v_rows;

  insert into year_groups (organisation_id, code, name, key_stage, sort_order)
  select p_organisation_id, 'R', 'Reception', 0, 0
  where year_group_code_rank('R') <= v_rank
  on conflict (organisation_id, code) do nothing;
  get diagnostics v_rows = row_count;
  v_inserted := v_inserted + v_rows;

  for v_code in
    select gs::text from generate_series(1, greatest(v_rank, 0)) gs
  loop
    insert into year_groups (organisation_id, code, name, key_stage, sort_order)
    values (
      p_organisation_id,
      v_code,
      'Year ' || v_code,
      year_group_key_stage(v_code),
      year_group_code_rank(v_code)
    )
    on conflict (organisation_id, code) do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function seed_standard_year_groups(uuid, uuid) from public;
grant execute on function seed_standard_year_groups(uuid, uuid) to schoolapp_app;
