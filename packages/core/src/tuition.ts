import {
  SCHOOL_BILLING_FREQUENCIES,
  SCHOOL_CREDIT_KINDS,
  SCHOOL_DISCOUNT_AMOUNT_TYPES,
  SCHOOL_DISCOUNT_KINDS,
  SCHOOL_DISCOUNT_STACKING_MODES,
  SCHOOL_INVOICE_LINE_KINDS,
  SCHOOL_INVOICE_PAYMENT_METHODS,
  SCHOOL_INVOICE_STATUSES,
  SCHOOL_MID_PERIOD_POLICIES,
  SCHOOL_SIBLING_ORDER_MODES,
  SCHOOL_STAFF_CHILD_SCOPES,
  type SchoolBillingFrequency,
  type SchoolDiscountStackingMode,
  type SchoolInvoiceStatus,
  type SchoolMidPeriodPolicy,
  type SchoolSiblingOrderMode,
} from "@schoolapp/domain";

export function isSchoolBillingFrequency(value: string): value is SchoolBillingFrequency {
  return (SCHOOL_BILLING_FREQUENCIES as readonly string[]).includes(value);
}

export function isSchoolDiscountStackingMode(value: string): value is SchoolDiscountStackingMode {
  return (SCHOOL_DISCOUNT_STACKING_MODES as readonly string[]).includes(value);
}

export function isSchoolSiblingOrderMode(value: string): value is SchoolSiblingOrderMode {
  return (SCHOOL_SIBLING_ORDER_MODES as readonly string[]).includes(value);
}

export function isSchoolMidPeriodPolicy(value: string): value is SchoolMidPeriodPolicy {
  return (SCHOOL_MID_PERIOD_POLICIES as readonly string[]).includes(value);
}

export function isSchoolInvoiceStatus(value: string): value is SchoolInvoiceStatus {
  return (SCHOOL_INVOICE_STATUSES as readonly string[]).includes(value);
}

export function isSchoolDiscountKind(value: string): boolean {
  return (SCHOOL_DISCOUNT_KINDS as readonly string[]).includes(value);
}

export function isSchoolDiscountAmountType(value: string): boolean {
  return (SCHOOL_DISCOUNT_AMOUNT_TYPES as readonly string[]).includes(value);
}

export function isSchoolInvoiceLineKind(value: string): boolean {
  return (SCHOOL_INVOICE_LINE_KINDS as readonly string[]).includes(value);
}

export function isSchoolInvoicePaymentMethod(value: string): boolean {
  return (SCHOOL_INVOICE_PAYMENT_METHODS as readonly string[]).includes(value);
}

export function isSchoolCreditKind(value: string): boolean {
  return (SCHOOL_CREDIT_KINDS as readonly string[]).includes(value);
}

export function isSchoolStaffChildScope(value: string): boolean {
  return (SCHOOL_STAFF_CHILD_SCOPES as readonly string[]).includes(value);
}

export function percentOfMinor(baseMinor: number, bps: number): number {
  if (!Number.isInteger(baseMinor) || baseMinor < 0) {
    throw new Error("invalid_amount");
  }
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
    throw new Error("invalid_percent");
  }
  return Math.floor((baseMinor * bps) / 10000);
}

export function splitAnnualIntoInstalments(annualMinor: number, count: number): number[] {
  if (!Number.isInteger(annualMinor) || annualMinor < 0) {
    throw new Error("invalid_amount");
  }
  if (!Number.isInteger(count) || count < 1 || count > 24) {
    throw new Error("invalid_instalment_count");
  }
  const base = Math.floor(annualMinor / count);
  const remainder = annualMinor - base * count;
  return Array.from({ length: count }, (_, index) => base + (index === count - 1 ? remainder : 0));
}

export function prorateMinor(amountMinor: number, chargeableDays: number, periodDays: number): number {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error("invalid_amount");
  }
  if (!Number.isInteger(chargeableDays) || !Number.isInteger(periodDays)) {
    throw new Error("invalid_proration");
  }
  if (periodDays <= 0) return amountMinor;
  if (chargeableDays <= 0) return 0;
  if (chargeableDays >= periodDays) return amountMinor;
  return Math.floor((amountMinor * chargeableDays) / periodDays);
}

