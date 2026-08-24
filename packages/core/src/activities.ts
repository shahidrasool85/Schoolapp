import {
  SCHOOL_ACTIVITY_ATTENDANCE_STATUSES,
  SCHOOL_ACTIVITY_DOCUMENT_VISIBILITIES,
  SCHOOL_ACTIVITY_OCCURRENCE_KINDS,
  SCHOOL_ACTIVITY_REGISTRATION_SOURCES,
  SCHOOL_ACTIVITY_REGISTRATION_STATUSES,
  SCHOOL_ACTIVITY_RESPONSE_CHANNELS,
  SCHOOL_ACTIVITY_RESPONSE_VALUES,
  SCHOOL_ACTIVITY_STAFF_ROLES,
  SCHOOL_ACTIVITY_STATUSES,
  SCHOOL_ACTIVITY_TARGET_TYPES,
  SCHOOL_ACTIVITY_TYPE_KEYS,
  type SchoolActivityAttendanceStatus,
  type SchoolActivityDocumentVisibility,
  type SchoolActivityOccurrenceKind,
  type SchoolActivityRegistrationSource,
  type SchoolActivityRegistrationStatus,
  type SchoolActivityResponseChannel,
  type SchoolActivityResponseValue,
  type SchoolActivityStaffRole,
  type SchoolActivityStatus,
  type SchoolActivityTargetType,
  type SchoolActivityTypeKey,
} from "@schoolapp/domain";
import { addDays, eachDateInclusive, isoWeekdayFromDate } from "./timetable.js";

const ACTIVITY_TRANSITIONS: Record<SchoolActivityStatus, readonly SchoolActivityStatus[]> = {
  draft: ["published", "cancelled", "archived"],
  published: ["closed", "completed", "cancelled", "archived"],
  closed: ["published", "completed", "cancelled", "archived"],
  completed: ["archived"],
  cancelled: ["archived"],
  archived: [],
};

export function isSchoolActivityStatus(value: string): value is SchoolActivityStatus {
  return (SCHOOL_ACTIVITY_STATUSES as readonly string[]).includes(value);
}

export function isSchoolActivityTypeKey(value: string): value is SchoolActivityTypeKey {
  return (SCHOOL_ACTIVITY_TYPE_KEYS as readonly string[]).includes(value);
}

export function isSchoolActivityTargetType(value: string): value is SchoolActivityTargetType {
  return (SCHOOL_ACTIVITY_TARGET_TYPES as readonly string[]).includes(value);
}

export function isSchoolActivityStaffRole(value: string): value is SchoolActivityStaffRole {
  return (SCHOOL_ACTIVITY_STAFF_ROLES as readonly string[]).includes(value);
}

export function isSchoolActivityOccurrenceKind(value: string): value is SchoolActivityOccurrenceKind {
  return (SCHOOL_ACTIVITY_OCCURRENCE_KINDS as readonly string[]).includes(value);
}

export function isSchoolActivityRegistrationStatus(
  value: string,
): value is SchoolActivityRegistrationStatus {
  return (SCHOOL_ACTIVITY_REGISTRATION_STATUSES as readonly string[]).includes(value);
}

export function isSchoolActivityAttendanceStatus(
  value: string,
): value is SchoolActivityAttendanceStatus {
  return (SCHOOL_ACTIVITY_ATTENDANCE_STATUSES as readonly string[]).includes(value);
}

export function isSchoolActivityResponseValue(value: string): value is SchoolActivityResponseValue {
  return (SCHOOL_ACTIVITY_RESPONSE_VALUES as readonly string[]).includes(value);
}

export function isSchoolActivityResponseChannel(
  value: string,
): value is SchoolActivityResponseChannel {
  return (SCHOOL_ACTIVITY_RESPONSE_CHANNELS as readonly string[]).includes(value);
}

export function isSchoolActivityRegistrationSource(
  value: string,
): value is SchoolActivityRegistrationSource {
  return (SCHOOL_ACTIVITY_REGISTRATION_SOURCES as readonly string[]).includes(value);
}

export function isSchoolActivityDocumentVisibility(
  value: string,
): value is SchoolActivityDocumentVisibility {
  return (SCHOOL_ACTIVITY_DOCUMENT_VISIBILITIES as readonly string[]).includes(value);
}

