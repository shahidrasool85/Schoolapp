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

-- Explicit origin so seeded UK year groups are never identified by display name.
-- Existing rows (including live Kingswood seed data) are backfilled once while
-- origin is still null. Later custom inserts keep the default 'custom'.

alter table year_groups add column if not exists origin text;

update year_groups
set origin = 'system'
where origin is null;

alter table year_groups
  alter column origin set default 'custom';

update year_groups
set origin = 'custom'
where origin is null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'year_groups'
      and column_name = 'origin'
      and is_nullable = 'YES'
  ) then
    alter table year_groups alter column origin set not null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'year_groups_origin_check'
  ) then
    alter table year_groups
      add constraint year_groups_origin_check
      check (origin in ('system', 'custom'));
  end if;
end $$;

create or replace function seed_standard_year_groups(
  p_actor_user_id uuid,
  p_organisation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_max text;
  v_rank int;
  v_code text;
  v_inserted int := 0;
  v_rows int := 0;
begin
  if not actor_has_permission(p_actor_user_id, p_organisation_id, 'academic.structure.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select max_year_group_code into v_max
  from organisation_settings
  where organisation_id = p_organisation_id;
  v_max := coalesce(v_max, '8');
  v_rank := year_group_code_rank(v_max);

  insert into year_groups (organisation_id, code, name, key_stage, sort_order, origin)
  select p_organisation_id, 'N', 'Nursery', 0, -1, 'system'
  where year_group_code_rank('N') <= v_rank
  on conflict (organisation_id, code) do nothing;
  get diagnostics v_rows = row_count;
  v_inserted := v_inserted + v_rows;

  insert into year_groups (organisation_id, code, name, key_stage, sort_order, origin)
  select p_organisation_id, 'R', 'Reception', 0, 0, 'system'
  where year_group_code_rank('R') <= v_rank
  on conflict (organisation_id, code) do nothing;
  get diagnostics v_rows = row_count;
  v_inserted := v_inserted + v_rows;

  for v_code in
    select gs::text from generate_series(1, greatest(v_rank, 0)) gs
  loop
    insert into year_groups (organisation_id, code, name, key_stage, sort_order, origin)
    values (
      p_organisation_id,
      v_code,
      'Year ' || v_code,
      year_group_key_stage(v_code),
      year_group_code_rank(v_code),
      'system'
    )
    on conflict (organisation_id, code) do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;
  end loop;

  return v_inserted;
end;
$$;

-- Public school finder: typed search of active schools only. SECURITY DEFINER
-- so the unauthenticated app role does not scan organisations under RLS.
-- LIKE metacharacters are escaped. Result count is hard-capped.

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
  with q as (
    select
      btrim(p_query) as raw,
      replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') as escaped
  )
  select
    o.slug,
    o.name,
    branding.has_logo,
    branding.logo_version
  from organisations o
  join q on true
  join lateral get_public_school_branding(o.id) branding on true
  where o.status = 'active'
    and length(q.raw) >= 2
    and length(replace(replace(replace(q.raw, '%', ''), '_', ''), '\', '')) >= 2
    and (
      o.name ilike '%' || q.escaped || '%' escape '\'
      or o.slug ilike q.escaped || '%' escape '\'
    )
  order by
    case
      when lower(o.name) = lower(q.raw) then 0
      when lower(o.slug) = lower(q.raw) then 1
      when o.name ilike q.escaped || '%' escape '\' then 2
      else 3
    end,
    o.name
  limit greatest(1, least(coalesce(p_limit, 10), 10));
$$;

revoke all on function search_public_active_schools(text, int) from public;
grant execute on function search_public_active_schools(text, int) to schoolapp_app;
