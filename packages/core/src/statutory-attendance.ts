import { ATTENDANCE_CATEGORIES, type StatutoryAttendanceCategory } from "@schoolapp/domain";
import { summariseAttendanceMarks, type AttendanceSummary } from "./attendance.js";
import { dateCountsTowardAttendance, type OnRollPupil } from "./on-roll.js";

export const DEFAULT_STATUTORY_ATTENDANCE_MAP: Record<string, StatutoryAttendanceCategory> = {
  present: "present",
  late: "late",
  authorised_absence: "authorised_absence",
  unauthorised_absence: "unauthorised_absence",
  not_required: "not_required",
};

export function mapAttendanceToStatutoryCategory(
  internalCategory: string,
  statutoryCategory: string | null | undefined,
): StatutoryAttendanceCategory | null {
  const mapped = statutoryCategory || DEFAULT_STATUTORY_ATTENDANCE_MAP[internalCategory] || null;
  if (mapped && (ATTENDANCE_CATEGORIES as readonly string[]).includes(mapped)) {
    return mapped as StatutoryAttendanceCategory;
  }
  return null;
}

export type StatutoryAttendanceMark = {
  markDate: string;
  category: string;
  statutoryCategory?: string | null;
};

export function summariseStatutoryAttendance(
  pupil: OnRollPupil,
  marks: readonly StatutoryAttendanceMark[],
): AttendanceSummary {
  const counted = marks
    .filter((mark) => dateCountsTowardAttendance(pupil, mark.markDate))
    .map((mark) => {
      const category = mapAttendanceToStatutoryCategory(mark.category, mark.statutoryCategory);
      return category ? { category } : null;
    })
    .filter((row): row is { category: StatutoryAttendanceCategory } => row != null);
  return summariseAttendanceMarks(counted);
}

export type GroupedAttendanceRow = {
  key: string;
  label: string;
  summary: AttendanceSummary;
  pupilCount: number;
};

export function groupAttendanceSummaries(
  rows: Array<{ groupKey: string; groupLabel: string; summary: AttendanceSummary }>,
): GroupedAttendanceRow[] {
  const grouped = new Map<string, GroupedAttendanceRow>();
  for (const row of rows) {
    const current = grouped.get(row.groupKey) ?? {
      key: row.groupKey,
      label: row.groupLabel,
      pupilCount: 0,
      summary: {
        sessionsPossible: 0,
        sessionsPresent: 0,
        authorisedAbsence: 0,
        unauthorisedAbsence: 0,
        late: 0,
        notRequired: 0,
        attendancePercentage: null,
      },
    };
    current.pupilCount += 1;
    current.summary.sessionsPossible += row.summary.sessionsPossible;
    current.summary.sessionsPresent += row.summary.sessionsPresent;
    current.summary.authorisedAbsence += row.summary.authorisedAbsence;
    current.summary.unauthorisedAbsence += row.summary.unauthorisedAbsence;
    current.summary.late += row.summary.late;
    current.summary.notRequired += row.summary.notRequired;
    grouped.set(row.groupKey, current);
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    summary: {
      ...row.summary,
      attendancePercentage:
        row.summary.sessionsPossible > 0
          ? Math.round((row.summary.sessionsPresent / row.summary.sessionsPossible) * 1000) / 10
          : null,
    },
  }));
}
