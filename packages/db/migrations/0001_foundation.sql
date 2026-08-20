-- Applied Phase 1 foundation. Source of truth for the running app.
-- Run as schoolapp_owner (BYPASSRLS). Runtime connects as schoolapp_app (NOBYPASSRLS).
-- Does not CREATE ROLE or CREATE EXTENSION (see scripts/setup-db.sh).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app_current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

create or replace function app_current_organisation_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.organisation_id', true), '')::uuid;
$$;

create or replace function app_is_platform_admin()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.is_platform_admin', true), 'false') = 'true';
$$;

-- Tenant isolation: organisation match ONLY.
-- Platform admin is NOT a bypass. Break-glass sets organisation_id after a grant.
create or replace function app_tenant_matches(p_organisation_id uuid)
returns boolean
language sql
stable
as $$
  select
    p_organisation_id is not null
    and p_organisation_id = app_current_organisation_id();
$$;

-- ---------------------------------------------------------------------------
-- Platform tables
-- ---------------------------------------------------------------------------

create table organisations (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  name text not null,
  legal_name text,
  country_code char(2) not null default 'GB',
  timezone text not null default 'Europe/London',
  status text not null default 'provisioning'
    check (status in ('provisioning', 'active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organisation_identifiers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  system text not null,
  identifier text not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, system)
);

create table organisation_settings (
  organisation_id uuid primary key references organisations (id),
  academic_year_start_month smallint not null default 9
    check (academic_year_start_month between 1 and 12),
  locale text not null default 'en-GB',
  extras jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organisation_feature_flags (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  flag_key text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, flag_key)
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext unique,
  username citext unique,
  full_name text not null,
  preferred_name text,
  user_kind text not null
    check (user_kind in ('platform_admin', 'staff', 'parent', 'student')),
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  date_of_birth date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform_admins (
  user_id uuid primary key references users (id),
  created_at timestamptz not null default now()
);

create table user_credentials (
  user_id uuid primary key references users (id),
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  refresh_token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table organisation_memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  user_id uuid not null references users (id),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (organisation_id, user_id)
);

create index organisation_memberships_user_id_idx
  on organisation_memberships (user_id);

create table permissions (
  key text primary key,
  description text not null,
  created_at timestamptz not null default now()
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations (id),
  key text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create unique index roles_system_key_idx
  on roles (key)
  where organisation_id is null;

create table role_permissions (
  role_id uuid not null references roles (id) on delete cascade,
  permission_key text not null references permissions (key),
  primary key (role_id, permission_key)
);

create table membership_roles (
  membership_id uuid not null references organisation_memberships (id) on delete cascade,
  role_id uuid not null references roles (id),
  primary key (membership_id, role_id)
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  email citext,
  invited_user_id uuid references users (id),
  intended_role_keys text[] not null default '{}',
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations (id),
  actor_user_id uuid not null references users (id),
  actor_membership_id uuid references organisation_memberships (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  request_id uuid,
  priority text not null default 'normal'
    check (priority in ('normal', 'high')),
  occurred_at timestamptz not null default now(),
  prev_hash bytea,
  row_hash bytea
);

create index audit_events_org_occurred_idx
  on audit_events (organisation_id, occurred_at desc);

create table support_access_grants (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  actor_user_id uuid not null references users (id),
  reason text not null check (char_length(trim(reason)) >= 8),
  scope text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index support_access_grants_org_idx
  on support_access_grants (organisation_id, created_at desc);

create table external_identifiers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  entity_type text not null,
  entity_id uuid not null,
  system text not null,
  identifier text not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, system, identifier)
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  entitlements jsonb not null default '{}'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table billing_accounts (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'closed')),
  extras jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organisation_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null unique references organisations (id),
  billing_account_id uuid references billing_accounts (id),
  plan_id uuid references plans (id),
  status text not null default 'none'
    check (status in ('none', 'trial', 'active', 'past_due', 'cancelled')),
  extras jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Academic / people (schema only in Phase 1; APIs not implemented)
-- ---------------------------------------------------------------------------

create table academic_years (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, name)
);

create table terms (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  academic_year_id uuid not null references academic_years (id),
  key text not null,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  sort_order int not null,
  created_at timestamptz not null default now(),
  unique (academic_year_id, key)
);

create table half_terms (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  term_id uuid not null references terms (id),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  sort_order int not null,
  created_at timestamptz not null default now()
);

create table year_groups (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  code text not null,
  name text not null,
  key_stage smallint,
  sort_order int not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, code)
);

create table houses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  name text not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, name)
);

