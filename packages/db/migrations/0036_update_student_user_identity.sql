-- School Admin must be able to maintain canonical pupil identity (legal name,
-- preferred name, date of birth) on users without a second DOB column and
-- without widening users_update_self (which would let staff change other
-- users' credentials). Only student-kind users linked to a same-org profile
-- can be updated, and only identity columns.

create or replace function update_student_user_identity(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_student_profile_id uuid,
  p_full_name text,
  p_set_preferred_name boolean,
  p_preferred_name text,
  p_set_date_of_birth boolean,
  p_date_of_birth date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
  v_user_kind text;
begin
  if p_actor_user_id is null or p_organisation_id is null or p_student_profile_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if nullif(current_setting('app.organisation_id', true), '') is not null
     and app_current_organisation_id() is distinct from p_organisation_id
     and not app_is_platform_admin() then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;

  if app_current_user_id() is not null
     and app_current_user_id() is distinct from p_actor_user_id
     and not app_is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if app_current_user_id() is not null and not app_is_platform_admin() and not exists (
    select 1 from organisation_memberships m
    where m.organisation_id = p_organisation_id
      and m.user_id = p_actor_user_id
      and m.status = 'active'
      and m.ended_at is null
  ) then
    raise exception 'tenant_context_membership_required' using errcode = '42501';
  end if;

  if not actor_has_permission(p_actor_user_id, p_organisation_id, 'students.profiles.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select sp.user_id, u.user_kind
    into v_user_id, v_user_kind
  from student_profiles sp
  join users u on u.id = sp.user_id
  where sp.id = p_student_profile_id
    and sp.organisation_id = p_organisation_id;

  if v_user_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_user_kind is distinct from 'student' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1 from organisation_memberships m
    where m.organisation_id = p_organisation_id
      and m.user_id = v_user_id
      and m.status in ('active', 'invited')
      and m.ended_at is null
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;

  if p_full_name is not null and char_length(trim(p_full_name)) < 1 then
    raise exception 'student_name_required' using errcode = '22023';
  end if;

  update users
  set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
      preferred_name = case
        when p_set_preferred_name then nullif(trim(p_preferred_name), '')
        else preferred_name
      end,
      date_of_birth = case
        when p_set_date_of_birth then p_date_of_birth
        else date_of_birth
      end
  where id = v_user_id
    and user_kind = 'student';

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function update_student_user_identity(
  uuid, uuid, uuid, text, boolean, text, boolean, date
) from public;
grant execute on function update_student_user_identity(
  uuid, uuid, uuid, text, boolean, text, boolean, date
) to schoolapp_app;