export function inclusiveDayCount(start: string, end: string): number {
  const from = parseIsoDate(start);
  const to = parseIsoDate(end);
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

const OPEN_ENDED = "9999-12-31";

export function inclusiveDateRangesOverlap(
  startA: string,
  endA: string | null | undefined,
  startB: string,
  endB: string | null | undefined,
): boolean {
  return startA <= (endB ?? OPEN_ENDED) && startB <= (endA ?? OPEN_ENDED);
}

export function enrolmentOverlapsBillingPeriod(input: {
  enrolStart: string;
  enrolEnd: string | null;
  periodStart: string;
  periodEnd: string;
}): boolean {
  return inclusiveDateRangesOverlap(input.enrolStart, input.enrolEnd, input.periodStart, input.periodEnd);
}

export function feeScheduleOverlapsBillingPeriod(input: {
  effectiveFrom: string;
  effectiveUntil: string | null;
  periodStart: string;
  periodEnd: string;
}): boolean {
  return inclusiveDateRangesOverlap(input.effectiveFrom, input.effectiveUntil, input.periodStart, input.periodEnd);
}

export function lastDayOfIsoMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}

export function resolveCurrentBillingPeriod(input: {
  asOf: string;
  frequency: SchoolBillingFrequency;
  yearStartsOn: string;
  yearEndsOn: string;
}): { periodStart: string; periodEnd: string } {
  const asOf =
    input.asOf < input.yearStartsOn
      ? input.yearStartsOn
      : input.asOf > input.yearEndsOn
        ? input.yearEndsOn
        : input.asOf;
  if (input.frequency === "annual") {
    return { periodStart: input.yearStartsOn, periodEnd: input.yearEndsOn };
  }
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const monthStart = `${asOf.slice(0, 7)}-01`;
  const monthEnd = lastDayOfIsoMonth(year, month);
  const periodStart = monthStart < input.yearStartsOn ? input.yearStartsOn : monthStart;
  const periodEnd = monthEnd > input.yearEndsOn ? input.yearEndsOn : monthEnd;
  return { periodStart, periodEnd };
}

/**
 * Canonical stale-preview rule.
 *
 * A preview becomes stale ONLY when a fresh quote of the same period would
 * produce a different invoice set than the stored preview items. The compared
 * signature is pupil + fee schedule + standard + discount + net.
 *
 * That happens when something that could change those invoices changes, for
 * example:
 * - the referenced schedule changes (amount, frequency, instalments, dates)
 * - the referenced schedule is ended, archived, or deleted
 * - a relevant discount or concession changes
 * - pupil eligibility, year group, class, or enrolment changes
 * - family / account targeting that changes discounts or the billed account
 *
 * Deleting an unused duplicate schedule that is not referenced by the preview
 * does not change the quote result and must NOT mark the preview stale.
 */
export const BILLING_RUN_PREVIEW_STALE_RULE =
  "A preview is stale only when a fresh quote of the same period would issue different invoices than the stored preview. Comparison is pupil + fee schedule + standard + discount + net. Unrelated unused schedule deletion does not stale a preview.";

export function billingRunItemSignature(input: {
  studentProfileId: string;
  feeScheduleId: string | null;
  standardAmountMinor: number;
  discountTotalMinor: number;
  netAmountMinor: number;
}): string {
  return [
    input.studentProfileId,
    input.feeScheduleId ?? "",
    String(input.standardAmountMinor),
    String(input.discountTotalMinor),
    String(input.netAmountMinor),
  ].join(":");
}

