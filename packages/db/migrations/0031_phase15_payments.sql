-- Phase 15: school charges, payment transactions, refunds, receipts,
-- provider sessions/events, and activity payment attachment.
-- Additive. Does not weaken FORCE RLS, tenant context, hostname tenancy,
-- membership revalidation, teacher assigned-only access, guardianship /
-- portal_access, student self-only access, student portal policy,
-- safeguarding capabilities, break-glass, audit, object-storage controls,
-- or Phase 14 activity/consent architecture.
-- Treats migrations 0001–0030 as immutable.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('finance.charges.read', 'Read school charges and outstanding balances'),
  ('finance.charges.manage', 'Create, issue, cancel, and bulk-create charges'),
  ('finance.transactions.read', 'Read payment transactions and receipts'),
  ('finance.payments.record_offline', 'Record staff-received offline payments'),
  ('finance.refunds.manage', 'Request and record refunds'),
  ('finance.adjustments.manage', 'Waive, reduce, or discount a charge'),
  ('finance.reports.read', 'Read finance overview and export safe CSVs'),
  ('finance.read_own_children', 'Parent: read and pay authorised children charges')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'finance.charges.read'),
    ('school.admin', 'finance.charges.manage'),
    ('school.admin', 'finance.transactions.read'),
    ('school.admin', 'finance.payments.record_offline'),
    ('school.admin', 'finance.refunds.manage'),
    ('school.admin', 'finance.adjustments.manage'),
    ('school.admin', 'finance.reports.read'),
    ('school.headteacher', 'finance.charges.read'),
    ('school.headteacher', 'finance.transactions.read'),
    ('school.headteacher', 'finance.reports.read'),
    ('school.parent', 'finance.read_own_children')
) as x(role_key, perm)
  on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select org_role.id, rp.permission_key
from roles sys
join role_permissions rp on rp.role_id = sys.id
join roles org_role on org_role.key = sys.key and org_role.organisation_id is not null
where sys.organisation_id is null
  and rp.permission_key like 'finance.%'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Notification types / categories
-- ---------------------------------------------------------------------------

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'homework_assigned',
    'homework_due',
    'result_published',
    'teacher_feedback',
    'school_announcement',
    'attendance_concern',
    'competition_challenge',
    'report_available',
    'admissions_update',
    'learning_assigned',
    'learning_due',
    'learning_feedback',
    'learning_resubmission',
    'announcement_published',
    'announcement_important',
    'announcement_acknowledgement',
    'calendar_upcoming',
    'pastoral_assigned',
    'safeguarding_assigned',
    'pastoral_follow_up',
    'behaviour_follow_up',
    'activity_published',
    'activity_updated',
    'activity_cancelled',
    'activity_consent_required',
    'activity_deadline',
    'activity_place_confirmed',
    'activity_waitlisted',
    'activity_promoted',
    'activity_assignment',
    'payment_request',
    'payment_due_soon',
    'payment_received',
    'payment_refunded',
    'payment_activity_required',
    'payment_refund_failed',
    'general'
  ));

alter table notifications drop constraint if exists notifications_category_check;
alter table notifications add constraint notifications_category_check
  check (category in (
    'homework',
    'results',
    'feedback',
    'announcement',
    'attendance',
    'competition',
    'reports',
    'admissions',
    'calendar',
    'behaviour',
    'pastoral',
    'safeguarding',
    'activities',
    'finance',
    'general'
  ));

-- ---------------------------------------------------------------------------
-- Organisation currency
-- ---------------------------------------------------------------------------

