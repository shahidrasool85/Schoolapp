import { z } from "zod";
import type pg from "pg";
import type { Actor } from "@schoolapp/domain";
import {
  AppError,
  assertAnyPermission,
  assertCanManageAssignment,
  assertCanReadAssignment,
  assertCanReadOrMarkSubmission,
  assertCanTargetClass,
  assertCanTargetStudent,
  assertCanTargetYearGroup,
  canManageSchoolLearning,
  canMarkAssignedLearning,
  canMarkSchoolLearning,
  canReadSchoolLearning,
  isAllowedLearningUrl,
  isScoreInRange,
  LMS_ASSIGN_PERMISSIONS,
  LMS_MARK_PERMISSIONS,
  LMS_READ_SUBMISSION_PERMISSIONS,
  LMS_READ_WORK_PERMISSIONS,
  loadAuthorisedLearningClassIds,
  canSeeLearningRecipient,
  notifyLearningAssigned,
  notifyLearningFeedback,
  snapshotAssignmentRecipients,
  summariseLearningProgress,
  writeAudit,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import {
  mapLearningAssignment,
  mapLearningMark,
  mapLearningResource,
  mapLearningRevision,
  mapLearningSubmission,
  mapLearningTarget,
  mapLearningWorkType,
} from "../serialize";

const ASSIGNMENT_SELECT = `
  select
    a.id,
    a.title,
    a.description,
    a.work_type_id,
    wt.key as work_type_key,
    wt.name as work_type_name,
    a.subject_id,
    sub.name as subject_name,
    a.academic_year_id,
    ay.name as academic_year_name,
    a.intended_year_group_id,
    yg.name as intended_year_group_name,
    a.created_by,
    creator.full_name as created_by_name,
    a.created_at,
    a.due_at,
    a.available_from,
    a.status,
    a.published_at,
    a.estimated_duration_minutes,
    a.maximum_marks,
    a.submission_required,
    a.teacher_notes
  from learning_assignments a
  join learning_work_types wt on wt.id = a.work_type_id
  join academic_years ay on ay.id = a.academic_year_id
  left join subjects sub on sub.id = a.subject_id
  left join year_groups yg on yg.id = a.intended_year_group_id
  left join users creator on creator.id = a.created_by
`;

const targetSchema = z.object({
  targetType: z.enum(["class", "year_group", "student"]),
  classId: z.string().uuid().optional(),
  yearGroupId: z.string().uuid().optional(),
  studentProfileId: z.string().uuid().optional(),
});

const assignmentBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).nullable().optional(),
  workTypeId: z.string().uuid().optional(),
  workTypeKey: z.string().min(1).max(64).optional(),
  subjectId: z.string().uuid().nullable().optional(),
  academicYearId: z.string().uuid().optional(),
  intendedYearGroupId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  availableFrom: z.string().datetime({ offset: true }).nullable().optional(),
  estimatedDurationMinutes: z.number().int().min(1).max(10080).nullable().optional(),
  maximumMarks: z.number().positive().max(99999).nullable().optional(),
  submissionRequired: z.boolean().optional(),
  teacherNotes: z.string().max(10000).nullable().optional(),
  targets: z.array(targetSchema).max(80).optional(),
});

const assignmentPatchSchema = assignmentBodySchema.partial();

const resourceBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  resourceKind: z.enum(["pdf", "worksheet", "image", "url", "video", "document"]),
  url: z.string().max(2000).nullable().optional(),
});

const markBodySchema = z.object({
  score: z.number().min(0).max(99999).nullable().optional(),
  maximumMarks: z.number().positive().max(99999).nullable().optional(),
  feedback: z.string().max(10000).nullable().optional(),
  releasedToStudent: z.boolean().optional(),
  releasedToParent: z.boolean().optional(),
  resubmissionRequested: z.boolean().optional(),
  status: z.enum(["returned", "completed", "resubmission_requested"]).optional(),
  markedBy: z.string().uuid().optional(),
  markedAt: z.string().optional(),
});

function optionalUuidQuery(value: string | undefined): string | null {
  if (!value) return null;
  if (!z.string().uuid().safeParse(value).success) {
    throw new AppError(404, "not_found", "Not found");
  }
  return value;
}

async function loadWorkTypeId(
  client: pg.PoolClient,
  orgId: string,
  input: { workTypeId?: string; workTypeKey?: string },
): Promise<string> {
  if (input.workTypeId) {
    const row = await client.query<{ id: string }>(
      "select id from learning_work_types where id = $1 and organisation_id = $2",
      [input.workTypeId, orgId],
    );
    if (!row.rows[0]) throw new AppError(404, "not_found", "Not found");
    return row.rows[0].id;
  }
  if (input.workTypeKey) {
    const row = await client.query<{ id: string }>(
      "select id from learning_work_types where organisation_id = $1 and key = $2",
      [orgId, input.workTypeKey],
    );
    if (!row.rows[0]) throw new AppError(404, "not_found", "Not found");
    return row.rows[0].id;
  }
  throw new AppError(400, "validation_failed", "A work type is required");
}

