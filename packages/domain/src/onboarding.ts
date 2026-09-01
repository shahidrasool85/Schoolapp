export const ONBOARDING_STEPS = [
  "school_details",
  "branding",
  "academic_year",
  "academic_structure",
  "school_day",
  "rooms",
  "staff",
  "pupils",
  "portals",
  "completion",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const READINESS_ITEM_KEYS = [
  "school_profile",
  "branding",
  "academic_year",
  "term_dates",
  "year_groups",
  "classes",
  "subjects",
  "school_day",
  "rooms",
  "staff",
  "pupils",
  "parent_accounts",
  "student_portal",
  "timetable",
  "statutory_profile",
] as const;

export type ReadinessItemKey = (typeof READINESS_ITEM_KEYS)[number];
export type ReadinessTier = "required" | "recommended" | "optional";
export type ReadinessStatus = "complete" | "needs_attention" | "recommended" | "optional";

export type ReadinessItemDefinition = {
  key: ReadinessItemKey;
  label: string;
  href: string;
  required: boolean;
  tier: ReadinessTier;
};

export const SETUP_PATH = "/school/setup";
export const ONBOARDING_WELCOME_PATH = "/school/setup/welcome";
export const SCHOOL_DASHBOARD_PATH = "/school";
export const SETUP_STEP_COUNT = ONBOARDING_STEPS.length;

export const SETUP_STATUSES = ["not_started", "in_progress", "completed"] as const;
export type SetupStatus = (typeof SETUP_STATUSES)[number];

/**
 * Wizard steps mapped to live readiness items.
 * `completed_steps` is navigation/resume only and must never count a step as factually configured.
 */
export const SETUP_STEP_READINESS: Record<OnboardingStep, readonly ReadinessItemKey[]> = {
  school_details: ["school_profile"],
  branding: ["branding"],
  academic_year: ["academic_year"],
  academic_structure: ["year_groups", "classes", "subjects"],
  school_day: ["school_day"],
  rooms: ["rooms"],
  staff: ["staff"],
  pupils: ["pupils"],
  portals: ["parent_accounts", "student_portal"],
  completion: [],
};

export type SetupProgressInput = {
  currentStep?: string | null;
  completedSteps?: readonly string[];
  completedAt?: string | null;
  readinessItems: ReadonlyArray<{ key: string; required: boolean; complete: boolean }>;
};

export type SetupProgressView = {
  status: SetupStatus;
  completedCount: number;
  totalSteps: number;
  percent: number;
  resumeStep: OnboardingStep;
  satisfiedSteps: OnboardingStep[];
};

export type OnboardingPresentation = {
  automaticOnboardingDismissed: boolean;
  shouldAutoLaunch: boolean;
  showDashboardCard: boolean;
};

export type LoginPortal = "staff" | "parent" | "student" | "platform";

export const SETUP_STEP_ALIASES: Record<string, OnboardingStep> = {
  school: "school_details",
  "school-details": "school_details",
  school_details: "school_details",
  branding: "branding",
  year: "academic_year",
  "academic-year": "academic_year",
  academic_year: "academic_year",
  structure: "academic_structure",
  "academic-structure": "academic_structure",
  academic_structure: "academic_structure",
  "school-day": "school_day",
  school_day: "school_day",
  rooms: "rooms",
  staff: "staff",
  pupils: "pupils",
  portals: "portals",
  ready: "completion",
  completion: "completion",
};

export function parseSetupStep(value: string | null | undefined): OnboardingStep | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  return SETUP_STEP_ALIASES[key] ?? (isOnboardingStep(key) ? key : null);
}

export function setupStepHref(step: OnboardingStep): string {
  return `${SETUP_PATH}?step=${step}`;
}

export function setupWelcomePrimaryHref(input: {
  status: SetupStatus;
  resumeStep: OnboardingStep;
}): string {
  return input.status === "completed" ? SETUP_PATH : setupStepHref(input.resumeStep);
}

export function mergeCompletedSteps(
  existing: readonly string[],
  add: OnboardingStep | readonly OnboardingStep[],
): OnboardingStep[] {
  const extra = Array.isArray(add) ? add : [add];
  const set = new Set<OnboardingStep>();
  for (const step of existing) {
    if (isOnboardingStep(step)) set.add(step);
  }
  for (const step of extra) {
    if (isOnboardingStep(step)) set.add(step);
  }
  return ONBOARDING_STEPS.filter((step) => set.has(step));
}

