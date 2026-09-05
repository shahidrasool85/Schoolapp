-- Optional per-school VAT settings and issued-invoice VAT snapshots.
-- Additive. Defaults to VAT off. Does not rewrite existing invoice totals.
-- 0053 already shipped on draft PR #56, so VAT is a follow-on migration.

alter table school_finance_settings
  add column if not exists vat_enabled boolean not null default false,
  add column if not exists vat_registration_number text
    check (vat_registration_number is null or char_length(vat_registration_number) <= 40),
  add column if not exists vat_rate_bps integer not null default 0
    check (vat_rate_bps between 0 and 10000),
  add column if not exists vat_prices_inclusive boolean not null default true;

alter table school_invoices
  add column if not exists vat_enabled boolean not null default false,
  add column if not exists vat_registration_number text
    check (vat_registration_number is null or char_length(vat_registration_number) <= 40),
  add column if not exists vat_rate_bps integer
    check (vat_rate_bps is null or vat_rate_bps between 0 and 10000),
  add column if not exists vat_prices_inclusive boolean,
  add column if not exists vat_net_minor bigint not null default 0,
  add column if not exists vat_amount_minor bigint not null default 0;

alter table school_invoice_lines
  add column if not exists vat_treatment text not null default 'none'
    check (vat_treatment in ('none', 'standard', 'inherit')),
  add column if not exists vat_rate_bps integer
    check (vat_rate_bps is null or vat_rate_bps between 0 and 10000),
  add column if not exists vat_net_minor bigint not null default 0,
  add column if not exists vat_amount_minor bigint not null default 0,
  add column if not exists vat_gross_minor bigint not null default 0;

create or replace function school_invoices_immutable_tg()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('issued', 'partially_paid', 'paid', 'overdue') and new.status <> 'void' then
    if old.total_minor is distinct from new.total_minor
       or old.subtotal_minor is distinct from new.subtotal_minor
       or old.discount_total_minor is distinct from new.discount_total_minor
       or old.period_key is distinct from new.period_key
       or old.billing_period_start is distinct from new.billing_period_start
       or old.billing_period_end is distinct from new.billing_period_end
       or old.billing_account_id is distinct from new.billing_account_id
       or old.currency is distinct from new.currency
       or old.calculation_snapshot is distinct from new.calculation_snapshot
       or old.vat_enabled is distinct from new.vat_enabled
       or old.vat_registration_number is distinct from new.vat_registration_number
       or old.vat_rate_bps is distinct from new.vat_rate_bps
       or old.vat_prices_inclusive is distinct from new.vat_prices_inclusive
       or old.vat_net_minor is distinct from new.vat_net_minor
       or old.vat_amount_minor is distinct from new.vat_amount_minor then
      raise exception 'invoice_immutable' using errcode = '23514';
    end if;
  end if;
  if old.status = 'void' and new.status is distinct from old.status then
    raise exception 'invoice_void_terminal' using errcode = '23514';
  end if;
  return new;
end;
$$;
