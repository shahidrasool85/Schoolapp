-- Deduplicate Stripe invoice refund credits by provider refund id.
-- Additive. Does not enable Stripe. Does not rewrite historical credits.

alter table school_invoice_credits
  add column if not exists provider_refund_id text;

create unique index if not exists school_invoice_credits_provider_refund_uidx
  on school_invoice_credits (organisation_id, provider_refund_id)
  where provider_refund_id is not null;

comment on column school_invoice_credits.provider_refund_id is
  'Stripe refund id (re_…) when this credit was applied from a provider webhook. Local bank/cash refund credits leave this null.';