export function parseSafeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/school")) return null;
  if (trimmed.startsWith("//") || trimmed.includes("\\")) return null;
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, "https://school.invalid");
    if (url.origin !== "https://school.invalid") return null;
    if (!url.pathname.startsWith("/school")) return null;
    if (url.pathname.includes("..")) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function withSetupReturn(href: string, step: OnboardingStep): string {
  const url = new URL(href, "https://school.invalid");
  url.searchParams.set("returnTo", setupStepHref(step));
  return `${url.pathname}${url.search}`;
}

export function setupReturnLeaveMessage(): string {
  return "You have unsaved changes. Leave without saving?";
}

export function seedYearGroupsMessage(created: number): string {
  return created > 0 ? "Standard year groups created" : "Standard year groups are already set up";
}

function readinessItem(
  key: ReadinessItemKey,
  label: string,
  href: string,
  tier: ReadinessTier,
): ReadinessItemDefinition {
  return { key, label, href, required: tier === "required", tier };
}

export const READINESS_ITEMS: readonly ReadinessItemDefinition[] = [
  readinessItem("school_profile", "School profile", setupStepHref("school_details"), "required"),
  readinessItem("branding", "Branding", setupStepHref("branding"), "recommended"),
  readinessItem("academic_year", "Academic year", setupStepHref("academic_year"), "required"),
  readinessItem("term_dates", "Term dates", setupStepHref("academic_year"), "recommended"),
  readinessItem("year_groups", "Year groups", setupStepHref("academic_structure"), "required"),
  readinessItem("classes", "Classes", setupStepHref("academic_structure"), "required"),
  readinessItem("subjects", "Subjects", setupStepHref("academic_structure"), "required"),
  readinessItem("school_day", "School day", setupStepHref("school_day"), "recommended"),
  readinessItem("rooms", "Rooms", setupStepHref("rooms"), "recommended"),
  readinessItem("staff", "Staff", setupStepHref("staff"), "recommended"),
  readinessItem("pupils", "Pupils", setupStepHref("pupils"), "recommended"),
  readinessItem("parent_accounts", "Parent accounts", setupStepHref("portals"), "recommended"),
  readinessItem("student_portal", "Student Portal", setupStepHref("portals"), "recommended"),
  readinessItem("timetable", "Timetable", "/school/timetable", "recommended"),
  readinessItem("statutory_profile", "Statutory school profile", "/school/settings/statutory", "optional"),
];

export function readinessFixHref(key: ReadinessItemKey): string {
  const item = READINESS_ITEMS.find((entry) => entry.key === key);
  if (!item) throw new Error(`Unknown readiness item: ${key}`);
  return item.href;
}

export function isOnboardingStep(value: string): value is OnboardingStep {
  return (ONBOARDING_STEPS as readonly string[]).includes(value);
}

export function readinessStatus(complete: boolean, requiredOrTier: boolean | ReadinessTier): ReadinessStatus {
  if (complete) return "complete";
  const tier: ReadinessTier =
    typeof requiredOrTier === "boolean" ? (requiredOrTier ? "required" : "optional") : requiredOrTier;
  if (tier === "required") return "needs_attention";
  if (tier === "recommended") return "recommended";
  return "optional";
}

export function schoolIsReady(items: ReadonlyArray<{ required: boolean; complete: boolean }>): boolean {
  return items.filter((item) => item.required).every((item) => item.complete);
}

export function readinessTierLabel(tier: ReadinessTier): string {
  switch (tier) {
    case "required":
      return "Required";
    case "recommended":
      return "Recommended";
    default:
      return "Optional";
  }
}

export function setupStatusLabel(status: SetupStatus): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "in_progress":
      return "In progress";
    default:
      return "Not started";
  }
}

export function setupSidebarBadge(input: {
  status: SetupStatus;
  percent: number;
  dismissed: boolean;
}): { badge: string | null; badgeTone: "accent" | "subtle"; emphasis: boolean } {
  if (input.status === "completed") {
    return { badge: null, badgeTone: "subtle", emphasis: false };
  }
  if (input.dismissed) {
    return { badge: `${input.percent}%`, badgeTone: "subtle", emphasis: false };
  }
  return {
    badge: input.percent === 0 ? "Setup required" : `${input.percent}%`,
    badgeTone: "accent",
    emphasis: true,
  };
}

export function setupProgressLabel(progress: Pick<SetupProgressView, "completedCount" | "totalSteps" | "percent">): string {
  return `${progress.completedCount} of ${progress.totalSteps} complete`;
}

function readinessByKey(
  items: ReadonlyArray<{ key: string; required: boolean; complete: boolean }>,
): Map<string, { required: boolean; complete: boolean }> {
  return new Map(items.map((item) => [item.key, item]));
}