alter table organisation_settings
  add column if not exists default_currency text not null default 'GBP'
    check (default_currency ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------
-- Activity payment attachment (consent status remains separate)
-- ---------------------------------------------------------------------------

alter table school_activities
  add column if not exists price_amount_minor bigint
    check (price_amount_minor is null or price_amount_minor >= 0),
  add column if not exists price_currency text
    check (price_currency is null or price_currency ~ '^[A-Z]{3}$'),
  add column if not exists payment_required boolean not null default false,
  add column if not exists payment_deadline_at timestamptz,
  add column if not exists payment_instructions text
    check (payment_instructions is null or char_length(payment_instructions) <= 4000),
  add column if not exists charge_policy text not null default 'on_confirmed'
    check (charge_policy in ('none', 'on_confirmed', 'on_consent'));

alter table school_activities drop constraint if exists school_activities_payment_price_check;
alter table school_activities add constraint school_activities_payment_price_check
  check (
    payment_required = false
    or (
      price_amount_minor is not null
      and price_amount_minor > 0
      and price_currency is not null
    )
  );

-- ---------------------------------------------------------------------------
-- Finance counters / human references
-- ---------------------------------------------------------------------------

create table school_finance_counters (
  organisation_id uuid not null references organisations (id),
  kind text not null check (kind in ('charge', 'payment', 'receipt', 'refund', 'adjustment')),
  year integer not null,
  last_value integer not null default 0,
  primary key (organisation_id, kind, year)
);

select install_tenant_isolation('school_finance_counters');
grant select, insert, update on school_finance_counters to schoolapp_app;

create or replace function next_finance_reference(
  p_organisation_id uuid,
  p_kind text
)
returns text
language plpgsql
as $$
declare
  v_year int := extract(year from current_date)::int;
  v_n int;
  v_prefix text;
begin
  if p_kind not in ('charge', 'payment', 'receipt', 'refund', 'adjustment') then
    raise exception 'invalid_finance_kind' using errcode = '22023';
  end if;
  if p_organisation_id is distinct from app_current_organisation_id() then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  v_prefix := case p_kind
    when 'charge' then 'CHG'
    when 'payment' then 'PAY'
    when 'receipt' then 'RCPT'
    when 'refund' then 'RFD'
    else 'ADJ'
  end;
  insert into school_finance_counters (organisation_id, kind, year, last_value)
  values (p_organisation_id, p_kind, v_year, 1)
  on conflict (organisation_id, kind, year)
  do update set last_value = school_finance_counters.last_value + 1
  returning last_value into v_n;
  return v_prefix || '-' || v_year::text || '-' || lpad(v_n::text, 6, '0');
end;
$$;

revoke all on function next_finance_reference(uuid, text) from public;
grant execute on function next_finance_reference(uuid, text) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Charge category catalogue
-- ---------------------------------------------------------------------------

create table school_charge_categories (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order int not null default 0,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create index school_charge_categories_org_idx
  on school_charge_categories (organisation_id, is_active, sort_order);

-- ---------------------------------------------------------------------------
-- Canonical charges (pupil-owned payment requests)
-- ---------------------------------------------------------------------------

create table school_charges (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  reference text not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 20000),
  category_id uuid not null references school_charge_categories (id),
  student_profile_id uuid not null references student_profiles (id),
  activity_id uuid references school_activities (id),
  academic_year_id uuid references academic_years (id),
  source_kind text not null default 'manual'
    check (source_kind in ('manual', 'activity', 'bulk', 'admissions')),
  source_id uuid,
  original_amount_minor bigint not null check (original_amount_minor >= 0),
  amount_due_minor bigint not null check (amount_due_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  due_at timestamptz,
  status text not null default 'draft'
    check (status in (
      'draft', 'issued', 'partially_paid', 'paid', 'waived', 'cancelled', 'refunded'
    )),
  payment_required boolean not null default true,
  internal_note text check (internal_note is null or char_length(internal_note) <= 4000),
  parent_note text check (parent_note is null or char_length(parent_note) <= 4000),
  idempotency_key text,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_by uuid references users (id),
  issued_at timestamptz,
  cancelled_by uuid references users (id),
  cancelled_at timestamptz,
  unique (organisation_id, reference)
);

create index school_charges_org_status_idx
  on school_charges (organisation_id, status, due_at);
create index school_charges_org_student_idx
  on school_charges (organisation_id, student_profile_id, status);
create index school_charges_org_activity_idx
  on school_charges (organisation_id, activity_id)
  where activity_id is not null;

create unique index school_charges_idempotency_uidx
  on school_charges (organisation_id, idempotency_key)
  where idempotency_key is not null;

create unique index school_charges_activity_pupil_active_uidx
  on school_charges (organisation_id, activity_id, student_profile_id)
  where activity_id is not null and status <> 'cancelled';

create trigger school_charges_updated_at before update on school_charges
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Adjustments (waiver / reduction / subsidy / discount)
-- ---------------------------------------------------------------------------

create table school_charge_adjustments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  charge_id uuid not null references school_charges (id),
  reference text not null,
  kind text not null check (kind in ('waiver', 'reduction', 'subsidy', 'discount')),
  amount_minor bigint not null check (amount_minor > 0),
  reason text not null check (char_length(trim(reason)) between 1 and 1000),
  actor_user_id uuid not null references users (id),
  created_at timestamptz not null default now(),
  unique (organisation_id, reference)
);

create index school_charge_adjustments_charge_idx
  on school_charge_adjustments (charge_id, created_at);

-- ---------------------------------------------------------------------------
-- Payment transactions (history is append-friendly; statuses update in place)
-- ---------------------------------------------------------------------------

create table school_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  charge_id uuid not null references school_charges (id),
  reference text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  payer_user_id uuid references users (id),
  channel text not null check (channel in ('provider', 'offline')),
  provider_key text not null check (provider_key in ('fake', 'stripe', 'offline')),
  provider_session_id text,
  provider_payment_id text,
  status text not null default 'pending'
    check (status in (
      'pending', 'succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded'
    )),
  initiated_at timestamptz not null default now(),
  paid_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  refunded_amount_minor bigint not null default 0
    check (refunded_amount_minor >= 0 and refunded_amount_minor <= amount_minor),
  failure_code text,
  idempotency_key text,
  offline_method text
    check (offline_method is null or offline_method in (
      'cash', 'bank_transfer', 'cheque', 'card_terminal', 'other'
    )),
  offline_reference text,
  offline_note text check (offline_note is null or char_length(offline_note) <= 2000),
  received_by uuid references users (id),
  received_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organisation_id, reference),
  check (
    (channel = 'offline' and provider_key = 'offline' and offline_method is not null)
    or (channel = 'provider' and provider_key in ('fake', 'stripe') and offline_method is null)
  )
);

