import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  READINESS_ITEM_KEYS,
  brandHexError,
  deriveAccountStatus,
  hexForColorInput,
  mapImportedStaffRole,
  mergeCompletedSteps,
  normalizeBrandHex,
  parseSafeReturnTo,
  parseSetupStep,
  readinessFixHref,
  schoolIsReady,
  seedYearGroupsMessage,
  setupStepHref,
  withSetupReturn,
} from "@schoolapp/domain";
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

describe("setup step navigation", () => {
  it("parses canonical keys, hyphenated aliases, and friendly labels", () => {
    expect(parseSetupStep("branding")).toBe("branding");
    expect(parseSetupStep("academic_structure")).toBe("academic_structure");
    expect(parseSetupStep("structure")).toBe("academic_structure");
    expect(parseSetupStep("school-day")).toBe("school_day");
    expect(parseSetupStep("school-details")).toBe("school_details");
    expect(parseSetupStep("year")).toBe("academic_year");
    expect(parseSetupStep("ready")).toBe("completion");
    expect(parseSetupStep("not-a-step")).toBeNull();
    expect(parseSetupStep(null)).toBeNull();
  });

  it("builds stable setup step hrefs for every wizard step", () => {
    for (const step of ONBOARDING_STEPS) {
      expect(setupStepHref(step)).toBe(`/school/setup?step=${step}`);
    }
    expect(setupStepHref("branding")).toBe("/school/setup?step=branding");
    expect(setupStepHref("academic_structure")).toBe("/school/setup?step=academic_structure");
  });

  it("treats the requested step as current without dropping completed steps", () => {
    expect(mergeCompletedSteps(["school_details", "branding"], "rooms")).toEqual([
      "school_details",
      "branding",
      "rooms",
    ]);
    expect(mergeCompletedSteps(["school_details", "branding", "academic_year"], [])).toEqual([
      "school_details",
      "branding",
      "academic_year",
    ]);
  });
});

describe("Ready Fix destinations", () => {
  const expected: Record<string, string> = {
    school_profile: "/school/setup?step=school_details",
    branding: "/school/setup?step=branding",
    academic_year: "/school/setup?step=academic_year",
    term_dates: "/school/setup?step=academic_year",
    year_groups: "/school/setup?step=academic_structure",
    classes: "/school/setup?step=academic_structure",
    subjects: "/school/setup?step=academic_structure",
    school_day: "/school/setup?step=school_day",
    rooms: "/school/setup?step=rooms",
    staff: "/school/setup?step=staff",
    pupils: "/school/setup?step=pupils",
    parent_accounts: "/school/setup?step=portals",
    student_portal: "/school/setup?step=portals",
    timetable: "/school/timetable",
    statutory_profile: "/school/settings/statutory",
  };

  it("maps School profile and Branding Fix links to the matching wizard steps", () => {
    expect(readinessFixHref("school_profile")).toBe("/school/setup?step=school_details");
    expect(readinessFixHref("branding")).toBe("/school/setup?step=branding");
  });

  it("maps every readiness item to a live setup step or canonical page", () => {
    expect(READINESS_ITEM_KEYS).toEqual(Object.keys(expected));
    for (const key of READINESS_ITEM_KEYS) {
      expect(readinessFixHref(key)).toBe(expected[key]);
    }
  });
});

describe("setup return context", () => {
  it("attaches returnTo so school-day can send the admin back to the wizard", () => {
    const href = withSetupReturn("/school/timetable/school-day", "school_day");
    expect(href).toContain("/school/timetable/school-day");
    const returnTo = new URL(href, "https://school.invalid").searchParams.get("returnTo");
    expect(returnTo).toBe("/school/setup?step=school_day");
    expect(parseSafeReturnTo(returnTo)).toBe("/school/setup?step=school_day");
  });

  it("gives Bulk Import a safe return path back to the originating setup step", () => {
    const staff = withSetupReturn("/school/imports", "staff");
    const pupils = withSetupReturn("/school/imports", "pupils");
    expect(parseSafeReturnTo(new URL(staff, "https://school.invalid").searchParams.get("returnTo"))).toBe(
      "/school/setup?step=staff",
    );
    expect(parseSafeReturnTo(new URL(pupils, "https://school.invalid").searchParams.get("returnTo"))).toBe(
      "/school/setup?step=pupils",
    );
  });

  it("rejects unsafe returnTo values", () => {
    expect(parseSafeReturnTo("https://evil.example/school/setup")).toBeNull();
    expect(parseSafeReturnTo("//evil.example")).toBeNull();
    expect(parseSafeReturnTo("/login")).toBeNull();
    expect(parseSafeReturnTo("/school/../platform")).toBeNull();
    expect(parseSafeReturnTo("/school/setup?step=branding")).toBe("/school/setup?step=branding");
  });
});

describe("year group seed feedback", () => {
  it("reports created vs already present without implying duplicates", () => {
    expect(seedYearGroupsMessage(9)).toBe("Standard year groups created");
    expect(seedYearGroupsMessage(0)).toBe("Standard year groups are already set up");
  });
});

describe("branding colours", () => {
  it("lets a colour picker value become a saved hex", () => {
    expect(normalizeBrandHex("#122c4a")).toBe("#122C4A");
    expect(hexForColorInput("#2B78C9", "#122C4A")).toBe("#2B78C9");
    expect(brandHexError("#122C4A")).toBeNull();
  });

  it("rejects invalid hex values clearly", () => {
    expect(normalizeBrandHex("122C4A")).toBeNull();
    expect(normalizeBrandHex("#GG0000")).toBeNull();
    expect(brandHexError("navy")).toBe("Enter a valid colour like #122C4A.");
    expect(brandHexError("")).toBe("Enter a colour, for example #122C4A.");
  });

  it("expands 3-digit hex for the native colour input", () => {
    expect(normalizeBrandHex("#0af")).toBe("#00AAFF");
    expect(hexForColorInput("#0af", "#122C4A")).toBe("#00AAFF");
  });
});
