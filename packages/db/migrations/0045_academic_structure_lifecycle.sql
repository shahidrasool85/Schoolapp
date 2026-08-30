-- Additive academic-structure lifecycle: active / archived status.
-- Does not rewrite 0001–0044. Existing Kingswood rows remain active.
-- No cascading deletes. Hard delete stays application-controlled.

alter table subjects
  add column if not exists status text not null default 'active'
    check (status in ('active', 'archived'));

alter table classes
  add column if not exists status text not null default 'active'
    check (status in ('active', 'archived'));

alter table year_groups
  add column if not exists status text not null default 'active'
    check (status in ('active', 'archived'));

alter table academic_years
  add column if not exists status text not null default 'active'
    check (status in ('active', 'archived'));

create index if not exists subjects_org_status_idx
  on subjects (organisation_id, status, name);

create index if not exists classes_org_status_idx
  on classes (organisation_id, status, name);

create index if not exists year_groups_org_status_idx
  on year_groups (organisation_id, status, sort_order);

create index if not exists academic_years_org_status_idx
  on academic_years (organisation_id, status, starts_on desc);

-- Hard delete is application-controlled and unused-only. Grant DELETE so the
-- API can remove accidental unused rows after usage checks. No ON DELETE CASCADE
-- is added to historical tables.

grant delete on subjects, classes, year_groups, academic_years to schoolapp_app;

-- Public school finder: typed search of active schools only. SECURITY DEFINER
-- so the unauthenticated app role does not scan organisations under RLS.
-- Returns only directory-safe fields (no emails, billing, or internal settings).

create or replace function search_public_active_schools(p_query text, p_limit int)
returns table (
  slug text,
  name text,
  has_logo boolean,
  logo_version text
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select
    o.slug,
    o.name,
    branding.has_logo,
    branding.logo_version
  from organisations o
  join lateral get_public_school_branding(o.id) branding on true
  where o.status = 'active'
    and length(btrim(p_query)) >= 2
    and (
      o.name ilike '%' || btrim(p_query) || '%'
      or o.slug ilike btrim(p_query) || '%'
    )
  order by
    case
      when lower(o.name) = lower(btrim(p_query)) then 0
      when lower(o.slug) = lower(btrim(p_query)) then 1
      when o.name ilike btrim(p_query) || '%' then 2
      else 3
    end,
    o.name
  limit greatest(1, least(coalesce(p_limit, 8), 8));
$$;

revoke all on function search_public_active_schools(text, int) from public;
grant execute on function search_public_active_schools(text, int) to schoolapp_app;
