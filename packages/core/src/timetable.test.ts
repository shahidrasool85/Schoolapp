import { describe, expect, it } from "vitest";
import {
  addDays,
  dateInRange,
  dateWindowsOverlap,
  eachDateInclusive,
  firstWeekdayOnOrAfter,
  inferAttendanceSessionKey,
  isoWeekdayFromDate,
  isoWeekRange,
  occurrenceStatusFromException,
  recurringLessonSavedMessage,
  startOfIsoWeek,
  timesOverlap,
  weekdayLabel,
} from "./timetable.js";
import { dateIsSchoolDate } from "./timetable-access.js";

describe("timetable date helpers", () => {
  it("uses ISO weekdays (Monday = 1)", () => {
    expect(isoWeekdayFromDate("2026-09-07")).toBe(1);
    expect(isoWeekdayFromDate("2026-09-11")).toBe(5);
    expect(isoWeekdayFromDate("2026-09-13")).toBe(7);
    expect(startOfIsoWeek("2026-09-09")).toBe("2026-09-07");
    expect(startOfIsoWeek("2026-09-03")).toBe("2026-08-31");
    expect(weekdayLabel(1)).toBe("Monday");
  });

  it("expands inclusive date ranges", () => {
    expect(eachDateInclusive("2026-09-07", "2026-09-09")).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
    ]);
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("detects overlapping times and effective windows", () => {
    expect(timesOverlap("09:00", "10:00", "09:45", "10:45")).toBe(true);
    expect(timesOverlap("09:00", "10:00", "10:00", "11:00")).toBe(false);
    expect(dateWindowsOverlap("2026-09-01", "2026-01-31", "2026-02-01", null)).toBe(false);
    expect(dateWindowsOverlap("2026-09-01", null, "2026-10-01", "2026-10-31")).toBe(true);
    expect(dateInRange("2026-09-07", "2026-09-01", "2026-12-18")).toBe(true);
    expect(dateInRange("2026-12-19", "2026-09-01", "2026-12-18")).toBe(false);
  });

  it("normalizes mid-week dates to Monday–Sunday and finds the first matching weekday", () => {
    expect(isoWeekRange("2026-09-03")).toEqual({ from: "2026-08-31", to: "2026-09-06" });
    expect(firstWeekdayOnOrAfter(1, "2026-09-03")).toBe("2026-09-07");
    expect(firstWeekdayOnOrAfter(4, "2026-09-03")).toBe("2026-09-03");
    expect(
      recurringLessonSavedMessage({
        date: "2026-09-07",
        startsAt: "09:00:00",
        endsAt: "11:00:00",
      }),
    ).toBe("Recurring lesson saved. First lesson: Monday 7 September, 09:00–11:00.");
  });

  it("keeps lessons inside terms and outside closures", () => {
    const terms = [{ id: "autumn", startsOn: "2026-09-01", endsOn: "2026-12-18" }];
    expect(dateIsSchoolDate("2026-09-07", terms, null, new Set())).toBe(true);
    expect(dateIsSchoolDate("2026-12-20", terms, null, new Set())).toBe(false);
    expect(dateIsSchoolDate("2026-09-07", terms, null, new Set(["2026-09-07"]))).toBe(false);
    expect(dateIsSchoolDate("2026-09-07", terms, "spring", new Set())).toBe(false);
  });

  it("falls back to the academic year when no terms exist", () => {
    const year = { startsOn: "2026-09-01", endsOn: "2027-07-31" };
    expect(dateIsSchoolDate("2026-09-07", [], null, new Set(), year)).toBe(true);
    expect(dateIsSchoolDate("2026-08-20", [], null, new Set(), year)).toBe(false);
  });

  it("skips between-term holidays once terms exist (intentional, not a zero-occurrence bug)", () => {
    const terms = [
      { id: "autumn", startsOn: "2026-09-03", endsOn: "2026-12-18" },
      { id: "spring", startsOn: "2027-01-05", endsOn: "2027-03-26" },
    ];
    const year = { startsOn: "2026-09-03", endsOn: "2027-07-22" };
    expect(dateIsSchoolDate("2026-12-22", terms, null, new Set(), year)).toBe(false);
    expect(dateIsSchoolDate("2027-01-06", terms, null, new Set(), year)).toBe(true);
    expect(dateIsSchoolDate("2026-12-22", [], null, new Set(), year)).toBe(true);
  });

  it("maps exceptions and attendance session inference", () => {
    expect(occurrenceStatusFromException("cancelled", false)).toBe("cancelled");
    expect(occurrenceStatusFromException(null, true)).toBe("covered");
    expect(occurrenceStatusFromException(null, false)).toBe("scheduled");
    expect(inferAttendanceSessionKey("08:40", "registration")).toBe("am");
    expect(inferAttendanceSessionKey("13:10", "registration")).toBe("pm");
    expect(inferAttendanceSessionKey("14:00", "teaching")).toBe("pm");
  });
});
