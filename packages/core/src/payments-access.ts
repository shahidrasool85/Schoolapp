import type pg from "pg";
import { PERMISSIONS, type Actor } from "@schoolapp/domain";
import { writeAudit } from "./academic.js";
import { createInboxNotification } from "./admissions.js";
import { AppError } from "./errors.js";
import {
  assertNonNegativeMinor,
  assertPositiveMinor,
  assertSameCurrency,
  formatMoney,
  isIsoCurrency,
  outstandingMinor,
  redactProviderReference,
} from "./money.js";
import { assertAnyPermission, assertPermission, notFound } from "./permissions.js";
import {
  chargeBalance,
  chargeIsPayable,
  deriveChargeStatus,
  financeUserError,
  operationalPaymentStatus,
  paymentNotificationBody,
  shouldCancelActivityCharge,
  shouldGenerateActivityCharge,
  type ChargeBalance,
} from "./payments.js";
import type { PaymentProvider, ProviderEvent } from "./payment-provider.js";
import { requireLinkedChild } from "./portal.js";
import { guardianChildIds } from "./students-access.js";

export const FINANCE_READ_PERMISSIONS = [
  PERMISSIONS.FINANCE_CHARGES_READ,
  PERMISSIONS.FINANCE_TRANSACTIONS_READ,
  PERMISSIONS.FINANCE_REPORTS_READ,
] as const;

export const FINANCE_MANAGE_PERMISSIONS = [
  PERMISSIONS.FINANCE_CHARGES_MANAGE,
  PERMISSIONS.FINANCE_PAYMENTS_RECORD_OFFLINE,
  PERMISSIONS.FINANCE_REFUNDS_MANAGE,
  PERMISSIONS.FINANCE_ADJUSTMENTS_MANAGE,
] as const;

export function canReadSchoolFinance(actor: Actor): boolean {
  return FINANCE_READ_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canManageCharges(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.FINANCE_CHARGES_MANAGE);
}

export function canRecordOffline(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.FINANCE_PAYMENTS_RECORD_OFFLINE);
}

export function canManageRefunds(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.FINANCE_REFUNDS_MANAGE);
}

export function canManageAdjustments(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.FINANCE_ADJUSTMENTS_MANAGE);
}

export function canReadFinanceReports(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.FINANCE_REPORTS_READ);
}

export function canReadOwnChildrenFinance(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.FINANCE_READ_OWN_CHILDREN);
}

export function throwFinance(code: string): never {
  const error = financeUserError(code);
  throw new AppError(error.status, error.code, error.message);
}

export async function loadOrgCurrency(client: pg.PoolClient, organisationId: string): Promise<string> {
  const row = await client.query<{ default_currency: string }>(
    "select default_currency from organisation_settings where organisation_id = $1",
    [organisationId],
  );
  const currency = row.rows[0]?.default_currency ?? "GBP";
  if (!isIsoCurrency(currency)) return "GBP";
  return currency;
}

export async function nextFinanceReference(
  client: pg.PoolClient,
  organisationId: string,
  kind: "charge" | "payment" | "receipt" | "refund" | "adjustment",
): Promise<string> {
  const result = await client.query<{ next_finance_reference: string }>(
    "select next_finance_reference($1, $2)",
    [organisationId, kind],
  );
  return result.rows[0]!.next_finance_reference;
}

export async function loadCategoryId(
  client: pg.PoolClient,
  organisationId: string,
  input: { categoryId?: string; categoryKey?: string },
): Promise<string> {
  if (input.categoryId) {
    const row = await client.query<{ id: string }>(
      "select id from school_charge_categories where id = $1 and organisation_id = $2",
      [input.categoryId, organisationId],
    );
    if (!row.rows[0]) notFound();
    return row.rows[0].id;
  }
  const key = input.categoryKey ?? "other";
  const row = await client.query<{ id: string }>(
    "select id from school_charge_categories where organisation_id = $1 and key = $2 and is_active",
    [organisationId, key],
  );
  if (!row.rows[0]) notFound();
  return row.rows[0].id;
}

export async function lockCharge(
  client: pg.PoolClient,
  organisationId: string,
  chargeId: string,
): Promise<Record<string, unknown>> {
  const row = await client.query(
    `select * from school_charges where id = $1 and organisation_id = $2 for update`,
    [chargeId, organisationId],
  );
  if (!row.rows[0]) notFound();
  return row.rows[0] as Record<string, unknown>;
}

export async function loadChargeTotals(
  client: pg.PoolClient,
  organisationId: string,
  chargeId: string,
): Promise<{ grossPaidMinor: number; refundedMinor: number }> {
  const paid = await client.query<{ paid: string; refunded: string }>(
    `select
       coalesce(sum(amount_minor) filter (where status in ('succeeded', 'partially_refunded', 'refunded')), 0)::text as paid,
       coalesce(sum(refunded_amount_minor) filter (where status in ('succeeded', 'partially_refunded', 'refunded')), 0)::text as refunded
     from school_payment_transactions
     where charge_id = $1 and organisation_id = $2`,
    [chargeId, organisationId],
  );
  return {
    grossPaidMinor: Number(paid.rows[0]?.paid ?? 0),
    refundedMinor: Number(paid.rows[0]?.refunded ?? 0),
  };
}

