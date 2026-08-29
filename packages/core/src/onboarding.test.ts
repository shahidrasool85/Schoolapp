import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  ONBOARDING_WELCOME_PATH,
  READINESS_ITEM_KEYS,
  brandHexError,
  deriveAccountStatus,
  deriveSetupStatus,
  evaluateSetupProgress,
  hexForColorInput,
  isExplicitStaffDeepLink,
  isSystemGeneratedSchoolLanding,
  loginHrefForReturn,
  mapImportedStaffRole,
  mergeCompletedSteps,
  normalizeBrandHex,
  onboardingWelcomeCopy,
  parseSafeLoginNext,
  parseSafeReturnTo,
  parseSetupStep,
  readinessFixHref,
  resolvePostAuthPath,
  resolveStaffPostAuthPath,
  schoolIsReady,
  seedYearGroupsMessage,
  setupProgressLabel,
  setupSidebarBadge,
  setupStepHref,
  setupWelcomePrimaryHref,
  shouldAutoLaunchOnboarding,
  shouldShowDashboardOnboardingCard,
  withSetupReturn,
} from "@schoolapp/domain";
import { evaluateReadiness, presentSchoolOnboarding, type ReadinessCounts } from "./onboarding.js";

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
    expect(result.items.find((item) => item.key === "pupils")?.status).toBe("recommended");
    expect(result.items.find((item) => item.key === "staff")?.status).toBe("recommended");
    expect(result.items.find((item) => item.key === "school_profile")?.status).toBe("needs_attention");
    expect(result.items.find((item) => item.key === "branding")?.status).toBe("recommended");
    expect(result.items.find((item) => item.key === "statutory_profile")?.status).toBe("optional");
  });

  it("marks ready when the school foundation exists even without staff or pupils", () => {
    const result = evaluateReadiness({
      ...empty,
      hasName: true,
      hasTimezone: true,
      academicYears: 1,
      yearGroups: 3,
      classes: 2,
      subjects: 4,
    });
    expect(result.ready).toBe(true);
    expect(result.items.find((item) => item.key === "pupils")?.status).toBe("recommended");
    expect(result.items.find((item) => item.key === "staff")?.status).toBe("recommended");
    expect(result.items.find((item) => item.key === "rooms")?.status).toBe("recommended");
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

describe("setup lifecycle and progress", () => {
  it("treats existing schools with no onboarding row as eligible, not completed", () => {
    const readiness = evaluateReadiness({
      ...empty,
      hasName: true,
      hasTimezone: true,
      academicYears: 1,
      yearGroups: 2,
      classes: 1,
      subjects: 1,
      hasBranding: true,
    });
    const progress = evaluateSetupProgress({
      currentStep: "school_details",
      completedSteps: [],
      completedAt: null,
      readinessItems: readiness.items,
    });
    expect(progress.status).toBe("in_progress");
    expect(progress.completedCount).toBeGreaterThan(0);
    expect(progress.satisfiedSteps).toContain("branding");
    expect(progress.satisfiedSteps).toContain("academic_year");
    expect(progress.satisfiedSteps).toContain("academic_structure");
    expect(progress.satisfiedSteps).not.toContain("completion");
    expect(shouldAutoLaunchOnboarding({
      canManageSetup: true,
      setupStatus: progress.status,
      automaticOnboardingDismissed: false,
    })).toBe(true);
  });

  it("preserves existing completed configuration when completed_steps is empty", () => {
    const readiness = evaluateReadiness({
      ...empty,
      hasName: true,
      hasTimezone: true,
      academicYears: 1,
      yearGroups: 1,
      classes: 1,
      subjects: 1,
      hasBranding: true,
      staff: 3,
      pupils: 20,
    });
    const progress = evaluateSetupProgress({
      completedSteps: [],
      completedAt: null,
      readinessItems: readiness.items,
    });
    expect(progress.satisfiedSteps).toEqual(
      expect.arrayContaining(["school_details", "branding", "academic_year", "academic_structure", "staff", "pupils"]),
    );
    expect(setupProgressLabel(progress)).toBe(`${progress.completedCount} of 10 complete`);
  });

  it("does not treat visiting or skipping a step as factual setup completion", () => {
    const readiness = evaluateReadiness({
      ...empty,
      hasName: true,
      hasTimezone: true,
      academicYears: 1,
    });
    const visited = evaluateSetupProgress({
      currentStep: "school_day",
      completedSteps: ["school_details", "branding", "academic_year", "academic_structure"],
      completedAt: null,
      readinessItems: readiness.items,
    });
    expect(visited.satisfiedSteps).toEqual(["school_details", "academic_year"]);
    expect(visited.satisfiedSteps).not.toContain("academic_structure");
    expect(visited.satisfiedSteps).not.toContain("branding");
    expect(visited.completedCount).toBe(2);
    expect(setupProgressLabel(visited)).toBe("2 of 10 complete");
    expect(visited.status).toBe("in_progress");
  });

  it("does not treat visiting screens as completion", () => {
    const readiness = evaluateReadiness({
      ...empty,
      hasName: true,
      hasTimezone: true,
      academicYears: 1,
      yearGroups: 1,
      classes: 1,
      subjects: 1,
      staff: 1,
      pupils: 1,
    });
    expect(readiness.ready).toBe(true);
    expect(
      deriveSetupStatus({
        currentStep: "completion",
        completedSteps: [...ONBOARDING_STEPS],
        completedAt: null,
        readinessItems: readiness.items,
      }),
    ).toBe("in_progress");
  });

  it("marks completed only after an explicit finish timestamp", () => {
    const readiness = evaluateReadiness({
      ...empty,
      hasName: true,
      hasTimezone: true,
      academicYears: 1,
      yearGroups: 1,
      classes: 1,
      subjects: 1,
      staff: 1,
      pupils: 1,
    });
    const progress = evaluateSetupProgress({
      currentStep: "completion",
      completedSteps: ["school_details"],
      completedAt: "2026-08-29T10:00:00.000Z",
      readinessItems: readiness.items,
    });
    expect(progress.status).toBe("completed");
    expect(progress.satisfiedSteps).toContain("completion");
    expect(shouldAutoLaunchOnboarding({
      canManageSetup: true,
      setupStatus: progress.status,
      automaticOnboardingDismissed: false,
    })).toBe(true);
    expect(shouldShowDashboardOnboardingCard({
      canManageSetup: true,
      setupStatus: progress.status,
      automaticOnboardingDismissed: false,
    })).toBe(false);
  });

  it("keeps dismissal separate from setup completion", () => {
    expect(
      shouldAutoLaunchOnboarding({
        canManageSetup: true,
        setupStatus: "in_progress",
        automaticOnboardingDismissed: true,
      }),
    ).toBe(false);
    expect(
      shouldShowDashboardOnboardingCard({
        canManageSetup: true,
        setupStatus: "in_progress",
        automaticOnboardingDismissed: true,
      }),
    ).toBe(false);
    expect(deriveSetupStatus({
      completedSteps: ["school_details"],
      completedAt: null,
      readinessItems: evaluateReadiness(empty).items,
    })).toBe("in_progress");
  });

  it("does not auto-launch for teachers, parents, students, or platform admins", () => {
    const inProgress = {
      setupStatus: "in_progress" as const,
      automaticOnboardingDismissed: false,
    };
    expect(shouldAutoLaunchOnboarding({ ...inProgress, canManageSetup: false })).toBe(false);
    expect(resolvePostAuthPath({ portal: "parent", canManageSetup: false, setupStatus: "not_started" })).toBe("/parent");
    expect(resolvePostAuthPath({ portal: "student", canManageSetup: false, setupStatus: "not_started" })).toBe("/student");
    expect(resolvePostAuthPath({ portal: "platform", isPlatformAdmin: true, schoolHost: false })).toBe("/platform");
  });

  it("resumes at the first incomplete relevant step, not always step 1", () => {
    const readiness = evaluateReadiness({
      ...empty,
      hasName: true,
      hasTimezone: true,
      academicYears: 1,
      yearGroups: 1,
      classes: 1,
      subjects: 1,
      hasBranding: true,
    });
    const progress = evaluateSetupProgress({
      currentStep: "school_details",
      completedSteps: [],
      completedAt: null,
      readinessItems: readiness.items,
    });
    expect(progress.resumeStep).toBe("school_day");
  });

  it("highlights incomplete setup in the sidebar and quiets it after dismissal or completion", () => {
    expect(setupSidebarBadge({ status: "not_started", percent: 0, dismissed: false })).toEqual({
      badge: "Setup required",
      badgeTone: "accent",
      emphasis: true,
    });
    expect(setupSidebarBadge({ status: "in_progress", percent: 40, dismissed: false })).toEqual({
      badge: "40%",
      badgeTone: "accent",
      emphasis: true,
    });
    expect(setupSidebarBadge({ status: "in_progress", percent: 40, dismissed: true })).toEqual({
      badge: "40%",
      badgeTone: "subtle",
      emphasis: false,
    });
    expect(setupSidebarBadge({ status: "completed", percent: 100, dismissed: false })).toEqual({
      badge: null,
      badgeTone: "subtle",
      emphasis: false,
    });
  });

  it("uses Welcome back copy once setup has begun", () => {
    const first = onboardingWelcomeCopy({
      schoolName: "Northfield Academy",
      status: "not_started",
      completedCount: 0,
      totalSteps: 10,
    });
    expect(first.heading).toBe("Welcome to LuvLearn");
    expect(first.title).toBe("Let's set up Northfield Academy");
    expect(first.primaryLabel).toBe("Start school setup");
    const defaultsOnly = onboardingWelcomeCopy({
      schoolName: "Northfield Academy",
      status: "in_progress",
      completedCount: 2,
      totalSteps: 10,
      currentStep: "school_details",
      completedSteps: [],
    });
    expect(defaultsOnly.heading).toBe("Welcome to LuvLearn");
    const resume = onboardingWelcomeCopy({
      schoolName: "Northfield Academy",
      status: "in_progress",
      completedCount: 4,
      totalSteps: 10,
    });
    expect(resume.heading).toBe("Welcome back");
    expect(resume.title).toBe("Continue setting up Northfield Academy");
    expect(resume.lede).toContain("40%");
    expect(resume.primaryLabel).toBe("Continue School Setup");
    expect(resume.showProgress).toBe(true);
    expect(resume.completeBadge).toBeNull();
  });

  it("reports a completed school as already set up without incomplete copy", () => {
    const copy = onboardingWelcomeCopy({
      schoolName: "Kingswood School",
      status: "completed",
      completedCount: 10,
      totalSteps: 10,
      currentStep: "school_details",
      completedSteps: [],
    });
    expect(copy.heading).toBe("Welcome to LuvLearn");
    expect(copy.title).toBe("Kingswood School is already set up.");
    expect(copy.lede).toContain("review your school setup");
    expect(copy.primaryLabel).toBe("Review School Setup");
    expect(copy.showProgress).toBe(false);
    expect(copy.completeBadge).toBe("School setup complete ✓");
    expect(copy.dismissLabel).toBe("Don't show this again");
    expect(copy.title.toLowerCase()).not.toContain("finish");
    expect(copy.lede.toLowerCase()).not.toContain("continue setting up");
    expect(copy.lede.toLowerCase()).not.toMatch(/incomplete|% complete/);
    expect(setupWelcomePrimaryHref({ status: "completed", resumeStep: "completion" })).toBe("/school/setup");
    expect(setupWelcomePrimaryHref({ status: "in_progress", resumeStep: "rooms" })).toBe(
      "/school/setup?step=rooms",
    );
  });
});

describe("post-login onboarding routing", () => {
  const eligible = {
    canManageSetup: true,
    setupStatus: "in_progress" as const,
    automaticOnboardingDismissed: false,
  };

  it("sends a School Admin who opened /login directly to welcome", () => {
    expect(resolveStaffPostAuthPath({ ...eligible, setupStatus: "not_started" })).toBe(ONBOARDING_WELCOME_PATH);
    expect(resolveStaffPostAuthPath({ ...eligible, requestedNext: null })).toBe(ONBOARDING_WELCOME_PATH);
    expect(resolveStaffPostAuthPath({ ...eligible, requestedNext: "" })).toBe(ONBOARDING_WELCOME_PATH);
    expect(loginHrefForReturn("/school")).toBe("/login");
    expect(loginHrefForReturn("/school/")).toBe("/login");
    expect(loginHrefForReturn("/school/dashboard")).toBe("/login");
  });

  it("does not treat a system-generated school landing as an explicit deep link", () => {
    expect(isSystemGeneratedSchoolLanding(null)).toBe(true);
    expect(isSystemGeneratedSchoolLanding("/school")).toBe(true);
    expect(isSystemGeneratedSchoolLanding("/school/")).toBe(true);
    expect(isSystemGeneratedSchoolLanding("/school/dashboard")).toBe(true);
    expect(isExplicitStaffDeepLink("/school")).toBe(false);
    expect(isExplicitStaffDeepLink("/school/dashboard")).toBe(false);
    expect(isExplicitStaffDeepLink("/school/pupils/123")).toBe(true);
    expect(
      resolveStaffPostAuthPath({
        ...eligible,
        requestedNext: "/school",
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);
    expect(
      resolveStaffPostAuthPath({
        ...eligible,
        requestedNext: "/school/dashboard",
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);
  });

  it("preserves an explicit /school/... deep link after login", () => {
    expect(
      resolveStaffPostAuthPath({
        ...eligible,
        requestedNext: "/school/pupils/123",
      }),
    ).toBe("/school/pupils/123");
    expect(loginHrefForReturn("/school/pupils/123")).toBe("/login?next=%2Fschool%2Fpupils%2F123");
  });

  it("sends a new or existing eligible School Admin to welcome after a default login", () => {
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: "not_started",
        automaticOnboardingDismissed: false,
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: "in_progress",
        automaticOnboardingDismissed: false,
        requestedNext: "/school",
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);
  });

  it("does not hijack deep links, invites, or password-reset continuation", () => {
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: "not_started",
        automaticOnboardingDismissed: false,
        requestedNext: "/school/students",
      }),
    ).toBe("/school/students");
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: "in_progress",
        automaticOnboardingDismissed: false,
        requestedNext: "/school/setup?step=branding",
      }),
    ).toBe("/school/setup?step=branding");
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: "not_started",
        automaticOnboardingDismissed: false,
        requestedNext: "/invite?token=abc",
      }),
    ).toBe("/invite?token=abc");
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: "not_started",
        automaticOnboardingDismissed: false,
        requestedNext: "/reset-password?token=abc",
      }),
    ).toBe("/reset-password?token=abc");
  });

  it("does not create a welcome redirect loop", () => {
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: "in_progress",
        automaticOnboardingDismissed: false,
        requestedNext: ONBOARDING_WELCOME_PATH,
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);
    expect(parseSafeLoginNext("/login?next=/school/setup/welcome")).toBeNull();
  });

  it("rejects unsafe next values and other portals on staff login", () => {
    expect(parseSafeLoginNext("https://evil.example/school")).toBeNull();
    expect(parseSafeLoginNext("//evil.example")).toBeNull();
    expect(parseSafeLoginNext("/parent", "staff")).toBeNull();
    expect(parseSafeLoginNext("/student", "staff")).toBeNull();
    expect(parseSafeLoginNext("/platform", "staff")).toBeNull();
    expect(parseSafeLoginNext("/school/../platform")).toBeNull();
    expect(loginHrefForReturn("/school/finance")).toBe("/login?next=%2Fschool%2Ffinance");
  });

  it("sends a completed-school admin without a dismissal to welcome", () => {
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: "completed",
        automaticOnboardingDismissed: false,
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: "completed",
        automaticOnboardingDismissed: false,
        requestedNext: "/school",
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: "completed",
        automaticOnboardingDismissed: false,
        requestedNext: "/school/pupils/123",
      }),
    ).toBe("/school/pupils/123");
  });

  it("sends dismissed admins to the dashboard even when setup is completed", () => {
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: "in_progress",
        automaticOnboardingDismissed: true,
      }),
    ).toBe("/school");
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: "completed",
        automaticOnboardingDismissed: true,
      }),
    ).toBe("/school");
  });
});

