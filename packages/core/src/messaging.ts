import {
  MESSAGE_BODY_MAX_LENGTH,
  MESSAGE_CONVERSATION_STATUSES,
  MESSAGE_CONVERSATION_TYPES,
  MESSAGE_PARENT_CONTACT_POINTS,
  MESSAGE_PARTICIPANT_KINDS,
  MESSAGE_PREVIEW_MAX_LENGTH,
  MESSAGE_REDACTED_PLACEHOLDER,
  MESSAGE_RELATED_DOMAINS,
  MESSAGE_SUBJECT_MAX_LENGTH,
  MESSAGE_TYPES,
  type MessageConversationStatus,
  type MessageConversationType,
  type MessageParentContactPoint,
  type MessageParticipantKind,
  type MessageRelatedDomain,
  type MessageType,
} from "@schoolapp/domain";
import { sanitizePlainText } from "./admissions-forms.js";

export const MESSAGE_BODY_MAX = MESSAGE_BODY_MAX_LENGTH;
export const MESSAGE_SUBJECT_MAX = MESSAGE_SUBJECT_MAX_LENGTH;
export const MESSAGE_PREVIEW_MAX = MESSAGE_PREVIEW_MAX_LENGTH;
export const MESSAGE_REDACTED_BODY = MESSAGE_REDACTED_PLACEHOLDER;

export function isMessageConversationType(value: string): value is MessageConversationType {
  return (MESSAGE_CONVERSATION_TYPES as readonly string[]).includes(value);
}

export function isMessageConversationStatus(value: string): value is MessageConversationStatus {
  return (MESSAGE_CONVERSATION_STATUSES as readonly string[]).includes(value);
}

export function isMessageParticipantKind(value: string): value is MessageParticipantKind {
  return (MESSAGE_PARTICIPANT_KINDS as readonly string[]).includes(value);
}

export function isMessageType(value: string): value is MessageType {
  return (MESSAGE_TYPES as readonly string[]).includes(value);
}

export function isMessageRelatedDomain(value: string): value is MessageRelatedDomain {
  return (MESSAGE_RELATED_DOMAINS as readonly string[]).includes(value);
}

export function isMessageParentContactPoint(value: string): value is MessageParentContactPoint {
  return (MESSAGE_PARENT_CONTACT_POINTS as readonly string[]).includes(value);
}

export function sanitizeMessageSubject(value: unknown): string {
  return sanitizePlainText(value, MESSAGE_SUBJECT_MAX);
}

export function sanitizeMessageBody(value: unknown): string {
  return sanitizePlainText(value, MESSAGE_BODY_MAX);
}

export function messagePreview(body: string, redacted = false): string {
  if (redacted) return MESSAGE_REDACTED_BODY.slice(0, MESSAGE_PREVIEW_MAX);
  const compact = body.replace(/\s+/g, " ").trim();
  if (compact.length <= MESSAGE_PREVIEW_MAX) return compact;
  return `${compact.slice(0, MESSAGE_PREVIEW_MAX - 1).trimEnd()}…`;
}

export function displayMessageBody(input: { body: string; redactedAt: string | Date | null }): string {
  return input.redactedAt ? MESSAGE_REDACTED_BODY : input.body;
}

export function conversationAllowsReplies(input: {
  status: string;
  repliesRestricted: boolean;
}): boolean {
  return input.status === "open" && !input.repliesRestricted;
}

export function messagingNotificationBody(schoolName: string): string {
  const name = sanitizePlainText(schoolName, 80) || "your school";
  return `You have a new message from ${name}.`;
}

export function relatedDomainLabel(domain: string | null | undefined): string | null {
  switch (domain) {
    case "admissions_application":
      return "Admissions";
    case "school_charge":
      return "Payment";
    case "school_activity":
      return "Activity";
    case "learning_assignment":
      return "Assignment";
    case "attendance":
      return "Attendance";
    default:
      return null;
  }
}

export const PARENT_FACING_CONVERSATION_TYPES: readonly MessageConversationType[] = [
  "parent_teacher",
  "parent_school",
  "admissions",
];
