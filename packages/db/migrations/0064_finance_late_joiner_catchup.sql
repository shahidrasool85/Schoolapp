-- Late-joiner / missing tuition invoice catch-up.
-- Issued billing runs stay immutable. Catch-up invoices are separate rows with
-- source = missing_catchup. This unique index is void-aware so a replacement
-- can be issued after a genuine void, and blocks duplicate catch-up invoices
-- for the same pupil and billing period.

create unique index if not exists school_invoices_catchup_pupil_period_uidx
  on school_invoices (
    organisation_id,
    billing_period_start,
    billing_period_end,
    ((calculation_snapshot->>'catchupStudentProfileId'))
  )
  where status <> 'void'
    and calculation_snapshot->>'source' = 'missing_catchup'
    and nullif(calculation_snapshot->>'catchupStudentProfileId', '') is not null;