export async function chargeBalanceFor(
  client: pg.PoolClient,
  charge: Record<string, unknown>,
): Promise<ChargeBalance> {
  const totals = await loadChargeTotals(client, String(charge.organisation_id), String(charge.id));
  return chargeBalance({
    originalAmountMinor: Number(charge.original_amount_minor),
    amountDueMinor: Number(charge.amount_due_minor),
    grossPaidMinor: totals.grossPaidMinor,
    refundedMinor: totals.refundedMinor,
  });
}

export async function refreshChargeStatus(
  client: pg.PoolClient,
  charge: Record<string, unknown>,
): Promise<string> {
  const balance = await chargeBalanceFor(client, charge);
  const next = deriveChargeStatus({
    current: String(charge.status) as never,
    amountDueMinor: balance.amountDueMinor,
    netPaidMinor: balance.netPaidMinor,
    refundedMinor: balance.refundedMinor,
  });
  if (next !== charge.status) {
    await client.query("update school_charges set status = $3 where id = $1 and organisation_id = $2", [
      charge.id,
      charge.organisation_id,
      next,
    ]);
  }
  return next;
}

export async function auditFinance(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await writeAudit(client, input);
}

async function notifyFinance(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    type: Parameters<typeof paymentNotificationBody>[0];
    title: string;
    recipients: Array<{ userId: string }>;
    chargeId: string;
    studentProfileId?: string;
  },
): Promise<void> {
  const copy = paymentNotificationBody(input.type, input.title);
  for (const recipient of input.recipients) {
    await createInboxNotification(client, {
      organisationId: input.organisationId,
      recipientUserId: recipient.userId,
      actorUserId: input.actorUserId,
      type: input.type,
      category: "finance",
      title: copy.title,
      body: copy.body,
      actionTarget: { chargeId: input.chargeId, studentProfileId: input.studentProfileId ?? null },
      idempotencyKey: `${input.type}:${input.chargeId}:${recipient.userId}`,
    });
  }
}

async function parentRecipientsForStudent(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
): Promise<Array<{ userId: string }>> {
  const rows = await client.query<{ guardian_user_id: string }>(
    `select guardian_user_id
       from guardianships
      where organisation_id = $1
        and student_profile_id = $2
        and portal_access = true
        and (ended_on is null or ended_on >= current_date)`,
    [organisationId, studentProfileId],
  );
  return rows.rows.map((row) => ({ userId: row.guardian_user_id }));
}

export async function createCharge(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    title: string;
    description?: string | null;
    categoryId?: string;
    categoryKey?: string;
    studentProfileId: string;
    activityId?: string | null;
    academicYearId?: string | null;
    sourceKind?: "manual" | "activity" | "bulk" | "admissions";
    sourceId?: string | null;
    amountMinor: number;
    currency?: string | null;
    dueAt?: string | null;
    paymentRequired?: boolean;
    internalNote?: string | null;
    parentNote?: string | null;
    idempotencyKey?: string | null;
    issue?: boolean;
  },
): Promise<Record<string, unknown>> {
  assertPositiveMinor(input.amountMinor);
  const currency = input.currency ? input.currency.toUpperCase() : await loadOrgCurrency(client, input.organisationId);
  if (!isIsoCurrency(currency)) throwFinance("invalid_amount");
  if (input.idempotencyKey) {
    const existing = await client.query(
      `select * from school_charges where organisation_id = $1 and idempotency_key = $2`,
      [input.organisationId, input.idempotencyKey],
    );
    if (existing.rows[0]) return existing.rows[0] as Record<string, unknown>;
  }
  const student = await client.query(
    "select id from student_profiles where id = $1 and organisation_id = $2",
    [input.studentProfileId, input.organisationId],
  );
  if (!student.rows[0]) notFound();
  const categoryId = await loadCategoryId(client, input.organisationId, input);
  const reference = await nextFinanceReference(client, input.organisationId, "charge");
  const issued = input.issue !== false;
  const created = await client.query(
    `insert into school_charges (
       organisation_id, reference, title, description, category_id, student_profile_id,
       activity_id, academic_year_id, source_kind, source_id, original_amount_minor,
       amount_due_minor, currency, due_at, status, payment_required, internal_note,
       parent_note, idempotency_key, created_by, issued_by, issued_at
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
     ) returning *`,
    [
      input.organisationId,
      reference,
      input.title,
      input.description ?? null,
      categoryId,
      input.studentProfileId,
      input.activityId ?? null,
      input.academicYearId ?? null,
      input.sourceKind ?? "manual",
      input.sourceId ?? null,
      input.amountMinor,
      input.amountMinor,
      currency,
      input.dueAt ?? null,
      issued ? "issued" : "draft",
      input.paymentRequired ?? true,
      input.internalNote ?? null,
      input.parentNote ?? null,
      input.idempotencyKey ?? null,
      input.actorUserId,
      issued ? input.actorUserId : null,
      issued ? new Date().toISOString() : null,
    ],
  );
  const charge = created.rows[0] as Record<string, unknown>;
  await auditFinance(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: issued ? "finance.charge.issued" : "finance.charge.created",
    entityType: "school_charge",
    entityId: String(charge.id),
    after: { reference, status: charge.status, amountMinor: input.amountMinor, currency },
  });
  if (issued) {
    await notifyFinance(client, {
      organisationId: input.organisationId,
      actorUserId: input.actorUserId,
      type: input.activityId ? "payment_activity_required" : "payment_request",
      title: input.title,
      recipients: await parentRecipientsForStudent(client, input.organisationId, input.studentProfileId),
      chargeId: String(charge.id),
      studentProfileId: input.studentProfileId,
    });
  }
  return charge;
}