export function isActivityStatusTransitionAllowed(
  from: SchoolActivityStatus,
  to: SchoolActivityStatus,
): boolean {
  if (from === to) return true;
  return ACTIVITY_TRANSITIONS[from].includes(to);
}

export function activityDatesValid(startsAt: string, endsAt: string): boolean {
  return new Date(endsAt).getTime() >= new Date(startsAt).getTime();
}

export function activityDeadlineValid(
  deadlineAt: string | null | undefined,
  endsAt: string,
): boolean {
  if (!deadlineAt) return true;
  return new Date(deadlineAt).getTime() <= new Date(endsAt).getTime();
}

export function activityResponseWindowOpen(input: {
  status: string;
  responseDeadlineAt: string | null;
  allowAfterDeadline: boolean;
  now?: Date;
}): boolean {
  if (input.status === "cancelled" || input.status === "archived" || input.status === "completed") {
    return false;
  }
  if (input.status !== "published" && input.status !== "closed") return false;
  if (!input.responseDeadlineAt || input.allowAfterDeadline) return true;
  return new Date(input.responseDeadlineAt).getTime() >= (input.now ?? new Date()).getTime();
}

export function activityVisibleOnPortal(input: {
  status: string;
  parentVisible?: boolean;
  studentVisible?: boolean;
  audience: "parent" | "student";
}): boolean {
  if (!["published", "closed", "completed", "cancelled"].includes(input.status)) return false;
  if (input.audience === "parent") return input.parentVisible !== false;
  return input.studentVisible !== false;
}

export function activityDocumentVisibleToAudience(
  visibility: string,
  audience: "staff" | "parent" | "student",
): boolean {
  if (audience === "staff") return true;
  if (audience === "parent") {
    return visibility === "staff_and_parents" || visibility === "staff_parents_and_student";
  }
  return visibility === "staff_parents_and_student";
}

export function activityStaffSeesMedicalWindow(input: {
  status: string;
  endsAt: string;
  now?: Date;
}): boolean {
  if (input.status === "published" || input.status === "closed") return true;
  if (input.status !== "completed") return false;
  const now = input.now ?? new Date();
  return now.getTime() <= new Date(input.endsAt).getTime() + 24 * 60 * 60 * 1000;
}

export type ConsentClauseSnapshot = {
  clauseKey: string;
  title: string;
  wording: string;
  required: boolean;
  sortOrder: number;
};

export function snapshotConsentWording(
  clauses: ConsentClauseSnapshot[],
  consentVersion: number,
  capturedAt: string,
): Record<string, unknown> {
  return {
    consentVersion,
    capturedAt,
    clauses: clauses.map((clause) => ({
      clauseKey: clause.clauseKey,
      title: clause.title,
      wording: clause.wording,
      required: clause.required,
      sortOrder: clause.sortOrder,
    })),
  };
}

export function nextWaitingListPosition(currentPositions: number[]): number {
  if (currentPositions.length === 0) return 1;
  return Math.max(...currentPositions) + 1;
}

export function allocateRegistrationStatus(input: {
  capacity: number | null;
  confirmedCount: number;
  preferConfirmed: boolean;
}): "confirmed" | "waitlisted" {
  if (!input.preferConfirmed) return "waitlisted";
  if (input.capacity == null) return "confirmed";
  return input.confirmedCount < input.capacity ? "confirmed" : "waitlisted";
}

