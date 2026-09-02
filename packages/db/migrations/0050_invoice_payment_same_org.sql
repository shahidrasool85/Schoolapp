-- Invoice-targeted payment sessions/transactions/receipts were rejected by the
-- Phase 15 same-org trigger, which required school_charges.charge_id.
-- Idempotent for databases that already applied 0049 before that trigger update.

create or replace function school_finance_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'school_charges' then
    if not exists (
      select 1 from student_profiles s
      where s.id = new.student_profile_id and s.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    if not exists (
      select 1 from school_charge_categories c
      where c.id = new.category_id and c.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    if new.activity_id is not null and not exists (
      select 1 from school_activities a
      where a.id = new.activity_id and a.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    if new.academic_year_id is not null and not exists (
      select 1 from academic_years y
      where y.id = new.academic_year_id and y.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name in ('school_charge_adjustments', 'school_payment_refunds') then
    if not exists (
      select 1 from school_charges c
      where c.id = new.charge_id and c.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name in (
    'school_payment_transactions',
    'school_payment_sessions',
    'school_payment_receipts'
  ) then
    if new.charge_id is not null then
      if not exists (
        select 1 from school_charges c
        where c.id = new.charge_id and c.organisation_id = new.organisation_id
      ) then
        raise exception 'organisation_mismatch' using errcode = '23514';
      end if;
    elsif new.invoice_id is not null then
      if not exists (
        select 1 from school_invoices i
        where i.id = new.invoice_id and i.organisation_id = new.organisation_id
      ) then
        raise exception 'organisation_mismatch' using errcode = '23514';
      end if;
    else
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
