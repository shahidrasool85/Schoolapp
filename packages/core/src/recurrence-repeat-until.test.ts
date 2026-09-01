import { describe, expect, it } from "vitest";
import {
  CUSTOM_DATE_BEFORE_START,
  CUSTOM_DATE_OUTSIDE_YEAR,
  NO_TERM_FOR_START,
  defaultRepeatUntilKind,
  endOfAcademicYearLabel,
  endOfTermLabel,
  findTermContainingDate,
  formatUkCalendarDate,
  recurrenceEndsLabel,
  validateCustomRepeatUntilDate,
} from "@schoolapp/domain";
import { listRecurrenceTeachingDates } from "./timetable-access.js";

const autumn = { id: "autumn", name: "Autumn Term", startsOn: "2026-09-03", endsOn: "2026-12-18" };
const spring = { id: "spring", name: "Spring Term", startsOn: "2027-01-04", endsOn: "2027-03-31" };

describe("repeat until helpers", () => {
  it("resolves the term that contains the start date, including term boundaries", () => {
    expect(findTermContainingDate("2026-09-03", [autumn, spring])?.id).toBe("autumn");
    expect(findTermContainingDate("2026-12-18", [autumn, spring])?.id).toBe("autumn");
    expect(findTermContainingDate("2027-01-04", [autumn, spring])?.id).toBe("spring");
    expect(findTermContainingDate("2026-12-19", [autumn, spring])).toBeNull();
  });

  it("does not invent end-of-term intent for legacy dates", () => {
    expect(recurrenceEndsLabel("2026-12-18")).toBe("Ends 18 December 2026");
    expect(recurrenceEndsLabel(null)).toBe("No end date");
    expect(endOfTermLabel("Autumn Term", "2026-12-18")).toBe("Autumn Term ends — 18 December 2026");
    expect(endOfAcademicYearLabel("2026/27", "2027-07-23")).toBe(
      "Academic Year 2026/27 ends — 23 July 2027",
    );
    expect(formatUkCalendarDate("2026-09-07")).toBe("7 September 2026");
  });

  it("validates custom dates against the start date and academic year", () => {
    expect(
      validateCustomRepeatUntilDate({
        date: "2026-09-02",
        effectiveFrom: "2026-09-03",
        yearStartsOn: "2026-09-03",
        yearEndsOn: "2027-07-23",
      }),
    ).toEqual({ ok: false, error: CUSTOM_DATE_BEFORE_START });
    expect(
      validateCustomRepeatUntilDate({
        date: "2027-07-24",
        effectiveFrom: "2026-09-03",
        yearStartsOn: "2026-09-03",
        yearEndsOn: "2027-07-23",
      }),
    ).toEqual({ ok: false, error: CUSTOM_DATE_OUTSIDE_YEAR });
    expect(
      validateCustomRepeatUntilDate({
        date: "2026-12-18",
        effectiveFrom: "2026-09-03",
        yearStartsOn: "2026-09-03",
        yearEndsOn: "2027-07-23",
      }).ok,
    ).toBe(true);
  });

  it("defaults to end of term only when terms exist", () => {
    expect(defaultRepeatUntilKind(true)).toBe("end_of_term");
    expect(defaultRepeatUntilKind(false)).toBe("end_of_academic_year");
    expect(NO_TERM_FOR_START).toMatch(/No academic term contains this start date/);
  });

  it("counts six valid teaching Mondays while skipping closures and holidays", () => {
    const dates = listRecurrenceTeachingDates({
      weekday: 1,
      effectiveFrom: "2026-12-07",
      effectiveUntil: "2027-07-23",
      termId: null,
      terms: [autumn, spring],
      closures: new Set(["2026-12-14"]),
      academicYear: { startsOn: "2026-09-03", endsOn: "2027-07-23" },
      limit: 6,
    });
    expect(dates).toEqual([
      "2026-12-07",
      "2027-01-04",
      "2027-01-11",
      "2027-01-18",
      "2027-01-25",
      "2027-02-01",
    ]);
    expect(dates).not.toContain("2026-12-14");
    expect(dates).not.toContain("2026-12-21");
  });
});
