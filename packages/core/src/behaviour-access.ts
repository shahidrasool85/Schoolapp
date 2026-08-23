import { PERMISSIONS, type Actor } from "@schoolapp/domain";
import type pg from "pg";
import { createInboxNotification } from "./admissions.js";
import { writeAudit } from "./academic.js";
import { assignedStudentIds } from "./students-access.js";
import { notFound } from "./permissions.js";
import {
  auditSafeBehaviourAfter,
  auditSafeSafeguardingAfter,
  behaviourNotificationBody,
  pastoralNotificationBody,
  safeguardingNotificationBody,
} from "./behaviour.js";

export const BEHAVIOUR_SCHOOL_READ_PERMISSIONS = [
  PERMISSIONS.BEHAVIOUR_READ,
  PERMISSIONS.BEHAVIOUR_MANAGE,
] as const;

export const BEHAVIOUR_RECORD_PERMISSIONS = [
  PERMISSIONS.BEHAVIOUR_RECORD,
  PERMISSIONS.BEHAVIOUR_MANAGE,
] as const;

export const BEHAVIOUR_POSITIVE_RECORD_PERMISSIONS = [
  PERMISSIONS.BEHAVIOUR_POSITIVE_RECORD,
  PERMISSIONS.BEHAVIOUR_RECORD,
  PERMISSIONS.BEHAVIOUR_MANAGE,
] as const;

export const PASTORAL_SCHOOL_READ_PERMISSIONS = [
  PERMISSIONS.PASTORAL_READ,
  PERMISSIONS.PASTORAL_MANAGE,
] as const;

export const SAFEGUARDING_ACCESS_PERMISSIONS = [
  PERMISSIONS.SAFEGUARDING_READ,
  PERMISSIONS.SAFEGUARDING_RECORD,
  PERMISSIONS.SAFEGUARDING_MANAGE,
  PERMISSIONS.SAFEGUARDING_ASSIGN,
] as const;

export function canReadSchoolBehaviour(actor: Actor): boolean {
  return BEHAVIOUR_SCHOOL_READ_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canManageBehaviour(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.BEHAVIOUR_MANAGE);
}

export function canRecordBehaviour(actor: Actor): boolean {
  return BEHAVIOUR_RECORD_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canReadAssignedBehaviour(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.BEHAVIOUR_READ_ASSIGNED);
}

export function canRecordPositiveBehaviour(actor: Actor): boolean {
  return BEHAVIOUR_POSITIVE_RECORD_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canAccessBehaviour(actor: Actor): boolean {
  return (
    canReadSchoolBehaviour(actor) ||
    canRecordBehaviour(actor) ||
    canReadAssignedBehaviour(actor) ||
    canRecordPositiveBehaviour(actor)
  );
}

export function canReadSchoolPastoral(actor: Actor): boolean {
  return PASTORAL_SCHOOL_READ_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canManagePastoral(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.PASTORAL_MANAGE);
}

export function canReadAssignedPastoral(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.PASTORAL_READ_ASSIGNED);
}

export function canAccessPastoral(actor: Actor): boolean {
  return canReadSchoolPastoral(actor) || canManagePastoral(actor) || canReadAssignedPastoral(actor);
}

export function canReadSafeguarding(actor: Actor): boolean {
  return SAFEGUARDING_ACCESS_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canRecordSafeguarding(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.SAFEGUARDING_RECORD) ||
    actor.permissions.has(PERMISSIONS.SAFEGUARDING_MANAGE)
  );
}

export function canManageSafeguarding(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.SAFEGUARDING_MANAGE);
}

export function canAssignSafeguarding(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.SAFEGUARDING_ASSIGN) ||
    actor.permissions.has(PERMISSIONS.SAFEGUARDING_MANAGE)
  );
}

export function assertCanAccessSafeguarding(actor: Actor): void {
  if (!canReadSafeguarding(actor)) {
    notFound();
  }
}

export async function loadAuthorisedBehaviourStudentIds(
  client: pg.PoolClient,
  actor: Actor,
): Promise<Set<string> | null> {
  if (canReadSchoolBehaviour(actor) || canManageBehaviour(actor)) {
    return null;
  }
  if (canReadAssignedBehaviour(actor) || canRecordBehaviour(actor) || canRecordPositiveBehaviour(actor)) {
    return assignedStudentIds(client, actor.userId, actor.organisationId!);
  }
  notFound();
}

export async function loadAuthorisedPastoralStudentIds(
  client: pg.PoolClient,
  actor: Actor,
): Promise<Set<string> | null> {
  if (canReadSchoolPastoral(actor) || canManagePastoral(actor)) {
    return null;
  }
  if (canReadAssignedPastoral(actor)) {
    return assignedStudentIds(client, actor.userId, actor.organisationId!);
  }
  notFound();
}

export async function assertCanReadStudentBehaviour(
  client: pg.PoolClient,
  actor: Actor,
  studentProfileId: string,
): Promise<void> {
  if (!canAccessBehaviour(actor)) {
    notFound();
  }
  if (canReadSchoolBehaviour(actor) || canManageBehaviour(actor)) {
    return;
  }
  const assigned = await assignedStudentIds(client, actor.userId, actor.organisationId!);
  if (assigned.has(studentProfileId)) return;
  notFound();
}

