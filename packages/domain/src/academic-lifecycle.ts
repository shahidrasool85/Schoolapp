export const ACADEMIC_RECORD_STATUSES = ["active", "archived"] as const;
export type AcademicRecordStatus = (typeof ACADEMIC_RECORD_STATUSES)[number];

export const YEAR_GROUP_ORIGINS = ["system", "custom"] as const;
export type YearGroupOrigin = (typeof YEAR_GROUP_ORIGINS)[number];

export const SYSTEM_YEAR_GROUP_DELETE_REASON =
  "This year group is a standard UK year group and cannot be permanently deleted. Archive it instead.";

export type AcademicUsageCount = {
  key: string;
  label: string;
  count: number;
};

export type AcademicLifecycle = {
  canDelete: boolean;
  canArchive: boolean;
  canRestore: boolean;
  reasons: string[];
  usage: AcademicUsageCount[];
  message: string;
};

export const SCHOOL_SEARCH_MIN_LENGTH = 2;
export const SCHOOL_SEARCH_MAX_LENGTH = 80;
export const SCHOOL_SEARCH_LIMIT = 10;
export const SCHOOL_SEARCH_HARD_CAP = 10;

export function isAcademicRecordStatus(value: unknown): value is AcademicRecordStatus {
  return value === "active" || value === "archived";
}

export function isYearGroupOrigin(value: unknown): value is YearGroupOrigin {
  return value === "system" || value === "custom";
}

export function isSystemYearGroup(origin: unknown): boolean {
  return origin === "system";
}

export function parseSchoolSearchQuery(raw: unknown): { ok: true; query: string } | { ok: false; query: "" } {
  const query = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (query.length < SCHOOL_SEARCH_MIN_LENGTH || query.length > SCHOOL_SEARCH_MAX_LENGTH) {
    return { ok: false, query: "" };
  }
  const significant = query.replace(/[%_*\\]+/g, "").replace(/\s+/g, "");
  if (significant.length < SCHOOL_SEARCH_MIN_LENGTH) {
    return { ok: false, query: "" };
  }
  return { ok: true, query };
}

const USAGE_SINGULAR: Record<string, string> = {
  classes: "class",
  "class links": "class link",
  "timetable entries": "timetable entry",
  "timetable replacements": "timetable replacement",
  assignments: "assignment",
  "assignment targets": "assignment target",
  "learning activities": "learning activity",
  assessments: "assessment",
  "assessment classes": "assessment class",
  "academic targets": "academic target",
  "report sections": "report section",
  "reporting periods": "reporting period",
  reports: "report",
  "pupil enrolments": "pupil enrolment",
  "teacher assignments": "teacher assignment",
  "attendance marks": "attendance mark",
  terms: "term",
  "half terms": "half term",
  "fee schedules": "fee schedule",
  invoices: "invoice",
  "billing runs": "billing run",
  charges: "charge",
  "census runs": "census run",
  "admissions applications": "admissions application",
  "admissions enquiries": "admissions enquiry",
  "admissions offers": "admissions offer",
  "activity targets": "activity target",
};

function formatUsagePart(item: AcademicUsageCount): string {
  if (item.count === 1) return `1 ${USAGE_SINGULAR[item.label] ?? item.label}`;
  return `${item.count} ${item.label}`;
}

export function summarizeAcademicUsage(usage: AcademicUsageCount[], entityLabel: string): string {
  const used = usage.filter((item) => item.count > 0);
  if (used.length === 0) {
    return `${entityLabel} has not been used anywhere and can be permanently deleted.`;
  }
  const parts = used.map(formatUsagePart);
  if (parts.length === 1) {
    return `${entityLabel} cannot be deleted because it has ${parts[0]}. Archive it instead.`;
  }
  const last = parts[parts.length - 1];
  return `${entityLabel} cannot be deleted because it has ${parts.slice(0, -1).join(", ")} and ${last}. Archive it instead.`;
}

export function formatAcademicDeletionMessage(
  entityLabel: string,
  lifecycle: Pick<AcademicLifecycle, "canDelete" | "reasons" | "usage">,
): string {
  if (lifecycle.canDelete) {
    return `${entityLabel} has not been used anywhere and can be permanently deleted.`;
  }
  const used = lifecycle.usage.filter((item) => item.count > 0);
  if (used.length === 0) {
    return lifecycle.reasons[0] ?? `${entityLabel} cannot be permanently deleted.`;
  }
  return summarizeAcademicUsage(used, entityLabel);
}

export function academicLifecycleFromUsage(input: {
  status: AcademicRecordStatus;
  usage: AcademicUsageCount[];
  extraBlockReasons?: string[];
  archiveBlockedReasons?: string[];
  entityLabel?: string;
}): AcademicLifecycle {
  const extra = input.extraBlockReasons ?? [];
  const archiveBlocked = input.archiveBlockedReasons ?? [];
  const referenced = input.usage.some((item) => item.count > 0);
  const canDelete = !referenced && extra.length === 0;
  const canArchive = input.status === "active" && archiveBlocked.length === 0;
  const canRestore = input.status === "archived";
  const reasons = [
    ...extra,
    ...archiveBlocked,
    ...(referenced && !canDelete
      ? input.usage.filter((item) => item.count > 0).map((item) => `${item.count} ${item.label}`)
      : []),
  ];
  const lifecycle = { canDelete, canArchive, canRestore, reasons, usage: input.usage, message: "" };
  lifecycle.message = formatAcademicDeletionMessage(input.entityLabel ?? "This record", lifecycle);
  return lifecycle;
}

export function trustedSchoolLoginPath(): "/login" {
  return "/login";
}

export function safeRelativeNext(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("://")) return null;
  if (raw.includes("\\") || raw.includes("\n") || raw.includes("\r")) return null;
  return raw;
}
