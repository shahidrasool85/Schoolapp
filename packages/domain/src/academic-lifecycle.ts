export const ACADEMIC_RECORD_STATUSES = ["active", "archived"] as const;
export type AcademicRecordStatus = (typeof ACADEMIC_RECORD_STATUSES)[number];

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
};

export const SCHOOL_SEARCH_MIN_LENGTH = 2;
export const SCHOOL_SEARCH_MAX_LENGTH = 80;
export const SCHOOL_SEARCH_LIMIT = 8;

export function isAcademicRecordStatus(value: unknown): value is AcademicRecordStatus {
  return value === "active" || value === "archived";
}

export function parseSchoolSearchQuery(raw: unknown): { ok: true; query: string } | { ok: false; query: "" } {
  const query = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (query.length < SCHOOL_SEARCH_MIN_LENGTH || query.length > SCHOOL_SEARCH_MAX_LENGTH) {
    return { ok: false, query: "" };
  }
  return { ok: true, query };
}

export function summarizeAcademicUsage(usage: AcademicUsageCount[], entityLabel: string): string {
  const used = usage.filter((item) => item.count > 0);
  if (used.length === 0) {
    return `${entityLabel} has not been used anywhere and can be permanently deleted.`;
  }
  const parts = used.map((item) =>
    item.count === 1 ? `1 ${item.label}` : `${item.count} ${item.label}`,
  );
  if (parts.length === 1) {
    return `${entityLabel} cannot be deleted because ${parts[0]} use it. Archive it instead.`;
  }
  const last = parts[parts.length - 1];
  return `${entityLabel} cannot be deleted because ${parts.slice(0, -1).join(", ")} and ${last} use it. Archive it instead.`;
}

export function academicLifecycleFromUsage(input: {
  status: AcademicRecordStatus;
  usage: AcademicUsageCount[];
  extraBlockReasons?: string[];
  archiveBlockedReasons?: string[];
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
  return { canDelete, canArchive, canRestore, reasons, usage: input.usage };
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
