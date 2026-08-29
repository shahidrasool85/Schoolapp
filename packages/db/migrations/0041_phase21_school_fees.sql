-- Phase 21: independent-school tuition, fee schedules, family billing,
-- invoices, discounts, billing runs, and arrears.
-- Additive. Does not weaken FORCE RLS, tenant context, hostname tenancy,
-- membership revalidation, teacher assigned-only access, guardianship /
-- portal_access, student self-only access, student portal policy,
-- safeguarding capabilities, break-glass, audit, object-storage controls,
-- Phase 15 charge/payment architecture, or Phase 16 messaging.
-- Treats migrations 0001–0040 as immutable.
-- Existing Other Payments (trips, clubs, examinations, activities) stay intact.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('finance.settings.manage', 'Manage organisation tuition and invoice settings'),
  ('finance.fee_schedules.manage', 'Create and edit tuition fee schedules'),
  ('finance.discounts.manage', 'Manage discount rules, concessions, and staff-child links'),
  ('finance.billing_runs.manage', 'Preview and confirm tuition billing runs'),
  ('finance.invoices.read', 'Read school invoices, family accounts, and pupil fee profiles'),
  ('finance.invoices.manage', 'Issue, void, and adjust school invoices'),
  ('finance.accounts.read', 'Read family billing accounts and statements')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'finance.settings.manage'),
    ('school.admin', 'finance.fee_schedules.manage'),
    ('school.admin', 'finance.discounts.manage'),
    ('school.admin', 'finance.billing_runs.manage'),
    ('school.admin', 'finance.invoices.read'),
    ('school.admin', 'finance.invoices.manage'),
    ('school.admin', 'finance.accounts.read'),
    ('school.headteacher', 'finance.invoices.read'),
    ('school.headteacher', 'finance.accounts.read'),
    ('school.headteacher', 'finance.reports.read')
) as x(role_key, perm)
  on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select org_role.id, rp.permission_key
from roles sys
join role_permissions rp on rp.role_id = sys.id
join roles org_role on org_role.key = sys.key and org_role.organisation_id is not null
where sys.organisation_id is null
  and rp.permission_key in (
    'finance.settings.manage',
    'finance.fee_schedules.manage',
    'finance.discounts.manage',
    'finance.billing_runs.manage',
    'finance.invoices.read',
    'finance.invoices.manage',
    'finance.accounts.read'
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Finance counters: invoice / credit / billing run references
-- ---------------------------------------------------------------------------

alter table school_finance_counters
  drop constraint if exists school_finance_counters_kind_check;
alter table school_finance_counters
  add constraint school_finance_counters_kind_check
  check (kind in (
    'charge', 'payment', 'receipt', 'refund', 'adjustment',
    'invoice', 'credit', 'billing_run'
  ));

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
  if p_kind not in (
    'charge', 'payment', 'receipt', 'refund', 'adjustment',
    'invoice', 'credit', 'billing_run'
  ) then
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
    when 'invoice' then 'INV'
    when 'credit' then 'CRN'
    when 'billing_run' then 'BRN'
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

-- ---------------------------------------------------------------------------
-- Organisation tuition settings (optional; state schools leave disabled)
-- ---------------------------------------------------------------------------

create table school_finance_settings (
  organisation_id uuid primary key references organisations (id),
  tuition_enabled boolean not null default false,
  default_billing_frequency text not null default 'termly'
    check (default_billing_frequency in ('monthly', 'termly', 'annual', 'custom')),
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  invoice_prefix text not null default 'INV'
    check (char_length(trim(invoice_prefix)) between 1 and 12),
  payment_due_days integer not null default 14
    check (payment_due_days between 0 and 365),
  grace_period_days integer not null default 0
    check (grace_period_days between 0 and 90),
  default_academic_year_id uuid references academic_years (id),
  payment_instructions text
    check (payment_instructions is null or char_length(payment_instructions) <= 4000),
  invoice_footer text
    check (invoice_footer is null or char_length(invoice_footer) <= 4000),
  parents_can_view_invoices boolean not null default true,
  parents_can_view_balances boolean not null default true,
  discount_stacking_mode text not null default 'stack'
    check (discount_stacking_mode in ('stack', 'highest', 'priority')),
  sibling_order_mode text not null default 'oldest_first'
    check (sibling_order_mode in ('oldest_first', 'youngest_first', 'year_group', 'explicit')),
  mid_period_join_policy text not null default 'full'
    check (mid_period_join_policy in ('full', 'prorate', 'manual')),
  mid_period_leave_policy text not null default 'full'
    check (mid_period_leave_policy in ('full', 'prorate', 'manual')),
  monthly_instalment_count integer not null default 10
    check (monthly_instalment_count between 1 and 12),
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id)
);

