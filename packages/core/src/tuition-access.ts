import type pg from "pg";
import {
  PERMISSIONS,
  STAFF_ROLE_KEYS,
  feeScheduleAnnualMatchesInstalments,
  type Actor,
  type SchoolBillingFrequency,
  type SchoolDiscountStackingMode,
  type SchoolInvoicePaymentMethod,
  type SchoolInvoiceStatus,
  type SchoolMidPeriodPolicy,
  type SchoolSiblingOrderMode,
} from "@schoolapp/domain";
import { writeAudit } from "./academic.js";
import { AppError } from "./errors.js";
import { assertPermission, notFound } from "./permissions.js";
import { nextFinanceReference } from "./payments-access.js";
import { guardianChildIds } from "./students-access.js";
import {
  applyDiscounts,
  applyMidPeriodPolicy,
  arrearsBucket,
  asIsoDate,
  billingPeriodKey,
  daysOverdue,
  deriveInvoiceStatus,
  invoiceOutstandingMinor,
  isSchoolBillingFrequency,
  isSchoolCreditKind,
  isSchoolDiscountAmountType,
  isSchoolDiscountKind,
  isSchoolDiscountStackingMode,
  isSchoolInvoicePaymentMethod,
  isSchoolMidPeriodPolicy,
  isSchoolSiblingOrderMode,
  isSchoolStaffChildScope,
  orderSiblings,
  splitAnnualIntoInstalments,
  type AppliedDiscount,
  type DiscountCandidate,
  type SiblingSortInput,
} from "./tuition.js";

type Client = pg.PoolClient;

export const TUITION_READ_PERMISSIONS = [
  PERMISSIONS.FINANCE_INVOICES_READ,
  PERMISSIONS.FINANCE_ACCOUNTS_READ,
  PERMISSIONS.FINANCE_REPORTS_READ,
  PERMISSIONS.FINANCE_CHARGES_READ,
] as const;

export function canReadTuition(actor: Actor): boolean {
  return TUITION_READ_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canManageFeeSchedules(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.FINANCE_FEE_SCHEDULES_MANAGE);
}

export function canManageDiscounts(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.FINANCE_DISCOUNTS_MANAGE);
}

export function canManageBillingRuns(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.FINANCE_BILLING_RUNS_MANAGE);
}

export function canManageInvoices(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.FINANCE_INVOICES_MANAGE);
}

export function canManageFinanceSettings(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.FINANCE_SETTINGS_MANAGE);
}

export function assertTuitionRead(actor: Actor): void {
  if (!canReadTuition(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export type FinanceSettings = {
  organisationId: string;
  tuitionEnabled: boolean;
  defaultBillingFrequency: SchoolBillingFrequency;
  currency: string;
  invoicePrefix: string;
  paymentDueDays: number;
  gracePeriodDays: number;
  defaultAcademicYearId: string | null;
  paymentInstructions: string | null;
  invoiceFooter: string | null;
  parentsCanViewInvoices: boolean;
  parentsCanViewBalances: boolean;
  discountStackingMode: SchoolDiscountStackingMode;
  siblingOrderMode: SchoolSiblingOrderMode;
  midPeriodJoinPolicy: SchoolMidPeriodPolicy;
  midPeriodLeavePolicy: SchoolMidPeriodPolicy;
  monthlyInstalmentCount: number;
};

function mapSettings(row: Record<string, unknown>): FinanceSettings {
  return {
    organisationId: String(row.organisation_id),
    tuitionEnabled: Boolean(row.tuition_enabled),
    defaultBillingFrequency: String(row.default_billing_frequency) as SchoolBillingFrequency,
    currency: String(row.currency),
    invoicePrefix: String(row.invoice_prefix),
    paymentDueDays: Number(row.payment_due_days),
    gracePeriodDays: Number(row.grace_period_days),
    defaultAcademicYearId: row.default_academic_year_id ? String(row.default_academic_year_id) : null,
    paymentInstructions: row.payment_instructions ? String(row.payment_instructions) : null,
    invoiceFooter: row.invoice_footer ? String(row.invoice_footer) : null,
    parentsCanViewInvoices: Boolean(row.parents_can_view_invoices),
    parentsCanViewBalances: Boolean(row.parents_can_view_balances),
    discountStackingMode: String(row.discount_stacking_mode) as SchoolDiscountStackingMode,
    siblingOrderMode: String(row.sibling_order_mode) as SchoolSiblingOrderMode,
    midPeriodJoinPolicy: String(row.mid_period_join_policy) as SchoolMidPeriodPolicy,
    midPeriodLeavePolicy: String(row.mid_period_leave_policy) as SchoolMidPeriodPolicy,
    monthlyInstalmentCount: Number(row.monthly_instalment_count),
  };
}

export async function loadFinanceSettings(client: Client, organisationId: string): Promise<FinanceSettings> {
  await client.query("select ensure_organisation_phase21_defaults($1)", [organisationId]);
  const row = await client.query(`select * from school_finance_settings where organisation_id = $1`, [
    organisationId,
  ]);
  if (!row.rows[0]) notFound();
  return mapSettings(row.rows[0] as Record<string, unknown>);
}

export async function updateFinanceSettings(
  client: Client,
  input: {
    organisationId: string;
    actorUserId: string;
    patch: Partial<{
      tuitionEnabled: boolean;
      defaultBillingFrequency: string;
      currency: string;
      invoicePrefix: string;
      paymentDueDays: number;
      gracePeriodDays: number;
      defaultAcademicYearId: string | null;
      paymentInstructions: string | null;
      invoiceFooter: string | null;
      parentsCanViewInvoices: boolean;
      parentsCanViewBalances: boolean;
      discountStackingMode: string;
      siblingOrderMode: string;
      midPeriodJoinPolicy: string;
      midPeriodLeavePolicy: string;
      monthlyInstalmentCount: number;
    }>;
  },
): Promise<FinanceSettings> {
  const current = await loadFinanceSettings(client, input.organisationId);
  const next = {
    ...current,
    ...Object.fromEntries(
      Object.entries({
        tuitionEnabled: input.patch.tuitionEnabled,
        defaultBillingFrequency: input.patch.defaultBillingFrequency,
        currency: input.patch.currency?.toUpperCase(),
        invoicePrefix: input.patch.invoicePrefix,
        paymentDueDays: input.patch.paymentDueDays,
        gracePeriodDays: input.patch.gracePeriodDays,
        defaultAcademicYearId: input.patch.defaultAcademicYearId,
        paymentInstructions: input.patch.paymentInstructions,
        invoiceFooter: input.patch.invoiceFooter,
        parentsCanViewInvoices: input.patch.parentsCanViewInvoices,
        parentsCanViewBalances: input.patch.parentsCanViewBalances,
        discountStackingMode: input.patch.discountStackingMode,
        siblingOrderMode: input.patch.siblingOrderMode,
        midPeriodJoinPolicy: input.patch.midPeriodJoinPolicy,
        midPeriodLeavePolicy: input.patch.midPeriodLeavePolicy,
        monthlyInstalmentCount: input.patch.monthlyInstalmentCount,
      }).filter(([, value]) => value !== undefined),
    ),
  } as FinanceSettings;
  if (!isSchoolBillingFrequency(next.defaultBillingFrequency)) {
    throw new AppError(400, "validation_failed", "Invalid billing frequency");
  }
  if (!isSchoolDiscountStackingMode(next.discountStackingMode)) {
    throw new AppError(400, "validation_failed", "Invalid discount stacking mode");
  }
  if (!isSchoolSiblingOrderMode(next.siblingOrderMode)) {
    throw new AppError(400, "validation_failed", "Invalid sibling order");
  }
  if (!isSchoolMidPeriodPolicy(next.midPeriodJoinPolicy) || !isSchoolMidPeriodPolicy(next.midPeriodLeavePolicy)) {
    throw new AppError(400, "validation_failed", "Invalid mid-period policy");
  }
  await client.query(
    `update school_finance_settings
        set tuition_enabled = $2,
            default_billing_frequency = $3,
            currency = $4,
            invoice_prefix = $5,
            payment_due_days = $6,
            grace_period_days = $7,
            default_academic_year_id = $8,
            payment_instructions = $9,
            invoice_footer = $10,
            parents_can_view_invoices = $11,
            parents_can_view_balances = $12,
            discount_stacking_mode = $13,
            sibling_order_mode = $14,
            mid_period_join_policy = $15,
            mid_period_leave_policy = $16,
            monthly_instalment_count = $17,
            updated_by = $18
      where organisation_id = $1`,
    [
      input.organisationId,
      next.tuitionEnabled,
      next.defaultBillingFrequency,
      next.currency,
      next.invoicePrefix,
      next.paymentDueDays,
      next.gracePeriodDays,
      next.defaultAcademicYearId,
      next.paymentInstructions,
      next.invoiceFooter,
      next.parentsCanViewInvoices,
      next.parentsCanViewBalances,
      next.discountStackingMode,
      next.siblingOrderMode,
      next.midPeriodJoinPolicy,
      next.midPeriodLeavePolicy,
      next.monthlyInstalmentCount,
      input.actorUserId,
    ],
  );
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.settings.updated",
    entityType: "school_finance_settings",
    entityId: input.organisationId,
    before: { tuitionEnabled: current.tuitionEnabled, stacking: current.discountStackingMode },
    after: { tuitionEnabled: next.tuitionEnabled, stacking: next.discountStackingMode },
  });
  return loadFinanceSettings(client, input.organisationId);
}

export async function listFeeSchedules(client: Client, organisationId: string, academicYearId?: string) {
  const rows = await client.query(
    `select s.*, y.name as academic_year_name, g.name as year_group_name, g.code as year_group_code,
            c.name as class_name
       from school_fee_schedules s
       join academic_years y on y.id = s.academic_year_id
       left join year_groups g on g.id = s.year_group_id
       left join classes c on c.id = s.class_id
      where s.organisation_id = $1
        and ($2::uuid is null or s.academic_year_id = $2)
      order by y.starts_on desc, g.sort_order nulls last, s.name`,
    [organisationId, academicYearId ?? null],
  );
  return rows.rows.map(mapFeeSchedule);
}

function mapFeeSchedule(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    academicYearId: row.academic_year_id,
    academicYearName: row.academic_year_name ?? null,
    yearGroupId: row.year_group_id ?? null,
    yearGroupName: row.year_group_name ?? null,
    yearGroupCode: row.year_group_code ?? null,
    classId: row.class_id ?? null,
    className: row.class_name ?? null,
    amountMinor: Number(row.amount_minor),
    annualAmountMinor: row.annual_amount_minor == null ? null : Number(row.annual_amount_minor),
    currency: row.currency,
    billingFrequency: row.billing_frequency,
    instalmentCount: row.instalment_count == null ? null : Number(row.instalment_count),
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until ?? null,
    isActive: row.is_active,
    description: row.description ?? null,
  };
}

