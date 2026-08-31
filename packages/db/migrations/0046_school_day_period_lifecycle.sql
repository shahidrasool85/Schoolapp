-- Additive school-day period lifecycle. Unused periods may be deleted.
-- Periods referenced by timetable history cannot be cascade-deleted; they may
-- be deactivated. Does not rewrite 0001–0045.

alter table school_day_periods
  add column if not exists is_active boolean not null default true;

create index if not exists school_day_periods_org_active_idx
  on school_day_periods (organisation_id, is_active, sort_order, starts_at);
