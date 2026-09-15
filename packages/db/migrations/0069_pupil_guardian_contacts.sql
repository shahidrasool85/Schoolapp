-- Pupil guardian contacts for teaching staff: alternative telephone on the
-- person, restricted-contact-safe listing, and school-managed contact updates.
-- Additive. Does not add pupil-level phone fields, does not grant teachers
-- guardianships.manage or students.restricted_contact.read, and does not
-- weaken FORCE RLS or the locked restricted_contact column grant.

-- ---------------------------------------------------------------------------
-- Alternative telephone on the global user (same rules as users.phone)
-- ---------------------------------------------------------------------------

alter table users
  add column if not exists alternative_phone text;

alter table users drop constraint if exists users_alternative_phone_length;
alter table users add constraint users_alternative_phone_length
  check (alternative_phone is null or char_length(trim(alternative_phone)) between 1 and 40);

-- ---------------------------------------------------------------------------
-- School-authorised contact updates: keep the existing helper and add alt phone
-- ---------------------------------------------------------------------------

drop function if exists update_org_user_contact(
  uuid, uuid, uuid, text, boolean, text, boolean, text, boolean, text, boolean, text,
  boolean, text, boolean, text, boolean, text, boolean, text, boolean, text
);

create or replace function update_org_user_contact(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_target_user_id uuid,
  p_required_permission text,
  p_set_title boolean,
  p_title text,
  p_set_full_name boolean,
  p_full_name text,
  p_set_preferred_name boolean,
  p_preferred_name text,
  p_set_phone boolean,
  p_phone text,
  p_set_address_line1 boolean,
  p_address_line1 text,
  p_set_address_line2 boolean,
  p_address_line2 text,
  p_set_address_town boolean,
  p_address_town text,
  p_set_address_county boolean,
  p_address_county text,
  p_set_address_postcode boolean,
  p_address_postcode text,
  p_set_alternative_phone boolean default false,
  p_alternative_phone text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_actor_user_id is null or p_organisation_id is null or p_target_user_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if nullif(current_setting('app.organisation_id', true), '') is not null
     and app_current_organisation_id() is distinct from p_organisation_id
     and not app_is_platform_admin() then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;

  if app_current_user_id() is not null
     and app_current_user_id() is distinct from p_actor_user_id
     and not app_is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if app_current_user_id() is not null and not app_is_platform_admin() and not exists (
    select 1 from organisation_memberships m
    where m.organisation_id = p_organisation_id
      and m.user_id = p_actor_user_id
      and m.status = 'active'
      and m.ended_at is null
  ) then
    raise exception 'tenant_context_membership_required' using errcode = '42501';
  end if;

  if p_required_permission is null
     or not actor_has_permission(p_actor_user_id, p_organisation_id, p_required_permission) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1 from organisation_memberships m
    where m.organisation_id = p_organisation_id
      and m.user_id = p_target_user_id
      and m.ended_at is null
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_set_full_name and (p_full_name is null or char_length(trim(p_full_name)) < 1) then
    raise exception 'name_required' using errcode = '22023';
  end if;

  update users
  set title = case when p_set_title then nullif(trim(p_title), '') else title end,
      full_name = case
        when p_set_full_name then trim(p_full_name)
        else full_name
      end,
      preferred_name = case
        when p_set_preferred_name then nullif(trim(p_preferred_name), '')
        else preferred_name
      end,
      phone = case when p_set_phone then nullif(trim(p_phone), '') else phone end,
      alternative_phone = case
        when p_set_alternative_phone then nullif(trim(p_alternative_phone), '')
        else alternative_phone
      end,
      address_line1 = case
        when p_set_address_line1 then nullif(trim(p_address_line1), '')
        else address_line1
      end,
      address_line2 = case
        when p_set_address_line2 then nullif(trim(p_address_line2), '')
        else address_line2
      end,
      address_town = case
        when p_set_address_town then nullif(trim(p_address_town), '')
        else address_town
      end,
      address_county = case
        when p_set_address_county then nullif(trim(p_address_county), '')
        else address_county
      end,
      address_postcode = case
        when p_set_address_postcode then nullif(trim(p_address_postcode), '')
        else address_postcode
      end
  where id = p_target_user_id;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function update_org_user_contact(
  uuid, uuid, uuid, text, boolean, text, boolean, text, boolean, text, boolean, text,
  boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text
) from public;
grant execute on function update_org_user_contact(
  uuid, uuid, uuid, text, boolean, text, boolean, text, boolean, text, boolean, text,
  boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text
) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Restricted-contact-safe guardian listing. schoolapp_app never SELECTs
-- guardianships.restricted_contact. Hidden rows are omitted entirely.
-- ---------------------------------------------------------------------------

create or replace function actor_can_read_student_profile(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_student_profile_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
begin
  select sp.user_id into v_user_id
  from student_profiles sp
  where sp.id = p_student_profile_id
    and sp.organisation_id = p_organisation_id;
  if not found then
    return false;
  end if;

  if actor_has_permission(p_actor_user_id, p_organisation_id, 'students.profiles.read')
     or actor_has_permission(p_actor_user_id, p_organisation_id, 'students.profiles.manage') then
    return true;
  end if;

  if actor_has_permission(p_actor_user_id, p_organisation_id, 'students.profiles.read_self')
     and v_user_id is not distinct from p_actor_user_id then
    return true;
  end if;

  if actor_has_permission(p_actor_user_id, p_organisation_id, 'students.profiles.read_own_children')
     and exists (
       select 1 from guardianships g
       where g.guardian_user_id = p_actor_user_id
         and g.organisation_id = p_organisation_id
         and g.student_profile_id = p_student_profile_id
         and g.portal_access = true
         and (g.ended_on is null or g.ended_on >= current_date)
     ) then
    return true;
  end if;

  if actor_has_permission(p_actor_user_id, p_organisation_id, 'students.profiles.read_assigned')
     and exists (
       select 1
       from class_staff_assignments csa
       join staff_profiles spf on spf.id = csa.staff_profile_id
       join class_memberships cm on cm.class_id = csa.class_id
       join academic_years ay
         on ay.id = cm.academic_year_id
        and ay.organisation_id = p_organisation_id
       where spf.user_id = p_actor_user_id
         and spf.organisation_id = p_organisation_id
         and cm.organisation_id = p_organisation_id
         and cm.student_profile_id = p_student_profile_id
         and (csa.ended_on is null or csa.ended_on >= current_date)
         and (cm.ended_on is null or cm.ended_on >= current_date)
         and ay.is_current
       union
       select 1
       from timetable_covers tc
       join timetable_entries te on te.id = tc.timetable_entry_id
       join staff_profiles spf on spf.id = tc.covering_staff_profile_id
       join class_memberships cm on cm.class_id = te.class_id
       join academic_years ay
         on ay.id = cm.academic_year_id
        and ay.organisation_id = p_organisation_id
       where spf.user_id = p_actor_user_id
         and spf.organisation_id = p_organisation_id
         and tc.organisation_id = p_organisation_id
         and cm.organisation_id = p_organisation_id
         and cm.student_profile_id = p_student_profile_id
         and tc.cover_date = current_date
         and (cm.ended_on is null or cm.ended_on >= current_date)
         and cm.started_on <= current_date
         and ay.is_current
     ) then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function actor_can_read_student_profile(uuid, uuid, uuid) from public;
grant execute on function actor_can_read_student_profile(uuid, uuid, uuid) to schoolapp_app;

create or replace function list_student_guardians_for_actor(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_student_profile_id uuid
)
returns table (
  id uuid,
  student_profile_id uuid,
  guardian_user_id uuid,
  full_name text,
  email citext,
  phone text,
  alternative_phone text,
  profile_photo_stored_object_id uuid,
  relationship text,
  has_parental_responsibility boolean,
  is_emergency_contact boolean,
  lives_with_student boolean,
  portal_access boolean,
  priority smallint,
  started_on text,
  ended_on text,
  membership_status text,
  has_credentials boolean,
  pending_invitation boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_include_restricted boolean;
begin
  if p_actor_user_id is null or p_organisation_id is null or p_student_profile_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if nullif(current_setting('app.organisation_id', true), '') is not null
     and app_current_organisation_id() is distinct from p_organisation_id
     and not app_is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if app_current_user_id() is not null
     and app_current_user_id() is distinct from p_actor_user_id
     and not app_is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if app_current_user_id() is not null and not app_is_platform_admin() and not exists (
    select 1 from organisation_memberships m
    where m.organisation_id = p_organisation_id
      and m.user_id = p_actor_user_id
      and m.status = 'active'
      and m.ended_at is null
  ) then
    raise exception 'tenant_context_membership_required' using errcode = '42501';
  end if;

  if not actor_can_read_student_profile(p_actor_user_id, p_organisation_id, p_student_profile_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Parents and pupils can read the pupil record; they must not inherit other
  -- families' telephone numbers from this listing. Staff with pupil-profile
  -- read (assigned or school-wide) or guardianship management may continue.
  if not (
    actor_has_permission(p_actor_user_id, p_organisation_id, 'guardianships.manage')
    or actor_has_permission(p_actor_user_id, p_organisation_id, 'students.profiles.read')
    or actor_has_permission(p_actor_user_id, p_organisation_id, 'students.profiles.manage')
    or actor_has_permission(p_actor_user_id, p_organisation_id, 'students.profiles.read_assigned')
  ) then
    return;
  end if;

  v_include_restricted := actor_has_permission(
    p_actor_user_id,
    p_organisation_id,
    'students.restricted_contact.read'
  );

  return query
  select
    g.id,
    g.student_profile_id,
    g.guardian_user_id,
    u.full_name,
    u.email,
    u.phone,
    u.alternative_phone,
    m.profile_photo_stored_object_id,
    g.relationship,
    g.has_parental_responsibility,
    g.is_emergency_contact,
    g.lives_with_student,
    g.portal_access,
    g.priority,
    g.started_on::text,
    g.ended_on::text,
    m.status,
    user_has_local_credentials(u.id),
    exists(
      select 1 from invitations i
      where i.organisation_id = g.organisation_id
        and i.email = u.email
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    )
  from guardianships g
  join users u on u.id = g.guardian_user_id
  left join organisation_memberships m
    on m.user_id = u.id
   and m.organisation_id = g.organisation_id
   and m.ended_at is null
  where g.student_profile_id = p_student_profile_id
    and g.organisation_id = p_organisation_id
    and (v_include_restricted or g.restricted_contact = false)
  order by g.ended_on nulls first, g.priority, u.full_name;
end;
$$;

revoke all on function list_student_guardians_for_actor(uuid, uuid, uuid) from public;
grant execute on function list_student_guardians_for_actor(uuid, uuid, uuid) to schoolapp_app;

create or replace function list_organisation_guardians_for_actor(
  p_actor_user_id uuid,
  p_organisation_id uuid
)
returns table (
  id uuid,
  student_profile_id uuid,
  student_legal_name text,
  guardian_user_id uuid,
  full_name text,
  email citext,
  phone text,
  alternative_phone text,
  profile_photo_stored_object_id uuid,
  relationship text,
  has_parental_responsibility boolean,
  is_emergency_contact boolean,
  lives_with_student boolean,
  portal_access boolean,
  priority smallint,
  started_on text,
  ended_on text,
  membership_status text,
  has_credentials boolean,
  pending_invitation boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_include_restricted boolean;
begin
  if p_actor_user_id is null or p_organisation_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if nullif(current_setting('app.organisation_id', true), '') is not null
     and app_current_organisation_id() is distinct from p_organisation_id
     and not app_is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if app_current_user_id() is not null
     and app_current_user_id() is distinct from p_actor_user_id
     and not app_is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not (
    actor_has_permission(p_actor_user_id, p_organisation_id, 'guardianships.manage')
    or actor_has_permission(p_actor_user_id, p_organisation_id, 'org.members.read')
    or actor_has_permission(p_actor_user_id, p_organisation_id, 'students.profiles.read')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_include_restricted := actor_has_permission(
    p_actor_user_id,
    p_organisation_id,
    'students.restricted_contact.read'
  );

  return query
  select
    g.id,
    g.student_profile_id,
    sp.legal_name,
    g.guardian_user_id,
    u.full_name,
    u.email,
    u.phone,
    u.alternative_phone,
    m.profile_photo_stored_object_id,
    g.relationship,
    g.has_parental_responsibility,
    g.is_emergency_contact,
    g.lives_with_student,
    g.portal_access,
    g.priority,
    g.started_on::text,
    g.ended_on::text,
    m.status,
    user_has_local_credentials(u.id),
    exists(
      select 1 from invitations i
      where i.organisation_id = g.organisation_id
        and i.email = u.email
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    )
  from guardianships g
  join users u on u.id = g.guardian_user_id
  join student_profiles sp on sp.id = g.student_profile_id
  left join organisation_memberships m
    on m.user_id = u.id
   and m.organisation_id = g.organisation_id
   and m.ended_at is null
  where g.organisation_id = p_organisation_id
    and (v_include_restricted or g.restricted_contact = false)
  order by u.full_name, sp.legal_name;
end;
$$;

revoke all on function list_organisation_guardians_for_actor(uuid, uuid) from public;
grant execute on function list_organisation_guardians_for_actor(uuid, uuid) to schoolapp_app;
