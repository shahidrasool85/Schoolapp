import { z } from "zod";
import { PERMISSIONS } from "@schoolapp/domain";
import {
  AppError,
  applyChargeAdjustment,
  assertPermission,
  canManageAdjustments,
  canManageCharges,
  canManageRefunds,
  canReadFinanceReports,
  canReadSchoolFinance,
  canRecordOffline,
  cancelCharge,
  chargeBalanceFor,
  createBulkCharges,
  createCharge,
  createCheckoutSession,
  dueUrgency,
  formatMoney,
  issueCharge,
  loadOrgCurrency,
  loadTuitionDashboard,
  recordOfflinePayment,
  requestRefund,
  resolveBulkStudentIds,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import {
  mapChargeStaff,
  mapPaymentReceipt,
  mapPaymentRefund,
  mapPaymentTransaction,
} from "../serialize";
import { paymentProviderOf, publicOriginFromRequest } from "../payments-context";

const chargeBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).nullable().optional(),
  categoryId: z.string().uuid().optional(),
  categoryKey: z.string().min(1).max(64).optional(),
  studentProfileId: z.string().uuid(),
  activityId: z.string().uuid().nullable().optional(),
  academicYearId: z.string().uuid().nullable().optional(),
  amountMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  paymentRequired: z.boolean().optional(),
  internalNote: z.string().max(4000).nullable().optional(),
  parentNote: z.string().max(4000).nullable().optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
  issue: z.boolean().optional(),
});

const bulkSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).nullable().optional(),
  categoryId: z.string().uuid().optional(),
  categoryKey: z.string().min(1).max(64).optional(),
  amountMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  parentNote: z.string().max(4000).nullable().optional(),
  academicYearId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().min(8).max(120),
  issue: z.boolean().optional(),
  target: z.object({
    type: z.enum(["class", "year_group", "students"]),
    classId: z.string().uuid().optional(),
    yearGroupId: z.string().uuid().optional(),
    studentIds: z.array(z.string().uuid()).max(500).optional(),
  }),
});

