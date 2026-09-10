-- School-level automatic parent invoice / payment-due email.
-- Default FALSE so existing schools (including Kingswood UAT) are not emailed
-- for historical invoices when this migration is applied. New invoice issuance
-- only enqueues mail after a school turns the setting on. No backfill.

alter table school_finance_settings
  add column if not exists automatic_invoice_email_enabled boolean not null default false;

comment on column school_finance_settings.automatic_invoice_email_enabled is
  'When true, newly issued invoices enqueue one parent payment notification. Historical invoices are never backfilled.';
