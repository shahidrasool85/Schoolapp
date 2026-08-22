import { z } from "zod";
import { PERMISSIONS, STUDENT_DOCUMENT_TYPES, STUDENT_DOCUMENT_VISIBILITIES } from "@schoolapp/domain";
import {
  AppError,
  assertPermission,
  canReadStudentProfile,
  requireLinkedChild,
  studentDocumentVisibleToAudience,
  writeAudit,
} from "@schoolapp/core";
import { defaultObjectStorage } from "@schoolapp/storage";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import { mapStudentDocument } from "../serialize";

const createSchema = z.object({
  studentProfileId: z.string().uuid(),
  title: z.string().min(1).max(200),
  documentType: z.enum(STUDENT_DOCUMENT_TYPES),
  visibility: z.enum(STUDENT_DOCUMENT_VISIBILITIES).default("staff"),
  contentType: z.string().max(120).optional(),
  filename: z.string().max(120).optional(),
});

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
        `select id, student_profile_id, title, document_type, storage_backend, storage_key,
                content_type, byte_size, visibility, created_at
         from student_documents
         where organisation_id = $1 and student_profile_id = $2
         order by created_at desc`,
        [orgId, studentId],
      );
      return c.json({
        documents: rows.rows.map(mapStudentDocument),
        binaryUploadAvailable: defaultObjectStorage.isConfigured(),
      });
    }),
  );

  app.post("/students/:id/documents", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_DOCUMENTS_MANAGE);
      const studentId = uuidRouteParam(c, "id");
      const parsed = createSchema.omit({ studentProfileId: true }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid document payload");
      const student = await client.query(
        `select id from student_profiles where id = $1 and organisation_id = $2`,
        [studentId, orgId],
      );
      if (!student.rows[0]) throw new AppError(404, "not_found", "Not found");
      const inserted = await client.query(
        `insert into student_documents (
           organisation_id, student_profile_id, title, document_type, visibility,
           content_type, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7)
         returning id, student_profile_id, title, document_type, storage_backend, storage_key,
                   content_type, byte_size, visibility, created_at`,
        [
          orgId,
          studentId,
          parsed.data.title,
          parsed.data.documentType,
          parsed.data.visibility,
          parsed.data.contentType ?? null,
          userId,
        ],
      );
      const row = inserted.rows[0]!;
      const key = defaultObjectStorage.buildStudentDocumentKey({
        organisationId: orgId,
        studentProfileId: studentId,
        documentId: String(row.id),
        filename: parsed.data.filename ?? "document",
      });
      await client.query(
        `update student_documents set storage_key = $2 where id = $1 and organisation_id = $3`,
        [row.id, key, orgId],
      );
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
          document: mapStudentDocument({ ...row, storage_key: key }),
          binaryUploadAvailable: false,
        },
        201,
      );
    }),
  );

  app.get("/parent/children/:studentId/documents", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_DOCUMENTS_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const rows = await client.query(
        `select id, student_profile_id, title, document_type, storage_backend, storage_key,
                content_type, byte_size, visibility, created_at
         from student_documents
         where organisation_id = $1 and student_profile_id = $2`,
        [orgId, studentId],
      );
      return c.json({
        documents: rows.rows
          .filter((row) => studentDocumentVisibleToAudience(String(row.visibility), "parent"))
          .map((row) => ({ ...mapStudentDocument(row), storageKey: null })),
      });
    }),
  );
}
