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

export const READINESS_ITEMS: readonly ReadinessItemDefinition[] = [
  { key: "school_profile", label: "School profile", href: "/school/setup?step=school_details", required: true },
  { key: "branding", label: "Branding", href: "/school/setup?step=branding", required: false },
  { key: "academic_year", label: "Academic year", href: "/school/academic-years", required: true },
  { key: "term_dates", label: "Term dates", href: "/school/setup?step=academic_year", required: false },
  { key: "year_groups", label: "Year groups", href: "/school/year-groups", required: true },
  { key: "classes", label: "Classes", href: "/school/classes", required: true },
  { key: "subjects", label: "Subjects", href: "/school/subjects", required: true },
  { key: "school_day", label: "School day", href: "/school/timetable/school-day", required: false },
  { key: "rooms", label: "Rooms", href: "/school/timetable/rooms", required: false },
  { key: "staff", label: "Staff", href: "/school/staff", required: true },
  { key: "pupils", label: "Pupils", href: "/school/students", required: true },
  { key: "parent_accounts", label: "Parent accounts", href: "/school/parents", required: false },
  { key: "student_portal", label: "Student Portal", href: "/school/student-portal", required: false },
  { key: "timetable", label: "Timetable", href: "/school/timetable", required: false },
  { key: "statutory_profile", label: "Statutory school profile", href: "/school/settings/statutory", required: false },
];

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
  const trimmed = value?.trim();
  if (trimmed && HEX_COLOR_PATTERN.test(trimmed)) return trimmed;
  return fallback;
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
