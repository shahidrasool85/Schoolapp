import { z } from "zod";
import type pg from "pg";
import {
  AppError,
  assertCanReadStudentPastoral,
  auditBehaviour,
  canAccessPastoral,
  canManagePastoral,
  isPastoralStatusTransitionAllowed,
  loadAuthorisedPastoralStudentIds,
  notifyFollowUpDue,
  notifyPastoralAssigned,
  requireCategoryInOrganisation,
  requireStaffUserInOrganisation,
  requireStudentInOrganisation,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import { mapCatalogueItem, mapPastoralConcern, mapPastoralIntervention } from "../serialize";

const CONCERN_SELECT = `
  select
    p.id, p.student_profile_id, sp.legal_name as student_legal_name,
    p.category_id, cat.key as category_key, cat.name as category_name,
    p.concern_on::text, p.summary, p.detailed_notes, p.priority,
    p.assigned_staff_user_id, assignee.full_name as assigned_staff_name,
    p.status, p.follow_up_due_on::text, p.attendance_related,
    p.attendance_from::text, p.attendance_to::text,
    p.parent_contacted, p.parent_contacted_at, p.parent_contact_summary,
    p.raised_by, raiser.full_name as raised_by_name, p.raised_at,
    se.year_group_id, yg.name as year_group_name
  from pastoral_concerns p
  join student_profiles sp on sp.id = p.student_profile_id
  join pastoral_concern_categories cat on cat.id = p.category_id
  left join users assignee on assignee.id = p.assigned_staff_user_id
  join users raiser on raiser.id = p.raised_by
  left join academic_years ay on ay.organisation_id = p.organisation_id and ay.is_current
  left join student_enrolments se
    on se.student_profile_id = p.student_profile_id
   and se.academic_year_id = ay.id
   and se.is_primary
   and se.ended_on is null
  left join year_groups yg on yg.id = se.year_group_id
`;

const INTERVENTION_SELECT = `
  select
    i.id, i.concern_id, i.intervention_type, i.responsible_staff_user_id,
    staff.full_name as responsible_staff_name, i.action_on::text, i.outcome,
    i.next_review_on::text, i.notes, i.recorded_by, recorder.full_name as recorded_by_name,
    i.recorded_at
  from pastoral_interventions i
  join users staff on staff.id = i.responsible_staff_user_id
  join users recorder on recorder.id = i.recorded_by
`;

async function loadConcern(client: pg.PoolClient, orgId: string, id: string) {
  const result = await client.query(`${CONCERN_SELECT} where p.id = $1 and p.organisation_id = $2`, [id, orgId]);
  if (!result.rows[0]) throw new AppError(404, "not_found", "Not found");
  return result.rows[0] as Record<string, unknown>;
}

export function registerPastoralRoutes(app: SchoolappApi) {
  app.get("/pastoral/categories", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canAccessPastoral(actor)) throw new AppError(404, "not_found", "Not found");
      const result = await client.query(
        "select * from pastoral_concern_categories where organisation_id = $1 order by sort_order, name",
        [orgId],
      );
      return c.json({
        categories: result.rows.map((row) => mapCatalogueItem(row as Record<string, unknown>)),
      });
    }),
  );

  app.get("/pastoral/concerns", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const authorised = await loadAuthorisedPastoralStudentIds(client, actor);
      const query = c.req.query();
      const params: unknown[] = [orgId];
      const filters = ["p.organisation_id = $1"];
      if (authorised) {
        params.push([...authorised]);
        filters.push(`p.student_profile_id = any($${params.length}::uuid[])`);
      }
      if (query.studentId) {
        params.push(query.studentId);
        filters.push(`p.student_profile_id = $${params.length}`);
      }
      if (query.status) {
        params.push(query.status);
        filters.push(`p.status = $${params.length}`);
      }
      if (query.priority) {
        params.push(query.priority);
        filters.push(`p.priority = $${params.length}`);
      }
      if (query.categoryId) {
        params.push(query.categoryId);
        filters.push(`p.category_id = $${params.length}`);
      }
      if (query.yearGroupId) {
        params.push(query.yearGroupId);
        filters.push(`se.year_group_id = $${params.length}`);
      }
      if (query.from) {
        params.push(query.from);
        filters.push(`p.concern_on >= $${params.length}::date`);
      }
      if (query.to) {
        params.push(query.to);
        filters.push(`p.concern_on <= $${params.length}::date`);
      }
      const result = await client.query(
        `${CONCERN_SELECT} where ${filters.join(" and ")} order by p.concern_on desc, p.raised_at desc limit 200`,
        params,
      );
      return c.json({
        concerns: result.rows.map((row) => mapPastoralConcern(row as Record<string, unknown>)),
      });
    }),
  );

  app.post("/pastoral/concerns", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManagePastoral(actor)) throw new AppError(404, "not_found", "Not found");
      const body = z
        .object({
          studentProfileId: z.string().uuid(),
          categoryId: z.string().uuid(),
          concernOn: z.string().date(),
          summary: z.string().trim().min(1).max(240),
          detailedNotes: z.string().trim().max(8000).nullable().optional(),
          priority: z.enum(["low", "medium", "high"]).optional(),
          assignedStaffUserId: z.string().uuid().nullable().optional(),
          status: z.enum(["open", "monitoring", "resolved", "closed"]).optional(),
          followUpDueOn: z.string().date().nullable().optional(),
          attendanceRelated: z.boolean().optional(),
          attendanceFrom: z.string().date().nullable().optional(),
          attendanceTo: z.string().date().nullable().optional(),
          raisedBy: z.string().uuid().optional(),
          raisedAt: z.string().optional(),
        })
        .parse(await c.req.json());
      await requireStudentInOrganisation(client, orgId, body.studentProfileId);
      await requireCategoryInOrganisation(client, "pastoral_concern_categories", orgId, body.categoryId);
      if (body.assignedStaffUserId) {
        await requireStaffUserInOrganisation(client, orgId, body.assignedStaffUserId);
      }
      const inserted = await client.query<{ id: string }>(
        `insert into pastoral_concerns (
           organisation_id, student_profile_id, category_id, concern_on, summary, detailed_notes,
           priority, assigned_staff_user_id, status, follow_up_due_on, attendance_related,
           attendance_from, attendance_to, raised_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         returning id`,
        [
          orgId,
          body.studentProfileId,
          body.categoryId,
          body.concernOn,
          body.summary,
          body.detailedNotes ?? null,
          body.priority ?? "medium",
          body.assignedStaffUserId ?? null,
          body.status ?? "open",
          body.followUpDueOn ?? null,
          body.attendanceRelated ?? false,
          body.attendanceFrom ?? null,
          body.attendanceTo ?? null,
          userId,
        ],
      );
      const id = inserted.rows[0]!.id;
      await auditBehaviour(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "pastoral.concern.create",
        entityType: "pastoral_concern",
        entityId: id,
        studentProfileId: body.studentProfileId,
        status: body.status ?? "open",
        categoryId: body.categoryId,
      });
      if (body.assignedStaffUserId) {
        await notifyPastoralAssigned(client, {
          organisationId: orgId,
          actorUserId: userId,
          recipientUserId: body.assignedStaffUserId,
          concernId: id,
        });
      }
      if (body.followUpDueOn && body.assignedStaffUserId) {
        await notifyFollowUpDue(client, {
          organisationId: orgId,
          actorUserId: userId,
          recipientUserId: body.assignedStaffUserId,
          kind: "pastoral",
          entityId: id,
        });
      }
      return c.json({ concern: mapPastoralConcern(await loadConcern(client, orgId, id)) }, 201);
    }),
  );

  app.get("/pastoral/concerns/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await loadConcern(client, orgId, id);
      await assertCanReadStudentPastoral(client, actor, String(row.student_profile_id));
      const interventions = await client.query(
        `${INTERVENTION_SELECT} where i.concern_id = $1 and i.organisation_id = $2 order by i.action_on`,
        [id, orgId],
      );
      return c.json({
        concern: mapPastoralConcern(row),
        interventions: interventions.rows.map((item) => mapPastoralIntervention(item as Record<string, unknown>)),
      });
    }),
  );

  app.patch("/pastoral/concerns/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManagePastoral(actor)) throw new AppError(404, "not_found", "Not found");
      const id = uuidRouteParam(c, "id");
      const existing = await loadConcern(client, orgId, id);
      const body = z
        .object({
          categoryId: z.string().uuid().optional(),
          concernOn: z.string().date().optional(),
          summary: z.string().trim().min(1).max(240).optional(),
          detailedNotes: z.string().trim().max(8000).nullable().optional(),
          priority: z.enum(["low", "medium", "high"]).optional(),
          assignedStaffUserId: z.string().uuid().nullable().optional(),
          status: z.enum(["open", "monitoring", "resolved", "closed"]).optional(),
          followUpDueOn: z.string().date().nullable().optional(),
          attendanceRelated: z.boolean().optional(),
          attendanceFrom: z.string().date().nullable().optional(),
          attendanceTo: z.string().date().nullable().optional(),
        })
        .parse(await c.req.json());
      if (body.status && !isPastoralStatusTransitionAllowed(String(existing.status) as never, body.status)) {
        throw new AppError(409, "invalid_status_transition", "This status change is not allowed");
      }
      if (body.categoryId) {
        await requireCategoryInOrganisation(client, "pastoral_concern_categories", orgId, body.categoryId);
      }
      if (body.assignedStaffUserId) {
        await requireStaffUserInOrganisation(client, orgId, body.assignedStaffUserId);
      }
      await client.query(
        `update pastoral_concerns
         set category_id = coalesce($3, category_id),
             concern_on = coalesce($4, concern_on),
             summary = coalesce($5, summary),
             detailed_notes = coalesce($6, detailed_notes),
             priority = coalesce($7, priority),
             assigned_staff_user_id = coalesce($8, assigned_staff_user_id),
             status = coalesce($9, status),
             follow_up_due_on = coalesce($10, follow_up_due_on),
             attendance_related = coalesce($11, attendance_related),
             attendance_from = coalesce($12, attendance_from),
             attendance_to = coalesce($13, attendance_to)
         where id = $1 and organisation_id = $2`,
        [
          id,
          orgId,
          body.categoryId ?? null,
          body.concernOn ?? null,
          body.summary ?? null,
          body.detailedNotes === undefined ? null : body.detailedNotes,
          body.priority ?? null,
          body.assignedStaffUserId === undefined ? null : body.assignedStaffUserId,
          body.status ?? null,
          body.followUpDueOn === undefined ? null : body.followUpDueOn,
          body.attendanceRelated ?? null,
          body.attendanceFrom === undefined ? null : body.attendanceFrom,
          body.attendanceTo === undefined ? null : body.attendanceTo,
        ],
      );
      await auditBehaviour(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "pastoral.concern.update",
        entityType: "pastoral_concern",
        entityId: id,
        studentProfileId: String(existing.student_profile_id),
        status: body.status ?? String(existing.status),
      });
      if (body.assignedStaffUserId && body.assignedStaffUserId !== existing.assigned_staff_user_id) {
        await notifyPastoralAssigned(client, {
          organisationId: orgId,
          actorUserId: userId,
          recipientUserId: body.assignedStaffUserId,
          concernId: id,
        });
      }
      return c.json({ concern: mapPastoralConcern(await loadConcern(client, orgId, id)) });
    }),
  );

  app.post("/pastoral/concerns/:id/interventions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManagePastoral(actor)) throw new AppError(404, "not_found", "Not found");
      const concernId = uuidRouteParam(c, "id");
      const existing = await loadConcern(client, orgId, concernId);
      const body = z
        .object({
          interventionType: z.enum([
            "pupil_meeting",
            "parent_meeting",
            "parent_contact",
            "mentoring",
            "support_plan",
            "internal_referral",
            "review",
          ]),
          responsibleStaffUserId: z.string().uuid(),
          actionOn: z.string().date(),
          outcome: z.string().trim().max(4000).nullable().optional(),
          nextReviewOn: z.string().date().nullable().optional(),
          notes: z.string().trim().max(4000).nullable().optional(),
          recordedBy: z.string().uuid().optional(),
        })
        .parse(await c.req.json());
      await requireStaffUserInOrganisation(client, orgId, body.responsibleStaffUserId);
      const inserted = await client.query<{ id: string }>(
        `insert into pastoral_interventions (
           organisation_id, concern_id, intervention_type, responsible_staff_user_id,
           action_on, outcome, next_review_on, notes, recorded_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning id`,
        [
          orgId,
          concernId,
          body.interventionType,
          body.responsibleStaffUserId,
          body.actionOn,
          body.outcome ?? null,
          body.nextReviewOn ?? null,
          body.notes ?? null,
          userId,
        ],
      );
      await auditBehaviour(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "pastoral.intervention.create",
        entityType: "pastoral_intervention",
        entityId: inserted.rows[0]!.id,
        studentProfileId: String(existing.student_profile_id),
      });
      const row = await client.query(`${INTERVENTION_SELECT} where i.id = $1 and i.organisation_id = $2`, [
        inserted.rows[0]!.id,
        orgId,
      ]);
      return c.json({ intervention: mapPastoralIntervention(row.rows[0] as Record<string, unknown>) }, 201);
    }),
  );

  app.patch("/pastoral/interventions/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canManagePastoral(actor)) throw new AppError(404, "not_found", "Not found");
      const id = uuidRouteParam(c, "id");
      const existing = await client.query(`${INTERVENTION_SELECT} where i.id = $1 and i.organisation_id = $2`, [
        id,
        orgId,
      ]);
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const body = z
        .object({
          outcome: z.string().trim().max(4000).nullable().optional(),
          nextReviewOn: z.string().date().nullable().optional(),
          notes: z.string().trim().max(4000).nullable().optional(),
          actionOn: z.string().date().optional(),
        })
        .parse(await c.req.json());
      await client.query(
        `update pastoral_interventions
         set outcome = coalesce($3, outcome),
             next_review_on = coalesce($4, next_review_on),
             notes = coalesce($5, notes),
             action_on = coalesce($6, action_on)
         where id = $1 and organisation_id = $2`,
        [id, orgId, body.outcome ?? null, body.nextReviewOn ?? null, body.notes ?? null, body.actionOn ?? null],
      );
      const row = await client.query(`${INTERVENTION_SELECT} where i.id = $1 and i.organisation_id = $2`, [id, orgId]);
      return c.json({ intervention: mapPastoralIntervention(row.rows[0] as Record<string, unknown>) });
    }),
  );

  app.post("/pastoral/concerns/:id/parent-contact", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManagePastoral(actor)) throw new AppError(404, "not_found", "Not found");
      const id = uuidRouteParam(c, "id");
      const existing = await loadConcern(client, orgId, id);
      const body = z.object({ summary: z.string().trim().min(1).max(500) }).parse(await c.req.json());
      await client.query(
        `update pastoral_concerns
         set parent_contacted = true, parent_contacted_at = now(), parent_contact_summary = $3
         where id = $1 and organisation_id = $2`,
        [id, orgId, body.summary],
      );
      await auditBehaviour(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "pastoral.concern.parent_contact",
        entityType: "pastoral_concern",
        entityId: id,
        studentProfileId: String(existing.student_profile_id),
      });
      return c.json({ concern: mapPastoralConcern(await loadConcern(client, orgId, id)) });
    }),
  );

  app.get("/pastoral/summary", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const authorised = await loadAuthorisedPastoralStudentIds(client, actor);
      const studentFilter = authorised ? "and student_profile_id = any($2::uuid[])" : "";
      const params = authorised ? [orgId, [...authorised]] : [orgId];
      const open = await client.query<{ n: number }>(
        `select count(*)::int as n from pastoral_concerns
         where organisation_id = $1 and status in ('open', 'monitoring') ${studentFilter}`,
        params,
      );
      const followUps = await client.query<{ n: number }>(
        `select count(*)::int as n from pastoral_concerns
         where organisation_id = $1
           and follow_up_due_on is not null
           and status in ('open', 'monitoring')
           ${studentFilter}`,
        params,
      );
      return c.json({
        openConcerns: open.rows[0]?.n ?? 0,
        outstandingFollowUps: followUps.rows[0]?.n ?? 0,
      });
    }),
  );

  app.get("/students/:id/pastoral", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const studentId = uuidRouteParam(c, "id");
      await requireStudentInOrganisation(client, orgId, studentId);
      await assertCanReadStudentPastoral(client, actor, studentId);
      const result = await client.query(
        `${CONCERN_SELECT} where p.student_profile_id = $1 and p.organisation_id = $2 order by p.concern_on desc`,
        [studentId, orgId],
      );
      return c.json({
        concerns: result.rows.map((row) => mapPastoralConcern(row as Record<string, unknown>)),
      });
    }),
  );
}