describe("onboarding presentation assembly", () => {
  it("keeps a Kingswood-style existing admin eligible until they dismiss", () => {
    const readiness = evaluateReadiness({
      ...empty,
      hasName: true,
      hasTimezone: true,
      academicYears: 1,
      yearGroups: 3,
      classes: 2,
      subjects: 4,
      hasBranding: true,
      staff: 8,
      pupils: 40,
    });
    const view = presentSchoolOnboarding({
      schoolName: "Existing Primary",
      currentStep: "school_details",
      completedSteps: [],
      completedAt: null,
      readyMarkedAt: null,
      readiness,
      automaticOnboardingDismissed: false,
      canManageSetup: true,
    });
    expect(view.setup.schoolName).toBe("Existing Primary");
    expect(view.setup.status).toBe("in_progress");
    expect(view.presentation.shouldAutoLaunch).toBe(true);
    expect(view.presentation.showDashboardCard).toBe(true);
    const dismissed = presentSchoolOnboarding({
      ...view,
      schoolName: "Existing Primary",
      currentStep: view.progress.currentStep,
      completedSteps: view.progress.completedSteps,
      completedAt: null,
      readyMarkedAt: null,
      readiness,
      automaticOnboardingDismissed: true,
      canManageSetup: true,
    });
    expect(dismissed.setup.status).toBe("in_progress");
    expect(dismissed.presentation.shouldAutoLaunch).toBe(false);
    expect(dismissed.presentation.showDashboardCard).toBe(false);
    expect(dismissed.progress.completedSteps).toEqual(view.progress.completedSteps);
  });

  it("shows a legacy completed school the welcome once without a dashboard card", () => {
    const readiness = evaluateReadiness({
      ...empty,
      hasName: true,
      hasTimezone: true,
      academicYears: 1,
      yearGroups: 3,
      classes: 2,
      subjects: 4,
      hasBranding: true,
      staff: 8,
      pupils: 40,
    });
    const completedAt = "2026-01-15T09:30:00.000Z";
    const view = presentSchoolOnboarding({
      schoolName: "Kingswood School",
      currentStep: "completion",
      completedSteps: ["school_details"],
      completedAt,
      readyMarkedAt: completedAt,
      readiness,
      automaticOnboardingDismissed: false,
      canManageSetup: true,
    });
    expect(view.setup.status).toBe("completed");
    expect(view.progress.completedAt).toBe(completedAt);
    expect(view.presentation.shouldAutoLaunch).toBe(true);
    expect(view.presentation.showDashboardCard).toBe(false);
    const copy = onboardingWelcomeCopy({
      schoolName: view.setup.schoolName,
      status: view.setup.status,
      completedCount: view.setup.completedCount,
      totalSteps: view.setup.totalSteps,
    });
    expect(copy.title).toBe("Kingswood School is already set up.");
    expect(copy.showProgress).toBe(false);
    const dismissed = presentSchoolOnboarding({
      schoolName: "Kingswood School",
      currentStep: view.progress.currentStep,
      completedSteps: view.progress.completedSteps,
      completedAt,
      readyMarkedAt: completedAt,
      readiness,
      automaticOnboardingDismissed: true,
      canManageSetup: true,
    });
    expect(dismissed.setup.status).toBe("completed");
    expect(dismissed.progress.completedAt).toBe(completedAt);
    expect(dismissed.presentation.shouldAutoLaunch).toBe(false);
    expect(dismissed.presentation.showDashboardCard).toBe(false);
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
