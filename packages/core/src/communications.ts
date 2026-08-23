import {
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_STATUSES,
  BROADCAST_TARGET_TYPES,
  COMMUNICATION_RELATED_KINDS,
  COMMUNICATION_RESOURCE_KINDS,
  COMMUNICATION_TARGET_TYPES,
  SCHOOL_EVENT_STATUSES,
  SCHOOL_EVENT_TYPE_KEYS,
  type AnnouncementPriority,
  type AnnouncementStatus,
  type CommunicationRelatedKind,
  type CommunicationResourceKind,
  type CommunicationTargetType,
  type SchoolEventStatus,
  type SchoolEventTypeKey,
} from "@schoolapp/domain";

const ANNOUNCEMENT_TRANSITIONS: Record<AnnouncementStatus, readonly AnnouncementStatus[]> = {
  draft: ["scheduled", "published", "archived"],
  scheduled: ["draft", "published", "archived"],
  published: ["expired", "archived"],
  expired: ["archived"],
  archived: [],
};

const EVENT_TRANSITIONS: Record<SchoolEventStatus, readonly SchoolEventStatus[]> = {
  draft: ["scheduled", "published", "cancelled", "archived"],
  scheduled: ["draft", "published", "cancelled", "archived"],
  published: ["cancelled", "archived"],
  cancelled: ["archived"],
  archived: [],
};

export function isAnnouncementStatus(value: string): value is AnnouncementStatus {
  return (ANNOUNCEMENT_STATUSES as readonly string[]).includes(value);
}

export function isAnnouncementPriority(value: string): value is AnnouncementPriority {
  return (ANNOUNCEMENT_PRIORITIES as readonly string[]).includes(value);
}

export type { CommunicationTargetType };

export function isCommunicationTargetType(value: string): value is CommunicationTargetType {
  return (COMMUNICATION_TARGET_TYPES as readonly string[]).includes(value);
}

export function isBroadcastTargetType(value: string): boolean {
  return (BROADCAST_TARGET_TYPES as readonly string[]).includes(value);
}

export function isCommunicationResourceKind(value: string): value is CommunicationResourceKind {
  return (COMMUNICATION_RESOURCE_KINDS as readonly string[]).includes(value);
}

export function isSchoolEventStatus(value: string): value is SchoolEventStatus {
  return (SCHOOL_EVENT_STATUSES as readonly string[]).includes(value);
}

export function isSchoolEventTypeKey(value: string): value is SchoolEventTypeKey {
  return (SCHOOL_EVENT_TYPE_KEYS as readonly string[]).includes(value);
}

export function isCommunicationRelatedKind(value: string): value is CommunicationRelatedKind {
  return (COMMUNICATION_RELATED_KINDS as readonly string[]).includes(value);
}

export function isAnnouncementStatusTransitionAllowed(
  from: AnnouncementStatus,
  to: AnnouncementStatus,
): boolean {
  if (from === to) return true;
  return ANNOUNCEMENT_TRANSITIONS[from].includes(to);
}

export function isEventStatusTransitionAllowed(from: SchoolEventStatus, to: SchoolEventStatus): boolean {
  if (from === to) return true;
  return EVENT_TRANSITIONS[from].includes(to);
}

export function effectiveAnnouncementStatus(
  status: string,
  expiresAt: string | Date | null,
  now = new Date(),
): AnnouncementStatus {
  if (status === "published" && expiresAt && new Date(expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }
  return isAnnouncementStatus(status) ? status : "draft";
}

export function isActiveAnnouncementStatus(status: AnnouncementStatus): boolean {
  return status === "published";
}

export function announcementNeedsActivation(status: string, publishAt: string | Date | null, now = new Date()): boolean {
  return status === "scheduled" && publishAt != null && new Date(publishAt).getTime() <= now.getTime();
}

export function eventNeedsActivation(status: string, publishAt: string | Date | null, now = new Date()): boolean {
  return status === "scheduled" && publishAt != null && new Date(publishAt).getTime() <= now.getTime();
}

export function eventDatesValid(startsAt: string | Date, endsAt: string | Date): boolean {
  return new Date(endsAt).getTime() >= new Date(startsAt).getTime();
}

export function summariseAnnouncementReceipts(input: {
  recipients: number;
  read: number;
  acknowledged: number;
  acknowledgementRequired: boolean;
}): {
  recipients: number;
  read: number;
  unread: number;
  acknowledged: number;
  outstandingAcknowledgements: number;
} {
  const unread = Math.max(0, input.recipients - input.read);
  return {
    recipients: input.recipients,
    read: input.read,
    unread,
    acknowledged: input.acknowledgementRequired ? input.acknowledged : 0,
    outstandingAcknowledgements: input.acknowledgementRequired
      ? Math.max(0, input.recipients - input.acknowledged)
      : 0,
  };
}

export function communicationNotificationBody(
  kind: "published" | "important" | "acknowledgement" | "upcoming",
  title: string,
): string {
  const trimmed = title.trim().slice(0, 80);
  if (kind === "important") return `Important: ${trimmed}`;
  if (kind === "acknowledgement") return `Please acknowledge: ${trimmed}`;
  if (kind === "upcoming") return `Upcoming: ${trimmed}`;
  return trimmed;
}

export function isStaffOnlyTargetType(targetType: CommunicationTargetType): boolean {
  return targetType === "staff" || targetType === "staff_member";
}

export function targetIncludesParents(targetType: CommunicationTargetType): boolean {
  return (
    targetType === "whole_school" ||
    targetType === "parents" ||
    targetType === "year_group" ||
    targetType === "class" ||
    targetType === "student"
  );
}

export function targetIncludesStudents(targetType: CommunicationTargetType): boolean {
  return (
    targetType === "whole_school" ||
    targetType === "students" ||
    targetType === "year_group" ||
    targetType === "class" ||
    targetType === "student"
  );
}

export function targetIncludesStaff(targetType: CommunicationTargetType): boolean {
  return (
    targetType === "whole_school" ||
    targetType === "staff" ||
    targetType === "staff_member" ||
    targetType === "year_group" ||
    targetType === "class"
  );
}

export function buildCommunicationResourceKey(input: {
  organisationId: string;
  kind: "announcement" | "event";
  parentId: string;
  resourceId: string;
  filename: string;
}): string {
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "resource";
  return `org/${input.organisationId}/communications/${input.kind}/${input.parentId}/${input.resourceId}/${safeName}`;
}
