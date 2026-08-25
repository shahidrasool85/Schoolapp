import { STUDENT_PROFILE_STATUSES } from "@schoolapp/domain";

export type OnRollEnrolment = {
  startedOn: string;
  endedOn: string | null;
  isPrimary?: boolean;
  status?: string;
};

export type OnRollPupil = {
  enrolmentStatus: string;
  dateOfAdmission: string | null;
  dateOfLeaving: string | null;
  enrolments: readonly OnRollEnrolment[];
};

function isoDateOnly(value: string): string {
  return value.slice(0, 10);
}

export function compareIsoDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Last day on roll is the leaving date. The following day the pupil is off roll.
 */
export function dateInInclusiveRange(
  date: string,
  start: string | null,
  end: string | null,
): boolean {
  const d = isoDateOnly(date);
  if (start && compareIsoDates(d, isoDateOnly(start)) < 0) return false;
  if (end && compareIsoDates(d, isoDateOnly(end)) > 0) return false;
  return true;
}

export function periodsOverlap(
  startA: string,
  endA: string | null,
  startB: string,
  endB: string | null,
): boolean {
  const a0 = isoDateOnly(startA);
  const b0 = isoDateOnly(startB);
  const a1 = endA ? isoDateOnly(endA) : "9999-12-31";
  const b1 = endB ? isoDateOnly(endB) : "9999-12-31";
  return compareIsoDates(a0, b1) <= 0 && compareIsoDates(b0, a1) <= 0;
}

function coveringEnrolment(pupil: OnRollPupil, date: string): OnRollEnrolment | null {
  const d = isoDateOnly(date);
  const covering = pupil.enrolments.filter((row) => dateInInclusiveRange(d, row.startedOn, row.endedOn));
  return covering.find((row) => row.isPrimary !== false) ?? covering[0] ?? null;
}

export function isOnRollOnDate(pupil: OnRollPupil, date: string): boolean {
  if (pupil.enrolmentStatus === "prospective") return false;
  const d = isoDateOnly(date);
  const start = pupil.dateOfAdmission;
  const leave = pupil.dateOfLeaving;
  if (start && compareIsoDates(d, isoDateOnly(start)) < 0) return false;
  if (leave && compareIsoDates(d, isoDateOnly(leave)) > 0) return false;
  if (pupil.enrolments.length === 0) {
    return pupil.enrolmentStatus === "admitted" || pupil.enrolmentStatus === "enrolled";
  }
  return coveringEnrolment(pupil, d) != null;
}

export function isCurrentPupil(pupil: OnRollPupil, asOf: string): boolean {
  if (!isOnRollOnDate(pupil, asOf)) return false;
  return pupil.enrolmentStatus === "admitted" || pupil.enrolmentStatus === "enrolled";
}

export function isFormerPupil(pupil: OnRollPupil, asOf: string): boolean {
  if (pupil.enrolmentStatus === "left" || pupil.enrolmentStatus === "alumni") {
    return !isOnRollOnDate(pupil, asOf);
  }
  return pupil.dateOfLeaving != null && compareIsoDates(isoDateOnly(asOf), isoDateOnly(pupil.dateOfLeaving)) > 0;
}

export function wasAdmittedDuringPeriod(
  pupil: OnRollPupil,
  periodStart: string,
  periodEnd: string,
): boolean {
  const start = pupil.dateOfAdmission ?? pupil.enrolments.find((row) => row.isPrimary !== false)?.startedOn ?? null;
  if (!start) return false;
  return dateInInclusiveRange(start, periodStart, periodEnd);
}

export function leftDuringPeriod(pupil: OnRollPupil, periodStart: string, periodEnd: string): boolean {
  const leave = pupil.dateOfLeaving ?? pupil.enrolments.find((row) => row.endedOn)?.endedOn ?? null;
  if (!leave) return false;
  return dateInInclusiveRange(leave, periodStart, periodEnd);
}

export function onRollWindow(pupil: OnRollPupil): { start: string | null; end: string | null } {
  const enrolmentStart =
    pupil.enrolments.find((row) => row.isPrimary !== false)?.startedOn ?? pupil.enrolments[0]?.startedOn ?? null;
  const enrolmentEnd =
    pupil.enrolments.find((row) => row.isPrimary !== false)?.endedOn ?? pupil.enrolments[0]?.endedOn ?? null;
  return {
    start: pupil.dateOfAdmission ?? enrolmentStart,
    end: pupil.dateOfLeaving ?? enrolmentEnd,
  };
}

/**
 * Marks before admission or after leaving are excluded from statutory attendance.
 */
export function dateCountsTowardAttendance(pupil: OnRollPupil, markDate: string): boolean {
  return isOnRollOnDate(pupil, markDate);
}

export function isKnownEnrolmentStatus(value: string): boolean {
  return (STUDENT_PROFILE_STATUSES as readonly string[]).includes(value);
}
