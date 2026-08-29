-- Tighten issued-invoice immutability so billing period dates cannot be rewritten
-- after issue. 0041 already locked totals, discount snapshots, and period_key.

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
       or old.calculation_snapshot is distinct from new.calculation_snapshot then
      raise exception 'invoice_immutable' using errcode = '23514';
    end if;
  end if;
  if old.status = 'void' and new.status is distinct from old.status then
    raise exception 'invoice_void_terminal' using errcode = '23514';
  end if;
  return new;
end;
$$;