create index school_payment_transactions_charge_idx
  on school_payment_transactions (charge_id, initiated_at);
create index school_payment_transactions_org_status_idx
  on school_payment_transactions (organisation_id, status, initiated_at);

create unique index school_payment_transactions_idempotency_uidx
  on school_payment_transactions (organisation_id, idempotency_key)
  where idempotency_key is not null;

create unique index school_payment_transactions_provider_payment_uidx
  on school_payment_transactions (provider_key, provider_payment_id)
  where provider_payment_id is not null;

create unique index school_payment_transactions_offline_ref_uidx
  on school_payment_transactions (organisation_id, provider_key, offline_reference)
  where provider_key = 'offline' and offline_reference is not null;

-- ---------------------------------------------------------------------------
-- Checkout sessions (provider-neutral)
-- ---------------------------------------------------------------------------

create table school_payment_sessions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  charge_id uuid not null references school_charges (id),
  transaction_id uuid not null references school_payment_transactions (id),
  provider_key text not null check (provider_key in ('fake', 'stripe')),
  provider_session_id text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'open'
    check (status in ('open', 'completed', 'expired', 'cancelled', 'failed')),
  checkout_url text,
  success_path text,
  cancel_path text,
  expires_at timestamptz,
  idempotency_key text,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (provider_key, provider_session_id)
);

create unique index school_payment_sessions_idempotency_uidx
  on school_payment_sessions (organisation_id, idempotency_key)
  where idempotency_key is not null;

create index school_payment_sessions_charge_idx
  on school_payment_sessions (charge_id, created_at);

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------