export function isSetupStepSatisfied(
  step: OnboardingStep,
  input: {
    completedSteps?: readonly string[];
    completedAt?: string | null;
    readinessItems: ReadonlyArray<{ key: string; required: boolean; complete: boolean }>;
  },
): boolean {
  if (step === "completion") return Boolean(input.completedAt);
  const mapped = SETUP_STEP_READINESS[step];
  if (mapped.length === 0) return false;
  const byKey = readinessByKey(input.readinessItems);
  return mapped.every((key) => Boolean(byKey.get(key)?.complete));
}

export function deriveSetupStatus(input: SetupProgressInput): SetupStatus {
  if (input.completedAt) return "completed";
  if ((input.completedSteps ?? []).some((step) => isOnboardingStep(step))) return "in_progress";
  if (input.currentStep && input.currentStep !== "school_details") return "in_progress";
  if (input.readinessItems.some((item) => item.complete)) return "in_progress";
  return "not_started";
}

export function evaluateSetupProgress(input: SetupProgressInput): SetupProgressView {
  const status = deriveSetupStatus(input);
  const satisfiedSteps = ONBOARDING_STEPS.filter((step) => isSetupStepSatisfied(step, input));
  const completedCount = satisfiedSteps.length;
  const firstIncomplete = ONBOARDING_STEPS.find((step) => !satisfiedSteps.includes(step)) ?? "completion";
  const stored = isOnboardingStep(input.currentStep ?? "") ? (input.currentStep as OnboardingStep) : null;
  const resumeStep =
    stored && !satisfiedSteps.includes(stored) && stored !== "school_details" ? stored : firstIncomplete;
  return {
    status,
    completedCount,
    totalSteps: SETUP_STEP_COUNT,
    percent: Math.round((completedCount / SETUP_STEP_COUNT) * 100),
    resumeStep,
    satisfiedSteps,
  };
}

/**
 * School setup completion and intro presentation are separate.
 * A completed school with no per-admin dismissal still receives the welcome once.
 */
export function shouldAutoLaunchOnboarding(input: {
  canManageSetup: boolean;
  setupStatus: SetupStatus;
  automaticOnboardingDismissed: boolean;
}): boolean {
  return input.canManageSetup && !input.automaticOnboardingDismissed;
}

export function shouldShowDashboardOnboardingCard(input: {
  canManageSetup: boolean;
  setupStatus: SetupStatus;
  automaticOnboardingDismissed: boolean;
}): boolean {
  return (
    input.canManageSetup &&
    input.setupStatus !== "completed" &&
    !input.automaticOnboardingDismissed
  );
}

export function buildOnboardingPresentation(input: {
  canManageSetup: boolean;
  setupStatus: SetupStatus;
  automaticOnboardingDismissed: boolean;
}): OnboardingPresentation {
  return {
    automaticOnboardingDismissed: input.automaticOnboardingDismissed,
    shouldAutoLaunch: shouldAutoLaunchOnboarding(input),
    showDashboardCard: shouldShowDashboardOnboardingCard(input),
  };
}

export const ONBOARDING_DISMISS_LABEL = "Don't show this again";
export const SETUP_COMPLETE_BADGE = "School setup complete ✓";

export function onboardingWelcomeCopy(input: {
  schoolName: string;
  status: SetupStatus;
  completedCount: number;
  totalSteps: number;
  currentStep?: string | null;
  completedSteps?: readonly string[];
}): {
  heading: string;
  title: string;
  lede: string;
  primaryLabel: string;
  showProgress: boolean;
  completeBadge: string | null;
  dismissLabel: string;
} {
  const name = input.schoolName.trim() || "your school";
  if (input.status === "completed") {
    return {
      heading: "Welcome to LuvLearn",
      title: `${name} is already set up.`,
      lede: "You can review your school setup at any time or continue to your dashboard.",
      primaryLabel: "Review School Setup",
      showProgress: false,
      completeBadge: SETUP_COMPLETE_BADGE,
      dismissLabel: ONBOARDING_DISMISS_LABEL,
    };
  }
  const unusedWizard =
    (input.completedSteps ?? []).length === 0 &&
    (!input.currentStep || input.currentStep === "school_details");
  const firstLook =
    input.status === "not_started" ||
    input.completedCount === 0 ||
    (unusedWizard && input.completedCount <= 2);
  if (firstLook) {
    return {
      heading: "Welcome to LuvLearn",
      title: `Let's set up ${name}`,
      lede: "We'll guide you through the essentials so your staff, parents and pupils can start using the system.",
      primaryLabel: "Start school setup",
      showProgress: input.status !== "not_started" || input.completedCount > 0,
      completeBadge: null,
      dismissLabel: ONBOARDING_DISMISS_LABEL,
    };
  }
  return {
    heading: "Welcome back",
    title: `Continue setting up ${name}`,
    lede: `Your school setup is ${Math.round((input.completedCount / input.totalSteps) * 100)}% complete.`,
    primaryLabel: "Continue School Setup",
    showProgress: true,
    completeBadge: null,
    dismissLabel: ONBOARDING_DISMISS_LABEL,
  };
}