create table subjects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  academic_year_id uuid not null references academic_years (id),
  year_group_id uuid references year_groups (id),
  name text not null,
  class_type text not null default 'form'
    check (class_type in ('form', 'teaching')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table staff_profiles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  user_id uuid not null references users (id),
  job_title text,
  employee_number text,
  started_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);

create table student_profiles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  user_id uuid references users (id),
  admission_number text,
  enrolment_status text not null default 'admitted'
    check (enrolment_status in ('prospective', 'admitted', 'enrolled', 'left', 'alumni')),
  legal_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index student_profiles_org_admission_number_idx
  on student_profiles (organisation_id, admission_number)
  where admission_number is not null;

create table student_enrolments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  academic_year_id uuid not null references academic_years (id),
  year_group_id uuid not null references year_groups (id),
  house_id uuid references houses (id),
  status text not null default 'enrolled'
    check (status in ('planned', 'enrolled', 'withdrawn', 'completed')),
  is_primary boolean not null default true,
  placement_kind text not null default 'primary'
    check (placement_kind in ('primary', 'secondary', 'exceptional')),
  started_on date not null,
  ended_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (is_primary and placement_kind = 'primary')
    or (not is_primary and placement_kind in ('secondary', 'exceptional'))
  )
);

create unique index student_enrolments_one_primary_per_year
  on student_enrolments (student_profile_id, academic_year_id)
  where is_primary;

create table class_memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  class_id uuid not null references classes (id),
  student_profile_id uuid not null references student_profiles (id),
  academic_year_id uuid not null references academic_years (id),
  started_on date not null,
  ended_on date,
  created_at timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on)
);

create unique index class_memberships_active_idx
  on class_memberships (class_id, student_profile_id)
  where ended_on is null;

create table class_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  class_id uuid not null references classes (id),
  staff_profile_id uuid not null references staff_profiles (id),
  assignment_role text not null
    check (assignment_role in ('form_tutor', 'co_tutor', 'subject_teacher', 'head_of_year', 'other')),
  started_on date not null,
  ended_on date,
  created_at timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on)
);

create unique index class_staff_assignments_active_idx
  on class_staff_assignments (class_id, staff_profile_id, assignment_role)
  where ended_on is null;

create table class_subjects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  class_id uuid not null references classes (id),
  subject_id uuid not null references subjects (id),
  created_at timestamptz not null default now(),
  unique (class_id, subject_id)
);

create table guardianships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  guardian_user_id uuid not null references users (id),
  relationship text not null default 'other',
  has_parental_responsibility boolean not null default false,
  is_emergency_contact boolean not null default false,
  lives_with_student boolean not null default false,
  restricted_contact boolean not null default false,
  portal_access boolean not null default true,
  priority smallint not null default 1,
  started_on date,
  ended_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_profile_id, guardian_user_id)
);

create table notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  user_id uuid not null references users (id),
  channel text not null
    check (channel in ('email', 'push', 'in_app')),
  category text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, user_id, channel, category)
);

create table inter_school_competition_networks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'disabled'
    check (status in ('disabled', 'planned', 'active')),
  extras jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table inter_school_competition_network_members (
  id uuid primary key default gen_random_uuid(),
  network_id uuid not null references inter_school_competition_networks (id),
  organisation_id uuid not null references organisations (id),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'withdrawn')),
  data_sharing_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (network_id, organisation_id)
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger organisations_updated_at before update on organisations
  for each row execute function set_updated_at();
create trigger organisation_settings_updated_at before update on organisation_settings
  for each row execute function set_updated_at();
create trigger users_updated_at before update on users
  for each row execute function set_updated_at();
create trigger organisation_memberships_updated_at before update on organisation_memberships
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Tenant context and bootstrap functions (SECURITY DEFINER / owner)
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
  v_has_membership boolean := false;
  v_has_grant boolean := false;
begin
  if p_user_id is null then
    raise exception 'tenant_context_user_required' using errcode = '28000';
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
    select exists (
      select 1
      from support_access_grants g
      where g.actor_user_id = p_user_id
        and g.organisation_id = p_organisation_id
        and g.revoked_at is null
        and g.expires_at > now()
    ) into v_has_grant;

    if not v_has_grant then
      raise exception 'tenant_context_support_grant_required' using errcode = '42501';
    end if;

    perform set_config('app.user_id', p_user_id::text, true);
    perform set_config('app.organisation_id', p_organisation_id::text, true);
    -- Tenant mode: no RLS bypass via platform flag.
    perform set_config('app.is_platform_admin', 'false', true);
    return;
  end if;

  raise exception 'tenant_context_membership_required' using errcode = '42501';