export function billingRunPreviewSignaturesDiffer(
  quotes: Array<{
    studentProfileId: string;
    feeScheduleId: string | null;
    standardAmountMinor: number;
    discountTotalMinor: number;
    netAmountMinor: number;
  }>,
  items: Array<{
    studentProfileId: string;
    feeScheduleId: string | null;
    standardAmountMinor: number;
    discountTotalMinor: number;
    netAmountMinor: number;
  }>,
): "eligible_pupils_changed" | "amounts_changed" | null {
  const quoteSignatures = quotes.map(billingRunItemSignature).sort();
  const itemSignatures = items.map(billingRunItemSignature).sort();
  if (quoteSignatures.length !== itemSignatures.length) return "eligible_pupils_changed";
  for (let index = 0; index < quoteSignatures.length; index += 1) {
    if (quoteSignatures[index] !== itemSignatures[index]) return "amounts_changed";
  }
  return null;
}

export function billingRunConfirmSummary(
  items: Array<{
    studentProfileId: string;
    billingAccountId: string | null;
    netAmountMinor: number;
    error?: string | null;
  }>,
): { pupilCount: number; invoiceCount: number; totalMinor: number } {
  const billable = items.filter((item) => !item.error && item.netAmountMinor > 0 && item.billingAccountId);
  return {
    pupilCount: new Set(billable.map((item) => item.studentProfileId)).size,
    invoiceCount: new Set(billable.map((item) => item.billingAccountId)).size,
    totalMinor: billable.reduce((sum, item) => sum + item.netAmountMinor, 0),
  };
}

export const LEGACY_INSTALMENT_METADATA_LABEL = "Legacy preview — instalment metadata not stored";

export function inclusiveMonthIndex(fromIso: string, toIso: string): number {
  const from = asIsoDate(fromIso);
  const to = asIsoDate(toIso);
  const fromYear = Number(from.slice(0, 4));
  const fromMonth = Number(from.slice(5, 7));
  const toYear = Number(to.slice(0, 4));
  const toMonth = Number(to.slice(5, 7));
  return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
}

