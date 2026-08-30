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
