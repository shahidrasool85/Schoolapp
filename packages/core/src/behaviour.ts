import {
  BEHAVIOUR_ACTION_STATUSES,
  BEHAVIOUR_INCIDENT_STATUSES,
  BEHAVIOUR_SEVERITIES,
  PASTORAL_CONCERN_STATUSES,
  PASTORAL_INTERVENTION_TYPES,
  PASTORAL_PRIORITIES,
  PASTORAL_RECORD_ATTACHMENT_PARENT_KINDS,
  SAFEGUARDING_CHRONOLOGY_ENTRY_TYPES,
  SAFEGUARDING_CONCERN_STATUSES,
  type BehaviourActionStatus,
  type BehaviourIncidentStatus,
  type BehaviourSeverity,
  type PastoralConcernStatus,
  type PastoralInterventionType,
  type PastoralPriority,
  type PastoralRecordAttachmentParentKind,
  type SafeguardingChronologyEntryType,
  type SafeguardingConcernStatus,
} from "@schoolapp/domain";

const INCIDENT_TRANSITIONS: Record<BehaviourIncidentStatus, readonly BehaviourIncidentStatus[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: [],
};

const ACTION_TRANSITIONS: Record<BehaviourActionStatus, readonly BehaviourActionStatus[]> = {
  planned: ["in_progress", "completed", "cancelled"],
  in_progress: ["planned", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const PASTORAL_TRANSITIONS: Record<PastoralConcernStatus, readonly PastoralConcernStatus[]> = {
  open: ["monitoring", "resolved", "closed"],
  monitoring: ["open", "resolved", "closed"],
  resolved: ["open", "monitoring", "closed"],
  closed: [],
};

const SAFEGUARDING_TRANSITIONS: Record<
  SafeguardingConcernStatus,
  readonly SafeguardingConcernStatus[]
> = {
  open: ["monitoring", "referred_internal", "closed"],
  monitoring: ["open", "referred_internal", "closed"],
  referred_internal: ["monitoring", "closed"],
  closed: [],
};

export function isBehaviourIncidentStatus(value: string): value is BehaviourIncidentStatus {
  return (BEHAVIOUR_INCIDENT_STATUSES as readonly string[]).includes(value);
}

export function isBehaviourSeverity(value: string): value is BehaviourSeverity {
  return (BEHAVIOUR_SEVERITIES as readonly string[]).includes(value);
}

export function isBehaviourActionStatus(value: string): value is BehaviourActionStatus {
  return (BEHAVIOUR_ACTION_STATUSES as readonly string[]).includes(value);
}

export function isPastoralConcernStatus(value: string): value is PastoralConcernStatus {
  return (PASTORAL_CONCERN_STATUSES as readonly string[]).includes(value);
}

export function isPastoralPriority(value: string): value is PastoralPriority {
  return (PASTORAL_PRIORITIES as readonly string[]).includes(value);
}

export function isPastoralInterventionType(value: string): value is PastoralInterventionType {
  return (PASTORAL_INTERVENTION_TYPES as readonly string[]).includes(value);
}

export function isSafeguardingConcernStatus(value: string): value is SafeguardingConcernStatus {
  return (SAFEGUARDING_CONCERN_STATUSES as readonly string[]).includes(value);
}

export function isSafeguardingChronologyEntryType(
  value: string,
): value is SafeguardingChronologyEntryType {
  return (SAFEGUARDING_CHRONOLOGY_ENTRY_TYPES as readonly string[]).includes(value);
}

export function isPastoralRecordAttachmentParentKind(
  value: string,
): value is PastoralRecordAttachmentParentKind {
  return (PASTORAL_RECORD_ATTACHMENT_PARENT_KINDS as readonly string[]).includes(value);
}

export function isIncidentStatusTransitionAllowed(
  from: BehaviourIncidentStatus,
  to: BehaviourIncidentStatus,
): boolean {
  if (from === to) return true;
  return INCIDENT_TRANSITIONS[from].includes(to);
}

export function isActionStatusTransitionAllowed(
  from: BehaviourActionStatus,
  to: BehaviourActionStatus,
): boolean {
  if (from === to) return true;
  return ACTION_TRANSITIONS[from].includes(to);
}

export function isPastoralStatusTransitionAllowed(
  from: PastoralConcernStatus,
  to: PastoralConcernStatus,
): boolean {
  if (from === to) return true;
  return PASTORAL_TRANSITIONS[from].includes(to);
}

export function isSafeguardingStatusTransitionAllowed(
  from: SafeguardingConcernStatus,
  to: SafeguardingConcernStatus,
): boolean {
  if (from === to) return true;
  return SAFEGUARDING_TRANSITIONS[from].includes(to);
}

export function pastoralNotificationBody(kind: "assigned" | "follow_up"): string {
  if (kind === "assigned") {
    return "A pastoral item has been assigned to you.";
  }
  return "A pastoral follow-up is due.";
}

export function behaviourNotificationBody(): string {
  return "A behaviour follow-up is due.";
}

export function safeguardingNotificationBody(kind: "assigned" | "follow_up"): string {
  if (kind === "assigned") {
    return "A safeguarding item has been assigned to you.";
  }
  return "A safeguarding follow-up is due.";
}

export function auditSafeBehaviourAfter(input: {
  id: string;
  studentProfileId: string;
  status?: string;
  categoryId?: string | null;
  severity?: string | null;
}): Record<string, unknown> {
  return {
    id: input.id,
    studentProfileId: input.studentProfileId,
    status: input.status ?? null,
    categoryId: input.categoryId ?? null,
    severity: input.severity ?? null,
  };
}

export function auditSafeSafeguardingAfter(input: {
  id: string;
  studentProfileId: string;
  status?: string;
  categoryId?: string | null;
  assignedUserId?: string | null;
}): Record<string, unknown> {
  return {
    id: input.id,
    studentProfileId: input.studentProfileId,
    status: input.status ?? null,
    categoryId: input.categoryId ?? null,
    assignedUserId: input.assignedUserId ?? null,
  };
}

export function buildBehaviourAttachmentKey(input: {
  organisationId: string;
  kind: string;
  parentId: string;
  attachmentId: string;
  filename: string;
}): string {
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "attachment";
  const kind = input.kind.replace(/[^a-z0-9_]+/g, "_");
  return `org/${input.organisationId}/pastoral/${kind}/${input.parentId}/${input.attachmentId}/${safeName}`;
}

export function buildSafeguardingAttachmentKey(input: {
  organisationId: string;
  concernId: string;
  attachmentId: string;
  filename: string;
}): string {
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "attachment";
  return `org/${input.organisationId}/safeguarding/${input.concernId}/${input.attachmentId}/${safeName}`;
}
