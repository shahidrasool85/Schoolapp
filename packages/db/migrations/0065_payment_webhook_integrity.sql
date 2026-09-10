-- Payment webhook integrity: processing / manual-review states, Stripe PI uniqueness.
-- Additive. Does not enable Stripe. Does not rewrite historical payments.

alter table school_payment_provider_events
  drop constraint if exists school_payment_provider_events_status_check;

alter table school_payment_provider_events
  add constraint school_payment_provider_events_status_check
  check (status in ('received', 'processing', 'processed', 'ignored', 'failed', 'manual_review'));

comment on column school_payment_provider_events.status is
  'received=legacy inbound; processing=claimed in-flight; processed=settled; ignored=safe no-op; failed=retryable; manual_review=terminal, do not auto-credit';

create unique index if not exists school_invoice_payments_stripe_pi_uidx
  on school_invoice_payments (organisation_id, external_reference)
  where method = 'card'
    and external_reference is not null
    and external_reference like 'pi_%';

create or replace function claim_payment_provider_event(
  p_provider_key text,
  p_event_id text,
  p_event_type text,
  p_organisation_id uuid,
  p_charge_id uuid,
  p_transaction_id uuid
)
returns table (
  event_row_id uuid,
  already_processed boolean,
  current_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_status text;
begin
  insert into school_payment_provider_events (
    organisation_id, provider_key, event_id, event_type, charge_id, transaction_id, status
  ) values (
    p_organisation_id, p_provider_key, p_event_id, p_event_type, p_charge_id, p_transaction_id, 'processing'
  )
  on conflict (organisation_id, provider_key, event_id) do nothing
  returning id, status into v_id, v_status;

  if v_id is not null then
    return query select v_id, false, v_status;
    return;
  end if;

  select e.id, e.status into v_id, v_status
    from school_payment_provider_events e
   where e.organisation_id = p_organisation_id
     and e.provider_key = p_provider_key
     and e.event_id = p_event_id
   for update;

  if v_status in ('processed', 'ignored', 'manual_review') then
    return query select v_id, true, v_status;
    return;
  end if;

  if v_status = 'processing' then
    update school_payment_provider_events
       set received_at = now(),
           failure_code = null
     where id = v_id
       and status = 'processing'
       and received_at < now() - interval '2 minutes'
     returning id, status into v_id, v_status;
    if found then
      return query select v_id, false, v_status;
      return;
    end if;
    select e.id, e.status into v_id, v_status
      from school_payment_provider_events e
     where e.organisation_id = p_organisation_id
       and e.provider_key = p_provider_key
       and e.event_id = p_event_id;
    return query select v_id, true, v_status;
    return;
  end if;

  update school_payment_provider_events
     set status = 'processing',
         received_at = now(),
         failure_code = null,
         charge_id = coalesce(p_charge_id, charge_id),
         transaction_id = coalesce(p_transaction_id, transaction_id)
   where id = v_id
     and status in ('failed', 'received')
   returning id, status into v_id, v_status;

  if v_id is not null then
    return query select v_id, false, v_status;
    return;
  end if;

  select e.id, e.status into v_id, v_status
    from school_payment_provider_events e
   where e.organisation_id = p_organisation_id
     and e.provider_key = p_provider_key
     and e.event_id = p_event_id;
  return query select v_id, (v_status in ('processed', 'ignored', 'manual_review', 'processing')), v_status;
end;
$$;

revoke all on function claim_payment_provider_event(text, text, text, uuid, uuid, uuid) from public;
grant execute on function claim_payment_provider_event(text, text, text, uuid, uuid, uuid) to schoolapp_app;

create or replace function finish_payment_provider_event(
  p_event_id uuid,
  p_status text,
  p_failure_code text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_status not in ('processed', 'ignored', 'failed', 'manual_review') then
    raise exception 'invalid_provider_event_status' using errcode = '22023';
  end if;
  update school_payment_provider_events
     set status = p_status,
         processed_at = case
           when p_status in ('processed', 'ignored', 'manual_review') then now()
           else processed_at
         end,
         failure_code = p_failure_code
   where id = p_event_id;
end;
$$;

revoke all on function finish_payment_provider_event(uuid, text, text) from public;
grant execute on function finish_payment_provider_event(uuid, text, text) to schoolapp_app;
