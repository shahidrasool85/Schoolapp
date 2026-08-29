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
export type ReadinessStatus = "complete" | "needs_attention" | "optional";

export type ReadinessItemDefinition = {
  key: ReadinessItemKey;
  label: string;
  href: string;
  required: boolean;
};

export const SETUP_PATH = "/school/setup";

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

export const READINESS_ITEMS: readonly ReadinessItemDefinition[] = [
  { key: "school_profile", label: "School profile", href: setupStepHref("school_details"), required: true },
  { key: "branding", label: "Branding", href: setupStepHref("branding"), required: false },
  { key: "academic_year", label: "Academic year", href: setupStepHref("academic_year"), required: true },
  { key: "term_dates", label: "Term dates", href: setupStepHref("academic_year"), required: false },
  { key: "year_groups", label: "Year groups", href: setupStepHref("academic_structure"), required: true },
  { key: "classes", label: "Classes", href: setupStepHref("academic_structure"), required: true },
  { key: "subjects", label: "Subjects", href: setupStepHref("academic_structure"), required: true },
  { key: "school_day", label: "School day", href: setupStepHref("school_day"), required: false },
  { key: "rooms", label: "Rooms", href: setupStepHref("rooms"), required: false },
  { key: "staff", label: "Staff", href: setupStepHref("staff"), required: true },
  { key: "pupils", label: "Pupils", href: setupStepHref("pupils"), required: true },
  { key: "parent_accounts", label: "Parent accounts", href: setupStepHref("portals"), required: false },
  { key: "student_portal", label: "Student Portal", href: setupStepHref("portals"), required: false },
  { key: "timetable", label: "Timetable", href: "/school/timetable", required: false },
  { key: "statutory_profile", label: "Statutory school profile", href: "/school/settings/statutory", required: false },
];

export function readinessFixHref(key: ReadinessItemKey): string {
  const item = READINESS_ITEMS.find((entry) => entry.key === key);
  if (!item) throw new Error(`Unknown readiness item: ${key}`);
  return item.href;
}

export function isOnboardingStep(value: string): value is OnboardingStep {
  return (ONBOARDING_STEPS as readonly string[]).includes(value);
}

export function readinessStatus(complete: boolean, required: boolean): ReadinessStatus {
  if (complete) return "complete";
  return required ? "needs_attention" : "optional";
}

export function schoolIsReady(items: ReadonlyArray<{ required: boolean; complete: boolean }>): boolean {
  return items.filter((item) => item.required).every((item) => item.complete);
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
] as const;
export type MailPurpose = (typeof MAIL_PURPOSES)[number];

export const ACCOUNT_TOKEN_PURPOSES = ["password_reset", "student_activation", "student_reset"] as const;
export type AccountTokenPurpose = (typeof ACCOUNT_TOKEN_PURPOSES)[number];
