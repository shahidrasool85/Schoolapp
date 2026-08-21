-- Phase 5: SaaS hostname tenancy, reserved slugs, custom-domain foundation, onboarding guards.
-- Does not weaken FORCE RLS, transaction-local tenant context, or membership revalidation.
-- Organisation UUID remains canonical identity; slug/hostname are routing identities only.

-- ---------------------------------------------------------------------------
-- Reserved platform subdomains (keep in sync with packages/domain/src/slugs.ts)
-- ---------------------------------------------------------------------------

create table reserved_subdomains (
  slug citext primary key,
  reason text not null
);

insert into reserved_subdomains (slug, reason) values
  ('www', 'platform'),
  ('app', 'platform'),
  ('api', 'platform'),
  ('admin', 'platform'),
  ('platform', 'platform'),
  ('login', 'platform'),
  ('auth', 'platform'),
  ('support', 'platform'),
  ('help', 'platform'),
  ('status', 'platform'),
  ('mail', 'infrastructure'),
  ('email', 'infrastructure'),
  ('smtp', 'infrastructure'),
  ('cdn', 'infrastructure'),
  ('assets', 'infrastructure'),
  ('static', 'infrastructure'),
  ('docs', 'platform'),
  ('localhost', 'development'),
  ('local', 'development'),
  ('localdomain', 'development'),
  ('intranet', 'infrastructure'),
  ('internal', 'infrastructure'),
  ('private', 'infrastructure'),
  ('host', 'infrastructure'),
  ('ns', 'infrastructure'),
  ('ns1', 'infrastructure'),
  ('ns2', 'infrastructure'),
  ('mx', 'infrastructure'),
  ('ftp', 'infrastructure'),
  ('sftp', 'infrastructure'),
  ('ssh', 'infrastructure'),
  ('vpn', 'infrastructure'),
  ('imap', 'infrastructure'),
  ('pop', 'infrastructure'),
  ('pop3', 'infrastructure'),
  ('webmail', 'infrastructure'),
  ('autoconfig', 'infrastructure'),
  ('autodiscover', 'infrastructure'),
  ('mta-sts', 'infrastructure'),
  ('test', 'development'),
  ('testing', 'development'),
  ('staging', 'development'),
  ('stage', 'development'),
  ('prod', 'infrastructure'),
  ('production', 'infrastructure'),
  ('preview', 'development'),
  ('beta', 'development'),
  ('alpha', 'development'),
  ('demo', 'development'),
  ('dev', 'development'),
  ('development', 'development'),
  ('ci', 'development'),
  ('qa', 'development'),
  ('root', 'infrastructure'),
  ('null', 'infrastructure'),
  ('undefined', 'infrastructure'),
  ('default', 'infrastructure'),
  ('wildcard', 'infrastructure'),
  ('wss', 'infrastructure'),
  ('ws', 'infrastructure'),
  ('graphql', 'infrastructure'),
  ('grpc', 'infrastructure'),
  ('webhook', 'infrastructure'),
  ('webhooks', 'infrastructure'),
  ('oauth', 'platform'),
  ('sso', 'platform'),
  ('identity', 'platform'),
  ('accounts', 'platform'),
  ('account', 'platform'),
  ('billing', 'platform'),
  ('pay', 'platform'),
  ('payments', 'platform'),
  ('signup', 'platform'),
  ('register', 'platform'),
  ('onboarding', 'platform'),
  ('superadmin', 'platform'),
  ('administrator', 'platform'),
  ('origin', 'infrastructure'),
  ('edge', 'infrastructure'),
  ('gateway', 'infrastructure'),
  ('proxy', 'infrastructure'),
  ('nginx', 'infrastructure'),
  ('plesk', 'infrastructure'),
  ('server', 'infrastructure'),
  ('mobile', 'platform'),
  ('schools', 'platform'),
  ('school', 'platform'),
  ('tenant', 'platform'),
  ('tenants', 'platform'),
  ('org', 'platform'),
  ('orgs', 'platform');

alter table reserved_subdomains enable row level security;
alter table reserved_subdomains force row level security;

create policy reserved_subdomains_read
  on reserved_subdomains
  for select
  using (true);

grant select on reserved_subdomains to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Former slugs cannot be claimed by a different organisation
-- ---------------------------------------------------------------------------

create table organisation_slug_history (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  slug citext not null,
  retired_at timestamptz not null default now(),
  unique (slug)
);

create index organisation_slug_history_org_idx
  on organisation_slug_history (organisation_id);

alter table organisation_slug_history enable row level security;
alter table organisation_slug_history force row level security;

create policy organisation_slug_history_tenant_select
  on organisation_slug_history
  for select
  using (app_tenant_matches(organisation_id));

