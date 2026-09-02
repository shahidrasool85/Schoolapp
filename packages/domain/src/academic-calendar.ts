export const DEFAULT_SCHOOL_TIMEZONE = "Europe/London";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const tz = timeZone.trim() || DEFAULT_SCHOOL_TIMEZONE;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_SCHOOL_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  }
}

/**
 * Recurring-lesson Effective from default (school timezone):
 * max(today, academicYear.startDate), then clamped to the year end so the
 * client cannot submit an obvious date before the selected year.
 *
 * Terms are not used for this default. Recurrence is year-scoped; term windows
 * only affect occurrence expansion (no terms → academic-year fallback).
 */
export function defaultRecurrenceEffectiveFrom(input: {
  today: string;
  academicYearStartsOn: string;
  academicYearEndsOn?: string | null;
}): string {
  const start = input.academicYearStartsOn;
  const today = input.today;
  const candidate = today > start ? today : start;
  if (input.academicYearEndsOn && candidate > input.academicYearEndsOn) {
    return input.academicYearEndsOn;
  }
  return candidate;
}

export function effectiveFromBeforeAcademicYear(effectiveFrom: string, academicYearStartsOn: string): boolean {
  return effectiveFrom < academicYearStartsOn;
}

export function shouldOfferAcademicYearCreate(yearCount: number): boolean {
  return yearCount === 0;
}

export function termKeyFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "term";
}

export function uniqueTermKey(base: string, existing: string[]): string {
  const keys = new Set(existing);
  if (!keys.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const suffix = `-${n}`;
    const next = `${base.slice(0, Math.max(1, 32 - suffix.length))}${suffix}`;
    if (!keys.has(next)) return next;
  }
  return `${base.slice(0, 24)}-${Date.now().toString(36).slice(-7)}`;
}

