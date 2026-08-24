import type { Context } from "hono";
import type pg from "pg";
import type { Actor } from "@schoolapp/domain";
import { PERMISSIONS } from "@schoolapp/domain";
import {
  AppError,
  assertCanReadAssignment,
  assertCanReadOrMarkSubmission,
  assertCanReadStudentPastoral,
  canManageApplications,
  canReadAdmissions,
  canReadStudentProfile,
  guardianChildIds,
  notFound,
  requireLinkedChild,
  requireStudentPortalEnabled,
  studentDocumentVisibleToAudience,
  writeAudit,
  fileAnswerDocumentId,
  type FormFieldDefinition,
} from "@schoolapp/core";
import {
  StorageError,
  buildObjectKey,
  contentDispositionFor,
  detectFileKind,
  downloadCacheControl,
  fileLimitsFromEnv,
  fileProfile,
  newObjectId,
  sha256Hex,
  validateUpload,
  type FileProfileName,
  type FileScanner,
  type FileSensitivity,
  type ObjectStoragePort,
  type StoredObjectDomain,
  type ValidatedUpload,
} from "@schoolapp/storage";
import type { ApiEnv } from "./types";

export type StoredObjectRow = {
  id: string;
  organisation_id: string;
  domain: StoredObjectDomain;
  owner_record_id: string;
  storage_backend: string;
  storage_key: string;
  original_filename: string;
  content_type: string;
  byte_size: number;
  checksum_sha256: string | null;
  status: string;
  scan_status: string;
  sensitivity: FileSensitivity;
  uploaded_by: string | null;
  uploaded_at: Date | string | null;
  deleted_at: Date | string | null;
};

export function storageOf(c: Context<ApiEnv>): ObjectStoragePort {
  const storage = c.get("config").storage;
  if (!storage) throw new AppError(503, "storage_unconfigured", "File storage is not configured");
  return storage;
}

export function scannerOf(c: Context<ApiEnv>): FileScanner {
  return c.get("config").fileScanner!;
}

export function storageErrorToAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof StorageError) {
    return new AppError(error.status as 400, error.code, error.message);
  }
  return new AppError(502, "upload_failed", "The file could not be uploaded");
}

export async function readUploadedFile(
  c: Context<ApiEnv>,
  fieldName = "file",
): Promise<{ bytes: Uint8Array; filename: string; mime: string; fields: Record<string, string> }> {
  const maxBytes = Math.max(...Object.values(fileLimitsFromEnv()));
  const rawLength = c.req.header("content-length");
  if (rawLength) {
    const declared = Number(rawLength);
    if (Number.isFinite(declared) && declared > maxBytes + 1024 * 1024) {
      throw new AppError(400, "file_too_large", "This file is too large");
    }
  }
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new AppError(400, "validation_failed", "A file upload is required");
  }
  const file = form.get(fieldName);
  if (!file || typeof file === "string") {
    throw new AppError(400, "validation_failed", "A file upload is required");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fields: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") fields[key] = value;
  });
  return {
    bytes,
    filename: file.name || fields.filename || "document",
    mime: file.type || fields.contentType || "application/octet-stream",
    fields,
  };
}

export function profileForDomain(domain: StoredObjectDomain) {
  const limits = fileLimitsFromEnv();
  const name: FileProfileName =
    domain === "admissions_form" || domain === "admissions_application"
      ? "admissions"
      : domain === "student_document"
        ? "student_document"
        : domain === "learning_resource"
          ? "learning_resource"
          : domain === "learning_submission"
            ? "learning_submission"
            : domain === "pastoral"
              ? "pastoral"
              : "safeguarding";
  return fileProfile(name, limits);
}

export function sensitivityForDomain(domain: StoredObjectDomain): FileSensitivity {
  if (domain === "safeguarding") return "safeguarding";
  if (domain === "pastoral" || domain === "student_document" || domain === "admissions_form" || domain === "admissions_application") {
    return "confidential";
  }
  return "standard";
}

