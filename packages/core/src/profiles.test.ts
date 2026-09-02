import { describe, expect, it } from "vitest";
import {
  displayPersonName,
  parentSelfCanEditField,
  schoolControlledStaffField,
  staffSelfCanEditField,
} from "@schoolapp/domain";
import { ownEditableFields, ownReadOnlyFields } from "./profiles.js";
import type { Actor } from "@schoolapp/domain";

function actor(kind: Actor["userKind"], permissions: string[] = [], roleKeys: string[] = []): Actor {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    userKind: kind,
    isPlatformAdmin: false,
    organisationId: "22222222-2222-4222-8222-222222222222",
    membershipId: "33333333-3333-4333-8333-333333333333",
    roleKeys,
    permissions: new Set(permissions),
    supportAccessGrantId: null,
  };
}

describe("profile field policy", () => {
  it("keeps staff self-edits away from school-controlled fields", () => {
    expect(staffSelfCanEditField("phone")).toBe(true);
    expect(staffSelfCanEditField("preferredName")).toBe(true);
    expect(staffSelfCanEditField("jobTitle")).toBe(false);
    expect(staffSelfCanEditField("employeeNumber")).toBe(false);
    expect(staffSelfCanEditField("roleKeys")).toBe(false);
    expect(schoolControlledStaffField("jobTitle")).toBe(true);
    expect(parentSelfCanEditField("relationship")).toBe(false);
    expect(parentSelfCanEditField("portalAccess")).toBe(false);
  });

  it("does not let students self-edit official profile fields", () => {
    expect(ownEditableFields(actor("student"), false)).toEqual([]);
  });

  it("lets staff and parents edit contact fields only", () => {
    const staff = ownEditableFields(actor("staff", [], ["school.teacher"]), true);
    expect(staff).toContain("phone");
    expect(staff).toContain("photo");
    expect(ownReadOnlyFields(staff)).toContain("jobTitle");
    expect(ownReadOnlyFields(staff)).toContain("employeeNumber");
    expect(ownReadOnlyFields(staff)).toContain("roleKeys");
    const parent = ownEditableFields(actor("parent", ["students.profiles.read_own_children"]), false);
    expect(parent).toContain("addressLine1");
    expect(ownReadOnlyFields(parent)).toContain("fullName");
  });

  it("reuses the existing name model for display", () => {
    expect(displayPersonName({ title: "Mr", fullName: "Alex Reed", preferredName: "Ali" })).toBe("Mr Ali");
    expect(displayPersonName({ fullName: "Alex Reed" })).toBe("Alex Reed");
  });
});