export function registerFinanceRoutes(app: SchoolappApi) {
  app.get("/finance/categories", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadSchoolFinance(actor) && !canManageCharges(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const rows = await client.query(
        `select id, key, name, sort_order, is_system, is_active
           from school_charge_categories
          where organisation_id = $1
          order by sort_order, name`,
        [orgId],
      );
      return c.json({
        categories: rows.rows,
        defaultCurrency: await loadOrgCurrency(client, orgId),
      });
    }),
  );

  app.get("/finance/overview", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.FINANCE_REPORTS_READ);
      const rows = await client.query<{
        currency: string;
        outstanding_minor: string;
        paid_minor: string;
        overdue_count: string;
        refund_count: string;
        refund_minor: string;
      }>(
        `select c.currency,
                coalesce(sum(greatest(c.amount_due_minor - coalesce(p.net_paid, 0), 0))
                  filter (where c.status in ('issued', 'partially_paid')), 0)::text as outstanding_minor,
                coalesce(sum(coalesce(p.net_paid, 0))
                  filter (where p.net_paid > 0 and coalesce(p.last_paid_at, c.issued_at, c.created_at) >= date_trunc('month', now())), 0)::text as paid_minor,
                count(*) filter (
                  where c.status in ('issued', 'partially_paid')
                    and c.due_at is not null
                    and c.due_at < now()
                )::text as overdue_count,
                coalesce(sum(coalesce(p.refunded, 0)), 0)::text as refund_minor,
                count(*) filter (where coalesce(p.refunded, 0) > 0)::text as refund_count
           from school_charges c
           left join lateral (
             select
               coalesce(sum(t.amount_minor) filter (where t.status in ('succeeded', 'partially_refunded', 'refunded')), 0)
                 - coalesce(sum(t.refunded_amount_minor) filter (where t.status in ('succeeded', 'partially_refunded', 'refunded')), 0) as net_paid,
               coalesce(sum(t.refunded_amount_minor) filter (where t.status in ('succeeded', 'partially_refunded', 'refunded')), 0) as refunded,
               max(t.paid_at) as last_paid_at
             from school_payment_transactions t
             where t.charge_id = c.id and t.organisation_id = c.organisation_id
           ) p on true
          where c.organisation_id = $1
          group by c.currency
          order by c.currency`,
        [orgId],
      );
      const tuition = await loadTuitionDashboard(client, orgId).catch(() => null);
      return c.json({
        currencies: rows.rows.map((row) => ({
          currency: row.currency,
          outstandingMinor: Number(row.outstanding_minor),
          paidThisPeriodMinor: Number(row.paid_minor),
          overdueCount: Number(row.overdue_count),
          refundCount: Number(row.refund_count),
          refundMinor: Number(row.refund_minor),
        })),
        tuition,
      });
    }),
  );

  app.get("/finance/charges", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadSchoolFinance(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const status = c.req.query("status");
      const studentId = c.req.query("studentId");
      const outstanding = c.req.query("outstanding") === "true";
      const rows = await client.query(
        `select c.*, cat.key as category_key, cat.name as category_name,
                sp.legal_name as student_legal_name, a.title as activity_title
           from school_charges c
           join school_charge_categories cat on cat.id = c.category_id
           join student_profiles sp on sp.id = c.student_profile_id
           left join school_activities a on a.id = c.activity_id
          where c.organisation_id = $1
            and ($2::text is null or c.status = $2)
            and ($3::uuid is null or c.student_profile_id = $3)
          order by c.created_at desc
          limit 200`,
        [orgId, status || null, studentId || null],
      );
      const charges = [];
      for (const row of rows.rows) {
        const balance = await chargeBalanceFor(client, row as Record<string, unknown>);
        if (outstanding && balance.outstandingMinor <= 0) continue;
        charges.push({
          ...mapChargeStaff(row as Record<string, unknown>, balance),
          dueUrgency: dueUrgency(row.due_at ? String(row.due_at) : null),
        });
      }
      return c.json({ charges });
    }),
  );

  app.get("/finance/charges/export", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.FINANCE_REPORTS_READ);
      const rows = await client.query(
        `select c.reference, c.title, c.status, c.due_at, c.currency,
                c.amount_due_minor, sp.legal_name, cat.key as category_key
           from school_charges c
           join student_profiles sp on sp.id = c.student_profile_id
           join school_charge_categories cat on cat.id = c.category_id
          where c.organisation_id = $1
          order by c.created_at desc
          limit 2000`,
        [orgId],
      );
      const lines = [
        "pupil,reference,charge,category,amount_due,amount_paid,outstanding,status,due_date,currency",
      ];
      for (const row of rows.rows) {
        const balance = await chargeBalanceFor(client, row as Record<string, unknown>);
        lines.push(
          [
            csv(String(row.legal_name)),
            csv(String(row.reference)),
            csv(String(row.title)),
            csv(String(row.category_key)),
            String(row.amount_due_minor),
            String(balance.netPaidMinor),
            String(balance.outstandingMinor),
            csv(String(row.status)),
            row.due_at ? String(row.due_at).slice(0, 10) : "",
            csv(String(row.currency)),
          ].join(","),
        );
      }
      return new Response(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=school-charges.csv",
        },
      });
    }),
  );

  app.post("/finance/charges", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageCharges(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = chargeBodySchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid charge");
      const charge = await createCharge(client, {
        organisationId: orgId,
        actorUserId: userId,
        ...parsed.data,
      });
      const balance = await chargeBalanceFor(client, charge);
      return c.json({ charge: mapChargeStaff(charge, balance) }, 201);
    }),
  );

  app.post("/finance/charges/bulk", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageCharges(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = bulkSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid bulk charge");
      const studentIds = await resolveBulkStudentIds(client, orgId, parsed.data.target);
      const result = await createBulkCharges(client, {
        organisationId: orgId,
        actorUserId: userId,
        title: parsed.data.title,
        description: parsed.data.description,
        categoryId: parsed.data.categoryId,
        categoryKey: parsed.data.categoryKey,
        amountMinor: parsed.data.amountMinor,
        currency: parsed.data.currency,
        dueAt: parsed.data.dueAt,
        parentNote: parsed.data.parentNote,
        academicYearId: parsed.data.academicYearId,
        idempotencyKey: parsed.data.idempotencyKey,
        issue: parsed.data.issue,
        studentIds,
      });
      return c.json({ created: result.created, reused: result.reused, count: result.charges.length }, 201);
    }),
  );

  app.get("/finance/charges/:chargeId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadSchoolFinance(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const chargeId = uuidRouteParam(c, "chargeId");
      const row = await client.query(
        `select c.*, cat.key as category_key, cat.name as category_name,
                sp.legal_name as student_legal_name, a.title as activity_title
           from school_charges c
           join school_charge_categories cat on cat.id = c.category_id
           join student_profiles sp on sp.id = c.student_profile_id
           left join school_activities a on a.id = c.activity_id
          where c.id = $1 and c.organisation_id = $2`,
        [chargeId, orgId],
      );
      if (!row.rows[0]) throw new AppError(404, "not_found", "Not found");
      const charge = row.rows[0] as Record<string, unknown>;
      const balance = await chargeBalanceFor(client, charge);
      const txs = await client.query(
        `select t.*, c.reference as charge_reference, c.title as charge_title, sp.legal_name as student_legal_name
           from school_payment_transactions t
           join school_charges c on c.id = t.charge_id
           join student_profiles sp on sp.id = c.student_profile_id
          where t.charge_id = $1 and t.organisation_id = $2
          order by t.initiated_at`,
        [chargeId, orgId],
      );
      const refunds = await client.query(
        `select r.*, c.reference as charge_reference
           from school_payment_refunds r
           join school_charges c on c.id = r.charge_id
          where r.charge_id = $1 and r.organisation_id = $2
          order by r.created_at`,
        [chargeId, orgId],
      );
      const adjustments = await client.query(
        `select * from school_charge_adjustments where charge_id = $1 and organisation_id = $2 order by created_at`,
        [chargeId, orgId],
      );
      const receipts = await client.query(
        `select * from school_payment_receipts where charge_id = $1 and organisation_id = $2 order by created_at`,
        [chargeId, orgId],
      );
      return c.json({
        charge: mapChargeStaff(charge, balance),
        transactions: txs.rows.map((item) => mapPaymentTransaction(item as Record<string, unknown>)),
        refunds: refunds.rows.map((item) => mapPaymentRefund(item as Record<string, unknown>)),
        adjustments: adjustments.rows,
        receipts: receipts.rows.map((item) => mapPaymentReceipt(item as Record<string, unknown>)),
      });
    }),
  );

  app.post("/finance/charges/:chargeId/issue", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageCharges(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const charge = await issueCharge(client, {
        organisationId: orgId,
        actorUserId: userId,
        chargeId: uuidRouteParam(c, "chargeId"),
      });
      return c.json({ charge: mapChargeStaff(charge, await chargeBalanceFor(client, charge)) });
    }),
  );

  app.post("/finance/charges/:chargeId/cancel", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageCharges(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const charge = await cancelCharge(client, {
        organisationId: orgId,
        actorUserId: userId,
        chargeId: uuidRouteParam(c, "chargeId"),
      });
      return c.json({ charge: mapChargeStaff(charge, await chargeBalanceFor(client, charge)) });
    }),
  );

  app.post("/finance/charges/:chargeId/adjust", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageAdjustments(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          kind: z.enum(["waiver", "reduction", "subsidy", "discount"]),
          amountMinor: z.number().int().positive(),
          reason: z.string().trim().min(1).max(1000),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid adjustment");
      const charge = await applyChargeAdjustment(client, {
        organisationId: orgId,
        actorUserId: userId,
        chargeId: uuidRouteParam(c, "chargeId"),
        ...parsed.data,
      });
      return c.json({ charge: mapChargeStaff(charge, await chargeBalanceFor(client, charge)) });
    }),
  );

  app.post("/finance/charges/:chargeId/offline-payment", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canRecordOffline(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          amountMinor: z.number().int().positive(),
          method: z.enum(["cash", "bank_transfer", "cheque", "card_terminal", "other"]),
          reference: z.string().trim().min(1).max(80).optional(),
          note: z.string().max(2000).optional(),
          receivedAt: z.string().datetime({ offset: true }).optional(),
          idempotencyKey: z.string().min(8).max(120).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid offline payment");
      const transaction = await recordOfflinePayment(client, {
        organisationId: orgId,
        actorUserId: userId,
        chargeId: uuidRouteParam(c, "chargeId"),
        ...parsed.data,
      });
      return c.json({ transaction: mapPaymentTransaction(transaction) }, 201);
    }),
  );

  app.post("/finance/charges/:chargeId/refund", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageRefunds(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          amountMinor: z.number().int().positive(),
          reason: z.string().trim().min(1).max(1000),
          transactionId: z.string().uuid().optional(),
          idempotencyKey: z.string().min(8).max(120).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid refund");
      const refund = await requestRefund(client, {
        organisationId: orgId,
        actorUserId: userId,
        chargeId: uuidRouteParam(c, "chargeId"),
        provider: paymentProviderOf(c),
        ...parsed.data,
      });
      return c.json({ refund: mapPaymentRefund(refund) }, 201);
    }),
  );

  app.get("/finance/transactions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!actor.permissions.has(PERMISSIONS.FINANCE_TRANSACTIONS_READ)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const rows = await client.query(
        `select t.*, c.reference as charge_reference, c.title as charge_title, sp.legal_name as student_legal_name
           from school_payment_transactions t
           join school_charges c on c.id = t.charge_id
           join student_profiles sp on sp.id = c.student_profile_id
          where t.organisation_id = $1
          order by t.initiated_at desc
          limit 200`,
        [orgId],
      );
      return c.json({ transactions: rows.rows.map((row) => mapPaymentTransaction(row as Record<string, unknown>)) });
    }),
  );

  app.get("/finance/refunds", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canManageRefunds(actor) && !actor.permissions.has(PERMISSIONS.FINANCE_TRANSACTIONS_READ)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const rows = await client.query(
        `select r.*, c.reference as charge_reference
           from school_payment_refunds r
           join school_charges c on c.id = r.charge_id
          where r.organisation_id = $1
          order by r.created_at desc
          limit 200`,
        [orgId],
      );
      return c.json({ refunds: rows.rows.map((row) => mapPaymentRefund(row as Record<string, unknown>)) });
    }),
  );

  app.get("/finance/outstanding", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadSchoolFinance(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const rows = await client.query(
        `select c.*, cat.key as category_key, cat.name as category_name,
                sp.legal_name as student_legal_name, a.title as activity_title
           from school_charges c
           join school_charge_categories cat on cat.id = c.category_id
           join student_profiles sp on sp.id = c.student_profile_id
           left join school_activities a on a.id = c.activity_id
          where c.organisation_id = $1 and c.status in ('issued', 'partially_paid')
          order by c.due_at nulls last, c.created_at`,
        [orgId],
      );
      const charges = [];
      for (const row of rows.rows) {
        const balance = await chargeBalanceFor(client, row as Record<string, unknown>);
        if (balance.outstandingMinor <= 0) continue;
        charges.push({
          ...mapChargeStaff(row as Record<string, unknown>, balance),
          dueUrgency: dueUrgency(row.due_at ? String(row.due_at) : null),
          formattedOutstanding: formatMoney(balance.outstandingMinor, String(row.currency)),
        });
      }
      return c.json({ charges });
    }),
  );

  app.post("/finance/charges/:chargeId/checkout", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canManageCharges(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const origin = publicOriginFromRequest(c);
      const chargeId = uuidRouteParam(c, "chargeId");
      const result = await createCheckoutSession(client, {
        organisationId: orgId,
        actor,
        chargeId,
        provider: paymentProviderOf(c),
        requireGuardian: false,
        successUrl: `${origin}/school/finance/charges/${chargeId}?status=pending`,
        cancelUrl: `${origin}/school/finance/charges/${chargeId}?status=cancelled`,
      });
      return c.json({ checkoutUrl: result.checkoutUrl, sessionId: result.session.id });
    }),
  );
}

function csv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}