export function activityNotificationBody(
  type:
    | "activity_published"
    | "activity_updated"
    | "activity_cancelled"
    | "activity_consent_required"
    | "activity_deadline"
    | "activity_place_confirmed"
    | "activity_waitlisted"
    | "activity_promoted"
    | "activity_assignment",
  title: string,
): { title: string; body: string } {
  switch (type) {
    case "activity_published":
      return { title: `New activity: ${title}`, body: `${title} is now available.` };
    case "activity_consent_required":
      return {
        title: `Consent needed: ${title}`,
        body: `Please respond for ${title}. This is a school consent acknowledgement, not an electronic signature.`,
      };
    case "activity_deadline":
      return { title: `Response deadline: ${title}`, body: `The response deadline for ${title} is approaching.` };
    case "activity_updated":
      return { title: `Activity updated: ${title}`, body: `Details for ${title} have been updated.` };
    case "activity_cancelled":
      return { title: `Cancelled: ${title}`, body: `${title} has been cancelled.` };
    case "activity_place_confirmed":
      return { title: `Place confirmed: ${title}`, body: `A place on ${title} is confirmed.` };
    case "activity_waitlisted":
      return {
        title: `Waiting list: ${title}`,
        body: `${title} is currently full. You have been added to the waiting list.`,
      };
    case "activity_promoted":
      return { title: `Place available: ${title}`, body: `A waiting-list place on ${title} has been confirmed.` };
    case "activity_assignment":
      return { title: `Activity assignment: ${title}`, body: `You have been assigned to ${title}.` };
  }
}

export type ActivityCalendarOccurrence = {
  startsAt: string;
  endsAt: string;
  date: string;
};

export function expandActivityOccurrences(input: {
  startsAt: string;
  endsAt: string;
  occurrenceKind: string;
  recurrenceWeekdays: number[] | null;
  recurrenceUntil: string | null;
  from?: string | null;
  to?: string | null;
}): ActivityCalendarOccurrence[] {
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const firstDate = input.startsAt.slice(0, 10);
  if (input.occurrenceKind !== "recurring" || !input.recurrenceWeekdays?.length || !input.recurrenceUntil) {
    const fromDate = input.from?.slice(0, 10) ?? null;
    const toDate = input.to?.slice(0, 10) ?? null;
    const endDate = end.toISOString().slice(0, 10);
    const startDate = start.toISOString().slice(0, 10);
    if (fromDate && endDate < fromDate) return [];
    if (toDate && startDate > toDate) return [];
    return [{ startsAt: input.startsAt, endsAt: input.endsAt, date: firstDate }];
  }
  const rangeFrom = input.from?.slice(0, 10) ?? firstDate;
  const rangeTo = input.to?.slice(0, 10) ?? input.recurrenceUntil;
  const windowFrom = rangeFrom > firstDate ? rangeFrom : firstDate;
  const windowTo = rangeTo < input.recurrenceUntil ? rangeTo : input.recurrenceUntil;
  const weekdays = new Set(input.recurrenceWeekdays);
  const timePart = input.startsAt.slice(10);
  return eachDateInclusive(windowFrom, windowTo)
    .filter((date) => weekdays.has(isoWeekdayFromDate(date)))
    .map((date) => {
      const startsAt = `${date}${timePart}`;
      const endsAt = new Date(new Date(startsAt).getTime() + durationMs).toISOString();
      return { startsAt, endsAt, date };
    });
}

export function summariseActivityResponses(input: {
  eligible: number;
  consented: number;
  declined: number;
  withdrawn: number;
  pending: number;
  confirmed: number;
  waitlisted: number;
}): {
  eligible: number;
  responded: number;
  consented: number;
  declined: number;
  pending: number;
  withdrawn: number;
  confirmed: number;
  waitlisted: number;
  availableSpaces: number | null;
  capacity: number | null;
} {
  return {
    eligible: input.eligible,
    responded: input.consented + input.declined + input.withdrawn,
    consented: input.consented,
    declined: input.declined,
    pending: input.pending,
    withdrawn: input.withdrawn,
    confirmed: input.confirmed,
    waitlisted: input.waitlisted,
    availableSpaces: null,
    capacity: null,
  };
}

export function availableSpaces(capacity: number | null, confirmed: number): number | null {
  if (capacity == null) return null;
  return Math.max(0, capacity - confirmed);
}

export function isoDatePlusDays(iso: string, days: number): string {
  return addDays(iso.slice(0, 10), days);
}

export type ActivitySafetySummary = {
  studentProfileId: string;
  legalName: string;
  allergies: string | null;
  medication: string | null;
  dietaryRequirements: string | null;
  medicalConditions: string | null;
  emergencyContacts: Array<{
    name: string;
    relationship: string;
    email: string | null;
    isEmergencyContact: boolean;
    hasParentalResponsibility: boolean;
  }>;
};
