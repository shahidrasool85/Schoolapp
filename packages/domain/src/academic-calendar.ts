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
