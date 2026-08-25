import { PERMISSIONS, actorHasAny, type Actor } from "@schoolapp/domain";
import { AppError } from "./errors.js";

export const STATUTORY_READ_PERMISSIONS = [
  PERMISSIONS.STATUTORY_READ,
  PERMISSIONS.STATUTORY_MANAGE,
  PERMISSIONS.STATUTORY_VALIDATE,
] as const;

export const STATUTORY_PUPIL_READ_PERMISSIONS = [
  PERMISSIONS.PUPILS_STATUTORY_READ,
  PERMISSIONS.PUPILS_STATUTORY_MANAGE,
] as const;

export const REPORT_EXPORT_PERMISSIONS = [
  PERMISSIONS.REPORTS_EXPORTS_CREATE,
  PERMISSIONS.STATUTORY_CENSUS_EXPORT,
] as const;

export function canReadStatutory(actor: Actor): boolean {
  return actorHasAny(actor, STATUTORY_READ_PERMISSIONS);
}

export function canManageStatutory(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.STATUTORY_MANAGE);
}

export function canValidateStatutory(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.STATUTORY_VALIDATE) ||
    actor.permissions.has(PERMISSIONS.STATUTORY_MANAGE)
  );
}

export function canCreateCensus(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.STATUTORY_CENSUS_CREATE);
}

export function canFinaliseCensus(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.STATUTORY_CENSUS_FINALISE);
}

export function canExportCensus(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.STATUTORY_CENSUS_EXPORT);
}

export function canReadPupilStatutory(actor: Actor): boolean {
  return actorHasAny(actor, STATUTORY_PUPIL_READ_PERMISSIONS);
}

export function canManagePupilStatutory(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.PUPILS_STATUTORY_MANAGE);
}

export function canReadPupilRollReport(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.REPORTS_PUPILS_READ);
}

export function canReadAttendanceReport(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.REPORTS_ATTENDANCE_READ);
}

export function canReadAdmissionsReport(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.REPORTS_ADMISSIONS_READ);
}

export function canReadSendReport(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.REPORTS_SEND_READ) &&
    actor.permissions.has(PERMISSIONS.STUDENTS_ADDITIONAL_NEEDS_READ)
  );
}

export function canCreateReportExport(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.REPORTS_EXPORTS_CREATE);
}

export function assertCanReadStatutory(actor: Actor): void {
  if (!canReadStatutory(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export function assertCanManageStatutory(actor: Actor): void {
  if (!canManageStatutory(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export function assertCanValidateStatutory(actor: Actor): void {
  if (!canValidateStatutory(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export function assertCanCreateCensus(actor: Actor): void {
  if (!canCreateCensus(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export function assertCanFinaliseCensus(actor: Actor): void {
  if (!canFinaliseCensus(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export function assertCanExportCensus(actor: Actor): void {
  if (!canExportCensus(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export function assertCanReadPupilStatutory(actor: Actor): void {
  if (!canReadPupilStatutory(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export function assertCanManagePupilStatutory(actor: Actor): void {
  if (!canManagePupilStatutory(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export function assertCanReadSendReport(actor: Actor): void {
  if (!canReadSendReport(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}
