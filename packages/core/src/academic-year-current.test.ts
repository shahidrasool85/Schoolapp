import { describe, expect, it } from "vitest";
import {
  CANNOT_CLEAR_CURRENT_YEAR,
  rejectClearCurrentAcademicYear,
  rejectSetArchivedAcademicYearCurrent,
  resolveCreatedAcademicYearCurrent,
} from "@schoolapp/domain";

describe("academic year current invariant helpers", () => {
  it("forces the first created year to be current", () => {
    expect(resolveCreatedAcademicYearCurrent(0, false)).toBe(true);
    expect(resolveCreatedAcademicYearCurrent(0, undefined)).toBe(true);
    expect(resolveCreatedAcademicYearCurrent(1, false)).toBe(false);
    expect(resolveCreatedAcademicYearCurrent(1, true)).toBe(true);
  });

  it("rejects unsetting the current year directly", () => {
    expect(rejectClearCurrentAcademicYear(true, false)).toEqual({
      reject: true,
      code: "cannot_clear_current",
      message: CANNOT_CLEAR_CURRENT_YEAR,
    });
    expect(rejectClearCurrentAcademicYear(true, undefined)).toEqual({ reject: false });
    expect(rejectClearCurrentAcademicYear(false, false)).toEqual({ reject: false });
  });

  it("rejects setting an archived year as current", () => {
    expect(rejectSetArchivedAcademicYearCurrent("archived", true).reject).toBe(true);
    expect(rejectSetArchivedAcademicYearCurrent("active", true)).toEqual({ reject: false });
    expect(rejectSetArchivedAcademicYearCurrent("archived", undefined)).toEqual({ reject: false });
  });
});