export async function assertCanRecordStudentBehaviour(
  client: pg.PoolClient,
  actor: Actor,
  studentProfileId: string,
): Promise<void> {
  if (!canRecordBehaviour(actor) && !canRecordPositiveBehaviour(actor)) {
    notFound();
  }
  // School-wide read must not expand write scope. Only manage may record
  // for pupils outside the actor's assigned classes.
  if (canManageBehaviour(actor)) {
    return;
  }
  const assigned = await assignedStudentIds(client, actor.userId, actor.organisationId!);
  if (assigned.has(studentProfileId)) return;
  notFound();
}

export async function assertCanReadStudentPastoral(
  client: pg.PoolClient,
  actor: Actor,
  studentProfileId: string,
): Promise<void> {
  if (!canAccessPastoral(actor)) {
    notFound();
  }
  if (canReadSchoolPastoral(actor) || canManagePastoral(actor)) {
    return;
  }
  const assigned = await assignedStudentIds(client, actor.userId, actor.organisationId!);
  if (assigned.has(studentProfileId)) return;
  notFound();
}

export async function requireStudentInOrganisation(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
): Promise<void> {
  const result = await client.query(
    "select 1 from student_profiles where id = $1 and organisation_id = $2",
    [studentProfileId, organisationId],
  );
  if (!result.rows[0]) {
    notFound();
  }
}

export async function requireStaffUserInOrganisation(
  client: pg.PoolClient,
  organisationId: string,
  userId: string,
): Promise<void> {
  const result = await client.query(
    `select 1
     from organisation_memberships m
     join users u on u.id = m.user_id
     where m.organisation_id = $1
       and m.user_id = $2
       and m.status = 'active'
       and m.ended_at is null
       and u.user_kind = 'staff'`,
    [organisationId, userId],
  );
  if (!result.rows[0]) {
    notFound();
  }
}

export async function requireCategoryInOrganisation(
  client: pg.PoolClient,
  table:
    | "behaviour_incident_categories"
    | "behaviour_action_categories"
    | "positive_behaviour_categories"
    | "behaviour_locations"
    | "pastoral_concern_categories"
    | "safeguarding_concern_categories",
  organisationId: string,
  categoryId: string,
): Promise<void> {
  const result = await client.query(
    `select 1 from ${table} where id = $1 and organisation_id = $2 and is_active = true`,
    [categoryId, organisationId],
  );
  if (!result.rows[0]) {
    notFound();
  }
}

export async function requireClassInOrganisation(
  client: pg.PoolClient,
  organisationId: string,
  classId: string,
): Promise<void> {
  const result = await client.query("select 1 from classes where id = $1 and organisation_id = $2", [
    classId,
    organisationId,
  ]);
  if (!result.rows[0]) {
    notFound();
  }
}

export async function auditBehaviour(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    studentProfileId: string;
    status?: string;
    categoryId?: string | null;
    severity?: string | null;
  },
): Promise<void> {
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    after: auditSafeBehaviourAfter({
      id: input.entityId,
      studentProfileId: input.studentProfileId,
      status: input.status,
      categoryId: input.categoryId,
      severity: input.severity,
    }),
  });
}

export async function auditSafeguarding(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    studentProfileId: string;
    status?: string;
    categoryId?: string | null;
    assignedUserId?: string | null;
  },
): Promise<void> {
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    after: auditSafeSafeguardingAfter({
      id: input.entityId,
      studentProfileId: input.studentProfileId,
      status: input.status,
      categoryId: input.categoryId,
      assignedUserId: input.assignedUserId,
    }),
  });
}

export async function notifyPastoralAssigned(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    recipientUserId: string;
    concernId: string;
  },
): Promise<void> {
  if (input.recipientUserId === input.actorUserId) return;
  await createInboxNotification(client, {
    organisationId: input.organisationId,
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId,
    type: "pastoral_assigned",
    category: "pastoral",
    title: "Pastoral item assigned",
    body: pastoralNotificationBody("assigned"),
    actionTarget: { kind: "pastoral_concern", id: input.concernId },
    idempotencyKey: `pastoral-assigned:${input.concernId}:${input.recipientUserId}`,
  });
}

export async function notifySafeguardingAssigned(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    recipientUserId: string;
    concernId: string;
  },
): Promise<void> {
  if (input.recipientUserId === input.actorUserId) return;
  await createInboxNotification(client, {
    organisationId: input.organisationId,
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId,
    type: "safeguarding_assigned",
    category: "safeguarding",
    title: "Safeguarding item assigned",
    body: safeguardingNotificationBody("assigned"),
    actionTarget: { kind: "safeguarding_concern", id: input.concernId },
    idempotencyKey: `safeguarding-assigned:${input.concernId}:${input.recipientUserId}`,
  });
}

export async function notifyFollowUpDue(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    recipientUserId: string;
    kind: "behaviour" | "pastoral" | "safeguarding";
    entityId: string;
  },
): Promise<void> {
  if (input.recipientUserId === input.actorUserId) return;
  const isSafeguarding = input.kind === "safeguarding";
  await createInboxNotification(client, {
    organisationId: input.organisationId,
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId,
    type: isSafeguarding ? "safeguarding_assigned" : input.kind === "pastoral" ? "pastoral_follow_up" : "behaviour_follow_up",
    category: input.kind,
    title: isSafeguarding ? "Safeguarding follow-up due" : "Follow-up due",
    body: isSafeguarding
      ? safeguardingNotificationBody("follow_up")
      : input.kind === "pastoral"
        ? pastoralNotificationBody("follow_up")
        : behaviourNotificationBody(),
    actionTarget: { kind: input.kind, id: input.entityId },
    idempotencyKey: `follow-up:${input.kind}:${input.entityId}:${input.recipientUserId}`,
  });
}