async function loadAssignmentRow(
  client: pg.PoolClient,
  orgId: string,
  assignmentId: string,
): Promise<Record<string, unknown>> {
  const result = await client.query(
    `${ASSIGNMENT_SELECT} where a.id = $1 and a.organisation_id = $2`,
    [assignmentId, orgId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, "not_found", "Not found");
  return row as Record<string, unknown>;
}

async function loadTargets(client: pg.PoolClient, orgId: string, assignmentId: string) {
  const result = await client.query(
    `select t.id, t.target_type, t.class_id, c.name as class_name,
            t.year_group_id, yg.name as year_group_name,
            t.student_profile_id, sp.legal_name as student_legal_name
     from learning_assignment_targets t
     left join classes c on c.id = t.class_id
     left join year_groups yg on yg.id = t.year_group_id
     left join student_profiles sp on sp.id = t.student_profile_id
     where t.assignment_id = $1 and t.organisation_id = $2
     order by t.created_at`,
    [assignmentId, orgId],
  );
  return result.rows.map((row) => mapLearningTarget(row as Record<string, unknown>));
}

async function loadResources(client: pg.PoolClient, orgId: string, assignmentId: string) {
  const result = await client.query(
    `select r.id, r.title, r.resource_kind, r.url, r.content_type, r.byte_size, r.storage_backend
     from learning_assignment_resources ar
     join learning_resources r on r.id = ar.resource_id
     where ar.assignment_id = $1 and ar.organisation_id = $2
     order by ar.sort_order, r.created_at`,
    [assignmentId, orgId],
  );
  return result.rows.map((row) => mapLearningResource(row as Record<string, unknown>));
}

async function loadProgress(client: pg.PoolClient, orgId: string, assignmentId: string) {
  const counts = await client.query<{ assigned: number; submitted: number; marked: number }>(
    `select
       (select count(*)::int from learning_assignment_recipients
        where assignment_id = $1 and organisation_id = $2) as assigned,
       (select count(*)::int from learning_submissions
        where assignment_id = $1 and organisation_id = $2
          and status in ('submitted', 'returned', 'resubmission_requested', 'completed')) as submitted,
       (select count(*)::int from learning_submissions s
        join learning_marks m on m.submission_id = s.id
        where s.assignment_id = $1 and s.organisation_id = $2) as marked`,
    [assignmentId, orgId],
  );
  return summariseLearningProgress({
    assigned: counts.rows[0]?.assigned ?? 0,
    submitted: counts.rows[0]?.submitted ?? 0,
    marked: counts.rows[0]?.marked ?? 0,
  });
}

async function insertTargets(
  client: pg.PoolClient,
  actor: Actor,
  orgId: string,
  assignmentId: string,
  targets: Array<z.infer<typeof targetSchema>>,
): Promise<void> {
  for (const target of targets) {
    if (target.targetType === "class") {
      if (!target.classId) throw new AppError(400, "validation_failed", "classId is required");
      await assertCanTargetClass(client, actor, target.classId);
    } else if (target.targetType === "year_group") {
      if (!target.yearGroupId) throw new AppError(400, "validation_failed", "yearGroupId is required");
      await assertCanTargetYearGroup(client, actor, target.yearGroupId);
    } else {
      if (!target.studentProfileId) {
        throw new AppError(400, "validation_failed", "studentProfileId is required");
      }
      await assertCanTargetStudent(client, actor, target.studentProfileId);
    }
      await client.query(
        `insert into learning_assignment_targets (
           organisation_id, assignment_id, target_type, class_id, year_group_id, student_profile_id, created_by
         ) values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          orgId,
          assignmentId,
          target.targetType,
          target.classId ?? null,
          target.yearGroupId ?? null,
          target.studentProfileId ?? null,
          actor.userId,
        ],
      );
  }
}

async function assignmentVisibleToAssignedTeacher(
  client: pg.PoolClient,
  actor: Actor,
  assignmentId: string,
): Promise<boolean> {
  if (canReadSchoolLearning(actor) || canManageSchoolLearning(actor)) return true;
  try {
    await assertCanReadAssignment(client, actor, assignmentId);
    return true;
  } catch {
    return false;
  }
}

export function registerLearningRoutes(app: SchoolappApi) {
  app.get("/learning/work-types", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, LMS_READ_WORK_PERMISSIONS);
      const rows = await client.query(
        `select id, key, name, sort_order, is_system
         from learning_work_types
         where organisation_id = $1
         order by sort_order, name`,
        [orgId],
      );
      return c.json({ workTypes: rows.rows.map((row) => mapLearningWorkType(row as Record<string, unknown>)) });
    }),
  );

  app.get("/learning/context", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, LMS_READ_WORK_PERMISSIONS);
      const [workTypes, subjects, years, yearGroups, classes] = await Promise.all([
        client.query(
          `select id, key, name, sort_order, is_system from learning_work_types
           where organisation_id = $1 order by sort_order`,
          [orgId],
        ),
        client.query(`select id, name from subjects where organisation_id = $1 order by name`, [orgId]),
        client.query(
          `select id, name, is_current from academic_years where organisation_id = $1 order by starts_on desc`,
          [orgId],
        ),
        client.query(`select id, code, name from year_groups where organisation_id = $1 order by sort_order`, [
          orgId,
        ]),
        client.query(
          `select c.id, c.name, c.class_type, yg.name as year_group_name, c.academic_year_id
           from classes c
           left join year_groups yg on yg.id = c.year_group_id
           where c.organisation_id = $1
           order by c.name`,
          [orgId],
        ),
      ]);
      const authorisedClasses = await loadAuthorisedLearningClassIds(client, actor);
      const visibleClasses = classes.rows.filter(
        (row) => authorisedClasses === null || authorisedClasses.has(String(row.id)),
      );
      return c.json({
        workTypes: workTypes.rows.map((row) => mapLearningWorkType(row as Record<string, unknown>)),
        subjects: subjects.rows.map((row) => ({ id: row.id, name: row.name })),
        academicYears: years.rows,
        yearGroups: yearGroups.rows,
        classes: visibleClasses.map((row) => ({
          id: row.id,
          name: row.name,
          classType: row.class_type,
          yearGroupName: row.year_group_name,
          academicYearId: row.academic_year_id,
        })),
        canTargetYearGroups: canManageSchoolLearning(actor),
      });
    }),
  );

  app.get("/learning/assignments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, LMS_READ_WORK_PERMISSIONS);
      const status = c.req.query("status");
      const classId = optionalUuidQuery(c.req.query("classId"));
      const subjectId = optionalUuidQuery(c.req.query("subjectId"));
      const dueFrom = c.req.query("dueFrom") || null;
      const dueTo = c.req.query("dueTo") || null;
      const authorisedClasses = await loadAuthorisedLearningClassIds(client, actor);
      const rows = await client.query(
        `${ASSIGNMENT_SELECT}
         where a.organisation_id = $1
           and ($2::text is null or a.status = $2)
           and ($3::uuid is null or a.subject_id = $3)
           and ($4::timestamptz is null or a.due_at >= $4::timestamptz)
           and ($5::timestamptz is null or a.due_at <= $5::timestamptz)
           and (
             $6::uuid is null
             or exists (
               select 1 from learning_assignment_targets t
               where t.assignment_id = a.id and t.class_id = $6
             )
           )
         order by a.due_at nulls last, a.created_at desc`,
        [orgId, status || null, subjectId, dueFrom, dueTo, classId],
      );
      const assignments = [];
      for (const row of rows.rows) {
        if (authorisedClasses && !(await assignmentVisibleToAssignedTeacher(client, actor, String(row.id)))) {
          continue;
        }
        const progress = await loadProgress(client, orgId, String(row.id));
        assignments.push({
          ...mapLearningAssignment(row as Record<string, unknown>, { includeTeacherNotes: true }),
          progress,
        });
      }
      return c.json({ assignments });
    }),
  );

  app.post("/learning/assignments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, LMS_ASSIGN_PERMISSIONS);
      const parsed = assignmentBodySchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid assignment");
      const workTypeId = await loadWorkTypeId(client, orgId, parsed.data);
      let academicYearId = parsed.data.academicYearId ?? null;
      if (!academicYearId) {
        const current = await client.query<{ id: string }>(
          "select id from academic_years where organisation_id = $1 and is_current limit 1",
          [orgId],
        );
        academicYearId = current.rows[0]?.id ?? null;
      }
      if (!academicYearId) throw new AppError(400, "validation_failed", "An academic year is required");
      if (parsed.data.subjectId) {
        const subject = await client.query(
          "select 1 from subjects where id = $1 and organisation_id = $2",
          [parsed.data.subjectId, orgId],
        );
        if (!subject.rows[0]) throw new AppError(404, "not_found", "Not found");
      }
      const created = await client.query<{ id: string }>(
        `insert into learning_assignments (
           organisation_id, title, description, work_type_id, subject_id, academic_year_id,
           intended_year_group_id, created_by, due_at, available_from, estimated_duration_minutes,
           maximum_marks, submission_required, teacher_notes
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         returning id`,
        [
          orgId,
          parsed.data.title,
          parsed.data.description ?? null,
          workTypeId,
          parsed.data.subjectId ?? null,
          academicYearId,
          parsed.data.intendedYearGroupId ?? null,
          userId,
          parsed.data.dueAt ?? null,
          parsed.data.availableFrom ?? null,
          parsed.data.estimatedDurationMinutes ?? null,
          parsed.data.maximumMarks ?? null,
          parsed.data.submissionRequired ?? true,
          parsed.data.teacherNotes ?? null,
        ],
      );
      const id = created.rows[0]!.id;
      if (parsed.data.targets?.length) {
        await insertTargets(client, actor, orgId, id, parsed.data.targets);
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "learning.assignment.create",
        entityType: "learning_assignment",
        entityId: id,
        after: { title: parsed.data.title, status: "draft" },
      });
      const row = await loadAssignmentRow(client, orgId, id);
      return c.json(
        {
          assignment: {
            ...mapLearningAssignment(row, { includeTeacherNotes: true }),
            targets: await loadTargets(client, orgId, id),
            resources: [],
            progress: await loadProgress(client, orgId, id),
          },
        },
        201,
      );
    }),
  );

  app.get("/learning/assignments/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const id = uuidRouteParam(c, "id");
      await assertCanReadAssignment(client, actor, id);
      const row = await loadAssignmentRow(client, orgId, id);
      const history = await client.query(
        `select previous_status, new_status, actor_user_id, created_at
         from learning_assignment_status_history
         where assignment_id = $1 and organisation_id = $2
         order by created_at`,
        [id, orgId],
      );
      return c.json({
        assignment: {
          ...mapLearningAssignment(row, { includeTeacherNotes: true }),
          targets: await loadTargets(client, orgId, id),
          resources: await loadResources(client, orgId, id),
          progress: await loadProgress(client, orgId, id),
          statusHistory: history.rows.map((item) => ({
            previousStatus: item.previous_status,
            newStatus: item.new_status,
            actorUserId: item.actor_user_id,
            createdAt: item.created_at,
          })),
        },
      });
    }),
  );

  app.patch("/learning/assignments/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      await assertCanManageAssignment(client, actor, id);
      const parsed = assignmentPatchSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid assignment");
      const existing = await loadAssignmentRow(client, orgId, id);
      if (existing.status === "archived") {
        throw new AppError(409, "invalid_status_transition", "Archived work cannot be edited");
      }
      const workTypeId =
        parsed.data.workTypeId || parsed.data.workTypeKey
          ? await loadWorkTypeId(client, orgId, parsed.data)
          : String(existing.work_type_id);
      if (existing.status !== "draft" && workTypeId !== String(existing.work_type_id)) {
        throw new AppError(409, "conflict", "Work type can only be changed while the assignment is a draft");
      }
      const updated = await client.query(
        `update learning_assignments set
           title = coalesce($3, title),
           description = case when $4::boolean then $5 else description end,
           work_type_id = $6,
           subject_id = case when $7::boolean then $8 else subject_id end,
           intended_year_group_id = case when $9::boolean then $10 else intended_year_group_id end,
           due_at = case when $11::boolean then $12 else due_at end,
           available_from = case when $13::boolean then $14 else available_from end,
           estimated_duration_minutes = case when $15::boolean then $16 else estimated_duration_minutes end,
           maximum_marks = case when $17::boolean then $18 else maximum_marks end,
           submission_required = coalesce($19, submission_required),
           teacher_notes = case when $20::boolean then $21 else teacher_notes end
         where id = $1 and organisation_id = $2
         returning id`,
        [
          id,
          orgId,
          parsed.data.title ?? null,
          parsed.data.description !== undefined,
          parsed.data.description ?? null,
          workTypeId,
          parsed.data.subjectId !== undefined,
          parsed.data.subjectId ?? null,
          parsed.data.intendedYearGroupId !== undefined,
          parsed.data.intendedYearGroupId ?? null,
          parsed.data.dueAt !== undefined,
          parsed.data.dueAt ?? null,
          parsed.data.availableFrom !== undefined,
          parsed.data.availableFrom ?? null,
          parsed.data.estimatedDurationMinutes !== undefined,
          parsed.data.estimatedDurationMinutes ?? null,
          parsed.data.maximumMarks !== undefined,
          parsed.data.maximumMarks ?? null,
          parsed.data.submissionRequired ?? null,
          parsed.data.teacherNotes !== undefined,
          parsed.data.teacherNotes ?? null,
        ],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      if (parsed.data.targets) {
        if (existing.status !== "draft") {
          await insertTargets(client, actor, orgId, id, parsed.data.targets);
          if (existing.status === "published") {
            await snapshotAssignmentRecipients(client, orgId, id, String(existing.academic_year_id));
            await notifyLearningAssigned(client, {
              organisationId: orgId,
              actorUserId: userId,
              assignmentId: id,
              title: String(existing.title),
              dueAt: existing.due_at ? String(existing.due_at) : null,
            });
          }
        } else {
          await client.query(
            "delete from learning_assignment_targets where assignment_id = $1 and organisation_id = $2",
            [id, orgId],
          );
          await insertTargets(client, actor, orgId, id, parsed.data.targets);
        }
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "learning.assignment.update",
        entityType: "learning_assignment",
        entityId: id,
      });
      const row = await loadAssignmentRow(client, orgId, id);
      return c.json({
        assignment: {
          ...mapLearningAssignment(row, { includeTeacherNotes: true }),
          targets: await loadTargets(client, orgId, id),
          resources: await loadResources(client, orgId, id),
          progress: await loadProgress(client, orgId, id),
        },
      });
    }),
  );

  async function transitionAssignment(
    client: pg.PoolClient,
    actor: Actor,
    orgId: string,
    userId: string,
    assignmentId: string,
    status: "published" | "closed" | "archived",
  ) {
    await assertCanManageAssignment(client, actor, assignmentId);
    const existing = await loadAssignmentRow(client, orgId, assignmentId);
    const updated = await client.query(
      `update learning_assignments set status = $3
       where id = $1 and organisation_id = $2
       returning id, title, due_at, academic_year_id`,
      [assignmentId, orgId, status],
    );
    const row = updated.rows[0];
    if (!row) throw new AppError(404, "not_found", "Not found");
    if (status === "published") {
      await snapshotAssignmentRecipients(client, orgId, assignmentId, String(row.academic_year_id));
      await notifyLearningAssigned(client, {
        organisationId: orgId,
        actorUserId: userId,
        assignmentId,
        title: String(row.title),
        dueAt: row.due_at ? String(row.due_at) : null,
      });
    }
    await writeAudit(client, {
      organisationId: orgId,
      actorUserId: userId,
      action: `learning.assignment.${status}`,
      entityType: "learning_assignment",
      entityId: assignmentId,
      before: { status: existing.status },
      after: { status },
    });
    return loadAssignmentRow(client, orgId, assignmentId);
  }

  app.post("/learning/assignments/:id/publish", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await transitionAssignment(client, actor, orgId, userId, id, "published");
      return c.json({
        assignment: {
          ...mapLearningAssignment(row, { includeTeacherNotes: true }),
          targets: await loadTargets(client, orgId, id),
          progress: await loadProgress(client, orgId, id),
        },
      });
    }),
  );

  app.post("/learning/assignments/:id/close", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await transitionAssignment(client, actor, orgId, userId, id, "closed");
      return c.json({ assignment: mapLearningAssignment(row, { includeTeacherNotes: true }) });
    }),
  );

  app.post("/learning/assignments/:id/archive", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await transitionAssignment(client, actor, orgId, userId, id, "archived");
      return c.json({ assignment: mapLearningAssignment(row, { includeTeacherNotes: true }) });
    }),
  );

  app.post("/learning/assignments/:id/targets", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const id = uuidRouteParam(c, "id");
      await assertCanManageAssignment(client, actor, id);
      const parsed = z.object({ targets: z.array(targetSchema).min(1).max(80) }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid targets");
      const existing = await loadAssignmentRow(client, orgId, id);
      await insertTargets(client, actor, orgId, id, parsed.data.targets);
      if (existing.status === "published") {
        await snapshotAssignmentRecipients(client, orgId, id, String(existing.academic_year_id));
        await notifyLearningAssigned(client, {
          organisationId: orgId,
          actorUserId: actor.userId,
          assignmentId: id,
          title: String(existing.title),
          dueAt: existing.due_at ? String(existing.due_at) : null,
        });
      }
      return c.json({ targets: await loadTargets(client, orgId, id) });
    }),
  );

  app.post("/learning/assignments/:id/resources", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      await assertCanManageAssignment(client, actor, id);
      const parsed = resourceBodySchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid resource");
      if (!parsed.data.url || !isAllowedLearningUrl(parsed.data.url)) {
        throw new AppError(400, "validation_failed", "A valid http(s) resource URL is required");
      }
      const resource = await client.query<{ id: string }>(
        `insert into learning_resources (
           organisation_id, title, resource_kind, url, created_by
         ) values ($1, $2, $3, $4, $5)
         returning id`,
        [orgId, parsed.data.title, parsed.data.resourceKind, parsed.data.url, userId],
      );
      await client.query(
        `insert into learning_assignment_resources (
           organisation_id, assignment_id, resource_id
         ) values ($1, $2, $3)
         on conflict (assignment_id, resource_id) do nothing`,
        [orgId, id, resource.rows[0]!.id],
      );
      return c.json({ resources: await loadResources(client, orgId, id) }, 201);
    }),
  );

  app.get("/learning/assignments/:id/progress", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const id = uuidRouteParam(c, "id");
      await assertCanReadAssignment(client, actor, id);
      const row = await loadAssignmentRow(client, orgId, id);
      return c.json({
        assignmentId: id,
        title: row.title,
        ...((await loadProgress(client, orgId, id)) as object),
      });
    }),
  );

  app.get("/learning/assignments/:id/submissions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const id = uuidRouteParam(c, "id");
      await assertCanReadAssignment(client, actor, id);
      assertAnyPermission(actor, LMS_READ_SUBMISSION_PERMISSIONS);
      const rows = await client.query(
        `select r.student_profile_id, sp.legal_name as student_legal_name,
                s.id, s.status, s.submitted_at, s.current_revision_id,
                m.id as mark_id, m.score, m.maximum_marks, m.feedback,
                m.released_to_student, m.released_to_parent, m.resubmission_requested,
                m.marked_by, marker.full_name as marked_by_name, m.marked_at
         from learning_assignment_recipients r
         join student_profiles sp on sp.id = r.student_profile_id
         left join learning_submissions s
           on s.assignment_id = r.assignment_id and s.student_profile_id = r.student_profile_id
         left join learning_marks m on m.submission_id = s.id
         left join users marker on marker.id = m.marked_by
         where r.assignment_id = $1 and r.organisation_id = $2
         order by sp.legal_name`,
        [id, orgId],
      );
      const submissions = [];
      for (const row of rows.rows) {
        if (!(await canSeeLearningRecipient(client, actor, id, String(row.student_profile_id)))) {
          continue;
        }
        submissions.push({
          studentProfileId: row.student_profile_id,
          studentLegalName: row.student_legal_name,
          submissionId: row.id,
          status: row.status ?? "not_started",
          submittedAt: row.submitted_at,
          mark: row.mark_id
            ? mapLearningMark(
                {
                  id: row.mark_id,
                  score: row.score,
                  maximum_marks: row.maximum_marks,
                  feedback: row.feedback,
                  released_to_student: row.released_to_student,
                  released_to_parent: row.released_to_parent,
                  resubmission_requested: row.resubmission_requested,
                  marked_by: row.marked_by,
                  marked_by_name: row.marked_by_name,
                  marked_at: row.marked_at,
                  submission_status: row.status,
                },
                { audience: "staff" },
              )
            : null,
        });
      }
      return c.json({ submissions, progress: await loadProgress(client, orgId, id) });
    }),
  );

  app.get("/learning/submissions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, LMS_READ_SUBMISSION_PERMISSIONS);
      const status = c.req.query("status");
      const classId = optionalUuidQuery(c.req.query("classId"));
      const subjectId = optionalUuidQuery(c.req.query("subjectId"));
      const rows = await client.query(
        `select s.id, s.assignment_id, a.title, a.status as assignment_status, a.due_at,
                wt.name as work_type_name, sub.name as subject_name,
                s.student_profile_id, sp.legal_name as student_legal_name,
                s.status, s.submitted_at, s.current_revision_id,
                m.id as mark_id, m.score, m.maximum_marks, m.released_to_student, m.released_to_parent
         from learning_submissions s
         join learning_assignments a on a.id = s.assignment_id
         join learning_work_types wt on wt.id = a.work_type_id
         join student_profiles sp on sp.id = s.student_profile_id
         left join subjects sub on sub.id = a.subject_id
         left join learning_marks m on m.submission_id = s.id
         where s.organisation_id = $1
           and ($2::text is null or s.status = $2)
           and ($3::uuid is null or a.subject_id = $3)
           and (
             $4::uuid is null
             or exists (
               select 1 from learning_assignment_recipients r
               where r.assignment_id = a.id and r.class_id = $4
             )
           )
         order by s.submitted_at desc nulls last, a.due_at`,
        [orgId, status || null, subjectId, classId],
      );
      const submissions = [];
      for (const row of rows.rows) {
        if (!(await canSeeLearningRecipient(client, actor, String(row.assignment_id), String(row.student_profile_id)))) {
          continue;
        }
        submissions.push({
            id: row.id,
            assignmentId: row.assignment_id,
            title: row.title,
            assignmentStatus: row.assignment_status,
            dueAt: row.due_at,
            workTypeName: row.work_type_name,
            subjectName: row.subject_name,
            studentProfileId: row.student_profile_id,
            studentLegalName: row.student_legal_name,
            status: row.status,
            submittedAt: row.submitted_at,
            marked: Boolean(row.mark_id),
        });
      }
      return c.json({ submissions });
    }),
  );

  app.get("/learning/submissions/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await client.query(
        `select s.id, s.assignment_id, s.student_profile_id, sp.legal_name as student_legal_name,
                s.status, s.submitted_at, s.submitted_by, s.current_revision_id,
                rev.text_response, rev.comment, rev.revision_number,
                a.title, a.description, a.teacher_notes, a.maximum_marks, a.due_at,
                wt.name as work_type_name, sub.name as subject_name
         from learning_submissions s
         join student_profiles sp on sp.id = s.student_profile_id
         join learning_assignments a on a.id = s.assignment_id
         join learning_work_types wt on wt.id = a.work_type_id
         left join subjects sub on sub.id = a.subject_id
         left join learning_submission_revisions rev on rev.id = s.current_revision_id
         where s.id = $1 and s.organisation_id = $2`,
        [id, orgId],
      );
      const submission = row.rows[0];
      if (!submission) throw new AppError(404, "not_found", "Not found");
      await assertCanReadOrMarkSubmission(
        client,
        actor,
        String(submission.student_profile_id),
        "read",
        String(submission.assignment_id),
      );
      const revisions = await client.query(
        `select id, revision_number, text_response, comment, submitted_at
         from learning_submission_revisions
         where submission_id = $1 and organisation_id = $2
         order by revision_number`,
        [id, orgId],
      );
      const mark = await client.query(
        `select m.id, m.score, m.maximum_marks, m.feedback, m.released_to_student, m.released_to_parent,
                m.resubmission_requested, m.marked_by, u.full_name as marked_by_name, m.marked_at
         from learning_marks m
         left join users u on u.id = m.marked_by
         where m.submission_id = $1 and m.organisation_id = $2`,
        [id, orgId],
      );
      return c.json({
        submission: {
          ...mapLearningSubmission(submission as Record<string, unknown>, { audience: "staff" }),
          assignmentTitle: submission.title,
          assignmentDescription: submission.description,
          teacherNotes: submission.teacher_notes,
          dueAt: submission.due_at,
          workTypeName: submission.work_type_name,
          subjectName: submission.subject_name,
          maximumMarks: submission.maximum_marks != null ? Number(submission.maximum_marks) : null,
          revisions: revisions.rows.map((item) => mapLearningRevision(item as Record<string, unknown>)),
          mark: mapLearningMark(mark.rows[0] as Record<string, unknown> | undefined, { audience: "staff" }),
        },
      });
    }),
  );

  app.post("/learning/submissions/:id/marks", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      assertAnyPermission(actor, LMS_MARK_PERMISSIONS);
      const parsed = markBodySchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid mark");
      const submission = await client.query<{
        id: string;
        assignment_id: string;
        student_profile_id: string;
        status: string;
        title: string;
        maximum_marks: string | null;
        user_id: string | null;
      }>(
        `select s.id, s.assignment_id, s.student_profile_id, s.status, a.title, a.maximum_marks::text, sp.user_id
         from learning_submissions s
         join learning_assignments a on a.id = s.assignment_id
         join student_profiles sp on sp.id = s.student_profile_id
         where s.id = $1 and s.organisation_id = $2`,
        [id, orgId],
      );
      const row = submission.rows[0];
      if (!row) throw new AppError(404, "not_found", "Not found");
      await assertCanReadOrMarkSubmission(client, actor, row.student_profile_id, "mark", row.assignment_id);
      if (!canMarkSchoolLearning(actor) && !canMarkAssignedLearning(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const assignmentMax = row.maximum_marks != null ? Number(row.maximum_marks) : null;
      const maximum = assignmentMax ?? parsed.data.maximumMarks ?? null;
      if (
        parsed.data.maximumMarks != null &&
        assignmentMax != null &&
        parsed.data.maximumMarks > assignmentMax
      ) {
        throw new AppError(400, "validation_failed", "Score must be between 0 and the maximum marks");
      }
      if (!isScoreInRange(parsed.data.score ?? null, maximum)) {
        throw new AppError(400, "validation_failed", "Score must be between 0 and the maximum marks");
      }
      const resubmission = parsed.data.resubmissionRequested ?? parsed.data.status === "resubmission_requested";
      const nextStatus =
        parsed.data.status ?? (resubmission ? "resubmission_requested" : "returned");
      await client.query(
        `insert into learning_marks (
           organisation_id, submission_id, score, maximum_marks, feedback,
           released_to_student, released_to_parent, resubmission_requested, marked_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (submission_id) do update set
           score = excluded.score,
           maximum_marks = excluded.maximum_marks,
           feedback = excluded.feedback,
           released_to_student = excluded.released_to_student,
           released_to_parent = excluded.released_to_parent,
           resubmission_requested = excluded.resubmission_requested`,
        [
          orgId,
          id,
          parsed.data.score ?? null,
          maximum,
          parsed.data.feedback ?? null,
          parsed.data.releasedToStudent ?? false,
          parsed.data.releasedToParent ?? false,
          resubmission,
          userId,
        ],
      );
      await client.query(
        `update learning_submissions set status = $3
         where id = $1 and organisation_id = $2`,
        [id, orgId, nextStatus],
      );
      await notifyLearningFeedback(client, {
        organisationId: orgId,
        actorUserId: userId,
        assignmentId: row.assignment_id,
        submissionId: id,
        title: row.title,
        studentUserId: row.user_id,
        studentProfileId: row.student_profile_id,
        releaseToStudent: parsed.data.releasedToStudent ?? false,
        releaseToParent: parsed.data.releasedToParent ?? false,
        resubmission,
      });
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "learning.submission.mark",
        entityType: "learning_submission",
        entityId: id,
        after: {
          status: nextStatus,
          releasedToStudent: parsed.data.releasedToStudent ?? false,
          releasedToParent: parsed.data.releasedToParent ?? false,
        },
      });
      const mark = await client.query(
        `select m.id, m.score, m.maximum_marks, m.feedback, m.released_to_student, m.released_to_parent,
                m.resubmission_requested, m.marked_by, u.full_name as marked_by_name, m.marked_at
         from learning_marks m
         left join users u on u.id = m.marked_by
         where m.submission_id = $1`,
        [id],
      );
      return c.json({
        mark: mapLearningMark(mark.rows[0] as Record<string, unknown>, { audience: "staff" }),
        status: nextStatus,
      });
    }),
  );

  app.get("/learning/dashboard", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, LMS_READ_WORK_PERMISSIONS);
      const classId = optionalUuidQuery(c.req.query("classId"));
      const subjectId = optionalUuidQuery(c.req.query("subjectId"));
      const status = c.req.query("status") || "published";
      const rows = await client.query(
        `select a.id, a.title, a.status, a.due_at, wt.name as work_type_name, sub.name as subject_name
         from learning_assignments a
         join learning_work_types wt on wt.id = a.work_type_id
         left join subjects sub on sub.id = a.subject_id
         where a.organisation_id = $1
           and ($2::text is null or a.status = $2)
           and ($3::uuid is null or a.subject_id = $3)
           and (
             $4::uuid is null
             or exists (
               select 1 from learning_assignment_targets t
               where t.assignment_id = a.id and t.class_id = $4
             )
           )
         order by a.due_at nulls last, a.created_at desc
         limit 50`,
        [orgId, status === "all" ? null : status, subjectId, classId],
      );
      const items = [];
      for (const row of rows.rows) {
        if (!(await assignmentVisibleToAssignedTeacher(client, actor, String(row.id)))) continue;
        items.push({
          assignmentId: row.id,
          title: row.title,
          status: row.status,
          dueAt: row.due_at,
          workTypeName: row.work_type_name,
          subjectName: row.subject_name,
          ...(await loadProgress(client, orgId, String(row.id))),
        });
      }
      return c.json({ assignments: items });
    }),
  );

  app.get("/students/:id/learning", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const studentId = uuidRouteParam(c, "id");
      assertAnyPermission(actor, LMS_READ_WORK_PERMISSIONS);
      const student = await client.query<{ id: string }>(
        "select id from student_profiles where id = $1 and organisation_id = $2",
        [studentId, orgId],
      );
      if (!student.rows[0]) throw new AppError(404, "not_found", "Not found");
      await assertCanReadOrMarkSubmission(client, actor, studentId, "read");
      const rows = await client.query(
        `select a.id, a.title, a.status, a.due_at, a.published_at, a.teacher_notes,
                wt.key as work_type_key, wt.name as work_type_name, sub.name as subject_name,
                s.id as submission_id, s.status as submission_status, s.submitted_at,
                m.score, m.maximum_marks, m.feedback, m.released_to_student, m.released_to_parent, m.marked_at
         from learning_assignment_recipients r
         join learning_assignments a on a.id = r.assignment_id
         join learning_work_types wt on wt.id = a.work_type_id
         left join subjects sub on sub.id = a.subject_id
         left join learning_submissions s
           on s.assignment_id = a.id and s.student_profile_id = r.student_profile_id
         left join learning_marks m on m.submission_id = s.id
         where r.student_profile_id = $1 and r.organisation_id = $2
           and a.status in ('published', 'closed', 'archived')
         order by a.due_at nulls last, a.published_at desc`,
        [studentId, orgId],
      );
      return c.json({
        items: rows.rows.map((row) => ({
          assignmentId: row.id,
          title: row.title,
          status: row.status,
          dueAt: row.due_at,
          workTypeKey: row.work_type_key,
          workTypeName: row.work_type_name,
          subjectName: row.subject_name,
          submissionStatus: row.submission_status ?? "not_started",
          submittedAt: row.submitted_at,
          teacherNotes: row.teacher_notes,
          mark: row.score != null || row.feedback
            ? {
                score: row.score != null ? Number(row.score) : null,
                maximumMarks: row.maximum_marks != null ? Number(row.maximum_marks) : null,
                feedback: row.feedback,
                markedAt: row.marked_at,
                releasedToStudent: row.released_to_student,
                releasedToParent: row.released_to_parent,
              }
            : null,
        })),
      });
    }),
  );
}

export { loadAssignmentRow, loadResources, loadTargets, ASSIGNMENT_SELECT };
