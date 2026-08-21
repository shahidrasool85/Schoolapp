import { ATTENDANCE_CATEGORIES, type AttendanceCategory } from "@schoolapp/domain";

export type AttendanceMarkCategoryInput = {
  category: string;
};

export type AttendanceSummary = {
  sessionsPossible: number;
  sessionsPresent: number;
  authorisedAbsence: number;
  unauthorisedAbsence: number;
  late: number;
  notRequired: number;
  attendancePercentage: number | null;
};

export function isAttendanceCategory(value: string): value is AttendanceCategory {
  return (ATTENDANCE_CATEGORIES as readonly string[]).includes(value);
}

export function roundAttendancePercentage(value: number): number {
  return Math.round(value * 10) / 10;
}

export function attendancePercentage(sessionsPresent: number, sessionsPossible: number): number | null {
  if (sessionsPossible <= 0) return null;
  return roundAttendancePercentage((sessionsPresent / sessionsPossible) * 100);
}

/**
 * Attendance percentage is sessions counted present (including late)
 * divided by sessions possible. `not_required` marks are excluded from
 * both the numerator and the denominator so they do not reduce attendance.
 */
export function summariseAttendanceMarks(
  marks: readonly AttendanceMarkCategoryInput[],
): AttendanceSummary {
  let sessionsPresent = 0;
  let authorisedAbsence = 0;
  let unauthorisedAbsence = 0;
  let late = 0;
  let notRequired = 0;

  for (const mark of marks) {
    if (!isAttendanceCategory(mark.category)) continue;
    switch (mark.category) {
      case "present":
        sessionsPresent += 1;
        break;
      case "late":
        sessionsPresent += 1;
        late += 1;
        break;
      case "authorised_absence":
        authorisedAbsence += 1;
        break;
      case "unauthorised_absence":
        unauthorisedAbsence += 1;
        break;
      case "not_required":
        notRequired += 1;
        break;
    }
  }

  const sessionsPossible = sessionsPresent + authorisedAbsence + unauthorisedAbsence;
  return {
    sessionsPossible,
    sessionsPresent,
    authorisedAbsence,
    unauthorisedAbsence,
    late,
    notRequired,
    attendancePercentage: attendancePercentage(sessionsPresent, sessionsPossible),
  };
}

export function emptyAttendanceSummary(): AttendanceSummary {
  return {
    sessionsPossible: 0,
    sessionsPresent: 0,
    authorisedAbsence: 0,
    unauthorisedAbsence: 0,
    late: 0,
    notRequired: 0,
    attendancePercentage: null,
  };
}