export async function insertPendingObject(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    domain: StoredObjectDomain;
    ownerRecordId: string;
    storage: ObjectStoragePort;
    validated: ValidatedUpload;
    uploadedBy: string | null;
    expiresAt?: Date | null;
  },
): Promise<{ id: string; storageKey: string }> {
  const id = newObjectId();
  const storageKey = buildObjectKey({
    organisationId: input.organisationId,
    domain: input.domain,
    ownerId: input.ownerRecordId,
    objectId: id,
  });
  await client.query(
    `insert into stored_objects (
       id, organisation_id, domain, owner_record_id, storage_backend, storage_key,
       original_filename, content_type, byte_size, status, scan_status, sensitivity,
       uploaded_by, expires_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending','unscanned',$10,$11,$12)`,
    [
      id,
      input.organisationId,
      input.domain,
      input.ownerRecordId,
      input.storage.backend,
      storageKey,
      input.validated.originalFilename,
      input.validated.storedContentType,
      input.validated.byteSize,
      sensitivityForDomain(input.domain),
      input.uploadedBy,
      input.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    ],
  );
  return { id, storageKey };
}

export async function putAndActivateObject(
  client: pg.PoolClient,
  storage: ObjectStoragePort,
  scanner: FileScanner,
  input: {
    organisationId: string;
    objectId: string;
    storageKey: string;
    bytes: Uint8Array;
    contentType: string;
    filename: string;
    actorUserId: string | null;
    domain: StoredObjectDomain;
    audit?: boolean;
  },
): Promise<{ checksumSha256: string; scanStatus: string }> {
  try {
    const put = await storage.putObject({
      key: input.storageKey,
      body: input.bytes,
      contentType: input.contentType,
    });
    const scan = await scanner.scan({
      bytes: input.bytes,
      filename: input.filename,
      contentType: input.contentType,
    });
    if (scan.status === "rejected") {
      await storage.deleteObject(input.storageKey).catch(() => undefined);
      await client.query(
        `update stored_objects set status = 'rejected', scan_status = 'rejected', deleted_at = now()
         where id = $1 and organisation_id = $2`,
        [input.objectId, input.organisationId],
      );
      throw new AppError(400, "unsupported_file_type", "This file type is not allowed");
    }
    await client.query(
      `update stored_objects
          set status = 'active',
              checksum_sha256 = $3,
              byte_size = $4,
              scan_status = $5,
              uploaded_at = now(),
              expires_at = null
        where id = $1 and organisation_id = $2`,
      [input.objectId, input.organisationId, put.checksumSha256, put.byteSize, scan.status],
    );
    if (input.audit !== false) {
      await writeFileAudit(client, {
        organisationId: input.organisationId,
        actorUserId: input.actorUserId,
        action: "file.upload",
        objectId: input.objectId,
        domain: input.domain,
        filename: input.domain === "safeguarding" ? null : input.filename,
      });
    }
    return { checksumSha256: put.checksumSha256, scanStatus: scan.status };
  } catch (error) {
    await storage.deleteObject(input.storageKey).catch(() => undefined);
    await client.query(
      `update stored_objects set status = 'rejected', deleted_at = now()
       where id = $1 and organisation_id = $2 and status = 'pending'`,
      [input.objectId, input.organisationId],
    );
    throw storageErrorToAppError(error);
  }
}

export async function runUpload<T>(
  storage: ObjectStoragePort,
  fn: (track: (storageKey: string) => void) => Promise<T>,
): Promise<T> {
  let storageKey: string | undefined;
  try {
    return await fn((key) => {
      storageKey = key;
    });
  } catch (error) {
    if (storageKey) await storage.deleteObject(storageKey).catch(() => undefined);
    throw storageErrorToAppError(error);
  }
}