export async function createFeeSchedule(
  client: Client,
  input: {
    organisationId: string;
    actorUserId: string;
    name: string;
    academicYearId: string;
    yearGroupId?: string | null;
    classId?: string | null;
    amountMinor: number;
    annualAmountMinor?: number | null;
    billingFrequency: string;
    instalmentCount?: number | null;
    effectiveFrom: string;
    effectiveUntil?: string | null;
    description?: string | null;
    instalments?: Array<{ sequence: number; label: string; dueOn?: string | null; amountMinor: number }>;
  },
) {
  if (!isSchoolBillingFrequency(input.billingFrequency)) {
    throw new AppError(400, "validation_failed", "Invalid billing frequency");
  }
  const annualCheck = feeScheduleAnnualMatchesInstalments({
    amountMinor: input.amountMinor,
    instalmentCount: input.instalmentCount,
    annualAmountMinor: input.annualAmountMinor,
  });
  if (!annualCheck.ok) {
    throw new AppError(400, "validation_failed", annualCheck.error, { fieldKey: "annualAmountMinor" });
  }
  const settings = await loadFinanceSettings(client, input.organisationId);
  const created = await client.query(
    `insert into school_fee_schedules (
       organisation_id, name, academic_year_id, year_group_id, class_id, amount_minor,
       annual_amount_minor, currency, billing_frequency, instalment_count,
       effective_from, effective_until, description, created_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     returning *`,
    [
      input.organisationId,
      input.name,
      input.academicYearId,
      input.yearGroupId ?? null,
      input.classId ?? null,
      input.amountMinor,
      input.annualAmountMinor ?? null,
      settings.currency,
      input.billingFrequency,
      input.instalmentCount ?? null,
      input.effectiveFrom,
      input.effectiveUntil ?? null,
      input.description ?? null,
      input.actorUserId,
    ],
  );
  const schedule = created.rows[0] as Record<string, unknown>;
  if (input.instalments?.length) {
    for (const instalment of input.instalments) {
      await client.query(
        `insert into school_fee_schedule_instalments (
           organisation_id, fee_schedule_id, sequence, label, due_on, amount_minor
         ) values ($1,$2,$3,$4,$5,$6)`,
        [
          input.organisationId,
          schedule.id,
          instalment.sequence,
          instalment.label,
          instalment.dueOn ?? null,
          instalment.amountMinor,
        ],
      );
    }
  }
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.fee_schedule.created",
    entityType: "school_fee_schedule",
    entityId: String(schedule.id),
    after: { name: input.name, amountMinor: input.amountMinor, frequency: input.billingFrequency },
  });
  return mapFeeSchedule(schedule);
}

export async function updateFeeSchedule(
  client: Client,
  input: {
    organisationId: string;
    actorUserId: string;
    scheduleId: string;
    name?: string;
    amountMinor?: number;
    annualAmountMinor?: number | null;
    billingFrequency?: string;
    instalmentCount?: number | null;
    effectiveFrom?: string;
    effectiveUntil?: string | null;
    isActive?: boolean;
    description?: string | null;
  },
) {
  const existing = await client.query(`select * from school_fee_schedules where id = $1 and organisation_id = $2`, [
    input.scheduleId,
    input.organisationId,
  ]);
  if (!existing.rows[0]) notFound();
  if (input.billingFrequency && !isSchoolBillingFrequency(input.billingFrequency)) {
    throw new AppError(400, "validation_failed", "Invalid billing frequency");
  }
  const updated = await client.query(
    `update school_fee_schedules
        set name = coalesce($3, name),
            amount_minor = coalesce($4, amount_minor),
            annual_amount_minor = coalesce($5, annual_amount_minor),
            billing_frequency = coalesce($6, billing_frequency),
            instalment_count = coalesce($7, instalment_count),
            effective_from = coalesce($8, effective_from),
            effective_until = coalesce($9, effective_until),
            is_active = coalesce($10, is_active),
            description = coalesce($11, description)
      where id = $1 and organisation_id = $2
      returning *`,
    [
      input.scheduleId,
      input.organisationId,
      input.name ?? null,
      input.amountMinor ?? null,
      input.annualAmountMinor === undefined ? null : input.annualAmountMinor,
      input.billingFrequency ?? null,
      input.instalmentCount === undefined ? null : input.instalmentCount,
      input.effectiveFrom ?? null,
      input.effectiveUntil === undefined ? null : input.effectiveUntil,
      input.isActive ?? null,
      input.description === undefined ? null : input.description,
    ],
  );
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.fee_schedule.updated",
    entityType: "school_fee_schedule",
    entityId: input.scheduleId,
    after: { name: updated.rows[0]!.name, amountMinor: Number(updated.rows[0]!.amount_minor) },
  });
  return mapFeeSchedule(updated.rows[0] as Record<string, unknown>);
}

export async function listDiscountRules(client: Client, organisationId: string) {
  const rules = await client.query(
    `select * from school_discount_rules where organisation_id = $1 order by stacking_priority, name`,
    [organisationId],
  );
  const tiers = await client.query(
    `select * from school_discount_rule_tiers where organisation_id = $1 order by sibling_position`,
    [organisationId],
  );
  return rules.rows.map((rule) => ({
    ...mapDiscountRule(rule as Record<string, unknown>),
    tiers: tiers.rows
      .filter((tier) => String(tier.discount_rule_id) === String(rule.id))
      .map((tier) => ({
        id: tier.id,
        siblingPosition: Number(tier.sibling_position),
        amountType: tier.amount_type,
        percentBps: tier.percent_bps == null ? null : Number(tier.percent_bps),
        amountMinor: tier.amount_minor == null ? null : Number(tier.amount_minor),
      })),
  }));
}

function mapDiscountRule(row: Record<string, unknown>) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    amountType: row.amount_type,
    percentBps: row.percent_bps == null ? null : Number(row.percent_bps),
    amountMinor: row.amount_minor == null ? null : Number(row.amount_minor),
    stackingPriority: Number(row.stacking_priority),
    exclusiveGroup: row.exclusive_group ? String(row.exclusive_group) : null,
    staffScope: row.staff_scope ? String(row.staff_scope) : null,
    staffRoleKeys: Array.isArray(row.staff_role_keys) ? row.staff_role_keys.map(String) : [],
    appliesTo: row.applies_to,
    effectiveFrom: row.effective_from ?? null,
    effectiveUntil: row.effective_until ?? null,
    isActive: row.is_active,
    description: row.description ?? null,
  };
}

export async function createDiscountRule(
  client: Client,
  input: {
    organisationId: string;
    actorUserId: string;
    kind: string;
    name: string;
    amountType: string;
    percentBps?: number | null;
    amountMinor?: number | null;
    stackingPriority?: number;
    exclusiveGroup?: string | null;
    staffScope?: string | null;
    staffRoleKeys?: string[];
    description?: string | null;
    effectiveFrom?: string | null;
    effectiveUntil?: string | null;
    tiers?: Array<{ siblingPosition: number; amountType: string; percentBps?: number | null; amountMinor?: number | null }>;
  },
) {
  if (!isSchoolDiscountKind(input.kind) || !isSchoolDiscountAmountType(input.amountType)) {
    throw new AppError(400, "validation_failed", "Invalid discount rule");
  }
  if (input.staffScope && !isSchoolStaffChildScope(input.staffScope)) {
    throw new AppError(400, "validation_failed", "Invalid staff scope");
  }
  const created = await client.query(
    `insert into school_discount_rules (
       organisation_id, kind, name, amount_type, percent_bps, amount_minor, stacking_priority,
       exclusive_group, staff_scope, staff_role_keys, description, effective_from, effective_until, created_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     returning *`,
    [
      input.organisationId,
      input.kind,
      input.name,
      input.amountType,
      input.kind === "sibling" ? (input.percentBps ?? 0) : (input.percentBps ?? null),
      input.amountMinor ?? null,
      input.stackingPriority ?? 100,
      input.exclusiveGroup ?? null,
      input.staffScope ?? null,
      input.staffRoleKeys ?? [],
      input.description ?? null,
      input.effectiveFrom ?? null,
      input.effectiveUntil ?? null,
      input.actorUserId,
    ],
  );
  const rule = created.rows[0] as Record<string, unknown>;
  for (const tier of input.tiers ?? []) {
    if (!isSchoolDiscountAmountType(tier.amountType)) {
      throw new AppError(400, "validation_failed", "Invalid sibling tier");
    }
    await client.query(
      `insert into school_discount_rule_tiers (
         organisation_id, discount_rule_id, sibling_position, amount_type, percent_bps, amount_minor
       ) values ($1,$2,$3,$4,$5,$6)`,
      [
        input.organisationId,
        rule.id,
        tier.siblingPosition,
        tier.amountType,
        tier.percentBps ?? null,
        tier.amountMinor ?? null,
      ],
    );
  }
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.discount_rule.created",
    entityType: "school_discount_rule",
    entityId: String(rule.id),
    after: { kind: input.kind, name: input.name },
  });
  return (await listDiscountRules(client, input.organisationId)).find((item) => item.id === rule.id);
}

export async function updateDiscountRule(
  client: Client,
  input: {
    organisationId: string;
    actorUserId: string;
    ruleId: string;
    name?: string;
    isActive?: boolean;
    stackingPriority?: number;
    exclusiveGroup?: string | null;
    percentBps?: number | null;
    amountMinor?: number | null;
    description?: string | null;
  },
) {
  const existing = await client.query(`select id from school_discount_rules where id = $1 and organisation_id = $2`, [
    input.ruleId,
    input.organisationId,
  ]);
  if (!existing.rows[0]) notFound();
  await client.query(
    `update school_discount_rules
        set name = coalesce($3, name),
            is_active = coalesce($4, is_active),
            stacking_priority = coalesce($5, stacking_priority),
            exclusive_group = coalesce($6, exclusive_group),
            percent_bps = coalesce($7, percent_bps),
            amount_minor = coalesce($8, amount_minor),
            description = coalesce($9, description)
      where id = $1 and organisation_id = $2`,
    [
      input.ruleId,
      input.organisationId,
      input.name ?? null,
      input.isActive ?? null,
      input.stackingPriority ?? null,
      input.exclusiveGroup === undefined ? null : input.exclusiveGroup,
      input.percentBps === undefined ? null : input.percentBps,
      input.amountMinor === undefined ? null : input.amountMinor,
      input.description === undefined ? null : input.description,
    ],
  );
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.discount_rule.updated",
    entityType: "school_discount_rule",
    entityId: input.ruleId,
    after: { name: input.name ?? null, isActive: input.isActive ?? null },
  });
  return (await listDiscountRules(client, input.organisationId)).find((item) => item.id === input.ruleId);
}

export async function familyStudentIds(
  client: Client,
  organisationId: string,
  studentProfileId: string,
): Promise<string[]> {
  const rows = await client.query<{ student_profile_id: string }>(
    `select distinct g2.student_profile_id
       from guardianships g1
       join guardianships g2
         on g2.guardian_user_id = g1.guardian_user_id
        and g2.organisation_id = g1.organisation_id
        and (g2.ended_on is null or g2.ended_on >= current_date)
        and (g2.started_on is null or g2.started_on <= current_date)
      where g1.organisation_id = $1
        and g1.student_profile_id = $2
        and (g1.ended_on is null or g1.ended_on >= current_date)
        and (g1.started_on is null or g1.started_on <= current_date)`,
    [organisationId, studentProfileId],
  );
  const ids = new Set(rows.rows.map((row) => row.student_profile_id));
  ids.add(studentProfileId);
  return [...ids];
}

