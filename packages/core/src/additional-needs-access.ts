import { PERMISSIONS, type Actor, type PupilMedicalView } from "@schoolapp/domain";
import type pg from "pg";
import { AppError } from "./errors.js";
import { assignedStudentIds, canReadStudentProfile, guardianChildIds } from "./students-access.js";

export function canManageAdditionalNeeds(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.STUDENTS_ADDITIONAL_NEEDS_MANAGE);
}

export function canReadFullAdditionalNeeds(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.STUDENTS_ADDITIONAL_NEEDS_READ) ||
    actor.permissions.has(PERMISSIONS.STUDENTS_ADDITIONAL_NEEDS_MANAGE)
  );
}

export function canReadOperationalMedications(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.STUDENTS_MEDICATIONS_READ_OPERATIONAL);
}

export function canReadOperationalDietary(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.STUDENTS_DIETARY_READ_OPERATIONAL);
}

export function canReadParentMedications(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.STUDENTS_MEDICATIONS_READ_OWN_CHILDREN);
}

export function canReadParentDietary(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.STUDENTS_DIETARY_READ_OWN_CHILDREN);
}

export async function resolveMedicationView(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  studentProfileId: string,
): Promise<PupilMedicalView | null> {
  const readable = await canReadStudentProfile(
    client,
    actor.userId,
    organisationId,
    studentProfileId,
    actor.permissions,
  );
  if (!readable) return null;
  if (canReadFullAdditionalNeeds(actor)) return "full";
  if (canReadParentMedications(actor)) {
    const linked = await guardianChildIds(client, actor.userId, organisationId);
    if (linked.has(studentProfileId)) return "parent";
  }
  if (canReadOperationalMedications(actor)) {
    const assigned = await assignedStudentIds(client, actor.userId, organisationId);
    if (assigned.has(studentProfileId)) return "operational";
  }
  return null;
}

export async function resolveDietaryView(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  studentProfileId: string,
): Promise<PupilMedicalView | null> {
  const readable = await canReadStudentProfile(
    client,
    actor.userId,
    organisationId,
    studentProfileId,
    actor.permissions,
  );
  if (!readable) return null;
  if (canReadFullAdditionalNeeds(actor)) return "full";
  if (canReadParentDietary(actor)) {
    const linked = await guardianChildIds(client, actor.userId, organisationId);
    if (linked.has(studentProfileId)) return "parent";
  }
  if (canReadOperationalDietary(actor)) {
    const assigned = await assignedStudentIds(client, actor.userId, organisationId);
    if (assigned.has(studentProfileId)) return "operational";
  }
  return null;
}

export async function assertCanManagePupilAdditionalNeeds(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  studentProfileId: string,
): Promise<void> {
  const readable = await canReadStudentProfile(
    client,
    actor.userId,
    organisationId,
    studentProfileId,
    actor.permissions,
  );
  if (!readable) {
    throw new AppError(404, "not_found", "Not found");
  }
  if (!canManageAdditionalNeeds(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}