export async function assertPublicFormFileAnswers(
  queryable: { query: pg.Pool["query"] },
  input: {
    organisationId: string;
    tokenHash: string | null | undefined;
    publicId: string | null | undefined;
    answers: Record<string, unknown>;
    fields: FormFieldDefinition[];
    draft: boolean;
  },
): Promise<void> {
  const hasBoundDocument = input.fields.some(
    (field) => field.enabled && field.questionType === "file" && fileAnswerDocumentId(input.answers[field.fieldKey]),
  );
  const requiresUpload =
    !input.draft &&
    input.fields.some((field) => field.enabled && field.required && field.questionType === "file");
  if (!hasBoundDocument && !requiresUpload) return;
  if (!input.tokenHash || !input.publicId) {
    throw new AppError(400, "validation_failed", "A required document has not been uploaded");
  }
  await queryable.query(`select assert_public_form_file_answers($1,$2,$3,$4::jsonb,$5)`, [
    input.organisationId,
    input.tokenHash,
    input.publicId,
    JSON.stringify(input.answers),
    !input.draft,
  ]);
}

export async function loadStoredObject(
  client: pg.PoolClient,
  organisationId: string,
  objectId: string,
): Promise<StoredObjectRow | null> {
  const result = await client.query<StoredObjectRow>(
    `select id, organisation_id, domain, owner_record_id, storage_backend, storage_key,
            original_filename, content_type, byte_size, checksum_sha256, status, scan_status,
            sensitivity, uploaded_by, uploaded_at, deleted_at
     from stored_objects
     where id = $1 and organisation_id = $2`,
    [objectId, organisationId],
  );
  return result.rows[0] ?? null;
}

export async function authorizeStoredObjectDownload(
  client: pg.PoolClient,
  actor: Actor,
  object: StoredObjectRow,
): Promise<void> {
  switch (object.domain) {
    case "student_document": {
      const doc = await client.query<{
        student_profile_id: string;
        visibility: string;
        deleted_at: Date | null;
      }>(
        `select student_profile_id, visibility, deleted_at
         from student_documents where stored_object_id = $1 and organisation_id = $2`,
        [object.id, object.organisation_id],
      );
      const row = doc.rows[0];
      if (!row || row.deleted_at) notFound();
      if (actor.userKind === "parent") {
        await requireLinkedChild(client, actor.userId, object.organisation_id, row.student_profile_id);
        if (!studentDocumentVisibleToAudience(row.visibility, "parent")) notFound();
        return;
      }
      if (actor.userKind === "student") {
        const studentId = await requireStudentPortalEnabled(client, object.organisation_id, actor.userId);
        if (studentId !== row.student_profile_id) notFound();
        if (!studentDocumentVisibleToAudience(row.visibility, "student")) notFound();
        return;
      }
      const allowed = await canReadStudentProfile(
        client,
        actor.userId,
        object.organisation_id,
        row.student_profile_id,
        actor.permissions,
      );
      if (!allowed) notFound();
      if (
        !actor.permissions.has(PERMISSIONS.STUDENTS_DOCUMENTS_READ) &&
        !actor.permissions.has(PERMISSIONS.STUDENTS_DOCUMENTS_MANAGE)
      ) {
        notFound();
      }
      return;
    }
    case "admissions_form":
    case "admissions_application": {
      if (!canReadAdmissions(actor) && !canManageApplications(actor)) notFound();
      return;
    }
    case "learning_resource": {
      const linked = await client.query<{ assignment_id: string }>(
        `select ar.assignment_id
         from learning_resources r
         join learning_assignment_resources ar on ar.resource_id = r.id
         where r.stored_object_id = $1 and r.organisation_id = $2
         limit 1`,
        [object.id, object.organisation_id],
      );
      const assignmentId = linked.rows[0]?.assignment_id;
      if (!assignmentId) notFound();
      if (actor.userKind === "student") {
        const studentId = await requireStudentPortalEnabled(client, object.organisation_id, actor.userId);
        const recipient = await client.query(
          `select 1 from learning_assignment_recipients
           where assignment_id = $1 and student_profile_id = $2 and organisation_id = $3`,
          [assignmentId, studentId, object.organisation_id],
        );
        if (!recipient.rows[0]) notFound();
        return;
      }
      if (actor.userKind === "parent") {
        const children = await guardianChildIds(client, actor.userId, object.organisation_id);
        const recipient = await client.query<{ student_profile_id: string }>(
          `select student_profile_id from learning_assignment_recipients
           where assignment_id = $1 and organisation_id = $2`,
          [assignmentId, object.organisation_id],
        );
        if (!recipient.rows.some((row) => children.has(row.student_profile_id))) notFound();
        return;
      }
      await assertCanReadAssignment(client, actor, assignmentId);
      return;
    }
    case "learning_submission": {
      const attachment = await client.query<{
        submission_id: string;
        student_profile_id: string;
        assignment_id: string;
      }>(
        `select s.id as submission_id, s.student_profile_id, s.assignment_id
         from learning_submission_attachments a
         join learning_submission_revisions r on r.id = a.revision_id
         join learning_submissions s on s.id = r.submission_id
         where a.stored_object_id = $1 and a.organisation_id = $2
         limit 1`,
        [object.id, object.organisation_id],
      );
      const row = attachment.rows[0];
      if (!row) notFound();
      if (actor.userKind === "student") {
        const studentId = await requireStudentPortalEnabled(client, object.organisation_id, actor.userId);
        if (studentId !== row.student_profile_id) notFound();
        return;
      }
      if (actor.userKind === "parent") notFound();
      await assertCanReadOrMarkSubmission(client, actor, row.student_profile_id, "read", row.assignment_id);
      return;
    }
    case "pastoral": {
      const att = await client.query<{ parent_kind: string; parent_id: string }>(
        `select parent_kind, parent_id from pastoral_record_attachments
         where stored_object_id = $1 and organisation_id = $2 and deleted_at is null`,
        [object.id, object.organisation_id],
      );
      const row = att.rows[0];
      if (!row) notFound();
      const studentId = await pastoralParentStudentId(client, object.organisation_id, row.parent_kind, row.parent_id);
      if (!studentId) notFound();
      await assertCanReadStudentPastoral(client, actor, studentId);
      return;
    }
    case "safeguarding": {
      if (
        !actor.permissions.has(PERMISSIONS.SAFEGUARDING_READ) &&
        !actor.permissions.has(PERMISSIONS.SAFEGUARDING_RECORD) &&
        !actor.permissions.has(PERMISSIONS.SAFEGUARDING_MANAGE) &&
        !actor.permissions.has(PERMISSIONS.SAFEGUARDING_ASSIGN)
      ) {
        notFound();
      }
      return;
    }
    default:
      notFound();
  }
}

