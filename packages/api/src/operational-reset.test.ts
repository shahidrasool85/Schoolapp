import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signAccessToken } from "@schoolapp/auth";
import { FakeEmailProvider, executeOperationalReset, assertOperationalResetPlanCoversSchema } from "@schoolapp/core";
import { closePools } from "@schoolapp/db";
import {
  addMembership,
  ensureMigrated,
  insertUser,
  login,
  TEST_AUTH_SECRET,
  testApp,
  testObjectStorage,
  testPools,
} from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);

type School = {
  orgId: string;
  slug: string;
  name: string;
  adminId: string;
  adminEmail: string;
};

async function createSchool(
  owner: ReturnType<typeof testPools>["owner"],
  id: string,
  options: { name?: string; slug?: string; adminEmail?: string } = {},
): Promise<School> {
  const adminEmail = options.adminEmail ?? `admin-${id}@example.com`;
  const slug = options.slug ?? `orst-${id}`;
  const name = options.name ?? `Reset School ${id}`;
  const adminId = await insertUser(owner, {
    email: adminEmail,
    password: "password-12x",
    fullName: "School Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string }>(
    "insert into organisations (slug, name, status, legal_name, school_code) values ($1, $2, 'active', $3, $4) returning id",
    [slug, name, `${name} Trust`, "KSW"],
  );
  const orgId = org.rows[0]!.id;
  await owner.query("insert into organisation_settings (organisation_id, contact_email, tagline) values ($1, $2, $3)", [
    orgId,
    "office@school.example",
    "Learn with joy",
  ]);
  await addMembership(owner, orgId, adminId, "school.admin");
  await owner.query(
    "insert into staff_profiles (organisation_id, user_id, job_title) values ($1, $2, 'School Admin')",
    [orgId, adminId],
  );
  return { orgId, slug, name, adminId, adminEmail };
}

async function count(owner: ReturnType<typeof testPools>["owner"], table: string, orgId: string): Promise<number> {
  const result = await owner.query<{ n: string }>(`select count(*)::text as n from ${table} where organisation_id = $1`, [
    orgId,
  ]);
  return Number(result.rows[0]?.n ?? 0);
}

async function fingerprint(owner: ReturnType<typeof testPools>["owner"], orgId: string): Promise<string> {
  const tables = [
    "student_profiles",
    "guardianships",
    "admissions_enquiries",
    "admissions_applications",
    "academic_years",
    "attendance_marks",
    "learning_assignments",
    "safeguarding_concerns",
    "school_invoices",
    "school_payment_transactions",
    "school_payment_receipts",
    "mail_outbox",
    "stored_objects",
    "organisation_memberships",
    "staff_profiles",
  ];
  const parts: string[] = [];
  for (const table of tables) {
    const result = await owner.query<{ n: string; h: string }>(
      `select count(*)::text as n, coalesce(md5(string_agg(id::text, ',' order by id)), '') as h
         from ${table} where organisation_id = $1`,
      [orgId],
    );
    parts.push(`${table}:${result.rows[0]!.n}:${result.rows[0]!.h}`);
  }
  const users = await owner.query<{ n: string; h: string }>(
    `select count(*)::text as n, coalesce(md5(string_agg(u.id::text, ',' order by u.id)), '') as h
       from users u
       join organisation_memberships m on m.user_id = u.id
      where m.organisation_id = $1`,
    [orgId],
  );
  parts.push(`members:${users.rows[0]!.n}:${users.rows[0]!.h}`);
  return parts.join("|");
}

async function seedOperational(
  owner: ReturnType<typeof testPools>["owner"],
  school: School,
  extra: {
    teacherId?: string;
    parentId?: string;
    studentUserId?: string;
    secondAdminId?: string;
  } = {},
) {
  const year = await owner.query<{ id: string }>(
    `insert into academic_years (organisation_id, name, starts_on, ends_on, is_current)
     values ($1, '2026/27', '2026-09-01', '2027-07-31', true) returning id`,
    [school.orgId],
  );
  const yearId = year.rows[0]!.id;
  const group = await owner.query<{ id: string }>(
    `insert into year_groups (organisation_id, code, name, sort_order)
     values ($1, '3', 'Year 3', 3) returning id`,
    [school.orgId],
  );
  const yearGroupId = group.rows[0]!.id;
  const klass = await owner.query<{ id: string }>(
    `insert into classes (organisation_id, academic_year_id, year_group_id, name)
     values ($1, $2, $3, '3A') returning id`,
    [school.orgId, yearId, yearGroupId],
  );
  const classId = klass.rows[0]!.id;
  const pupil = await owner.query<{ id: string }>(
    `insert into student_profiles (organisation_id, user_id, legal_name, enrolment_status)
     values ($1, $2, 'Test Pupil', 'enrolled') returning id`,
    [school.orgId, extra.studentUserId ?? null],
  );
  const pupilId = pupil.rows[0]!.id;
  if (extra.parentId) {
    await owner.query(
      `insert into guardianships (organisation_id, student_profile_id, guardian_user_id, relationship, portal_access)
       values ($1, $2, $3, 'mother', true)`,
      [school.orgId, pupilId, extra.parentId],
    );
  }
  await owner.query(
    `insert into admissions_enquiries (
       organisation_id, reference, pupil_legal_name, guardian_full_name, enquiry_date
     ) values ($1, $2, 'Enquiry Pupil', 'Guardian', current_date)`,
    [school.orgId, `ENQ-${suffix()}`],
  );
  await owner.query(
    `insert into admissions_applications (
       organisation_id, reference, pupil_legal_name, status
     ) values ($1, $2, 'Applicant Pupil', 'submitted')`,
    [school.orgId, `APP-${suffix()}`],
  );
  const session = await owner.query<{ id: string }>(
    `insert into attendance_session_types (organisation_id, key, name)
     values ($1, 'am', 'Morning')
     on conflict (organisation_id, key) do update set name = excluded.name
     returning id`,
    [school.orgId],
  );
  const code = await owner.query<{ id: string }>(
    `insert into attendance_codes (organisation_id, code, name, category)
     values ($1, 'P', 'Present', 'present')
     on conflict (organisation_id, code) do update set name = excluded.name
     returning id`,
    [school.orgId],
  );
  await owner.query(
    `insert into attendance_marks (
       organisation_id, student_profile_id, academic_year_id, session_type_id, mark_date,
       attendance_code_id, recorded_by
     ) values ($1, $2, $3, $4, '2026-09-08', $5, $6)`,
    [school.orgId, pupilId, yearId, session.rows[0]!.id, code.rows[0]!.id, school.adminId],
  );
  await owner.query(
    `insert into rooms (organisation_id, name, short_code, created_by) values ($1, 'Room 1', 'R1', $2)`,
    [school.orgId, school.adminId],
  );
  await owner.query(
    `insert into timetable_entries (
       organisation_id, academic_year_id, weekday, starts_at, ends_at, class_id, effective_from, created_by
     ) values ($1, $2, 1, '09:00', '09:45', $3, '2026-09-01', $4)`,
    [school.orgId, yearId, classId, school.adminId],
  );
  const workType = await owner.query<{ id: string }>(
    `insert into learning_work_types (organisation_id, key, name)
     values ($1, 'homework', 'Homework')
     on conflict (organisation_id, key) do update set name = excluded.name
     returning id`,
    [school.orgId],
  );
  await owner.query(
    `insert into learning_assignments (
       organisation_id, title, work_type_id, academic_year_id, created_by
     ) values ($1, 'UAT homework', $2, $3, $4)`,
    [school.orgId, workType.rows[0]!.id, yearId, school.adminId],
  );
  const sgCat = await owner.query<{ id: string }>(
    `insert into safeguarding_concern_categories (organisation_id, key, name)
     values ($1, 'welfare', 'Welfare')
     on conflict (organisation_id, key) do update set name = excluded.name
     returning id`,
    [school.orgId],
  );
  await owner.query(
    `insert into safeguarding_concerns (
       organisation_id, student_profile_id, arose_at, category_id, factual_description, recorded_by
     ) values ($1, $2, now(), $3, 'UAT safeguarding note', $4)`,
    [school.orgId, pupilId, sgCat.rows[0]!.id, school.adminId],
  );
  const eventType = await owner.query<{ id: string }>(
    `insert into school_event_types (organisation_id, key, name)
     values ($1, 'inset_day', 'INSET day')
     on conflict (organisation_id, key) do update set name = excluded.name
     returning id`,
    [school.orgId],
  );
  await owner.query(
    `insert into announcements (organisation_id, title, body, created_by)
     values ($1, 'UAT notice', 'Testing notice body', $2)`,
    [school.orgId, school.adminId],
  );
  await owner.query(
    `insert into school_events (
       organisation_id, title, event_type_id, starts_at, ends_at, created_by
     ) values ($1, 'UAT closure', $2, '2026-09-14 00:00+00', '2026-09-14 23:59+00', $3)`,
    [school.orgId, eventType.rows[0]!.id, school.adminId],
  );
  const account = await owner.query<{ id: string }>(
    `insert into school_billing_accounts (organisation_id, name) values ($1, 'UAT family') returning id`,
    [school.orgId],
  );
  await owner.query(
    `insert into school_invoices (
       organisation_id, reference, billing_account_id, period_key, billing_period_start, billing_period_end,
       due_date, currency, created_by, calculation_snapshot
     ) values ($1, $2, $3, $4, '2026-09-01', '2026-12-18', '2026-09-15', 'GBP', $5, $6::jsonb)`,
    [
      school.orgId,
      `INV-${suffix()}`,
      account.rows[0]!.id,
      `2026-T1-${suffix()}`,
      school.adminId,
      JSON.stringify({ source: "missing_catchup", catchupStudentProfileId: pupilId }),
    ],
  );
  const category = await owner.query<{ id: string }>(
    `insert into school_charge_categories (organisation_id, key, name, sort_order)
     values ($1, 'trip', 'Trip', 1)
     on conflict (organisation_id, key) do update set name = excluded.name
     returning id`,
    [school.orgId],
  );
  const charge = await owner.query<{ id: string }>(
    `insert into school_charges (
       organisation_id, reference, title, category_id, student_profile_id, original_amount_minor,
       amount_due_minor, currency, created_by, status
     ) values ($1, $2, 'UAT trip', $3, $4, 1000, 1000, 'GBP', $5, 'issued') returning id`,
    [school.orgId, `CHG-${suffix()}`, category.rows[0]!.id, pupilId, school.adminId],
  );
  const tx = await owner.query<{ id: string }>(
    `insert into school_payment_transactions (
       organisation_id, charge_id, reference, amount_minor, currency, channel, provider_key, status, offline_method, received_by
     ) values ($1, $2, $3, 1000, 'GBP', 'offline', 'offline', 'succeeded', 'cash', $4) returning id`,
    [school.orgId, charge.rows[0]!.id, `PAY-${suffix()}`, school.adminId],
  );
  await owner.query(
    `insert into school_payment_receipts (
       organisation_id, charge_id, transaction_id, reference, snapshot
     ) values ($1, $2, $3, $4, '{}'::jsonb)`,
    [school.orgId, charge.rows[0]!.id, tx.rows[0]!.id, `RCT-${suffix()}`],
  );
  await owner.query(
    `insert into school_payment_provider_events (
       organisation_id, provider_key, event_id, event_type
     ) values ($1, 'stripe', $2, 'checkout.session.completed')`,
    [school.orgId, `evt_${suffix()}`],
  );
  await owner.query(
    `insert into school_payment_provider_configs (organisation_id, provider_key, secret_ref, mode, is_active)
     values ($1, 'stripe', 'encrypted:v1', 'test', true)
     on conflict (organisation_id, provider_key) do update set mode = 'test'`,
    [school.orgId],
  );
  await owner.query(
    `insert into school_finance_settings (organisation_id, invoice_footer, vat_enabled)
     values ($1, 'Pay to the school bank', false)
     on conflict (organisation_id) do update set invoice_footer = excluded.invoice_footer`,
    [school.orgId],
  );
  const branding = await owner.query<{ id: string }>(
    `insert into stored_objects (
       organisation_id, domain, owner_record_id, storage_backend, storage_key, original_filename,
       content_type, byte_size, status
     ) values ($1, 'branding', $1, 'filesystem', $2, 'logo.png', 'image/png', 12, 'active') returning id`,
    [school.orgId, `branding/${school.orgId}/logo.png`],
  );
  await owner.query(`update organisation_settings set logo_object_id = $2 where organisation_id = $1`, [
    school.orgId,
    branding.rows[0]!.id,
  ]);
  const operationalKey = `org/${school.orgId}/uat-file`;
  await testObjectStorage.putObject({
    key: operationalKey,
    body: new Uint8Array([1, 2, 3, 4]),
    contentType: "text/plain",
  });
  await owner.query(
    `insert into stored_objects (
       organisation_id, domain, owner_record_id, storage_backend, storage_key, original_filename,
       content_type, byte_size, status
     ) values ($1, 'student_document', $2, 'filesystem', $3, 'uat.txt', 'text/plain', 4, 'active')`,
    [school.orgId, pupilId, operationalKey],
  );
  await owner.query(
    `insert into mail_outbox (
       organisation_id, purpose, to_email, subject, body_text, status, template_key
     ) values ($1, 'admissions_application_received', 'uat@example.com', 'UAT mail', 'Hello', 'queued', 'admissions_application_received')`,
    [school.orgId],
  );
  await owner.query(
    `insert into organisation_setup_progress (
       organisation_id, current_step, completed_steps, completed_at
     ) values ($1, 'completion', '{school_details,branding,academic_year,completion}', now())
     on conflict (organisation_id) do update
       set current_step = 'completion',
           completed_steps = '{school_details,branding,academic_year,completion}',
           completed_at = now()`,
    [school.orgId],
  );
  await owner.query(
    `insert into organisation_transactional_email_templates (
       organisation_id, template_key, subject, heading, greeting, body_text, signoff
     ) values ($1, 'admissions_enquiry_received', 'Thanks', 'Hello', 'Hi', 'We got your enquiry.', 'Regards')
     on conflict (organisation_id, template_key) do nothing`,
    [school.orgId],
  );
  await owner.query(
    `insert into invitations (organisation_id, email, intended_role_keys, token_hash, expires_at)
     values ($1, $2, '{school.teacher}', $3, now() + interval '7 days')`,
    [school.orgId, `invite-${suffix()}@example.com`, `invite-${school.orgId}-${suffix()}`],
  );
  return { yearId, pupilId, brandingId: branding.rows[0]!.id };
}

/** Kingswood-like issued tuition + Stripe TEST payment graph (0064–0067). */
async function seedIssuedFinanceLifecycle(
  owner: ReturnType<typeof testPools>["owner"],
  school: School,
  input: { yearId: string; pupilId: string },
): Promise<{
  invoiceId: string;
  catchupInvoiceId: string;
  paymentId: string;
  receiptId: string;
  billingRunId: string;
  historicalAuditId: string;
}> {
  const tag = suffix();
  const account = await owner.query<{ id: string }>(
    `insert into school_billing_accounts (organisation_id, name) values ($1, 'Kingswood family') returning id`,
    [school.orgId],
  );
  const accountId = account.rows[0]!.id;
  await owner.query(
    `insert into school_billing_account_pupils (organisation_id, billing_account_id, student_profile_id)
     values ($1, $2, $3)`,
    [school.orgId, accountId, input.pupilId],
  );
  const periodKey = `tuition:termly:2026-09-01:2026-12-18:${tag}`;
  const billingRun = await owner.query<{ id: string }>(
    `insert into school_billing_runs (
       organisation_id, reference, period_key, academic_year_id, billing_frequency,
       period_start, period_end, due_on, status, currency, created_by, confirmed_by, confirmed_at
     ) values ($1, $2, $3, $4, 'termly', '2026-09-01', '2026-12-18', '2026-09-15',
               'confirmed', 'GBP', $5, $5, now()) returning id`,
    [school.orgId, `BRN-${tag}`, periodKey, input.yearId, school.adminId],
  );
  const billingRunId = billingRun.rows[0]!.id;
  const invoice = await owner.query<{ id: string }>(
    `insert into school_invoices (
       organisation_id, reference, billing_account_id, academic_year_id, billing_run_id, period_key,
       billing_period_start, billing_period_end, due_date, status, currency, created_by,
       calculation_snapshot, total_minor, outstanding_minor
     ) values ($1, $2, $3, $4, $5, $6, '2026-09-01', '2026-12-18', '2026-09-15', 'draft', 'GBP', $7,
               '{}'::jsonb, 250000, 250000) returning id`,
    [school.orgId, `KSW-INV-${tag}`, accountId, input.yearId, billingRunId, periodKey, school.adminId],
  );
  const invoiceId = invoice.rows[0]!.id;
  await owner.query(
    `insert into school_invoice_lines (
       organisation_id, invoice_id, sort_order, kind, student_profile_id, description,
       quantity, unit_amount_minor, amount_minor
     ) values ($1, $2, 0, 'tuition', $3, 'Autumn term tuition', 1, 250000, 250000)`,
    [school.orgId, invoiceId, input.pupilId],
  );
  await owner.query(
    `update school_invoices
        set status = 'issued', issued_at = now(), issued_by = $2
      where id = $1`,
    [invoiceId, school.adminId],
  );
  await owner.query(
    `insert into school_billing_run_items (
       organisation_id, billing_run_id, student_profile_id, billing_account_id,
       standard_amount_minor, net_amount_minor, currency, invoice_id
     ) values ($1, $2, $3, $4, 250000, 250000, 'GBP', $5)`,
    [school.orgId, billingRunId, input.pupilId, accountId, invoiceId],
  );

  const catchupPeriodKey = `${periodKey}:catchup:${input.pupilId}`;
  const catchup = await owner.query<{ id: string }>(
    `insert into school_invoices (
       organisation_id, reference, billing_account_id, academic_year_id, period_key,
       billing_period_start, billing_period_end, due_date, status, currency, created_by,
       calculation_snapshot, total_minor, outstanding_minor
     ) values ($1, $2, $3, $4, $5, '2026-10-01', '2026-12-18', '2026-10-15', 'draft', 'GBP', $6,
               $7::jsonb, 50000, 50000) returning id`,
    [
      school.orgId,
      `KSW-INV-CU-${tag}`,
      accountId,
      input.yearId,
      catchupPeriodKey,
      school.adminId,
      JSON.stringify({ source: "missing_catchup", catchupStudentProfileId: input.pupilId }),
    ],
  );
  const catchupInvoiceId = catchup.rows[0]!.id;
  await owner.query(
    `insert into school_invoice_lines (
       organisation_id, invoice_id, sort_order, kind, student_profile_id, description,
       quantity, unit_amount_minor, amount_minor
     ) values ($1, $2, 0, 'tuition', $3, 'Late-joiner catch-up', 1, 50000, 50000)`,
    [school.orgId, catchupInvoiceId, input.pupilId],
  );
  await owner.query(
    `update school_invoices
        set status = 'issued', issued_at = now(), issued_by = $2
      where id = $1`,
    [catchupInvoiceId, school.adminId],
  );

  const payment = await owner.query<{ id: string }>(
    `insert into school_payment_transactions (
       organisation_id, charge_id, invoice_id, reference, amount_minor, currency,
       channel, provider_key, provider_session_id, provider_payment_id, status, paid_at, metadata
     ) values ($1, null, $2, $3, 250000, 'GBP', 'provider', 'stripe', $4, $5, 'succeeded', now(),
               jsonb_build_object('livemode', false, 'mode', 'test')) returning id`,
    [school.orgId, invoiceId, `PAY-${tag}`, `cs_test_${tag}`, `pi_${tag}`],
  );
  const paymentId = payment.rows[0]!.id;
  await owner.query(
    `insert into school_payment_sessions (
       organisation_id, charge_id, invoice_id, transaction_id, provider_key, provider_session_id,
       amount_minor, currency, status, created_by, completed_at
     ) values ($1, null, $2, $3, 'stripe', $4, 250000, 'GBP', 'completed', $5, now())`,
    [school.orgId, invoiceId, paymentId, `cs_test_${tag}`, school.adminId],
  );
  const invoicePayment = await owner.query<{ id: string }>(
    `insert into school_invoice_payments (
       organisation_id, invoice_id, billing_account_id, reference, amount_minor, currency,
       method, external_reference, recorded_by, status
     ) values ($1, $2, $3, $4, 250000, 'GBP', 'card', $5, $6, 'succeeded') returning id`,
    [school.orgId, invoiceId, accountId, `IPAY-${tag}`, `pi_${tag}`, school.adminId],
  );
  const receipt = await owner.query<{ id: string }>(
    `insert into school_payment_receipts (
       organisation_id, charge_id, transaction_id, invoice_id, invoice_payment_id, reference, snapshot
     ) values ($1, null, $2, $3, $4, $5, '{}'::jsonb) returning id`,
    [school.orgId, paymentId, invoiceId, invoicePayment.rows[0]!.id, `KSW-RCT-${tag}`],
  );
  await owner.query(
    `update school_invoices
        set status = 'paid', paid_minor = 250000, outstanding_minor = 0
      where id = $1`,
    [invoiceId],
  );
  await owner.query(
    `insert into school_payment_provider_events (
       organisation_id, provider_key, event_id, event_type, status, charge_id, transaction_id, processed_at
     ) values
       ($1, 'stripe', $2, 'checkout.session.completed', 'processed', null, $5, now()),
       ($1, 'stripe', $3, 'payment_intent.succeeded', 'processing', null, $5, null),
       ($1, 'stripe', $4, 'charge.refunded', 'manual_review', null, $5, now())`,
    [school.orgId, `evt_processed_${tag}`, `evt_processing_${tag}`, `evt_review_${tag}`, paymentId],
  );
  await owner.query(
    `insert into school_invoice_credits (
       organisation_id, billing_account_id, invoice_id, reference, kind, amount_minor, currency,
       reason, created_by, provider_refund_id
     ) values ($1, $2, $3, $4, 'refund', 1000, 'GBP', 'Stripe TEST refund', $5, $6)`,
    [school.orgId, accountId, invoiceId, `CRN-${tag}`, school.adminId, `re_${tag}`],
  );
  await owner.query(
    `insert into mail_outbox (
       organisation_id, purpose, template_key, to_email, subject, body_text, status, idempotency_key
     ) values
       ($1, 'finance_invoice_issued', 'finance_invoice_issued', 'payer@example.com',
        'Invoice issued', 'Please pay', 'sent', $2),
       ($1, 'finance_payment_received', 'finance_payment_received', 'payer@example.com',
        'Payment received', 'Thank you', 'queued', $3)`,
    [school.orgId, `finance.invoice_issued:${invoiceId}`, `finance.payment_received:${paymentId}`],
  );
  await owner.query(
    `update school_finance_settings
        set automatic_invoice_email_enabled = true,
            invoice_prefix = 'KSW-INV',
            receipt_prefix = 'KSW-RCT',
            invoice_footer = 'Pay to the school bank'
      where organisation_id = $1`,
    [school.orgId],
  );
  const census = await owner.query<{ id: string }>(
    `insert into census_runs (
       organisation_id, academic_year_id, census_type, census_date, status, created_by
     ) values ($1, $2, 'autumn', '2026-10-01', 'draft', $3) returning id`,
    [school.orgId, input.yearId, school.adminId],
  );
  await owner.query(
    `insert into census_snapshot_schools (organisation_id, census_run_id, snapshot_version, statutory_name)
     values ($1, $2, 1, 'Kingswood School')`,
    [school.orgId, census.rows[0]!.id],
  );
  await owner.query(
    `insert into census_snapshot_pupils (
       organisation_id, census_run_id, snapshot_version, student_profile_id, legal_surname, legal_forename
     ) values ($1, $2, 1, $3, 'Pupil', 'Test')`,
    [school.orgId, census.rows[0]!.id, input.pupilId],
  );
  await owner.query(
    `insert into census_validation_issues (
       organisation_id, census_run_id, snapshot_version, source, rule_key, severity, entity_type, message
     ) values ($1, $2, 1, 'snapshot', 'name_required', 'warning', 'pupil', 'Check name')`,
    [school.orgId, census.rows[0]!.id],
  );
  await owner.query(`update census_runs set status = 'ready', finalised_at = now() where id = $1`, [
    census.rows[0]!.id,
  ]);
  const audit = await owner.query<{ id: string }>(
    `insert into audit_events (
       organisation_id, actor_user_id, action, entity_type, entity_id, after_data, priority
     ) values ($1, $2, 'finance.invoice.issued', 'school_invoice', $3, '{"reference":"historical"}'::jsonb, 'high')
     returning id`,
    [school.orgId, school.adminId, invoiceId],
  );
  return {
    invoiceId,
    catchupInvoiceId,
    paymentId,
    receiptId: receipt.rows[0]!.id,
    billingRunId,
    historicalAuditId: audit.rows[0]!.id,
  };
}

describe("Platform Admin operational data reset", () => {
  const pools = testPools();
  const mail = new FakeEmailProvider();
  let stripeCalls = 0;
  const app = testApp(pools, {
    emailDeliveryProvider: mail,
    stripeFetchImpl: async () => {
      stripeCalls += 1;
      return new Response("{}", { status: 200 });
    },
  });

  beforeAll(async () => {
    await ensureMigrated();
    expect(await assertOperationalResetPlanCoversSchema(pools.owner)).toEqual([]);
  });

  afterAll(async () => {
    await closePools(pools);
  });

  async function platformHeaders(id: string) {
    const email = `platform-${id}@example.com`;
    await insertUser(pools.owner, {
      email,
      password: "platform-pass-1",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    const token = await login(app, email, "platform-pass-1");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  function schoolHost(slug: string): Record<string, string> {
    return { Host: `${slug}.localhost` };
  }

  it("rejects school admin, teacher, parent and student, and blocks the school host", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    const parentId = await insertUser(pools.owner, {
      email: `parent-${id}@example.com`,
      password: "password-12x",
      fullName: "Parent",
      kind: "parent",
    });
    await addMembership(pools.owner, school.orgId, parentId, "school.parent");
    const studentId = await insertUser(pools.owner, {
      email: `student-${id}@example.com`,
      password: "password-12x",
      fullName: "Student",
      kind: "student",
    });
    await addMembership(pools.owner, school.orgId, studentId, "school.student");

    const path = `/api/v1/platform/organisations/${school.orgId}/operational-reset`;
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const teacherToken = await login(app, `teacher-${id}@example.com`, "password-12x");
    const parentToken = await login(app, `parent-${id}@example.com`, "password-12x");
    const studentToken = await (async () => {
      const session = await pools.owner.query<{ id: string }>(
        `insert into auth_sessions (user_id, refresh_token_hash, expires_at)
         values ($1, 'test-session', now() + interval '1 day') returning id`,
        [studentId],
      );
      return signAccessToken(TEST_AUTH_SECRET, { sub: studentId, sid: session.rows[0]!.id }, 3600);
    })();

    const schoolAdminSchoolHost = await app.request(path, {
      headers: { Authorization: `Bearer ${adminToken}`, ...schoolHost(school.slug) },
    });
    expect(schoolAdminSchoolHost.status).toBe(404);

    const schoolAdminPlatform = await app.request(path, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(schoolAdminPlatform.status).toBe(403);

    expect(
      (
        await app.request(path, {
          headers: { Authorization: `Bearer ${teacherToken}` },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(path, {
          headers: { Authorization: `Bearer ${parentToken}` },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(path, {
          headers: { Authorization: `Bearer ${studentToken}` },
        })
      ).status,
    ).toBe(403);

    const platform = await platformHeaders(id);
    const platformOnSchool = await app.request(path, {
      headers: { ...platform, ...schoolHost(school.slug) },
    });
    expect(platformOnSchool.status).toBe(404);
  });

  it("previews without mutating, rejects bad confirmation, and resets A without touching B", { timeout: 60_000 }, async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, id, {
      adminEmail: `marketing-${id}@kingswoodschool.co.uk`,
      slug: `kingswood-${id}`,
      name: "Kingswood School",
    });
    const schoolB = await createSchool(pools.owner, `${id}b`, { slug: `riverside-${id}`, name: "Riverside School" });
    const secondAdminId = await insertUser(pools.owner, {
      email: `admin2-${id}@example.com`,
      password: "password-12x",
      fullName: "Second Admin",
      kind: "staff",
    });
    await addMembership(pools.owner, schoolA.orgId, secondAdminId, "school.admin");
    await pools.owner.query(
      "insert into staff_profiles (organisation_id, user_id, job_title) values ($1, $2, 'Deputy')",
      [schoolA.orgId, secondAdminId],
    );
    const teacherId = await insertUser(pools.owner, {
      email: `teacher-a-${id}@example.com`,
      password: "password-12x",
      fullName: "UAT Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, schoolA.orgId, teacherId, "school.teacher");
    await pools.owner.query(
      "insert into staff_profiles (organisation_id, user_id, job_title) values ($1, $2, 'Teacher')",
      [schoolA.orgId, teacherId],
    );
    const sharedParentId = await insertUser(pools.owner, {
      email: `shared-${id}@example.com`,
      password: "password-12x",
      fullName: "Shared Parent",
      kind: "parent",
    });
    await addMembership(pools.owner, schoolA.orgId, sharedParentId, "school.parent");
    await addMembership(pools.owner, schoolB.orgId, sharedParentId, "school.parent");
    const studentId = await insertUser(pools.owner, {
      email: `pupil-a-${id}@example.com`,
      password: "password-12x",
      fullName: "Pupil A",
      kind: "student",
    });
    await addMembership(pools.owner, schoolA.orgId, studentId, "school.student");

    await seedOperational(pools.owner, schoolA, {
      teacherId,
      parentId: sharedParentId,
      studentUserId: studentId,
      secondAdminId,
    });
    await seedOperational(pools.owner, schoolB, { parentId: sharedParentId });
    const beforeB = await fingerprint(pools.owner, schoolB.orgId);
    const beforeAPupils = await count(pools.owner, "student_profiles", schoolA.orgId);
    expect(beforeAPupils).toBeGreaterThan(0);

    const platform = await platformHeaders(id);
    const previewPath = `/api/v1/platform/organisations/${schoolA.orgId}/operational-reset`;
    const beforePreview = await fingerprint(pools.owner, schoolA.orgId);
    const previewRes = await app.request(previewPath, { headers: platform });
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as {
      schoolAdminsPreserved: Array<{ email: string | null }>;
      counts: Record<string, number>;
      liveFinancialResetBlocked: boolean;
      organisation: { slug: string };
    };
    expect(await fingerprint(pools.owner, schoolA.orgId)).toBe(beforePreview);
    expect(preview.counts.pupils).toBe(beforeAPupils);
    expect(preview.liveFinancialResetBlocked).toBe(false);
    expect(preview.schoolAdminsPreserved.map((row) => row.email)).toEqual(
      expect.arrayContaining([`marketing-${id}@kingswoodschool.co.uk`, `admin2-${id}@example.com`]),
    );

    const missingBackup = await app.request(previewPath, {
      method: "POST",
      headers: platform,
      body: JSON.stringify({
        confirmationText: schoolA.slug,
        backupConfirmed: false,
        understandPermanent: true,
        resetMode: "operational_reset_v1",
      }),
    });
    expect(missingBackup.status).toBe(400);

    const missingUnderstand = await app.request(previewPath, {
      method: "POST",
      headers: platform,
      body: JSON.stringify({
        confirmationText: schoolA.slug,
        backupConfirmed: true,
        understandPermanent: false,
        resetMode: "operational_reset_v1",
      }),
    });
    expect(missingUnderstand.status).toBe(400);

    const wrongConfirm = await app.request(previewPath, {
      method: "POST",
      headers: platform,
      body: JSON.stringify({
        confirmationText: "riverside",
        backupConfirmed: true,
        understandPermanent: true,
        resetMode: "operational_reset_v1",
      }),
    });
    expect(wrongConfirm.status).toBe(400);
    expect(await count(pools.owner, "student_profiles", schoolA.orgId)).toBe(beforeAPupils);

    const sentBefore = mail.sent.length;
    const stripeBefore = stripeCalls;
    const resetRes = await app.request(previewPath, {
      method: "POST",
      headers: platform,
      body: JSON.stringify({
        confirmationText: "kingswood school",
        backupConfirmed: true,
        understandPermanent: true,
        resetMode: "operational_reset_v1",
      }),
    });
    expect(resetRes.status).toBe(200);
    const resetBody = (await resetRes.json()) as {
      verification: Record<string, boolean>;
      schoolAdminsPreserved: Array<{ email: string | null }>;
      counts: Record<string, number>;
      deletedCounts: Record<string, number>;
    };
    expect(Object.values(resetBody.verification).every(Boolean)).toBe(true);
    expect(resetBody.counts.pupils).toBe(0);
    expect(resetBody.deletedCounts.pupils).toBe(beforeAPupils);
    expect(mail.sent.length).toBe(sentBefore);
    expect(stripeCalls).toBe(stripeBefore);

    expect(await count(pools.owner, "student_profiles", schoolA.orgId)).toBe(0);
    expect(await count(pools.owner, "guardianships", schoolA.orgId)).toBe(0);
    expect(await count(pools.owner, "admissions_enquiries", schoolA.orgId)).toBe(0);
    expect(await count(pools.owner, "admissions_applications", schoolA.orgId)).toBe(0);
    expect(await count(pools.owner, "academic_years", schoolA.orgId)).toBe(0);
    expect(await count(pools.owner, "attendance_marks", schoolA.orgId)).toBe(0);
    expect(await count(pools.owner, "learning_assignments", schoolA.orgId)).toBe(0);
    expect(await count(pools.owner, "safeguarding_concerns", schoolA.orgId)).toBe(0);
    expect(await count(pools.owner, "school_invoices", schoolA.orgId)).toBe(0);
    expect(await count(pools.owner, "school_payment_transactions", schoolA.orgId)).toBe(0);
    expect(await count(pools.owner, "school_payment_receipts", schoolA.orgId)).toBe(0);
    expect(await count(pools.owner, "mail_outbox", schoolA.orgId)).toBe(0);
    expect(await count(pools.owner, "timetable_entries", schoolA.orgId)).toBe(0);
    expect(await count(pools.owner, "announcements", schoolA.orgId)).toBe(0);

    const orgA = await pools.owner.query(`select id, slug, name, legal_name, status from organisations where id = $1`, [
      schoolA.orgId,
    ]);
    expect(orgA.rows[0]).toMatchObject({
      id: schoolA.orgId,
      slug: schoolA.slug,
      name: "Kingswood School",
      status: "active",
    });
    const logo = await pools.owner.query(
      `select logo_object_id from organisation_settings where organisation_id = $1`,
      [schoolA.orgId],
    );
    expect(logo.rows[0]?.logo_object_id).toBeTruthy();
    const brandingLeft = await pools.owner.query(
      `select domain, status from stored_objects where organisation_id = $1`,
      [schoolA.orgId],
    );
    expect(brandingLeft.rows.every((row) => row.domain === "branding")).toBe(true);
    expect(await testObjectStorage.objectExists(`org/${schoolA.orgId}/uat-file`)).toBe(false);

    const adminUser = await pools.owner.query(
      `select u.id, u.email, u.status, m.status as membership_status, r.key
         from users u
         join organisation_memberships m on m.user_id = u.id
         join membership_roles mr on mr.membership_id = m.id
         join roles r on r.id = mr.role_id
        where m.organisation_id = $1 and u.email = $2`,
      [schoolA.orgId, `marketing-${id}@kingswoodschool.co.uk`],
    );
    expect(adminUser.rows[0]).toMatchObject({
      status: "active",
      membership_status: "active",
      key: "school.admin",
    });
    const second = await pools.owner.query(
      `select 1 from organisation_memberships m
         join membership_roles mr on mr.membership_id = m.id
         join roles r on r.id = mr.role_id
        where m.organisation_id = $1 and m.user_id = $2 and r.key = 'school.admin'`,
      [schoolA.orgId, secondAdminId],
    );
    expect(second.rowCount).toBe(1);

    const teacherMembership = await pools.owner.query(
      `select 1 from organisation_memberships where organisation_id = $1 and user_id = $2`,
      [schoolA.orgId, teacherId],
    );
    expect(teacherMembership.rowCount).toBe(0);
    const teacherUser = await pools.owner.query(`select status from users where id = $1`, [teacherId]);
    expect(teacherUser.rows[0]?.status).toBe("active");

    const shared = await pools.owner.query(
      `select m.organisation_id, u.status
         from organisation_memberships m
         join users u on u.id = m.user_id
        where u.id = $1
        order by m.organisation_id`,
      [sharedParentId],
    );
    expect(shared.rows).toHaveLength(1);
    expect(shared.rows[0]?.organisation_id).toBe(schoolB.orgId);
    expect(shared.rows[0]?.status).toBe("active");

    const stripeConfig = await pools.owner.query(
      `select mode, secret_ref from school_payment_provider_configs where organisation_id = $1`,
      [schoolA.orgId],
    );
    expect(stripeConfig.rows[0]).toMatchObject({ mode: "test", secret_ref: "encrypted:v1" });
    const footer = await pools.owner.query(
      `select invoice_footer from school_finance_settings where organisation_id = $1`,
      [schoolA.orgId],
    );
    expect(footer.rows[0]?.invoice_footer).toBe("Pay to the school bank");
    const template = await pools.owner.query(
      `select subject from organisation_transactional_email_templates where organisation_id = $1`,
      [schoolA.orgId],
    );
    expect(template.rowCount).toBeGreaterThan(0);
    const setup = await pools.owner.query<{ completed_steps: string[]; current_step: string; completed_at: Date | null }>(
      `select completed_steps, current_step, completed_at from organisation_setup_progress where organisation_id = $1`,
      [schoolA.orgId],
    );
    expect(setup.rows[0]?.completed_at).toBeNull();
    expect(setup.rows[0]?.completed_steps).toEqual(expect.arrayContaining(["school_details", "branding"]));
    expect(setup.rows[0]?.completed_steps).not.toContain("academic_year");

    const audit = await pools.owner.query<{ action: string; after_data: Record<string, unknown> }>(
      `select action, after_data from audit_events
        where organisation_id = $1 and action = 'platform.organisation.operational_reset'
        order by occurred_at desc limit 1`,
      [schoolA.orgId],
    );
    expect(audit.rows[0]?.action).toBe("platform.organisation.operational_reset");
    expect(Number((audit.rows[0]?.after_data as { deletedCounts?: { pupils?: number } }).deletedCounts?.pupils)).toBeGreaterThan(0);
    expect(JSON.stringify(audit.rows[0]?.after_data)).not.toContain("UAT safeguarding");
    expect(JSON.stringify(audit.rows[0]?.after_data)).not.toContain("encrypted");

    expect(await fingerprint(pools.owner, schoolB.orgId)).toBe(beforeB);
    expect(await count(pools.owner, "student_profiles", schoolB.orgId)).toBeGreaterThan(0);
    expect(await count(pools.owner, "school_invoices", schoolB.orgId)).toBeGreaterThan(0);
    expect(await count(pools.owner, "admissions_enquiries", schoolB.orgId)).toBeGreaterThan(0);
    expect(await count(pools.owner, "mail_outbox", schoolB.orgId)).toBeGreaterThan(0);

    const adminLogin = await login(app, `marketing-${id}@kingswoodschool.co.uk`, "password-12x");
    expect(adminLogin).toBeTruthy();

    const secondReset = await app.request(previewPath, {
      method: "POST",
      headers: platform,
      body: JSON.stringify({
        confirmationText: schoolA.slug,
        backupConfirmed: true,
        understandPermanent: true,
        resetMode: "operational_reset_v1",
      }),
    });
    expect(secondReset.status).toBe(200);
    const secondBody = (await secondReset.json()) as { alreadyClean: boolean; counts: { pupils: number } };
    expect(secondBody.alreadyClean).toBe(true);
    expect(secondBody.counts.pupils).toBe(0);
    expect(await fingerprint(pools.owner, schoolB.orgId)).toBe(beforeB);
  });

  it("blocks live Stripe tenants and rolls back when the database write fails", { timeout: 60_000 }, async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    await seedOperational(pools.owner, school);
    await pools.owner.query(
      `insert into school_payment_provider_configs (organisation_id, provider_key, secret_ref, mode, is_active)
       values ($1, 'stripe', 'encrypted:v1', 'live', true)
       on conflict (organisation_id, provider_key) do update set mode = 'live'`,
      [school.orgId],
    );
    const platform = await platformHeaders(id);
    const live = await app.request(`/api/v1/platform/organisations/${school.orgId}/operational-reset`, {
      method: "POST",
      headers: platform,
      body: JSON.stringify({
        confirmationText: school.slug,
        backupConfirmed: true,
        understandPermanent: true,
        resetMode: "operational_reset_v1",
      }),
    });
    expect(live.status).toBe(409);
    expect(await count(pools.owner, "student_profiles", school.orgId)).toBeGreaterThan(0);

    const school2 = await createSchool(pools.owner, `${id}r`);
    await seedOperational(pools.owner, school2);
    const pupilsBefore = await count(pools.owner, "student_profiles", school2.orgId);
    await expect(
      executeOperationalReset({
        owner: pools.owner,
        storage: testObjectStorage,
        actorUserId: (
          await pools.owner.query<{ id: string }>("select id from users where email = $1", [
            `platform-${id}@example.com`,
          ])
        ).rows[0]!.id,
        organisationId: school2.orgId,
        confirmationText: school2.slug,
        backupConfirmed: true,
        understandPermanent: true,
        resetMode: "operational_reset_v1",
        testOnlyFailBeforeCommit: true,
      }),
    ).rejects.toThrow(/Injected failure/);
    expect(await count(pools.owner, "student_profiles", school2.orgId)).toBe(pupilsBefore);
  });

  it("blocks reset while mail is sending and does not target missing organisations", { timeout: 60_000 }, async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    await seedOperational(pools.owner, school);
    await pools.owner.query(
      `update mail_outbox set status = 'sending' where organisation_id = $1`,
      [school.orgId],
    );
    const platform = await platformHeaders(id);
    const sending = await app.request(`/api/v1/platform/organisations/${school.orgId}/operational-reset`, {
      method: "POST",
      headers: platform,
      body: JSON.stringify({
        confirmationText: school.slug,
        backupConfirmed: true,
        understandPermanent: true,
        resetMode: "operational_reset_v1",
      }),
    });
    expect(sending.status).toBe(409);
    expect(await count(pools.owner, "student_profiles", school.orgId)).toBeGreaterThan(0);

    const missing = await app.request(`/api/v1/platform/organisations/${randomUUID()}/operational-reset`, {
      headers: platform,
    });
    expect(missing.status).toBe(404);
    const badId = await app.request(`/api/v1/platform/organisations/not-a-uuid/operational-reset`, {
      headers: platform,
    });
    expect(badId.status).toBe(404);
  });

  it("does not revoke another school's sessions and treats leftover invitations as not clean", { timeout: 60_000 }, async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, id);
    const schoolB = await createSchool(pools.owner, `${id}b`);
    const leftoverOnly = await createSchool(pools.owner, `${id}c`);
    await pools.owner.query(
      `insert into invitations (organisation_id, email, intended_role_keys, token_hash, expires_at)
       values ($1, $2, '{school.teacher}', $3, now() + interval '7 days')`,
      [leftoverOnly.orgId, `left-${id}@example.com`, `left-${id}`],
    );
    await pools.owner.query(
      `insert into data_imports (organisation_id, kind, original_filename, created_by)
       values ($1, 'pupils', 'uat.csv', $2)`,
      [leftoverOnly.orgId, leftoverOnly.adminId],
    );

    const teacherA = await insertUser(pools.owner, {
      email: `teacher-only-a-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher A",
      kind: "staff",
    });
    await addMembership(pools.owner, schoolA.orgId, teacherA, "school.teacher");
    const teacherASession = await pools.owner.query<{ id: string }>(
      `insert into auth_sessions (user_id, refresh_token_hash, expires_at)
       values ($1, $2, now() + interval '1 day') returning id`,
      [teacherA, `a-session-${id}`],
    );

    const suspendedB = await insertUser(pools.owner, {
      email: `suspended-b-${id}@example.com`,
      password: "password-12x",
      fullName: "Suspended B",
      kind: "staff",
    });
    await addMembership(pools.owner, schoolB.orgId, suspendedB, "school.teacher");
    await pools.owner.query(
      `update organisation_memberships set status = 'suspended' where organisation_id = $1 and user_id = $2`,
      [schoolB.orgId, suspendedB],
    );
    const suspendedBSession = await pools.owner.query<{ id: string }>(
      `insert into auth_sessions (user_id, refresh_token_hash, expires_at)
       values ($1, $2, now() + interval '1 day') returning id`,
      [suspendedB, `b-session-${id}`],
    );

    const platform = await platformHeaders(`${id}s`);
    const leftoverPreview = await app.request(`/api/v1/platform/organisations/${leftoverOnly.orgId}/operational-reset`, {
      headers: platform,
    });
    expect(leftoverPreview.status).toBe(200);
    const leftoverBody = (await leftoverPreview.json()) as {
      alreadyClean: boolean;
      remainingOperationalRows: number;
      counts: { invitations: number; dataImports: number; pupils: number };
    };
    expect(leftoverBody.counts.pupils).toBe(0);
    expect(leftoverBody.counts.invitations).toBe(1);
    expect(leftoverBody.counts.dataImports).toBe(1);
    expect(leftoverBody.remainingOperationalRows).toBeGreaterThan(0);
    expect(leftoverBody.alreadyClean).toBe(false);

    const resetA = await app.request(`/api/v1/platform/organisations/${schoolA.orgId}/operational-reset`, {
      method: "POST",
      headers: platform,
      body: JSON.stringify({
        confirmationText: schoolA.slug,
        backupConfirmed: true,
        understandPermanent: true,
        resetMode: "operational_reset_v1",
      }),
    });
    expect(resetA.status).toBe(200);

    const teacherAAfter = await pools.owner.query<{ revoked_at: Date | null }>(
      `select revoked_at from auth_sessions where id = $1`,
      [teacherASession.rows[0]!.id],
    );
    expect(teacherAAfter.rows[0]?.revoked_at).not.toBeNull();
    const suspendedBAfter = await pools.owner.query<{ revoked_at: Date | null }>(
      `select revoked_at from auth_sessions where id = $1`,
      [suspendedBSession.rows[0]!.id],
    );
    expect(suspendedBAfter.rows[0]?.revoked_at).toBeNull();
    expect(await count(pools.owner, "invitations", leftoverOnly.orgId)).toBe(1);
    expect(await count(pools.owner, "data_imports", leftoverOnly.orgId)).toBe(1);
  });

  it("resets a TEST Stripe school and never calls Stripe, but blocks live payment evidence", { timeout: 60_000 }, async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    await seedOperational(pools.owner, school);
    await pools.owner.query(
      `insert into school_payment_provider_configs (organisation_id, provider_key, secret_ref, mode, is_active)
       values ($1, 'stripe', 'encrypted:v1', 'test', true)
       on conflict (organisation_id, provider_key) do update set mode = 'test', is_active = true`,
      [school.orgId],
    );
    const platform = await platformHeaders(`${id}t`);
    const beforeCalls = stripeCalls;
    const reset = await app.request(`/api/v1/platform/organisations/${school.orgId}/operational-reset`, {
      method: "POST",
      headers: platform,
      body: JSON.stringify({
        confirmationText: school.slug,
        backupConfirmed: true,
        understandPermanent: true,
        resetMode: "operational_reset_v1",
      }),
    });
    expect(reset.status).toBe(200);
    expect(stripeCalls).toBe(beforeCalls);
    expect(await count(pools.owner, "student_profiles", school.orgId)).toBe(0);
    expect(await count(pools.owner, "school_invoices", school.orgId)).toBe(0);
    expect(await count(pools.owner, "school_payment_receipts", school.orgId)).toBe(0);
    expect(await count(pools.owner, "school_payment_provider_events", school.orgId)).toBe(0);
    const preserved = await pools.owner.query<{ mode: string; secret_ref: string; is_active: boolean }>(
      `select mode, secret_ref, is_active from school_payment_provider_configs where organisation_id = $1`,
      [school.orgId],
    );
    expect(preserved.rows[0]).toMatchObject({ mode: "test", secret_ref: "encrypted:v1", is_active: true });

    const evidence = await createSchool(pools.owner, `${id}e`);
    await seedOperational(pools.owner, evidence);
    await pools.owner.query(
      `insert into school_payment_provider_configs (organisation_id, provider_key, secret_ref, mode, is_active)
       values ($1, 'stripe', 'encrypted:v1', 'test', true)
       on conflict (organisation_id, provider_key) do update set mode = 'test', is_active = true`,
      [evidence.orgId],
    );
    await pools.owner.query(
      `update school_payment_transactions
          set metadata = jsonb_build_object('livemode', 'true', 'mode', 'live')
        where organisation_id = $1`,
      [evidence.orgId],
    );
    const blocked = await app.request(`/api/v1/platform/organisations/${evidence.orgId}/operational-reset`, {
      method: "POST",
      headers: platform,
      body: JSON.stringify({
        confirmationText: evidence.slug,
        backupConfirmed: true,
        understandPermanent: true,
        resetMode: "operational_reset_v1",
      }),
    });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("live_financial_reset_blocked");
    expect(stripeCalls).toBe(beforeCalls);
  });

  it("resets a Kingswood-like issued invoice, Stripe TEST payment, and 0065–0067 records", { timeout: 60_000 }, async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, {
      slug: `kingswood-${id}`,
      name: "Kingswood School",
      adminEmail: `marketing-${id}@kingswoodschool.co.uk`,
    });
    const seeded = await seedOperational(pools.owner, school);
    const finance = await seedIssuedFinanceLifecycle(pools.owner, school, {
      yearId: seeded.yearId,
      pupilId: seeded.pupilId,
    });
    expect(await count(pools.owner, "school_invoice_lines", school.orgId)).toBeGreaterThan(0);
    expect(await count(pools.owner, "school_invoice_payments", school.orgId)).toBeGreaterThan(0);
    expect(await count(pools.owner, "school_invoice_credits", school.orgId)).toBeGreaterThan(0);
    expect(await count(pools.owner, "school_billing_runs", school.orgId)).toBeGreaterThan(0);
    expect(await count(pools.owner, "school_payment_sessions", school.orgId)).toBeGreaterThan(0);
    expect(await count(pools.owner, "census_snapshot_pupils", school.orgId)).toBeGreaterThan(0);

    const platform = await platformHeaders(`${id}kw`);
    const path = `/api/v1/platform/organisations/${school.orgId}/operational-reset`;
    const preview = await app.request(path, { headers: platform });
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as {
      liveFinancialResetBlocked: boolean;
      counts: { invoices: number; payments: number; receipts: number; mailOutbox: number };
      organisation: { slug: string; name: string };
    };
    expect(previewBody.liveFinancialResetBlocked).toBe(false);
    expect(previewBody.counts.invoices).toBeGreaterThan(1);
    expect(previewBody.counts.payments).toBeGreaterThan(0);
    expect(previewBody.counts.receipts).toBeGreaterThan(0);
    expect(previewBody.counts.mailOutbox).toBeGreaterThan(0);

    const pupilsBefore = await count(pools.owner, "student_profiles", school.orgId);
    const invoicesBefore = await count(pools.owner, "school_invoices", school.orgId);
    await expect(
      executeOperationalReset({
        owner: pools.owner,
        storage: testObjectStorage,
        actorUserId: (
          await pools.owner.query<{ id: string }>("select id from users where email = $1", [
            `platform-${id}kw@example.com`,
          ])
        ).rows[0]!.id,
        organisationId: school.orgId,
        confirmationText: "Kingswood School",
        backupConfirmed: true,
        understandPermanent: true,
        resetMode: "operational_reset_v1",
        testOnlyFailBeforeCommit: true,
      }),
    ).rejects.toMatchObject({ code: "injected_failure" });
    expect(await count(pools.owner, "student_profiles", school.orgId)).toBe(pupilsBefore);
    expect(await count(pools.owner, "school_invoices", school.orgId)).toBe(invoicesBefore);
    expect(await count(pools.owner, "school_invoice_lines", school.orgId)).toBeGreaterThan(0);
    expect(
      (
        await pools.owner.query(`select 1 from school_invoices where id = $1`, [finance.invoiceId])
      ).rowCount,
    ).toBe(1);

    const sentBefore = mail.sent.length;
    const stripeBefore = stripeCalls;
    const reset = await app.request(path, {
      method: "POST",
      headers: platform,
      body: JSON.stringify({
        confirmationText: "kingswood school",
        backupConfirmed: true,
        understandPermanent: true,
        resetMode: "operational_reset_v1",
      }),
    });
    expect(reset.status).toBe(200);
    expect(mail.sent.length).toBe(sentBefore);
    expect(stripeCalls).toBe(stripeBefore);

    expect(await count(pools.owner, "student_profiles", school.orgId)).toBe(0);
    expect(await count(pools.owner, "school_invoices", school.orgId)).toBe(0);
    expect(await count(pools.owner, "school_invoice_lines", school.orgId)).toBe(0);
    expect(await count(pools.owner, "school_invoice_payments", school.orgId)).toBe(0);
    expect(await count(pools.owner, "school_invoice_credits", school.orgId)).toBe(0);
    expect(await count(pools.owner, "school_billing_runs", school.orgId)).toBe(0);
    expect(await count(pools.owner, "school_billing_run_items", school.orgId)).toBe(0);
    expect(await count(pools.owner, "school_payment_transactions", school.orgId)).toBe(0);
    expect(await count(pools.owner, "school_payment_sessions", school.orgId)).toBe(0);
    expect(await count(pools.owner, "school_payment_receipts", school.orgId)).toBe(0);
    expect(await count(pools.owner, "school_payment_provider_events", school.orgId)).toBe(0);
    expect(await count(pools.owner, "mail_outbox", school.orgId)).toBe(0);
    expect(await count(pools.owner, "census_runs", school.orgId)).toBe(0);
    expect(await count(pools.owner, "census_snapshot_pupils", school.orgId)).toBe(0);
    expect(await count(pools.owner, "census_snapshot_schools", school.orgId)).toBe(0);

    const org = await pools.owner.query(`select id, slug, name, status from organisations where id = $1`, [
      school.orgId,
    ]);
    expect(org.rows[0]).toMatchObject({
      id: school.orgId,
      slug: school.slug,
      name: "Kingswood School",
      status: "active",
    });
    const stripeConfig = await pools.owner.query(
      `select mode, secret_ref, is_active from school_payment_provider_configs where organisation_id = $1`,
      [school.orgId],
    );
    expect(stripeConfig.rows[0]).toMatchObject({ mode: "test", secret_ref: "encrypted:v1", is_active: true });
    const financeSettings = await pools.owner.query(
      `select automatic_invoice_email_enabled, invoice_prefix, receipt_prefix, invoice_footer, vat_enabled
         from school_finance_settings where organisation_id = $1`,
      [school.orgId],
    );
    expect(financeSettings.rows[0]).toMatchObject({
      automatic_invoice_email_enabled: true,
      invoice_prefix: "KSW-INV",
      receipt_prefix: "KSW-RCT",
      invoice_footer: "Pay to the school bank",
      vat_enabled: false,
    });
    const adminLogin = await login(app, `marketing-${id}@kingswoodschool.co.uk`, "password-12x");
    expect(adminLogin).toBeTruthy();
    const adminMembership = await pools.owner.query(
      `select m.status, r.key
         from organisation_memberships m
         join membership_roles mr on mr.membership_id = m.id
         join roles r on r.id = mr.role_id
        where m.organisation_id = $1 and m.user_id = $2`,
      [school.orgId, school.adminId],
    );
    expect(adminMembership.rows[0]).toMatchObject({ status: "active", key: "school.admin" });

    const historical = await pools.owner.query(
      `select action from audit_events where id = $1 and organisation_id = $2`,
      [finance.historicalAuditId, school.orgId],
    );
    expect(historical.rows[0]?.action).toBe("finance.invoice.issued");
    const resetAudit = await pools.owner.query(
      `select action from audit_events
        where organisation_id = $1 and action = 'platform.organisation.operational_reset'`,
      [school.orgId],
    );
    expect(resetAudit.rowCount).toBe(1);

    const second = await app.request(path, {
      method: "POST",
      headers: platform,
      body: JSON.stringify({
        confirmationText: school.slug,
        backupConfirmed: true,
        understandPermanent: true,
        resetMode: "operational_reset_v1",
      }),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { alreadyClean: boolean };
    expect(secondBody.alreadyClean).toBe(true);
    expect(stripeCalls).toBe(stripeBefore);
    expect(await count(pools.owner, "school_invoices", school.orgId)).toBe(0);
    expect(
      (
        await pools.owner.query(
          `select mode from school_payment_provider_configs where organisation_id = $1`,
          [school.orgId],
        )
      ).rows[0]?.mode,
    ).toBe("test");
  });
});
