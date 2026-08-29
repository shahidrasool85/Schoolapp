-- School branding: public cache-busting versions for logo/cover assets.
-- Additive. Does not rewrite 0041/0042 or earlier migrations.
-- Does not reset organisation data. Existing schools without uploaded
-- branding continue to work (has_logo/has_hero remain false).
--
-- No new tenant tables. Branding remains on organisation_settings
-- (logo_object_id, hero_object_id) with FORCE RLS from Phase 20.
-- Public callers still cannot see storage keys or internal settings.

drop function if exists get_public_school_branding(uuid);

create function get_public_school_branding(p_organisation_id uuid)
returns table (
  organisation_name text,
  tagline text,
  primary_colour text,
  accent_colour text,
  has_logo boolean,
  has_hero boolean,
  logo_version text,
  hero_version text
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
    ),
    (
      select left(regexp_replace(coalesce(so.checksum_sha256, replace(so.id::text, '-', '')), '[^a-fA-F0-9]', '', 'g'), 16)
      from stored_objects so
      where so.id = s.logo_object_id
        and so.organisation_id = o.id
        and so.domain = 'branding'
        and so.status = 'active'
        and so.deleted_at is null
    ),
    (
      select left(regexp_replace(coalesce(so.checksum_sha256, replace(so.id::text, '-', '')), '[^a-fA-F0-9]', '', 'g'), 16)
      from stored_objects so
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
