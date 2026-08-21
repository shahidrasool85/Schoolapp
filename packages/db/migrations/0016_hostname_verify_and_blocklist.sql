-- Phase 5 follow-up:
-- 1. Custom-domain activation must not implicitly mark DNS/ownership as verified.
--    Platform verify is an operator attestation until automated DNS exists.
-- 2. Infrastructure / special-use names cannot be registered as custom hostnames.
--    Keep BLOCKED_CUSTOM_HOSTNAME_TLDS in sync with packages/domain/src/slugs.ts.

create or replace function hostname_is_blocked_custom(p_hostname text)
returns boolean
language sql
immutable
as $$
  select
    p_hostname ~ '^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$'
    or p_hostname in (
      'localhost', 'local', 'localdomain', 'invalid', 'test', 'example', 'onion',
      'intranet', 'internal', 'private', 'lan', 'home', 'corp', 'arpa'
    )
    or p_hostname ~ '\.(localhost|local|localdomain|invalid|test|example|onion|intranet|internal|private|lan|home|corp|arpa)$';
$$;

revoke all on function hostname_is_blocked_custom(text) from public;

create or replace function register_organisation_hostname(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_hostname citext
)
returns table (
  hostname_id uuid,
  hostname citext,
  verification_status text,
  is_active boolean,
  verification_token text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_host citext;
  v_id uuid;
  v_token text;
  v_has_permission boolean := false;
begin
  v_host := lower(btrim(p_hostname::text))::citext;

  if v_host::text !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
     or v_host::text like 'xn--%'
     or position('--' in v_host::text) > 0 then
    raise exception 'hostname_invalid' using errcode = '23514';
  end if;

  if hostname_is_blocked_custom(v_host::text) then
    raise exception 'hostname_reserved' using errcode = '23514';
  end if;

  perform 1
  from organisation_memberships m
  join membership_roles mr on mr.membership_id = m.id
  join role_permissions rp on rp.role_id = mr.role_id
  where m.user_id = p_actor_user_id
    and m.organisation_id = p_organisation_id
    and m.status = 'active'
    and rp.permission_key = 'org.settings.manage';
  v_has_permission := found;

  if not v_has_permission then
    if not exists (select 1 from platform_admins where user_id = p_actor_user_id) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  if not exists (select 1 from organisations where id = p_organisation_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_token := encode(gen_random_bytes(16), 'hex');
  insert into organisation_hostnames (
    organisation_id, hostname, kind, verification_status, is_active, verification_token
  ) values (
    p_organisation_id, v_host, 'custom', 'pending', false, v_token
  )
  returning organisation_hostnames.id into v_id;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id,
    p_actor_user_id,
    'org.hostname.registered',
    'organisation_hostname',
    v_id,
    jsonb_build_object('hostname', v_host::text, 'verificationStatus', 'pending')
  );

  hostname_id := v_id;
  hostname := v_host;
  verification_status := 'pending';
  is_active := false;
  verification_token := v_token;
  return next;
end;
$$;

revoke all on function register_organisation_hostname(uuid, uuid, citext) from public;
grant execute on function register_organisation_hostname(uuid, uuid, citext) to schoolapp_app;

-- Operator attestation of control. Does not resolve the hostname (is_active stays false).
create or replace function verify_organisation_hostname(
  p_actor_user_id uuid,
  p_hostname_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row organisation_hostnames%rowtype;
begin
  if not exists (select 1 from platform_admins where user_id = p_actor_user_id) then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  select * into v_row from organisation_hostnames where id = p_hostname_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_row.verification_status = 'verified' then
    return;
  end if;

  update organisation_hostnames
     set verification_status = 'verified',
         verified_at = now(),
         is_active = false
   where id = p_hostname_id;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data, priority
  ) values (
    v_row.organisation_id,
    p_actor_user_id,
    'platform.hostname.verified',
    'organisation_hostname',
    p_hostname_id,
    jsonb_build_object('hostname', v_row.hostname::text, 'verificationStatus', 'verified', 'isActive', false),
    'normal'
  );
end;
$$;

revoke all on function verify_organisation_hostname(uuid, uuid) from public;
grant execute on function verify_organisation_hostname(uuid, uuid) to schoolapp_app;

create or replace function activate_organisation_hostname(
  p_actor_user_id uuid,
  p_hostname_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row organisation_hostnames%rowtype;
begin
  if not exists (select 1 from platform_admins where user_id = p_actor_user_id) then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  select * into v_row from organisation_hostnames where id = p_hostname_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_row.verification_status is distinct from 'verified' then
    raise exception 'hostname_not_verified' using errcode = '23514';
  end if;

  if v_row.is_active then
    return;
  end if;

  update organisation_hostnames
     set is_active = true,
         verified_at = coalesce(verified_at, now())
   where id = p_hostname_id;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data, priority
  ) values (
    v_row.organisation_id,
    p_actor_user_id,
    'platform.hostname.activated',
    'organisation_hostname',
    p_hostname_id,
    jsonb_build_object('hostname', v_row.hostname::text, 'verificationStatus', 'verified', 'isActive', true),
    'normal'
  );
end;
$$;

revoke all on function activate_organisation_hostname(uuid, uuid) from public;
grant execute on function activate_organisation_hostname(uuid, uuid) to schoolapp_app;
