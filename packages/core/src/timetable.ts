import {
  ISO_WEEKDAYS,
  ROOM_LOCATION_TYPES,
  SCHOOL_DAY_PERIOD_TYPES,
  TIMETABLE_EXCEPTION_TYPES,
  TIMETABLE_LESSON_TYPES,
  TIMETABLE_OCCURRENCE_STATUSES,
  TIMETABLE_TEACHER_ROLES,
  type IsoWeekday,
  type RoomLocationType,
  type SchoolDayPeriodType,
  type TimetableExceptionType,
  type TimetableLessonType,
  type TimetableOccurrenceStatus,
  type TimetableTeacherRole,
} from "@schoolapp/domain";

export function isSchoolDayPeriodType(value: string): value is SchoolDayPeriodType {
  return (SCHOOL_DAY_PERIOD_TYPES as readonly string[]).includes(value);
}

export function isRoomLocationType(value: string): value is RoomLocationType {
  return (ROOM_LOCATION_TYPES as readonly string[]).includes(value);
}

export function isTimetableLessonType(value: string): value is TimetableLessonType {
  return (TIMETABLE_LESSON_TYPES as readonly string[]).includes(value);
}

export function isTimetableTeacherRole(value: string): value is TimetableTeacherRole {
  return (TIMETABLE_TEACHER_ROLES as readonly string[]).includes(value);
}

export function isTimetableExceptionType(value: string): value is TimetableExceptionType {
  return (TIMETABLE_EXCEPTION_TYPES as readonly string[]).includes(value);
}

export function isTimetableOccurrenceStatus(value: string): value is TimetableOccurrenceStatus {
  return (TIMETABLE_OCCURRENCE_STATUSES as readonly string[]).includes(value);
}

export function isIsoWeekday(value: number): value is IsoWeekday {
  return (ISO_WEEKDAYS as readonly number[]).includes(value);
}

export function isoWeekdayFromDate(value: string): IsoWeekday {
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDay();
  return (day === 0 ? 7 : day) as IsoWeekday;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function eachDateInclusive(from: string, to: string): string[] {
  if (from > to) return [];
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function dateWindowsOverlap(
  aFrom: string,
  aUntil: string | null,
  bFrom: string,
  bUntil: string | null,
): boolean {
  const aEnd = aUntil ?? "9999-12-31";
  const bEnd = bUntil ?? "9999-12-31";
  return aFrom <= bEnd && aEnd >= bFrom;
}

export function dateInRange(date: string, from: string, until: string | null): boolean {
  return date >= from && (until === null || date <= until);
}

export function startOfIsoWeek(isoDate: string): string {
  const weekday = isoWeekdayFromDate(isoDate);
  return addDays(isoDate, 1 - weekday);
}

export function weekdayLabel(weekday: number): string {
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][weekday - 1] ?? "Unknown";
}

export type ResolvedOccurrenceStatus = TimetableOccurrenceStatus;

export function occurrenceStatusFromException(
  exceptionType: TimetableExceptionType | null,
  hasCover: boolean,
): ResolvedOccurrenceStatus {
  if (exceptionType === "cancelled" || exceptionType === "school_closure") {
    return exceptionType;
  }
  if (exceptionType && isTimetableOccurrenceStatus(exceptionType)) {
    return exceptionType;
  }
  if (hasCover) return "covered";
  return "scheduled";
}

export function inferAttendanceSessionKey(startsAt: string, periodType: string | null): "am" | "pm" {
  if (startsAt < "12:00") return "am";
  if (periodType === "registration") return "pm";
  return startsAt < "13:00" ? "am" : "pm";
}