grant select on organisation_slug_history to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Custom hostnames (unverified rows must never resolve)
-- ---------------------------------------------------------------------------

create table organisation_hostnames (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  hostname citext not null,
  kind text not null default 'custom'
    check (kind in ('custom')),
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'failed')),
  is_active boolean not null default false,
  verification_token text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hostname),
  check (
    hostname::text ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    and hostname::text not like 'xn--%'
    and position('--' in hostname::text) = 0
  ),
  check (
    (verification_status = 'verified' and is_active = true and verified_at is not null)
    or (is_active = false)
  )
);

create index organisation_hostnames_org_idx
  on organisation_hostnames (organisation_id);

create unique index organisation_hostnames_active_hostname_idx
  on organisation_hostnames (hostname)
  where is_active = true and verification_status = 'verified';

create trigger organisation_hostnames_updated_at before update on organisation_hostnames
  for each row execute function set_updated_at();

alter table organisation_hostnames enable row level security;
alter table organisation_hostnames force row level security;

create policy organisation_hostnames_tenant_select
  on organisation_hostnames
  for select
  using (app_tenant_matches(organisation_id));

create policy organisation_hostnames_tenant_insert_pending
  on organisation_hostnames
  for insert
  with check (
    app_tenant_matches(organisation_id)
    and verification_status = 'pending'
    and is_active = false
    and kind = 'custom'
  );

create policy organisation_hostnames_tenant_delete_pending
  on organisation_hostnames
  for delete
  using (
    app_tenant_matches(organisation_id)
    and verification_status = 'pending'
    and is_active = false
  );

grant select, insert, delete on organisation_hostnames to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Slug guards (format + reserved + history). Trigger is the authority.
-- ---------------------------------------------------------------------------

create or replace function organisations_slug_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.slug := lower(btrim(new.slug::text))::citext;

  if new.slug::text !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
     or char_length(new.slug::text) not between 2 and 63
     or position('--' in new.slug::text) > 0
     or new.slug::text like 'xn--%' then
    raise exception 'slug_invalid' using errcode = '23514';
  end if;

  if exists (select 1 from reserved_subdomains r where r.slug = new.slug) then
    raise exception 'slug_reserved' using errcode = '23514';
  end if;

  if exists (
    select 1
    from organisation_slug_history h
    where h.slug = new.slug
      and h.organisation_id <> new.id
  ) then
    raise exception 'slug_in_history' using errcode = '23505';
  end if;

  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    insert into organisation_slug_history (organisation_id, slug)
    values (old.id, old.slug);
    delete from organisation_slug_history
     where organisation_id = new.id
       and slug = new.slug;
  end if;

  return new;
end;
$$;

revoke all on function organisations_slug_guard() from public;
revoke all on function organisations_slug_guard() from schoolapp_app;

create trigger organisations_slug_guard
  before insert or update of slug on organisations
  for each row execute function organisations_slug_guard();

-- ---------------------------------------------------------------------------
-- Public routing lookups. Return only public identity fields for active orgs.
-- Unverified / inactive custom hostnames never match.
-- ---------------------------------------------------------------------------