create trigger school_finance_settings_updated_at before update on school_finance_settings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Fee schedules
-- ---------------------------------------------------------------------------

create table school_fee_schedules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  name text not null check (char_length(trim(name)) between 1 and 120),
  academic_year_id uuid not null references academic_years (id),
  year_group_id uuid references year_groups (id),
  class_id uuid references classes (id),
  amount_minor bigint not null check (amount_minor >= 0),
  annual_amount_minor bigint check (annual_amount_minor is null or annual_amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  billing_frequency text not null
    check (billing_frequency in ('monthly', 'termly', 'annual', 'custom')),
  instalment_count integer check (instalment_count is null or instalment_count between 1 and 24),
  effective_from date not null,
  effective_until date,
  is_active boolean not null default true,
  description text check (description is null or char_length(description) <= 4000),
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from)
);

create index school_fee_schedules_org_year_idx
  on school_fee_schedules (organisation_id, academic_year_id, is_active);

create trigger school_fee_schedules_updated_at before update on school_fee_schedules
  for each row execute function set_updated_at();

create table school_fee_schedule_instalments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  fee_schedule_id uuid not null references school_fee_schedules (id) on delete cascade,
  sequence integer not null check (sequence >= 1),
  label text not null check (char_length(trim(label)) between 1 and 80),
  due_on date,
  amount_minor bigint not null check (amount_minor >= 0),
  unique (fee_schedule_id, sequence)
);

create index school_fee_schedule_instalments_schedule_idx
  on school_fee_schedule_instalments (fee_schedule_id, sequence);

-- ---------------------------------------------------------------------------
-- Discount / concession rules
-- ---------------------------------------------------------------------------

create table school_discount_rules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  kind text not null check (kind in (
    'sibling', 'staff_child', 'scholarship', 'bursary',
    'early_payment', 'promotional', 'individual', 'other'
  )),
  name text not null check (char_length(trim(name)) between 1 and 120),
  amount_type text not null check (amount_type in ('percent', 'fixed')),
  percent_bps integer check (percent_bps is null or percent_bps between 0 and 10000),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  stacking_priority integer not null default 100,
  exclusive_group text check (exclusive_group is null or char_length(trim(exclusive_group)) between 1 and 40),
  staff_scope text check (staff_scope is null or staff_scope in ('all_staff', 'teachers', 'selected_roles')),
  staff_role_keys text[] not null default '{}',
  applies_to text not null default 'tuition'
    check (applies_to in ('tuition', 'all')),
  effective_from date,
  effective_until date,
  is_active boolean not null default true,
  description text check (description is null or char_length(description) <= 4000),
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (amount_type = 'percent' and percent_bps is not null and amount_minor is null)
    or (amount_type = 'fixed' and amount_minor is not null and percent_bps is null)
    or kind = 'sibling'
  ),
  check (effective_until is null or effective_from is null or effective_until >= effective_from)
);

create index school_discount_rules_org_idx
  on school_discount_rules (organisation_id, kind, is_active);

create trigger school_discount_rules_updated_at before update on school_discount_rules
  for each row execute function set_updated_at();

create table school_discount_rule_tiers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  discount_rule_id uuid not null references school_discount_rules (id) on delete cascade,
  sibling_position integer not null check (sibling_position >= 1),
  amount_type text not null check (amount_type in ('percent', 'fixed')),
  percent_bps integer check (percent_bps is null or percent_bps between 0 and 10000),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  unique (discount_rule_id, sibling_position),
  check (
    (amount_type = 'percent' and percent_bps is not null and amount_minor is null)
    or (amount_type = 'fixed' and amount_minor is not null and percent_bps is null)
  )
);

-- ---------------------------------------------------------------------------
-- Pupil fee profile + manual concessions
-- ---------------------------------------------------------------------------

