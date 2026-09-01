import { describe, expect, it } from "vitest";
import { intendedEntryLabel } from "./admissions-mail";

describe("admissions acknowledgement helpers", () => {
  it("includes intended entry when year and group lists are provided", () => {
    const yearId = "11111111-1111-1111-1111-111111111111";
    const groupId = "22222222-2222-2222-2222-222222222222";
    expect(
      intendedEntryLabel(
        { child: { intendedAcademicYearId: yearId, intendedYearGroupId: groupId } },
        [{ id: yearId, name: "2026/27" }],
        [{ id: groupId, name: "Year 7" }],
      ),
    ).toBe("Year 7 — 2026/27");
    expect(
      intendedEntryLabel(
        { child: { intendedAcademicYearId: yearId, intendedYearGroupId: groupId } },
        [],
        [],
      ),
    ).toBeNull();
  });
});