create or replace function lookup_active_organisation_by_slug(p_slug citext)
returns table (
  organisation_id uuid,
  slug citext,
  name text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
    select o.id, o.slug, o.name
    from organisations o
    where o.slug = lower(btrim(p_slug::text))::citext
      and o.status = 'active'
    limit 1;
end;
$$;

revoke all on function lookup_active_organisation_by_slug(citext) from public;
grant execute on function lookup_active_organisation_by_slug(citext) to schoolapp_app;

create or replace function lookup_active_organisation_by_hostname(p_hostname citext)
returns table (
  organisation_id uuid,
  slug citext,
  name text,
  hostname citext
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
    select o.id, o.slug, o.name, h.hostname
    from organisation_hostnames h
    join organisations o on o.id = h.organisation_id
    where h.hostname = lower(btrim(p_hostname::text))::citext
      and h.verification_status = 'verified'
      and h.is_active = true
      and o.status = 'active'
    limit 1;
end;
$$;

revoke all on function lookup_active_organisation_by_hostname(citext) from public;
grant execute on function lookup_active_organisation_by_hostname(citext) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Onboarding: strengthen provision_organisation (transactional, slug-safe)
-- ---------------------------------------------------------------------------

create or replace function provision_organisation(
  p_actor_user_id uuid,
  p_name text,
  p_slug citext,
  p_admin_email citext,
  p_admin_full_name text
)
returns table (
  organisation_id uuid,
  invitation_id uuid,
  invitation_token text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org_id uuid;
  v_inv_id uuid;
  v_token text;
  v_plan_id uuid;
  v_slug citext;
begin
  if not exists (select 1 from platform_admins where user_id = p_actor_user_id) then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'slug_invalid' using errcode = '23514';
  end if;

  v_slug := lower(btrim(p_slug::text))::citext;

  insert into organisations (slug, name, status)
  values (v_slug, btrim(p_name), 'active')
  returning id into v_org_id;

  insert into organisation_settings (organisation_id) values (v_org_id);

  select id into v_plan_id from plans where key = 'default' limit 1;
  insert into organisation_subscriptions (organisation_id, plan_id, status)
  values (v_org_id, v_plan_id, 'trial');

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into invitations (
    organisation_id, email, intended_role_keys, token_hash, expires_at, created_by
  ) values (
    v_org_id,
    p_admin_email,
    array['school.admin']::text[],
    hash_invite_token(v_token),
    now() + interval '14 days',
    p_actor_user_id
  ) returning id into v_inv_id;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data, priority
  ) values (
    v_org_id,
    p_actor_user_id,
    'platform.organisation.provisioned',
    'organisation',
    v_org_id,
    jsonb_build_object(
      'name', btrim(p_name),
      'slug', v_slug::text,
      'adminEmail', p_admin_email::text,
      'onboarding', 'internal_platform'
    ),
    'normal'
  );

  organisation_id := v_org_id;
  invitation_id := v_inv_id;
  invitation_token := v_token;
  return next;
end;
$$;

revoke all on function provision_organisation(uuid, text, citext, citext, text) from public;
grant execute on function provision_organisation(uuid, text, citext, citext, text) to schoolapp_app;

create or replace function change_organisation_slug_as_platform(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_new_slug citext
)
returns citext
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_old citext;
  v_new citext;
begin
  if not exists (select 1 from platform_admins where user_id = p_actor_user_id) then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  select slug into v_old from organisations where id = p_organisation_id;
  if v_old is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_new := lower(btrim(p_new_slug::text))::citext;
  update organisations set slug = v_new where id = p_organisation_id;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, priority
  ) values (
    p_organisation_id,
    p_actor_user_id,
    'platform.organisation.slug_changed',
    'organisation',
    p_organisation_id,
    jsonb_build_object('slug', v_old::text),
    jsonb_build_object('slug', v_new::text),
    'normal'
  );

  return v_new;
end;
$$;

revoke all on function change_organisation_slug_as_platform(uuid, uuid, citext) from public;
grant execute on function change_organisation_slug_as_platform(uuid, uuid, citext) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Custom hostname registration (pending) and platform activation
-- ---------------------------------------------------------------------------

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

  if v_row.verification_status = 'verified' and v_row.is_active then
    return;
  end if;

  update organisation_hostnames
     set verification_status = 'verified',
         is_active = true,
         verified_at = now()
   where id = p_hostname_id;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data, priority
  ) values (
    v_row.organisation_id,
    p_actor_user_id,
    'platform.hostname.activated',
    'organisation_hostname',
    p_hostname_id,
    jsonb_build_object('hostname', v_row.hostname::text, 'verificationStatus', 'verified'),
    'normal'
  );
end;
$$;

revoke all on function activate_organisation_hostname(uuid, uuid) from public;
grant execute on function activate_organisation_hostname(uuid, uuid) to schoolapp_app;

create or replace function deactivate_organisation_hostname(
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
  v_has_permission boolean := false;
begin
  select * into v_row from organisation_hostnames where id = p_hostname_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  perform 1
  from organisation_memberships m
  join membership_roles mr on mr.membership_id = m.id
  join role_permissions rp on rp.role_id = mr.role_id
  where m.user_id = p_actor_user_id
    and m.organisation_id = v_row.organisation_id
    and m.status = 'active'
    and rp.permission_key = 'org.settings.manage';
  v_has_permission := found;

  if not v_has_permission and not exists (select 1 from platform_admins where user_id = p_actor_user_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update organisation_hostnames
     set is_active = false,
         verification_status = case
           when verification_status = 'verified' then 'verified'
           else verification_status
         end
   where id = p_hostname_id;

  -- CHECK constraint requires is_active=false without requiring verified_at null.
  -- Verified-but-inactive rows must not resolve; lookup filters is_active.

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    v_row.organisation_id,
    p_actor_user_id,
    'org.hostname.deactivated',
    'organisation_hostname',
    p_hostname_id,
    jsonb_build_object('hostname', v_row.hostname::text, 'isActive', false)
  );
end;
$$;

revoke all on function deactivate_organisation_hostname(uuid, uuid) from public;
grant execute on function deactivate_organisation_hostname(uuid, uuid) to schoolapp_app;
