-- Academic calendar closures, finance lifecycle, Stripe invoice checkout,
-- document snapshots, and granular finance permissions.
-- Additive only. Does not rewrite 0001–0048. Preserves FORCE RLS, tenant
-- isolation, existing academic years/terms, fee schedules, invoices, and
-- payment-provider abstraction. Does not create a second term or finance system.

-- ---------------------------------------------------------------------------
-- Permissions (granular finance capabilities for a future bursar role)
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('finance.read', 'Read school finance configuration, invoices, and family accounts'),
  ('finance.manage', 'Manage school finance configuration and fee schedules'),
  ('finance.payments.read', 'Read payment transactions, receipts, and allocations'),
  ('finance.payments.manage', 'Create checkout sessions and record or allocate payments')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'finance.read'),
    ('school.admin', 'finance.manage'),
    ('school.admin', 'finance.payments.read'),
    ('school.admin', 'finance.payments.manage'),
    ('school.headteacher', 'finance.read'),
    ('school.headteacher', 'finance.payments.read')
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
    'finance.read',
    'finance.manage',
    'finance.payments.read',
    'finance.payments.manage'
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Half-term unused deletes (same pattern as unused terms in 0047)
-- ---------------------------------------------------------------------------

grant delete on half_terms to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Extra non-teaching calendar types (used by timetable expansion)
-- ---------------------------------------------------------------------------

insert into school_event_types (organisation_id, key, name, sort_order, is_system)
select o.id, x.key, x.name, x.sort_order, true
from organisations o
cross join (
  values
    ('bank_holiday', 'Bank holiday', 12),
    ('school_closure', 'School closure', 13),
    ('non_teaching', 'Other non-teaching day', 14)
) as x(key, name, sort_order)
on conflict (organisation_id, key) do nothing;