async function pastoralParentStudentId(
  client: pg.PoolClient,
  organisationId: string,
  parentKind: string,
  parentId: string,
): Promise<string | null> {
  if (parentKind === "pastoral_concern") {
    const row = await client.query<{ student_profile_id: string }>(
      `select student_profile_id from pastoral_concerns where id = $1 and organisation_id = $2`,
      [parentId, organisationId],
    );
    return row.rows[0]?.student_profile_id ?? null;
  }
  if (parentKind === "pastoral_intervention") {
    const row = await client.query<{ student_profile_id: string }>(
      `select c.student_profile_id
       from pastoral_interventions i
       join pastoral_concerns c on c.id = i.concern_id
       where i.id = $1 and i.organisation_id = $2`,
      [parentId, organisationId],
    );
    return row.rows[0]?.student_profile_id ?? null;
  }
  if (parentKind === "incident") {
    const row = await client.query<{ student_profile_id: string }>(
      `select student_profile_id from behaviour_incidents where id = $1 and organisation_id = $2`,
      [parentId, organisationId],
    );
    return row.rows[0]?.student_profile_id ?? null;
  }
  if (parentKind === "positive") {
    const row = await client.query<{ student_profile_id: string }>(
      `select student_profile_id from positive_behaviour_records where id = $1 and organisation_id = $2`,
      [parentId, organisationId],
    );
    return row.rows[0]?.student_profile_id ?? null;
  }
  if (parentKind === "action") {
    const row = await client.query<{ student_profile_id: string }>(
      `select i.student_profile_id
       from behaviour_actions a
       join behaviour_incidents i on i.id = a.incident_id
       where a.id = $1 and a.organisation_id = $2`,
      [parentId, organisationId],
    );
    return row.rows[0]?.student_profile_id ?? null;
  }
  return null;
}

