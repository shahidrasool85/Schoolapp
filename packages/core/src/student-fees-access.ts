import type pg from "pg";
import {
  financeInvoicePayPath,
  isStudentFeeSort,
  isStudentFeeStatus,
  type ParentPaymentAvailability,
  type StudentFeeSort,
  type StudentFeeStatus,
} from "@schoolapp/domain";
import { AppError } from "./errors.js";
import { applyVatToEnteredAmount, parseVatLineTreatment, schoolVatPolicyFromSettings } from "./vat.js";
import {
  allocateShareMinor,
  annualizeDiscountMinor,
  asIsoDate,
  resolveCurrentBillingPeriod,
  studentFeeStatus,
} from "./tuition.js";
import {
  loadFinanceSettings,
  previewBillingRun,
  previewMissingBillingRunInvoices,
  quotePupilTuition,
  type PupilFeeQuote,
} from "./tuition-access.js";

type Client = pg.PoolClient;

export type StudentFeeRow = {
  studentProfileId: string;
  legalName: string;
  yearGroupId: string | null;
  yearGroupName: string | null;
  classId: string | null;
  className: string | null;
  feeScheduleId: string | null;
  feeScheduleName: string | null;
  billingFrequency: string | null;
  annualFeeMinor: number | null;
  discountMinor: number;
  discountLabel: string | null;
  netAnnualFeeMinor: number | null;
  currentInstalmentMinor: number | null;
  invoicedMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  nextDueDate: string | null;
  status: StudentFeeStatus;
  parentPaymentAvailability: ParentPaymentAvailability;
  billingAccountId: string | null;
  siblingCount: number;
  warning: string | null;
  scheduleConflict: boolean;
  alreadyInvoicedForPeriod: boolean;
  currency: string;
};

export type StudentFeeSummary = {
  currency: string;
  expectedAnnualFeesMinor: number;
  invoicedMinor: number;
  receivedMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  pupilsWithFees: number;
  pupilsWithOutstanding: number;
  pupilsOverdue: number;
  pupilsNoFeeAssigned: number;
};

export type StudentFeesList = {
  period: { periodStart: string; periodEnd: string } | null;
  academicYearId: string | null;
  academicYearName: string | null;
  asOf: string;
  tuitionEnabled: boolean;
  summary: StudentFeeSummary;
  pupils: StudentFeeRow[];
  missingInvoices: {
    count: number;
    billingRunId: string | null;
    billingRunReference: string | null;
    href: string | null;
  };
  preparePeriod: {
    academicYearId: string | null;
    frequency: string;
    periodStart: string | null;
    periodEnd: string | null;
  };
};

function assertMinor(value: number): number {
  if (!Number.isInteger(value)) throw new Error("invalid_amount");
  return value;
}

function discountLabelOf(quote: PupilFeeQuote): string | null {
  if (quote.appliedDiscounts.length === 0) return null;
  return quote.appliedDiscounts
    .map((discount) => {
      if (discount.amountType === "percent" && discount.percentBps != null) {
        const pct = (discount.percentBps / 100).toFixed(discount.percentBps % 100 === 0 ? 0 : 2);
        return `${discount.name} ${pct}%`;
      }
      return discount.name;
    })
    .join(", ");
}

function parentPaymentAvailability(input: {
  outstandingMinor: number;
  invoicedMinor: number;
  onlinePaymentsEnabled: boolean;
  stripeConfigured: boolean;
  parentsCanViewInvoices: boolean;
  hasPayer: boolean;
  portalAccess: boolean;
}): ParentPaymentAvailability {
  if (input.invoicedMinor > 0 && input.outstandingMinor <= 0) return "paid";
  if (input.invoicedMinor <= 0) return "not_invoiced";
  if (!input.hasPayer) return "no_payer";
  if (!input.portalAccess) return "no_portal_access";
  if (!input.parentsCanViewInvoices) return "invoices_hidden";
  if (!input.stripeConfigured) return "stripe_unavailable";
  if (!input.onlinePaymentsEnabled) return "online_payments_disabled";
  return "online_payment_available";
}