create table school_pupil_fee_profiles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  academic_year_id uuid references academic_years (id),
  fee_schedule_id uuid references school_fee_schedules (id),
  override_amount_minor bigint check (override_amount_minor is null or override_amount_minor >= 0),
  override_billing_frequency text
    check (override_billing_frequency is null or override_billing_frequency in ('monthly', 'termly', 'annual', 'custom')),
  sibling_priority integer check (sibling_priority is null or sibling_priority >= 1),
  billing_account_id uuid,
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, student_profile_id)
);

create index school_pupil_fee_profiles_org_idx
  on school_pupil_fee_profiles (organisation_id, student_profile_id);

create trigger school_pupil_fee_profiles_updated_at before update on school_pupil_fee_profiles
  for each row execute function set_updated_at();

create table school_pupil_concessions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  discount_rule_id uuid references school_discount_rules (id),
  kind text not null check (kind in (
    'scholarship', 'bursary', 'early_payment', 'promotional', 'individual', 'other'
  )),
  name text not null check (char_length(trim(name)) between 1 and 120),
  amount_type text not null check (amount_type in ('percent', 'fixed')),
  percent_bps integer check (percent_bps is null or percent_bps between 0 and 10000),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  stacking_priority integer not null default 50,
  exclusive_group text,
  reason text not null check (char_length(trim(reason)) between 1 and 1000),
  effective_from date,
  effective_until date,
  is_active boolean not null default true,
  created_by uuid not null references users (id),
  approved_by uuid references users (id),
  created_at timestamptz not null default now(),
  check (
    (amount_type = 'percent' and percent_bps is not null and amount_minor is null)
    or (amount_type = 'fixed' and amount_minor is not null and percent_bps is null)
  )
);

create index school_pupil_concessions_student_idx
  on school_pupil_concessions (organisation_id, student_profile_id, is_active);

-- ---------------------------------------------------------------------------
-- Explicit staff-child eligibility (never inferred from names/emails)
-- ---------------------------------------------------------------------------

create table school_staff_child_links (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  staff_user_id uuid not null references users (id),
  student_profile_id uuid not null references student_profiles (id),
  guardianship_id uuid not null references guardianships (id),
  is_active boolean not null default true,
  effective_from date,
  effective_until date,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  unique (organisation_id, staff_user_id, student_profile_id)
);

create index school_staff_child_links_student_idx
  on school_staff_child_links (organisation_id, student_profile_id, is_active);

-- ---------------------------------------------------------------------------
-- Family billing accounts (school-side; not platform SaaS billing_accounts)
-- ---------------------------------------------------------------------------

create table school_billing_accounts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  name text not null check (char_length(trim(name)) between 1 and 160),
  primary_payer_user_id uuid references users (id),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index school_billing_accounts_org_idx
  on school_billing_accounts (organisation_id, name);

create trigger school_billing_accounts_updated_at before update on school_billing_accounts
  for each row execute function set_updated_at();

create table school_billing_account_pupils (
  organisation_id uuid not null references organisations (id),
  billing_account_id uuid not null references school_billing_accounts (id) on delete cascade,
  student_profile_id uuid not null references student_profiles (id),
  created_at timestamptz not null default now(),
  primary key (billing_account_id, student_profile_id),
  unique (organisation_id, student_profile_id)
);

create table school_billing_account_payers (
  organisation_id uuid not null references organisations (id),
  billing_account_id uuid not null references school_billing_accounts (id) on delete cascade,
  user_id uuid not null references users (id),
  created_at timestamptz not null default now(),
  primary key (billing_account_id, user_id)
);

alter table school_pupil_fee_profiles
  add constraint school_pupil_fee_profiles_billing_account_fkey
  foreign key (billing_account_id) references school_billing_accounts (id);

-- ---------------------------------------------------------------------------
-- Billing runs
-- ---------------------------------------------------------------------------

create table school_billing_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  reference text not null,
  period_key text not null check (char_length(trim(period_key)) between 1 and 80),
  academic_year_id uuid not null references academic_years (id),
  billing_frequency text not null
    check (billing_frequency in ('monthly', 'termly', 'annual', 'custom')),
  period_start date not null,
  period_end date not null,
  due_on date not null,
  instalment_number integer check (instalment_number is null or instalment_number >= 1),
  status text not null default 'previewed'
    check (status in ('previewed', 'confirmed', 'cancelled')),
  item_count integer not null default 0,
  warning_count integer not null default 0,
  error_count integer not null default 0,
  expected_total_minor bigint not null default 0,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  confirmed_by uuid references users (id),
  confirmed_at timestamptz,
  unique (organisation_id, reference),
  unique (organisation_id, period_key),
  check (period_end >= period_start)
);

