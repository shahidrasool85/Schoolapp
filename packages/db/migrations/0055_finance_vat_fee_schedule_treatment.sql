-- Future-proof fee schedules for a later per-item VAT override.
-- Default inherit means the school Finance Settings VAT policy applies.
-- No UI in this release. Does not change issued invoice totals.

alter table school_fee_schedules
  add column if not exists vat_treatment text not null default 'inherit'
    check (vat_treatment in ('none', 'standard', 'inherit'));
