-- Phase 2 review fixes:
-- 1. Promote an invited parent membership to active once they have credentials.
-- 2. Honour year_groups.student_login_enabled at alias login time, not only at provision.

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
  join year_groups yg
    on yg.id = se.year_group_id
   and yg.student_login_enabled
  where o.slug = p_slug
    and o.status = 'active'
  limit 1;
$$;

revoke all on function local_auth_lookup_alias(citext, citext) from public;
grant execute on function local_auth_lookup_alias(citext, citext) to schoolapp_app;

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
    set status = case
      when v_has_credentials then 'active'
      when organisation_memberships.status = 'active' then 'active'
      else 'invited'
    end,
    ended_at = null,
    updated_at = now();

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
