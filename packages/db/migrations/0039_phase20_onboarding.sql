-- Phase 20: production school onboarding, branding, account lifecycle,
-- password reset, inspectable mail outbox, and controlled CSV import.
-- Additive. Does not weaken FORCE RLS, tenant context, hostname tenancy,
-- membership revalidation, teacher assigned-only access, guardianship /
-- portal_access, student self-only access, student portal policy,
-- safeguarding capabilities, statutory privacy, medication/dietary privacy,
-- break-glass, or audit.
-- Treats migrations 0001–0038 as immutable.

-- ---------------------------------------------------------------------------
-- Permissions (reuse org.settings / org.members / guardianships where possible)
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('onboarding.read', 'Read school setup progress and readiness'),
  ('onboarding.manage', 'Run the school setup wizard and mark onboarding complete'),
  ('imports.manage', 'Upload and confirm bulk staff, pupil, and guardian imports')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'onboarding.read'),
    ('school.admin', 'onboarding.manage'),
    ('school.admin', 'imports.manage'),
    ('school.headteacher', 'onboarding.read')
) as x(role_key, perm)
  on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select org_role.id, rp.permission_key
from roles sys
join role_permissions rp on rp.role_id = sys.id
join roles org_role on org_role.key = sys.key and org_role.organisation_id is not null
where sys.organisation_id is null
  and rp.permission_key in ('onboarding.read', 'onboarding.manage', 'imports.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Organisation profile / branding columns
-- ---------------------------------------------------------------------------

alter table organisations
  add column if not exists school_code text;

alter table organisation_settings
  add column if not exists contact_telephone text,
  add column if not exists contact_email text,
  add column if not exists website text,
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists city text,
  add column if not exists postcode text,
  add column if not exists tagline text,
  add column if not exists primary_colour text,
  add column if not exists accent_colour text,
  add column if not exists logo_object_id uuid,
  add column if not exists hero_object_id uuid;

alter table stored_objects drop constraint if exists stored_objects_domain_check;
alter table stored_objects add constraint stored_objects_domain_check
  check (domain in (
    'admissions_form',
    'admissions_application',
    'student_document',
    'learning_resource',
    'learning_submission',
    'pastoral',
    'safeguarding',
    'activity',
    'message',
    'branding'
  ));

alter table organisation_settings
  drop constraint if exists organisation_settings_logo_object_id_fkey;
alter table organisation_settings
  add constraint organisation_settings_logo_object_id_fkey
  foreign key (logo_object_id) references stored_objects (id);
alter table organisation_settings
  drop constraint if exists organisation_settings_hero_object_id_fkey;
alter table organisation_settings
  add constraint organisation_settings_hero_object_id_fkey
  foreign key (hero_object_id) references stored_objects (id);

-- Boolean-only credential probe. Never returns password hashes (FORCE RLS denies
-- direct SELECT on user_credentials for schoolapp_app).
create or replace function user_has_local_credentials(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists(select 1 from user_credentials where user_id = p_user_id);
$$;

revoke all on function user_has_local_credentials(uuid) from public;
grant execute on function user_has_local_credentials(uuid) to schoolapp_app;

-- School Admin / Headteacher / Admissions with org.members.read must still see
-- suspended staff and parents after membership status changes. Phase 11.5 only
-- exposed active + invited members (ended_at is null). Suspended memberships
-- keep a row (status = 'suspended', ended_at set) so they can be reactivated
-- without leaking those identities to teachers.
drop policy if exists users_self_or_current_tenant on users;

create policy users_self_or_current_tenant on users
  for select
  using (
    id = app_current_user_id()
    or exists (
      select 1
      from organisation_memberships m
      where m.user_id = users.id
        and m.organisation_id = app_current_organisation_id()
        and m.status = 'active'
    )
    or (
      actor_has_permission(
        app_current_user_id(),
        app_current_organisation_id(),
        'guardianships.manage'
      )
      and exists (
        select 1
        from guardianships g
        where g.guardian_user_id = users.id
          and g.organisation_id = app_current_organisation_id()
          and g.ended_on is null
      )
    )
    or (
      actor_has_permission(
        app_current_user_id(),
        app_current_organisation_id(),
        'org.members.read'
      )
      and exists (
        select 1
        from organisation_memberships m
        where m.user_id = users.id
          and m.organisation_id = app_current_organisation_id()
          and (
            (m.status in ('active', 'invited') and m.ended_at is null)
            or m.status = 'suspended'
          )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Setup progress (resumable wizard)
-- ---------------------------------------------------------------------------

create table organisation_setup_progress (
  organisation_id uuid primary key references organisations (id) on delete cascade,
  current_step text not null default 'school_details'
    check (current_step in (
      'school_details', 'branding', 'academic_year', 'academic_structure',
      'school_day', 'rooms', 'staff', 'pupils', 'portals', 'completion'
    )),
  completed_steps text[] not null default '{}',
  completed_at timestamptz,
  ready_marked_at timestamptz,
  updated_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organisation_setup_progress_updated_at before update on organisation_setup_progress
  for each row execute function set_updated_at();

select install_tenant_isolation('organisation_setup_progress');

grant select, insert, update on organisation_setup_progress to schoolapp_app;
revoke delete on organisation_setup_progress from schoolapp_app;

-- ---------------------------------------------------------------------------
-- Invitation revoke
-- ---------------------------------------------------------------------------

alter table invitations
  add column if not exists revoked_at timestamptz;

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
    and i.revoked_at is null
    and i.expires_at > now()
  limit 1;
$$;

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
    and revoked_at is null
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

create or replace function revoke_school_invitation(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_invitation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated int;
begin
  if not (
    actor_has_permission(p_actor_user_id, p_organisation_id, 'org.members.manage')
    or actor_has_permission(p_actor_user_id, p_organisation_id, 'guardianships.manage')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update invitations
     set revoked_at = now()
   where id = p_invitation_id
     and organisation_id = p_organisation_id
     and accepted_at is null
     and revoked_at is null;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id, p_actor_user_id, 'org.invitation.revoked', 'invitation', p_invitation_id,
    jsonb_build_object('invitationId', p_invitation_id)
  );
  return true;
end;
$$;

revoke all on function revoke_school_invitation(uuid, uuid, uuid) from public;
grant execute on function revoke_school_invitation(uuid, uuid, uuid) to schoolapp_app;

create or replace function reissue_school_invitation(
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
  v_permission text := 'org.members.manage';
begin
  if p_role_keys is not null and 'school.parent' = any (p_role_keys)
     and not ('school.admin' = any (p_role_keys)
           or 'school.headteacher' = any (p_role_keys)
           or 'school.teacher' = any (p_role_keys)
           or 'school.admissions' = any (p_role_keys)
           or 'school.staff' = any (p_role_keys)) then
    v_permission := 'guardianships.manage';
  end if;
  if not actor_has_permission(p_actor_user_id, p_organisation_id, v_permission) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role_keys is null or array_length(p_role_keys, 1) is null then
    raise exception 'invalid_role_key' using errcode = '22023';
  end if;
  if 'school.student' = any (p_role_keys) then
    raise exception 'student_invite_not_supported' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_role_keys) as k(key)
    where k.key not in (select r.key from roles r where r.organisation_id is null)
  ) then
    raise exception 'invalid_role_key' using errcode = '22023';
  end if;

  update invitations
     set revoked_at = now()
   where organisation_id = p_organisation_id
     and email = p_email
     and accepted_at is null
     and revoked_at is null;

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
    p_organisation_id, p_actor_user_id, 'org.invitation.reissued', 'invitation', v_id,
    jsonb_build_object('email', p_email::text, 'roles', to_jsonb(p_role_keys))
  );

  invitation_id := v_id;
  invitation_token := v_token;
  return next;
end;
$$;

revoke all on function reissue_school_invitation(uuid, uuid, citext, text[]) from public;
grant execute on function reissue_school_invitation(uuid, uuid, citext, text[]) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Membership suspend / reactivate and staff roles
-- ---------------------------------------------------------------------------

create or replace function set_organisation_membership_status(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_user_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not actor_has_permission(p_actor_user_id, p_organisation_id, 'org.members.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'invalid_membership_status' using errcode = '22023';
  end if;
  if p_actor_user_id = p_user_id then
    raise exception 'cannot_change_own_membership' using errcode = '42501';
  end if;

  update organisation_memberships
     set status = p_status,
         ended_at = case when p_status = 'suspended' then now() else null end,
         updated_at = now()
   where organisation_id = p_organisation_id
     and user_id = p_user_id;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_status = 'suspended' then
    update invitations
       set revoked_at = now()
     where organisation_id = p_organisation_id
       and (
         invited_user_id = p_user_id
         or email = (select email from users where id = p_user_id)
       )
       and accepted_at is null
       and revoked_at is null;

    if not exists (
      select 1
      from organisation_memberships m
      where m.user_id = p_user_id
        and m.status = 'active'
        and m.ended_at is null
    ) then
      update auth_sessions
         set revoked_at = now()
       where user_id = p_user_id
         and revoked_at is null;
    end if;
  end if;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id, p_actor_user_id, 'org.membership.status', 'membership', p_user_id,
    jsonb_build_object('userId', p_user_id, 'status', p_status)
  );
end;
$$;

revoke all on function set_organisation_membership_status(uuid, uuid, uuid, text) from public;
grant execute on function set_organisation_membership_status(uuid, uuid, uuid, text) to schoolapp_app;

create or replace function replace_staff_roles(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_staff_profile_id uuid,
  p_role_keys text[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
  v_membership_id uuid;
  v_staff_roles text[] := array[
    'school.admin', 'school.headteacher', 'school.teacher', 'school.admissions', 'school.staff'
  ];
  v_actor_is_admin boolean;
begin
  if not actor_has_permission(p_actor_user_id, p_organisation_id, 'org.roles.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role_keys is null or array_length(p_role_keys, 1) is null then
    raise exception 'invalid_role_key' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_role_keys) as k(key)
    where k.key <> all (v_staff_roles)
  ) then
    raise exception 'invalid_role_key' using errcode = '22023';
  end if;

  select actor_has_permission(p_actor_user_id, p_organisation_id, 'org.members.manage')
    and exists (
      select 1
      from organisation_memberships m
      join membership_roles mr on mr.membership_id = m.id
      join roles r on r.id = mr.role_id
      where m.user_id = p_actor_user_id
        and m.organisation_id = p_organisation_id
        and r.key = 'school.admin'
    )
    into v_actor_is_admin;

  if 'school.admin' = any (p_role_keys) and not coalesce(v_actor_is_admin, false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select sp.user_id into v_user_id
  from staff_profiles sp
  where sp.id = p_staff_profile_id and sp.organisation_id = p_organisation_id;
  if v_user_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select m.id into v_membership_id
  from organisation_memberships m
  where m.organisation_id = p_organisation_id and m.user_id = v_user_id;
  if v_membership_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if not ('school.admin' = any (p_role_keys)) then
    if (
      select count(*)
      from organisation_memberships m
      join membership_roles mr on mr.membership_id = m.id
      join roles r on r.id = mr.role_id and r.key = 'school.admin'
      where m.organisation_id = p_organisation_id
        and m.status = 'active'
        and m.user_id <> v_user_id
    ) = 0
    and exists (
      select 1
      from membership_roles mr
      join roles r on r.id = mr.role_id
      where mr.membership_id = v_membership_id and r.key = 'school.admin'
    ) then
      raise exception 'last_school_admin' using errcode = '42501';
    end if;
  end if;

  delete from membership_roles
  where membership_id = v_membership_id
    and role_id in (select id from roles where organisation_id is null and key = any (v_staff_roles));

  insert into membership_roles (membership_id, role_id)
  select v_membership_id, r.id
  from roles r
  where r.organisation_id is null and r.key = any (p_role_keys)
  on conflict do nothing;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id, p_actor_user_id, 'org.staff.roles', 'staff_profile', p_staff_profile_id,
    jsonb_build_object('roles', to_jsonb(p_role_keys))
  );
end;
$$;

revoke all on function replace_staff_roles(uuid, uuid, uuid, text[]) from public;
grant execute on function replace_staff_roles(uuid, uuid, uuid, text[]) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Account tokens (password reset / student activation). Hashed at rest.
-- ---------------------------------------------------------------------------

create table account_tokens (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations (id) on delete cascade,
  user_id uuid not null references users (id),
  purpose text not null check (purpose in ('password_reset', 'student_activation', 'student_reset')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);

create index account_tokens_user_purpose_idx
  on account_tokens (user_id, purpose, expires_at)
  where used_at is null and revoked_at is null;

alter table account_tokens enable row level security;
alter table account_tokens force row level security;

create policy account_tokens_tenant_isolation on account_tokens
for all
using (organisation_id is not null and app_tenant_matches(organisation_id))
with check (organisation_id is not null and app_tenant_matches(organisation_id));

grant select on account_tokens to schoolapp_app;
revoke insert, update, delete on account_tokens from schoolapp_app;

create or replace function request_password_reset(
  p_organisation_id uuid,
  p_email citext
)
returns table (
  created boolean,
  reset_token text,
  target_user_id uuid,
  target_full_name text,
  target_organisation_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
  v_full_name text;
  v_kind text;
  v_org uuid;
  v_token text;
begin
  if p_organisation_id is null then
    select u.id, u.full_name, u.user_kind, null::uuid
      into v_user_id, v_full_name, v_kind, v_org
    from users u
    join platform_admins pa on pa.user_id = u.id
    join user_credentials c on c.user_id = u.id
    where u.email = p_email and u.status = 'active'
    limit 1;
  else
    select u.id, u.full_name, u.user_kind, m.organisation_id
      into v_user_id, v_full_name, v_kind, v_org
    from users u
    join user_credentials c on c.user_id = u.id
    join organisation_memberships m
      on m.user_id = u.id
     and m.organisation_id = p_organisation_id
     and m.status = 'active'
     and m.ended_at is null
    where u.email = p_email
      and u.status = 'active'
      and u.user_kind in ('staff', 'parent', 'platform_admin')
    limit 1;
  end if;

  if v_user_id is null then
    created := false;
    reset_token := null;
    target_user_id := null;
    target_full_name := null;
    target_organisation_id := p_organisation_id;
    return next;
    return;
  end if;

  update account_tokens
     set revoked_at = now()
   where user_id = v_user_id
     and purpose = 'password_reset'
     and used_at is null
     and revoked_at is null;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into account_tokens (
    organisation_id, user_id, purpose, token_hash, expires_at
  ) values (
    v_org, v_user_id, 'password_reset', hash_invite_token(v_token), now() + interval '1 hour'
  );

  created := true;
  reset_token := v_token;
  target_user_id := v_user_id;
  target_full_name := v_full_name;
  target_organisation_id := v_org;
  return next;
end;
$$;

revoke all on function request_password_reset(uuid, citext) from public;
grant execute on function request_password_reset(uuid, citext) to schoolapp_app;

create or replace function consume_password_reset(
  p_token text,
  p_password_hash text
)
returns table (
  reset_user_id uuid,
  reset_organisation_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row account_tokens%rowtype;
begin
  if p_password_hash is null or char_length(p_password_hash) < 16 then
    raise exception 'invitation_password_required' using errcode = '22023';
  end if;

  select * into v_row
  from account_tokens
  where token_hash = hash_invite_token(p_token)
    and purpose = 'password_reset'
    and used_at is null
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'reset_token_invalid' using errcode = 'P0002';
  end if;

  update user_credentials
     set password_hash = p_password_hash, updated_at = now()
   where user_id = v_row.user_id;
  if not found then
    insert into user_credentials (user_id, password_hash) values (v_row.user_id, p_password_hash);
  end if;

  update account_tokens set used_at = now() where id = v_row.id;
  update account_tokens
     set revoked_at = now()
   where user_id = v_row.user_id
     and purpose = 'password_reset'
     and id <> v_row.id
     and used_at is null
     and revoked_at is null;

  update auth_sessions
     set revoked_at = now()
   where user_id = v_row.user_id
     and revoked_at is null;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    v_row.organisation_id, v_row.user_id, 'auth.password.reset', 'user', v_row.user_id,
    jsonb_build_object('purpose', 'password_reset')
  );

  return query select v_row.user_id, v_row.organisation_id;
end;
$$;

revoke all on function consume_password_reset(text, text) from public;
grant execute on function consume_password_reset(text, text) to schoolapp_app;

create or replace function issue_student_access_token(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_student_profile_id uuid,
  p_alias citext,
  p_purpose text
)
returns table (
  token text,
  login_alias citext
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
  v_token text;
begin
  if not actor_has_permission(p_actor_user_id, p_organisation_id, 'students.portal_access.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_purpose not in ('student_activation', 'student_reset') then
    raise exception 'invalid_token_purpose' using errcode = '22023';
  end if;

  select sp.user_id into v_user_id
  from student_profiles sp
  where sp.id = p_student_profile_id and sp.organisation_id = p_organisation_id;
  if v_user_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_alias is not null and char_length(trim(p_alias::text)) >= 3 then
    insert into user_login_aliases (organisation_id, user_id, alias)
    values (p_organisation_id, v_user_id, p_alias)
    on conflict (organisation_id, user_id) do update set alias = excluded.alias;
  end if;

  update account_tokens
     set revoked_at = now()
   where user_id = v_user_id
     and organisation_id = p_organisation_id
     and purpose in ('student_activation', 'student_reset')
     and used_at is null
     and revoked_at is null;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into account_tokens (
    organisation_id, user_id, purpose, token_hash, expires_at, created_by
  ) values (
    p_organisation_id, v_user_id, p_purpose, hash_invite_token(v_token),
    now() + interval '7 days', p_actor_user_id
  );

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id, p_actor_user_id, 'student.access.issued', 'student_profile', p_student_profile_id,
    jsonb_build_object('purpose', p_purpose)
  );

  token := v_token;
  login_alias := (
    select a.alias from user_login_aliases a
    where a.organisation_id = p_organisation_id and a.user_id = v_user_id
  );
  return next;
end;
$$;

revoke all on function issue_student_access_token(uuid, uuid, uuid, citext, text) from public;
grant execute on function issue_student_access_token(uuid, uuid, uuid, citext, text) to schoolapp_app;

create or replace function consume_student_access_token(
  p_token text,
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
  v_row account_tokens%rowtype;
begin
  if p_password_hash is null or char_length(p_password_hash) < 16 then
    raise exception 'invitation_password_required' using errcode = '22023';
  end if;

  select * into v_row
  from account_tokens
  where token_hash = hash_invite_token(p_token)
    and purpose in ('student_activation', 'student_reset')
    and used_at is null
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'reset_token_invalid' using errcode = 'P0002';
  end if;

  update user_credentials
     set password_hash = p_password_hash, updated_at = now()
   where user_id = v_row.user_id;
  if not found then
    insert into user_credentials (user_id, password_hash) values (v_row.user_id, p_password_hash);
  end if;

  update account_tokens set used_at = now() where id = v_row.id;
  update auth_sessions
     set revoked_at = now()
   where user_id = v_row.user_id
     and revoked_at is null;

  insert into organisation_memberships (organisation_id, user_id, status)
  values (v_row.organisation_id, v_row.user_id, 'active')
  on conflict (organisation_id, user_id) do update
    set status = 'active', ended_at = null, updated_at = now();

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    v_row.organisation_id, v_row.user_id, 'student.access.activated', 'user', v_row.user_id,
    jsonb_build_object('purpose', v_row.purpose)
  );

  return query select v_row.user_id, v_row.organisation_id;
end;
$$;

revoke all on function consume_student_access_token(text, text) from public;
grant execute on function consume_student_access_token(text, text) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Mail outbox (local/demo inspectable; production adapters enqueue here too)
-- ---------------------------------------------------------------------------

create table mail_outbox (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations (id) on delete cascade,
  purpose text not null check (purpose in (
    'staff_invite', 'parent_invite', 'password_reset', 'account_activation', 'student_activation'
  )),
  to_email citext not null,
  to_name text,
  subject text not null,
  body_text text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index mail_outbox_org_idx on mail_outbox (organisation_id, created_at desc);

alter table mail_outbox enable row level security;
alter table mail_outbox force row level security;

create policy mail_outbox_tenant_isolation on mail_outbox
for select
using (
  organisation_id is not null
  and app_tenant_matches(organisation_id)
  and (
    actor_has_permission(app_current_user_id(), organisation_id, 'org.settings.manage')
    or actor_has_permission(app_current_user_id(), organisation_id, 'onboarding.manage')
  )
);

grant select on mail_outbox to schoolapp_app;
revoke insert, update, delete on mail_outbox from schoolapp_app;

create or replace function enqueue_mail_message(
  p_organisation_id uuid,
  p_purpose text,
  p_to_email citext,
  p_to_name text,
  p_subject text,
  p_body_text text,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if p_body_text ~* 'password\s*[:=]' or p_subject ~* 'password\s*[:=]' then
    raise exception 'mail_password_forbidden' using errcode = '22023';
  end if;
  insert into mail_outbox (
    organisation_id, purpose, to_email, to_name, subject, body_text, metadata
  ) values (
    p_organisation_id, p_purpose, p_to_email, p_to_name, p_subject, p_body_text,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function enqueue_mail_message(uuid, text, citext, text, text, text, jsonb) from public;
grant execute on function enqueue_mail_message(uuid, text, citext, text, text, text, jsonb) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Public display-only branding (never returns storage keys)
-- ---------------------------------------------------------------------------

create or replace function get_public_school_branding(p_organisation_id uuid)
returns table (
  organisation_name text,
  tagline text,
  primary_colour text,
  accent_colour text,
  has_logo boolean,
  has_hero boolean
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select
    o.name,
    s.tagline,
    s.primary_colour,
    s.accent_colour,
    exists (
      select 1 from stored_objects so
      where so.id = s.logo_object_id
        and so.organisation_id = o.id
        and so.domain = 'branding'
        and so.status = 'active'
        and so.deleted_at is null
    ),
    exists (
      select 1 from stored_objects so
      where so.id = s.hero_object_id
        and so.organisation_id = o.id
        and so.domain = 'branding'
        and so.status = 'active'
        and so.deleted_at is null
    )
  from organisations o
  join organisation_settings s on s.organisation_id = o.id
  where o.id = p_organisation_id
    and o.status = 'active';
$$;

revoke all on function get_public_school_branding(uuid) from public;
grant execute on function get_public_school_branding(uuid) to schoolapp_app;

create or replace function get_public_branding_object(
  p_organisation_id uuid,
  p_kind text
)
returns table (
  storage_key text,
  content_type text,
  byte_size bigint
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select so.storage_key, so.content_type, so.byte_size
  from organisations o
  join organisation_settings s on s.organisation_id = o.id
  join stored_objects so
    on so.organisation_id = o.id
   and so.domain = 'branding'
   and so.status = 'active'
   and so.deleted_at is null
   and so.id = case
     when p_kind = 'logo' then s.logo_object_id
     when p_kind = 'hero' then s.hero_object_id
     else null
   end
  where o.id = p_organisation_id
    and o.status = 'active'
  limit 1;
$$;

revoke all on function get_public_branding_object(uuid, text) from public;
grant execute on function get_public_branding_object(uuid, text) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- CSV import jobs
-- ---------------------------------------------------------------------------

create table data_imports (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  kind text not null check (kind in ('staff', 'pupils', 'guardians')),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'parsed', 'validated', 'importing', 'completed', 'failed', 'cancelled')),
  original_filename text not null,
  row_count integer not null default 0,
  valid_count integer not null default 0,
  error_count integer not null default 0,
  duplicate_count integer not null default 0,
  imported_count integer not null default 0,
  skipped_count integer not null default 0,
  created_by uuid not null references users (id),
  confirmed_by uuid references users (id),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  error_summary text
);

create table data_import_rows (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  import_id uuid not null references data_imports (id) on delete cascade,
  row_number integer not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'valid', 'error', 'duplicate', 'imported', 'skipped')),
  issues jsonb not null default '[]'::jsonb,
  match_kind text,
  match_label text,
  created_at timestamptz not null default now(),
  unique (import_id, row_number)
);

create index data_imports_org_idx on data_imports (organisation_id, created_at desc);
create index data_import_rows_import_idx on data_import_rows (import_id, row_number);

select install_tenant_isolation('data_imports');
select install_tenant_isolation('data_import_rows');

grant select, insert, update on data_imports, data_import_rows to schoolapp_app;
revoke delete on data_imports from schoolapp_app;
grant delete on data_import_rows to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Link existing same-org guardian (never cross-tenant)
-- ---------------------------------------------------------------------------

create or replace function link_existing_org_guardian(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_student_profile_id uuid,
  p_guardian_user_id uuid,
  p_relationship text,
  p_has_parental_responsibility boolean,
  p_portal_access boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if not actor_has_permission(p_actor_user_id, p_organisation_id, 'guardianships.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from student_profiles
    where id = p_student_profile_id and organisation_id = p_organisation_id
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from organisation_memberships m
    join membership_roles mr on mr.membership_id = m.id
    join roles r on r.id = mr.role_id and r.key = 'school.parent'
    where m.organisation_id = p_organisation_id
      and m.user_id = p_guardian_user_id
      and m.ended_at is null
  ) then
    raise exception 'guardian_not_in_organisation' using errcode = 'P0002';
  end if;

  select id into v_id
  from guardianships
  where organisation_id = p_organisation_id
    and student_profile_id = p_student_profile_id
    and guardian_user_id = p_guardian_user_id
    and ended_on is null
  limit 1;

  if v_id is null then
    insert into guardianships (
      organisation_id, student_profile_id, guardian_user_id, relationship,
      has_parental_responsibility, portal_access
    ) values (
      p_organisation_id, p_student_profile_id, p_guardian_user_id,
      coalesce(nullif(trim(p_relationship), ''), 'other'),
      coalesce(p_has_parental_responsibility, false),
      coalesce(p_portal_access, false)
    ) returning id into v_id;
  end if;
  return v_id;
end;
$$;

revoke all on function link_existing_org_guardian(uuid, uuid, uuid, uuid, text, boolean, boolean) from public;
grant execute on function link_existing_org_guardian(uuid, uuid, uuid, uuid, text, boolean, boolean) to schoolapp_app;