export async function ensureBillingAccount(
  client: Client,
  organisationId: string,
  studentProfileId: string,
): Promise<string> {
  const familyIds = await familyStudentIds(client, organisationId, studentProfileId);
  const existing = await client.query<{ billing_account_id: string; created_at: string }>(
    `select billing_account_id, min(created_at)::text as created_at
       from school_billing_account_pupils
      where organisation_id = $1 and student_profile_id = any($2::uuid[])
      group by billing_account_id
      order by min(created_at)
      limit 1`,
    [organisationId, familyIds],
  );
  let accountId = existing.rows[0]?.billing_account_id;
  if (!accountId) {
    const pupil = await client.query<{ legal_name: string }>(
      `select legal_name from student_profiles where id = $1 and organisation_id = $2`,
      [studentProfileId, organisationId],
    );
    const created = await client.query<{ id: string }>(
      `insert into school_billing_accounts (organisation_id, name)
       values ($1, $2)
       returning id`,
      [organisationId, `Family — ${pupil.rows[0]?.legal_name ?? "Pupils"}`],
    );
    accountId = created.rows[0]!.id;
  }
  for (const pupilId of familyIds) {
    await client.query(
      `insert into school_billing_account_pupils (organisation_id, billing_account_id, student_profile_id)
       values ($1,$2,$3)
       on conflict (organisation_id, student_profile_id) do update
         set billing_account_id = excluded.billing_account_id`,
      [organisationId, accountId, pupilId],
    );
  }
  const guardians = await client.query<{ guardian_user_id: string; priority: number; portal_access: boolean }>(
    `select distinct g.guardian_user_id, g.priority, g.portal_access
       from guardianships g
      where g.organisation_id = $1
        and g.student_profile_id = any($2::uuid[])
        and (g.ended_on is null or g.ended_on >= current_date)
        and (g.started_on is null or g.started_on <= current_date)
      order by g.portal_access desc, g.priority, g.guardian_user_id`,
    [organisationId, familyIds],
  );
  for (const guardian of guardians.rows) {
    await client.query(
      `insert into school_billing_account_payers (organisation_id, billing_account_id, user_id)
       values ($1,$2,$3)
       on conflict do nothing`,
      [organisationId, accountId, guardian.guardian_user_id],
    );
  }
  const primary = guardians.rows[0]?.guardian_user_id ?? null;
  await client.query(
    `update school_billing_accounts set primary_payer_user_id = coalesce($3, primary_payer_user_id)
      where id = $1 and organisation_id = $2`,
    [accountId, organisationId, primary],
  );
  await client.query(
    `insert into school_pupil_fee_profiles (organisation_id, student_profile_id, billing_account_id)
     values ($1,$2,$3)
     on conflict (organisation_id, student_profile_id)
     do update set billing_account_id = excluded.billing_account_id`,
    [organisationId, studentProfileId, accountId],
  );
  return accountId;
}

export async function createStaffChildLink(
  client: Client,
  input: {
    organisationId: string;
    actorUserId: string;
    staffUserId: string;
    studentProfileId: string;
    effectiveFrom?: string | null;
    effectiveUntil?: string | null;
  },
) {
  const staff = await client.query(
    `select 1
       from organisation_memberships m
       join membership_roles mr on mr.membership_id = m.id
       join roles r on r.id = mr.role_id
      where m.organisation_id = $1
        and m.user_id = $2
        and m.status = 'active'
        and r.key = any($3::text[])
      limit 1`,
    [input.organisationId, input.staffUserId, [...STAFF_ROLE_KEYS]],
  );
  if (!staff.rows[0]) {
    throw new AppError(400, "validation_failed", "Staff child links require an active staff membership");
  }
  const guardianship = await client.query<{ id: string }>(
    `select id from guardianships
      where organisation_id = $1
        and guardian_user_id = $2
        and student_profile_id = $3
        and (ended_on is null or ended_on >= current_date)
        and (started_on is null or started_on <= current_date)`,
    [input.organisationId, input.staffUserId, input.studentProfileId],
  );
  if (!guardianship.rows[0]) {
    throw new AppError(
      400,
      "validation_failed",
      "Staff child eligibility requires a live guardian relationship, not a name or email match",
    );
  }
  const created = await client.query(
    `insert into school_staff_child_links (
       organisation_id, staff_user_id, student_profile_id, guardianship_id,
       effective_from, effective_until, created_by
     ) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (organisation_id, staff_user_id, student_profile_id)
     do update set is_active = true,
                   guardianship_id = excluded.guardianship_id,
                   effective_from = excluded.effective_from,
                   effective_until = excluded.effective_until
     returning *`,
    [
      input.organisationId,
      input.staffUserId,
      input.studentProfileId,
      guardianship.rows[0].id,
      input.effectiveFrom ?? null,
      input.effectiveUntil ?? null,
      input.actorUserId,
    ],
  );
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.staff_child.linked",
    entityType: "school_staff_child_link",
    entityId: String(created.rows[0]!.id),
    after: { staffUserId: input.staffUserId, studentProfileId: input.studentProfileId },
  });
  return created.rows[0];
}

export async function revokeStaffChildLink(
  client: Client,
  input: { organisationId: string; actorUserId: string; linkId: string },
) {
  const updated = await client.query(
    `update school_staff_child_links
        set is_active = false
      where id = $1 and organisation_id = $2
      returning *`,
    [input.linkId, input.organisationId],
  );
  if (!updated.rows[0]) notFound();
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.staff_child.revoked",
    entityType: "school_staff_child_link",
    entityId: input.linkId,
  });
  return updated.rows[0];
}

export async function upsertPupilFeeProfile(
  client: Client,
  input: {
    organisationId: string;
    actorUserId: string;
    studentProfileId: string;
    academicYearId?: string | null;
    feeScheduleId?: string | null;
    overrideAmountMinor?: number | null;
    overrideBillingFrequency?: string | null;
    siblingPriority?: number | null;
    notes?: string | null;
  },
) {
  await ensureBillingAccount(client, input.organisationId, input.studentProfileId);
  const updated = await client.query(
    `insert into school_pupil_fee_profiles (
       organisation_id, student_profile_id, academic_year_id, fee_schedule_id,
       override_amount_minor, override_billing_frequency, sibling_priority, notes, created_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (organisation_id, student_profile_id)
     do update set academic_year_id = coalesce(excluded.academic_year_id, school_pupil_fee_profiles.academic_year_id),
                   fee_schedule_id = coalesce(excluded.fee_schedule_id, school_pupil_fee_profiles.fee_schedule_id),
                   override_amount_minor = excluded.override_amount_minor,
                   override_billing_frequency = excluded.override_billing_frequency,
                   sibling_priority = excluded.sibling_priority,
                   notes = coalesce(excluded.notes, school_pupil_fee_profiles.notes)
     returning *`,
    [
      input.organisationId,
      input.studentProfileId,
      input.academicYearId ?? null,
      input.feeScheduleId ?? null,
      input.overrideAmountMinor ?? null,
      input.overrideBillingFrequency ?? null,
      input.siblingPriority ?? null,
      input.notes ?? null,
      input.actorUserId,
    ],
  );
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.pupil_profile.updated",
    entityType: "school_pupil_fee_profile",
    entityId: String(updated.rows[0]!.id),
    after: { studentProfileId: input.studentProfileId },
  });
  return updated.rows[0];
}

export async function createPupilConcession(
  client: Client,
  input: {
    organisationId: string;
    actorUserId: string;
    studentProfileId: string;
    kind: string;
    name: string;
    amountType: string;
    percentBps?: number | null;
    amountMinor?: number | null;
    reason: string;
    stackingPriority?: number;
    exclusiveGroup?: string | null;
    discountRuleId?: string | null;
    effectiveFrom?: string | null;
    effectiveUntil?: string | null;
  },
) {
  if (!isSchoolDiscountKind(input.kind) || !isSchoolDiscountAmountType(input.amountType)) {
    throw new AppError(400, "validation_failed", "Invalid concession");
  }
  const created = await client.query(
    `insert into school_pupil_concessions (
       organisation_id, student_profile_id, discount_rule_id, kind, name, amount_type,
       percent_bps, amount_minor, stacking_priority, exclusive_group, reason,
       effective_from, effective_until, created_by, approved_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
     returning *`,
    [
      input.organisationId,
      input.studentProfileId,
      input.discountRuleId ?? null,
      input.kind,
      input.name,
      input.amountType,
      input.percentBps ?? null,
      input.amountMinor ?? null,
      input.stackingPriority ?? 50,
      input.exclusiveGroup ?? null,
      input.reason,
      input.effectiveFrom ?? null,
      input.effectiveUntil ?? null,
      input.actorUserId,
    ],
  );
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.concession.created",
    entityType: "school_pupil_concession",
    entityId: String(created.rows[0]!.id),
    after: { studentProfileId: input.studentProfileId, kind: input.kind },
  });
  return created.rows[0];
}

type EligiblePupil = {
  studentProfileId: string;
  legalName: string;
  dateOfBirth: string | null;
  yearGroupId: string | null;
  yearGroupName: string | null;
  yearGroupSort: number;
  classId: string | null;
  enrolStart: string;
  enrolEnd: string | null;
  enrolmentStatus: string;
  siblingPriority: number | null;
  feeScheduleId: string | null;
  overrideAmountMinor: number | null;
};

async function loadEligiblePupils(
  client: Client,
  organisationId: string,
  academicYearId: string,
  asOf: string,
): Promise<EligiblePupil[]> {
  const rows = await client.query(
    `select sp.id as student_profile_id,
            sp.legal_name,
            u.date_of_birth::text as date_of_birth,
            se.year_group_id,
            yg.name as year_group_name,
            yg.sort_order as year_group_sort,
            cm.class_id,
            se.started_on::text as enrol_start,
            se.ended_on::text as enrol_end,
            se.status as enrolment_status,
            p.sibling_priority,
            p.fee_schedule_id,
            p.override_amount_minor
       from student_enrolments se
       join student_profiles sp on sp.id = se.student_profile_id
       left join users u on u.id = sp.user_id
       join year_groups yg on yg.id = se.year_group_id
       left join class_memberships cm
         on cm.student_profile_id = sp.id
        and cm.academic_year_id = se.academic_year_id
        and cm.ended_on is null
       left join school_pupil_fee_profiles p
         on p.student_profile_id = sp.id and p.organisation_id = se.organisation_id
      where se.organisation_id = $1
        and se.academic_year_id = $2
        and se.is_primary
        and se.status in ('planned', 'enrolled')
        and se.started_on <= $3::date
        and (se.ended_on is null or se.ended_on >= $3::date)
        and sp.enrolment_status in ('admitted', 'enrolled')
      order by yg.sort_order, sp.legal_name, sp.id`,
    [organisationId, academicYearId, asOf],
  );
  return rows.rows.map((row) => ({
    studentProfileId: String(row.student_profile_id),
    legalName: String(row.legal_name ?? ""),
    dateOfBirth: row.date_of_birth ? String(row.date_of_birth) : null,
    yearGroupId: row.year_group_id ? String(row.year_group_id) : null,
    yearGroupName: row.year_group_name ? String(row.year_group_name) : null,
    yearGroupSort: Number(row.year_group_sort ?? 0),
    classId: row.class_id ? String(row.class_id) : null,
    enrolStart: String(row.enrol_start),
    enrolEnd: row.enrol_end ? String(row.enrol_end) : null,
    enrolmentStatus: String(row.enrolment_status),
    siblingPriority: row.sibling_priority == null ? null : Number(row.sibling_priority),
    feeScheduleId: row.fee_schedule_id ? String(row.fee_schedule_id) : null,
    overrideAmountMinor: row.override_amount_minor == null ? null : Number(row.override_amount_minor),
  }));
}

