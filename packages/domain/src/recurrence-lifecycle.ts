export const RECURRENCE_LIFECYCLE_STATUSES = ["future", "active", "ended"] as const;
export type RecurrenceLifecycleStatus = (typeof RECURRENCE_LIFECYCLE_STATUSES)[number];

export const STRUCTURAL_RECURRENCE_PATCH_KEYS = [
  "academicYearId",
  "termId",
  "schoolDayPeriodId",
  "weekday",
  "startsAt",
  "endsAt",
  "classId",
  "yearGroupId",
  "subjectId",
  "roomId",
  "lessonType",
  "effectiveFrom",
  "effectiveUntil",
  "repeatUntil",
  "teachers",
  "customTime",
] as const;

export type RecurrenceUsageCount = {
  key: string;
  label: string;
  count: number;
};

export type RecurrenceLifecycle = {
  status: RecurrenceLifecycleStatus;
  canDelete: boolean;
  canEnd: boolean;
  canEditStructure: boolean;
  canEditNotes: boolean;
  reasons: string[];
  usage: RecurrenceUsageCount[];
  message: string;
};

/**
 * timetable_entries.is_active means "not administratively withdrawn".
 * Ending a recurrence keeps is_active=true and writes effective_until so
 * historical lessons, covers and conflict windows stay attached.
 * Lesson generation, clashes and "currently effective" status use
 * effective_from / effective_until (and today), not is_active alone.
 */
export function computeRecurrenceStatus(input: {
  effectiveFrom: string;
  effectiveUntil: string | null;
  isActive: boolean;
  today: string;
}): RecurrenceLifecycleStatus {
  if (!input.isActive) return "ended";
  if (input.effectiveUntil && input.effectiveUntil < input.today) return "ended";
  if (input.effectiveFrom > input.today) return "future";
  return "active";
}

export function addIsoDaysUtc(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** First date with no further lessons. Last included date is the day before. */
export function effectiveUntilFromStopFrom(stopFrom: string): string {
  return addIsoDaysUtc(stopFrom, -1);
}

export function defaultStopFromDate(today: string): string {
  return addIsoDaysUtc(today, 1);
}

export function validateRecurrenceStopFrom(input: {
  stopFrom: string;
  effectiveFrom: string;
  today: string;
  yearEndsOn: string;
}): { ok: true; effectiveUntil: string } | { ok: false; error: string } {
  if (input.stopFrom < input.today) {
    return { ok: false, error: "The stop date cannot be in the past. Past timetable history is kept." };
  }
  if (input.stopFrom <= input.effectiveFrom) {
    return {
      ok: false,
      error: "Choose a stop date after the first lesson date, or delete a future unused recurrence instead.",
    };
  }
  const effectiveUntil = effectiveUntilFromStopFrom(input.stopFrom);
  if (effectiveUntil > input.yearEndsOn) {
    return { ok: false, error: "The last lesson date must fall inside the academic year." };
  }
  return { ok: true, effectiveUntil };
}

export const APPLY_FROM_AFTER_ORIGINAL_END =
  "Choose a date on or before the original last lesson date. The replacement must keep that original end date.";

export const APPLY_FROM_NO_REMAINING_LESSONS =
  "This change date would not produce any remaining lessons before the original end date. Choose an earlier date, or end the recurrence instead.";

/**
 * Split an existing recurrence from applyFrom.
 * The replacement inherits the stored effective_until. It must not infer
 * end-of-term or end-of-year intent, and must not extend past the original end.
 */
export function validateRecurrenceApplyFrom(input: {
  applyFrom: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  today: string;
  yearEndsOn: string;
}): { ok: true; oldEffectiveUntil: string; inheritedUntil: string | null } | { ok: false; error: string } {
  const stop = validateRecurrenceStopFrom({
    stopFrom: input.applyFrom,
    effectiveFrom: input.effectiveFrom,
    today: input.today,
    yearEndsOn: input.yearEndsOn,
  });
  if (!stop.ok) return stop;
  if (input.effectiveUntil && input.applyFrom > input.effectiveUntil) {
    return { ok: false, error: APPLY_FROM_AFTER_ORIGINAL_END };
  }
  return {
    ok: true,
    oldEffectiveUntil: stop.effectiveUntil,
    inheritedUntil: input.effectiveUntil,
  };
}

function formatUsage(item: RecurrenceUsageCount): string {
  if (item.count === 1) {
    if (item.label.endsWith("s")) return `1 ${item.label.slice(0, -1)}`;
    return `1 ${item.label}`;
  }
  return `${item.count} ${item.label}`;
}

export function summarizeRecurrenceUsage(usage: RecurrenceUsageCount[]): string {
  const used = usage.filter((item) => item.count > 0);
  if (used.length === 0) return "";
  const parts = used.map(formatUsage);
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function recurrenceLifecycleFromState(input: {
  effectiveFrom: string;
  effectiveUntil: string | null;
  isActive: boolean;
  today: string;
  usage: RecurrenceUsageCount[];
}): RecurrenceLifecycle {
  const status = computeRecurrenceStatus(input);
  const used = input.usage.filter((item) => item.count > 0);
  const referenced = used.length > 0;
  const canDelete = status === "future" && !referenced;
  const canEnd = status === "active" || (status === "future" && referenced);
  const canEditStructure = status === "future" && !referenced;
  const reasons: string[] = [];
  if (status === "ended") reasons.push("This recurring lesson has already ended.");
  if (status === "active") reasons.push("This recurring lesson has already started.");
  if (referenced) reasons.push(summarizeRecurrenceUsage(used));
  let message = "This recurring lesson can be edited.";
  if (canDelete) {
    message = "This future recurrence has not been used and can be deleted.";
  } else if (status === "ended") {
    message = "This recurring lesson has ended. Past timetable history remains readable.";
  } else if (!canDelete && referenced) {
    message = "This recurring lesson already has timetable history and cannot be deleted. End the recurrence instead.";
  } else if (status === "active") {
    message = "This recurring lesson has already started. End it from a date to keep past timetable history.";
  }
  return {
    status,
    canDelete,
    canEnd,
    canEditStructure,
    canEditNotes: true,
    reasons,
    usage: input.usage,
    message,
  };
}

export function recurrencePatchTouchesStructure(patch: Record<string, unknown>): boolean {
  return STRUCTURAL_RECURRENCE_PATCH_KEYS.some((key) => patch[key] !== undefined);
}

export const RECURRENCE_STRUCTURAL_EDIT_BLOCKED =
  "This recurring lesson has history and cannot be structurally edited. End it from a date and create a new recurrence for future changes.";

export const RECURRENCE_DELETE_BLOCKED =
  "This recurring lesson already has timetable history and cannot be deleted. End the recurrence instead.";