create table school_payment_refunds (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  charge_id uuid not null references school_charges (id),
  transaction_id uuid not null references school_payment_transactions (id),
  reference text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (char_length(trim(reason)) between 1 and 1000),
  requested_by uuid not null references users (id),
  provider_key text not null,
  provider_refund_id text,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed')),
  idempotency_key text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  unique (organisation_id, reference)
);

create unique index school_payment_refunds_idempotency_uidx
  on school_payment_refunds (organisation_id, idempotency_key)
  where idempotency_key is not null;

create unique index school_payment_refunds_provider_uidx
  on school_payment_refunds (provider_key, provider_refund_id)
  where provider_refund_id is not null;

create index school_payment_refunds_tx_idx
  on school_payment_refunds (transaction_id, created_at);

-- ---------------------------------------------------------------------------
-- Receipts (immutable snapshot)
-- ---------------------------------------------------------------------------

create table school_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  charge_id uuid not null references school_charges (id),
  transaction_id uuid not null references school_payment_transactions (id),
  reference text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, reference),
  unique (transaction_id)
);

create index school_payment_receipts_charge_idx
  on school_payment_receipts (charge_id, created_at);

-- ---------------------------------------------------------------------------
-- Provider webhook event processing (tenant resolved from stored refs)
-- ---------------------------------------------------------------------------

create table school_payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  provider_key text not null check (provider_key in ('fake', 'stripe')),
  event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received'
    check (status in ('received', 'processed', 'ignored', 'failed')),
  charge_id uuid references school_charges (id),
  transaction_id uuid references school_payment_transactions (id),
  failure_code text,
  unique (provider_key, event_id)
);

create index school_payment_provider_events_org_idx
  on school_payment_provider_events (organisation_id, received_at desc);

-- Future per-organisation provider-account hook. Stores a secret *reference*
-- (vault/env key name), never a live provider secret.
create table school_payment_provider_configs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  provider_key text not null check (provider_key in ('fake', 'stripe')),
  secret_ref text not null check (char_length(trim(secret_ref)) between 1 and 200),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organisation_id, provider_key)
);

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

select install_tenant_isolation('school_charge_categories');
select install_tenant_isolation('school_charges');
select install_tenant_isolation('school_charge_adjustments');
select install_tenant_isolation('school_payment_transactions');
select install_tenant_isolation('school_payment_sessions');
select install_tenant_isolation('school_payment_refunds');
select install_tenant_isolation('school_payment_receipts');
select install_tenant_isolation('school_payment_provider_events');
select install_tenant_isolation('school_payment_provider_configs');