export async function listStudentFees(
  client: Client,
  organisationId: string,
  filters: {
    search?: string;
    yearGroupId?: string;
    classId?: string;
    status?: string;
    paid?: boolean;
    unpaid?: boolean;
    overdue?: boolean;
    discounted?: boolean;
    noFeeAssigned?: boolean;
    sort?: string;
    asOf?: string;
    studentProfileId?: string;
  } = {},
): Promise<StudentFeesList> {
  const settings = await loadFinanceSettings(client, organisationId);
  const asOf = filters.asOf ?? new Date().toISOString().slice(0, 10);
  const year = await client.query<{
    id: string;
    name: string;
    starts_on: Date | string;
    ends_on: Date | string;
  }>(
    `select id, name, starts_on, ends_on from academic_years where organisation_id = $1 and is_current limit 1`,
    [organisationId],
  );
  const academicYear = year.rows[0] ?? null;
  const period = academicYear
    ? resolveCurrentBillingPeriod({
        asOf,
        frequency: settings.defaultBillingFrequency,
        yearStartsOn: asIsoDate(academicYear.starts_on),
        yearEndsOn: asIsoDate(academicYear.ends_on),
      })
    : null;

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

  const enrolments = await client.query<{
    student_profile_id: string;
    legal_name: string;
    year_group_id: string | null;
    year_group_name: string | null;
    class_id: string | null;
    class_name: string | null;
  }>(
    `select sp.id as student_profile_id,
            sp.legal_name,
            se.year_group_id,
            yg.name as year_group_name,
            form_class.class_id,
            form_class.class_name
       from student_enrolments se
       join student_profiles sp on sp.id = se.student_profile_id
       left join year_groups yg on yg.id = se.year_group_id
       left join lateral (
         select cm.class_id, cl.name as class_name
           from class_memberships cm
           join classes cl on cl.id = cm.class_id and cl.class_type = 'form'
          where cm.student_profile_id = sp.id
            and cm.academic_year_id = se.academic_year_id
            and cm.ended_on is null
          order by cl.name, cl.id
          limit 1
       ) form_class on true
      where se.organisation_id = $1
        and ($2::uuid is null or se.academic_year_id = $2)
        and se.is_primary
        and se.status in ('planned', 'enrolled')
        and sp.enrolment_status in ('admitted', 'enrolled')
        and ($3::uuid is null or sp.id = $3)
      order by yg.sort_order nulls last, sp.legal_name, sp.id`,
    [organisationId, academicYear?.id ?? null, filters.studentProfileId ?? null],
  );

  const quotes =
    academicYear && period
      ? await quotePupilTuition(client, {
          organisationId,
          academicYearId: academicYear.id,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          frequency: settings.defaultBillingFrequency,
          mode: "fee_plan",
          studentProfileId: filters.studentProfileId,
        })
      : [];
  const quoteByPupil = new Map(quotes.map((quote) => [quote.studentProfileId, quote]));

  const totals = await client.query<{
    student_profile_id: string;
    invoiced_minor: string;
    paid_minor: string;
    outstanding_minor: string;
    overdue_minor: string;
    next_due_date: Date | string | null;
  }>(
    `with pupil_invoices as (
       select l.student_profile_id,
              i.id as invoice_id,
              i.status,
              i.due_date,
              i.total_minor,
              i.paid_minor,
              i.outstanding_minor,
              coalesce(sum(l.vat_gross_minor), 0) as pupil_gross
         from school_invoice_lines l
         join school_invoices i on i.id = l.invoice_id and i.organisation_id = l.organisation_id
        where l.organisation_id = $1
          and i.status not in ('void', 'draft')
          and l.student_profile_id is not null
        group by l.student_profile_id, i.id, i.status, i.due_date, i.total_minor, i.paid_minor, i.outstanding_minor
     )
     select student_profile_id,
            coalesce(sum(pupil_gross), 0)::bigint::text as invoiced_minor,
            coalesce(sum(case
              when total_minor > 0
              then floor((paid_minor::numeric * pupil_gross) / total_minor)
              else 0
            end), 0)::bigint::text as paid_minor,
            coalesce(sum(case
              when total_minor > 0
              then floor((outstanding_minor::numeric * pupil_gross) / total_minor)
              else 0
            end), 0)::bigint::text as outstanding_minor,
            coalesce(sum(
              case
                when outstanding_minor > 0
                 and due_date is not null
                 and $2::date > (due_date + $3::int)
                 and status in ('issued', 'partially_paid', 'overdue')
                 and total_minor > 0
                then floor((outstanding_minor::numeric * pupil_gross) / total_minor)
                else 0
              end
            ), 0)::bigint::text as overdue_minor,
            min(due_date) filter (where outstanding_minor > 0 and status in ('issued', 'partially_paid', 'overdue')) as next_due_date
       from pupil_invoices
      group by student_profile_id`,
    [organisationId, asOf, settings.gracePeriodDays],
  );
  const totalsByPupil = new Map(
    totals.rows.map((row) => [
      row.student_profile_id,
      {
        invoicedMinor: assertMinor(Math.trunc(Number(row.invoiced_minor))),
        paidMinor: assertMinor(Math.trunc(Number(row.paid_minor))),
        outstandingMinor: assertMinor(Math.trunc(Number(row.outstanding_minor))),
        overdueMinor: assertMinor(Math.trunc(Number(row.overdue_minor))),
        nextDueDate: row.next_due_date ? asIsoDate(row.next_due_date) : null,
      },
    ]),
  );

  const accounts = await client.query<{
    student_profile_id: string;
    billing_account_id: string;
    sibling_count: string;
    has_payer: boolean;
    portal_access: boolean;
  }>(
    `select p.student_profile_id,
            p.billing_account_id,
            (select count(*)::text from school_billing_account_pupils s
              where s.billing_account_id = p.billing_account_id) as sibling_count,
            a.primary_payer_user_id is not null as has_payer,
            exists (
              select 1 from guardianships g
               where g.organisation_id = p.organisation_id
                 and g.student_profile_id = p.student_profile_id
                 and g.portal_access
                 and (g.ended_on is null or g.ended_on >= current_date)
                 and (g.started_on is null or g.started_on <= current_date)
            ) as portal_access
       from school_billing_account_pupils p
       join school_billing_accounts a on a.id = p.billing_account_id
      where p.organisation_id = $1`,
    [organisationId],
  );
  const accountByPupil = new Map(accounts.rows.map((row) => [row.student_profile_id, row]));

  const provider = await client.query<{ is_active: boolean; secret_configured: boolean }>(
    `select is_active,
            encrypted_secret_key is not null as secret_configured
       from school_payment_provider_configs
      where organisation_id = $1
      limit 1`,
    [organisationId],
  );
  const onlinePaymentsEnabled = Boolean(provider.rows[0]?.is_active);
  const stripeConfigured = Boolean(provider.rows[0]?.secret_configured);

  const vatPolicy = schoolVatPolicyFromSettings(settings);
  const rows: StudentFeeRow[] = [];
  for (const enrol of enrolments.rows) {
    const quote = quoteByPupil.get(enrol.student_profile_id) ?? null;
    const money = totalsByPupil.get(enrol.student_profile_id) ?? {
      invoicedMinor: 0,
      paidMinor: 0,
      outstandingMinor: 0,
      overdueMinor: 0,
      nextDueDate: null,
    };
    const account = accountByPupil.get(enrol.student_profile_id) ?? null;
    const treatment = parseVatLineTreatment(quote?.calculation.vatTreatment);
    const annualEntered = quote?.annualAmountMinor ?? 0;
    const annualGross = quote?.feeScheduleId
      ? applyVatToEnteredAmount(annualEntered, vatPolicy, treatment).grossMinor
      : null;
    const discountAnnualEntered = quote
      ? annualizeDiscountMinor({
          annualAmountMinor: quote.annualAmountMinor,
          instalmentCount: quote.instalmentCount,
          discountTotalMinor: quote.discountTotalMinor,
          appliedDiscounts: quote.appliedDiscounts,
        })
      : 0;
    const discountGross = quote?.feeScheduleId
      ? applyVatToEnteredAmount(discountAnnualEntered, vatPolicy, treatment).grossMinor
      : 0;
    const currentGross = quote?.feeScheduleId
      ? applyVatToEnteredAmount(quote.netAmountMinor, vatPolicy, treatment).grossMinor
      : null;
    const scheduleConflict = Boolean(quote?.calculation.scheduleConflict);
    const hasFee = Boolean(quote?.feeScheduleId) && quote?.warning !== "no_fee_schedule";
    const status = studentFeeStatus({
      hasFeeSchedule: hasFee && !scheduleConflict,
      scheduleConflict,
      invoicedMinor: money.invoicedMinor,
      paidMinor: money.paidMinor,
      outstandingMinor: money.outstandingMinor,
      overdueMinor: money.overdueMinor,
      nextDueDate: money.nextDueDate,
      today: asOf,
      gracePeriodDays: settings.gracePeriodDays,
    });
    rows.push({
      studentProfileId: enrol.student_profile_id,
      legalName: enrol.legal_name,
      yearGroupId: enrol.year_group_id,
      yearGroupName: enrol.year_group_name,
      classId: enrol.class_id,
      className: enrol.class_name,
      feeScheduleId: quote?.feeScheduleId ?? null,
      feeScheduleName: quote?.feeScheduleName ?? null,
      billingFrequency: quote?.billingFrequency ?? null,
      annualFeeMinor: annualGross,
      discountMinor: assertMinor(discountGross),
      discountLabel: quote ? discountLabelOf(quote) : null,
      netAnnualFeeMinor:
        annualGross == null ? null : Math.max(0, annualGross - discountGross),
      currentInstalmentMinor: currentGross,
      invoicedMinor: money.invoicedMinor,
      paidMinor: money.paidMinor,
      outstandingMinor: money.outstandingMinor,
      overdueMinor: money.overdueMinor,
      nextDueDate: money.nextDueDate,
      status,
      parentPaymentAvailability: parentPaymentAvailability({
        outstandingMinor: money.outstandingMinor,
        invoicedMinor: money.invoicedMinor,
        onlinePaymentsEnabled,
        stripeConfigured,
        parentsCanViewInvoices: settings.parentsCanViewInvoices,
        hasPayer: Boolean(account?.has_payer),
        portalAccess: Boolean(account?.portal_access),
      }),
      billingAccountId: account?.billing_account_id ?? null,
      siblingCount: account ? Number(account.sibling_count) : 1,
      warning: quote?.warning ?? (hasFee ? null : "no_fee_schedule"),
      scheduleConflict,
      alreadyInvoicedForPeriod: Boolean(quote?.calculation.alreadyInvoicedForPeriod),
      currency: quote?.currency ?? settings.currency,
    });
  }

  const search = (filters.search ?? "").trim().toLowerCase();
  const statusFilter = filters.status && isStudentFeeStatus(filters.status) ? filters.status : null;
  let filtered = rows.filter((row) => {
    if (search && !row.legalName.toLowerCase().includes(search)) return false;
    if (filters.yearGroupId && row.yearGroupId !== filters.yearGroupId) return false;
    if (filters.classId && row.classId !== filters.classId) return false;
    if (statusFilter && row.status !== statusFilter) return false;
    if (filters.paid && row.status !== "paid") return false;
    if (filters.unpaid && !(row.outstandingMinor > 0)) return false;
    if (filters.overdue && row.overdueMinor <= 0) return false;
    if (filters.discounted && row.discountMinor <= 0) return false;
    if (filters.noFeeAssigned && row.status !== "no_fee_assigned" && row.status !== "schedule_conflict") {
      return false;
    }
    return true;
  });

  const sort: StudentFeeSort = filters.sort && isStudentFeeSort(filters.sort) ? filters.sort : "name";
  filtered = [...filtered].sort((left, right) => {
    if (sort === "balance") return right.outstandingMinor - left.outstandingMinor || left.legalName.localeCompare(right.legalName);
    if (sort === "overdue") return right.overdueMinor - left.overdueMinor || left.legalName.localeCompare(right.legalName);
    if (sort === "nextDue") {
      const leftDue = left.nextDueDate ?? "9999-12-31";
      const rightDue = right.nextDueDate ?? "9999-12-31";
      return leftDue.localeCompare(rightDue) || left.legalName.localeCompare(right.legalName);
    }
    return left.legalName.localeCompare(right.legalName, "en-GB");
  });

  const summary: StudentFeeSummary = {
    currency: settings.currency,
    expectedAnnualFeesMinor: rows.reduce((sum, row) => sum + (row.netAnnualFeeMinor ?? 0), 0),
    invoicedMinor: rows.reduce((sum, row) => sum + row.invoicedMinor, 0),
    receivedMinor: rows.reduce((sum, row) => sum + row.paidMinor, 0),
    outstandingMinor: rows.reduce((sum, row) => sum + row.outstandingMinor, 0),
    overdueMinor: rows.reduce((sum, row) => sum + row.overdueMinor, 0),
    pupilsWithFees: rows.filter((row) => row.feeScheduleId).length,
    pupilsWithOutstanding: rows.filter((row) => row.outstandingMinor > 0).length,
    pupilsOverdue: rows.filter((row) => row.overdueMinor > 0).length,
    pupilsNoFeeAssigned: rows.filter((row) => row.status === "no_fee_assigned" || row.status === "schedule_conflict")
      .length,
  };

  const missingPupils = new Set<string>();
  let missingRunId: string | null = null;
  let missingRunReference: string | null = null;
  const confirmed = await client.query<{ id: string; reference: string }>(
    `select id, reference from school_billing_runs
      where organisation_id = $1 and status = 'confirmed'
      order by confirmed_at desc nulls last, created_at desc
      limit 8`,
    [organisationId],
  );
  for (const run of confirmed.rows) {
    try {
      const preview = await previewMissingBillingRunInvoices(client, {
        organisationId,
        billingRunId: run.id,
      });
      for (const item of preview.missingEligible) {
        missingPupils.add(item.studentProfileId);
        if (!missingRunId) {
          missingRunId = run.id;
          missingRunReference = run.reference;
        }
      }
    } catch {
      // Ignore runs that cannot be catch-up previewed.
    }
  }

  return {
    period,
    academicYearId: academicYear?.id ?? null,
    academicYearName: academicYear?.name ?? null,
    asOf,
    tuitionEnabled: settings.tuitionEnabled,
    summary,
    pupils: filtered,
    missingInvoices: {
      count: missingPupils.size,
      billingRunId: missingRunId,
      billingRunReference: missingRunReference,
      href: missingRunId ? `/school/finance/billing-runs/${missingRunId}` : null,
    },
    preparePeriod: {
      academicYearId: academicYear?.id ?? null,
      frequency: settings.defaultBillingFrequency,
      periodStart: period?.periodStart ?? null,
      periodEnd: period?.periodEnd ?? null,
    },
  };
}

export async function prepareCurrentPeriodFees(
  client: Client,
  input: { organisationId: string; actorUserId: string },
) {
  const settings = await loadFinanceSettings(client, input.organisationId);
  if (!settings.tuitionEnabled) {
    throw new AppError(409, "tuition_disabled", "Tuition billing is disabled for this school");
  }
  const year = await client.query<{
    id: string;
    starts_on: Date | string;
    ends_on: Date | string;
  }>(
    `select id, starts_on, ends_on from academic_years where organisation_id = $1 and is_current limit 1`,
    [input.organisationId],
  );
  if (!year.rows[0]) {
    throw new AppError(409, "no_academic_year", "Set a current academic year before preparing fees.");
  }
  const asOf = new Date().toISOString().slice(0, 10);
  const period = resolveCurrentBillingPeriod({
    asOf,
    frequency: settings.defaultBillingFrequency,
    yearStartsOn: asIsoDate(year.rows[0].starts_on),
    yearEndsOn: asIsoDate(year.rows[0].ends_on),
  });
  return previewBillingRun(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    academicYearId: year.rows[0].id,
    frequency: settings.defaultBillingFrequency,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  });
}

export { financeInvoicePayPath, allocateShareMinor };
