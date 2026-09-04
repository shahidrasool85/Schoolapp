-- Per-organisation payment-provider configuration (Stripe first).
-- Additive. Does not enable Stripe. Does not rewrite historical payments.
-- Encrypted credential blobs live on school_payment_provider_configs; plaintext
-- Stripe secrets are never stored.

comment on table school_payment_provider_configs is
  'Per-organisation payment provider configuration. Encrypted credential blobs; never store plaintext Stripe secrets.';

alter table school_payment_provider_configs
  alter column secret_ref set default 'encrypted:v1';

alter table school_payment_provider_configs
  add column if not exists mode text not null default 'test',
  add column if not exists webhook_endpoint_id text not null default encode(gen_random_bytes(24), 'hex'),
  add column if not exists encrypted_secret_key text,
  add column if not exists encrypted_webhook_secret text,
  add column if not exists secret_key_hint text,
  add column if not exists webhook_secret_configured boolean not null default false,
  add column if not exists provider_account_id text,
  add column if not exists display_name text,
  add column if not exists connection_status text not null default 'not_configured',
  add column if not exists last_connection_tested_at timestamptz,
  add column if not exists last_connection_error_code text,
  add column if not exists last_webhook_at timestamptz,
  add column if not exists last_webhook_event_type text,
  add column if not exists last_webhook_error_code text,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'school_payment_provider_configs_mode_check'
  ) then
    alter table school_payment_provider_configs
      add constraint school_payment_provider_configs_mode_check
      check (mode in ('test', 'live'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'school_payment_provider_configs_connection_status_check'
  ) then
    alter table school_payment_provider_configs
      add constraint school_payment_provider_configs_connection_status_check
      check (connection_status in (
        'not_configured',
        'test_mode_configured',
        'connected',
        'attention_required'
      ));
  end if;
end
$$;

create unique index if not exists school_payment_provider_configs_webhook_endpoint_uidx
  on school_payment_provider_configs (webhook_endpoint_id);

-- Webhook event idempotency is per organisation so two Stripe accounts cannot
-- collide on the same event id.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'school_payment_provider_events_provider_key_event_id_key'
  ) then
    alter table school_payment_provider_events
      drop constraint school_payment_provider_events_provider_key_event_id_key;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'school_payment_provider_events_org_provider_event_key'
  ) then
    alter table school_payment_provider_events
      add constraint school_payment_provider_events_org_provider_event_key
      unique (organisation_id, provider_key, event_id);
  end if;
end
$$;

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
    p_organisation_id, p_provider_key, p_event_id, p_event_type, p_charge_id, p_transaction_id, 'received'
  )
  on conflict (organisation_id, provider_key, event_id) do nothing
  returning id, status into v_id, v_status;

  if v_id is null then
    select e.id, e.status into v_id, v_status
      from school_payment_provider_events e
     where e.organisation_id = p_organisation_id
       and e.provider_key = p_provider_key
       and e.event_id = p_event_id;
    return query select v_id, (v_status in ('processed', 'ignored')), v_status;
    return;
  end if;

  return query select v_id, false, v_status;
end;
$$;

revoke all on function claim_payment_provider_event(text, text, text, uuid, uuid, uuid) from public;
grant execute on function claim_payment_provider_event(text, text, text, uuid, uuid, uuid) to schoolapp_app;

-- Webhook tenant selection: opaque endpoint id only. Does not return decrypted
-- secrets. The app decrypts the stored blob with the server master key.
create or replace function load_payment_provider_webhook_endpoint(p_endpoint_id text)
returns table (
  config_id uuid,
  organisation_id uuid,
  provider_key text,
  mode text,
  is_active boolean,
  encrypted_webhook_secret text,
  webhook_secret_configured boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  select c.id,
         c.organisation_id,
         c.provider_key,
         c.mode,
         c.is_active,
         c.encrypted_webhook_secret,
         c.webhook_secret_configured
    from school_payment_provider_configs c
   where c.webhook_endpoint_id = p_endpoint_id
     and c.provider_key = 'stripe';
end;
$$;

revoke all on function load_payment_provider_webhook_endpoint(text) from public;
grant execute on function load_payment_provider_webhook_endpoint(text) to schoolapp_app;

create or replace function record_payment_provider_webhook_result(
  p_config_id uuid,
  p_event_type text,
  p_ok boolean,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update school_payment_provider_configs
     set last_webhook_at = case when p_ok then now() else last_webhook_at end,
         last_webhook_event_type = case when p_ok then left(p_event_type, 120) else last_webhook_event_type end,
         last_webhook_error_code = case when p_ok then null else left(coalesce(p_error_code, 'webhook_failed'), 80) end,
         connection_status = case
           when p_ok and connection_status = 'attention_required' then
             case when mode = 'live' then 'connected' else 'test_mode_configured' end
           when not p_ok then 'attention_required'
           else connection_status
         end,
         updated_at = now()
   where id = p_config_id;
end;
$$;

revoke all on function record_payment_provider_webhook_result(uuid, text, boolean, text) from public;
grant execute on function record_payment_provider_webhook_result(uuid, text, boolean, text) to schoolapp_app;