const LOGIN_NEXT_PREFIXES: Record<LoginPortal, readonly string[]> = {
  staff: ["/school"],
  parent: ["/parent"],
  student: ["/student"],
  platform: ["/platform"],
};

const CRITICAL_LOGIN_PREFIXES = ["/invite", "/activate", "/reset-password", "/forgot-password"] as const;

function safeRelativePath(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//") || trimmed.includes("\\")) return null;
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, "https://school.invalid");
    if (url.origin !== "https://school.invalid") return null;
    if (url.pathname.includes("..")) return null;
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function parseSafeLoginNext(
  value: string | null | undefined,
  portal: LoginPortal = "staff",
): string | null {
  const path = safeRelativePath(value);
  if (!path) return null;
  const pathname = path.split("?")[0] ?? path;
  const allowed = [...LOGIN_NEXT_PREFIXES[portal], ...CRITICAL_LOGIN_PREFIXES];
  if (allowed.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return path;
  return null;
}

const SYSTEM_GENERATED_SCHOOL_LANDINGS = [SCHOOL_DASHBOARD_PATH, "/school/dashboard"] as const;

function schoolPathname(path: string): string {
  return (path.split("?")[0] ?? path).replace(/\/+$/, "") || "/";
}

/**
 * System-generated defaults after staff login — not an explicit user-requested deep link.
 * Includes a missing/empty next, `/school`, `/school/`, and `/school/dashboard`.
 */
export function isSystemGeneratedSchoolLanding(path: string | null | undefined): boolean {
  if (!path) return true;
  const pathname = schoolPathname(path);
  return (SYSTEM_GENERATED_SCHOOL_LANDINGS as readonly string[]).includes(pathname);
}

export function isDefaultSchoolLanding(path: string | null | undefined): boolean {
  return isSystemGeneratedSchoolLanding(path);
}

export function isExplicitStaffDeepLink(path: string | null | undefined): boolean {
  const next = parseSafeLoginNext(path, "staff");
  if (!next || isCriticalPostAuthPath(next)) return false;
  return !isSystemGeneratedSchoolLanding(next);
}

export function isCriticalPostAuthPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const pathname = path.split("?")[0] ?? path;
  return CRITICAL_LOGIN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function resolveStaffPostAuthPath(input: {
  canManageSetup: boolean;
  setupStatus: SetupStatus;
  automaticOnboardingDismissed: boolean;
  requestedNext?: string | null;
}): string {
  const next = parseSafeLoginNext(input.requestedNext, "staff");
  if (next && isCriticalPostAuthPath(next)) return next;
  if (next && isExplicitStaffDeepLink(next)) return next;
  if (shouldAutoLaunchOnboarding(input)) return ONBOARDING_WELCOME_PATH;
  return SCHOOL_DASHBOARD_PATH;
}

export function resolvePostAuthPath(input: {
  portal: LoginPortal;
  isPlatformAdmin?: boolean;
  schoolHost?: boolean;
  canManageSetup?: boolean;
  setupStatus?: SetupStatus;
  automaticOnboardingDismissed?: boolean;
  requestedNext?: string | null;
}): string {
  if (input.portal === "platform" || (input.isPlatformAdmin && !input.schoolHost)) {
    return parseSafeLoginNext(input.requestedNext, "platform") ?? "/platform";
  }
  if (input.portal === "parent") {
    return parseSafeLoginNext(input.requestedNext, "parent") ?? "/parent";
  }
  if (input.portal === "student") {
    return parseSafeLoginNext(input.requestedNext, "student") ?? "/student";
  }
  return resolveStaffPostAuthPath({
    canManageSetup: Boolean(input.canManageSetup),
    setupStatus: input.setupStatus ?? "not_started",
    automaticOnboardingDismissed: Boolean(input.automaticOnboardingDismissed),
    requestedNext: input.requestedNext,
  });
}

export function loginHrefForReturn(path: string, portal: LoginPortal = "staff"): string {
  const next = parseSafeLoginNext(path, portal);
  if (!next) return "/login";
  if (portal === "staff" && isSystemGeneratedSchoolLanding(next)) return "/login";
  return `/login?next=${encodeURIComponent(next)}`;
}

export const ACCOUNT_STATUSES = ["no_account", "invite_pending", "active", "suspended"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function deriveAccountStatus(input: {
  membershipStatus?: string | null;
  hasCredentials?: boolean;
  pendingInvitation?: boolean;
}): AccountStatus {
  if (input.membershipStatus === "suspended") return "suspended";
  if (input.membershipStatus === "active") return "active";
  if (input.membershipStatus === "invited" || input.pendingInvitation) return "invite_pending";
  if (input.hasCredentials) return "active";
  return "no_account";
}

export function accountStatusLabel(status: AccountStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "invite_pending":
      return "Invite pending";
    case "suspended":
      return "Suspended";
    default:
      return "No account";
  }
}

export const IMPORT_KINDS = ["staff", "pupils", "guardians"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORTABLE_STAFF_ROLE_KEYS = [
  "school.teacher",
  "school.staff",
  "school.admissions",
  "school.headteacher",
] as const;
export type ImportableStaffRoleKey = (typeof IMPORTABLE_STAFF_ROLE_KEYS)[number];

const IMPORT_ROLE_ALIASES: Record<string, ImportableStaffRoleKey> = {
  teacher: "school.teacher",
  "school.teacher": "school.teacher",
  staff: "school.staff",
  "school.staff": "school.staff",
  admissions: "school.admissions",
  "school.admissions": "school.admissions",
  headteacher: "school.headteacher",
  head: "school.headteacher",
  "school.headteacher": "school.headteacher",
};

export function mapImportedStaffRole(value: string | null | undefined): ImportableStaffRoleKey | null {
  if (!value) return "school.teacher";
  const key = value.trim().toLowerCase();
  if (!key) return "school.teacher";
  if (key === "admin" || key === "school.admin") return null;
  return IMPORT_ROLE_ALIASES[key] ?? null;
}

export const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function safeBrandColor(value: string | null | undefined, fallback: string): string {
  return normalizeBrandHex(value) ?? fallback;
}

export function normalizeBrandHex(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  const six = trimmed.match(/^#([0-9a-fA-F]{6})$/);
  if (six) return `#${six[1]!.toUpperCase()}`;
  const three = trimmed.match(/^#([0-9a-fA-F]{3})$/);
  if (three) {
    const [a, b, c] = three[1]!.split("");
    return `#${a}${a}${b}${b}${c}${c}`.toUpperCase();
  }
  return null;
}

export function hexForColorInput(value: string, fallback: string): string {
  return normalizeBrandHex(value) ?? normalizeBrandHex(fallback) ?? DEFAULT_BRAND_PRIMARY.toUpperCase();
}

export function brandHexError(value: string): string | null {
  if (!value.trim()) return "Enter a colour, for example #122C4A.";
  if (!normalizeBrandHex(value)) return "Enter a valid colour like #122C4A.";
  return null;
}

export const DEFAULT_BRAND_PRIMARY = "#122C4A";
export const DEFAULT_BRAND_ACCENT = "#2B78C9";

export const PUBLIC_BRANDING_PATHS = {
  logo: "/api/v1/public/branding/logo",
  hero: "/api/v1/public/branding/hero",
} as const;

const BRANDING_VERSION_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function publicBrandingAssetUrl(
  kind: "logo" | "hero",
  version?: string | null,
): string {
  const base = kind === "logo" ? PUBLIC_BRANDING_PATHS.logo : PUBLIC_BRANDING_PATHS.hero;
  const safe = version?.trim() ?? "";
  if (!safe || !BRANDING_VERSION_RE.test(safe)) return base;
  return `${base}?v=${safe}`;
}

export const FORGOT_PASSWORD_COPY =
  "If an account exists, reset instructions have been generated.";

export const MAIL_PURPOSES = [
  "staff_invite",
  "parent_invite",
  "password_reset",
  "account_activation",
  "student_activation",
  "admissions_application_received",
  "admissions_status_update",
] as const;
export type MailPurpose = (typeof MAIL_PURPOSES)[number];

export const EMAIL_TEMPLATE_KEYS = [
  "account_invitation",
  "password_reset",
  "admissions_application_received",
  "admissions_status_update",
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export const MAIL_OUTBOX_STATUSES = ["queued", "sending", "sent", "failed", "cancelled"] as const;
export type MailOutboxStatus = (typeof MAIL_OUTBOX_STATUSES)[number];

export const ACCOUNT_TOKEN_PURPOSES = ["password_reset", "student_activation", "student_reset"] as const;
export type AccountTokenPurpose = (typeof ACCOUNT_TOKEN_PURPOSES)[number];
