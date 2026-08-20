-- Allow a first password on provisioned identities (staff/parent rows with no credentials).
-- Accounts that already have credentials still cannot have their password reset via invite.

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
  v_has_credentials boolean := false;
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
    select exists (select 1 from user_credentials c where c.user_id = v_user_id)
      into v_has_credentials;
    if not v_has_credentials then
      if p_password_hash is null or char_length(p_password_hash) < 16 then
        raise exception 'invitation_password_required' using errcode = '22023';
      end if;
      insert into user_credentials (user_id, password_hash)
      values (v_user_id, p_password_hash);
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
