import { z } from "zod";
import type pg from "pg";
import {
  AppError,
  assertCanReadStudentBehaviour,
  assertCanRecordStudentBehaviour,
  auditBehaviour,
  canManageBehaviour,
  canRecordBehaviour,
  canRecordPositiveBehaviour,
  isActionStatusTransitionAllowed,
  isIncidentStatusTransitionAllowed,
  loadAuthorisedBehaviourStudentIds,
  requireCategoryInOrganisation,
  requireClassInOrganisation,
  requireStudentInOrganisation,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import {
  mapBehaviourAction,
  mapBehaviourIncident,
  mapCatalogueItem,
  mapPositiveBehaviour,
} from "../serialize";

const INCIDENT_SELECT = `
  select
    i.id, i.student_profile_id, sp.legal_name as student_legal_name,
    i.occurred_at, i.category_id, cat.key as category_key, cat.name as category_name,
    i.location_id, loc.key as location_key, loc.name as location_name,
    i.class_id, c.name as class_name, i.description, i.severity, i.action_taken,
    i.follow_up_required, i.follow_up_due_on::text, i.status,
    i.parent_visible, i.student_visible, i.parent_contacted, i.parent_contacted_at,
    i.parent_contact_summary, i.recorded_by, recorder.full_name as recorded_by_name,
    i.recorded_at, se.year_group_id, yg.name as year_group_name
  from behaviour_incidents i
  join student_profiles sp on sp.id = i.student_profile_id
  join behaviour_incident_categories cat on cat.id = i.category_id
  left join behaviour_locations loc on loc.id = i.location_id
  left join classes c on c.id = i.class_id
  join users recorder on recorder.id = i.recorded_by
  left join academic_years ay on ay.organisation_id = i.organisation_id and ay.is_current
  left join student_enrolments se
    on se.student_profile_id = i.student_profile_id
   and se.academic_year_id = ay.id
   and se.is_primary
   and se.ended_on is null
  left join year_groups yg on yg.id = se.year_group_id
`;

const POSITIVE_SELECT = `
  select
    p.id, p.student_profile_id, sp.legal_name as student_legal_name,
    p.occurred_on::text, p.category_id, cat.key as category_key, cat.name as category_name,
    p.class_id, c.name as class_name, p.description, p.parent_visible, p.student_visible,
    p.recorded_by, recorder.full_name as recorded_by_name, p.recorded_at
  from positive_behaviour_records p
  join student_profiles sp on sp.id = p.student_profile_id
  join positive_behaviour_categories cat on cat.id = p.category_id
  left join classes c on c.id = p.class_id
  join users recorder on recorder.id = p.recorded_by
`;

const ACTION_SELECT = `
  select
    a.id, a.student_profile_id, sp.legal_name as student_legal_name,
    a.incident_id, a.category_id, cat.key as category_key, cat.name as category_name,
    a.notes, a.status, a.action_on::text, a.completed_on::text,
    a.parent_contacted, a.parent_contacted_at, a.parent_contact_summary,
    a.recorded_by, recorder.full_name as recorded_by_name, a.recorded_at
  from behaviour_actions a
  join student_profiles sp on sp.id = a.student_profile_id
  join behaviour_action_categories cat on cat.id = a.category_id
  join users recorder on recorder.id = a.recorded_by
`;

const incidentBody = z.object({
  studentProfileId: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  categoryId: z.string().uuid(),
  locationId: z.string().uuid().nullable().optional(),
  classId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(8000),
  severity: z.enum(["low", "medium", "high"]).optional(),
  actionTaken: z.string().trim().max(4000).nullable().optional(),
  followUpRequired: z.boolean().optional(),
  followUpDueOn: z.string().date().nullable().optional(),
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  parentVisible: z.boolean().optional(),
  studentVisible: z.boolean().optional(),
  relatedStudentIds: z.array(z.string().uuid()).max(20).optional(),
  witnesses: z
    .array(
      z.object({
        studentProfileId: z.string().uuid().optional(),
        staffUserId: z.string().uuid().optional(),
        displayName: z.string().trim().min(1).max(120).optional(),
      }),
    )
    .max(20)
    .optional(),
  recordedBy: z.string().uuid().optional(),
  recordedAt: z.string().optional(),
});

async function loadIncident(client: pg.PoolClient, orgId: string, id: string) {
  const result = await client.query(`${INCIDENT_SELECT} where i.id = $1 and i.organisation_id = $2`, [id, orgId]);
  if (!result.rows[0]) throw new AppError(404, "not_found", "Not found");
  return result.rows[0] as Record<string, unknown>;
}

async function replaceRelated(
  client: pg.PoolClient,
  orgId: string,
  incidentId: string,
  studentIds: string[] | undefined,
) {
  if (!studentIds) return;
  await client.query(
    "delete from behaviour_incident_related_pupils where incident_id = $1 and organisation_id = $2",
    [incidentId, orgId],
  );
  for (const studentId of studentIds) {
    await requireStudentInOrganisation(client, orgId, studentId);
    await client.query(
      `insert into behaviour_incident_related_pupils (organisation_id, incident_id, student_profile_id)
       values ($1, $2, $3)`,
      [orgId, incidentId, studentId],
    );
  }
}

async function replaceWitnesses(
  client: pg.PoolClient,
  orgId: string,
  incidentId: string,
  witnesses:
    | Array<{ studentProfileId?: string; staffUserId?: string; displayName?: string }>
    | undefined,
) {
  if (!witnesses) return;
  await client.query(
    "delete from behaviour_incident_witnesses where incident_id = $1 and organisation_id = $2",
    [incidentId, orgId],
  );
  for (const witness of witnesses) {
    if (witness.studentProfileId) {
      await requireStudentInOrganisation(client, orgId, witness.studentProfileId);
    }
    await client.query(
      `insert into behaviour_incident_witnesses (
         organisation_id, incident_id, student_profile_id, staff_user_id, display_name
       ) values ($1, $2, $3, $4, $5)`,
      [orgId, incidentId, witness.studentProfileId ?? null, witness.staffUserId ?? null, witness.displayName ?? null],
    );
  }
}

export function registerBehaviourRoutes(app: SchoolappApi) {
  app.get("/behaviour/categories", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const authorised = await loadAuthorisedBehaviourStudentIds(client, actor);
      void authorised;
      const [incidents, actions, positives, locations] = await Promise.all([
        client.query(
          "select * from behaviour_incident_categories where organisation_id = $1 order by sort_order, name",
          [orgId],
        ),
        client.query(
          "select * from behaviour_action_categories where organisation_id = $1 order by sort_order, name",
          [orgId],
        ),
        client.query(
          "select * from positive_behaviour_categories where organisation_id = $1 order by sort_order, name",
          [orgId],
        ),
        client.query(
          "select * from behaviour_locations where organisation_id = $1 order by sort_order, name",
          [orgId],
        ),
      ]);
      return c.json({
        incidentCategories: incidents.rows.map((row) => mapCatalogueItem(row as Record<string, unknown>)),
        actionCategories: actions.rows.map((row) => mapCatalogueItem(row as Record<string, unknown>)),
        positiveCategories: positives.rows.map((row) => mapCatalogueItem(row as Record<string, unknown>)),
        locations: locations.rows.map((row) => mapCatalogueItem(row as Record<string, unknown>)),
      });
    }),
  );

  app.get("/behaviour/incidents", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const authorised = await loadAuthorisedBehaviourStudentIds(client, actor);
      const query = c.req.query();
      const params: unknown[] = [orgId];
      const filters = ["i.organisation_id = $1"];
      if (authorised) {
        params.push([...authorised]);
        filters.push(`i.student_profile_id = any($${params.length}::uuid[])`);
      }
      if (query.studentId) {
        params.push(query.studentId);
        filters.push(`i.student_profile_id = $${params.length}`);
      }
      if (query.status) {
        params.push(query.status);
        filters.push(`i.status = $${params.length}`);
      }
      if (query.severity) {
        params.push(query.severity);
        filters.push(`i.severity = $${params.length}`);
      }
      if (query.categoryId) {
        params.push(query.categoryId);
        filters.push(`i.category_id = $${params.length}`);
      }
      if (query.classId) {
        params.push(query.classId);
        filters.push(`i.class_id = $${params.length}`);
      }
      if (query.yearGroupId) {
        params.push(query.yearGroupId);
        filters.push(`se.year_group_id = $${params.length}`);
      }
      if (query.from) {
        params.push(query.from);
        filters.push(`i.occurred_at >= $${params.length}::timestamptz`);
      }
      if (query.to) {
        params.push(query.to);
        filters.push(`i.occurred_at <= $${params.length}::timestamptz`);
      }
      const result = await client.query(
        `${INCIDENT_SELECT} where ${filters.join(" and ")} order by i.occurred_at desc limit 200`,
        params,
      );
      return c.json({ incidents: result.rows.map((row) => mapBehaviourIncident(row as Record<string, unknown>)) });
    }),
  );

  app.post("/behaviour/incidents", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canRecordBehaviour(actor)) {
        throw new AppError(404, "not_found", "Not found");
      }
      const body = incidentBody.parse(await c.req.json());
      await assertCanRecordStudentBehaviour(client, actor, body.studentProfileId);
      await requireStudentInOrganisation(client, orgId, body.studentProfileId);
      await requireCategoryInOrganisation(client, "behaviour_incident_categories", orgId, body.categoryId);
      if (body.locationId) {
        await requireCategoryInOrganisation(client, "behaviour_locations", orgId, body.locationId);
      }
      if (body.classId) {
        await requireClassInOrganisation(client, orgId, body.classId);
      }
      const inserted = await client.query<{ id: string }>(
        `insert into behaviour_incidents (
           organisation_id, student_profile_id, occurred_at, category_id, location_id, class_id,
           description, severity, action_taken, follow_up_required, follow_up_due_on, status,
           parent_visible, student_visible, recorded_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         returning id`,
        [
          orgId,
          body.studentProfileId,
          body.occurredAt,
          body.categoryId,
          body.locationId ?? null,
          body.classId ?? null,
          body.description,
          body.severity ?? "low",
          body.actionTaken ?? null,
          body.followUpRequired ?? false,
          body.followUpDueOn ?? null,
          body.status ?? "open",
          canManageBehaviour(actor) ? Boolean(body.parentVisible) : false,
          canManageBehaviour(actor) ? Boolean(body.studentVisible) : false,
          userId,
        ],
      );
      const id = inserted.rows[0]!.id;
      await replaceRelated(client, orgId, id, body.relatedStudentIds);
      await replaceWitnesses(client, orgId, id, body.witnesses);
      await auditBehaviour(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "behaviour.incident.create",
        entityType: "behaviour_incident",
        entityId: id,
        studentProfileId: body.studentProfileId,
        status: body.status ?? "open",
        categoryId: body.categoryId,
        severity: body.severity ?? "low",
      });
      return c.json({ incident: mapBehaviourIncident(await loadIncident(client, orgId, id)) }, 201);
    }),
  );

  app.get("/behaviour/incidents/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await loadIncident(client, orgId, id);
      await assertCanReadStudentBehaviour(client, actor, String(row.student_profile_id));
      const related = await client.query(
        `select r.student_profile_id, sp.legal_name
         from behaviour_incident_related_pupils r
         join student_profiles sp on sp.id = r.student_profile_id
         where r.incident_id = $1 and r.organisation_id = $2`,
        [id, orgId],
      );
      const witnesses = await client.query(
        `select w.student_profile_id, sp.legal_name as student_legal_name,
                w.staff_user_id, u.full_name as staff_name, w.display_name
         from behaviour_incident_witnesses w
         left join student_profiles sp on sp.id = w.student_profile_id
         left join users u on u.id = w.staff_user_id
         where w.incident_id = $1 and w.organisation_id = $2`,
        [id, orgId],
      );
      const actions = await client.query(`${ACTION_SELECT} where a.incident_id = $1 and a.organisation_id = $2`, [
        id,
        orgId,
      ]);
      return c.json({
        incident: mapBehaviourIncident(row),
        relatedPupils: related.rows.map((item) => ({
          studentProfileId: item.student_profile_id,
          studentLegalName: item.legal_name,
        })),
        witnesses: witnesses.rows,
        actions: actions.rows.map((item) => mapBehaviourAction(item as Record<string, unknown>)),
      });
    }),
  );

  app.patch("/behaviour/incidents/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const existing = await loadIncident(client, orgId, id);
      await assertCanRecordStudentBehaviour(client, actor, String(existing.student_profile_id));
      if (!canRecordBehaviour(actor)) {
        throw new AppError(404, "not_found", "Not found");
      }
      const body = incidentBody.partial().parse(await c.req.json());
      if (body.status && !isIncidentStatusTransitionAllowed(String(existing.status) as never, body.status)) {
        throw new AppError(409, "invalid_status_transition", "This status change is not allowed");
      }
      if (body.categoryId) {
        await requireCategoryInOrganisation(client, "behaviour_incident_categories", orgId, body.categoryId);
      }
      if (body.locationId) {
        await requireCategoryInOrganisation(client, "behaviour_locations", orgId, body.locationId);
      }
      if (body.classId) {
        await requireClassInOrganisation(client, orgId, body.classId);
      }
      await client.query(
        `update behaviour_incidents
         set occurred_at = coalesce($3, occurred_at),
             category_id = coalesce($4, category_id),
             location_id = coalesce($5, location_id),
             class_id = coalesce($6, class_id),
             description = coalesce($7, description),
             severity = coalesce($8, severity),
             action_taken = coalesce($9, action_taken),
             follow_up_required = coalesce($10, follow_up_required),
             follow_up_due_on = coalesce($11, follow_up_due_on),
             status = coalesce($12, status),
             parent_visible = coalesce($13, parent_visible),
             student_visible = coalesce($14, student_visible)
         where id = $1 and organisation_id = $2`,
        [
          id,
          orgId,
          body.occurredAt ?? null,
          body.categoryId ?? null,
          body.locationId === undefined ? null : body.locationId,
          body.classId === undefined ? null : body.classId,
          body.description ?? null,
          body.severity ?? null,
          body.actionTaken === undefined ? null : body.actionTaken,
          body.followUpRequired ?? null,
          body.followUpDueOn === undefined ? null : body.followUpDueOn,
          body.status ?? null,
          canManageBehaviour(actor) ? (body.parentVisible ?? null) : null,
          canManageBehaviour(actor) ? (body.studentVisible ?? null) : null,
        ],
      );
      if (body.relatedStudentIds) await replaceRelated(client, orgId, id, body.relatedStudentIds);
      if (body.witnesses) await replaceWitnesses(client, orgId, id, body.witnesses);
      await auditBehaviour(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "behaviour.incident.update",
        entityType: "behaviour_incident",
        entityId: id,
        studentProfileId: String(existing.student_profile_id),
        status: body.status ?? String(existing.status),
        categoryId: body.categoryId ?? String(existing.category_id),
        severity: body.severity ?? String(existing.severity),
      });
      return c.json({ incident: mapBehaviourIncident(await loadIncident(client, orgId, id)) });
    }),
  );

  app.get("/behaviour/incidents/:id/history", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const id = uuidRouteParam(c, "id");
      const existing = await loadIncident(client, orgId, id);
      await assertCanReadStudentBehaviour(client, actor, String(existing.student_profile_id));
      const history = await client.query(
        `select id, previous_status, new_status, changed_fields, actor_user_id, created_at
         from behaviour_incident_revisions
         where incident_id = $1 and organisation_id = $2
         order by created_at`,
        [id, orgId],
      );
      return c.json({ history: history.rows });
    }),
  );

  app.post("/behaviour/incidents/:id/parent-contact", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const existing = await loadIncident(client, orgId, id);
      await assertCanRecordStudentBehaviour(client, actor, String(existing.student_profile_id));
      const body = z
        .object({ summary: z.string().trim().min(1).max(500) })
        .parse(await c.req.json());
      await client.query(
        `update behaviour_incidents
         set parent_contacted = true, parent_contacted_at = now(), parent_contact_summary = $3
         where id = $1 and organisation_id = $2`,
        [id, orgId, body.summary],
      );
      await auditBehaviour(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "behaviour.incident.parent_contact",
        entityType: "behaviour_incident",
        entityId: id,
        studentProfileId: String(existing.student_profile_id),
        status: String(existing.status),
      });
      return c.json({ incident: mapBehaviourIncident(await loadIncident(client, orgId, id)) });
    }),
  );

  app.get("/behaviour/positives", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const authorised = await loadAuthorisedBehaviourStudentIds(client, actor);
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
      if (query.categoryId) {
        params.push(query.categoryId);
        filters.push(`p.category_id = $${params.length}`);
      }
      if (query.classId) {
        params.push(query.classId);
        filters.push(`p.class_id = $${params.length}`);
      }
      if (query.from) {
        params.push(query.from);
        filters.push(`p.occurred_on >= $${params.length}::date`);
      }
      if (query.to) {
        params.push(query.to);
        filters.push(`p.occurred_on <= $${params.length}::date`);
      }
      const result = await client.query(
        `${POSITIVE_SELECT} where ${filters.join(" and ")} order by p.occurred_on desc, p.recorded_at desc limit 200`,
        params,
      );
      return c.json({ positives: result.rows.map((row) => mapPositiveBehaviour(row as Record<string, unknown>)) });
    }),
  );

  app.post("/behaviour/positives", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canRecordPositiveBehaviour(actor)) {
        throw new AppError(404, "not_found", "Not found");
      }
      const body = z
        .object({
          studentProfileId: z.string().uuid(),
          occurredOn: z.string().date(),
          categoryId: z.string().uuid(),
          classId: z.string().uuid().nullable().optional(),
          description: z.string().trim().max(2000).nullable().optional(),
          parentVisible: z.boolean().optional(),
          studentVisible: z.boolean().optional(),
          recordedBy: z.string().uuid().optional(),
        })
        .parse(await c.req.json());
      await assertCanRecordStudentBehaviour(client, actor, body.studentProfileId);
      await requireStudentInOrganisation(client, orgId, body.studentProfileId);
      await requireCategoryInOrganisation(client, "positive_behaviour_categories", orgId, body.categoryId);
      if (body.classId) await requireClassInOrganisation(client, orgId, body.classId);
      const inserted = await client.query<{ id: string }>(
        `insert into positive_behaviour_records (
           organisation_id, student_profile_id, occurred_on, category_id, class_id,
           description, parent_visible, student_visible, recorded_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning id`,
        [
          orgId,
          body.studentProfileId,
          body.occurredOn,
          body.categoryId,
          body.classId ?? null,
          body.description ?? null,
          canManageBehaviour(actor) ? Boolean(body.parentVisible) : false,
          canManageBehaviour(actor) ? Boolean(body.studentVisible) : false,
          userId,
        ],
      );
      const row = await client.query(`${POSITIVE_SELECT} where p.id = $1 and p.organisation_id = $2`, [
        inserted.rows[0]!.id,
        orgId,
      ]);
      await auditBehaviour(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "behaviour.positive.create",
        entityType: "positive_behaviour_record",
        entityId: inserted.rows[0]!.id,
        studentProfileId: body.studentProfileId,
        categoryId: body.categoryId,
      });
      return c.json({ positive: mapPositiveBehaviour(row.rows[0] as Record<string, unknown>) }, 201);
    }),
  );

  app.get("/behaviour/positives/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const id = uuidRouteParam(c, "id");
      const result = await client.query(`${POSITIVE_SELECT} where p.id = $1 and p.organisation_id = $2`, [id, orgId]);
      if (!result.rows[0]) throw new AppError(404, "not_found", "Not found");
      await assertCanReadStudentBehaviour(client, actor, String(result.rows[0].student_profile_id));
      return c.json({ positive: mapPositiveBehaviour(result.rows[0] as Record<string, unknown>) });
    }),
  );

  app.get("/behaviour/actions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const authorised = await loadAuthorisedBehaviourStudentIds(client, actor);
      const query = c.req.query();
      const params: unknown[] = [orgId];
      const filters = ["a.organisation_id = $1"];
      if (authorised) {
        params.push([...authorised]);
        filters.push(`a.student_profile_id = any($${params.length}::uuid[])`);
      }
      if (query.studentId) {
        params.push(query.studentId);
        filters.push(`a.student_profile_id = $${params.length}`);
      }
      if (query.status) {
        params.push(query.status);
        filters.push(`a.status = $${params.length}`);
      }
      const result = await client.query(
        `${ACTION_SELECT} where ${filters.join(" and ")} order by a.action_on desc limit 200`,
        params,
      );
      return c.json({ actions: result.rows.map((row) => mapBehaviourAction(row as Record<string, unknown>)) });
    }),
  );

  app.post("/behaviour/actions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canRecordBehaviour(actor)) {
        throw new AppError(404, "not_found", "Not found");
      }
      const body = z
        .object({
          studentProfileId: z.string().uuid(),
          incidentId: z.string().uuid().nullable().optional(),
          categoryId: z.string().uuid(),
          notes: z.string().trim().max(4000).nullable().optional(),
          status: z.enum(["planned", "in_progress", "completed", "cancelled"]).optional(),
          actionOn: z.string().date(),
          completedOn: z.string().date().nullable().optional(),
          recordedBy: z.string().uuid().optional(),
        })
        .parse(await c.req.json());
      await assertCanRecordStudentBehaviour(client, actor, body.studentProfileId);
      await requireStudentInOrganisation(client, orgId, body.studentProfileId);
      await requireCategoryInOrganisation(client, "behaviour_action_categories", orgId, body.categoryId);
      if (body.incidentId) {
        const incident = await loadIncident(client, orgId, body.incidentId);
        if (String(incident.student_profile_id) !== body.studentProfileId) {
          throw new AppError(400, "validation_failed", "Referenced records must belong to this organisation");
        }
      }
      const inserted = await client.query<{ id: string }>(
        `insert into behaviour_actions (
           organisation_id, student_profile_id, incident_id, category_id, notes, status,
           action_on, completed_on, recorded_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning id`,
        [
          orgId,
          body.studentProfileId,
          body.incidentId ?? null,
          body.categoryId,
          body.notes ?? null,
          body.status ?? "planned",
          body.actionOn,
          body.completedOn ?? null,
          userId,
        ],
      );
      const row = await client.query(`${ACTION_SELECT} where a.id = $1 and a.organisation_id = $2`, [
        inserted.rows[0]!.id,
        orgId,
      ]);
      await auditBehaviour(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "behaviour.action.create",
        entityType: "behaviour_action",
        entityId: inserted.rows[0]!.id,
        studentProfileId: body.studentProfileId,
        status: body.status ?? "planned",
        categoryId: body.categoryId,
      });
      return c.json({ action: mapBehaviourAction(row.rows[0] as Record<string, unknown>) }, 201);
    }),
  );

  app.patch("/behaviour/actions/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const id = uuidRouteParam(c, "id");
      const existing = await client.query(`${ACTION_SELECT} where a.id = $1 and a.organisation_id = $2`, [id, orgId]);
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      await assertCanRecordStudentBehaviour(client, actor, String(existing.rows[0].student_profile_id));
      const body = z
        .object({
          notes: z.string().trim().max(4000).nullable().optional(),
          status: z.enum(["planned", "in_progress", "completed", "cancelled"]).optional(),
          actionOn: z.string().date().optional(),
          completedOn: z.string().date().nullable().optional(),
        })
        .parse(await c.req.json());
      if (body.status && !isActionStatusTransitionAllowed(String(existing.rows[0].status) as never, body.status)) {
        throw new AppError(409, "invalid_status_transition", "This status change is not allowed");
      }
      await client.query(
        `update behaviour_actions
         set notes = coalesce($3, notes),
             status = coalesce($4, status),
             action_on = coalesce($5, action_on),
             completed_on = coalesce($6, completed_on)
         where id = $1 and organisation_id = $2`,
        [id, orgId, body.notes ?? null, body.status ?? null, body.actionOn ?? null, body.completedOn ?? null],
      );
      const row = await client.query(`${ACTION_SELECT} where a.id = $1 and a.organisation_id = $2`, [id, orgId]);
      return c.json({ action: mapBehaviourAction(row.rows[0] as Record<string, unknown>) });
    }),
  );

  app.get("/behaviour/summary", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const authorised = await loadAuthorisedBehaviourStudentIds(client, actor);
      const studentFilter = authorised ? "and student_profile_id = any($2::uuid[])" : "";
      const params = authorised ? [orgId, [...authorised]] : [orgId];
      const incidents = await client.query<{ n: number; status: string }>(
        `select status, count(*)::int as n
         from behaviour_incidents
         where organisation_id = $1 ${studentFilter}
         group by status`,
        params,
      );
      const positives = await client.query<{ n: number }>(
        `select count(*)::int as n from positive_behaviour_records where organisation_id = $1 ${studentFilter}`,
        params,
      );
      const repeated = await client.query(
        `select i.student_profile_id, sp.legal_name, count(*)::int as incident_count
         from behaviour_incidents i
         join student_profiles sp on sp.id = i.student_profile_id
         where i.organisation_id = $1 ${authorised ? "and i.student_profile_id = any($2::uuid[])" : ""}
         group by i.student_profile_id, sp.legal_name
         having count(*) >= 2
         order by incident_count desc
         limit 20`,
        params,
      );
      const followUps = await client.query<{ n: number }>(
        `select count(*)::int as n
         from behaviour_incidents
         where organisation_id = $1
           and follow_up_required
           and status in ('open', 'in_progress')
           ${studentFilter}`,
        params,
      );
      return c.json({
        incidentsByStatus: Object.fromEntries(incidents.rows.map((row) => [row.status, row.n])),
        positiveCount: positives.rows[0]?.n ?? 0,
        repeatedIncidents: repeated.rows,
        outstandingFollowUps: followUps.rows[0]?.n ?? 0,
      });
    }),
  );

  app.get("/students/:id/behaviour", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const studentId = uuidRouteParam(c, "id");
      await requireStudentInOrganisation(client, orgId, studentId);
      await assertCanReadStudentBehaviour(client, actor, studentId);
      const incidents = await client.query(`${INCIDENT_SELECT} where i.student_profile_id = $1 and i.organisation_id = $2 order by i.occurred_at desc`, [
        studentId,
        orgId,
      ]);
      const positives = await client.query(`${POSITIVE_SELECT} where p.student_profile_id = $1 and p.organisation_id = $2 order by p.occurred_on desc`, [
        studentId,
        orgId,
      ]);
      return c.json({
        incidents: incidents.rows.map((row) => mapBehaviourIncident(row as Record<string, unknown>)),
        positives: positives.rows.map((row) => mapPositiveBehaviour(row as Record<string, unknown>)),
      });
    }),
  );
}