export async function issueCharge(
  client: pg.PoolClient,
  input: { organisationId: string; actorUserId: string; chargeId: string },
): Promise<Record<string, unknown>> {
  const charge = await lockCharge(client, input.organisationId, input.chargeId);
  if (charge.status !== "draft") {
    throw new AppError(409, "invalid_status_transition", "Only draft charges can be issued");
  }
  await client.query(
    `update school_charges
        set status = 'issued', issued_by = $3, issued_at = now()
      where id = $1 and organisation_id = $2`,
    [input.chargeId, input.organisationId, input.actorUserId],
  );
  await auditFinance(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.charge.issued",
    entityType: "school_charge",
    entityId: input.chargeId,
    before: { status: "draft" },
    after: { status: "issued", reference: charge.reference },
  });
  await notifyFinance(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    type: "payment_request",
    title: String(charge.title),
    recipients: await parentRecipientsForStudent(client, input.organisationId, String(charge.student_profile_id)),
    chargeId: input.chargeId,
    studentProfileId: String(charge.student_profile_id),
  });
  const updated = await client.query("select * from school_charges where id = $1", [input.chargeId]);
  return updated.rows[0] as Record<string, unknown>;
}

export async function cancelCharge(
  client: pg.PoolClient,
  input: { organisationId: string; actorUserId: string; chargeId: string },
): Promise<Record<string, unknown>> {
  const charge = await lockCharge(client, input.organisationId, input.chargeId);
  const balance = await chargeBalanceFor(client, charge);
  if (balance.netPaidMinor > 0) {
    throw new AppError(409, "conflict", "Paid charges cannot be cancelled; issue a refund instead");
  }
  await client.query(
    `update school_charges
        set status = 'cancelled', cancelled_by = $3, cancelled_at = now()
      where id = $1 and organisation_id = $2`,
    [input.chargeId, input.organisationId, input.actorUserId],
  );
  await client.query(
    `update school_payment_sessions
        set status = 'cancelled'
      where charge_id = $1 and organisation_id = $2 and status = 'open'`,
    [input.chargeId, input.organisationId],
  );
  await client.query(
    `update school_payment_transactions
        set status = 'cancelled', cancelled_at = now()
      where charge_id = $1 and organisation_id = $2 and status = 'pending'`,
    [input.chargeId, input.organisationId],
  );
  await auditFinance(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.charge.cancelled",
    entityType: "school_charge",
    entityId: input.chargeId,
    before: { status: charge.status },
    after: { status: "cancelled", reference: charge.reference },
  });
  const updated = await client.query("select * from school_charges where id = $1", [input.chargeId]);
  return updated.rows[0] as Record<string, unknown>;
}

export async function createBulkCharges(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    title: string;
    description?: string | null;
    categoryId?: string;
    categoryKey?: string;
    amountMinor: number;
    currency?: string | null;
    dueAt?: string | null;
    parentNote?: string | null;
    academicYearId?: string | null;
    idempotencyKey: string;
    issue?: boolean;
    studentIds: string[];
  },
): Promise<{ created: number; reused: number; charges: Array<Record<string, unknown>> }> {
  if (input.studentIds.length === 0) {
    throw new AppError(400, "validation_failed", "Select at least one pupil");
  }
  const uniqueIds = [...new Set(input.studentIds)];
  const charges: Array<Record<string, unknown>> = [];
  let created = 0;
  let reused = 0;
  for (const studentId of uniqueIds) {
    const before = await client.query(
      `select id from school_charges where organisation_id = $1 and idempotency_key = $2`,
      [input.organisationId, `${input.idempotencyKey}:${studentId}`],
    );
    const charge = await createCharge(client, {
      ...input,
      studentProfileId: studentId,
      sourceKind: "bulk",
      sourceId: null,
      idempotencyKey: `${input.idempotencyKey}:${studentId}`,
    });
    if (before.rows[0]) reused += 1;
    else created += 1;
    charges.push(charge);
  }
  return { created, reused, charges };
}

