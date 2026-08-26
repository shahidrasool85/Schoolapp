import { z } from "zod";
import {
  AppError,
  assertCanManagePupilAdditionalNeeds,
  auditSafeDietaryAfter,
  auditSafeMedicationAfter,
  isoDate,
  mapDietaryRecord,
  mapDietaryRevision,
  mapMedicationRecord,
  mapMedicationRevision,
  requireLinkedChild,
  resolveDietaryView,
  resolveMedicationView,
  writeAudit,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";

const optionalDate = z
  .union([z.string().date(), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" || value === undefined ? null : value));

const optionalText = (max: number) =>
  z
    .union([z.string().max(max), z.null()])
    .optional()
    .transform((value) => {
      if (value == null) return null;
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    });

const medicationCreateSchema = z.object({
  medicationName: z.string().trim().min(1).max(200),
  dosage: optionalText(200),
  route: z.enum(["oral", "inhaled", "topical", "injection", "buccal", "other"]).default("other"),
  scheduleText: optionalText(500),
  isPrn: z.boolean().optional(),
  startedOn: optionalDate,
  endedOn: optionalDate,
  instructions: optionalText(4000),
  administrationResponsibility: z
    .enum(["school_staff", "parent", "pupil", "shared", "other"])
    .default("school_staff"),
  parentConsentStatus: z.enum(["pending", "granted", "declined", "not_required"]).default("pending"),
  parentConsentOn: optionalDate,
  reviewOn: optionalDate,
  status: z.enum(["active", "stopped"]).default("active"),
  stoppedReason: optionalText(500),
  internalNotes: optionalText(4000),
  parentVisible: z.boolean().optional(),
});

const medicationPatchSchema = medicationCreateSchema.partial();

const medicationStopSchema = z.object({
  endedOn: optionalDate,
  stoppedReason: optionalText(500),
});

const dietaryCreateSchema = z.object({
  requirementType: z
    .enum(["allergy", "intolerance", "religious", "cultural", "medical", "preference", "texture", "other"])
    .default("other"),
  requirement: z.string().trim().min(1).max(200),
  foodsToAvoid: optionalText(2000),
  safeAlternatives: optionalText(2000),
  isReligiousOrCultural: z.boolean().optional(),
  relatedAllergy: optionalText(500),
  textureFeedingNotes: optionalText(2000),
  parentConfirmedOn: optionalDate,
  reviewOn: optionalDate,
  status: z.enum(["active", "inactive"]).default("active"),
  endedOn: optionalDate,
  internalNotes: optionalText(4000),
  parentVisible: z.boolean().optional(),
});

const dietaryPatchSchema = dietaryCreateSchema.partial();

const dietaryStopSchema = z.object({
  endedOn: optionalDate,
});

const MEDICATION_SELECT = `
  id, student_profile_id, medication_name, dosage, route, schedule_text, is_prn,
  started_on::text, ended_on::text, instructions, administration_responsibility,
  parent_consent_status, parent_consent_on::text, review_on::text, status, stopped_reason,
  parent_visible, internal_notes, created_at, updated_at, created_by, updated_by
`;

const DIETARY_SELECT = `
  id, student_profile_id, requirement_type, requirement, foods_to_avoid, safe_alternatives,
  is_religious_or_cultural, related_allergy, texture_feeding_notes, parent_confirmed_on::text,
  review_on::text, status, ended_on::text, parent_visible, internal_notes,
  created_at, updated_at, created_by, updated_by
`;

async function loadMedicationRevisions(
  client: Parameters<typeof writeAudit>[0],
  organisationId: string,
  medicationId: string,
) {
  const rows = await client.query<{
    id: string;
    change_kind: string;
    changed_fields: string[];
    previous_data: Record<string, unknown>;
    created_at: string;
    actor_user_id: string | null;
  }>(
    `select id, change_kind, changed_fields, previous_data, created_at, actor_user_id
     from student_medication_revisions
     where organisation_id = $1 and medication_id = $2
     order by created_at`,
    [organisationId, medicationId],
  );
  return rows.rows;
}

async function loadDietaryRevisions(
  client: Parameters<typeof writeAudit>[0],
  organisationId: string,
  dietaryId: string,
) {
  const rows = await client.query<{
    id: string;
    change_kind: string;
    changed_fields: string[];
    previous_data: Record<string, unknown>;
    created_at: string;
    actor_user_id: string | null;
  }>(
    `select id, change_kind, changed_fields, previous_data, created_at, actor_user_id
     from student_dietary_requirement_revisions
     where organisation_id = $1 and dietary_requirement_id = $2
     order by created_at`,
    [organisationId, dietaryId],
  );
  return rows.rows;
}

export function registerAdditionalNeedsRoutes(app: SchoolappApi) {
  app.get("/students/:id/medications", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const studentId = uuidRouteParam(c, "id");
      const view = await resolveMedicationView(client, actor, orgId, studentId);
      if (!view) throw new AppError(404, "not_found", "Not found");
      const rows = await client.query(
        `select ${MEDICATION_SELECT}
         from student_medications
         where organisation_id = $1 and student_profile_id = $2
           and ($3::text <> 'parent' or parent_visible = true)
         order by case when status = 'active' then 0 else 1 end, started_on desc nulls last, created_at desc`,
        [orgId, studentId, view],
      );
      const medications = [];
      for (const row of rows.rows) {
        const revisions =
          view === "full" ? await loadMedicationRevisions(client, orgId, row.id as string) : [];
        medications.push(
          mapMedicationRecord(row as never, view, revisions.map((rev) => mapMedicationRevision(rev, view))),
        );
      }
      return c.json({ view, medications });
    }),
  );

  app.post("/students/:id/medications", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const studentId = uuidRouteParam(c, "id");
      await assertCanManagePupilAdditionalNeeds(client, actor, orgId, studentId);
      const parsed = medicationCreateSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid medication payload");
      }
      const data = parsed.data;
      const status = data.status ?? "active";
      const endedOn = status === "stopped" ? (data.endedOn ?? isoDate()) : data.endedOn;
      const inserted = await client.query(
        `insert into student_medications (
           organisation_id, student_profile_id, medication_name, dosage, route, schedule_text,
           is_prn, started_on, ended_on, instructions, administration_responsibility,
           parent_consent_status, parent_consent_on, review_on, status, stopped_reason,
           internal_notes, parent_visible
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
         ) returning ${MEDICATION_SELECT}`,
        [
          orgId,
          studentId,
          data.medicationName,
          data.dosage ?? null,
          data.route,
          data.scheduleText ?? null,
          data.isPrn ?? false,
          data.startedOn,
          endedOn,
          data.instructions ?? null,
          data.administrationResponsibility,
          data.parentConsentStatus,
          data.parentConsentOn,
          data.reviewOn,
          status,
          data.stoppedReason ?? null,
          data.internalNotes ?? null,
          data.parentVisible ?? true,
        ],
      );
      const row = inserted.rows[0]!;
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "medication.created",
        entityType: "student_medication",
        entityId: row.id as string,
        after: auditSafeMedicationAfter({
          action: "created",
          id: row.id as string,
          studentProfileId: studentId,
          status: row.status as string,
          isPrn: row.is_prn as boolean,
          parentVisible: row.parent_visible as boolean,
        }),
      });
      return c.json({ medication: mapMedicationRecord(row as never, "full") }, 201);
    }),
  );

  app.patch("/students/:id/medications/:medicationId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const studentId = uuidRouteParam(c, "id");
      const medicationId = uuidRouteParam(c, "medicationId");
      await assertCanManagePupilAdditionalNeeds(client, actor, orgId, studentId);
      const parsed = medicationPatchSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid medication payload");
      }
      const current = await client.query(
        `select ${MEDICATION_SELECT} from student_medications
         where id = $1 and student_profile_id = $2 and organisation_id = $3`,
        [medicationId, studentId, orgId],
      );
      if (!current.rows[0]) throw new AppError(404, "not_found", "Not found");
      const existing = current.rows[0];
      const data = parsed.data;
      const nextStatus = data.status ?? (existing.status as string);
      const endedOn =
        nextStatus === "stopped"
          ? (data.endedOn !== undefined ? data.endedOn : ((existing.ended_on as string | null) ?? isoDate()))
          : data.endedOn !== undefined
            ? data.endedOn
            : (existing.ended_on as string | null);
      const updated = await client.query(
        `update student_medications set
           medication_name = coalesce($4, medication_name),
           dosage = case when $5::boolean then $6 else dosage end,
           route = coalesce($7, route),
           schedule_text = case when $8::boolean then $9 else schedule_text end,
           is_prn = coalesce($10, is_prn),
           started_on = case when $11::boolean then $12 else started_on end,
           ended_on = $13,
           instructions = case when $14::boolean then $15 else instructions end,
           administration_responsibility = coalesce($16, administration_responsibility),
           parent_consent_status = coalesce($17, parent_consent_status),
           parent_consent_on = case when $18::boolean then $19 else parent_consent_on end,
           review_on = case when $20::boolean then $21 else review_on end,
           status = $22,
           stopped_reason = case when $23::boolean then $24 else stopped_reason end,
           internal_notes = case when $25::boolean then $26 else internal_notes end,
           parent_visible = coalesce($27, parent_visible)
         where id = $1 and student_profile_id = $2 and organisation_id = $3
         returning ${MEDICATION_SELECT}`,
        [
          medicationId,
          studentId,
          orgId,
          data.medicationName ?? null,
          data.dosage !== undefined,
          data.dosage ?? null,
          data.route ?? null,
          data.scheduleText !== undefined,
          data.scheduleText ?? null,
          data.isPrn ?? null,
          data.startedOn !== undefined,
          data.startedOn,
          endedOn,
          data.instructions !== undefined,
          data.instructions ?? null,
          data.administrationResponsibility ?? null,
          data.parentConsentStatus ?? null,
          data.parentConsentOn !== undefined,
          data.parentConsentOn,
          data.reviewOn !== undefined,
          data.reviewOn,
          nextStatus,
          data.stoppedReason !== undefined,
          data.stoppedReason ?? null,
          data.internalNotes !== undefined,
          data.internalNotes ?? null,
          data.parentVisible ?? null,
        ],
      );
      const row = updated.rows[0]!;
      const revisions = await loadMedicationRevisions(client, orgId, medicationId);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "medication.updated",
        entityType: "student_medication",
        entityId: medicationId,
        before: auditSafeMedicationAfter({
          action: "updated",
          id: medicationId,
          studentProfileId: studentId,
          status: existing.status as string,
          isPrn: existing.is_prn as boolean,
          parentVisible: existing.parent_visible as boolean,
        }),
        after: auditSafeMedicationAfter({
          action: "updated",
          id: medicationId,
          studentProfileId: studentId,
          status: row.status as string,
          isPrn: row.is_prn as boolean,
          parentVisible: row.parent_visible as boolean,
        }),
      });
      return c.json({
        medication: mapMedicationRecord(
          row as never,
          "full",
          revisions.map((rev) => mapMedicationRevision(rev, "full")),
        ),
      });
    }),
  );

  app.post("/students/:id/medications/:medicationId/stop", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const studentId = uuidRouteParam(c, "id");
      const medicationId = uuidRouteParam(c, "medicationId");
      await assertCanManagePupilAdditionalNeeds(client, actor, orgId, studentId);
      const parsed = medicationStopSchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid stop payload");
      }
      const current = await client.query(
        `select ${MEDICATION_SELECT} from student_medications
         where id = $1 and student_profile_id = $2 and organisation_id = $3`,
        [medicationId, studentId, orgId],
      );
      if (!current.rows[0]) throw new AppError(404, "not_found", "Not found");
      const updated = await client.query(
        `update student_medications
         set status = 'stopped',
             ended_on = coalesce($4::date, ended_on, current_date),
             stopped_reason = coalesce($5, stopped_reason)
         where id = $1 and student_profile_id = $2 and organisation_id = $3
         returning ${MEDICATION_SELECT}`,
        [medicationId, studentId, orgId, parsed.data.endedOn, parsed.data.stoppedReason ?? null],
      );
      const row = updated.rows[0]!;
      const revisions = await loadMedicationRevisions(client, orgId, medicationId);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "medication.stopped",
        entityType: "student_medication",
        entityId: medicationId,
        after: auditSafeMedicationAfter({
          action: "stopped",
          id: medicationId,
          studentProfileId: studentId,
          status: "stopped",
          isPrn: row.is_prn as boolean,
          parentVisible: row.parent_visible as boolean,
        }),
      });
      return c.json({
        medication: mapMedicationRecord(
          row as never,
          "full",
          revisions.map((rev) => mapMedicationRevision(rev, "full")),
        ),
      });
    }),
  );

  app.get("/students/:id/dietary-requirements", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const studentId = uuidRouteParam(c, "id");
      const view = await resolveDietaryView(client, actor, orgId, studentId);
      if (!view) throw new AppError(404, "not_found", "Not found");
      const rows = await client.query(
        `select ${DIETARY_SELECT}
         from student_dietary_requirements
         where organisation_id = $1 and student_profile_id = $2
           and ($3::text <> 'parent' or parent_visible = true)
         order by case when status = 'active' then 0 else 1 end, created_at desc`,
        [orgId, studentId, view],
      );
      const dietaryRequirements = [];
      for (const row of rows.rows) {
        const revisions =
          view === "full" ? await loadDietaryRevisions(client, orgId, row.id as string) : [];
        dietaryRequirements.push(
          mapDietaryRecord(row as never, view, revisions.map((rev) => mapDietaryRevision(rev, view))),
        );
      }
      return c.json({ view, dietaryRequirements });
    }),
  );

  app.post("/students/:id/dietary-requirements", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const studentId = uuidRouteParam(c, "id");
      await assertCanManagePupilAdditionalNeeds(client, actor, orgId, studentId);
      const parsed = dietaryCreateSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid dietary requirement payload");
      }
      const data = parsed.data;
      const status = data.status ?? "active";
      const endedOn = status === "inactive" ? (data.endedOn ?? isoDate()) : data.endedOn;
      const inserted = await client.query(
        `insert into student_dietary_requirements (
           organisation_id, student_profile_id, requirement_type, requirement, foods_to_avoid,
           safe_alternatives, is_religious_or_cultural, related_allergy, texture_feeding_notes,
           parent_confirmed_on, review_on, status, ended_on, internal_notes, parent_visible
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
         ) returning ${DIETARY_SELECT}`,
        [
          orgId,
          studentId,
          data.requirementType,
          data.requirement,
          data.foodsToAvoid ?? null,
          data.safeAlternatives ?? null,
          data.isReligiousOrCultural ??
            (data.requirementType === "religious" || data.requirementType === "cultural"),
          data.relatedAllergy ?? null,
          data.textureFeedingNotes ?? null,
          data.parentConfirmedOn,
          data.reviewOn,
          status,
          endedOn,
          data.internalNotes ?? null,
          data.parentVisible ?? true,
        ],
      );
      const row = inserted.rows[0]!;
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "dietary.created",
        entityType: "student_dietary_requirement",
        entityId: row.id as string,
        after: auditSafeDietaryAfter({
          action: "created",
          id: row.id as string,
          studentProfileId: studentId,
          status: row.status as string,
          requirementType: row.requirement_type as string,
          parentVisible: row.parent_visible as boolean,
        }),
      });
      return c.json({ dietaryRequirement: mapDietaryRecord(row as never, "full") }, 201);
    }),
  );

  app.patch("/students/:id/dietary-requirements/:dietaryId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const studentId = uuidRouteParam(c, "id");
      const dietaryId = uuidRouteParam(c, "dietaryId");
      await assertCanManagePupilAdditionalNeeds(client, actor, orgId, studentId);
      const parsed = dietaryPatchSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid dietary requirement payload");
      }
      const current = await client.query(
        `select ${DIETARY_SELECT} from student_dietary_requirements
         where id = $1 and student_profile_id = $2 and organisation_id = $3`,
        [dietaryId, studentId, orgId],
      );
      if (!current.rows[0]) throw new AppError(404, "not_found", "Not found");
      const existing = current.rows[0];
      const data = parsed.data;
      const nextStatus = data.status ?? (existing.status as string);
      const endedOn =
        nextStatus === "inactive"
          ? (data.endedOn !== undefined ? data.endedOn : ((existing.ended_on as string | null) ?? isoDate()))
          : data.endedOn !== undefined
            ? data.endedOn
            : (existing.ended_on as string | null);
      const updated = await client.query(
        `update student_dietary_requirements set
           requirement_type = coalesce($4, requirement_type),
           requirement = coalesce($5, requirement),
           foods_to_avoid = case when $6::boolean then $7 else foods_to_avoid end,
           safe_alternatives = case when $8::boolean then $9 else safe_alternatives end,
           is_religious_or_cultural = coalesce($10, is_religious_or_cultural),
           related_allergy = case when $11::boolean then $12 else related_allergy end,
           texture_feeding_notes = case when $13::boolean then $14 else texture_feeding_notes end,
           parent_confirmed_on = case when $15::boolean then $16 else parent_confirmed_on end,
           review_on = case when $17::boolean then $18 else review_on end,
           status = $19,
           ended_on = $20,
           internal_notes = case when $21::boolean then $22 else internal_notes end,
           parent_visible = coalesce($23, parent_visible)
         where id = $1 and student_profile_id = $2 and organisation_id = $3
         returning ${DIETARY_SELECT}`,
        [
          dietaryId,
          studentId,
          orgId,
          data.requirementType ?? null,
          data.requirement ?? null,
          data.foodsToAvoid !== undefined,
          data.foodsToAvoid ?? null,
          data.safeAlternatives !== undefined,
          data.safeAlternatives ?? null,
          data.isReligiousOrCultural ?? null,
          data.relatedAllergy !== undefined,
          data.relatedAllergy ?? null,
          data.textureFeedingNotes !== undefined,
          data.textureFeedingNotes ?? null,
          data.parentConfirmedOn !== undefined,
          data.parentConfirmedOn,
          data.reviewOn !== undefined,
          data.reviewOn,
          nextStatus,
          endedOn,
          data.internalNotes !== undefined,
          data.internalNotes ?? null,
          data.parentVisible ?? null,
        ],
      );
      const row = updated.rows[0]!;
      const revisions = await loadDietaryRevisions(client, orgId, dietaryId);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "dietary.updated",
        entityType: "student_dietary_requirement",
        entityId: dietaryId,
        before: auditSafeDietaryAfter({
          action: "updated",
          id: dietaryId,
          studentProfileId: studentId,
          status: existing.status as string,
          requirementType: existing.requirement_type as string,
          parentVisible: existing.parent_visible as boolean,
        }),
        after: auditSafeDietaryAfter({
          action: "updated",
          id: dietaryId,
          studentProfileId: studentId,
          status: row.status as string,
          requirementType: row.requirement_type as string,
          parentVisible: row.parent_visible as boolean,
        }),
      });
      return c.json({
        dietaryRequirement: mapDietaryRecord(
          row as never,
          "full",
          revisions.map((rev) => mapDietaryRevision(rev, "full")),
        ),
      });
    }),
  );

  app.post("/students/:id/dietary-requirements/:dietaryId/stop", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const studentId = uuidRouteParam(c, "id");
      const dietaryId = uuidRouteParam(c, "dietaryId");
      await assertCanManagePupilAdditionalNeeds(client, actor, orgId, studentId);
      const parsed = dietaryStopSchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid stop payload");
      }
      const current = await client.query(
        `select ${DIETARY_SELECT} from student_dietary_requirements
         where id = $1 and student_profile_id = $2 and organisation_id = $3`,
        [dietaryId, studentId, orgId],
      );
      if (!current.rows[0]) throw new AppError(404, "not_found", "Not found");
      const updated = await client.query(
        `update student_dietary_requirements
         set status = 'inactive',
             ended_on = coalesce($4::date, ended_on, current_date)
         where id = $1 and student_profile_id = $2 and organisation_id = $3
         returning ${DIETARY_SELECT}`,
        [dietaryId, studentId, orgId, parsed.data.endedOn],
      );
      const row = updated.rows[0]!;
      const revisions = await loadDietaryRevisions(client, orgId, dietaryId);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "dietary.stopped",
        entityType: "student_dietary_requirement",
        entityId: dietaryId,
        after: auditSafeDietaryAfter({
          action: "stopped",
          id: dietaryId,
          studentProfileId: studentId,
          status: "inactive",
          requirementType: row.requirement_type as string,
          parentVisible: row.parent_visible as boolean,
        }),
      });
      return c.json({
        dietaryRequirement: mapDietaryRecord(
          row as never,
          "full",
          revisions.map((rev) => mapDietaryRevision(rev, "full")),
        ),
      });
    }),
  );

  app.get("/parent/children/:studentId/medications", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const view = await resolveMedicationView(client, actor, orgId, studentId);
      if (view !== "parent" && view !== "full") {
        throw new AppError(404, "not_found", "Not found");
      }
      const rows = await client.query(
        `select ${MEDICATION_SELECT}
         from student_medications
         where organisation_id = $1 and student_profile_id = $2 and parent_visible = true
         order by case when status = 'active' then 0 else 1 end, started_on desc nulls last, created_at desc`,
        [orgId, studentId],
      );
      return c.json({
        view: "parent",
        medications: rows.rows.map((row) => mapMedicationRecord(row as never, "parent")),
      });
    }),
  );

  app.get("/parent/children/:studentId/dietary-requirements", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const view = await resolveDietaryView(client, actor, orgId, studentId);
      if (view !== "parent" && view !== "full") {
        throw new AppError(404, "not_found", "Not found");
      }
      const rows = await client.query(
        `select ${DIETARY_SELECT}
         from student_dietary_requirements
         where organisation_id = $1 and student_profile_id = $2 and parent_visible = true
         order by case when status = 'active' then 0 else 1 end, created_at desc`,
        [orgId, studentId],
      );
      return c.json({
        view: "parent",
        dietaryRequirements: rows.rows.map((row) => mapDietaryRecord(row as never, "parent")),
      });
    }),
  );
}
