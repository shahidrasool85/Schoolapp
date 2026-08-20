-- Phase 1 security review: invitation takeover, session revocation,
-- break-glass scope, role/org integrity, and tighter app-role grants.

-- ---------------------------------------------------------------------------
-- Integrity constraints
-- ---------------------------------------------------------------------------

create unique index if not exists student_profiles_org_user_id_idx
  on student_profiles (organisation_id, user_id)
  where user_id is not null;

alter table guardianships
  drop constraint if exists guardianships_student_profile_id_guardian_user_id_key;

create unique index if not exists guardianships_active_idx
  on guardianships (student_profile_id, guardian_user_id)
  where ended_on is null;

alter table support_access_grants
  drop constraint if exists support_access_grants_scope_check;

alter table support_access_grants
  add constraint support_access_grants_scope_check
  check (scope in ('organisation', 'organisation_metadata'));

create or replace function membership_roles_same_org()
returns trigger
language plpgsql
as $$
declare
  v_membership_org uuid;
  v_role_org uuid;
begin
  select organisation_id into v_membership_org
  from organisation_memberships
  where id = new.membership_id;

  if v_membership_org is null then
    raise exception 'membership_role_org_mismatch' using errcode = '23514';
  end if;

  select organisation_id into v_role_org
  from roles
  where id = new.role_id;

  -- Null organisation_id on roles is a system template and may bind anywhere.
  if v_role_org is not null and v_role_org is distinct from v_membership_org then
    raise exception 'membership_role_org_mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists membership_roles_same_org on membership_roles;
create trigger membership_roles_same_org
  before insert or update on membership_roles
  for each row execute function membership_roles_same_org();

-- ---------------------------------------------------------------------------
-- Roles: system templates are readable, not writable, by the app role.
-- ---------------------------------------------------------------------------

drop policy if exists roles_tenant_isolation on roles;

create policy roles_select on roles
  for select
  using (
    organisation_id is null
    or app_tenant_matches(organisation_id)
  );

create policy roles_write_tenant_custom on roles
  for insert
  with check (
    organisation_id is not null
    and app_tenant_matches(organisation_id)
  );

create policy roles_update_tenant_custom on roles
  for update
  using (
    organisation_id is not null
    and app_tenant_matches(organisation_id)
  )
  with check (
    organisation_id is not null
    and app_tenant_matches(organisation_id)
  );

create policy roles_delete_tenant_custom on roles
  for delete
  using (
    organisation_id is not null
    and app_tenant_matches(organisation_id)
  );

-- Users: no DELETE path for the app role (policy + grant).
drop policy if exists users_delete_denied on users;
create policy users_delete_denied on users
  for delete
  using (false);

-- ---------------------------------------------------------------------------
-- Tenant context: active user; full-org grant only for break-glass.
-- ---------------------------------------------------------------------------