export async function applyChargeAdjustment(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    chargeId: string;
    kind: "waiver" | "reduction" | "subsidy" | "discount";
    amountMinor: number;
    reason: string;
  },
): Promise<Record<string, unknown>> {
  assertPositiveMinor(input.amountMinor);
  const charge = await lockCharge(client, input.organisationId, input.chargeId);
  if (charge.status === "cancelled") {
    throw new AppError(409, "invalid_status_transition", "Cancelled charges cannot be adjusted");
  }
  const balance = await chargeBalanceFor(client, charge);
  if (input.amountMinor > balance.amountDueMinor) {
    throwFinance("invalid_amount");
  }
  const nextDue = balance.amountDueMinor - input.amountMinor;
  if (nextDue < balance.netPaidMinor) {
    throw new AppError(409, "conflict", "An adjustment cannot reduce a charge below the amount already paid");
  }
  const reference = await nextFinanceReference(client, input.organisationId, "adjustment");
  await client.query(
    `insert into school_charge_adjustments (
       organisation_id, charge_id, reference, kind, amount_minor, reason, actor_user_id
     ) values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.organisationId,
      input.chargeId,
      reference,
      input.kind,
      input.amountMinor,
      input.reason,
      input.actorUserId,
    ],
  );
  const nextStatus =
    nextDue === 0 && balance.netPaidMinor === 0
      ? "waived"
      : deriveChargeStatus({
          current: String(charge.status) as never,
          amountDueMinor: nextDue,
          netPaidMinor: balance.netPaidMinor,
          refundedMinor: balance.refundedMinor,
        });
  await client.query(
    `update school_charges set amount_due_minor = $3, status = $4 where id = $1 and organisation_id = $2`,
    [input.chargeId, input.organisationId, nextDue, nextStatus],
  );
  await auditFinance(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.charge.adjusted",
    entityType: "school_charge",
    entityId: input.chargeId,
    before: { amountDueMinor: balance.amountDueMinor, status: charge.status },
    after: { amountDueMinor: nextDue, status: nextStatus, kind: input.kind, reference },
  });
  const updated = await client.query("select * from school_charges where id = $1", [input.chargeId]);
  return updated.rows[0] as Record<string, unknown>;
}

export async function recordOfflinePayment(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    chargeId: string;
    amountMinor: number;
    method: "cash" | "bank_transfer" | "cheque" | "card_terminal" | "other";
    reference?: string | null;
    note?: string | null;
    receivedAt?: string | null;
    idempotencyKey?: string | null;
  },
): Promise<Record<string, unknown>> {
  assertPositiveMinor(input.amountMinor);
  const charge = await lockCharge(client, input.organisationId, input.chargeId);
  const balance = await chargeBalanceFor(client, charge);
  if (!chargeIsPayable(String(charge.status) as never, balance.outstandingMinor)) {
    throwFinance(balance.outstandingMinor <= 0 ? "no_amount_outstanding" : "payment_unavailable");
  }
  if (input.amountMinor > balance.outstandingMinor) throwFinance("overpayment");
  if (input.idempotencyKey) {
    const existing = await client.query(
      `select * from school_payment_transactions
        where organisation_id = $1 and idempotency_key = $2`,
      [input.organisationId, input.idempotencyKey],
    );
    if (existing.rows[0]) return existing.rows[0] as Record<string, unknown>;
  }
  const reference = await nextFinanceReference(client, input.organisationId, "payment");
  const inserted = await client.query(
    `insert into school_payment_transactions (
       organisation_id, charge_id, reference, amount_minor, currency, payer_user_id,
       channel, provider_key, status, paid_at, idempotency_key, offline_method,
       offline_reference, offline_note, received_by, received_at
     ) values (
       $1,$2,$3,$4,$5,null,'offline','offline','succeeded', now(), $6,$7,$8,$9,$10,$11
     ) returning *`,
    [
      input.organisationId,
      input.chargeId,
      reference,
      input.amountMinor,
      charge.currency,
      input.idempotencyKey ?? null,
      input.method,
      input.reference ?? null,
      input.note ?? null,
      input.actorUserId,
      input.receivedAt ?? new Date().toISOString(),
    ],
  );
  const transaction = inserted.rows[0] as Record<string, unknown>;
  await refreshChargeStatus(client, charge);
  await createReceipt(client, {
    organisationId: input.organisationId,
    charge,
    transaction,
    schoolName: await loadSchoolName(client, input.organisationId),
  });
  await auditFinance(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.payment.offline",
    entityType: "school_payment_transaction",
    entityId: String(transaction.id),
    after: {
      reference,
      amountMinor: input.amountMinor,
      method: input.method,
      chargeReference: charge.reference,
    },
  });
  await notifyFinance(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    type: "payment_received",
    title: String(charge.title),
    recipients: await parentRecipientsForStudent(client, input.organisationId, String(charge.student_profile_id)),
    chargeId: String(charge.id),
    studentProfileId: String(charge.student_profile_id),
  });
  return transaction;
}

export async function createCheckoutSession(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actor: Actor;
    chargeId: string;
    provider: PaymentProvider;
    amountMinor?: number;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey?: string | null;
    requireGuardian?: boolean;
  },
): Promise<{ session: Record<string, unknown>; checkoutUrl: string }> {
  const charge = await lockCharge(client, input.organisationId, input.chargeId);
  if (input.requireGuardian !== false) {
    await requireLinkedChild(client, input.actor.userId, input.organisationId, String(charge.student_profile_id));
  }
  const balance = await chargeBalanceFor(client, charge);
  if (!chargeIsPayable(String(charge.status) as never, balance.outstandingMinor)) {
    throwFinance(balance.outstandingMinor <= 0 ? "no_amount_outstanding" : "payment_unavailable");
  }
  const amount = input.amountMinor ?? balance.outstandingMinor;
  assertPositiveMinor(amount);
  if (amount > balance.outstandingMinor) throwFinance("overpayment");
  if (input.idempotencyKey) {
    const existing = await client.query(
      `select s.*, t.status as transaction_status
         from school_payment_sessions s
         join school_payment_transactions t on t.id = s.transaction_id
        where s.organisation_id = $1 and s.idempotency_key = $2`,
      [input.organisationId, input.idempotencyKey],
    );
    if (existing.rows[0] && existing.rows[0].status === "open") {
      return {
        session: existing.rows[0] as Record<string, unknown>,
        checkoutUrl: String(existing.rows[0].checkout_url),
      };
    }
  }
  const payRef = await nextFinanceReference(client, input.organisationId, "payment");
  const tx = await client.query(
    `insert into school_payment_transactions (
       organisation_id, charge_id, reference, amount_minor, currency, payer_user_id,
       channel, provider_key, status, idempotency_key
     ) values ($1,$2,$3,$4,$5,$6,'provider',$7,'pending',$8)
     returning *`,
    [
      input.organisationId,
      input.chargeId,
      payRef,
      amount,
      charge.currency,
      input.actor.userId,
      input.provider.key,
      input.idempotencyKey ?? null,
    ],
  );
  const sessionPlaceholder = await client.query<{ id: string }>(
    `insert into school_payment_sessions (
       organisation_id, charge_id, transaction_id, provider_key, provider_session_id,
       amount_minor, currency, status, success_path, cancel_path, idempotency_key, created_by
     ) values ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$10,$11)
     returning id`,
    [
      input.organisationId,
      input.chargeId,
      tx.rows[0]!.id,
      input.provider.key,
      `pending_${cryptoRandom()}`,
      amount,
      charge.currency,
      input.successUrl,
      input.cancelUrl,
      input.idempotencyKey ?? null,
      input.actor.userId,
    ],
  );
  const created = await input.provider.createSession({
    organisationId: input.organisationId,
    chargeId: input.chargeId,
    sessionId: sessionPlaceholder.rows[0]!.id,
    transactionId: String(tx.rows[0]!.id),
    reference: payRef,
    amountMinor: amount,
    currency: String(charge.currency),
    title: String(charge.title),
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    idempotencyKey: input.idempotencyKey,
  });
  const session = await client.query(
    `update school_payment_sessions
        set provider_session_id = $3,
            checkout_url = $4,
            expires_at = $5
      where id = $1 and organisation_id = $2
      returning *`,
    [
      sessionPlaceholder.rows[0]!.id,
      input.organisationId,
      created.providerSessionId,
      created.checkoutUrl,
      created.expiresAt?.toISOString() ?? null,
    ],
  );
  await client.query(
    `update school_payment_transactions
        set provider_session_id = $3
      where id = $1 and organisation_id = $2`,
    [tx.rows[0]!.id, input.organisationId, created.providerSessionId],
  );
  return { session: session.rows[0] as Record<string, unknown>, checkoutUrl: created.checkoutUrl };
}

export async function settleProviderEvent(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    event: ProviderEvent;
    session: {
      session_id: string;
      charge_id: string;
      transaction_id: string;
      amount_minor: string | number;
      currency: string;
    };
  },
): Promise<void> {
  const charge = await lockCharge(client, input.organisationId, input.session.charge_id);
  const tx = await client.query(
    `select * from school_payment_transactions
      where id = $1 and organisation_id = $2
      for update`,
    [input.session.transaction_id, input.organisationId],
  );
  if (!tx.rows[0]) throw new AppError(400, "unknown_reference", "Unknown payment reference");
  const transaction = tx.rows[0] as Record<string, unknown>;
  if (input.event.amountMinor != null && Number(input.event.amountMinor) !== Number(transaction.amount_minor)) {
    await failTransaction(client, transaction, "amount_mismatch");
    throw new AppError(400, "amount_mismatch", "Provider amount does not match the session");
  }
  if (input.event.currency && input.event.currency.toUpperCase() !== String(transaction.currency)) {
    await failTransaction(client, transaction, "currency_mismatch");
    throw new AppError(400, "currency_mismatch", "Provider currency does not match the session");
  }
  if (Number(input.session.amount_minor) !== Number(transaction.amount_minor)) {
    await failTransaction(client, transaction, "amount_mismatch");
    throw new AppError(400, "amount_mismatch", "Provider amount does not match the session");
  }

  if (input.event.outcome === "failed" || input.event.outcome === "cancelled") {
    if (transaction.status !== "pending") {
      return;
    }
    await client.query(
      `update school_payment_transactions
          set status = $3, failed_at = case when $3 = 'failed' then now() else failed_at end,
              cancelled_at = case when $3 = 'cancelled' then now() else cancelled_at end,
              failure_code = $4
        where id = $1 and organisation_id = $2 and status = 'pending'`,
      [
        transaction.id,
        input.organisationId,
        input.event.outcome === "cancelled" ? "cancelled" : "failed",
        input.event.outcome,
      ],
    );
    await client.query(
      `update school_payment_sessions set status = $3 where id = $1 and organisation_id = $2`,
      [input.session.session_id, input.organisationId, input.event.outcome === "cancelled" ? "cancelled" : "failed"],
    );
    return;
  }

  if (input.event.outcome !== "succeeded") return;
  if (transaction.status !== "pending") {
    return;
  }
  const chargeStatus = String(charge.status);
  if (chargeStatus === "cancelled" || chargeStatus === "waived") {
    await failTransaction(client, transaction, "charge_not_payable");
    throw new AppError(409, "payment_unavailable", "This charge is no longer payable");
  }

  const balance = await chargeBalanceFor(client, charge);
  if (Number(transaction.amount_minor) > balance.outstandingMinor) {
    await failTransaction(client, transaction, "overpayment");
    throw new AppError(409, "overpayment", "This payment would exceed the amount outstanding");
  }

  await client.query(
    `update school_payment_transactions
        set status = 'succeeded',
            paid_at = now(),
            provider_payment_id = coalesce($3, provider_payment_id)
      where id = $1 and organisation_id = $2`,
    [transaction.id, input.organisationId, input.event.providerPaymentId ?? null],
  );
  await client.query(
    `update school_payment_sessions
        set status = 'completed', completed_at = now()
      where id = $1 and organisation_id = $2`,
    [input.session.session_id, input.organisationId],
  );
  const paidTx = {
    ...transaction,
    status: "succeeded",
    provider_payment_id: input.event.providerPaymentId ?? transaction.provider_payment_id,
    paid_at: new Date().toISOString(),
  };
  await refreshChargeStatus(client, charge);
  await createReceipt(client, {
    organisationId: input.organisationId,
    charge,
    transaction: paidTx,
    schoolName: await loadSchoolName(client, input.organisationId),
  });
  await notifyFinance(client, {
    organisationId: input.organisationId,
    actorUserId: String(transaction.payer_user_id ?? charge.created_by),
    type: "payment_received",
    title: String(charge.title),
    recipients: await parentRecipientsForStudent(client, input.organisationId, String(charge.student_profile_id)),
    chargeId: String(charge.id),
    studentProfileId: String(charge.student_profile_id),
  });
}

async function failTransaction(
  client: pg.PoolClient,
  transaction: Record<string, unknown>,
  code: string,
): Promise<void> {
  await client.query(
    `update school_payment_transactions
        set status = 'failed', failed_at = now(), failure_code = $3
      where id = $1 and organisation_id = $2 and status = 'pending'`,
    [transaction.id, transaction.organisation_id, code],
  );
}

export async function requestRefund(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    chargeId: string;
    transactionId?: string | null;
    amountMinor: number;
    reason: string;
    provider: PaymentProvider;
    idempotencyKey?: string | null;
  },
): Promise<Record<string, unknown>> {
  assertPositiveMinor(input.amountMinor);
  const charge = await lockCharge(client, input.organisationId, input.chargeId);
  const tx = await client.query(
    `select * from school_payment_transactions
      where organisation_id = $1
        and charge_id = $2
        and ($3::uuid is null or id = $3)
        and status in ('succeeded', 'partially_refunded')
      order by paid_at
      for update`,
    [input.organisationId, input.chargeId, input.transactionId ?? null],
  );
  if (!tx.rows[0]) throwFinance("refund_failed");
  if (input.idempotencyKey) {
    const existing = await client.query(
      `select * from school_payment_refunds where organisation_id = $1 and idempotency_key = $2`,
      [input.organisationId, input.idempotencyKey],
    );
    if (existing.rows[0]) return existing.rows[0] as Record<string, unknown>;
  }
  const transaction = tx.rows[0] as Record<string, unknown>;
  const available = Number(transaction.amount_minor) - Number(transaction.refunded_amount_minor);
  if (input.amountMinor > available) throwFinance("invalid_amount");
  assertSameCurrency(String(transaction.currency), String(charge.currency));

  let providerRefundId: string | null = null;
  let status: "pending" | "succeeded" | "failed" = "pending";
  if (transaction.channel === "offline") {
    status = "succeeded";
    providerRefundId = `offline_re_${String(transaction.id).replace(/-/g, "").slice(0, 16)}`;
  } else {
    if (transaction.provider_key !== input.provider.key || !transaction.provider_payment_id) {
      throwFinance("refund_failed");
    }
    try {
      const result = await input.provider.refund({
        providerPaymentId: String(transaction.provider_payment_id),
        amountMinor: input.amountMinor,
        currency: String(transaction.currency),
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      });
      providerRefundId = result.providerRefundId;
      status = result.status;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throwFinance("refund_failed");
    }
  }

  const reference = await nextFinanceReference(client, input.organisationId, "refund");
  const inserted = await client.query(
    `insert into school_payment_refunds (
       organisation_id, charge_id, transaction_id, reference, amount_minor, currency,
       reason, requested_by, provider_key, provider_refund_id, status, idempotency_key,
       completed_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     returning *`,
    [
      input.organisationId,
      input.chargeId,
      transaction.id,
      reference,
      input.amountMinor,
      transaction.currency,
      input.reason,
      input.actorUserId,
      transaction.provider_key,
      providerRefundId,
      status,
      input.idempotencyKey ?? null,
      status === "succeeded" ? new Date().toISOString() : null,
    ],
  );
  if (status === "succeeded") {
    await applySucceededRefund(client, {
      organisationId: input.organisationId,
      charge,
      transaction,
      amountMinor: input.amountMinor,
      actorUserId: input.actorUserId,
    });
  }
  await auditFinance(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: status === "succeeded" ? "finance.refund.completed" : "finance.refund.requested",
    entityType: "school_payment_refund",
    entityId: String(inserted.rows[0]!.id),
    after: { reference, amountMinor: input.amountMinor, status, chargeReference: charge.reference },
  });
  return inserted.rows[0] as Record<string, unknown>;
}

export async function applySucceededRefund(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    charge: Record<string, unknown>;
    transaction: Record<string, unknown>;
    amountMinor: number;
    actorUserId: string;
  },
): Promise<void> {
  const nextRefunded = Number(input.transaction.refunded_amount_minor) + input.amountMinor;
  if (nextRefunded > Number(input.transaction.amount_minor)) throwFinance("invalid_amount");
  const txStatus =
    nextRefunded === Number(input.transaction.amount_minor) ? "refunded" : "partially_refunded";
  await client.query(
    `update school_payment_transactions
        set refunded_amount_minor = $3, status = $4
      where id = $1 and organisation_id = $2`,
    [input.transaction.id, input.organisationId, nextRefunded, txStatus],
  );
  await refreshChargeStatus(client, input.charge);
  await notifyFinance(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    type: "payment_refunded",
    title: String(input.charge.title),
    recipients: await parentRecipientsForStudent(
      client,
      input.organisationId,
      String(input.charge.student_profile_id),
    ),
    chargeId: String(input.charge.id),
    studentProfileId: String(input.charge.student_profile_id),
  });
}

export async function createReceipt(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    charge: Record<string, unknown>;
    transaction: Record<string, unknown>;
    schoolName: string;
  },
): Promise<void> {
  const existing = await client.query(
    "select id from school_payment_receipts where transaction_id = $1",
    [input.transaction.id],
  );
  if (existing.rows[0]) return;
  const pupil = await client.query<{ legal_name: string }>(
    "select legal_name from student_profiles where id = $1",
    [input.charge.student_profile_id],
  );
  const payer = input.transaction.payer_user_id
    ? await client.query<{ full_name: string }>("select full_name from users where id = $1", [
        input.transaction.payer_user_id,
      ])
    : { rows: [] as Array<{ full_name: string }> };
  const reference = await nextFinanceReference(client, input.organisationId, "receipt");
  const snapshot = {
    schoolName: input.schoolName,
    receiptReference: reference,
    chargeReference: input.charge.reference,
    chargeTitle: input.charge.title,
    pupilName: pupil.rows[0]?.legal_name ?? null,
    payerName: payer.rows[0]?.full_name ?? (input.transaction.channel === "offline" ? "School-recorded payment" : null),
    amountMinor: Number(input.transaction.amount_minor),
    currency: input.transaction.currency,
    formattedAmount: formatMoney(Number(input.transaction.amount_minor), String(input.transaction.currency)),
    paidAt: input.transaction.paid_at ?? new Date().toISOString(),
    provider: input.transaction.provider_key,
    providerReference: redactProviderReference(
      input.transaction.provider_payment_id ? String(input.transaction.provider_payment_id) : String(input.transaction.reference),
    ),
    channel: input.transaction.channel,
    status: "succeeded",
  };
  await client.query(
    `insert into school_payment_receipts (
       organisation_id, charge_id, transaction_id, reference, snapshot
     ) values ($1,$2,$3,$4,$5::jsonb)
     on conflict (transaction_id) do nothing`,
    [input.organisationId, input.charge.id, input.transaction.id, reference, JSON.stringify(snapshot)],
  );
}

async function loadSchoolName(client: pg.PoolClient, organisationId: string): Promise<string> {
  const row = await client.query<{ name: string }>("select name from organisations where id = $1", [
    organisationId,
  ]);
  return row.rows[0]?.name ?? "School";
}

export async function syncActivityCharge(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    activityId: string;
    studentProfileId: string;
    registrationStatus: string;
    consentResponse?: string | null;
  },
): Promise<void> {
  const activity = await client.query<{
    title: string;
    payment_required: boolean;
    price_amount_minor: string | null;
    price_currency: string | null;
    charge_policy: string;
    payment_deadline_at: string | null;
    payment_instructions: string | null;
    academic_year_id: string | null;
    activity_type_key: string | null;
  }>(
    `select a.title, a.payment_required, a.price_amount_minor::text, a.price_currency,
            a.charge_policy, a.payment_deadline_at, a.payment_instructions, a.academic_year_id,
            t.key as activity_type_key
       from school_activities a
       join school_activity_types t on t.id = a.activity_type_id
      where a.id = $1 and a.organisation_id = $2`,
    [input.activityId, input.organisationId],
  );
  const row = activity.rows[0];
  if (!row) return;
  const existing = await client.query(
    `select * from school_charges
      where organisation_id = $1 and activity_id = $2 and student_profile_id = $3
        and status <> 'cancelled'
      for update`,
    [input.organisationId, input.activityId, input.studentProfileId],
  );
  if (existing.rows[0]) {
    const charge = existing.rows[0] as Record<string, unknown>;
    if (
      shouldCancelActivityCharge({
        registrationStatus: input.registrationStatus,
        chargeStatus: String(charge.status) as never,
      })
    ) {
      await cancelCharge(client, {
        organisationId: input.organisationId,
        actorUserId: input.actorUserId,
        chargeId: String(charge.id),
      });
    }
    return;
  }
  if (
    !shouldGenerateActivityCharge({
      chargePolicy: row.charge_policy as never,
      paymentRequired: row.payment_required,
      priceAmountMinor: row.price_amount_minor == null ? null : Number(row.price_amount_minor),
      registrationStatus: input.registrationStatus,
      consentResponse: input.consentResponse,
    })
  ) {
    return;
  }
  const categoryKey = row.activity_type_key === "club" ? "club" : "trip";
  await createCharge(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    title: row.title,
    categoryKey,
    studentProfileId: input.studentProfileId,
    activityId: input.activityId,
    academicYearId: row.academic_year_id,
    sourceKind: "activity",
    sourceId: input.activityId,
    amountMinor: Number(row.price_amount_minor),
    currency: row.price_currency,
    dueAt: row.payment_deadline_at,
    parentNote: row.payment_instructions,
    idempotencyKey: `activity:${input.activityId}:${input.studentProfileId}`,
    issue: true,
  });
}

export async function loadOperationalPaymentStatus(
  client: pg.PoolClient,
  organisationId: string,
  activityId: string,
  studentProfileId: string,
  paymentRequired: boolean,
): Promise<string> {
  const row = await client.query<{ status: string }>(
    `select status from school_charges
      where organisation_id = $1 and activity_id = $2 and student_profile_id = $3
        and status <> 'cancelled'
      order by created_at desc
      limit 1`,
    [organisationId, activityId, studentProfileId],
  );
  return operationalPaymentStatus({
    paymentRequired,
    chargeStatus: row.rows[0]?.status as never,
  });
}

export async function resolveBulkStudentIds(
  client: pg.PoolClient,
  organisationId: string,
  target: { type: "class" | "year_group" | "students"; classId?: string; yearGroupId?: string; studentIds?: string[] },
): Promise<string[]> {
  if (target.type === "students") {
    const ids = [...new Set(target.studentIds ?? [])];
    if (ids.length === 0) return [];
    const rows = await client.query<{ id: string }>(
      `select id from student_profiles where organisation_id = $1 and id = any($2::uuid[])`,
      [organisationId, ids],
    );
    return rows.rows.map((row) => row.id);
  }
  if (target.type === "class" && target.classId) {
    const rows = await client.query<{ student_profile_id: string }>(
      `select cm.student_profile_id
         from class_memberships cm
         join classes c on c.id = cm.class_id
        where c.organisation_id = $1 and cm.class_id = $2 and cm.ended_on is null`,
      [organisationId, target.classId],
    );
    return rows.rows.map((row) => row.student_profile_id);
  }
  if (target.type === "year_group" && target.yearGroupId) {
    const rows = await client.query<{ student_profile_id: string }>(
      `select se.student_profile_id
         from student_enrolments se
         join academic_years ay on ay.id = se.academic_year_id
        where se.organisation_id = $1
          and se.year_group_id = $2
          and ay.is_current
          and se.is_primary
          and se.ended_on is null`,
      [organisationId, target.yearGroupId],
    );
    return rows.rows.map((row) => row.student_profile_id);
  }
  return [];
}

export async function assertParentFinanceAccess(
  client: pg.PoolClient,
  actor: Actor,
  studentProfileId: string,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.FINANCE_READ_OWN_CHILDREN);
  await requireLinkedChild(client, actor.userId, actor.organisationId!, studentProfileId);
}

export { guardianChildIds, outstandingMinor, assertAnyPermission, assertPermission, assertNonNegativeMinor };

function cryptoRandom(): string {
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}
