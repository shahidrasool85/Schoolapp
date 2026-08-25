import {
  CENSUS_RUN_STATUSES,
  CENSUS_TYPES,
  DATA_EXPORT_FORMATS,
  DATA_EXPORT_KINDS,
  LOOKED_AFTER_STATUSES,
  STATUTORY_ISSUE_SEVERITIES,
  type CensusRunStatus,
  type CensusType,
  type DataExportFormat,
  type DataExportKind,
  type LookedAfterStatus,
  type StatutoryIssueSeverity,
  type StatutorySendProvisionCode,
} from "@schoolapp/domain";

export const CENSUS_SNAPSHOT_SCHEMA_VERSION = 1;

export type FsmPeriod = {
  startedOn: string;
  endedOn: string | null;
};

export type SchoolStatutoryRecord = {
  establishmentNumber: string | null;
  localAuthorityNumber: string | null;
  urn: string | null;
  statutoryName: string | null;
  schoolPhase: string | null;
  establishmentType: string | null;
  establishmentStatus: string | null;
  addressLine1: string | null;
  addressTown: string | null;
  addressPostcode: string | null;
  timezone: string | null;
  hasActiveSessions?: boolean;
};

export type PupilStatutoryRecord = {
  studentProfileId: string;
  legalName: string;
  preferredName: string | null;
  legalSurname: string | null;
  legalForename: string | null;
  middleNames: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  upn: string | null;
  formerUpn: string | null;
  ethnicityCode: string | null;
  languageCode: string | null;
  enrolmentStatus: string;
  enrolmentStatusCode: string | null;
  admissionNumber: string | null;
  dateOfAdmission: string | null;
  dateOfLeaving: string | null;
  leavingReasonCode: string | null;
  previousSchoolName: string | null;
  yearGroupId: string | null;
  yearGroupCode: string | null;
  yearGroupName: string | null;
  classId: string | null;
  className: string | null;
  academicYearId: string | null;
  sendProvisionCode: string | null;
  sendNotes: string | null;
  lookedAfterStatus: string | null;
  serviceChild: boolean | null;
  fsmPeriods: FsmPeriod[];
  enrolments: Array<{
    startedOn: string;
    endedOn: string | null;
    isPrimary: boolean;
    yearGroupId: string;
    academicYearId: string;
  }>;
};

export type StatutoryIssue = {
  ruleKey: string;
  severity: StatutoryIssueSeverity;
  entityType: "school" | "pupil" | "enrolment" | "attendance" | "fsm" | "send";
  entityId: string | null;
  message: string;
  field: string | null;
  metadata: Record<string, unknown>;
};

export function isCensusType(value: string): value is CensusType {
  return (CENSUS_TYPES as readonly string[]).includes(value);
}

export function isCensusRunStatus(value: string): value is CensusRunStatus {
  return (CENSUS_RUN_STATUSES as readonly string[]).includes(value);
}

export function isDataExportKind(value: string): value is DataExportKind {
  return (DATA_EXPORT_KINDS as readonly string[]).includes(value);
}

export function isDataExportFormat(value: string): value is DataExportFormat {
  return (DATA_EXPORT_FORMATS as readonly string[]).includes(value);
}

export function isLookedAfterStatus(value: string): value is LookedAfterStatus {
  return (LOOKED_AFTER_STATUSES as readonly string[]).includes(value);
}

export function censusMayRegenerate(status: string): boolean {
  return status === "draft" || status === "validating";
}

export function censusMayFinalise(status: string): boolean {
  return status === "draft" || status === "validating" || status === "ready";
}

export function censusMayExport(status: string): boolean {
  return status === "ready" || status === "exported";
}

export function censusIsImmutable(status: string): boolean {
  return status === "ready" || status === "exported" || status === "superseded" || status === "archived";
}

export function fsmEligibleOnDate(periods: readonly FsmPeriod[], date: string): boolean {
  const d = date.slice(0, 10);
  return periods.some((period) => {
    if (period.startedOn.slice(0, 10) > d) return false;
    if (period.endedOn && period.endedOn.slice(0, 10) < d) return false;
    return true;
  });
}

/**
 * Operational additional-needs notes are not a census SEND record.
 * Map them to a statutory provision code only when one is already classified.
 */
export function mapOperationalSendToStatutory(input: {
  sendProvisionCode: string | null;
  sendNotes: string | null;
}): {
  code: StatutorySendProvisionCode | null;
  incomplete: boolean;
} {
  const code = input.sendProvisionCode;
  const typed =
    code === "N" || code === "K" || code === "E" ? code : null;
  const notes = input.sendNotes?.trim() ?? "";
  const incomplete = Boolean(notes) && (typed == null || typed === "N");
  return { code: typed, incomplete };
}

export function splitLegalName(legalName: string | null | undefined): {
  legalForename: string | null;
  legalSurname: string | null;
  middleNames: string | null;
} {
  const parts = (legalName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { legalForename: null, legalSurname: null, middleNames: null };
  }
  if (parts.length === 1) {
    return { legalForename: parts[0]!, legalSurname: null, middleNames: null };
  }
  const legalForename = parts[0]!;
  const legalSurname = parts[parts.length - 1]!;
  const middleNames = parts.length > 2 ? parts.slice(1, -1).join(" ") : null;
  return { legalForename, legalSurname, middleNames };
}

export function validateEstablishmentNumber(value: string | null | undefined): boolean {
  return value == null || value === "" || /^\d{4}$/.test(value);
}

export function validateLocalAuthorityNumber(value: string | null | undefined): boolean {
  return value == null || value === "" || /^\d{3}$/.test(value);
}

export function validateUrn(value: string | null | undefined): boolean {
  return value == null || value === "" || /^\d{6}$/.test(value);
}

export function countIssues(issues: readonly StatutoryIssue[]): {
  errorCount: number;
  warningCount: number;
  informationCount: number;
} {
  return {
    errorCount: issues.filter((row) => row.severity === "error").length,
    warningCount: issues.filter((row) => row.severity === "warning").length,
    informationCount: issues.filter((row) => row.severity === "information").length,
  };
}

export function auditSafeStatutoryAfter(input: {
  action: string;
  entityId?: string | null;
  version?: number | null;
  status?: string | null;
  counts?: { errorCount?: number; warningCount?: number; informationCount?: number };
  exportKind?: string | null;
  format?: string | null;
}): Record<string, unknown> {
  return {
    action: input.action,
    entityId: input.entityId ?? null,
    version: input.version ?? null,
    status: input.status ?? null,
    errorCount: input.counts?.errorCount ?? null,
    warningCount: input.counts?.warningCount ?? null,
    informationCount: input.counts?.informationCount ?? null,
    exportKind: input.exportKind ?? null,
    format: input.format ?? null,
  };
}

export { STATUTORY_ISSUE_SEVERITIES };