export async function writeFileAudit(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string | null;
    action: string;
    objectId: string;
    domain: StoredObjectDomain;
    filename?: string | null;
  },
): Promise<void> {
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: "stored_object",
    entityId: input.objectId,
    after: {
      domain: input.domain,
      filename: input.domain === "safeguarding" ? undefined : input.filename ?? undefined,
    },
  });
}

export async function loadObjectBytes(storage: ObjectStoragePort, object: StoredObjectRow) {
  if (object.status !== "active") {
    throw new AppError(404, "file_unavailable", "This file is no longer available");
  }
  const got = await storage.getObject(object.storage_key);
  if (!got) {
    throw new AppError(404, "file_unavailable", "This file is no longer available");
  }
  return got;
}

export function downloadHeaders(object: StoredObjectRow): Record<string, string> {
  const kind = detectFileKind(Buffer.from([]), object.original_filename);
  const declaredKind =
    object.content_type === "application/pdf"
      ? "pdf"
      : object.content_type === "image/jpeg"
        ? "jpeg"
        : object.content_type === "image/png"
          ? "png"
          : object.content_type === "image/webp"
            ? "webp"
            : kind;
  const disposition = contentDispositionFor(
    declaredKind === "unknown" ? "txt" : declaredKind,
    object.original_filename,
  );
  const forceAttachment = object.sensitivity === "safeguarding" || disposition.type === "attachment";
  const header = forceAttachment
    ? contentDispositionFor("txt", object.original_filename).header.replace(/^inline/, "attachment")
    : disposition.header;
  return {
    "Content-Type": object.content_type,
    "Content-Disposition": header,
    "Cache-Control": downloadCacheControl(),
    "X-Content-Type-Options": "nosniff",
  };
}

export function publicFileDto(row: Record<string, unknown>) {
  const storedObjectId = (row.stored_object_id ?? row.storedObjectId ?? null) as string | null;
  return {
    id: String(row.id),
    filename: String(row.original_filename ?? row.originalFilename ?? row.title ?? "document"),
    title: (row.title as string | null) ?? null,
    contentType: (row.content_type ?? row.contentType ?? null) as string | null,
    byteSize: (row.byte_size ?? row.byteSize ?? null) as number | null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    fieldKey: (row.field_key ?? null) as string | null,
    purpose: (row.purpose ?? null) as string | null,
    documentType: (row.document_type ?? null) as string | null,
    visibility: (row.visibility ?? null) as string | null,
    status: (row.status ?? null) as string | null,
    scanStatus: (row.scan_status ?? null) as string | null,
    downloadPath: storedObjectId ? `/api/v1/files/${storedObjectId}` : null,
  };
}

export async function copyRevisionAttachments(
  client: pg.PoolClient,
  organisationId: string,
  fromRevisionId: string | null,
  toRevisionId: string,
): Promise<void> {
  if (!fromRevisionId || fromRevisionId === toRevisionId) return;
  await client.query(
    `insert into learning_submission_attachments (
       organisation_id, revision_id, filename, content_type, byte_size,
       storage_backend, storage_key, stored_object_id, checksum_sha256
     )
     select organisation_id, $3, filename, content_type, byte_size,
            storage_backend, storage_key, stored_object_id, checksum_sha256
     from learning_submission_attachments
     where revision_id = $1 and organisation_id = $2 and deleted_at is null`,
    [fromRevisionId, organisationId, toRevisionId],
  );
}

export function validateBytes(input: {
  filename: string;
  mime: string;
  bytes: Uint8Array;
  domain: StoredObjectDomain;
}): ValidatedUpload {
  return validateUpload({
    filename: input.filename,
    declaredMime: input.mime,
    bytes: input.bytes,
    profile: profileForDomain(input.domain),
  });
}

export { sha256Hex, validateUpload };