async function resolveFeeSchedule(
  client: Client,
  organisationId: string,
  pupil: EligiblePupil,
  academicYearId: string,
  asOf: string,
) {
  if (pupil.feeScheduleId) {
    const assigned = await client.query(
      `select * from school_fee_schedules
        where id = $1 and organisation_id = $2 and is_active
          and effective_from <= $3::date
          and (effective_until is null or effective_until >= $3::date)`,
      [pupil.feeScheduleId, organisationId, asOf],
    );
    if (assigned.rows[0]) return assigned.rows[0] as Record<string, unknown>;
  }
  const rows = await client.query(
    `select * from school_fee_schedules
      where organisation_id = $1
        and academic_year_id = $2
        and is_active
        and effective_from <= $3::date
        and (effective_until is null or effective_until >= $3::date)
        and (
          class_id = $4
          or (class_id is null and year_group_id = $5)
          or (class_id is null and year_group_id is null)
        )
      order by
        case when class_id is not null then 0
             when year_group_id is not null then 1
             else 2 end,
        name
      limit 1`,
    [organisationId, academicYearId, asOf, pupil.classId, pupil.yearGroupId],
  );
  return (rows.rows[0] as Record<string, unknown> | undefined) ?? null;
}

async function instalmentAmount(
  client: Client,
  schedule: Record<string, unknown>,
  instalmentNumber: number | null,
): Promise<number> {
  if (instalmentNumber) {
    const custom = await client.query<{ amount_minor: string }>(
      `select amount_minor::text from school_fee_schedule_instalments
        where fee_schedule_id = $1 and sequence = $2`,
      [schedule.id, instalmentNumber],
    );
    if (custom.rows[0]) return Number(custom.rows[0].amount_minor);
  }
  const annual = schedule.annual_amount_minor == null ? null : Number(schedule.annual_amount_minor);
  const count = schedule.instalment_count == null ? null : Number(schedule.instalment_count);
  if (annual != null && count && instalmentNumber) {
    return splitAnnualIntoInstalments(annual, count)[instalmentNumber - 1] ?? Number(schedule.amount_minor);
  }
  return Number(schedule.amount_minor);
}

async function staffQualifies(
  client: Client,
  organisationId: string,
  staffUserId: string,
  scope: string | null,
  roleKeys: string[],
): Promise<boolean> {
  const allowed =
    scope === "teachers"
      ? ["school.teacher"]
      : scope === "selected_roles"
        ? roleKeys
        : [...STAFF_ROLE_KEYS];
  const row = await client.query(
    `select 1
       from organisation_memberships m
       join membership_roles mr on mr.membership_id = m.id
       join roles r on r.id = mr.role_id
      where m.organisation_id = $1
        and m.user_id = $2
        and m.status = 'active'
        and r.key = any($3::text[])
      limit 1`,
    [organisationId, staffUserId, allowed],
  );
  return Boolean(row.rows[0]);
}

async function collectDiscountCandidates(
  client: Client,
  input: {
    organisationId: string;
    settings: FinanceSettings;
    pupil: EligiblePupil;
    family: EligiblePupil[];
    asOf: string;
  },
): Promise<DiscountCandidate[]> {
  const candidates: DiscountCandidate[] = [];
  const rules = await listDiscountRules(client, input.organisationId);
  const siblings = orderSiblings(
    input.family.map(
      (member): SiblingSortInput => ({
        studentProfileId: member.studentProfileId,
        dateOfBirth: member.dateOfBirth,
        legalName: member.legalName,
        yearGroupSort: member.yearGroupSort,
        explicitPriority: member.siblingPriority,
      }),
    ),
    input.settings.siblingOrderMode,
  );
  const siblingPosition = siblings.findIndex((row) => row.studentProfileId === input.pupil.studentProfileId) + 1;

  for (const rule of rules.filter((item) => item.isActive && item.kind === "sibling")) {
    const matchingTiers = rule.tiers.filter((tier) => tier.siblingPosition <= siblingPosition);
    const tier =
      matchingTiers.sort((a, b) => b.siblingPosition - a.siblingPosition)[0] ??
      rule.tiers.find((item) => item.siblingPosition === siblingPosition);
    if (!tier || siblingPosition <= 1) continue;
    candidates.push({
      key: `rule:${rule.id}`,
      ruleId: String(rule.id),
      concessionId: null,
      kind: "sibling",
      name: `${rule.name} (child ${siblingPosition})`,
      amountType: tier.amountType as "percent" | "fixed",
      percentBps: tier.percentBps,
      amountMinor: tier.amountMinor,
      stackingPriority: rule.stackingPriority,
      exclusiveGroup: rule.exclusiveGroup ? String(rule.exclusiveGroup) : "family",
    });
  }

  const staffRules = rules.filter((item) => item.isActive && item.kind === "staff_child");
  if (staffRules.length) {
    const links = await client.query<{ staff_user_id: string }>(
      `select l.staff_user_id
         from school_staff_child_links l
         join guardianships g on g.id = l.guardianship_id
        where l.organisation_id = $1
          and l.student_profile_id = $2
          and l.is_active
          and (l.effective_from is null or l.effective_from <= $3::date)
          and (l.effective_until is null or l.effective_until >= $3::date)
          and g.guardian_user_id = l.staff_user_id
          and g.student_profile_id = l.student_profile_id
          and (g.ended_on is null or g.ended_on >= current_date)
          and (g.started_on is null or g.started_on <= current_date)`,
      [input.organisationId, input.pupil.studentProfileId, input.asOf],
    );
    for (const rule of staffRules) {
      let eligible = false;
      for (const link of links.rows) {
        if (await staffQualifies(client, input.organisationId, link.staff_user_id, rule.staffScope, rule.staffRoleKeys as string[])) {
          eligible = true;
          break;
        }
      }
      if (!eligible) continue;
      candidates.push({
        key: `rule:${rule.id}`,
        ruleId: String(rule.id),
        concessionId: null,
        kind: "staff_child",
        name: String(rule.name),
        amountType: rule.amountType as "percent" | "fixed",
        percentBps: rule.percentBps,
        amountMinor: rule.amountMinor,
        stackingPriority: rule.stackingPriority,
        exclusiveGroup: rule.exclusiveGroup ? String(rule.exclusiveGroup) : "family",
      });
    }
  }

  const concessions = await client.query(
    `select * from school_pupil_concessions
      where organisation_id = $1
        and student_profile_id = $2
        and is_active
        and (effective_from is null or effective_from <= $3::date)
        and (effective_until is null or effective_until >= $3::date)`,
    [input.organisationId, input.pupil.studentProfileId, input.asOf],
  );
  for (const row of concessions.rows) {
    candidates.push({
      key: `concession:${row.id}`,
      ruleId: row.discount_rule_id ? String(row.discount_rule_id) : null,
      concessionId: String(row.id),
      kind: String(row.kind),
      name: String(row.name),
      amountType: row.amount_type as "percent" | "fixed",
      percentBps: row.percent_bps == null ? null : Number(row.percent_bps),
      amountMinor: row.amount_minor == null ? null : Number(row.amount_minor),
      stackingPriority: Number(row.stacking_priority),
      exclusiveGroup: row.exclusive_group ? String(row.exclusive_group) : null,
    });
  }

  return candidates;
}

export type PupilFeeQuote = {
  studentProfileId: string;
  legalName: string;
  yearGroupName: string | null;
  feeScheduleId: string | null;
  feeScheduleName: string | null;
  billingFrequency: string | null;
  siblingPosition: number | null;
  standardAmountMinor: number;
  appliedDiscounts: AppliedDiscount[];
  discardedDiscounts: Array<DiscountCandidate & { reason: string }>;
  discountTotalMinor: number;
  netAmountMinor: number;
  currency: string;
  warning: string | null;
  error: string | null;
  calculation: Record<string, unknown>;
};

export async function quotePupilTuition(
  client: Client,
  input: {
    organisationId: string;
    academicYearId: string;
    periodStart: string;
    periodEnd: string;
    frequency: SchoolBillingFrequency;
    instalmentNumber?: number | null;
    studentProfileId?: string;
  },
): Promise<PupilFeeQuote[]> {
  const settings = await loadFinanceSettings(client, input.organisationId);
  const pupils = await loadEligiblePupils(client, input.organisationId, input.academicYearId, input.periodStart);
  const selected = input.studentProfileId
    ? pupils.filter((pupil) => pupil.studentProfileId === input.studentProfileId)
    : pupils;
  const quotes: PupilFeeQuote[] = [];
  for (const pupil of selected) {
    const familyIds = await familyStudentIds(client, input.organisationId, pupil.studentProfileId);
    const family = pupils.filter((member) => familyIds.includes(member.studentProfileId));
    const schedule = await resolveFeeSchedule(
      client,
      input.organisationId,
      pupil,
      input.academicYearId,
      input.periodStart,
    );
    if (!schedule) {
      quotes.push({
        studentProfileId: pupil.studentProfileId,
        legalName: pupil.legalName,
        yearGroupName: pupil.yearGroupName,
        feeScheduleId: null,
        feeScheduleName: null,
        billingFrequency: null,
        siblingPosition: null,
        standardAmountMinor: 0,
        appliedDiscounts: [],
        discardedDiscounts: [],
        discountTotalMinor: 0,
        netAmountMinor: 0,
        currency: settings.currency,
        warning: "no_fee_schedule",
        error: null,
        calculation: { reason: "No active fee schedule matches this pupil" },
      });
      continue;
    }
    const baseAmount =
      pupil.overrideAmountMinor ?? (await instalmentAmount(client, schedule, input.instalmentNumber ?? null));
    const join = applyMidPeriodPolicy({
      amountMinor: baseAmount,
      policy: settings.midPeriodJoinPolicy,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      enrolStart: pupil.enrolStart,
      enrolEnd: pupil.enrolEnd,
    });
    if (join.skipped) {
      quotes.push({
        studentProfileId: pupil.studentProfileId,
        legalName: pupil.legalName,
        yearGroupName: pupil.yearGroupName,
        feeScheduleId: String(schedule.id),
        feeScheduleName: String(schedule.name),
        billingFrequency: String(schedule.billing_frequency),
        siblingPosition: null,
        standardAmountMinor: baseAmount,
        appliedDiscounts: [],
        discardedDiscounts: [],
        discountTotalMinor: 0,
        netAmountMinor: 0,
        currency: String(schedule.currency),
        warning: "manual_mid_period",
        error: null,
        calculation: { policy: settings.midPeriodJoinPolicy, chargeableDays: join.chargeableDays },
      });
      continue;
    }
    const candidates = await collectDiscountCandidates(client, {
      organisationId: input.organisationId,
      settings,
      pupil,
      family,
      asOf: input.periodStart,
    });
    const applied = applyDiscounts(join.amountMinor, candidates, settings.discountStackingMode);
    const siblings = orderSiblings(
      family.map((member) => ({
        studentProfileId: member.studentProfileId,
        dateOfBirth: member.dateOfBirth,
        legalName: member.legalName,
        yearGroupSort: member.yearGroupSort,
        explicitPriority: member.siblingPriority,
      })),
      settings.siblingOrderMode,
    );
    quotes.push({
      studentProfileId: pupil.studentProfileId,
      legalName: pupil.legalName,
      yearGroupName: pupil.yearGroupName,
      feeScheduleId: String(schedule.id),
      feeScheduleName: String(schedule.name),
      billingFrequency: String(schedule.billing_frequency),
      siblingPosition: siblings.findIndex((row) => row.studentProfileId === pupil.studentProfileId) + 1,
      standardAmountMinor: join.amountMinor,
      appliedDiscounts: applied.applied,
      discardedDiscounts: applied.discarded,
      discountTotalMinor: applied.discountTotalMinor,
      netAmountMinor: applied.netMinor,
      currency: String(schedule.currency),
      warning: join.prorated ? "prorated" : null,
      error: null,
      calculation: {
        scheduleAmountMinor: Number(schedule.amount_minor),
        overrideAmountMinor: pupil.overrideAmountMinor,
        stackingMode: settings.discountStackingMode,
        siblingOrderMode: settings.siblingOrderMode,
        prorated: join.prorated,
        chargeableDays: join.chargeableDays,
        periodDays: join.periodDays,
        familyStudentIds: family.map((member) => member.studentProfileId),
      },
    });
  }
  return quotes;
}

