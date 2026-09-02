-- Canonical user/staff/parent contact fields and membership-scoped profile photos.
-- Additive. Existing users, staff profiles, invitations, and role assignments
-- are unchanged. New columns are nullable. Does not weaken FORCE RLS,
-- last-School-Admin protection, invitation token hashing, or public branding
-- endpoints. Profile photos reuse stored_objects; bytes stay in object storage.

-- ---------------------------------------------------------------------------
-- Personal contact on the global user (one person across roles)
-- ---------------------------------------------------------------------------

alter table users
  add column if not exists title text,
  add column if not exists phone text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists address_town text,
  add column if not exists address_county text,
  add column if not exists address_postcode text;

alter table users drop constraint if exists users_title_length;
alter table users add constraint users_title_length
  check (title is null or char_length(trim(title)) between 1 and 20);

alter table users drop constraint if exists users_phone_length;
alter table users add constraint users_phone_length
  check (phone is null or char_length(trim(phone)) between 1 and 40);

alter table users drop constraint if exists users_address_line1_length;
alter table users add constraint users_address_line1_length
  check (address_line1 is null or char_length(address_line1) <= 120);

alter table users drop constraint if exists users_address_line2_length;
alter table users add constraint users_address_line2_length
  check (address_line2 is null or char_length(address_line2) <= 120);

alter table users drop constraint if exists users_address_town_length;
alter table users add constraint users_address_town_length
  check (address_town is null or char_length(address_town) <= 80);

alter table users drop constraint if exists users_address_county_length;
alter table users add constraint users_address_county_length
  check (address_county is null or char_length(address_county) <= 80);

alter table users drop constraint if exists users_address_postcode_length;
alter table users add constraint users_address_postcode_length
  check (address_postcode is null or char_length(address_postcode) <= 16);

-- ---------------------------------------------------------------------------
-- One current profile photo per person-in-school (not per role)
-- ---------------------------------------------------------------------------

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
    'branding',
    'profile_photo'
  ));

alter table organisation_memberships
  add column if not exists profile_photo_stored_object_id uuid;

alter table organisation_memberships
  drop constraint if exists organisation_memberships_profile_photo_fkey;
alter table organisation_memberships
  add constraint organisation_memberships_profile_photo_fkey
  foreign key (profile_photo_stored_object_id) references stored_objects (id);

create index if not exists organisation_memberships_profile_photo_idx
  on organisation_memberships (profile_photo_stored_object_id)
  where profile_photo_stored_object_id is not null;

-- ---------------------------------------------------------------------------
-- School-authorised contact updates for another person in this organisation.
-- Does not widen users_update_self. Never changes email, user_kind, status,
-- date_of_birth, or credentials.
-- ---------------------------------------------------------------------------

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
  p_address_postcode text
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
  boolean, text, boolean, text, boolean, text, boolean, text, boolean, text
) from public;
grant execute on function update_org_user_contact(
  uuid, uuid, uuid, text, boolean, text, boolean, text, boolean, text, boolean, text,
  boolean, text, boolean, text, boolean, text, boolean, text, boolean, text
) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Point the membership at a current profile photo (or clear it).
-- Self-service needs no extra permission. School-authorised updates pass
-- the capability the API already checked (org.members.manage,
-- students.profiles.manage, or guardianships.manage).
-- ---------------------------------------------------------------------------

create or replace function set_membership_profile_photo(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_target_user_id uuid,
  p_stored_object_id uuid,
  p_required_permission text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_membership_id uuid;
  v_previous uuid;
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

  if p_actor_user_id is distinct from p_target_user_id then
    if p_required_permission is null
       or not actor_has_permission(p_actor_user_id, p_organisation_id, p_required_permission) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  else
    if not exists (
      select 1 from organisation_memberships m
      where m.organisation_id = p_organisation_id
        and m.user_id = p_actor_user_id
        and m.status in ('active', 'invited')
        and m.ended_at is null
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  select m.id, m.profile_photo_stored_object_id
    into v_membership_id, v_previous
  from organisation_memberships m
  where m.organisation_id = p_organisation_id
    and m.user_id = p_target_user_id
    and m.ended_at is null
  order by case m.status when 'active' then 0 when 'invited' then 1 else 2 end
  limit 1;

  if v_membership_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_stored_object_id is not null and not exists (
    select 1 from stored_objects so
    where so.id = p_stored_object_id
      and so.organisation_id = p_organisation_id
      and so.domain = 'profile_photo'
      and so.status = 'active'
      and so.deleted_at is null
      and so.owner_record_id = p_target_user_id
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update organisation_memberships
  set profile_photo_stored_object_id = p_stored_object_id
  where id = v_membership_id
    and organisation_id = p_organisation_id;

  return v_previous;
end;
$$;

revoke all on function set_membership_profile_photo(uuid, uuid, uuid, uuid, text) from public;
grant execute on function set_membership_profile_photo(uuid, uuid, uuid, uuid, text) to schoolapp_app;