create or replace function set_tenant_context(
  p_user_id uuid,
  p_organisation_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_is_platform_admin boolean := false;
  v_user_status text;
  v_has_membership boolean := false;
  v_has_grant boolean := false;
begin
  if p_user_id is null then
    raise exception 'tenant_context_user_required' using errcode = '28000';
  end if;

  select u.status into v_user_status from users u where u.id = p_user_id;
  if v_user_status is null then
    raise exception 'tenant_context_user_required' using errcode = '28000';
  end if;
  if v_user_status <> 'active' then
    raise exception 'tenant_context_user_disabled' using errcode = '28000';
  end if;

  select exists (
    select 1 from platform_admins pa where pa.user_id = p_user_id
  ) into v_is_platform_admin;

  if p_organisation_id is null then
    perform set_config('app.user_id', p_user_id::text, true);
    perform set_config('app.organisation_id', '', true);
    perform set_config(
      'app.is_platform_admin',
      case when v_is_platform_admin then 'true' else 'false' end,
      true
    );
    return;
  end if;

  select exists (
    select 1
    from organisation_memberships m
    where m.user_id = p_user_id
      and m.organisation_id = p_organisation_id
      and m.status = 'active'
      and m.ended_at is null
  ) into v_has_membership;

  if v_has_membership then
    perform set_config('app.user_id', p_user_id::text, true);
    perform set_config('app.organisation_id', p_organisation_id::text, true);
    perform set_config('app.is_platform_admin', 'false', true);
    return;
  end if;

  if v_is_platform_admin then
    -- organisation_metadata is recorded but does not enter tenant RLS.
    select exists (
      select 1
      from support_access_grants g
      where g.actor_user_id = p_user_id
        and g.organisation_id = p_organisation_id
        and g.revoked_at is null
        and g.expires_at > now()
        and g.scope = 'organisation'
    ) into v_has_grant;

    if not v_has_grant then
      raise exception 'tenant_context_support_grant_required' using errcode = '42501';
    end if;

    perform set_config('app.user_id', p_user_id::text, true);
    perform set_config('app.organisation_id', p_organisation_id::text, true);
    perform set_config('app.is_platform_admin', 'false', true);
    return;
  end if;

  raise exception 'tenant_context_membership_required' using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

create or replace function assert_active_session(
  p_user_id uuid,
  p_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
  v_revoked timestamptz;
  v_expires timestamptz;
begin
  select u.status into v_status from users u where u.id = p_user_id;
  if v_status is null or v_status <> 'active' then
    raise exception 'session_invalid' using errcode = '28000';
  end if;

  select s.revoked_at, s.expires_at into v_revoked, v_expires
  from auth_sessions s
  where s.id = p_session_id
    and s.user_id = p_user_id;

  if not found or v_revoked is not null or v_expires <= now() then
    raise exception 'session_invalid' using errcode = '28000';
  end if;
end;
$$;

revoke all on function assert_active_session(uuid, uuid) from public;
grant execute on function assert_active_session(uuid, uuid) to schoolapp_app;

create or replace function revoke_auth_session(
  p_user_id uuid,
  p_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update auth_sessions
  set revoked_at = now()
  where id = p_session_id
    and user_id = p_user_id
    and revoked_at is null;
end;
$$;

revoke all on function revoke_auth_session(uuid, uuid) from public;
grant execute on function revoke_auth_session(uuid, uuid) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Invitations: never overwrite an existing account's credentials.
-- ---------------------------------------------------------------------------

create or replace function lookup_invitation_for_accept(p_token text)
returns table (
  invitation_id uuid,
  email citext,
  existing_user_id uuid,
  existing_user_status text,
  has_credentials boolean
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select
    i.id,
    i.email,
    u.id,
    u.status,
    (c.user_id is not null)
  from invitations i
  left join users u on u.email = i.email
  left join user_credentials c on c.user_id = u.id
  where i.token_hash = hash_invite_token(p_token)
    and i.accepted_at is null
    and i.expires_at > now()
  limit 1;
$$;

revoke all on function lookup_invitation_for_accept(text) from public;
grant execute on function lookup_invitation_for_accept(text) to schoolapp_app;

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
begin
  select * into v_inv
  from invitations
  where token_hash = hash_invite_token(p_token)
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'invitation_invalid' using errcode = 'P0002';
  end if;

  select u.id, u.status into v_user_id, v_status
  from users u
  where u.email = v_inv.email;

  if v_user_id is null then
    if p_password_hash is null or char_length(p_password_hash) < 16 then
      raise exception 'invitation_password_required' using errcode = '22023';
    end if;
    insert into users (email, full_name, user_kind, status)
    values (v_inv.email, p_full_name, 'staff', 'active')
    returning id into v_user_id;
    insert into user_credentials (user_id, password_hash) values (v_user_id, p_password_hash);
  else
    if v_status <> 'active' then
      raise exception 'invitation_user_disabled' using errcode = '42501';
    end if;
    -- Existing account: attach membership only. Never reset password, name, or status.
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

grant execute on function accept_invitation(text, text, text) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Break-glass: persist only known scopes.
-- ---------------------------------------------------------------------------

create or replace function open_support_access(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_reason text,
  p_scope text,
  p_ttl interval
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from platform_admins where user_id = p_actor_user_id) then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  if char_length(trim(p_reason)) < 8 then
    raise exception 'support_reason_required' using errcode = '22023';
  end if;
  if p_scope not in ('organisation', 'organisation_metadata') then
    raise exception 'support_scope_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from organisations where id = p_organisation_id) then
    raise exception 'organisation_not_found' using errcode = 'P0002';
  end if;

  insert into support_access_grants (
    organisation_id, actor_user_id, reason, scope, expires_at
  ) values (
    p_organisation_id, p_actor_user_id, trim(p_reason), p_scope, now() + p_ttl
  ) returning id into v_id;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id,
    after_data, priority
  ) values (
    p_organisation_id,
    p_actor_user_id,
    'platform.support_access.granted',
    'support_access_grant',
    v_id,
    jsonb_build_object(
      'reason', trim(p_reason),
      'scope', p_scope,
      'expiresAt', (now() + p_ttl)
    ),
    'high'
  );

  return v_id;
end;
$$;

grant execute on function open_support_access(uuid, uuid, text, text, interval) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- App role: identity/RBAC writes go through SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------

revoke insert, update, delete on roles from schoolapp_app;
grant select on roles to schoolapp_app;

revoke insert, update, delete on role_permissions from schoolapp_app;
grant select on role_permissions to schoolapp_app;

revoke insert, update, delete on membership_roles from schoolapp_app;
grant select on membership_roles to schoolapp_app;

revoke insert, update, delete on invitations from schoolapp_app;
grant select on invitations to schoolapp_app;

revoke insert, update, delete on support_access_grants from schoolapp_app;
grant select on support_access_grants to schoolapp_app;

revoke insert, update, delete on organisation_memberships from schoolapp_app;
grant select on organisation_memberships to schoolapp_app;

revoke insert, delete on users from schoolapp_app;
grant select, update on users to schoolapp_app;