export async function previewBillingRun(
  client: Client,
  input: {
    organisationId: string;
    actorUserId: string;
    academicYearId: string;
    frequency: string;
    periodStart: string;
    periodEnd: string;
    dueOn?: string | null;
    instalmentNumber?: number | null;
  },
) {
  const settings = await loadFinanceSettings(client, input.organisationId);
  if (!settings.tuitionEnabled) {
    throw new AppError(409, "tuition_disabled", "Tuition billing is disabled for this school");
  }
  if (!isSchoolBillingFrequency(input.frequency)) {
    throw new AppError(400, "validation_failed", "Invalid billing frequency");
  }
  const periodKey = billingPeriodKey(input.frequency, input.periodStart, input.periodEnd);
  const existing = await client.query(`select * from school_billing_runs where organisation_id = $1 and period_key = $2`, [
    input.organisationId,
    periodKey,
  ]);
  if (existing.rows[0] && existing.rows[0].status === "confirmed") {
    return loadBillingRun(client, input.organisationId, String(existing.rows[0].id));
  }
  const quotes = await quotePupilTuition(client, {
    organisationId: input.organisationId,
    academicYearId: input.academicYearId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    frequency: input.frequency,
    instalmentNumber: input.instalmentNumber ?? null,
  });
  const dueOn =
    input.dueOn ??
    new Date(Date.parse(`${input.periodStart}T00:00:00Z`) + settings.paymentDueDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
  const runId = existing.rows[0] ? String(existing.rows[0].id) : null;
  const reference =
    existing.rows[0]?.reference ?? (await nextFinanceReference(client, input.organisationId, "billing_run"));
  const totals = quotes.reduce(
    (acc, quote) => {
      acc.expected += quote.netAmountMinor;
      if (quote.warning) acc.warnings += 1;
      if (quote.error) acc.errors += 1;
      return acc;
    },
    { expected: 0, warnings: 0, errors: 0 },
  );
  const saved = runId
    ? await client.query(
        `update school_billing_runs
            set academic_year_id = $3,
                billing_frequency = $4,
                period_start = $5,
                period_end = $6,
                due_on = $7,
                instalment_number = $8,
                status = 'previewed',
                item_count = $9,
                warning_count = $10,
                error_count = $11,
                expected_total_minor = $12,
                currency = $13
          where id = $1 and organisation_id = $2
          returning *`,
        [
          runId,
          input.organisationId,
          input.academicYearId,
          input.frequency,
          input.periodStart,
          input.periodEnd,
          dueOn,
          input.instalmentNumber ?? null,
          quotes.length,
          totals.warnings,
          totals.errors,
          totals.expected,
          settings.currency,
        ],
      )
    : await client.query(
        `insert into school_billing_runs (
           organisation_id, reference, period_key, academic_year_id, billing_frequency,
           period_start, period_end, due_on, instalment_number, status, item_count,
           warning_count, error_count, expected_total_minor, currency, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'previewed',$10,$11,$12,$13,$14,$15)
         returning *`,
        [
          input.organisationId,
          reference,
          periodKey,
          input.academicYearId,
          input.frequency,
          input.periodStart,
          input.periodEnd,
          dueOn,
          input.instalmentNumber ?? null,
          quotes.length,
          totals.warnings,
          totals.errors,
          totals.expected,
          settings.currency,
          input.actorUserId,
        ],
      );
  const billingRun = saved.rows[0] as Record<string, unknown>;
  await client.query(`delete from school_billing_run_items where billing_run_id = $1 and organisation_id = $2`, [
    billingRun.id,
    input.organisationId,
  ]);
  for (const quote of quotes) {
    const accountId = await ensureBillingAccount(client, input.organisationId, quote.studentProfileId);
    await client.query(
      `insert into school_billing_run_items (
         organisation_id, billing_run_id, student_profile_id, billing_account_id, fee_schedule_id,
         standard_amount_minor, discount_total_minor, net_amount_minor, currency,
         sibling_position, calculation, warning_code, error_code
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)`,
      [
        input.organisationId,
        billingRun.id,
        quote.studentProfileId,
        accountId,
        quote.feeScheduleId,
        quote.standardAmountMinor,
        quote.discountTotalMinor,
        quote.netAmountMinor,
        quote.currency,
        quote.siblingPosition,
        JSON.stringify({
          ...quote.calculation,
          applied: quote.appliedDiscounts,
          discarded: quote.discardedDiscounts,
          feeScheduleName: quote.feeScheduleName,
          legalName: quote.legalName,
          yearGroupName: quote.yearGroupName,
        }),
        quote.warning,
        quote.error,
      ],
    );
  }
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.billing_run.previewed",
    entityType: "school_billing_run",
    entityId: String(billingRun.id),
    after: { periodKey, itemCount: quotes.length, expectedTotalMinor: totals.expected },
  });
  return loadBillingRun(client, input.organisationId, String(billingRun.id));
}

export async function confirmBillingRun(
  client: Client,
  input: { organisationId: string; actorUserId: string; billingRunId: string },
) {
  const run = await client.query(`select * from school_billing_runs where id = $1 and organisation_id = $2 for update`, [
    input.billingRunId,
    input.organisationId,
  ]);
  if (!run.rows[0]) notFound();
  if (run.rows[0].status === "confirmed") {
    return loadBillingRun(client, input.organisationId, input.billingRunId);
  }
  if (run.rows[0].status === "cancelled") {
    throw new AppError(409, "invalid_status_transition", "This billing run was cancelled");
  }
  const settings = await loadFinanceSettings(client, input.organisationId);
  const items = await client.query(
    `select * from school_billing_run_items where billing_run_id = $1 and organisation_id = $2`,
    [input.billingRunId, input.organisationId],
  );
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const item of items.rows) {
    if (item.error_code || Number(item.net_amount_minor) <= 0) continue;
    const accountId = String(item.billing_account_id);
    const list = grouped.get(accountId) ?? [];
    list.push(item as Record<string, unknown>);
    grouped.set(accountId, list);
  }
  for (const [accountId, group] of grouped) {
    const existingInvoice = await client.query(
      `select id from school_invoices
        where organisation_id = $1 and billing_account_id = $2 and period_key = $3 and status <> 'void'`,
      [input.organisationId, accountId, run.rows[0].period_key],
    );
    if (existingInvoice.rows[0]) {
      for (const item of group) {
        await client.query(
          `update school_billing_run_items set invoice_id = $3 where id = $1 and organisation_id = $2`,
          [item.id, input.organisationId, existingInvoice.rows[0].id],
        );
      }
      continue;
    }
    const account = await client.query<{ primary_payer_user_id: string | null }>(
      `select primary_payer_user_id from school_billing_accounts where id = $1`,
      [accountId],
    );
    const reference = await nextFinanceReference(client, input.organisationId, "invoice");
    const invoice = await client.query(
      `insert into school_invoices (
         organisation_id, reference, billing_account_id, payer_user_id, academic_year_id,
         billing_run_id, period_key, billing_period_start, billing_period_end, invoice_date,
         due_date, status, currency, payment_instructions_snapshot, invoice_footer_snapshot,
         calculation_snapshot, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,current_date,$10,'draft',$11,$12,$13,$14::jsonb,$15)
       returning *`,
      [
        input.organisationId,
        reference,
        accountId,
        account.rows[0]?.primary_payer_user_id ?? null,
        run.rows[0].academic_year_id,
        input.billingRunId,
        run.rows[0].period_key,
        run.rows[0].period_start,
        run.rows[0].period_end,
        run.rows[0].due_on,
        settings.currency,
        settings.paymentInstructions,
        settings.invoiceFooter,
        JSON.stringify({ stackingMode: settings.discountStackingMode, siblingOrderMode: settings.siblingOrderMode }),
        input.actorUserId,
      ],
    );
    const invoiceId = String(invoice.rows[0]!.id);
    let sort = 0;
    let subtotal = 0;
    let discounts = 0;
    for (const item of group) {
      const calc = (item.calculation ?? {}) as Record<string, unknown>;
      await client.query(
        `insert into school_invoice_lines (
           organisation_id, invoice_id, sort_order, kind, student_profile_id, fee_schedule_id,
           description, quantity, unit_amount_minor, amount_minor, calculation_snapshot
         ) values ($1,$2,$3,'tuition',$4,$5,$6,1,$7,$7,$8::jsonb)`,
        [
          input.organisationId,
          invoiceId,
          sort,
          item.student_profile_id,
          item.fee_schedule_id,
          `${String(calc.legalName ?? "Pupil")} tuition`,
          Number(item.standard_amount_minor),
          JSON.stringify(calc),
        ],
      );
      subtotal += Number(item.standard_amount_minor);
      sort += 1;
      const applied = Array.isArray(calc.applied) ? (calc.applied as AppliedDiscount[]) : [];
      for (const discount of applied) {
        await client.query(
          `insert into school_invoice_lines (
             organisation_id, invoice_id, sort_order, kind, student_profile_id, discount_rule_id,
             concession_id, description, quantity, unit_amount_minor, amount_minor, calculation_snapshot
           ) values ($1,$2,$3,'discount',$4,$5,$6,$7,1,$8,$9,$10::jsonb)`,
          [
            input.organisationId,
            invoiceId,
            sort,
            item.student_profile_id,
            discount.ruleId,
            discount.concessionId,
            discount.name,
            discount.calculatedMinor,
            -discount.calculatedMinor,
            JSON.stringify(discount),
          ],
        );
        discounts += discount.calculatedMinor;
        sort += 1;
      }
      await client.query(
        `update school_billing_run_items set invoice_id = $3 where id = $1 and organisation_id = $2`,
        [item.id, input.organisationId, invoiceId],
      );
    }
    const total = subtotal - discounts;
    const status = deriveInvoiceStatus({
      current: "issued",
      totalMinor: total,
      paidMinor: 0,
      creditMinor: 0,
      dueDate: asIsoDate(run.rows[0].due_on),
      gracePeriodDays: settings.gracePeriodDays,
    });
    await client.query(
      `update school_invoices
          set subtotal_minor = $3,
              discount_total_minor = $4,
              total_minor = $5,
              outstanding_minor = $5,
              status = $7,
              issued_by = $6,
              issued_at = now()
        where id = $1 and organisation_id = $2`,
      [invoiceId, input.organisationId, subtotal, discounts, total, input.actorUserId, status],
    );
    await writeAudit(client, {
      organisationId: input.organisationId,
      actorUserId: input.actorUserId,
      action: "finance.invoice.issued",
      entityType: "school_invoice",
      entityId: invoiceId,
      after: { reference, totalMinor: total, periodKey: run.rows[0].period_key },
    });
  }
  await client.query(
    `update school_billing_runs
        set status = 'confirmed', confirmed_by = $3, confirmed_at = now()
      where id = $1 and organisation_id = $2`,
    [input.billingRunId, input.organisationId, input.actorUserId],
  );
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.billing_run.confirmed",
    entityType: "school_billing_run",
    entityId: input.billingRunId,
    after: { periodKey: run.rows[0].period_key },
  });
  return loadBillingRun(client, input.organisationId, input.billingRunId);
}

