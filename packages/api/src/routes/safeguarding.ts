import { z } from "zod";
import type pg from "pg";
import { defaultObjectStorage } from "@schoolapp/storage";
import {
  AppError,
  assertCanAccessSafeguarding,
  auditSafeguarding,
  canAssignSafeguarding,
  canManageSafeguarding,
  canRecordSafeguarding,
  isSafeguardingStatusTransitionAllowed,
  notifyFollowUpDue,
  notifySafeguardingAssigned,
  requireCategoryInOrganisation,
  requireStaffUserInOrganisation,
  requireStudentInOrganisation,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import {
  mapCatalogueItem,
  mapPastoralAttachment,
  mapSafeguardingChronology,
  mapSafeguardingConcern,
} from "../serialize";

const CONCERN_SELECT = `
  select
    s.id, s.student_profile_id, sp.legal_name as student_legal_name,
    s.arose_at, s.category_id, cat.key as category_key, cat.name as category_name,
    s.factual_description, s.immediate_action_taken,
    s.assigned_safeguarding_lead_user_id, lead.full_name as assigned_safeguarding_lead_name,
    s.status, s.follow_up_due_on::text, s.recorded_by, recorder.full_name as recorded_by_name,
    s.recorded_at, se.year_group_id, yg.name as year_group_name
  from safeguarding_concerns s
  join student_profiles sp on sp.id = s.student_profile_id
  join safeguarding_concern_categories cat on cat.id = s.category_id
  left join users lead on lead.id = s.assigned_safeguarding_lead_user_id
  join users recorder on recorder.id = s.recorded_by
  left join academic_years ay on ay.organisation_id = s.organisation_id and ay.is_current
  left join student_enrolments se
    on se.student_profile_id = s.student_profile_id
   and se.academic_year_id = ay.id
   and se.is_primary
   and se.ended_on is null
  left join year_groups yg on yg.id = se.year_group_id
`;

const CHRONOLOGY_SELECT = `
  select
    e.id, e.concern_id, e.occurred_at, e.entry_type, e.factual_note, e.action_outcome,
    e.actor_user_id, actor.full_name as actor_name, e.amendment_of_id, e.superseded, e.recorded_at
  from safeguarding_chronology_entries e
  join users actor on actor.id = e.actor_user_id
`;

async function loadConcern(client: pg.PoolClient, orgId: string, id: string) {
  const result = await client.query(`${CONCERN_SELECT} where s.id = $1 and s.organisation_id = $2`, [id, orgId]);
  if (!result.rows[0]) throw new AppError(404, "not_found", "Not found");
  return result.rows[0] as Record<string, unknown>;
}

export function registerSafeguardingRoutes(app: SchoolappApi) {
  app.get("/safeguarding/categories", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertCanAccessSafeguarding(actor);
      const result = await client.query(
        "select * from safeguarding_concern_categories where organisation_id = $1 order by sort_order, name",
        [orgId],
      );
      return c.json({
        categories: result.rows.map((row) => mapCatalogueItem(row as Record<string, unknown>)),
      });
    }),
  );

  app.get("/safeguarding/concerns", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertCanAccessSafeguarding(actor);
      const query = c.req.query();
      const params: unknown[] = [orgId];
      const filters = ["s.organisation_id = $1"];
      if (query.studentId) {
        params.push(query.studentId);
        filters.push(`s.student_profile_id = $${params.length}`);
      }
      if (query.status) {
        params.push(query.status);
        filters.push(`s.status = $${params.length}`);
      }
      if (query.categoryId) {
        params.push(query.categoryId);
        filters.push(`s.category_id = $${params.length}`);
      }
      if (query.yearGroupId) {
        params.push(query.yearGroupId);
        filters.push(`se.year_group_id = $${params.length}`);
      }
      if (query.from) {
        params.push(query.from);
        filters.push(`s.arose_at >= $${params.length}::timestamptz`);
      }
      if (query.to) {
        params.push(query.to);
        filters.push(`s.arose_at <= $${params.length}::timestamptz`);
      }
      const result = await client.query(
        `${CONCERN_SELECT} where ${filters.join(" and ")} order by s.arose_at desc limit 200`,
        params,
      );
      return c.json({
        concerns: result.rows.map((row) => mapSafeguardingConcern(row as Record<string, unknown>)),
      });
    }),
  );

  app.post("/safeguarding/concerns", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanAccessSafeguarding(actor);
      if (!canRecordSafeguarding(actor)) throw new AppError(404, "not_found", "Not found");
      const body = z
        .object({
          studentProfileId: z.string().uuid(),
          aroseAt: z.string().datetime({ offset: true }),
          categoryId: z.string().uuid(),
          factualDescription: z.string().trim().min(1).max(8000),
          immediateActionTaken: z.string().trim().max(4000).nullable().optional(),
          assignedSafeguardingLeadUserId: z.string().uuid().nullable().optional(),
          status: z.enum(["open", "monitoring", "referred_internal", "closed"]).optional(),
          followUpDueOn: z.string().date().nullable().optional(),
          recordedBy: z.string().uuid().optional(),
          recordedAt: z.string().optional(),
        })
        .parse(await c.req.json());
      await requireStudentInOrganisation(client, orgId, body.studentProfileId);
      await requireCategoryInOrganisation(client, "safeguarding_concern_categories", orgId, body.categoryId);
      if (body.assignedSafeguardingLeadUserId) {
        if (!canAssignSafeguarding(actor)) throw new AppError(404, "not_found", "Not found");
        await requireStaffUserInOrganisation(client, orgId, body.assignedSafeguardingLeadUserId);
      }
      const inserted = await client.query<{ id: string }>(
        `insert into safeguarding_concerns (
           organisation_id, student_profile_id, arose_at, category_id, factual_description,
           immediate_action_taken, assigned_safeguarding_lead_user_id, status, follow_up_due_on,
           recorded_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         returning id`,
        [
          orgId,
          body.studentProfileId,
          body.aroseAt,
          body.categoryId,
          body.factualDescription,
          body.immediateActionTaken ?? null,
          body.assignedSafeguardingLeadUserId ?? null,
          body.status ?? "open",
          body.followUpDueOn ?? null,
          userId,
        ],
      );
      const id = inserted.rows[0]!.id;
      await client.query(
        `insert into safeguarding_chronology_entries (
           organisation_id, concern_id, occurred_at, entry_type, factual_note, actor_user_id
         ) values ($1,$2,$3,'note','Concern recorded.',$4)`,
        [orgId, id, body.aroseAt, userId],
      );
      await auditSafeguarding(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "safeguarding.concern.create",
        entityType: "safeguarding_concern",
        entityId: id,
        studentProfileId: body.studentProfileId,
        status: body.status ?? "open",
        categoryId: body.categoryId,
        assignedUserId: body.assignedSafeguardingLeadUserId ?? null,
      });
      if (body.assignedSafeguardingLeadUserId) {
        await notifySafeguardingAssigned(client, {
          organisationId: orgId,
          actorUserId: userId,
          recipientUserId: body.assignedSafeguardingLeadUserId,
          concernId: id,
        });
      }
      return c.json({ concern: mapSafeguardingConcern(await loadConcern(client, orgId, id)) }, 201);
    }),
  );

  app.get("/safeguarding/concerns/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertCanAccessSafeguarding(actor);
      const id = uuidRouteParam(c, "id");
      const row = await loadConcern(client, orgId, id);
      const chronology = await client.query(
        `${CHRONOLOGY_SELECT} where e.concern_id = $1 and e.organisation_id = $2 order by e.occurred_at, e.recorded_at`,
        [id, orgId],
      );
      const attachments = await client.query(
        `select id, 'safeguarding_concern' as parent_kind, concern_id as parent_id, title,
                storage_backend, content_type, byte_size, created_at
         from safeguarding_attachments
         where concern_id = $1 and organisation_id = $2
         order by created_at`,
        [id, orgId],
      );
      return c.json({
        concern: mapSafeguardingConcern(row),
        chronology: chronology.rows.map((item) => mapSafeguardingChronology(item as Record<string, unknown>)),
        attachments: attachments.rows.map((item) => mapPastoralAttachment(item as Record<string, unknown>)),
      });
    }),
  );

  app.patch("/safeguarding/concerns/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanAccessSafeguarding(actor);
      if (!canManageSafeguarding(actor) && !canRecordSafeguarding(actor)) {
        throw new AppError(404, "not_found", "Not found");
      }
      const id = uuidRouteParam(c, "id");
      const existing = await loadConcern(client, orgId, id);
      const body = z
        .object({
          categoryId: z.string().uuid().optional(),
          aroseAt: z.string().datetime({ offset: true }).optional(),
          factualDescription: z.string().trim().min(1).max(8000).optional(),
          immediateActionTaken: z.string().trim().max(4000).nullable().optional(),
          assignedSafeguardingLeadUserId: z.string().uuid().nullable().optional(),
          status: z.enum(["open", "monitoring", "referred_internal", "closed"]).optional(),
          followUpDueOn: z.string().date().nullable().optional(),
        })
        .parse(await c.req.json());
      if (body.status && !isSafeguardingStatusTransitionAllowed(String(existing.status) as never, body.status)) {
        throw new AppError(409, "invalid_status_transition", "This status change is not allowed");
      }
      if (body.assignedSafeguardingLeadUserId && !canAssignSafeguarding(actor)) {
        throw new AppError(404, "not_found", "Not found");
      }
      if (body.categoryId) {
        await requireCategoryInOrganisation(client, "safeguarding_concern_categories", orgId, body.categoryId);
      }
      if (body.assignedSafeguardingLeadUserId) {
        await requireStaffUserInOrganisation(client, orgId, body.assignedSafeguardingLeadUserId);
      }
      await client.query(
        `update safeguarding_concerns
         set category_id = coalesce($3, category_id),
             arose_at = coalesce($4, arose_at),
             factual_description = coalesce($5, factual_description),
             immediate_action_taken = coalesce($6, immediate_action_taken),
             assigned_safeguarding_lead_user_id = coalesce($7, assigned_safeguarding_lead_user_id),
             status = coalesce($8, status),
             follow_up_due_on = coalesce($9, follow_up_due_on)
         where id = $1 and organisation_id = $2`,
        [
          id,
          orgId,
          body.categoryId ?? null,
          body.aroseAt ?? null,
          body.factualDescription ?? null,
          body.immediateActionTaken === undefined ? null : body.immediateActionTaken,
          body.assignedSafeguardingLeadUserId === undefined ? null : body.assignedSafeguardingLeadUserId,
          body.status ?? null,
          body.followUpDueOn === undefined ? null : body.followUpDueOn,
        ],
      );
      await auditSafeguarding(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "safeguarding.concern.update",
        entityType: "safeguarding_concern",
        entityId: id,
        studentProfileId: String(existing.student_profile_id),
        status: body.status ?? String(existing.status),
        assignedUserId: body.assignedSafeguardingLeadUserId ?? String(existing.assigned_safeguarding_lead_user_id ?? ""),
      });
      if (
        body.assignedSafeguardingLeadUserId &&
        body.assignedSafeguardingLeadUserId !== existing.assigned_safeguarding_lead_user_id
      ) {
        await notifySafeguardingAssigned(client, {
          organisationId: orgId,
          actorUserId: userId,
          recipientUserId: body.assignedSafeguardingLeadUserId,
          concernId: id,
        });
      }
      return c.json({ concern: mapSafeguardingConcern(await loadConcern(client, orgId, id)) });
    }),
  );

  app.post("/safeguarding/concerns/:id/assign", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanAccessSafeguarding(actor);
      if (!canAssignSafeguarding(actor)) throw new AppError(404, "not_found", "Not found");
      const id = uuidRouteParam(c, "id");
      const existing = await loadConcern(client, orgId, id);
      const body = z.object({ assignedSafeguardingLeadUserId: z.string().uuid() }).parse(await c.req.json());
      await requireStaffUserInOrganisation(client, orgId, body.assignedSafeguardingLeadUserId);
      await client.query(
        `update safeguarding_concerns
         set assigned_safeguarding_lead_user_id = $3
         where id = $1 and organisation_id = $2`,
        [id, orgId, body.assignedSafeguardingLeadUserId],
      );
      await auditSafeguarding(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "safeguarding.concern.assign",
        entityType: "safeguarding_concern",
        entityId: id,
        studentProfileId: String(existing.student_profile_id),
        status: String(existing.status),
        assignedUserId: body.assignedSafeguardingLeadUserId,
      });
      await notifySafeguardingAssigned(client, {
        organisationId: orgId,
        actorUserId: userId,
        recipientUserId: body.assignedSafeguardingLeadUserId,
        concernId: id,
      });
      if (existing.follow_up_due_on) {
        await notifyFollowUpDue(client, {
          organisationId: orgId,
          actorUserId: userId,
          recipientUserId: body.assignedSafeguardingLeadUserId,
          kind: "safeguarding",
          entityId: id,
        });
      }
      return c.json({ concern: mapSafeguardingConcern(await loadConcern(client, orgId, id)) });
    }),
  );

  app.post("/safeguarding/concerns/:id/chronology", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanAccessSafeguarding(actor);
      if (!canRecordSafeguarding(actor)) throw new AppError(404, "not_found", "Not found");
      const concernId = uuidRouteParam(c, "id");
      const existing = await loadConcern(client, orgId, concernId);
      const body = z
        .object({
          occurredAt: z.string().datetime({ offset: true }),
          entryType: z.enum(["note", "action", "decision", "contact", "review", "amendment"]),
          factualNote: z.string().trim().min(1).max(8000),
          actionOutcome: z.string().trim().max(4000).nullable().optional(),
          amendmentOfId: z.string().uuid().nullable().optional(),
          actorUserId: z.string().uuid().optional(),
        })
        .parse(await c.req.json());
      const inserted = await client.query<{ id: string }>(
        `insert into safeguarding_chronology_entries (
           organisation_id, concern_id, occurred_at, entry_type, factual_note, action_outcome,
           actor_user_id, amendment_of_id
         ) values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id`,
        [
          orgId,
          concernId,
          body.occurredAt,
          body.entryType,
          body.factualNote,
          body.actionOutcome ?? null,
          userId,
          body.amendmentOfId ?? null,
        ],
      );
      await auditSafeguarding(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "safeguarding.chronology.create",
        entityType: "safeguarding_chronology_entry",
        entityId: inserted.rows[0]!.id,
        studentProfileId: String(existing.student_profile_id),
        status: String(existing.status),
      });
      const row = await client.query(`${CHRONOLOGY_SELECT} where e.id = $1 and e.organisation_id = $2`, [
        inserted.rows[0]!.id,
        orgId,
      ]);
      return c.json({ entry: mapSafeguardingChronology(row.rows[0] as Record<string, unknown>) }, 201);
    }),
  );

  app.post("/safeguarding/concerns/:id/attachments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanAccessSafeguarding(actor);
      if (!canRecordSafeguarding(actor)) throw new AppError(404, "not_found", "Not found");
      const concernId = uuidRouteParam(c, "id");
      await loadConcern(client, orgId, concernId);
      const body = z
        .object({
          title: z.string().trim().min(1).max(200),
          filename: z.string().trim().min(1).max(120),
          contentType: z.string().trim().max(120).optional(),
          byteSize: z.number().int().nonnegative().optional(),
        })
        .parse(await c.req.json());
      const inserted = await client.query<{ id: string }>(
        `insert into safeguarding_attachments (
           organisation_id, concern_id, title, storage_backend, storage_key, content_type, byte_size, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id`,
        [orgId, concernId, body.title, "unconfigured", null, body.contentType ?? null, body.byteSize ?? null, userId],
      );
      const id = inserted.rows[0]!.id;
      const storageKey = defaultObjectStorage.buildSafeguardingAttachmentKey({
        organisationId: orgId,
        concernId,
        attachmentId: id,
        filename: body.filename,
      });
      await client.query("update safeguarding_attachments set storage_key = $2 where id = $1", [id, storageKey]);
      const row = await client.query(
        `select id, 'safeguarding_concern' as parent_kind, concern_id as parent_id, title,
                storage_backend, content_type, byte_size, created_at
         from safeguarding_attachments where id = $1`,
        [id],
      );
      return c.json({ attachment: mapPastoralAttachment(row.rows[0] as Record<string, unknown>) }, 201);
    }),
  );

  app.get("/safeguarding/summary", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertCanAccessSafeguarding(actor);
      const open = await client.query<{ n: number }>(
        `select count(*)::int as n from safeguarding_concerns
         where organisation_id = $1 and status in ('open', 'monitoring', 'referred_internal')`,
        [orgId],
      );
      const followUps = await client.query<{ n: number }>(
        `select count(*)::int as n from safeguarding_concerns
         where organisation_id = $1
           and follow_up_due_on is not null
           and status in ('open', 'monitoring', 'referred_internal')`,
        [orgId],
      );
      return c.json({
        openConcerns: open.rows[0]?.n ?? 0,
        outstandingFollowUps: followUps.rows[0]?.n ?? 0,
      });
    }),
  );

  app.get("/students/:id/safeguarding", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertCanAccessSafeguarding(actor);
      const studentId = uuidRouteParam(c, "id");
      await requireStudentInOrganisation(client, orgId, studentId);
      const result = await client.query(
        `${CONCERN_SELECT} where s.student_profile_id = $1 and s.organisation_id = $2 order by s.arose_at desc`,
        [studentId, orgId],
      );
      return c.json({
        concerns: result.rows.map((row) => mapSafeguardingConcern(row as Record<string, unknown>)),
      });
    }),
  );
}