export function deriveInstalmentNumber(input: {
  frequency: string;
  periodStart: string;
  effectiveFrom?: string | null;
  instalmentCount?: number | null;
}): number | null {
  if (input.frequency === "annual") return 1;
  if (input.frequency !== "monthly" || !input.effectiveFrom) return null;
  const index = inclusiveMonthIndex(input.effectiveFrom, input.periodStart);
  if (index < 1) return null;
  if (input.instalmentCount != null && index > input.instalmentCount) return null;
  return index;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type BillingRunScheduleDisplayContext = {
  id: string;
  name: string;
  annualAmountMinor: number | null;
  instalmentCount: number | null;
  amountMinor: number;
  effectiveFrom: string | null;
  billingFrequency: string | null;
};

export function resolveBillingRunItemDisplay(input: {
  snapshot: Record<string, unknown>;
  run: {
    instalmentNumber: number | null;
    periodStart: string;
    periodEnd: string;
    dueOn: string;
    billingFrequency: string;
    isPreview: boolean;
    isStale: boolean;
  };
  item: {
    standardAmountMinor: number;
    feeScheduleId: string | null;
    invoiceId: string | null;
  };
  currentSchedule?: BillingRunScheduleDisplayContext | null;
}) {
  const snap = input.snapshot;
  const canUseCurrentSchedule =
    input.run.isPreview &&
    !input.run.isStale &&
    !input.item.invoiceId &&
    Boolean(input.currentSchedule) &&
    Boolean(input.item.feeScheduleId) &&
    input.currentSchedule!.id === input.item.feeScheduleId;
  const schedule = canUseCurrentSchedule ? input.currentSchedule! : null;

  const snapshotAnnual = asNullableNumber(snap.annualAmountMinor);
  const snapshotCount = asNullableNumber(snap.instalmentCount);
  const snapshotNumber = asNullableNumber(snap.instalmentNumber);
  const snapshotRegular = asNullableNumber(snap.amountPerInstalmentMinor);

  const instalmentCount = snapshotCount ?? schedule?.instalmentCount ?? null;
  let instalmentNumber = snapshotNumber ?? input.run.instalmentNumber ?? null;
  const amountPerInstalmentMinor = snapshotRegular ?? schedule?.amountMinor ?? null;

  let annualAmountMinor = snapshotAnnual;
  if (annualAmountMinor == null && snapshotRegular != null && snapshotCount != null) {
    annualAmountMinor = snapshotRegular * snapshotCount;
  }
  if (annualAmountMinor == null && schedule) {
    annualAmountMinor =
      schedule.annualAmountMinor ??
      (schedule.instalmentCount != null ? schedule.amountMinor * schedule.instalmentCount : null);
  }

  if (instalmentNumber == null && schedule) {
    instalmentNumber = deriveInstalmentNumber({
      frequency: input.run.billingFrequency || schedule.billingFrequency || "",
      periodStart: input.run.periodStart,
      effectiveFrom: schedule.effectiveFrom,
      instalmentCount,
    });
  }

  const hasInstalmentMeta = instalmentNumber != null && instalmentCount != null;
  return {
    feeScheduleId: (typeof snap.feeScheduleId === "string" && snap.feeScheduleId) || input.item.feeScheduleId,
    feeScheduleName:
      (typeof snap.feeScheduleName === "string" && snap.feeScheduleName) || schedule?.name || null,
    yearGroupName: typeof snap.yearGroupName === "string" ? snap.yearGroupName : null,
    className: typeof snap.className === "string" ? snap.className : null,
    annualAmountMinor,
    instalmentNumber,
    instalmentCount,
    amountPerInstalmentMinor,
    periodStart: typeof snap.periodStart === "string" ? snap.periodStart : input.run.periodStart,
    periodEnd: typeof snap.periodEnd === "string" ? snap.periodEnd : input.run.periodEnd,
    dueOn: typeof snap.dueOn === "string" ? snap.dueOn : input.run.dueOn,
    instalmentLabel: hasInstalmentMeta
      ? `${instalmentNumber} of ${instalmentCount}`
      : LEGACY_INSTALMENT_METADATA_LABEL,
    annualFeeLabel: annualAmountMinor == null ? LEGACY_INSTALMENT_METADATA_LABEL : null,
    usedLegacyMetadataLabel: !hasInstalmentMeta || annualAmountMinor == null,
  };
}

export function feeScheduleSourceFingerprint(input: {
  id: string;
  amountMinor: number;
  annualAmountMinor: number | null;
  instalmentCount: number | null;
  billingFrequency: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  isActive: boolean;
}): string {
  return [
    input.id,
    String(input.amountMinor),
    input.annualAmountMinor == null ? "" : String(input.annualAmountMinor),
    input.instalmentCount == null ? "" : String(input.instalmentCount),
    input.billingFrequency,
    input.effectiveFrom,
    input.effectiveUntil ?? "",
    input.isActive ? "1" : "0",
  ].join("|");
}

export function overlapDays(
  periodStart: string,
  periodEnd: string,
  enrolStart: string | null,
  enrolEnd: string | null,
): number {
  const start = maxIsoDate(periodStart, enrolStart ?? periodStart);
  const end = minIsoDate(periodEnd, enrolEnd ?? periodEnd);
  if (start > end) return 0;
  return inclusiveDayCount(start, end);
}

export function applyMidPeriodPolicy(input: {
  amountMinor: number;
  policy: SchoolMidPeriodPolicy;
  periodStart: string;
  periodEnd: string;
  enrolStart: string | null;
  enrolEnd: string | null;
}): { amountMinor: number; skipped: boolean; prorated: boolean; chargeableDays: number; periodDays: number } {
  const periodDays = inclusiveDayCount(input.periodStart, input.periodEnd);
  const chargeableDays = overlapDays(input.periodStart, input.periodEnd, input.enrolStart, input.enrolEnd);
  const fullPeriod = chargeableDays >= periodDays;
  if (fullPeriod) {
    return { amountMinor: input.amountMinor, skipped: false, prorated: false, chargeableDays, periodDays };
  }
  if (input.policy === "manual") {
    return { amountMinor: 0, skipped: true, prorated: false, chargeableDays, periodDays };
  }
  if (input.policy === "prorate") {
    return {
      amountMinor: prorateMinor(input.amountMinor, chargeableDays, periodDays),
      skipped: chargeableDays <= 0,
      prorated: chargeableDays > 0,
      chargeableDays,
      periodDays,
    };
  }
  return { amountMinor: input.amountMinor, skipped: chargeableDays <= 0, prorated: false, chargeableDays, periodDays };
}

export type SiblingSortInput = {
  studentProfileId: string;
  dateOfBirth: string | null;
  legalName: string;
  yearGroupSort: number;
  explicitPriority: number | null;
};

export function compareSiblings(
  left: SiblingSortInput,
  right: SiblingSortInput,
  mode: SchoolSiblingOrderMode,
): number {
  const leftExplicit = left.explicitPriority;
  const rightExplicit = right.explicitPriority;
  if (mode === "explicit" || leftExplicit != null || rightExplicit != null) {
    const leftRank = leftExplicit ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rightExplicit ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
  }
  if (mode === "year_group") {
    if (left.yearGroupSort !== right.yearGroupSort) return left.yearGroupSort - right.yearGroupSort;
  }
  if (mode === "oldest_first" || mode === "youngest_first" || (left.dateOfBirth && right.dateOfBirth)) {
    const leftDob = left.dateOfBirth;
    const rightDob = right.dateOfBirth;
    if (leftDob && rightDob && leftDob !== rightDob) {
      return mode === "youngest_first" ? (leftDob < rightDob ? 1 : -1) : leftDob < rightDob ? -1 : 1;
    }
    if (leftDob && !rightDob) return -1;
    if (!leftDob && rightDob) return 1;
  }
  const name = left.legalName.localeCompare(right.legalName, "en-GB");
  if (name !== 0) return name;
  return left.studentProfileId.localeCompare(right.studentProfileId);
}

export function orderSiblings(
  pupils: SiblingSortInput[],
  mode: SchoolSiblingOrderMode,
): SiblingSortInput[] {
  return [...pupils].sort((left, right) => compareSiblings(left, right, mode));
}

export type DiscountCandidate = {
  key: string;
  ruleId: string | null;
  concessionId: string | null;
  kind: string;
  name: string;
  amountType: "percent" | "fixed";
  percentBps: number | null;
  amountMinor: number | null;
  stackingPriority: number;
  exclusiveGroup: string | null;
};

export type AppliedDiscount = DiscountCandidate & {
  calculatedMinor: number;
};

export type DiscountApplication = {
  applied: AppliedDiscount[];
  discarded: Array<DiscountCandidate & { reason: string }>;
  discountTotalMinor: number;
  netMinor: number;
};

function calculatedDiscountMinor(standardMinor: number, candidate: DiscountCandidate): number {
  if (candidate.amountType === "percent") {
    return percentOfMinor(standardMinor, candidate.percentBps ?? 0);
  }
  return Math.min(standardMinor, candidate.amountMinor ?? 0);
}

function candidateSort(left: DiscountCandidate, right: DiscountCandidate): number {
  if (left.stackingPriority !== right.stackingPriority) {
    return left.stackingPriority - right.stackingPriority;
  }
  const kind = left.kind.localeCompare(right.kind);
  if (kind !== 0) return kind;
  return left.key.localeCompare(right.key);
}

export function applyDiscounts(
  standardMinor: number,
  candidates: DiscountCandidate[],
  mode: SchoolDiscountStackingMode,
): DiscountApplication {
  if (!Number.isInteger(standardMinor) || standardMinor < 0) {
    throw new Error("invalid_amount");
  }
  const discarded: DiscountApplication["discarded"] = [];
  const eligible = [...candidates].sort(candidateSort).map((candidate) => ({
    ...candidate,
    calculatedMinor: calculatedDiscountMinor(standardMinor, candidate),
  }));

  let selected: AppliedDiscount[] = [];
  if (mode === "highest") {
    let best: AppliedDiscount | null = null;
    for (const candidate of eligible) {
      if (
        !best ||
        candidate.calculatedMinor > best.calculatedMinor ||
        (candidate.calculatedMinor === best.calculatedMinor && candidateSort(candidate, best) < 0)
      ) {
        best = candidate;
      }
    }
    if (best && best.calculatedMinor > 0) {
      selected = [best];
      for (const candidate of eligible) {
        if (candidate.key !== best.key) {
          discarded.push({ ...candidate, reason: "highest_only" });
        }
      }
    }
  } else if (mode === "priority") {
    const usedGroups = new Set<string>();
    for (const candidate of eligible) {
      if (candidate.exclusiveGroup && usedGroups.has(candidate.exclusiveGroup)) {
        discarded.push({ ...candidate, reason: "exclusive_group" });
        continue;
      }
      if (candidate.calculatedMinor <= 0) {
        discarded.push({ ...candidate, reason: "zero_value" });
        continue;
      }
      selected.push(candidate);
      if (candidate.exclusiveGroup) usedGroups.add(candidate.exclusiveGroup);
    }
  } else {
    for (const candidate of eligible) {
      if (candidate.calculatedMinor <= 0) {
        discarded.push({ ...candidate, reason: "zero_value" });
        continue;
      }
      selected.push(candidate);
    }
  }

  let remaining = standardMinor;
  const applied: AppliedDiscount[] = [];
  for (const candidate of selected) {
    const amount = Math.min(candidate.calculatedMinor, remaining);
    if (amount <= 0) {
      discarded.push({ ...candidate, reason: "already_zero" });
      continue;
    }
    applied.push({ ...candidate, calculatedMinor: amount });
    remaining -= amount;
  }

  return {
    applied,
    discarded,
    discountTotalMinor: standardMinor - remaining,
    netMinor: remaining,
  };
}

export function deriveInvoiceStatus(input: {
  current: SchoolInvoiceStatus;
  totalMinor: number;
  paidMinor: number;
  creditMinor?: number;
  dueDate: string;
  gracePeriodDays: number;
  today?: string;
}): SchoolInvoiceStatus {
  if (input.current === "draft" || input.current === "void") return input.current;
  const outstanding = invoiceOutstandingMinor(input.totalMinor, input.paidMinor, input.creditMinor ?? 0);
  if (outstanding <= 0) return "paid";
  const today = input.today ?? isoToday();
  if (isOverdue(input.dueDate, input.gracePeriodDays, today)) return "overdue";
  if (input.paidMinor > 0) return "partially_paid";
  return "issued";
}

export function invoiceOutstandingMinor(totalMinor: number, paidMinor: number, creditMinor = 0): number {
  if (!Number.isInteger(totalMinor) || totalMinor < 0) throw new Error("invalid_amount");
  if (!Number.isInteger(paidMinor) || paidMinor < 0) throw new Error("invalid_amount");
  if (!Number.isInteger(creditMinor) || creditMinor < 0) throw new Error("invalid_amount");
  const settled = paidMinor + creditMinor;
  return settled >= totalMinor ? 0 : totalMinor - settled;
}

export function isOverdue(dueDate: string, gracePeriodDays: number, today: string): boolean {
  const due = addDays(dueDate, gracePeriodDays);
  return today > due;
}

export function billingPeriodKey(
  frequency: SchoolBillingFrequency,
  periodStart: string,
  periodEnd: string,
): string {
  return `tuition:${frequency}:${periodStart}:${periodEnd}`;
}

export function arrearsBucket(daysOverdue: number): "current" | "due_soon" | "overdue" | "30" | "60" | "90" {
  if (daysOverdue <= 0) return daysOverdue < -7 ? "current" : "due_soon";
  if (daysOverdue >= 90) return "90";
  if (daysOverdue >= 60) return "60";
  if (daysOverdue >= 30) return "30";
  return "overdue";
}

export function daysOverdue(dueDate: string, today: string, gracePeriodDays = 0): number {
  const effectiveDue = addDays(dueDate, gracePeriodDays);
  return inclusiveDayCount(effectiveDue, today) - 1;
}

export function asIsoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value ?? "");
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match?.[1]) return match[1];
  throw new Error("invalid_date");
}

function parseIsoDate(value: string): Date {
  const iso = asIsoDate(value);
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error("invalid_date");
  return date;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function maxIsoDate(left: string, right: string): string {
  return left >= right ? left : right;
}

function minIsoDate(left: string, right: string): string {
  return left <= right ? left : right;
}