create or replace function ensure_organisation_phase10_defaults(p_organisation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_organisation_id is null then
    return;
  end if;
  if nullif(current_setting('app.organisation_id', true), '') is not null
     and app_current_organisation_id() is distinct from p_organisation_id
     and not app_is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into school_event_types (organisation_id, key, name, sort_order, is_system)
  values
    (p_organisation_id, 'school_holiday', 'School holiday', 1, true),
    (p_organisation_id, 'inset_day', 'INSET day', 2, true),
    (p_organisation_id, 'parents_evening', 'Parents'' evening', 3, true),
    (p_organisation_id, 'assembly', 'Assembly', 4, true),
    (p_organisation_id, 'sports_day', 'Sports day', 5, true),
    (p_organisation_id, 'open_day', 'Open day', 6, true),
    (p_organisation_id, 'trip', 'Trip', 7, true),
    (p_organisation_id, 'exam', 'Exam / assessment', 8, true),
    (p_organisation_id, 'class_event', 'Class event', 9, true),
    (p_organisation_id, 'club', 'Club', 10, true),
    (p_organisation_id, 'meeting', 'Meeting', 11, true),
    (p_organisation_id, 'bank_holiday', 'Bank holiday', 12, true),
    (p_organisation_id, 'school_closure', 'School closure', 13, true),
    (p_organisation_id, 'non_teaching', 'Other non-teaching day', 14, true)
  on conflict (organisation_id, key) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Finance settings: receipt prefix + student finance visibility
-- ---------------------------------------------------------------------------

alter table school_finance_settings
  add column if not exists receipt_prefix text not null default 'RCT'
    check (char_length(trim(receipt_prefix)) between 1 and 12);

alter table school_finance_settings
  add column if not exists students_can_view_finance boolean not null default false;

-- Kingswood presentation prefix. Existing issued numbers are never rewritten.
update school_finance_settings s
   set invoice_prefix = 'KSW-INV',
       receipt_prefix = 'KSW-RCT'
  from organisations o
 where o.id = s.organisation_id
   and s.invoice_prefix = 'INV'
   and (
     o.school_code ilike 'ksw'
     or o.slug ilike 'kingswood%'
     or o.name ilike 'kingswood%'
   );

-- Extra charge categories for the general school finance engine.
insert into school_charge_categories (organisation_id, key, name, sort_order, is_system)
select o.id, x.key, x.name, x.sort_order, true
from organisations o
cross join (
  values
    ('after_school', 'After-school care', 12),
    ('admissions', 'Admissions', 13)
) as x(key, name, sort_order)
on conflict (organisation_id, key) do nothing;

create or replace function ensure_organisation_phase21_defaults(p_organisation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_organisation_id is null then
    return;
  end if;
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
    (p_organisation_id, 'deposit', 'Deposit', 11, true),
    (p_organisation_id, 'after_school', 'After-school care', 12, true),
    (p_organisation_id, 'admissions', 'Admissions', 13, true)
  on conflict (organisation_id, key) do nothing;
end;
$$;

alter table school_invoice_lines
  drop constraint if exists school_invoice_lines_kind_check;
alter table school_invoice_lines
  add constraint school_invoice_lines_kind_check
  check (kind in (
    'tuition', 'trip', 'club', 'examination', 'activity', 'registration',
    'deposit', 'meal', 'discount', 'credit', 'miscellaneous',
    'music', 'after_school', 'admissions'
  ));

-- Issued invoices keep a display snapshot for historical PDFs.
alter table school_invoices
  add column if not exists display_snapshot jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Invoice-aware Stripe/fake checkout (charge_id remains for Phase 15 charges)
-- ---------------------------------------------------------------------------

alter table school_payment_sessions
  alter column charge_id drop not null;
alter table school_payment_sessions
  add column if not exists invoice_id uuid references school_invoices (id);
alter table school_payment_sessions
  drop constraint if exists school_payment_sessions_target_chk;
alter table school_payment_sessions
  add constraint school_payment_sessions_target_chk
  check (charge_id is not null or invoice_id is not null);

alter table school_payment_transactions
  alter column charge_id drop not null;
alter table school_payment_transactions
  add column if not exists invoice_id uuid references school_invoices (id);
alter table school_payment_transactions
  drop constraint if exists school_payment_transactions_target_chk;
alter table school_payment_transactions
  add constraint school_payment_transactions_target_chk
  check (charge_id is not null or invoice_id is not null);

alter table school_payment_receipts
  alter column charge_id drop not null;
alter table school_payment_receipts
  alter column transaction_id drop not null;
alter table school_payment_receipts
  add column if not exists invoice_id uuid references school_invoices (id);
alter table school_payment_receipts
  add column if not exists invoice_payment_id uuid references school_invoice_payments (id);
alter table school_payment_receipts
  drop constraint if exists school_payment_receipts_target_chk;
alter table school_payment_receipts
  add constraint school_payment_receipts_target_chk
  check (charge_id is not null or invoice_id is not null);

create index if not exists school_payment_sessions_invoice_idx
  on school_payment_sessions (invoice_id, created_at)
  where invoice_id is not null;
create index if not exists school_payment_receipts_invoice_idx
  on school_payment_receipts (invoice_id, created_at)
  where invoice_id is not null;
create unique index if not exists school_payment_receipts_invoice_payment_uidx
  on school_payment_receipts (invoice_payment_id)
  where invoice_payment_id is not null;

-- Invoice checkout/receipts have a nullable charge_id. The Phase 15 same-org
-- trigger required a matching school_charges row; that blocked invoice payments.
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

-- OUT columns changed (invoice_id). PostgreSQL cannot CREATE OR REPLACE
-- a function when the row type defined by OUT parameters differs.
drop function if exists resolve_payment_provider_session(text, text);
drop function if exists resolve_payment_provider_payment(text, text);
drop function if exists load_payment_demo_session(uuid);

create or replace function resolve_payment_provider_session(
  p_provider_key text,
  p_provider_session_id text
)
returns table (
  organisation_id uuid,
  session_id uuid,
  charge_id uuid,
  invoice_id uuid,
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
         s.invoice_id,
         s.transaction_id,
         coalesce(s.created_by, t.payer_user_id, c.created_by, i.created_by),
         s.amount_minor,
         s.currency,
         s.status
    from school_payment_sessions s
    join school_payment_transactions t on t.id = s.transaction_id
    left join school_charges c on c.id = s.charge_id
    left join school_invoices i on i.id = s.invoice_id
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
  invoice_id uuid,
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
         t.invoice_id,
         coalesce(t.payer_user_id, c.created_by, i.created_by),
         t.amount_minor,
         t.currency
    from school_payment_transactions t
    left join school_charges c on c.id = t.charge_id
    left join school_invoices i on i.id = t.invoice_id
   where t.provider_key = p_provider_key
     and t.provider_payment_id = p_provider_payment_id;
end;
$$;

revoke all on function resolve_payment_provider_payment(text, text) from public;
grant execute on function resolve_payment_provider_payment(text, text) to schoolapp_app;

-- Demo checkout can target an invoice as well as a Phase 15 charge.
create or replace function load_payment_demo_session(p_session_id uuid)
returns table (
  organisation_id uuid,
  provider_session_id text,
  amount_minor bigint,
  currency text,
  charge_id uuid,
  invoice_id uuid,
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
         s.invoice_id,
         coalesce(c.title, i.reference, 'Payment'),
         s.status,
         coalesce(sp.legal_name, a.name, 'Family account')
    from school_payment_sessions s
    left join school_charges c on c.id = s.charge_id
    left join student_profiles sp on sp.id = c.student_profile_id
    left join school_invoices i on i.id = s.invoice_id
    left join school_billing_accounts a on a.id = i.billing_account_id
   where s.id = p_session_id;
end;
$$;

revoke all on function load_payment_demo_session(uuid) from public;
grant execute on function load_payment_demo_session(uuid) to schoolapp_app;

alter table school_billing_runs
  drop constraint if exists school_billing_runs_period_key_check;
alter table school_billing_runs
  add constraint school_billing_runs_period_key_check
  check (char_length(trim(period_key)) between 1 and 120);

-- Organisation-safe invoice/receipt numbering. Existing issued numbers stay.
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
  v_settings_prefix text;
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
  if p_kind = 'invoice' then
    select invoice_prefix into v_settings_prefix
      from school_finance_settings
     where organisation_id = p_organisation_id;
    v_prefix := coalesce(nullif(trim(v_settings_prefix), ''), 'INV');
  elsif p_kind = 'receipt' then
    select receipt_prefix into v_settings_prefix
      from school_finance_settings
     where organisation_id = p_organisation_id;
    v_prefix := coalesce(nullif(trim(v_settings_prefix), ''), 'RCT');
  else
    v_prefix := case p_kind
      when 'charge' then 'CHG'
      when 'payment' then 'PAY'
      when 'refund' then 'RFD'
      when 'credit' then 'CRN'
      when 'billing_run' then 'BRN'
      else 'ADJ'
    end;
  end if;
  insert into school_finance_counters (organisation_id, kind, year, last_value)
  values (p_organisation_id, p_kind, v_year, 1)
  on conflict (organisation_id, kind, year)
  do update set last_value = school_finance_counters.last_value + 1
  returning last_value into v_n;
  return v_prefix || '-' || v_year::text || '-' || lpad(v_n::text, 6, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- Finance transactional email purposes (queued through existing mail_outbox)
-- ---------------------------------------------------------------------------

alter table public.mail_outbox
  drop constraint if exists mail_outbox_purpose_check;
alter table public.mail_outbox
  add constraint mail_outbox_purpose_check
  check (purpose in (
    'staff_invite',
    'parent_invite',
    'password_reset',
    'account_activation',
    'student_activation',
    'admissions_application_received',
    'admissions_status_update',
    'finance_invoice_issued',
    'finance_payment_received',
    'finance_payment_reminder',
    'finance_refund_issued'
  ));

-- ---------------------------------------------------------------------------
-- Kingswood 2026/27 terms + half terms (idempotent; never creates a second year)
-- ---------------------------------------------------------------------------

insert into terms (
  organisation_id, academic_year_id, key, name, starts_on, ends_on, sort_order
)
select ay.organisation_id, ay.id, x.key, x.name, x.starts_on::date, x.ends_on::date, x.sort_order
from academic_years ay
cross join (
  values
    ('autumn', 'Autumn Term 2026', '2026-09-07', '2026-12-11', 1),
    ('spring', 'Spring Term 2027', '2027-01-06', '2027-03-25', 2),
    ('summer', 'Summer Term 2027', '2027-04-20', '2027-07-09', 3)
) as x(key, name, starts_on, ends_on, sort_order)
where ay.name in ('2026/27', '2026-27')
  and ay.starts_on = date '2026-09-07'
  and ay.ends_on = date '2027-07-09'
on conflict (academic_year_id, key) do nothing;

insert into half_terms (
  organisation_id, term_id, name, starts_on, ends_on, sort_order
)
select t.organisation_id, t.id, x.name, x.starts_on::date, x.ends_on::date, x.sort_order
from terms t
join academic_years ay on ay.id = t.academic_year_id
join (
  values
    ('autumn', 'Autumn half term', '2026-10-19', '2026-10-30', 1),
    ('spring', 'Spring half term', '2027-02-15', '2027-02-19', 1),
    ('summer', 'Summer half term', '2027-05-31', '2027-06-04', 1)
) as x(term_key, name, starts_on, ends_on, sort_order)
  on x.term_key = t.key
where ay.name in ('2026/27', '2026-27')
  and ay.starts_on = date '2026-09-07'
  and ay.ends_on = date '2027-07-09'
  and not exists (
    select 1
      from half_terms ht
     where ht.term_id = t.id
       and ht.starts_on = x.starts_on::date
       and ht.ends_on = x.ends_on::date
  );

-- Good Friday 26 Mar 2027 sits after Spring term end; record it as a calendar
-- closure without extending the teaching term. Events must be inserted as
-- draft, then published (school_events_write_tg).
with inserted as (
  insert into school_events (
    organisation_id, title, description, event_type_id, starts_at, ends_at, all_day,
    related_kind, related_id, created_by
  )
  select
    ay.organisation_id,
    'Good Friday',
    'Non-teaching day. Falls after Spring Term 2027 ends.',
    st.id,
    timestamptz '2027-03-26 00:00:00+00',
    timestamptz '2027-03-26 23:59:59+00',
    true,
    'academic_year',
    ay.id,
    actor.user_id
  from academic_years ay
  join school_event_types st
    on st.organisation_id = ay.organisation_id and st.key = 'bank_holiday'
  join lateral (
    select m.user_id
      from organisation_memberships m
     where m.organisation_id = ay.organisation_id
       and m.status = 'active'
     order by m.created_at
     limit 1
  ) actor on true
  where ay.name in ('2026/27', '2026-27')
    and ay.starts_on = date '2026-09-07'
    and ay.ends_on = date '2027-07-09'
    and not exists (
      select 1
        from school_events se
       where se.organisation_id = ay.organisation_id
         and se.title = 'Good Friday'
         and se.starts_at::date = date '2027-03-26'
    )
  returning id
)
update school_events e
   set status = 'published'
  from inserted
 where e.id = inserted.id;