export async function loadBillingRun(client: Client, organisationId: string, billingRunId: string) {
  const run = await client.query(
    `select r.*, y.name as academic_year_name
       from school_billing_runs r
       join academic_years y on y.id = r.academic_year_id
      where r.id = $1 and r.organisation_id = $2`,
    [billingRunId, organisationId],
  );
  if (!run.rows[0]) notFound();
  const items = await client.query(
    `select i.*, sp.legal_name
       from school_billing_run_items i
       join student_profiles sp on sp.id = i.student_profile_id
      where i.billing_run_id = $1 and i.organisation_id = $2
      order by sp.legal_name`,
    [billingRunId, organisationId],
  );
  return {
    run: mapBillingRun(run.rows[0] as Record<string, unknown>),
    items: items.rows.map((row) => ({
      id: row.id,
      studentProfileId: row.student_profile_id,
      legalName: row.legal_name,
      billingAccountId: row.billing_account_id,
      feeScheduleId: row.fee_schedule_id,
      standardAmountMinor: Number(row.standard_amount_minor),
      discountTotalMinor: Number(row.discount_total_minor),
      netAmountMinor: Number(row.net_amount_minor),
      currency: row.currency,
      siblingPosition: row.sibling_position == null ? null : Number(row.sibling_position),
      warning: row.warning_code,
      error: row.error_code,
      invoiceId: row.invoice_id,
      calculation: row.calculation,
    })),
  };
}

function mapBillingRun(row: Record<string, unknown>) {
  return {
    id: row.id,
    reference: row.reference,
    periodKey: row.period_key,
    academicYearId: row.academic_year_id,
    academicYearName: row.academic_year_name ?? null,
    billingFrequency: row.billing_frequency,
    periodStart: asIsoDate(row.period_start),
    periodEnd: asIsoDate(row.period_end),
    dueOn: asIsoDate(row.due_on),
    instalmentNumber: row.instalment_number == null ? null : Number(row.instalment_number),
    status: row.status,
    itemCount: Number(row.item_count),
    warningCount: Number(row.warning_count),
    errorCount: Number(row.error_count),
    expectedTotalMinor: Number(row.expected_total_minor),
    currency: row.currency,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? null,
  };
}

export async function listBillingRuns(client: Client, organisationId: string) {
  const rows = await client.query(
    `select r.*, y.name as academic_year_name
       from school_billing_runs r
       join academic_years y on y.id = r.academic_year_id
      where r.organisation_id = $1
      order by r.created_at desc
      limit 50`,
    [organisationId],
  );
  return rows.rows.map((row) => mapBillingRun(row as Record<string, unknown>));
}

function mapInvoice(row: Record<string, unknown>) {
  return {
    id: row.id,
    reference: row.reference,
    billingAccountId: row.billing_account_id,
    billingAccountName: row.billing_account_name ?? null,
    payerUserId: row.payer_user_id ?? null,
    payerName: row.payer_name ?? null,
    academicYearId: row.academic_year_id ?? null,
    periodKey: row.period_key,
    billingPeriodStart: asIsoDate(row.billing_period_start),
    billingPeriodEnd: asIsoDate(row.billing_period_end),
    invoiceDate: asIsoDate(row.invoice_date),
    dueDate: asIsoDate(row.due_date),
    status: row.status,
    currency: row.currency,
    subtotalMinor: Number(row.subtotal_minor),
    discountTotalMinor: Number(row.discount_total_minor),
    creditTotalMinor: Number(row.credit_total_minor),
    totalMinor: Number(row.total_minor),
    paidMinor: Number(row.paid_minor),
    outstandingMinor: Number(row.outstanding_minor),
    paymentInstructions: row.payment_instructions_snapshot ?? null,
    invoiceFooter: row.invoice_footer_snapshot ?? null,
    deliveryState: row.delivery_state,
    issuedAt: row.issued_at ?? null,
    voidedAt: row.voided_at ?? null,
    voidReason: row.void_reason ?? null,
  };
}

export async function refreshInvoiceStatus(client: Client, organisationId: string, invoiceId: string) {
  const invoice = await client.query(`select * from school_invoices where id = $1 and organisation_id = $2 for update`, [
    invoiceId,
    organisationId,
  ]);
  if (!invoice.rows[0]) notFound();
  const row = invoice.rows[0] as Record<string, unknown>;
  if (row.status === "void" || row.status === "draft") return row;
  const settings = await loadFinanceSettings(client, organisationId);
  const paid = Number(row.paid_minor);
  const credits = Number(row.credit_total_minor ?? 0);
  const total = Number(row.total_minor);
  const outstanding = invoiceOutstandingMinor(total, paid, credits);
  const next = deriveInvoiceStatus({
    current: String(row.status) as SchoolInvoiceStatus,
    totalMinor: total,
    paidMinor: paid,
    creditMinor: credits,
    dueDate: asIsoDate(row.due_date),
    gracePeriodDays: settings.gracePeriodDays,
  });
  await client.query(
    `update school_invoices
        set outstanding_minor = $3, status = $4
      where id = $1 and organisation_id = $2`,
    [invoiceId, organisationId, outstanding, next],
  );
  row.outstanding_minor = outstanding;
  row.status = next;
  return row;
}

async function syncOverdueInvoiceStatuses(client: Client, organisationId: string) {
  const settings = await loadFinanceSettings(client, organisationId);
  const today = new Date().toISOString().slice(0, 10);
  await client.query(
    `update school_invoices
        set status = 'overdue'
      where organisation_id = $1
        and status in ('issued', 'partially_paid')
        and outstanding_minor > 0
        and $2::date > (due_date + $3::int)`,
    [organisationId, today, settings.gracePeriodDays],
  );
}

export async function listInvoices(
  client: Client,
  organisationId: string,
  filters: { status?: string; billingAccountId?: string; studentId?: string } = {},
) {
  await syncOverdueInvoiceStatuses(client, organisationId);
  const rows = await client.query(
    `select i.*, a.name as billing_account_name, u.full_name as payer_name
       from school_invoices i
       join school_billing_accounts a on a.id = i.billing_account_id
       left join users u on u.id = i.payer_user_id
      where i.organisation_id = $1
        and ($2::text is null or i.status = $2)
        and ($3::uuid is null or i.billing_account_id = $3)
        and (
          $4::uuid is null
          or exists (
            select 1 from school_invoice_lines l
            where l.invoice_id = i.id and l.student_profile_id = $4
          )
        )
      order by i.invoice_date desc, i.reference desc
      limit 200`,
    [organisationId, filters.status ?? null, filters.billingAccountId ?? null, filters.studentId ?? null],
  );
  return rows.rows.map((row) => mapInvoice(row as Record<string, unknown>));
}

export async function loadInvoice(client: Client, organisationId: string, invoiceId: string) {
  await refreshInvoiceStatus(client, organisationId, invoiceId);
  const row = await client.query(
    `select i.*, a.name as billing_account_name, u.full_name as payer_name
       from school_invoices i
       join school_billing_accounts a on a.id = i.billing_account_id
       left join users u on u.id = i.payer_user_id
      where i.id = $1 and i.organisation_id = $2`,
    [invoiceId, organisationId],
  );
  if (!row.rows[0]) notFound();
  const lines = await client.query(
    `select l.*, sp.legal_name
       from school_invoice_lines l
       left join student_profiles sp on sp.id = l.student_profile_id
      where l.invoice_id = $1 and l.organisation_id = $2
      order by l.sort_order`,
    [invoiceId, organisationId],
  );
  const payments = await client.query(
    `select * from school_invoice_payments where invoice_id = $1 and organisation_id = $2 order by recorded_at`,
    [invoiceId, organisationId],
  );
  const credits = await client.query(
    `select * from school_invoice_credits where invoice_id = $1 and organisation_id = $2 order by created_at`,
    [invoiceId, organisationId],
  );
  return {
    invoice: mapInvoice(row.rows[0] as Record<string, unknown>),
    lines: lines.rows.map((line) => ({
      id: line.id,
      kind: line.kind,
      studentProfileId: line.student_profile_id,
      studentLegalName: line.legal_name ?? null,
      chargeId: line.charge_id,
      description: line.description,
      quantity: Number(line.quantity),
      unitAmountMinor: Number(line.unit_amount_minor),
      amountMinor: Number(line.amount_minor),
      calculation: line.calculation_snapshot,
    })),
    payments: payments.rows.map(mapInvoicePayment),
    credits: credits.rows.map(mapCredit),
  };
}

function mapInvoicePayment(row: Record<string, unknown>) {
  return {
    id: row.id,
    reference: row.reference,
    invoiceId: row.invoice_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    method: row.method,
    receivedOn: asIsoDate(row.received_on),
    externalReference: row.external_reference ?? null,
    note: row.note ?? null,
    status: row.status,
    recordedAt: row.recorded_at,
    reversedAt: row.reversed_at ?? null,
  };
}

function mapCredit(row: Record<string, unknown>) {
  return {
    id: row.id,
    reference: row.reference,
    invoiceId: row.invoice_id ?? null,
    billingAccountId: row.billing_account_id,
    kind: row.kind,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    reversedAt: row.reversed_at ?? null,
  };
}