create index school_billing_runs_org_idx
  on school_billing_runs (organisation_id, created_at desc);

create table school_billing_run_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  billing_run_id uuid not null references school_billing_runs (id) on delete cascade,
  student_profile_id uuid not null references student_profiles (id),
  billing_account_id uuid references school_billing_accounts (id),
  fee_schedule_id uuid references school_fee_schedules (id),
  year_group_id uuid references year_groups (id),
  standard_amount_minor bigint not null default 0,
  discount_total_minor bigint not null default 0,
  net_amount_minor bigint not null default 0,
  currency text not null,
  sibling_position integer,
  calculation jsonb not null default '{}'::jsonb,
  warning_code text,
  error_code text,
  invoice_id uuid,
  unique (billing_run_id, student_profile_id)
);

create index school_billing_run_items_run_idx
  on school_billing_run_items (billing_run_id, student_profile_id);

-- ---------------------------------------------------------------------------
-- Invoices (immutable once issued; corrections via credit / void)
-- ---------------------------------------------------------------------------

create table school_invoices (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  reference text not null,
  billing_account_id uuid not null references school_billing_accounts (id),
  payer_user_id uuid references users (id),
  academic_year_id uuid references academic_years (id),
  billing_run_id uuid references school_billing_runs (id),
  period_key text not null,
  billing_period_start date not null,
  billing_period_end date not null,
  invoice_date date not null default current_date,
  due_date date not null,
  status text not null default 'draft'
    check (status in (
      'draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void'
    )),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_total_minor bigint not null default 0 check (discount_total_minor >= 0),
  credit_total_minor bigint not null default 0 check (credit_total_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  paid_minor bigint not null default 0 check (paid_minor >= 0),
  outstanding_minor bigint not null default 0 check (outstanding_minor >= 0),
  payment_instructions_snapshot text,
  invoice_footer_snapshot text,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  delivery_state text not null default 'not_sent'
    check (delivery_state in ('not_sent', 'queued', 'sent', 'failed')),
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_by uuid references users (id),
  issued_at timestamptz,
  voided_by uuid references users (id),
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 1000),
  unique (organisation_id, reference)
);

create unique index school_invoices_period_uidx
  on school_invoices (organisation_id, billing_account_id, period_key)
  where status <> 'void';

create index school_invoices_org_status_idx
  on school_invoices (organisation_id, status, due_date);

create index school_invoices_account_idx
  on school_invoices (billing_account_id, invoice_date);

create trigger school_invoices_updated_at before update on school_invoices
  for each row execute function set_updated_at();

create table school_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  invoice_id uuid not null references school_invoices (id),
  sort_order integer not null default 0,
  kind text not null check (kind in (
    'tuition', 'trip', 'club', 'examination', 'activity', 'registration',
    'deposit', 'meal', 'discount', 'credit', 'miscellaneous'
  )),
  student_profile_id uuid references student_profiles (id),
  charge_id uuid references school_charges (id),
  fee_schedule_id uuid,
  discount_rule_id uuid,
  concession_id uuid,
  description text not null check (char_length(trim(description)) between 1 and 240),
  quantity integer not null default 1 check (quantity >= 1),
  unit_amount_minor bigint not null,
  amount_minor bigint not null,
  calculation_snapshot jsonb not null default '{}'::jsonb
);

create index school_invoice_lines_invoice_idx
  on school_invoice_lines (invoice_id, sort_order);

create table school_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  invoice_id uuid not null references school_invoices (id),
  billing_account_id uuid not null references school_billing_accounts (id),
  reference text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  method text not null check (method in (
    'card', 'bank_transfer', 'cash', 'cheque', 'direct_debit', 'other'
  )),
  received_on date not null default current_date,
  external_reference text,
  note text check (note is null or char_length(note) <= 2000),
  status text not null default 'succeeded'
    check (status in ('succeeded', 'reversed')),
  idempotency_key text,
  recorded_by uuid not null references users (id),
  recorded_at timestamptz not null default now(),
  reversed_by uuid references users (id),
  reversed_at timestamptz,
  reverse_reason text,
  unique (organisation_id, reference)
);

