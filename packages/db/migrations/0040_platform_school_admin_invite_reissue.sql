-- Platform Admin: list School Admin invitation/account state and reissue an
-- outstanding first School Admin invitation. Reuses Phase 20 invitation
-- token, hash, revoke, expiry, and audit patterns. Does not expose token
-- hashes or reconstruct old tokens. Additive. Does not weaken FORCE RLS,
-- tenant isolation, or school-scoped invitation RPCs.

-- ---------------------------------------------------------------------------
-- Outstanding / accepted School Admin state for Platform Admin school list
-- ---------------------------------------------------------------------------

create or replace function list_platform_school_admin_state(p_actor_user_id uuid)
returns table (
  organisation_id uuid,
  invitation_id uuid,
  invitation_status text,
  invited_email citext,
  invited_full_name text,
  expires_at timestamptz,
  membership_status text,
  can_reissue boolean
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
  with outstanding as (
    select distinct on (i.organisation_id)
      i.organisation_id,
      i.id,
      i.email,
      i.expires_at
    from invitations i
    where 'school.admin' = any (i.intended_role_keys)
      and i.accepted_at is null
      and i.revoked_at is null
    order by i.organisation_id, i.created_at asc
  ),
  accepted as (
    select distinct on (i.organisation_id)
      i.organisation_id,
      i.id,
      i.email,
      i.expires_at
    from invitations i
    where 'school.admin' = any (i.intended_role_keys)
      and i.accepted_at is not null
    order by i.organisation_id, i.accepted_at desc
  ),
  admin_member as (
    select distinct on (m.organisation_id)
      m.organisation_id,
      u.email,
      u.full_name,
      m.status
    from organisation_memberships m
    join membership_roles mr on mr.membership_id = m.id
    join roles r on r.id = mr.role_id and r.organisation_id is null and r.key = 'school.admin'
    join users u on u.id = m.user_id
    where m.ended_at is null
    order by m.organisation_id,
      case when m.status = 'active' then 0 else 1 end,
      m.created_at asc
  )
  select
    o.id,
    case
      when out.id is not null then out.id
      when acc.id is not null then acc.id
      else null
    end,
    case
      when out.id is not null then 'outstanding'
      when acc.id is not null or mem.organisation_id is not null then 'accepted'
      else 'none'
    end,
    coalesce(out.email, mem.email, acc.email),
    coalesce(
      case when out.id is null then mem.full_name else null end,
      (select u.full_name from users u where u.email = coalesce(out.email, mem.email, acc.email) limit 1),
      (select mo.to_name from mail_outbox mo
        where mo.organisation_id = o.id
          and mo.to_email = coalesce(out.email, mem.email, acc.email)
        order by mo.created_at desc
        limit 1)
    ),
    case when out.id is not null then out.expires_at else null end,
    mem.status,
    (out.id is not null)
  from organisations o
  left join outstanding out on out.organisation_id = o.id
  left join accepted acc on acc.organisation_id = o.id
  left join admin_member mem on mem.organisation_id = o.id
  order by o.created_at desc;
end;
$$;

revoke all on function list_platform_school_admin_state(uuid) from public;
grant execute on function list_platform_school_admin_state(uuid) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Reissue the outstanding School Admin invitation (platform Super Admin only)
-- ---------------------------------------------------------------------------

create or replace function reissue_school_admin_invitation_as_platform(
  p_actor_user_id uuid,
  p_organisation_id uuid
)
returns table (
  invitation_id uuid,
  invitation_token text,
  organisation_id uuid,
  organisation_slug citext,
  organisation_name text,
  email citext,
  invited_full_name text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org organisations%rowtype;
  v_invite invitations%rowtype;
  v_token text;
  v_id uuid;
  v_email citext;
  v_roles text[];
  v_name text;
  v_expires timestamptz;
begin
  if not exists (select 1 from platform_admins where user_id = p_actor_user_id) then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  select * into v_org from organisations where id = p_organisation_id;
  if not found then
    raise exception 'organisation_not_found' using errcode = 'P0002';
  end if;

  select * into v_invite
  from invitations i
  where i.organisation_id = p_organisation_id
    and 'school.admin' = any (i.intended_role_keys)
    and i.accepted_at is null
    and i.revoked_at is null
  order by i.created_at asc
  limit 1;

  if not found then
    if exists (
      select 1
      from invitations i
      where i.organisation_id = p_organisation_id
        and 'school.admin' = any (i.intended_role_keys)
        and i.accepted_at is not null
    ) or exists (
      select 1
      from organisation_memberships m
      join membership_roles mr on mr.membership_id = m.id
      join roles r on r.id = mr.role_id
      where m.organisation_id = p_organisation_id
        and m.ended_at is null
        and r.organisation_id is null
        and r.key = 'school.admin'
    ) then
      raise exception 'invitation_already_accepted' using errcode = 'P0001';
    end if;
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_email := v_invite.email;
  v_roles := v_invite.intended_role_keys;
  if v_roles is null or not ('school.admin' = any (v_roles)) then
    v_roles := array['school.admin']::text[];
  end if;

  select coalesce(
    (select u.full_name from users u where u.email = v_email limit 1),
    (select mo.to_name from mail_outbox mo
      where mo.organisation_id = p_organisation_id and mo.to_email = v_email
      order by mo.created_at desc
      limit 1),
    v_email::text
  ) into v_name;

  -- Same revoke + hashed token issuance as reissue_school_invitation.
  -- Qualify invitations columns: RETURNS TABLE exposes organisation_id as a variable.
  update invitations i
     set revoked_at = now()
   where i.organisation_id = p_organisation_id
     and i.email = v_email
     and i.accepted_at is null
     and i.revoked_at is null;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires := now() + interval '14 days';
  insert into invitations (
    organisation_id, email, intended_role_keys, token_hash, expires_at, created_by
  ) values (
    p_organisation_id, v_email, v_roles, hash_invite_token(v_token),
    v_expires, p_actor_user_id
  ) returning id into v_id;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id, p_actor_user_id, 'org.invitation.reissued', 'invitation', v_id,
    jsonb_build_object(
      'email', v_email::text,
      'roles', to_jsonb(v_roles),
      'source', 'platform_admin'
    )
  );

  invitation_id := v_id;
  invitation_token := v_token;
  organisation_id := p_organisation_id;
  organisation_slug := v_org.slug;
  organisation_name := v_org.name;
  email := v_email;
  invited_full_name := v_name;
  expires_at := v_expires;
  return next;
end;
$$;

revoke all on function reissue_school_admin_invitation_as_platform(uuid, uuid) from public;
grant execute on function reissue_school_admin_invitation_as_platform(uuid, uuid) to schoolapp_app;