export async function recordInvoicePayment(
  client: Client,
  input: {
    organisationId: string;
    actorUserId: string;
    invoiceId: string;
    amountMinor: number;
    method: string;
    receivedOn?: string;
    externalReference?: string | null;
    note?: string | null;
    idempotencyKey?: string | null;
  },
) {
  if (!isSchoolInvoicePaymentMethod(input.method)) {
    throw new AppError(400, "validation_failed", "Invalid payment method");
  }
  if (input.idempotencyKey) {
    const existing = await client.query(
      `select * from school_invoice_payments where organisation_id = $1 and idempotency_key = $2`,
      [input.organisationId, input.idempotencyKey],
    );
    if (existing.rows[0]) return mapInvoicePayment(existing.rows[0] as Record<string, unknown>);
  }
  const invoice = await refreshInvoiceStatus(client, input.organisationId, input.invoiceId);
  if (!["issued", "partially_paid", "overdue"].includes(String(invoice.status))) {
    throw new AppError(409, "invalid_status_transition", "This invoice cannot accept payments");
  }
  const outstanding = Number(invoice.outstanding_minor);
  if (input.amountMinor > outstanding) {
    throw new AppError(409, "overpayment", "This payment would exceed the amount outstanding");
  }
  const reference = await nextFinanceReference(client, input.organisationId, "payment");
  const inserted = await client.query(
    `insert into school_invoice_payments (
       organisation_id, invoice_id, billing_account_id, reference, amount_minor, currency,
       method, received_on, external_reference, note, idempotency_key, recorded_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning *`,
    [
      input.organisationId,
      input.invoiceId,
      invoice.billing_account_id,
      reference,
      input.amountMinor,
      invoice.currency,
      input.method,
      input.receivedOn ?? new Date().toISOString().slice(0, 10),
      input.externalReference ?? null,
      input.note ?? null,
      input.idempotencyKey ?? null,
      input.actorUserId,
    ],
  );
  await client.query(
    `update school_invoices set paid_minor = paid_minor + $3 where id = $1 and organisation_id = $2`,
    [input.invoiceId, input.organisationId, input.amountMinor],
  );
  await refreshInvoiceStatus(client, input.organisationId, input.invoiceId);
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.invoice.payment_recorded",
    entityType: "school_invoice_payment",
    entityId: String(inserted.rows[0]!.id),
    after: { reference, amountMinor: input.amountMinor, method: input.method, invoiceId: input.invoiceId },
  });
  return mapInvoicePayment(inserted.rows[0] as Record<string, unknown>);
}

export async function reverseInvoicePayment(
  client: Client,
  input: { organisationId: string; actorUserId: string; paymentId: string; reason: string },
) {
  const payment = await client.query(
    `select * from school_invoice_payments where id = $1 and organisation_id = $2 for update`,
    [input.paymentId, input.organisationId],
  );
  if (!payment.rows[0]) notFound();
  if (payment.rows[0].status === "reversed") return mapInvoicePayment(payment.rows[0] as Record<string, unknown>);
  await client.query(
    `update school_invoice_payments
        set status = 'reversed', reversed_by = $3, reversed_at = now(), reverse_reason = $4
      where id = $1 and organisation_id = $2`,
    [input.paymentId, input.organisationId, input.actorUserId, input.reason],
  );
  await client.query(
    `update school_invoices
        set paid_minor = greatest(paid_minor - $3, 0)
      where id = $1 and organisation_id = $2`,
    [payment.rows[0].invoice_id, input.organisationId, payment.rows[0].amount_minor],
  );
  await refreshInvoiceStatus(client, input.organisationId, String(payment.rows[0].invoice_id));
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.invoice.payment_reversed",
    entityType: "school_invoice_payment",
    entityId: input.paymentId,
    after: { reason: input.reason },
  });
  const updated = await client.query(`select * from school_invoice_payments where id = $1`, [input.paymentId]);
  return mapInvoicePayment(updated.rows[0] as Record<string, unknown>);
}

export async function createInvoiceCredit(
  client: Client,
  input: {
    organisationId: string;
    actorUserId: string;
    billingAccountId: string;
    invoiceId?: string | null;
    kind: string;
    amountMinor: number;
    reason: string;
  },
) {
  if (!isSchoolCreditKind(input.kind)) {
    throw new AppError(400, "validation_failed", "Invalid credit kind");
  }
  if (input.invoiceId) {
    const invoice = await refreshInvoiceStatus(client, input.organisationId, input.invoiceId);
    if (String(invoice.billing_account_id) !== input.billingAccountId) {
      throw new AppError(400, "validation_failed", "Credit must belong to the invoice family account");
    }
    if (["void", "draft"].includes(String(invoice.status))) {
      throw new AppError(409, "invalid_status_transition", "This invoice cannot accept credits");
    }
    const outstanding = invoiceOutstandingMinor(
      Number(invoice.total_minor),
      Number(invoice.paid_minor),
      Number(invoice.credit_total_minor ?? 0),
    );
    if (input.amountMinor > outstanding) {
      throw new AppError(
        409,
        "credit_exceeds_outstanding",
        "A credit cannot exceed the amount still outstanding on this invoice",
      );
    }
  }
  const settings = await loadFinanceSettings(client, input.organisationId);
  const reference = await nextFinanceReference(client, input.organisationId, "credit");
  const created = await client.query(
    `insert into school_invoice_credits (
       organisation_id, billing_account_id, invoice_id, reference, kind, amount_minor,
       currency, reason, created_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning *`,
    [
      input.organisationId,
      input.billingAccountId,
      input.invoiceId ?? null,
      reference,
      input.kind,
      input.amountMinor,
      settings.currency,
      input.reason,
      input.actorUserId,
    ],
  );
  if (input.invoiceId) {
    await client.query(
      `update school_invoices
          set credit_total_minor = credit_total_minor + $3
        where id = $1 and organisation_id = $2`,
      [input.invoiceId, input.organisationId, input.amountMinor],
    );
    await refreshInvoiceStatus(client, input.organisationId, input.invoiceId);
  }
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.credit.created",
    entityType: "school_invoice_credit",
    entityId: String(created.rows[0]!.id),
    after: { reference, kind: input.kind, amountMinor: input.amountMinor, invoiceId: input.invoiceId ?? null },
  });
  return mapCredit(created.rows[0] as Record<string, unknown>);
}

export async function voidInvoice(
  client: Client,
  input: { organisationId: string; actorUserId: string; invoiceId: string; reason: string },
) {
  const invoice = await client.query(`select * from school_invoices where id = $1 and organisation_id = $2 for update`, [
    input.invoiceId,
    input.organisationId,
  ]);
  if (!invoice.rows[0]) notFound();
  if (Number(invoice.rows[0].paid_minor) > 0) {
    throw new AppError(409, "conflict", "Paid invoices cannot be voided; record a credit or reverse the payment");
  }
  if (invoice.rows[0].status === "void") {
    return mapInvoice(invoice.rows[0] as Record<string, unknown>);
  }
  await client.query(
    `update school_invoices
        set status = 'void', voided_by = $3, voided_at = now(), void_reason = $4, outstanding_minor = 0
      where id = $1 and organisation_id = $2`,
    [input.invoiceId, input.organisationId, input.actorUserId, input.reason],
  );
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "finance.invoice.voided",
    entityType: "school_invoice",
    entityId: input.invoiceId,
    after: { reason: input.reason, reference: invoice.rows[0].reference },
  });
  const updated = await client.query(
    `select i.*, a.name as billing_account_name
       from school_invoices i
       join school_billing_accounts a on a.id = i.billing_account_id
      where i.id = $1`,
    [input.invoiceId],
  );
  return mapInvoice(updated.rows[0] as Record<string, unknown>);
}

export async function listBillingAccounts(client: Client, organisationId: string) {
  const rows = await client.query(
    `select a.*, u.full_name as primary_payer_name,
            (
              select coalesce(sum(i.outstanding_minor), 0)
                from school_invoices i
               where i.billing_account_id = a.id and i.status in ('issued', 'partially_paid', 'overdue')
            ) as outstanding_minor,
            (
              select string_agg(sp.legal_name, ', ' order by sp.legal_name)
                from school_billing_account_pupils p
                join student_profiles sp on sp.id = p.student_profile_id
               where p.billing_account_id = a.id
            ) as pupil_names
       from school_billing_accounts a
       left join users u on u.id = a.primary_payer_user_id
      where a.organisation_id = $1
      order by a.name`,
    [organisationId],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    name: row.name,
    primaryPayerUserId: row.primary_payer_user_id,
    primaryPayerName: row.primary_payer_name ?? null,
    outstandingMinor: Number(row.outstanding_minor),
    pupilNames: row.pupil_names ?? "",
  }));
}

export async function loadBillingAccount(client: Client, organisationId: string, accountId: string) {
  const accounts = (await listBillingAccounts(client, organisationId)).filter((item) => item.id === accountId);
  if (!accounts[0]) notFound();
  const pupils = await client.query(
    `select p.student_profile_id, sp.legal_name
       from school_billing_account_pupils p
       join student_profiles sp on sp.id = p.student_profile_id
      where p.billing_account_id = $1 and p.organisation_id = $2
      order by sp.legal_name`,
    [accountId, organisationId],
  );
  const invoices = await listInvoices(client, organisationId, { billingAccountId: accountId });
  return { account: accounts[0], pupils: pupils.rows, invoices };
}

export async function listArrears(client: Client, organisationId: string, bucket?: string) {
  const settings = await loadFinanceSettings(client, organisationId);
  await syncOverdueInvoiceStatuses(client, organisationId);
  const today = new Date().toISOString().slice(0, 10);
  const rows = await client.query(
    `select i.*, a.name as billing_account_name, u.full_name as payer_name
       from school_invoices i
       join school_billing_accounts a on a.id = i.billing_account_id
       left join users u on u.id = i.payer_user_id
      where i.organisation_id = $1
        and i.status in ('issued', 'partially_paid', 'overdue')
        and i.outstanding_minor > 0
      order by i.due_date, a.name`,
    [organisationId],
  );
  return rows.rows
    .map((row) => {
      const due = asIsoDate(row.due_date);
      const overdue = daysOverdue(due, today, settings.gracePeriodDays);
      return {
        ...mapInvoice(row as Record<string, unknown>),
        daysOverdue: overdue,
        bucket: arrearsBucket(overdue),
      };
    })
    .filter((row) => {
      if (!bucket || bucket === "all") return true;
      if (bucket === "current") return row.daysOverdue <= 0 && row.bucket === "current";
      if (bucket === "due_soon") return row.bucket === "due_soon";
      if (bucket === "overdue") return row.daysOverdue > 0;
      if (bucket === "30") return row.daysOverdue >= 30;
      if (bucket === "60") return row.daysOverdue >= 60;
      if (bucket === "90") return row.daysOverdue >= 90;
      return row.bucket === bucket;
    });
}

export async function loadAccountStatement(
  client: Client,
  organisationId: string,
  accountId: string,
  from: string,
  to: string,
) {
  const invoices = await client.query(
    `select id, reference, invoice_date, total_minor, status
       from school_invoices
      where organisation_id = $1 and billing_account_id = $2 and status <> 'void'
        and invoice_date <= $3::date
      order by invoice_date, reference`,
    [organisationId, accountId, to],
  );
  const payments = await client.query(
    `select id, reference, received_on, amount_minor, status, invoice_id
       from school_invoice_payments
      where organisation_id = $1 and billing_account_id = $2 and status = 'succeeded'
        and received_on <= $3::date
      order by received_on, reference`,
    [organisationId, accountId, to],
  );
  const credits = await client.query(
    `select id, reference, created_at, amount_minor, kind, status
       from school_invoice_credits
      where organisation_id = $1 and billing_account_id = $2 and status = 'applied'
        and created_at::date <= $3::date
      order by created_at, reference`,
    [organisationId, accountId, to],
  );
  const entries: Array<{
    date: string;
    kind: string;
    reference: string;
    debitMinor: number;
    creditMinor: number;
  }> = [];
  for (const invoice of invoices.rows) {
    entries.push({
      date: asIsoDate(invoice.invoice_date),
      kind: "invoice",
      reference: String(invoice.reference),
      debitMinor: Number(invoice.total_minor),
      creditMinor: 0,
    });
  }
  for (const payment of payments.rows) {
    entries.push({
      date: asIsoDate(payment.received_on),
      kind: "payment",
      reference: String(payment.reference),
      debitMinor: 0,
      creditMinor: Number(payment.amount_minor),
    });
  }
  for (const credit of credits.rows) {
    entries.push({
      date: asIsoDate(credit.created_at),
      kind: String(credit.kind),
      reference: String(credit.reference),
      debitMinor: 0,
      creditMinor: Number(credit.amount_minor),
    });
  }
  entries.sort((left, right) => left.date.localeCompare(right.date) || left.reference.localeCompare(right.reference));
  let running = 0;
  let opening = 0;
  const period = [];
  for (const entry of entries) {
    running += entry.debitMinor - entry.creditMinor;
    if (entry.date < from) {
      opening = running;
      continue;
    }
    if (entry.date > to) continue;
    period.push({ ...entry, balanceMinor: running });
  }
  return { from, to, openingBalanceMinor: opening, closingBalanceMinor: running, entries: period };
}