create unique index school_invoice_payments_idempotency_uidx
  on school_invoice_payments (organisation_id, idempotency_key)
  where idempotency_key is not null;

create index school_invoice_payments_invoice_idx
  on school_invoice_payments (invoice_id, recorded_at);

create table school_invoice_credits (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  billing_account_id uuid not null references school_billing_accounts (id),
  invoice_id uuid references school_invoices (id),
  reference text not null,
  kind text not null check (kind in (
    'credit_note', 'account_credit', 'overpayment', 'adjustment', 'refund'
  )),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (char_length(trim(reason)) between 1 and 1000),
  status text not null default 'applied'
    check (status in ('applied', 'reversed')),
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  reversed_by uuid references users (id),
  reversed_at timestamptz,
  unique (organisation_id, reference)
);

create index school_invoice_credits_account_idx
  on school_invoice_credits (billing_account_id, created_at);

alter table school_billing_run_items
  add constraint school_billing_run_items_invoice_fkey
  foreign key (invoice_id) references school_invoices (id);

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

select install_tenant_isolation('school_finance_settings');
select install_tenant_isolation('school_fee_schedules');
select install_tenant_isolation('school_fee_schedule_instalments');
select install_tenant_isolation('school_discount_rules');
select install_tenant_isolation('school_discount_rule_tiers');
select install_tenant_isolation('school_pupil_fee_profiles');
select install_tenant_isolation('school_pupil_concessions');
select install_tenant_isolation('school_staff_child_links');
select install_tenant_isolation('school_billing_accounts');
select install_tenant_isolation('school_billing_account_pupils');
select install_tenant_isolation('school_billing_account_payers');
select install_tenant_isolation('school_billing_runs');
select install_tenant_isolation('school_billing_run_items');
select install_tenant_isolation('school_invoices');
select install_tenant_isolation('school_invoice_lines');
select install_tenant_isolation('school_invoice_payments');
select install_tenant_isolation('school_invoice_credits');

grant select, insert, update, delete on school_finance_settings to schoolapp_app;
grant select, insert, update, delete on school_fee_schedules to schoolapp_app;
grant select, insert, update, delete on school_fee_schedule_instalments to schoolapp_app;
grant select, insert, update, delete on school_discount_rules to schoolapp_app;
grant select, insert, update, delete on school_discount_rule_tiers to schoolapp_app;
grant select, insert, update, delete on school_pupil_fee_profiles to schoolapp_app;
grant select, insert, update, delete on school_pupil_concessions to schoolapp_app;
grant select, insert, update, delete on school_staff_child_links to schoolapp_app;
grant select, insert, update, delete on school_billing_accounts to schoolapp_app;
grant select, insert, update, delete on school_billing_account_pupils to schoolapp_app;
grant select, insert, update, delete on school_billing_account_payers to schoolapp_app;
grant select, insert, update, delete on school_billing_runs to schoolapp_app;
grant select, insert, update, delete on school_billing_run_items to schoolapp_app;
grant select, insert, update, delete on school_invoices to schoolapp_app;
grant select, insert, update, delete on school_invoice_lines to schoolapp_app;
grant select, insert, update, delete on school_invoice_payments to schoolapp_app;
grant select, insert, update, delete on school_invoice_credits to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Cross-organisation integrity + actor stamping
-- ---------------------------------------------------------------------------

