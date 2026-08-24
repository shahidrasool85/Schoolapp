import { z } from "zod";
import { PERMISSIONS, STUDENT_DOCUMENT_TYPES, STUDENT_DOCUMENT_VISIBILITIES } from "@schoolapp/domain";
import {
  AppError,
  assertPermission,
  canReadStudentProfile,
  requireLinkedChild,
  requireStudentPortalEnabled,
  studentDocumentVisibleToAudience,
  writeAudit,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import { mapStudentDocument } from "../serialize";
import {
  insertPendingObject,
  publicFileDto,
  putAndActivateObject,
  readUploadedFile,
  scannerOf,
  storageOf,
  storageErrorToAppError,
  validateBytes,
  runUpload,
} from "../file-service";

const createSchema = z.object({
  studentProfileId: z.string().uuid(),
  title: z.string().min(1).max(200),
  documentType: z.enum(STUDENT_DOCUMENT_TYPES),
  visibility: z.enum(STUDENT_DOCUMENT_VISIBILITIES).default("staff"),
  contentType: z.string().max(120).optional(),
  filename: z.string().max(120).optional(),
});

const DOCUMENT_SELECT = `
  select d.id, d.student_profile_id, d.title, d.document_type, d.storage_backend, d.storage_key,
         d.content_type, d.byte_size, d.visibility, d.created_at, d.original_filename,
         d.stored_object_id, o.status as file_status, o.scan_status, o.byte_size as object_byte_size,
         o.content_type as object_content_type, o.original_filename as object_filename
  from student_documents d
  left join stored_objects o on o.id = d.stored_object_id
`;

function serializeStaffDocument(row: Record<string, unknown>) {
  return {
    ...mapStudentDocument(row),
    storageKey: null,
    originalFilename: row.object_filename ?? row.original_filename ?? null,
    byteSize: row.object_byte_size ?? row.byte_size ?? null,
    contentType: row.object_content_type ?? row.content_type ?? null,
    fileStatus: row.file_status ?? null,
    scanStatus: row.scan_status ?? null,
    downloadPath: row.stored_object_id && row.file_status === "active" ? `/api/v1/files/${row.stored_object_id}` : null,
    binaryUploadAvailable: true,
  };
}

export function registerDocumentRoutes(app: SchoolappApi) {
  app.get("/students/:id/documents", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const studentId = uuidRouteParam(c, "id");
      const allowed = await canReadStudentProfile(client, userId, orgId, studentId, actor.permissions);
      if (!allowed) throw new AppError(404, "not_found", "Not found");
      const canReadStaffDocs = actor.permissions.has(PERMISSIONS.STUDENTS_DOCUMENTS_READ);
      if (!canReadStaffDocs && !actor.permissions.has(PERMISSIONS.STUDENTS_DOCUMENTS_MANAGE)) {
        throw new AppError(404, "not_found", "Not found");
      }
      const rows = await client.query(
        `${DOCUMENT_SELECT}
         where d.organisation_id = $1 and d.student_profile_id = $2 and d.deleted_at is null
         order by d.created_at desc`,
        [orgId, studentId],
      );
      return c.json({
        documents: rows.rows.map((row) => serializeStaffDocument(row as Record<string, unknown>)),
        binaryUploadAvailable: storageOf(c).isConfigured(),
      });
    }),
  );

  app.post("/students/:id/documents", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_DOCUMENTS_MANAGE);
      const studentId = uuidRouteParam(c, "id");
      const student = await client.query(
        `select id from student_profiles where id = $1 and organisation_id = $2`,
        [studentId, orgId],
      );
      if (!student.rows[0]) throw new AppError(404, "not_found", "Not found");

      const contentType = c.req.header("content-type") ?? "";
      if (contentType.includes("multipart/form-data")) {
        try {
          const upload = await readUploadedFile(c);
          const validated = validateBytes({
            filename: upload.filename,
            mime: upload.mime,
            bytes: upload.bytes,
            domain: "student_document",
          });
          const visibility = STUDENT_DOCUMENT_VISIBILITIES.includes(upload.fields.visibility as never)
            ? upload.fields.visibility
            : "staff";
          const documentType = STUDENT_DOCUMENT_TYPES.includes(upload.fields.documentType as never)
            ? upload.fields.documentType
            : "other";
          const title = (upload.fields.title ?? validated.originalFilename).slice(0, 200);
          return runUpload(storageOf(c), async (track) => {
          const pending = await insertPendingObject(client, {
            organisationId: orgId,
            domain: "student_document",
            ownerRecordId: studentId,
            storage: storageOf(c),
            validated,
            uploadedBy: userId,
          });
          track(pending.storageKey);
          const inserted = await client.query(
            `insert into student_documents (
               organisation_id, student_profile_id, title, document_type, visibility,
               content_type, byte_size, storage_backend, storage_key, stored_object_id,
               original_filename, checksum_sha256, created_by
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             returning id`,
            [
              orgId,
              studentId,
              title,
              documentType,
              visibility,
              validated.storedContentType,
              validated.byteSize,
              storageOf(c).backend,
              pending.storageKey,
              pending.id,
              validated.originalFilename,
              null,
              userId,
            ],
          );
          const activated = await putAndActivateObject(client, storageOf(c), scannerOf(c), {
            organisationId: orgId,
            objectId: pending.id,
            storageKey: pending.storageKey,
            bytes: upload.bytes,
            contentType: validated.storedContentType,
            filename: validated.originalFilename,
            actorUserId: userId,
            domain: "student_document",
          });
          await client.query(
            `update student_documents set checksum_sha256 = $2 where id = $1 and organisation_id = $3`,
            [inserted.rows[0]!.id, activated.checksumSha256, orgId],
          );
          await writeAudit(client, {
            organisationId: orgId,
            actorUserId: userId,
            action: "student.document.created",
            entityType: "student_document",
            entityId: String(inserted.rows[0]!.id),
            after: { title, visibility, storedObjectId: pending.id },
          });
          const row = await client.query(`${DOCUMENT_SELECT} where d.id = $1 and d.organisation_id = $2`, [
            inserted.rows[0]!.id,
            orgId,
          ]);
          return c.json(
            {
              document: serializeStaffDocument(row.rows[0] as Record<string, unknown>),
              binaryUploadAvailable: true,
            },
            201,
          );
          });
        } catch (error) {
          throw storageErrorToAppError(error);
        }
      }

      const parsed = createSchema.omit({ studentProfileId: true }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid document payload");
      const inserted = await client.query(
        `insert into student_documents (
           organisation_id, student_profile_id, title, document_type, visibility,
           content_type, original_filename, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id, student_profile_id, title, document_type, storage_backend, storage_key,
                   content_type, byte_size, visibility, created_at, original_filename, stored_object_id`,
        [
          orgId,
          studentId,
          parsed.data.title,
          parsed.data.documentType,
          parsed.data.visibility,
          parsed.data.contentType ?? null,
          parsed.data.filename ?? null,
          userId,
        ],
      );
      const row = inserted.rows[0]!;
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "student.document.created",
        entityType: "student_document",
        entityId: String(row.id),
        after: { title: parsed.data.title, visibility: parsed.data.visibility },
      });
      return c.json(
        {
          document: serializeStaffDocument(row as Record<string, unknown>),
          binaryUploadAvailable: storageOf(c).isConfigured(),
        },
        201,
      );
    }),
  );

  app.delete("/students/:id/documents/:documentId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_DOCUMENTS_MANAGE);
      const studentId = uuidRouteParam(c, "id");
      const documentId = uuidRouteParam(c, "documentId");
      const existing = await client.query<{ stored_object_id: string | null }>(
        `select stored_object_id from student_documents
         where id = $1 and student_profile_id = $2 and organisation_id = $3 and deleted_at is null`,
        [documentId, studentId, orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      await client.query(
        `update student_documents set deleted_at = now()
         where id = $1 and organisation_id = $2`,
        [documentId, orgId],
      );
      if (existing.rows[0].stored_object_id) {
        await client.query(
          `update stored_objects set status = 'deleted', deleted_at = now()
           where id = $1 and organisation_id = $2`,
          [existing.rows[0].stored_object_id, orgId],
        );
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "student.document.deleted",
        entityType: "student_document",
        entityId: documentId,
        after: { storedObjectId: existing.rows[0].stored_object_id },
      });
      return c.json({ ok: true });
    }),
  );

  app.get("/parent/children/:studentId/documents", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_DOCUMENTS_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const rows = await client.query(
        `${DOCUMENT_SELECT}
         where d.organisation_id = $1 and d.student_profile_id = $2 and d.deleted_at is null`,
        [orgId, studentId],
      );
      return c.json({
        documents: rows.rows
          .filter((row) => studentDocumentVisibleToAudience(String(row.visibility), "parent"))
          .map((row) => ({
            ...publicFileDto(row as Record<string, unknown>),
            title: row.title,
            documentType: row.document_type,
            visibility: row.visibility,
            storageKey: null,
            downloadPath:
              row.stored_object_id && row.file_status === "active" ? `/api/v1/files/${row.stored_object_id}` : null,
          })),
      });
    }),
  );

  app.get("/student/documents", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_DOCUMENTS_READ_SELF);
      const studentId = await requireStudentPortalEnabled(client, orgId, userId);
      const rows = await client.query(
        `${DOCUMENT_SELECT}
         where d.organisation_id = $1 and d.student_profile_id = $2 and d.deleted_at is null`,
        [orgId, studentId],
      );
      return c.json({
        documents: rows.rows
          .filter((row) => studentDocumentVisibleToAudience(String(row.visibility), "student"))
          .map((row) => ({
            ...publicFileDto(row as Record<string, unknown>),
            title: row.title,
            documentType: row.document_type,
            storageKey: null,
            downloadPath:
              row.stored_object_id && row.file_status === "active" ? `/api/v1/files/${row.stored_object_id}` : null,
          })),
      });
    }),
  );
}
