import type pg from "pg";
import { PERMISSIONS, type Actor } from "@schoolapp/domain";
import {
  AppError,
  assertPermission,
  chargeBalanceFor,
  chargeIsPayable,
  createCheckoutSession,
  dueUrgency,
  formatMoney,
  guardianChildIds,
  requireLinkedChild,
  type PaymentProvider,
} from "@schoolapp/core";
import { mapCharge, mapPaymentReceipt, mapPaymentTransaction } from "./serialize";

export async function listParentCharges(
  client: pg.PoolClient,
  input: { orgId: string; userId: string; actor: Actor; studentId?: string },
) {
  assertPermission(input.actor, PERMISSIONS.FINANCE_READ_OWN_CHILDREN);
  const childIds = [...(await guardianChildIds(client, input.userId, input.orgId))];
  const allowed = input.studentId
    ? (await requireLinkedChild(client, input.userId, input.orgId, input.studentId), [input.studentId])
    : childIds;
  if (allowed.length === 0) return [];
  const rows = await client.query(
    `select c.*, cat.key as category_key, cat.name as category_name,
            sp.legal_name as student_legal_name, a.title as activity_title
       from school_charges c
       join school_charge_categories cat on cat.id = c.category_id
       join student_profiles sp on sp.id = c.student_profile_id
       left join school_activities a on a.id = c.activity_id
      where c.organisation_id = $1
        and c.student_profile_id = any($2::uuid[])
        and c.status <> 'draft'
      order by c.due_at nulls last, c.created_at desc`,
    [input.orgId, allowed],
  );
  const charges = [];
  for (const row of rows.rows) {
    const balance = await chargeBalanceFor(client, row as Record<string, unknown>);
    charges.push({
      ...mapCharge(row as Record<string, unknown>, balance),
      dueUrgency: dueUrgency(row.due_at ? String(row.due_at) : null),
      payable: chargeIsPayable(String(row.status) as never, balance.outstandingMinor),
      formattedOutstanding: formatMoney(balance.outstandingMinor, String(row.currency)),
    });
  }
  return charges;
}

export async function loadParentCharge(
  client: pg.PoolClient,
  input: { orgId: string; userId: string; actor: Actor; chargeId: string },
) {
  assertPermission(input.actor, PERMISSIONS.FINANCE_READ_OWN_CHILDREN);
  const row = await client.query(
    `select c.*, cat.key as category_key, cat.name as category_name,
            sp.legal_name as student_legal_name, a.title as activity_title
       from school_charges c
       join school_charge_categories cat on cat.id = c.category_id
       join student_profiles sp on sp.id = c.student_profile_id
       left join school_activities a on a.id = c.activity_id
      where c.id = $1 and c.organisation_id = $2 and c.status <> 'draft'`,
    [input.chargeId, input.orgId],
  );
  if (!row.rows[0]) throw new AppError(404, "not_found", "Not found");
  await requireLinkedChild(client, input.userId, input.orgId, String(row.rows[0].student_profile_id));
  const charge = row.rows[0] as Record<string, unknown>;
  const balance = await chargeBalanceFor(client, charge);
  const txs = await client.query(
    `select t.*, c.reference as charge_reference, c.title as charge_title
       from school_payment_transactions t
       join school_charges c on c.id = t.charge_id
      where t.charge_id = $1 and t.organisation_id = $2
        and t.status in ('succeeded', 'partially_refunded', 'refunded', 'pending')
      order by t.initiated_at`,
    [input.chargeId, input.orgId],
  );
  const receipts = await client.query(
    `select * from school_payment_receipts where charge_id = $1 and organisation_id = $2 order by created_at`,
    [input.chargeId, input.orgId],
  );
  return {
    charge: {
      ...mapCharge(charge, balance),
      dueUrgency: dueUrgency(charge.due_at ? String(charge.due_at) : null),
      payable: chargeIsPayable(String(charge.status) as never, balance.outstandingMinor),
    },
    transactions: txs.rows.map((item) => mapPaymentTransaction(item as Record<string, unknown>)),
    receipts: receipts.rows.map((item) => mapPaymentReceipt(item as Record<string, unknown>)),
  };
}

export async function startParentCheckout(
  client: pg.PoolClient,
  input: {
    orgId: string;
    actor: Actor;
    chargeId: string;
    provider: PaymentProvider;
    successUrl: string;
    cancelUrl: string;
    amountMinor?: number;
    idempotencyKey?: string | null;
  },
) {
  assertPermission(input.actor, PERMISSIONS.FINANCE_READ_OWN_CHILDREN);
  return createCheckoutSession(client, {
    organisationId: input.orgId,
    actor: input.actor,
    chargeId: input.chargeId,
    provider: input.provider,
    amountMinor: input.amountMinor,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    idempotencyKey: input.idempotencyKey,
  });
}
