-- Fix invitation return ambiguity and lock down restricted_contact column.

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
begin
  select * into v_inv
  from invitations
  where token_hash = hash_invite_token(p_token)
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'invitation_invalid' using errcode = 'P0002';
  end if;

  select u.id into v_user_id from users u where u.email = v_inv.email;
  if v_user_id is null then
    insert into users (email, full_name, user_kind, status)
    values (v_inv.email, p_full_name, 'staff', 'active')
    returning id into v_user_id;
    insert into user_credentials (user_id, password_hash) values (v_user_id, p_password_hash);
  else
    insert into user_credentials (user_id, password_hash)
    values (v_user_id, p_password_hash)
    on conflict (user_id) do update set password_hash = excluded.password_hash, updated_at = now();
    update users set full_name = p_full_name, status = 'active' where id = v_user_id;
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

revoke select, insert, update on guardianships from schoolapp_app;

grant select (
  id, organisation_id, student_profile_id, guardian_user_id, relationship,
  has_parental_responsibility, is_emergency_contact, lives_with_student,
  portal_access, priority, started_on, ended_on, created_at, updated_at
) on guardianships to schoolapp_app;

grant insert (
  id, organisation_id, student_profile_id, guardian_user_id, relationship,
  has_parental_responsibility, is_emergency_contact, lives_with_student,
  portal_access, priority, started_on, ended_on, created_at, updated_at
) on guardianships to schoolapp_app;

grant update (
  organisation_id, student_profile_id, guardian_user_id, relationship,
  has_parental_responsibility, is_emergency_contact, lives_with_student,
  portal_access, priority, started_on, ended_on, updated_at
) on guardianships to schoolapp_app;