grant select, insert, update, delete on school_charge_categories to schoolapp_app;
grant select, insert, update, delete on school_charges to schoolapp_app;
grant select, insert, update, delete on school_charge_adjustments to schoolapp_app;
grant select, insert, update, delete on school_payment_transactions to schoolapp_app;
grant select, insert, update, delete on school_payment_sessions to schoolapp_app;
grant select, insert, update, delete on school_payment_refunds to schoolapp_app;
grant select, insert, update, delete on school_payment_receipts to schoolapp_app;
grant select, insert, update, delete on school_payment_provider_events to schoolapp_app;
grant select, insert, update, delete on school_payment_provider_configs to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Cross-organisation integrity
-- ---------------------------------------------------------------------------

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
  elsif tg_table_name in (
    'school_charge_adjustments',
    'school_payment_transactions',
    'school_payment_sessions',
    'school_payment_refunds',
    'school_payment_receipts'
  ) then
    if not exists (
      select 1 from school_charges c
      where c.id = new.charge_id and c.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists school_charges_org_tg on school_charges;
create trigger school_charges_org_tg
  before insert or update on school_charges
  for each row execute function school_finance_same_org_tg();

drop trigger if exists school_charge_adjustments_org_tg on school_charge_adjustments;
create trigger school_charge_adjustments_org_tg
  before insert or update on school_charge_adjustments
  for each row execute function school_finance_same_org_tg();

drop trigger if exists school_payment_transactions_org_tg on school_payment_transactions;
create trigger school_payment_transactions_org_tg
  before insert or update on school_payment_transactions
  for each row execute function school_finance_same_org_tg();

drop trigger if exists school_payment_sessions_org_tg on school_payment_sessions;
create trigger school_payment_sessions_org_tg
  before insert or update on school_payment_sessions
  for each row execute function school_finance_same_org_tg();

drop trigger if exists school_payment_refunds_org_tg on school_payment_refunds;
create trigger school_payment_refunds_org_tg
  before insert or update on school_payment_refunds
  for each row execute function school_finance_same_org_tg();

drop trigger if exists school_payment_receipts_org_tg on school_payment_receipts;
create trigger school_payment_receipts_org_tg
  before insert or update on school_payment_receipts
  for each row execute function school_finance_same_org_tg();

-- Server-stamp finance actors. Clients cannot spoof created_by / received_by.
create or replace function school_finance_actor_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'school_charges' and tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.created_by := app_current_user_id();
    elsif new.created_by is null then
      raise exception 'finance_actor_required' using errcode = '23514';
    end if;
  elsif tg_table_name = 'school_charge_adjustments' and tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.actor_user_id := app_current_user_id();
    elsif new.actor_user_id is null then
      raise exception 'finance_actor_required' using errcode = '23514';
    end if;
  elsif tg_table_name = 'school_payment_transactions' then
    if new.channel = 'offline' then
      if app_current_user_id() is not null then
        new.received_by := app_current_user_id();
      elsif new.received_by is null then
        raise exception 'finance_actor_required' using errcode = '23514';
      end if;
      if new.received_at is null then
        new.received_at := now();
      end if;
    end if;
  elsif tg_table_name = 'school_payment_refunds' and tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.requested_by := app_current_user_id();
    elsif new.requested_by is null then
      raise exception 'finance_actor_required' using errcode = '23514';
    end if;
  elsif tg_table_name = 'school_payment_sessions' and tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.created_by := app_current_user_id();
    elsif new.created_by is null then
      raise exception 'finance_actor_required' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists school_charges_actor_tg on school_charges;
create trigger school_charges_actor_tg
  before insert on school_charges
  for each row execute function school_finance_actor_tg();

drop trigger if exists school_charge_adjustments_actor_tg on school_charge_adjustments;
create trigger school_charge_adjustments_actor_tg
  before insert on school_charge_adjustments
  for each row execute function school_finance_actor_tg();

drop trigger if exists school_payment_transactions_actor_tg on school_payment_transactions;
create trigger school_payment_transactions_actor_tg
  before insert or update on school_payment_transactions
  for each row execute function school_finance_actor_tg();

drop trigger if exists school_payment_refunds_actor_tg on school_payment_refunds;
create trigger school_payment_refunds_actor_tg
  before insert on school_payment_refunds
  for each row execute function school_finance_actor_tg();

drop trigger if exists school_payment_sessions_actor_tg on school_payment_sessions;
create trigger school_payment_sessions_actor_tg
  before insert on school_payment_sessions
  for each row execute function school_finance_actor_tg();

-- ---------------------------------------------------------------------------
-- Webhook tenant resolution (never from request headers)
-- ---------------------------------------------------------------------------

create or replace function resolve_payment_provider_session(
  p_provider_key text,
  p_provider_session_id text
)
returns table (
  organisation_id uuid,
  session_id uuid,
  charge_id uuid,
  transaction_id uuid,
  context_user_id uuid,
  amount_minor bigint,
  currency text,
  session_status text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  select s.organisation_id,
         s.id,
         s.charge_id,
         s.transaction_id,
         coalesce(s.created_by, t.payer_user_id, c.created_by),
         s.amount_minor,
         s.currency,
         s.status
    from school_payment_sessions s
    join school_payment_transactions t on t.id = s.transaction_id
    join school_charges c on c.id = s.charge_id
   where s.provider_key = p_provider_key
     and s.provider_session_id = p_provider_session_id;
end;
$$;

revoke all on function resolve_payment_provider_session(text, text) from public;
grant execute on function resolve_payment_provider_session(text, text) to schoolapp_app;

create or replace function resolve_payment_provider_payment(
  p_provider_key text,
  p_provider_payment_id text
)
returns table (
  organisation_id uuid,
  transaction_id uuid,
  charge_id uuid,
  context_user_id uuid,
  amount_minor bigint,
  currency text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  select t.organisation_id,
         t.id,
         t.charge_id,
         coalesce(t.payer_user_id, c.created_by),
         t.amount_minor,
         t.currency
    from school_payment_transactions t
    join school_charges c on c.id = t.charge_id
   where t.provider_key = p_provider_key
     and t.provider_payment_id = p_provider_payment_id;
end;
$$;

revoke all on function resolve_payment_provider_payment(text, text) from public;
grant execute on function resolve_payment_provider_payment(text, text) to schoolapp_app;

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
  on conflict (provider_key, event_id) do nothing
  returning id, status into v_id, v_status;

  if v_id is null then
    select e.id, e.status into v_id, v_status
      from school_payment_provider_events e
     where e.provider_key = p_provider_key and e.event_id = p_event_id;
    return query select v_id, (v_status in ('processed', 'ignored')), v_status;
    return;
  end if;

  return query select v_id, false, v_status;
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
  if p_status not in ('processed', 'ignored', 'failed') then
    raise exception 'invalid_provider_event_status' using errcode = '22023';
  end if;
  update school_payment_provider_events
     set status = p_status,
         processed_at = case when p_status = 'processed' then now() else processed_at end,
         failure_code = p_failure_code
   where id = p_event_id;
end;
$$;

revoke all on function finish_payment_provider_event(uuid, text, text) from public;
grant execute on function finish_payment_provider_event(uuid, text, text) to schoolapp_app;

create or replace function load_payment_demo_session(p_session_id uuid)
returns table (
  organisation_id uuid,
  provider_session_id text,
  amount_minor bigint,
  currency text,
  charge_id uuid,
  title text,
  status text,
  pupil_name text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  select s.organisation_id,
         s.provider_session_id,
         s.amount_minor,
         s.currency,
         s.charge_id,
         c.title,
         s.status,
         sp.legal_name
    from school_payment_sessions s
    join school_charges c on c.id = s.charge_id
    join student_profiles sp on sp.id = c.student_profile_id
   where s.id = p_session_id;
end;
$$;

revoke all on function load_payment_demo_session(uuid) from public;
grant execute on function load_payment_demo_session(uuid) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Org defaults
-- ---------------------------------------------------------------------------

create or replace function ensure_organisation_phase15_defaults(p_organisation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if nullif(current_setting('app.organisation_id', true), '') is not null
     and app_current_organisation_id() is distinct from p_organisation_id
     and not app_is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update organisation_settings
     set default_currency = coalesce(nullif(default_currency, ''), 'GBP')
   where organisation_id = p_organisation_id
     and default_currency is null;

  insert into school_charge_categories (organisation_id, key, name, sort_order, is_system)
  values
    (p_organisation_id, 'trip', 'Trip', 1, true),
    (p_organisation_id, 'club', 'Club', 2, true),
    (p_organisation_id, 'contribution', 'Contribution', 3, true),
    (p_organisation_id, 'music', 'Music', 4, true),
    (p_organisation_id, 'examination', 'Examination', 5, true),
    (p_organisation_id, 'uniform', 'Uniform', 6, true),
    (p_organisation_id, 'lost_item', 'Lost or damaged item', 7, true),
    (p_organisation_id, 'meal', 'Meal', 8, true),
    (p_organisation_id, 'other', 'Other', 9, true)
  on conflict (organisation_id, key) do nothing;
end;
$$;

revoke all on function ensure_organisation_phase15_defaults(uuid) from public;
grant execute on function ensure_organisation_phase15_defaults(uuid) to schoolapp_app;

create or replace function organisations_phase15_defaults_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform ensure_organisation_phase15_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists organisations_phase15_defaults_tg on organisations;
create trigger organisations_phase15_defaults_tg
  after insert on organisations
  for each row execute function organisations_phase15_defaults_tg();

select ensure_organisation_phase15_defaults(id) from organisations;