end;
$$;

revoke all on function set_tenant_context(uuid, uuid) from public;

create or replace function list_memberships_for_user(p_user_id uuid)
returns table (
  membership_id uuid,
  organisation_id uuid,
  organisation_name text,
  organisation_slug citext,
  status text,
  role_keys text[]
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select
    m.id,
    m.organisation_id,
    o.name,
    o.slug,
    m.status,
    coalesce(
      (
        select array_agg(r.key order by r.key)
        from membership_roles mr
        join roles r on r.id = mr.role_id
        where mr.membership_id = m.id
      ),
      '{}'::text[]
    ) as role_keys
  from organisation_memberships m
  join organisations o on o.id = m.organisation_id
  where m.user_id = p_user_id
    and m.ended_at is null;
$$;

revoke all on function list_memberships_for_user(uuid) from public;

create or replace function local_auth_lookup(p_email citext)
returns table (
  user_id uuid,
  password_hash text,
  full_name text,
  user_kind text,
  status text
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select u.id, c.password_hash, u.full_name, u.user_kind, u.status
  from users u
  join user_credentials c on c.user_id = u.id
  where u.email = p_email
  limit 1;
$$;

revoke all on function local_auth_lookup(citext) from public;

create or replace function hash_invite_token(p_token text)
returns text
language sql
immutable
as $$
  select encode(digest(p_token, 'sha256'), 'hex');
$$;

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
begin
  if not exists (select 1 from platform_admins where user_id = p_actor_user_id) then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  insert into organisations (slug, name, status)
  values (p_slug, p_name, 'active')
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
    jsonb_build_object('name', p_name, 'slug', p_slug::text, 'adminEmail', p_admin_email::text),
    'normal'
  );

  organisation_id := v_org_id;
  invitation_id := v_inv_id;
  invitation_token := v_token;
  return next;
end;
$$;

revoke all on function provision_organisation(uuid, text, citext, citext, text) from public;

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
  v_role record;
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

revoke all on function accept_invitation(text, text, text) from public;

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
  if not exists (
    select 1
    from organisation_memberships m
    join membership_roles mr on mr.membership_id = m.id
    join roles r on r.id = mr.role_id
    join role_permissions rp on rp.role_id = r.id
    where m.user_id = p_actor_user_id
      and m.organisation_id = p_organisation_id
      and m.status = 'active'
      and m.ended_at is null
      and rp.permission_key = 'org.members.manage'
  ) then
    raise exception 'forbidden' using errcode = '42501';
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

revoke all on function create_school_invitation(uuid, uuid, citext, text[]) from public;

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

revoke all on function open_support_access(uuid, uuid, text, text, interval) from public;

create or replace function revoke_support_access(
  p_actor_user_id uuid,
  p_grant_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_grant support_access_grants%rowtype;
begin
  if not exists (select 1 from platform_admins where user_id = p_actor_user_id) then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  select * into v_grant from support_access_grants where id = p_grant_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update support_access_grants set revoked_at = now() where id = p_grant_id and revoked_at is null;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data, priority
  ) values (
    v_grant.organisation_id, p_actor_user_id, 'platform.support_access.revoked',
    'support_access_grant', p_grant_id, jsonb_build_object('grantId', p_grant_id), 'high'
  );
end;
$$;

revoke all on function revoke_support_access(uuid, uuid) from public;

create or replace function list_platform_organisations(p_actor_user_id uuid)
returns table (
  id uuid,
  slug citext,
  name text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not exists (select 1 from platform_admins where user_id = p_actor_user_id) then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  return query
    select o.id, o.slug, o.name, o.status, o.created_at
    from organisations o
    order by o.created_at desc;
end;
$$;

revoke all on function list_platform_organisations(uuid) from public;

create or replace function list_permissions_for_membership(
  p_user_id uuid,
  p_organisation_id uuid
)
returns table (permission_key text)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select distinct rp.permission_key
  from organisation_memberships m
  join membership_roles mr on mr.membership_id = m.id
  join role_permissions rp on rp.role_id = mr.role_id
  where m.user_id = p_user_id
    and m.organisation_id = p_organisation_id
    and m.status = 'active'
    and m.ended_at is null;
$$;

revoke all on function list_permissions_for_membership(uuid, uuid) from public;
