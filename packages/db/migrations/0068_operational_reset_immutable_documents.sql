-- Platform Admin operational_reset_v1 wipes organisation-scoped UAT data as
-- schoolapp_owner. Issued invoice lines and finalised census snapshots are
-- immutable for schoolapp_app (and stay that way). Owner-only DELETE matches
-- the existing messages / published-report wipe exception so the reset can
-- remove operational finance and census rows without dropping constraints.

create or replace function school_invoice_lines_immutable_tg()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' and current_user = 'schoolapp_owner' then
    return old;
  end if;
  select status into v_status
    from school_invoices
   where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status in ('issued', 'partially_paid', 'paid', 'overdue', 'void') then
    raise exception 'invoice_lines_immutable' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function phase18_snapshot_immutable_tg()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_run uuid;
begin
  if tg_op = 'DELETE' and current_user = 'schoolapp_owner' then
    return old;
  end if;
  v_run := coalesce(new.census_run_id, old.census_run_id);
  select status into v_status from census_runs where id = v_run;
  if tg_op = 'INSERT' then
    if v_status in ('ready', 'exported', 'superseded', 'archived') then
      raise exception 'census_snapshot_immutable' using errcode = '23514';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    if v_status in ('ready', 'exported', 'superseded', 'archived') then
      raise exception 'census_snapshot_immutable' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
