import { describe, expect, it } from "vitest";
import { resolveStudentPortalAccess, yearGroupPortalEffective } from "./student-portal.js";

describe("student portal policy", () => {
  it("uses school default when no overrides exist", () => {
    expect(
      resolveStudentPortalAccess({
        schoolDefault: true,
        yearGroupOverride: null,
        classOverride: null,
        studentOverride: null,
      }),
    ).toEqual({ enabled: true, source: "school" });
  });

  it("lets Reception / Year 1 / Year 2 be enabled without an age prohibition", () => {
    expect(
      resolveStudentPortalAccess({
        schoolDefault: false,
        yearGroupOverride: true,
        classOverride: null,
        studentOverride: null,
      }),
    ).toEqual({ enabled: true, source: "year_group" });
  });

  it("applies pupil then class then year-group overrides", () => {
    expect(
      resolveStudentPortalAccess({
        schoolDefault: true,
        yearGroupOverride: false,
        classOverride: true,
        studentOverride: false,
      }),
    ).toEqual({ enabled: false, source: "student" });
    expect(
      resolveStudentPortalAccess({
        schoolDefault: false,
        yearGroupOverride: false,
        classOverride: true,
        studentOverride: null,
      }),
    ).toEqual({ enabled: true, source: "class" });
  });

  it("treats a year-group null as inherit", () => {
    expect(yearGroupPortalEffective(true, null)).toBe(true);
    expect(yearGroupPortalEffective(true, false)).toBe(false);
  });
});