export async function loadTuitionDashboard(client: Client, organisationId: string) {
  const settings = await loadFinanceSettings(client, organisationId);
  const invoiceTotals = await client.query(
    `select
       coalesce(sum(total_minor) filter (where status <> 'void' and status <> 'draft'), 0)::text as invoiced,
       coalesce(sum(paid_minor) filter (where status <> 'void'), 0)::text as collected,
       coalesce(sum(outstanding_minor) filter (where status in ('issued', 'partially_paid', 'overdue')), 0)::text as outstanding,
       coalesce(sum(credit_total_minor) filter (where status <> 'void'), 0)::text as credits
     from school_invoices
     where organisation_id = $1`,
    [organisationId],
  );
  const upcoming = await client.query(
    `select * from school_billing_runs
      where organisation_id = $1 and status = 'previewed'
      order by created_at desc
      limit 5`,
    [organisationId],
  );
  const recentPayments = await client.query(
    `select p.*, i.reference as invoice_reference, a.name as billing_account_name
       from school_invoice_payments p
       join school_invoices i on i.id = p.invoice_id
       join school_billing_accounts a on a.id = p.billing_account_id
      where p.organisation_id = $1 and p.status = 'succeeded'
      order by p.recorded_at desc
      limit 8`,
    [organisationId],
  );
  const recentInvoices = await listInvoices(client, organisationId);
  const overdue = await listArrears(client, organisationId, "overdue");
  return {
    settings,
    expectedFeesMinor: Number(invoiceTotals.rows[0]?.invoiced ?? 0),
    invoicedMinor: Number(invoiceTotals.rows[0]?.invoiced ?? 0),
    collectedMinor: Number(invoiceTotals.rows[0]?.collected ?? 0),
    outstandingMinor: Number(invoiceTotals.rows[0]?.outstanding ?? 0),
    overdueMinor: overdue.reduce((sum, item) => sum + item.outstandingMinor, 0),
    creditsMinor: Number(invoiceTotals.rows[0]?.credits ?? 0),
    currency: settings.currency,
    upcomingRuns: upcoming.rows.map((row) => mapBillingRun(row as Record<string, unknown>)),
    recentPayments: recentPayments.rows.map((row) => ({
      ...mapInvoicePayment(row as Record<string, unknown>),
      invoiceReference: row.invoice_reference,
      billingAccountName: row.billing_account_name,
    })),
    recentInvoices: recentInvoices.slice(0, 8),
    overdueAccounts: overdue.slice(0, 8),
  };
}

export async function loadPupilFeeProfile(client: Client, organisationId: string, studentProfileId: string) {
  const settings = await loadFinanceSettings(client, organisationId);
  const year = await client.query<{ id: string }>(
    `select id from academic_years where organisation_id = $1 and is_current limit 1`,
    [organisationId],
  );
  const quotes = year.rows[0]
    ? await quotePupilTuition(client, {
        organisationId,
        academicYearId: year.rows[0].id,
        periodStart: new Date().toISOString().slice(0, 10),
        periodEnd: new Date().toISOString().slice(0, 10),
        frequency: settings.defaultBillingFrequency,
      })
    : [];
  const quote = quotes.find((item) => item.studentProfileId === studentProfileId) ?? null;
  const profile = await client.query(
    `select * from school_pupil_fee_profiles where organisation_id = $1 and student_profile_id = $2`,
    [organisationId, studentProfileId],
  );
  const concessions = await client.query(
    `select * from school_pupil_concessions
      where organisation_id = $1 and student_profile_id = $2
      order by created_at desc`,
    [organisationId, studentProfileId],
  );
  const invoices = await listInvoices(client, organisationId, { studentId: studentProfileId });
  const pupil = await client.query<{ legal_name: string }>(
    `select legal_name from student_profiles where id = $1 and organisation_id = $2`,
    [studentProfileId, organisationId],
  );
  if (!pupil.rows[0]) notFound();
  return {
    studentProfileId,
    legalName: pupil.rows[0].legal_name,
    profile: profile.rows[0] ?? null,
    quote,
    concessions: concessions.rows,
    invoices,
  };
}

export async function listStaffChildLinks(client: Client, organisationId: string) {
  const rows = await client.query(
    `select l.*, u.full_name as staff_name, sp.legal_name as pupil_name
       from school_staff_child_links l
       join users u on u.id = l.staff_user_id
       join student_profiles sp on sp.id = l.student_profile_id
      where l.organisation_id = $1
      order by u.full_name, sp.legal_name`,
    [organisationId],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    staffUserId: row.staff_user_id,
    staffName: row.staff_name,
    studentProfileId: row.student_profile_id,
    pupilName: row.pupil_name,
    guardianshipId: row.guardianship_id,
    isActive: row.is_active,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
  }));
}

export async function parentAuthorisedAccountIds(
  client: Client,
  organisationId: string,
  actor: Actor,
): Promise<string[]> {
  assertPermission(actor, PERMISSIONS.FINANCE_READ_OWN_CHILDREN);
  const children = [...(await guardianChildIds(client, actor.userId, organisationId))];
  if (children.length === 0) return [];
  const rows = await client.query<{ billing_account_id: string }>(
    `select distinct billing_account_id
       from school_billing_account_pupils
      where organisation_id = $1 and student_profile_id = any($2::uuid[])`,
    [organisationId, children],
  );
  return rows.rows.map((row) => row.billing_account_id);
}

export async function loadParentFinance(client: Client, organisationId: string, actor: Actor) {
  const settings = await loadFinanceSettings(client, organisationId);
  const accountIds = await parentAuthorisedAccountIds(client, organisationId, actor);
  if (!settings.tuitionEnabled || accountIds.length === 0) {
    return {
      tuitionEnabled: settings.tuitionEnabled,
      canViewInvoices: settings.parentsCanViewInvoices,
      canViewBalances: settings.parentsCanViewBalances,
      currency: settings.currency,
      amountDueMinor: 0,
      outstandingMinor: 0,
      nextDueDate: null,
      invoices: [],
      payments: [],
    };
  }
  const invoices = settings.parentsCanViewInvoices
    ? (
        await client.query(
          `select i.*, a.name as billing_account_name
             from school_invoices i
             join school_billing_accounts a on a.id = i.billing_account_id
            where i.organisation_id = $1
              and i.billing_account_id = any($2::uuid[])
              and i.status <> 'void'
            order by i.due_date nulls last, i.invoice_date desc`,
          [organisationId, accountIds],
        )
      ).rows.map((row) => mapInvoice(row as Record<string, unknown>))
    : [];
  const payments = (
    await client.query(
      `select p.*, i.reference as invoice_reference
         from school_invoice_payments p
         join school_invoices i on i.id = p.invoice_id
        where p.organisation_id = $1
          and p.billing_account_id = any($2::uuid[])
          and p.status = 'succeeded'
        order by p.recorded_at desc
        limit 50`,
      [organisationId, accountIds],
    )
  ).rows.map((row) => ({
    ...mapInvoicePayment(row as Record<string, unknown>),
    invoiceReference: row.invoice_reference,
  }));
  const outstanding = invoices
    .filter((invoice) => ["issued", "partially_paid", "overdue"].includes(String(invoice.status)))
    .reduce((sum, invoice) => sum + Number(invoice.outstandingMinor), 0);
  const next = invoices
    .filter((invoice) => Number(invoice.outstandingMinor) > 0)
    .sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)))[0];
  return {
    tuitionEnabled: settings.tuitionEnabled,
    canViewInvoices: settings.parentsCanViewInvoices,
    canViewBalances: settings.parentsCanViewBalances,
    currency: settings.currency,
    amountDueMinor: settings.parentsCanViewBalances ? outstanding : null,
    outstandingMinor: settings.parentsCanViewBalances ? outstanding : null,
    nextDueDate: next?.dueDate ?? null,
    invoices: settings.parentsCanViewBalances
      ? invoices
      : invoices.map((invoice) => ({ ...invoice, totalMinor: null, outstandingMinor: null, paidMinor: null })),
    payments: settings.parentsCanViewBalances
      ? payments
      : payments.map((payment) => ({ ...payment, amountMinor: null })),
  };
}

export async function loadParentInvoice(
  client: Client,
  organisationId: string,
  actor: Actor,
  invoiceId: string,
) {
  const settings = await loadFinanceSettings(client, organisationId);
  if (!settings.parentsCanViewInvoices) {
    throw new AppError(403, "forbidden", "Invoice viewing is disabled for parents at this school");
  }
  const accountIds = await parentAuthorisedAccountIds(client, organisationId, actor);
  const invoice = await client.query(
    `select 1 from school_invoices
      where id = $1 and organisation_id = $2 and billing_account_id = any($3::uuid[])`,
    [invoiceId, organisationId, accountIds],
  );
  if (!invoice.rows[0]) notFound();
  return loadInvoice(client, organisationId, invoiceId);
}

export async function loadParentStatement(
  client: Client,
  organisationId: string,
  actor: Actor,
  from: string,
  to: string,
) {
  const settings = await loadFinanceSettings(client, organisationId);
  if (!settings.parentsCanViewBalances) {
    throw new AppError(403, "forbidden", "Balance viewing is disabled for parents at this school");
  }
  const accountIds = await parentAuthorisedAccountIds(client, organisationId, actor);
  const statements = [];
  for (const accountId of accountIds) {
    statements.push(await loadAccountStatement(client, organisationId, accountId, from, to));
  }
  return { currency: settings.currency, statements };
}

export async function applyOptionalPupilImportFinance(
  client: Client,
  organisationId: string,
  actorUserId: string,
  studentProfileId: string,
  payload: Record<string, string>,
): Promise<void> {
  const siblingPriority = payload.sibling_priority ? Number(payload.sibling_priority) : null;
  const feeScheduleName = payload.fee_schedule?.trim();
  if (!siblingPriority && !feeScheduleName && !payload.concession_note) return;
  let feeScheduleId: string | null = null;
  if (feeScheduleName) {
    const schedule = await client.query<{ id: string }>(
      `select id from school_fee_schedules
        where organisation_id = $1 and lower(name) = lower($2) and is_active
        limit 1`,
      [organisationId, feeScheduleName],
    );
    feeScheduleId = schedule.rows[0]?.id ?? null;
  }
  await upsertPupilFeeProfile(client, {
    organisationId,
    actorUserId,
    studentProfileId,
    feeScheduleId,
    siblingPriority: siblingPriority && Number.isInteger(siblingPriority) ? siblingPriority : null,
    notes: payload.concession_note || null,
  });
}
