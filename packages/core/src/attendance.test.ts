import { describe, expect, it } from "vitest";
import {
  attendancePercentage,
  emptyAttendanceSummary,
  summariseAttendanceMarks,
} from "./attendance.js";

describe("attendance percentage", () => {
  it("counts late as present and excludes not-required sessions", () => {
    const summary = summariseAttendanceMarks([
      { category: "present" },
      { category: "present" },
      { category: "late" },
      { category: "authorised_absence" },
      { category: "unauthorised_absence" },
      { category: "not_required" },
      { category: "not_required" },
    ]);
    expect(summary).toEqual({
      sessionsPossible: 5,
      sessionsPresent: 3,
      authorisedAbsence: 1,
      unauthorisedAbsence: 1,
      late: 1,
      notRequired: 2,
      attendancePercentage: 60,
    });
  });

  it("returns null when every session is not required", () => {
    expect(summariseAttendanceMarks([{ category: "not_required" }])).toEqual({
      ...emptyAttendanceSummary(),
      notRequired: 1,
      attendancePercentage: null,
    });
    expect(attendancePercentage(0, 0)).toBeNull();
  });

  it("rounds to one decimal place", () => {
    const summary = summariseAttendanceMarks([
      { category: "present" },
      { category: "present" },
      { category: "authorised_absence" },
    ]);
    expect(summary.attendancePercentage).toBe(66.7);
  });

  it("ignores unknown categories rather than guessing", () => {
    expect(summariseAttendanceMarks([{ category: "mystery" }])).toEqual(emptyAttendanceSummary());
  });
});