create or replace function school_tuition_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'school_fee_schedules' then
    if not exists (
      select 1 from academic_years y
      where y.id = new.academic_year_id and y.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    if new.year_group_id is not null and not exists (
      select 1 from year_groups g
      where g.id = new.year_group_id and g.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    if new.class_id is not null and not exists (
      select 1 from classes c
      where c.id = new.class_id and c.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'school_fee_schedule_instalments' then
    if not exists (
      select 1 from school_fee_schedules s
      where s.id = new.fee_schedule_id and s.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'school_discount_rule_tiers' then
    if not exists (
      select 1 from school_discount_rules r
      where r.id = new.discount_rule_id and r.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'school_staff_child_links' then
    if not exists (
      select 1 from student_profiles s
      where s.id = new.student_profile_id and s.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    if not exists (
      select 1 from guardianships g
      where g.id = new.guardianship_id
        and g.organisation_id = new.organisation_id
        and g.guardian_user_id = new.staff_user_id
        and g.student_profile_id = new.student_profile_id
    ) then
      raise exception 'staff_child_guardianship_required' using errcode = '23514';
    end if;
  elsif tg_table_name in ('school_pupil_fee_profiles', 'school_pupil_concessions') then
    if not exists (
      select 1 from student_profiles s
      where s.id = new.student_profile_id and s.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name in ('school_billing_account_pupils', 'school_billing_account_payers') then
    if not exists (
      select 1 from school_billing_accounts a
      where a.id = new.billing_account_id and a.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'school_invoices' then
    if not exists (
      select 1 from school_billing_accounts a
      where a.id = new.billing_account_id and a.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name in ('school_invoice_lines', 'school_invoice_payments') then
    if not exists (
      select 1 from school_invoices i
      where i.id = new.invoice_id and i.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'school_invoice_credits' then
    if not exists (
      select 1 from school_billing_accounts a
      where a.id = new.billing_account_id and a.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'school_billing_run_items' then
    if not exists (
      select 1 from school_billing_runs r
      where r.id = new.billing_run_id and r.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists school_fee_schedules_org_tg on school_fee_schedules;
create trigger school_fee_schedules_org_tg
  before insert or update on school_fee_schedules
  for each row execute function school_tuition_same_org_tg();

drop trigger if exists school_fee_schedule_instalments_org_tg on school_fee_schedule_instalments;
create trigger school_fee_schedule_instalments_org_tg
  before insert or update on school_fee_schedule_instalments
  for each row execute function school_tuition_same_org_tg();

drop trigger if exists school_discount_rule_tiers_org_tg on school_discount_rule_tiers;
create trigger school_discount_rule_tiers_org_tg
  before insert or update on school_discount_rule_tiers
  for each row execute function school_tuition_same_org_tg();

drop trigger if exists school_pupil_fee_profiles_org_tg on school_pupil_fee_profiles;
create trigger school_pupil_fee_profiles_org_tg
  before insert or update on school_pupil_fee_profiles
  for each row execute function school_tuition_same_org_tg();

drop trigger if exists school_pupil_concessions_org_tg on school_pupil_concessions;
create trigger school_pupil_concessions_org_tg
  before insert or update on school_pupil_concessions
  for each row execute function school_tuition_same_org_tg();

drop trigger if exists school_staff_child_links_org_tg on school_staff_child_links;
create trigger school_staff_child_links_org_tg
  before insert or update on school_staff_child_links
  for each row execute function school_tuition_same_org_tg();

drop trigger if exists school_billing_account_pupils_org_tg on school_billing_account_pupils;
create trigger school_billing_account_pupils_org_tg
  before insert or update on school_billing_account_pupils
  for each row execute function school_tuition_same_org_tg();

drop trigger if exists school_billing_account_payers_org_tg on school_billing_account_payers;
create trigger school_billing_account_payers_org_tg
  before insert or update on school_billing_account_payers
  for each row execute function school_tuition_same_org_tg();

drop trigger if exists school_invoices_org_tg on school_invoices;
create trigger school_invoices_org_tg
  before insert or update on school_invoices
  for each row execute function school_tuition_same_org_tg();

drop trigger if exists school_invoice_lines_org_tg on school_invoice_lines;
create trigger school_invoice_lines_org_tg
  before insert or update on school_invoice_lines
  for each row execute function school_tuition_same_org_tg();

drop trigger if exists school_invoice_payments_org_tg on school_invoice_payments;
create trigger school_invoice_payments_org_tg
  before insert or update on school_invoice_payments
  for each row execute function school_tuition_same_org_tg();

drop trigger if exists school_invoice_credits_org_tg on school_invoice_credits;
create trigger school_invoice_credits_org_tg
  before insert or update on school_invoice_credits
  for each row execute function school_tuition_same_org_tg();

drop trigger if exists school_billing_run_items_org_tg on school_billing_run_items;
create trigger school_billing_run_items_org_tg
  before insert or update on school_billing_run_items
  for each row execute function school_tuition_same_org_tg();

create or replace function school_tuition_actor_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name in (
    'school_fee_schedules',
    'school_discount_rules',
    'school_pupil_concessions',
    'school_staff_child_links',
    'school_billing_runs',
    'school_invoices'
  ) and tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.created_by := app_current_user_id();
    elsif new.created_by is null then
      raise exception 'finance_actor_required' using errcode = '23514';
    end if;
  elsif tg_table_name = 'school_invoice_payments' and tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.recorded_by := app_current_user_id();
    elsif new.recorded_by is null then
      raise exception 'finance_actor_required' using errcode = '23514';
    end if;
  elsif tg_table_name = 'school_invoice_credits' and tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.created_by := app_current_user_id();
    elsif new.created_by is null then
      raise exception 'finance_actor_required' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists school_fee_schedules_actor_tg on school_fee_schedules;
create trigger school_fee_schedules_actor_tg
  before insert on school_fee_schedules
  for each row execute function school_tuition_actor_tg();

drop trigger if exists school_discount_rules_actor_tg on school_discount_rules;
create trigger school_discount_rules_actor_tg
  before insert on school_discount_rules
  for each row execute function school_tuition_actor_tg();

drop trigger if exists school_pupil_concessions_actor_tg on school_pupil_concessions;
create trigger school_pupil_concessions_actor_tg
  before insert on school_pupil_concessions
  for each row execute function school_tuition_actor_tg();

drop trigger if exists school_staff_child_links_actor_tg on school_staff_child_links;
create trigger school_staff_child_links_actor_tg
  before insert on school_staff_child_links
  for each row execute function school_tuition_actor_tg();

drop trigger if exists school_billing_runs_actor_tg on school_billing_runs;
create trigger school_billing_runs_actor_tg
  before insert on school_billing_runs
  for each row execute function school_tuition_actor_tg();

drop trigger if exists school_invoices_actor_tg on school_invoices;
create trigger school_invoices_actor_tg
  before insert on school_invoices
  for each row execute function school_tuition_actor_tg();

drop trigger if exists school_invoice_payments_actor_tg on school_invoice_payments;
create trigger school_invoice_payments_actor_tg
  before insert on school_invoice_payments
  for each row execute function school_tuition_actor_tg();

drop trigger if exists school_invoice_credits_actor_tg on school_invoice_credits;
create trigger school_invoice_credits_actor_tg
  before insert on school_invoice_credits
  for each row execute function school_tuition_actor_tg();

-- Issued invoices are snapshot documents. Amounts and period keys cannot be rewritten.
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

drop trigger if exists school_invoices_immutable_tg on school_invoices;
create trigger school_invoices_immutable_tg
  before update on school_invoices
  for each row execute function school_invoices_immutable_tg();

create or replace function school_invoice_lines_immutable_tg()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
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

drop trigger if exists school_invoice_lines_immutable_tg on school_invoice_lines;
create trigger school_invoice_lines_immutable_tg
  before insert or update or delete on school_invoice_lines
  for each row execute function school_invoice_lines_immutable_tg();

-- ---------------------------------------------------------------------------
-- Org defaults (tuition off; extra charge categories only)
-- ---------------------------------------------------------------------------

create or replace function ensure_organisation_phase21_defaults(p_organisation_id uuid)
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

  insert into school_finance_settings (organisation_id)
  values (p_organisation_id)
  on conflict (organisation_id) do nothing;

  insert into school_charge_categories (organisation_id, key, name, sort_order, is_system)
  values
    (p_organisation_id, 'tuition', 'Tuition', 0, true),
    (p_organisation_id, 'registration', 'Registration fee', 10, true),
    (p_organisation_id, 'deposit', 'Deposit', 11, true)
  on conflict (organisation_id, key) do nothing;
end;
$$;

revoke all on function ensure_organisation_phase21_defaults(uuid) from public;
grant execute on function ensure_organisation_phase21_defaults(uuid) to schoolapp_app;

create or replace function organisations_phase21_defaults_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform ensure_organisation_phase21_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists organisations_phase21_defaults_tg on organisations;
create trigger organisations_phase21_defaults_tg
  after insert on organisations
  for each row execute function organisations_phase21_defaults_tg();

select ensure_organisation_phase21_defaults(id) from organisations;
