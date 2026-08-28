import { describe, expect, it } from "vitest";
import { deriveAccountStatus, mapImportedStaffRole, schoolIsReady } from "@schoolapp/domain";
import { evaluateReadiness, type ReadinessCounts } from "./onboarding.js";

const empty: ReadinessCounts = {
  hasName: false,
  hasTimezone: false,
  academicYears: 0,
  terms: 0,
  yearGroups: 0,
  classes: 0,
  subjects: 0,
  schoolDayProfiles: 0,
  rooms: 0,
  staff: 0,
  pupils: 0,
  parentAccounts: 0,
  studentPortalConfigured: false,
  timetableEntries: 0,
  statutoryProfile: false,
  hasBranding: false,
};

describe("readiness", () => {
  it("does not mark a school ready when required items are missing", () => {
    const result = evaluateReadiness(empty);
    expect(result.ready).toBe(false);
    expect(result.items.find((item) => item.key === "pupils")?.status).toBe("needs_attention");
    expect(result.items.find((item) => item.key === "branding")?.status).toBe("optional");
  });

  it("marks ready when required configuration exists even if optional items are empty", () => {
    const result = evaluateReadiness({
      ...empty,
      hasName: true,
      hasTimezone: true,
      academicYears: 1,
      yearGroups: 3,
      classes: 2,
      subjects: 4,
      staff: 1,
      pupils: 12,
    });
    expect(result.ready).toBe(true);
    expect(result.items.find((item) => item.key === "rooms")?.status).toBe("optional");
    expect(schoolIsReady(result.items)).toBe(true);
  });
});

describe("account status and import roles", () => {
  it("derives invitation and suspension states", () => {
    expect(deriveAccountStatus({ membershipStatus: "invited" })).toBe("invite_pending");
    expect(deriveAccountStatus({ membershipStatus: "active" })).toBe("active");
    expect(deriveAccountStatus({ membershipStatus: "suspended" })).toBe("suspended");
    expect(deriveAccountStatus({})).toBe("no_account");
  });

  it("rejects admin spoofing through import aliases", () => {
    expect(mapImportedStaffRole("teacher")).toBe("school.teacher");
    expect(mapImportedStaffRole("school.admin")).toBeNull();
    expect(mapImportedStaffRole("admin")).toBeNull();
  });
});
