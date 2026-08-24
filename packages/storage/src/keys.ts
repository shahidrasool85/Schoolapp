import { randomUUID } from "node:crypto";
import { StorageError } from "./errors.js";
import type { StoredObjectDomain } from "./types.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DOMAIN_SEGMENTS: Record<StoredObjectDomain, string> = {
  admissions_form: "admissions/forms",
  admissions_application: "admissions/applications",
  student_document: "students/documents",
  learning_resource: "learning/resources",
  learning_submission: "learning/submissions",
  pastoral: "pastoral",
  safeguarding: "safeguarding",
};

export function assertUuid(value: string, label = "id"): string {
  if (!UUID_RE.test(value)) {
    throw new StorageError("invalid_object_key", `Invalid ${label}`);
  }
  return value.toLowerCase();
}

export function assertSafeObjectKey(key: string): string {
  if (!key || key.length > 500) {
    throw new StorageError("invalid_object_key");
  }
  if (key.includes("\\") || key.includes("\0") || key.includes("..")) {
    throw new StorageError("invalid_object_key");
  }
  if (key.startsWith("/") || key.startsWith(".")) {
    throw new StorageError("invalid_object_key");
  }
  if (!/^org\/[0-9a-f-]+\/[a-z0-9/_-]+$/i.test(key)) {
    throw new StorageError("invalid_object_key");
  }
  return key;
}

export function organisationIdFromKey(key: string): string | null {
  const match = /^org\/([0-9a-f-]{36})\//i.exec(key);
  return match?.[1]?.toLowerCase() ?? null;
}

export function buildObjectKey(input: {
  organisationId: string;
  domain: StoredObjectDomain;
  ownerId: string;
  objectId?: string;
}): string {
  const organisationId = assertUuid(input.organisationId, "organisationId");
  const ownerId = assertUuid(input.ownerId, "ownerId");
  const objectId = assertUuid(input.objectId ?? randomUUID(), "objectId");
  const domain = DOMAIN_SEGMENTS[input.domain];
  return `org/${organisationId}/${domain}/${ownerId}/${objectId}`;
}

export function newObjectId(): string {
  return randomUUID();
}
