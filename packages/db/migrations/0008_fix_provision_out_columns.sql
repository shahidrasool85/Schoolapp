-- Fix PL/pgSQL OUT-column collisions in provision_staff / link_guardian.
-- Already-applied 0007 copies cannot be edited in place.

drop function if exists provision_staff(uuid, uuid, citext, text, text, text, text[], date);
drop function if exists link_guardian(uuid, uuid, uuid, citext, text, text, boolean, boolean, boolean, boolean, smallint);

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
  created_user_id uuid
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
  created_user_id := v_user_id;
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
  created_user_id uuid
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
  created_user_id := v_user_id;
  return next;
end;
$$;

revoke all on function link_guardian(
  uuid, uuid, uuid, citext, text, text, boolean, boolean, boolean, boolean, smallint
) from public;
grant execute on function link_guardian(
  uuid, uuid, uuid, citext, text, text, boolean, boolean, boolean, boolean, smallint
) to schoolapp_app;
