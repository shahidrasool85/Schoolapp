import type pg from "pg";
import {
  PERMISSIONS,
  allowedApplicationTransitions,
  isApplicationStatusTransitionAllowed,
  type Actor,
  type ApplicationStatus,
  actorHasAny,
} from "@schoolapp/domain";
import { AppError } from "./errors.js";
import { writeAudit } from "./academic.js";

export const ADMISSIONS_READ_PERMISSIONS = [
  PERMISSIONS.ADMISSIONS_READ,
  PERMISSIONS.ADMISSIONS_ENQUIRIES_MANAGE,
  PERMISSIONS.ADMISSIONS_APPLICATIONS_MANAGE,
  PERMISSIONS.ADMISSIONS_OFFERS_MANAGE,
  PERMISSIONS.ADMISSIONS_DECIDE,
  PERMISSIONS.ADMISSIONS_CONVERT,
  PERMISSIONS.ADMISSIONS_FORMS_READ,
  PERMISSIONS.ADMISSIONS_FORMS_MANAGE,
  PERMISSIONS.ADMISSIONS_CAMPAIGNS_READ,
  PERMISSIONS.ADMISSIONS_CAMPAIGNS_MANAGE,
  PERMISSIONS.ADMISSIONS_PUBLIC_SUBMISSIONS_READ,
] as const;

export { allowedApplicationTransitions, isApplicationStatusTransitionAllowed };

const DECIDE_STATUSES = new Set<ApplicationStatus>([
  "waiting_list",
  "offer_pending",
  "offer_made",
  "accepted",
  "rejected",
  "deferred",
]);

const OFFER_DECISION_STATUSES = new Set<ApplicationStatus>([
  "offer_pending",
  "offer_made",
  "accepted",
]);

export function canReadAdmissions(actor: Actor): boolean {
  return actorHasAny(actor, ADMISSIONS_READ_PERMISSIONS);
}

export function canManageEnquiries(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ADMISSIONS_ENQUIRIES_MANAGE);
}

export function canManageApplications(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ADMISSIONS_APPLICATIONS_MANAGE);
}

export function canManageOffers(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.ADMISSIONS_OFFERS_MANAGE) ||
    actor.permissions.has(PERMISSIONS.ADMISSIONS_DECIDE)
  );
}

export function canDecideAdmissions(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ADMISSIONS_DECIDE);
}

export function canConvertAdmissions(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ADMISSIONS_CONVERT);
}

export function canReadAdmissionsForms(actor: Actor): boolean {
  return actorHasAny(actor, [
    PERMISSIONS.ADMISSIONS_FORMS_READ,
    PERMISSIONS.ADMISSIONS_FORMS_MANAGE,
    PERMISSIONS.ADMISSIONS_READ,
  ]);
}

export function canManageAdmissionsForms(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ADMISSIONS_FORMS_MANAGE);
}

export function canReadAdmissionsCampaigns(actor: Actor): boolean {
  return actorHasAny(actor, [
    PERMISSIONS.ADMISSIONS_CAMPAIGNS_READ,
    PERMISSIONS.ADMISSIONS_CAMPAIGNS_MANAGE,
    PERMISSIONS.ADMISSIONS_READ,
  ]);
}

export function canManageAdmissionsCampaigns(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ADMISSIONS_CAMPAIGNS_MANAGE);
}

export function canReadPublicSubmissions(actor: Actor): boolean {
  return actorHasAny(actor, [
    PERMISSIONS.ADMISSIONS_PUBLIC_SUBMISSIONS_READ,
    PERMISSIONS.ADMISSIONS_READ,
    PERMISSIONS.ADMISSIONS_FORMS_MANAGE,
  ]);
}

export function transitionRequiresDecide(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return false;
  return DECIDE_STATUSES.has(to) || (from === "rejected" && to === "under_review");
}

export function assertApplicationStatusTransition(
  actor: Actor,
  from: ApplicationStatus,
  to: ApplicationStatus,
): void {
  if (to === "enrolled") {
    throw new AppError(
      400,
      "validation_failed",
      "Enrolment must use the dedicated conversion endpoint",
    );
  }
  if (!isApplicationStatusTransitionAllowed(from, to)) {
    throw new AppError(409, "invalid_status_transition", "This application status change is not allowed");
  }
  if (transitionRequiresDecide(from, to)) {
    if (canDecideAdmissions(actor)) return;
    if (canManageOffers(actor) && OFFER_DECISION_STATUSES.has(to)) return;
    throw new AppError(403, "forbidden", "Missing permission");
  }
  if (!canManageApplications(actor) && !canDecideAdmissions(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export async function createInboxNotification(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    recipientUserId: string;
    actorUserId: string;
    title: string;
    body: string;
    type?: string;
    category?: string;
    actionTarget?: Record<string, unknown> | null;
    idempotencyKey?: string | null;
  },
): Promise<string | null> {
  const result = await client.query<{ create_inbox_notification: string | null }>(
    `select create_inbox_notification($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [
      input.organisationId,
      input.recipientUserId,
      input.actorUserId,
      input.type ?? "admissions_update",
      input.category ?? "admissions",
      input.title,
      input.body,
      input.actionTarget ? JSON.stringify(input.actionTarget) : null,
      input.idempotencyKey ?? null,
    ],
  );
  return result.rows[0]?.create_inbox_notification ?? null;
}

export async function auditAdmissions(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await writeAudit(client, input);
}
