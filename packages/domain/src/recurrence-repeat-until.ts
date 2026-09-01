export const REPEAT_UNTIL_KINDS = [
  "end_of_term",
  "end_of_academic_year",
  "custom_date",
  "occurrence_count",
] as const;

export type RepeatUntilKind = (typeof REPEAT_UNTIL_KINDS)[number];

export type RepeatUntilInput =
  | { kind: "end_of_term" }
  | { kind: "end_of_academic_year" }
  | { kind: "custom_date"; date: string }
  | { kind: "occurrence_count"; count: number };

export const NO_TERM_FOR_START =
  "No academic term contains this start date. Choose another start date, End of academic year, or Custom date.";

export const NO_TERMS_CONFIGURED =
  "End of term is unavailable because this academic year has no terms yet. Configure term dates first, or choose End of academic year or a custom date.";

export const CUSTOM_DATE_BEFORE_START = "The end date cannot be before the start date.";

export const CUSTOM_DATE_OUTSIDE_YEAR = "The end date must fall inside the selected academic year.";

export const OCCURRENCE_COUNT_TOO_FEW =
  "There are not enough valid teaching dates before the end of the academic year.";

export const START_DATE_OUTSIDE_YEAR = "The start date must fall inside the selected academic year.";

export const MAX_OCCURRENCE_COUNT = 80;

export function formatUkCalendarDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function findTermContainingDate<T extends { startsOn: string; endsOn: string }>(
  date: string,
  terms: T[],
): T | null {
  return terms.find((term) => date >= term.startsOn && date <= term.endsOn) ?? null;
}

export function validateCustomRepeatUntilDate(input: {
  date: string;
  effectiveFrom: string;
  yearStartsOn: string;
  yearEndsOn: string;
}): { ok: true } | { ok: false; error: string } {
  if (input.date < input.effectiveFrom) {
    return { ok: false, error: CUSTOM_DATE_BEFORE_START };
  }
  if (input.date < input.yearStartsOn || input.date > input.yearEndsOn) {
    return { ok: false, error: CUSTOM_DATE_OUTSIDE_YEAR };
  }
  return { ok: true };
}

export function validateOccurrenceCount(count: number): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(count) || count < 1 || count > MAX_OCCURRENCE_COUNT) {
    return {
      ok: false,
      error: `Enter between 1 and ${MAX_OCCURRENCE_COUNT} lessons that should actually take place.`,
    };
  }
  return { ok: true };
}

/** Legacy rows have no stored repeat-until intent. Show the stored end date only. */
export function recurrenceEndsLabel(effectiveUntil: string | null): string {
  if (!effectiveUntil) return "No end date";
  return `Ends ${formatUkCalendarDate(effectiveUntil)}`;
}

export function endOfTermLabel(termName: string, endsOn: string): string {
  return `${termName} ends — ${formatUkCalendarDate(endsOn)}`;
}

export function endOfAcademicYearLabel(yearName: string, endsOn: string): string {
  return `Academic Year ${yearName} ends — ${formatUkCalendarDate(endsOn)}`;
}

export function customDateLabel(endsOn: string): string {
  return formatUkCalendarDate(endsOn);
}

export function occurrenceCountLabel(count: number, lastDate: string): string {
  return `${count} lesson${count === 1 ? "" : "s"} — last on ${formatUkCalendarDate(lastDate)}`;
}

export function defaultRepeatUntilKind(termsConfigured: boolean): RepeatUntilKind {
  return termsConfigured ? "end_of_term" : "end_of_academic_year";
}