export function datesOverlapInclusive(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

export function validateTermDates(input: {
  startsOn: string;
  endsOn: string;
  yearStartsOn: string;
  yearEndsOn: string;
  otherTerms?: Array<{ id?: string; startsOn: string; endsOn: string }>;
  ignoreTermId?: string;
}): { ok: true } | { ok: false; error: string } {
  if (input.endsOn < input.startsOn) {
    return { ok: false, error: "Term end must be on or after the start date." };
  }
  if (input.startsOn < input.yearStartsOn || input.endsOn > input.yearEndsOn) {
    return { ok: false, error: "Term dates must fall inside the academic year." };
  }
  const clash = (input.otherTerms ?? []).find((term) => {
    if (input.ignoreTermId && term.id === input.ignoreTermId) return false;
    return datesOverlapInclusive(input.startsOn, input.endsOn, term.startsOn, term.endsOn);
  });
  if (clash) {
    return { ok: false, error: "Term dates must not overlap another term in this academic year." };
  }
  return { ok: true };
}

export const NON_TEACHING_CLOSURE_LABELS: Record<string, string> = {
  half_term: "Half term",
  bank_holiday: "Bank holiday",
  inset_day: "INSET day",
  school_closure: "School closure",
  other: "Other non-teaching day",
};

export function validateClosureRange(input: {
  startsOn: string;
  endsOn: string;
  yearStartsOn: string;
  yearEndsOn: string;
  termStartsOn?: string | null;
  termEndsOn?: string | null;
  otherClosures?: Array<{ id?: string; startsOn: string; endsOn: string }>;
  ignoreId?: string;
}): { ok: true } | { ok: false; error: string } {
  if (input.endsOn < input.startsOn) {
    return { ok: false, error: "The end date must be on or after the start date." };
  }
  if (input.startsOn < input.yearStartsOn || input.endsOn > input.yearEndsOn) {
    return { ok: false, error: "Non-teaching dates must fall inside the academic year." };
  }
  if (input.termStartsOn && input.termEndsOn) {
    if (input.startsOn < input.termStartsOn || input.endsOn > input.termEndsOn) {
      return { ok: false, error: "Half term dates must fall inside the parent term." };
    }
  }
  const clash = (input.otherClosures ?? []).find((row) => {
    if (input.ignoreId && row.id === input.ignoreId) return false;
    return datesOverlapInclusive(input.startsOn, input.endsOn, row.startsOn, row.endsOn);
  });
  if (clash) {
    return { ok: false, error: "This non-teaching range overlaps another closure in the same year." };
  }
  return { ok: true };
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatUkShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return `${day} ${MONTH_SHORT[month - 1]}`;
}

export function formatUkDateRange(startsOn: string, endsOn: string): string {
  const start = formatUkShortDate(startsOn);
  const end = formatUkShortDate(endsOn);
  const startYear = startsOn.slice(0, 4);
  const endYear = endsOn.slice(0, 4);
  if (startYear === endYear) {
    return `${start} – ${end}`;
  }
  return `${start} ${startYear} – ${end} ${endYear}`;
}

export const UK_TAX_YEAR_START_MONTH = 4;
export const UK_TAX_YEAR_START_DAY = 6;

export const STATEMENT_PERIOD_PRESETS = [
  "current_academic_year",
  "previous_academic_year",
  "current_uk_tax_year",
  "previous_uk_tax_year",
  "calendar_year",
  "custom",
] as const;
export type StatementPeriodPreset = (typeof STATEMENT_PERIOD_PRESETS)[number];

function ukTaxYearContaining(isoDate: string): { from: string; to: string } {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  const startsThisCalendarYear =
    month > UK_TAX_YEAR_START_MONTH || (month === UK_TAX_YEAR_START_MONTH && day >= UK_TAX_YEAR_START_DAY);
  const startYear = startsThisCalendarYear ? year : year - 1;
  return { from: `${startYear}-04-06`, to: `${startYear + 1}-04-05` };
}

export function statementPeriodRange(input: {
  preset: StatementPeriodPreset;
  today: string;
  currentAcademicYear?: { startsOn: string; endsOn: string } | null;
  previousAcademicYear?: { startsOn: string; endsOn: string } | null;
  customFrom?: string | null;
  customTo?: string | null;
}): { ok: true; from: string; to: string } | { ok: false; error: string } {
  if (input.preset === "custom") {
    if (!input.customFrom || !input.customTo) {
      return { ok: false, error: "Choose a start and end date for the custom range." };
    }
    if (input.customTo < input.customFrom) {
      return { ok: false, error: "The end date must be on or after the start date." };
    }
    return { ok: true, from: input.customFrom, to: input.customTo };
  }
  if (input.preset === "current_academic_year") {
    if (!input.currentAcademicYear) {
      return { ok: false, error: "This school has no current academic year." };
    }
    return { ok: true, from: input.currentAcademicYear.startsOn, to: input.currentAcademicYear.endsOn };
  }
  if (input.preset === "previous_academic_year") {
    if (!input.previousAcademicYear) {
      return { ok: false, error: "No previous academic year is available." };
    }
    return { ok: true, from: input.previousAcademicYear.startsOn, to: input.previousAcademicYear.endsOn };
  }
  if (input.preset === "current_uk_tax_year") {
    return { ok: true, ...ukTaxYearContaining(input.today) };
  }
  if (input.preset === "previous_uk_tax_year") {
    const current = ukTaxYearContaining(input.today);
    const startYear = Number(current.from.slice(0, 4)) - 1;
    return { ok: true, from: `${startYear}-04-06`, to: `${startYear + 1}-04-05` };
  }
  const year = input.today.slice(0, 4);
  return { ok: true, from: `${year}-01-01`, to: `${year}-12-31` };
}

export function parseGbpPoundsToMinor(
  value: string,
): { ok: true; amount: number } | { ok: false; error: string } {
  const trimmed = value.trim().replace(/£/g, "").replace(/,/g, "");
  if (!trimmed) {
    return { ok: false, error: "Enter an amount such as 600.00." };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, error: "Enter an amount such as 600.00." };
  }
  const [whole, fraction = ""] = trimmed.split(".");
  return { ok: true, amount: Number(whole) * 100 + Number(fraction.padEnd(2, "0")) };
}

export function feeScheduleAnnualMatchesInstalments(input: {
  amountMinor: number;
  instalmentCount?: number | null;
  annualAmountMinor?: number | null;
}): { ok: true } | { ok: false; error: string } {
  if (input.annualAmountMinor == null || input.instalmentCount == null) return { ok: true };
  if (input.amountMinor * input.instalmentCount !== input.annualAmountMinor) {
    return {
      ok: false,
      error: "Annual total must equal the amount per invoice multiplied by instalments per year.",
    };
  }
  return { ok: true };
}
