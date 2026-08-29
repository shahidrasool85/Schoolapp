import {
  READINESS_ITEMS,
  buildOnboardingPresentation,
  evaluateSetupProgress,
  readinessStatus,
  schoolIsReady,
  type OnboardingPresentation,
  type OnboardingStep,
  type ReadinessItemKey,
  type ReadinessStatus,
  type SetupProgressView,
  type SetupStatus,
} from "@schoolapp/domain";

export type ReadinessCounts = {
  hasName: boolean;
  hasTimezone: boolean;
  academicYears: number;
  terms: number;
  yearGroups: number;
  classes: number;
  subjects: number;
  schoolDayProfiles: number;
  rooms: number;
  staff: number;
  pupils: number;
  parentAccounts: number;
  studentPortalConfigured: boolean;
  timetableEntries: number;
  statutoryProfile: boolean;
  hasBranding: boolean;
};

export type ReadinessViewItem = {
  key: ReadinessItemKey;
  label: string;
  href: string;
  required: boolean;
  complete: boolean;
  status: ReadinessStatus;
};

export function evaluateReadiness(counts: ReadinessCounts): {
  items: ReadinessViewItem[];
  ready: boolean;
} {
  const completeFor: Record<ReadinessItemKey, boolean> = {
    school_profile: counts.hasName && counts.hasTimezone,
    branding: counts.hasBranding,
    academic_year: counts.academicYears > 0,
    term_dates: counts.terms > 0,
    year_groups: counts.yearGroups > 0,
    classes: counts.classes > 0,
    subjects: counts.subjects > 0,
    school_day: counts.schoolDayProfiles > 0,
    rooms: counts.rooms > 0,
    staff: counts.staff > 0,
    pupils: counts.pupils > 0,
    parent_accounts: counts.parentAccounts > 0,
    student_portal: counts.studentPortalConfigured,
    timetable: counts.timetableEntries > 0,
    statutory_profile: counts.statutoryProfile,
  };
  const items = READINESS_ITEMS.map((definition) => {
    const complete = completeFor[definition.key];
    return {
      ...definition,
      complete,
      status: readinessStatus(complete, definition.required),
    };
  });
  return { items, ready: schoolIsReady(items) };
}

export const PASSWORD_RESET_NEUTRAL_MESSAGE =
  "If an account exists, reset instructions have been generated.";

export type SchoolOnboardingView = {
  schoolName: string;
  progress: {
    currentStep: OnboardingStep | string;
    completedSteps: string[];
    completedAt: string | null;
    readyMarkedAt: string | null;
  };
  readiness: {
    ready: boolean;
    items: ReadinessViewItem[];
  };
  setup: SetupProgressView & { schoolName: string };
  presentation: OnboardingPresentation;
};

export function presentSchoolOnboarding(input: {
  schoolName: string;
  currentStep: string;
  completedSteps: string[];
  completedAt: string | null;
  readyMarkedAt: string | null;
  readiness: { ready: boolean; items: ReadinessViewItem[] };
  automaticOnboardingDismissed: boolean;
  canManageSetup: boolean;
}): SchoolOnboardingView {
  const setup = evaluateSetupProgress({
    currentStep: input.currentStep,
    completedSteps: input.completedSteps,
    completedAt: input.completedAt,
    readinessItems: input.readiness.items,
  });
  return {
    schoolName: input.schoolName,
    progress: {
      currentStep: input.currentStep,
      completedSteps: input.completedSteps,
      completedAt: input.completedAt,
      readyMarkedAt: input.readyMarkedAt,
    },
    readiness: input.readiness,
    setup: { ...setup, schoolName: input.schoolName },
    presentation: buildOnboardingPresentation({
      canManageSetup: input.canManageSetup,
      setupStatus: setup.status,
      automaticOnboardingDismissed: input.automaticOnboardingDismissed,
    }),
  };
}

export type { OnboardingPresentation, SetupProgressView, SetupStatus };
