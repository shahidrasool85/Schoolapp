import { describe, expect, it } from "vitest";
import { confirmationMatchesOrganisation, intendedRolesIncludeStaff, OPERATIONAL_RESET_MODE, OPERATIONAL_RESET_ADMISSIONS_FORM_TABLES, OPERATIONAL_RESET_TABLES } from "@schoolapp/domain";

describe("operational reset confirmation", () => {
  it("accepts the school slug case-insensitively", () => {
    expect(
      confirmationMatchesOrganisation({ typed: "Kingswood", slug: "kingswood", name: "Kingswood School" }),
    ).toBe(true);
    expect(
      confirmationMatchesOrganisation({ typed: "  kingswood  ", slug: "kingswood", name: "Kingswood School" }),
    ).toBe(true);
  });

  it("accepts the school name case-insensitively", () => {
    expect(
      confirmationMatchesOrganisation({
        typed: "kingswood school",
        slug: "kingswood",
        name: "Kingswood School",
      }),
    ).toBe(true);
  });

  it("rejects the wrong school", () => {
    expect(
      confirmationMatchesOrganisation({ typed: "riverside", slug: "kingswood", name: "Kingswood School" }),
    ).toBe(false);
    expect(confirmationMatchesOrganisation({ typed: " ", slug: "kingswood", name: "Kingswood School" })).toBe(
      false,
    );
  });

  it("versions the reset plan", () => {
    expect(OPERATIONAL_RESET_MODE).toBe("operational_reset_v1");
  });

  it("treats staff role keys as staff invitations without using names", () => {
    expect(intendedRolesIncludeStaff(["school.teacher"])).toBe(true);
    expect(intendedRolesIncludeStaff(["school.parent"])).toBe(false);
    expect(intendedRolesIncludeStaff([])).toBe(false);
  });

  it("wipes admissions form documents with submissions, not with preserved form definitions", () => {
    expect(OPERATIONAL_RESET_TABLES).toContain("admissions_form_documents");
    expect(OPERATIONAL_RESET_TABLES).toContain("admissions_form_submissions");
    expect(OPERATIONAL_RESET_ADMISSIONS_FORM_TABLES).toEqual([
      "admissions_forms",
      "admissions_form_sections",
      "admissions_form_fields",
    ]);
  });
});
