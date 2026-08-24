import { z } from "zod";
import type pg from "pg";
import type { Context } from "hono";
import {
  ACTIVITY_MANAGE_PERMISSIONS,
  ACTIVITY_READ_PERMISSIONS,
  AppError,
  activityDatesValid,
  activityDeadlineValid,
  activityOpenForStaffChanges,
  activityStaffSeesMedicalWindow,
  allocateRegistrationStatus,
  applyConsentDecision,
  assignedClassIds,
  assignedStudentIds,
  assertAnyPermission,
  assertCanManageStaffActivity,
  assertCanPublishActivity,
  assertCanReadStaffActivity,
  assertCanTargetActivity,
  auditActivity,
  availableSpaces,
  canManageAssignedActivities,
  canManageParticipants,
  canManageResponses,
  canManageSchoolActivities,
  canPublishActivities,
  canReadMedicalSummary,
  canReadResponses,
  canReadSchoolActivities,
  isActivityStatusTransitionAllowed,
  isSchoolActivityAttendanceStatus,
  isSchoolActivityDocumentVisibility,
  isSchoolActivityStaffRole,
  isSchoolActivityStatus,
  loadActivitySafetySummaries,
  maybePromoteNextWaitlisted,
  nextWaitingListPosition,
  notifyActivityCancelled,
  notifyActivityPublished,
  pupilIsEligible,
  replaceActivityTargets,
  snapshotActivityEligibility,
  upsertParticipant,
  lockActivityCapacity,
  writeAudit,
} from "@schoolapp/core";
import type { ApiEnv, SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import {
  insertPendingObject,
  putAndActivateObject,
  readUploadedFile,
  runUpload,
  scannerOf,
  storageOf,
  validateBytes,
} from "../file-service";
import {
  mapActivityClause,
  mapActivityDocument,
  mapActivityParticipant,
  mapActivityResponse,
  mapActivityStaff,
  mapActivityTarget,
  mapActivityType,
  mapActivityUpdate,
  mapSchoolActivity,
} from "../serialize";

const ACTIVITY_SELECT = `
  select a.*, t.key as activity_type_key, t.name as activity_type_name
  from school_activities a
  join school_activity_types t on t.id = a.activity_type_id
`;

const targetSchema = z.object({
  targetType: z.enum(["whole_school", "year_group", "class", "student", "staff_member"]),
  classId: z.string().uuid().optional(),
  yearGroupId: z.string().uuid().optional(),
  studentProfileId: z.string().uuid().optional(),
  staffUserId: z.string().uuid().optional(),
});

const clauseSchema = z.object({
  clauseKey: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  title: z.string().trim().min(1).max(200),
  wording: z.string().trim().min(1).max(20000),
  required: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100).optional(),
});

const activityBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).nullable().optional(),
  activityTypeId: z.string().uuid().optional(),
  activityTypeKey: z.string().min(1).max(64).optional(),
  academicYearId: z.string().uuid().nullable().optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  allDay: z.boolean().optional(),
  location: z.string().max(200).nullable().optional(),
  externalAddress: z.string().max(500).nullable().optional(),
  meetingPoint: z.string().max(200).nullable().optional(),
  returnPoint: z.string().max(200).nullable().optional(),
  capacity: z.number().int().min(0).max(100000).nullable().optional(),
  responseDeadlineAt: z.string().datetime({ offset: true }).nullable().optional(),
  allowResponsesAfterDeadline: z.boolean().optional(),
  consentRequired: z.boolean().optional(),
  parentResponseRequired: z.boolean().optional(),
  studentSignupEnabled: z.boolean().optional(),
  studentVisible: z.boolean().optional(),
  parentVisible: z.boolean().optional(),
  occurrenceKind: z.enum(["one_off", "recurring"]).optional(),
  recurrenceWeekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).nullable().optional(),
  recurrenceUntil: z.string().date().nullable().optional(),
  staffNotes: z.string().max(20000).nullable().optional(),
  parentNotes: z.string().max(20000).nullable().optional(),
  targets: z.array(targetSchema).max(80).optional(),
  consentClauses: z.array(clauseSchema).max(20).optional(),
  staff: z
    .array(
      z.object({
        staffUserId: z.string().uuid(),
        staffRole: z.enum(["lead", "trip_leader", "accompanying", "support"]).optional(),
      }),
    )
    .max(40)
    .optional(),
});

const activityPatchSchema = activityBodySchema.partial();

async function loadActivityTypeId(
  client: pg.PoolClient,
  orgId: string,
  input: { activityTypeId?: string; activityTypeKey?: string },
): Promise<string> {
  if (input.activityTypeId) {
    const row = await client.query<{ id: string }>(
      "select id from school_activity_types where id = $1 and organisation_id = $2",
      [input.activityTypeId, orgId],
    );
    if (!row.rows[0]) throw new AppError(404, "not_found", "Not found");
    return row.rows[0].id;
  }
  const key = input.activityTypeKey ?? "other";
  const row = await client.query<{ id: string }>(
    "select id from school_activity_types where organisation_id = $1 and key = $2",
    [orgId, key],
  );
  if (!row.rows[0]) throw new AppError(404, "not_found", "Not found");
  return row.rows[0].id;
}

async function replaceClauses(
  client: pg.PoolClient,
  orgId: string,
  activityId: string,
  clauses: z.infer<typeof clauseSchema>[],
): Promise<void> {
  await client.query(
    `delete from school_activity_consent_clauses where activity_id = $1 and organisation_id = $2`,
    [activityId, orgId],
  );
  for (const [index, clause] of clauses.entries()) {
    await client.query(
      `insert into school_activity_consent_clauses (
         organisation_id, activity_id, clause_key, title, wording, required, sort_order
       ) values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        orgId,
        activityId,
        clause.clauseKey,
        clause.title,
        clause.wording,
        clause.required ?? true,
        clause.sortOrder ?? index,
      ],
    );
  }
}

async function replaceStaff(
  client: pg.PoolClient,
  orgId: string,
  activityId: string,
  actorUserId: string,
  staff: Array<{ staffUserId: string; staffRole?: string }>,
): Promise<void> {
  await client.query(`delete from school_activity_staff where activity_id = $1 and organisation_id = $2`, [
    activityId,
    orgId,
  ]);
  for (const member of staff) {
    await client.query(
      `insert into school_activity_staff (organisation_id, activity_id, staff_user_id, staff_role, created_by)
       values ($1,$2,$3,$4,$5)`,
      [orgId, activityId, member.staffUserId, member.staffRole ?? "accompanying", actorUserId],
    );
  }
}

async function loadActivityBundle(
  client: pg.PoolClient,
  orgId: string,
  activityId: string,
  options?: { includeInternal?: boolean },
) {
  const activity = await client.query(`${ACTIVITY_SELECT} where a.id = $1 and a.organisation_id = $2`, [
    activityId,
    orgId,
  ]);
  const row = activity.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new AppError(404, "not_found", "Not found");
  const [targets, staff, clauses, documents, updates, counts] = await Promise.all([
    client.query(`select * from school_activity_targets where activity_id = $1 order by created_at`, [activityId]),
    client.query(
      `select s.*, u.full_name from school_activity_staff s
       join users u on u.id = s.staff_user_id
       where s.activity_id = $1 order by s.created_at`,
      [activityId],
    ),
    client.query(
      `select * from school_activity_consent_clauses where activity_id = $1 order by sort_order, clause_key`,
      [activityId],
    ),
    client.query(
      `select * from school_activity_documents where activity_id = $1 and deleted_at is null order by created_at`,
      [activityId],
    ),
    client.query(
      `select * from school_activity_updates where activity_id = $1 order by published_at desc`,
      [activityId],
    ),
    client.query<{
      eligible: number;
      confirmed: number;
      waitlisted: number;
      consented: number;
      declined: number;
      pending: number;
    }>(
      `select
         (select count(*)::int from school_activity_eligible_pupils e where e.activity_id = $1) as eligible,
         (select count(*)::int from school_activity_participants p where p.activity_id = $1 and p.registration_status = 'confirmed') as confirmed,
         (select count(*)::int from school_activity_participants p where p.activity_id = $1 and p.registration_status = 'waitlisted') as waitlisted,
         (select count(*)::int from school_activity_responses r where r.activity_id = $1 and r.is_effective and r.response = 'consented') as consented,
         (select count(*)::int from school_activity_responses r where r.activity_id = $1 and r.is_effective and r.response = 'declined') as declined,
         (select count(*)::int from school_activity_eligible_pupils e
           where e.activity_id = $1 and not exists (
             select 1 from school_activity_responses r
             where r.activity_id = e.activity_id and r.student_profile_id = e.student_profile_id and r.is_effective
           )) as pending`,
      [activityId],
    ),
  ]);
  const summary = counts.rows[0]!;
  return {
    activity: mapSchoolActivity(row, { includeInternal: options?.includeInternal !== false }),
    targets: targets.rows.map((item) => mapActivityTarget(item as Record<string, unknown>)),
    staff: staff.rows.map((item) => mapActivityStaff(item as Record<string, unknown>)),
    consentClauses: clauses.rows.map((item) => mapActivityClause(item as Record<string, unknown>)),
    documents: documents.rows.map((item) => mapActivityDocument(item as Record<string, unknown>)),
    updates: updates.rows.map((item) => mapActivityUpdate(item as Record<string, unknown>)),
    summary: {
      eligible: summary.eligible,
      responded: summary.consented + summary.declined,
      consented: summary.consented,
      declined: summary.declined,
      pending: summary.pending,
      confirmed: summary.confirmed,
      waitlisted: summary.waitlisted,
      capacity: (row.capacity as number | null) ?? null,
      availableSpaces: availableSpaces((row.capacity as number | null) ?? null, summary.confirmed),
    },
  };
}

export function registerActivityRoutes(app: SchoolappApi) {
  app.get("/activities/types", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, ACTIVITY_READ_PERMISSIONS);
      const rows = await client.query(
        `select id, key, name, sort_order, is_system, is_active
         from school_activity_types
         where organisation_id = $1
         order by sort_order, name`,
        [orgId],
      );
      return c.json({ types: rows.rows.map((row) => mapActivityType(row as Record<string, unknown>)) });
    }),
  );

  app.get("/activities/context", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, ACTIVITY_READ_PERMISSIONS);
      const [types, years, yearGroups, classes, staff] = await Promise.all([
        client.query(
          `select id, key, name, sort_order, is_system, is_active from school_activity_types
           where organisation_id = $1 order by sort_order`,
          [orgId],
        ),
        client.query(
          `select id, name, is_current from academic_years where organisation_id = $1 order by starts_on desc`,
          [orgId],
        ),
        client.query(`select id, code, name from year_groups where organisation_id = $1 order by sort_order`, [
          orgId,
        ]),
        client.query(`select id, name, year_group_id, academic_year_id from classes where organisation_id = $1 order by name`, [
          orgId,
        ]),
        client.query(
          `select u.id, u.full_name
           from organisation_memberships m
           join users u on u.id = m.user_id
           join membership_roles mr on mr.membership_id = m.id
           join roles r on r.id = mr.role_id
           where m.organisation_id = $1 and m.status = 'active'
             and r.key in ('school.admin', 'school.headteacher', 'school.teacher', 'school.staff')
           order by u.full_name`,
          [orgId],
        ),
      ]);
      return c.json({
        types: types.rows.map((row) => mapActivityType(row as Record<string, unknown>)),
        academicYears: years.rows,
        yearGroups: yearGroups.rows,
        classes: classes.rows,
        staff: staff.rows,
        canTargetYearGroups: canManageSchoolActivities(actor),
        canPublish: canPublishActivities(actor),
        canManageParticipants: canManageParticipants(actor),
        canManageResponses: canManageResponses(actor),
        canReadMedical: canReadMedicalSummary(actor),
      });
    }),
  );

  app.get("/activities", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, ACTIVITY_READ_PERMISSIONS);
      const status = c.req.query("status");
      const typeKey = c.req.query("type");
      const schoolWide = canReadSchoolActivities(actor);
      const typeKeys =
        typeKey === "trips" ? ["trip", "visit", "residential"] : typeKey ? [typeKey] : null;
      const classIds = schoolWide ? [] : [...(await assignedClassIds(client, userId, orgId))];
      const studentIds = schoolWide ? [] : [...(await assignedStudentIds(client, userId, orgId))];
      const rows = await client.query(
        `${ACTIVITY_SELECT}
         where a.organisation_id = $1
           and ($2::text is null or a.status = $2)
           and ($3::text[] is null or t.key = any($3::text[]))
           and (
             $4::boolean = true
             or a.created_by = $5
             or exists (select 1 from school_activity_staff s where s.activity_id = a.id and s.staff_user_id = $5)
             or (
               a.status in ('published', 'closed', 'completed', 'cancelled')
               and exists (
                 select 1 from school_activity_targets t
                 where t.activity_id = a.id
                   and (
                     t.target_type = 'whole_school'
                     or t.class_id = any($6::uuid[])
                     or t.student_profile_id = any($7::uuid[])
                   )
               )
             )
           )
           and a.status <> 'archived'
         order by a.starts_at desc, a.title`,
        [orgId, status && isSchoolActivityStatus(status) ? status : null, typeKeys, schoolWide, userId, classIds, studentIds],
      );
      return c.json({
        activities: rows.rows.map((row) => mapSchoolActivity(row as Record<string, unknown>)),
      });
    }),
  );

  app.post("/activities", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, ACTIVITY_MANAGE_PERMISSIONS);
      const parsed = activityBodySchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid activity");
      if (!activityDatesValid(parsed.data.startsAt, parsed.data.endsAt)) {
        throw new AppError(400, "validation_failed", "Activity end must be on or after the start");
      }
      if (!activityDeadlineValid(parsed.data.responseDeadlineAt, parsed.data.endsAt)) {
        throw new AppError(400, "validation_failed", "The response deadline must be on or before the activity end");
      }
      if (parsed.data.occurrenceKind === "recurring") {
        if (!parsed.data.recurrenceWeekdays?.length || !parsed.data.recurrenceUntil) {
          throw new AppError(400, "validation_failed", "Recurring activities need weekdays and an end date");
        }
      }
      const typeId = await loadActivityTypeId(client, orgId, parsed.data);
      for (const target of parsed.data.targets ?? []) {
        await assertCanTargetActivity(client, actor, target);
      }
      const created = await client.query<{ id: string }>(
        `insert into school_activities (
           organisation_id, academic_year_id, title, description, activity_type_id,
           starts_at, ends_at, all_day, location, external_address, meeting_point, return_point,
           capacity, response_deadline_at, allow_responses_after_deadline, consent_required,
           parent_response_required, student_signup_enabled, student_visible, parent_visible,
           occurrence_kind, recurrence_weekdays, recurrence_until, staff_notes, parent_notes, created_by
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
         ) returning id`,
        [
          orgId,
          parsed.data.academicYearId ?? null,
          parsed.data.title,
          parsed.data.description ?? null,
          typeId,
          parsed.data.startsAt,
          parsed.data.endsAt,
          parsed.data.allDay ?? false,
          parsed.data.location ?? null,
          parsed.data.externalAddress ?? null,
          parsed.data.meetingPoint ?? null,
          parsed.data.returnPoint ?? null,
          parsed.data.capacity ?? null,
          parsed.data.responseDeadlineAt ?? null,
          parsed.data.allowResponsesAfterDeadline ?? false,
          parsed.data.consentRequired ?? false,
          parsed.data.parentResponseRequired ?? parsed.data.consentRequired ?? false,
          parsed.data.studentSignupEnabled ?? false,
          parsed.data.studentVisible ?? true,
          parsed.data.parentVisible ?? true,
          parsed.data.occurrenceKind ?? "one_off",
          parsed.data.recurrenceWeekdays ?? null,
          parsed.data.recurrenceUntil ?? null,
          parsed.data.staffNotes ?? null,
          parsed.data.parentNotes ?? null,
          userId,
        ],
      );
      const id = created.rows[0]!.id;
      if (parsed.data.targets?.length) {
        await replaceActivityTargets(client, {
          organisationId: orgId,
          activityId: id,
          actorUserId: userId,
          targets: parsed.data.targets,
        });
      }
      const clauses =
        parsed.data.consentClauses?.length
          ? parsed.data.consentClauses
          : parsed.data.consentRequired
            ? [
                {
                  clauseKey: "permission_to_attend",
                  title: "Permission to attend",
                  wording:
                    "I give permission for my child to take part in this school activity and confirm that the information I provide is accurate.",
                  required: true,
                  sortOrder: 0,
                },
              ]
            : [];
      if (clauses.length) await replaceClauses(client, orgId, id, clauses);
      if (parsed.data.staff?.length) await replaceStaff(client, orgId, id, userId, parsed.data.staff);
      await auditActivity(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "activity.created",
        activityId: id,
        after: { title: parsed.data.title },
      });
      const bundle = await loadActivityBundle(client, orgId, id);
      return c.json(bundle, 201);
    }),
  );

  app.get("/activities/:activityId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      await assertCanReadStaffActivity(client, actor, activityId);
      return c.json({
        ...(await loadActivityBundle(client, orgId, activityId)),
        canPublish: canPublishActivities(actor),
        canManageParticipants: canManageParticipants(actor) || canManageAssignedActivities(actor),
        canManageResponses: canManageResponses(actor),
      });
    }),
  );

  app.patch("/activities/:activityId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      const existing = await assertCanManageStaffActivity(client, actor, activityId);
      if (!["draft", "published", "closed"].includes(String(existing.status))) {
        throw new AppError(409, "conflict", "This activity can no longer be edited");
      }
      const parsed = activityPatchSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid activity");
      const startsAt = parsed.data.startsAt ?? String(existing.starts_at);
      const endsAt = parsed.data.endsAt ?? String(existing.ends_at);
      if (!activityDatesValid(startsAt, endsAt)) {
        throw new AppError(400, "validation_failed", "Activity end must be on or after the start");
      }
      const typeId = parsed.data.activityTypeId || parsed.data.activityTypeKey
        ? await loadActivityTypeId(client, orgId, parsed.data)
        : String(existing.activity_type_id);
      await client.query(
        `update school_activities set
           title = coalesce($3, title),
           description = coalesce($4, description),
           activity_type_id = $5,
           academic_year_id = coalesce($6, academic_year_id),
           starts_at = coalesce($7, starts_at),
           ends_at = coalesce($8, ends_at),
           all_day = coalesce($9, all_day),
           location = coalesce($10, location),
           external_address = coalesce($11, external_address),
           meeting_point = coalesce($12, meeting_point),
           return_point = coalesce($13, return_point),
           capacity = coalesce($14, capacity),
           response_deadline_at = coalesce($15, response_deadline_at),
           allow_responses_after_deadline = coalesce($16, allow_responses_after_deadline),
           consent_required = coalesce($17, consent_required),
           parent_response_required = coalesce($18, parent_response_required),
           student_signup_enabled = coalesce($19, student_signup_enabled),
           student_visible = coalesce($20, student_visible),
           parent_visible = coalesce($21, parent_visible),
           occurrence_kind = coalesce($22, occurrence_kind),
           recurrence_weekdays = coalesce($23, recurrence_weekdays),
           recurrence_until = coalesce($24, recurrence_until),
           staff_notes = coalesce($25, staff_notes),
           parent_notes = coalesce($26, parent_notes),
           consent_version = consent_version + case when $27::boolean then 1 else 0 end
         where id = $1 and organisation_id = $2`,
        [
          activityId,
          orgId,
          parsed.data.title ?? null,
          parsed.data.description === undefined ? null : parsed.data.description,
          typeId,
          parsed.data.academicYearId === undefined ? null : parsed.data.academicYearId,
          parsed.data.startsAt ?? null,
          parsed.data.endsAt ?? null,
          parsed.data.allDay ?? null,
          parsed.data.location === undefined ? null : parsed.data.location,
          parsed.data.externalAddress === undefined ? null : parsed.data.externalAddress,
          parsed.data.meetingPoint === undefined ? null : parsed.data.meetingPoint,
          parsed.data.returnPoint === undefined ? null : parsed.data.returnPoint,
          parsed.data.capacity === undefined ? null : parsed.data.capacity,
          parsed.data.responseDeadlineAt === undefined ? null : parsed.data.responseDeadlineAt,
          parsed.data.allowResponsesAfterDeadline ?? null,
          parsed.data.consentRequired ?? null,
          parsed.data.parentResponseRequired ?? null,
          parsed.data.studentSignupEnabled ?? null,
          parsed.data.studentVisible ?? null,
          parsed.data.parentVisible ?? null,
          parsed.data.occurrenceKind ?? null,
          parsed.data.recurrenceWeekdays ?? null,
          parsed.data.recurrenceUntil ?? null,
          parsed.data.staffNotes === undefined ? null : parsed.data.staffNotes,
          parsed.data.parentNotes === undefined ? null : parsed.data.parentNotes,
          Boolean(parsed.data.consentClauses),
        ],
      );
      if (parsed.data.targets) {
        for (const target of parsed.data.targets) await assertCanTargetActivity(client, actor, target);
        await replaceActivityTargets(client, {
          organisationId: orgId,
          activityId,
          actorUserId: userId,
          targets: parsed.data.targets,
        });
        await auditActivity(client, {
          organisationId: orgId,
          actorUserId: userId,
          action: "activity.targets_changed",
          activityId,
        });
      }
      if (parsed.data.consentClauses) await replaceClauses(client, orgId, activityId, parsed.data.consentClauses);
      if (parsed.data.staff) await replaceStaff(client, orgId, activityId, userId, parsed.data.staff);
      await auditActivity(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "activity.updated",
        activityId,
      });
      return c.json(await loadActivityBundle(client, orgId, activityId));
    }),
  );

  async function transition(
    c: Context<ApiEnv>,
    next: "published" | "closed" | "completed" | "cancelled" | "archived",
  ) {
    return withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      const existing = await assertCanPublishActivity(client, actor, activityId);
      const from = String(existing.status);
      if (!isSchoolActivityStatus(from) || !isActivityStatusTransitionAllowed(from, next)) {
        throw new AppError(409, "invalid_status_transition", "This status change is not allowed");
      }
      const body =
        next === "cancelled"
          ? z.object({ reason: z.string().max(2000).optional() }).safeParse(await c.req.json().catch(() => ({})))
          : null;
      if (next === "published") {
        await snapshotActivityEligibility(client, orgId, activityId);
      }
      await client.query(
        `update school_activities
            set status = $3,
                cancel_reason = coalesce($4, cancel_reason)
          where id = $1 and organisation_id = $2`,
        [activityId, orgId, next, body?.success ? body.data.reason ?? null : null],
      );
      if (next === "published") {
        await notifyActivityPublished(client, {
          organisationId: orgId,
          actorUserId: userId,
          activityId,
          title: String(existing.title),
          consentRequired: Boolean(existing.consent_required),
          parentVisible: existing.parent_visible !== false,
          studentVisible: existing.student_visible !== false,
        });
      }
      if (next === "cancelled") {
        await notifyActivityCancelled(client, {
          organisationId: orgId,
          actorUserId: userId,
          activityId,
          title: String(existing.title),
        });
      }
      await auditActivity(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: `activity.${next}`,
        activityId,
        before: { status: from },
        after: { status: next },
      });
      return c.json(await loadActivityBundle(client, orgId, activityId));
    });
  }

  app.post("/activities/:activityId/publish", requireUser, async (c) => transition(c, "published"));
  app.post("/activities/:activityId/close", requireUser, async (c) => transition(c, "closed"));
  app.post("/activities/:activityId/complete", requireUser, async (c) => transition(c, "completed"));
  app.post("/activities/:activityId/cancel", requireUser, async (c) => transition(c, "cancelled"));
  app.post("/activities/:activityId/archive", requireUser, async (c) => transition(c, "archived"));

  app.get("/activities/:activityId/participants", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      await assertCanReadStaffActivity(client, actor, activityId);
      const rows = await client.query(
        `select p.*, sp.legal_name, c.name as class_name, yg.name as year_group_name
         from school_activity_participants p
         join student_profiles sp on sp.id = p.student_profile_id
         left join school_activity_eligible_pupils e
           on e.activity_id = p.activity_id and e.student_profile_id = p.student_profile_id
         left join classes c on c.id = e.class_id
         left join year_groups yg on yg.id = e.year_group_id
         where p.activity_id = $1 and p.organisation_id = $2
         order by p.registration_status, p.waiting_list_position nulls last, sp.legal_name`,
        [activityId, orgId],
      );
      return c.json({
        participants: rows.rows.map((row) => mapActivityParticipant(row as Record<string, unknown>)),
      });
    }),
  );

  app.get("/activities/:activityId/eligible", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      await assertCanReadStaffActivity(client, actor, activityId);
      const rows = await client.query(
        `select e.student_profile_id, sp.legal_name, c.name as class_name, yg.name as year_group_name,
                p.registration_status, r.response as consent_response
         from school_activity_eligible_pupils e
         join student_profiles sp on sp.id = e.student_profile_id
         left join classes c on c.id = e.class_id
         left join year_groups yg on yg.id = e.year_group_id
         left join school_activity_participants p
           on p.activity_id = e.activity_id and p.student_profile_id = e.student_profile_id
         left join school_activity_responses r
           on r.activity_id = e.activity_id and r.student_profile_id = e.student_profile_id and r.is_effective
         where e.activity_id = $1 and e.organisation_id = $2
         order by sp.legal_name`,
        [activityId, orgId],
      );
      return c.json({
        eligible: rows.rows.map((row) => ({
          studentProfileId: row.student_profile_id,
          legalName: row.legal_name,
          className: row.class_name,
          yearGroupName: row.year_group_name,
          registrationStatus: row.registration_status ?? null,
          consentResponse: row.consent_response ?? "pending",
        })),
      });
    }),
  );

  app.get("/activities/:activityId/responses", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      await assertCanReadStaffActivity(client, actor, activityId);
      if (!canReadResponses(actor) && !canReadSchoolActivities(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const rows = await client.query(
        `select r.*, sp.legal_name
         from school_activity_responses r
         join student_profiles sp on sp.id = r.student_profile_id
         where r.activity_id = $1 and r.organisation_id = $2
         order by r.responded_at desc`,
        [activityId, orgId],
      );
      return c.json({
        responses: rows.rows.map((row) => ({
          ...mapActivityResponse(row as Record<string, unknown>, { includeStaffNote: true }),
          legalName: row.legal_name,
        })),
      });
    }),
  );

  app.get("/activities/:activityId/participants.csv", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      await assertCanReadStaffActivity(client, actor, activityId);
      const rows = await client.query<{
        legal_name: string;
        registration_status: string;
        response: string | null;
        waiting_list_position: number | null;
      }>(
        `select sp.legal_name, coalesce(p.registration_status, 'eligible') as registration_status,
                r.response, p.waiting_list_position
         from school_activity_eligible_pupils e
         join student_profiles sp on sp.id = e.student_profile_id
         left join school_activity_participants p
           on p.activity_id = e.activity_id and p.student_profile_id = e.student_profile_id
         left join school_activity_responses r
           on r.activity_id = e.activity_id and r.student_profile_id = e.student_profile_id and r.is_effective
         where e.activity_id = $1 and e.organisation_id = $2
         order by sp.legal_name`,
        [activityId, orgId],
      );
      const header = "pupil,registration_status,consent,waiting_list_position";
      const body = rows.rows
        .map(
          (row) =>
            `"${row.legal_name.replaceAll('"', '""')}",${row.registration_status},${row.response ?? "pending"},${row.waiting_list_position ?? ""}`,
        )
        .join("\n");
      return new Response(`${header}\n${body}\n`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=participants.csv",
        },
      });
    }),
  );

  app.post("/activities/:activityId/participants", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      const existing = await assertCanManageStaffActivity(client, actor, activityId);
      const parsed = z
        .object({
          studentProfileId: z.string().uuid(),
          note: z.string().max(4000).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid participant");
      if (!activityOpenForStaffChanges(String(existing.status))) {
        throw new AppError(409, "activity_closed", "This activity is no longer open to change");
      }
      if (!(await pupilIsEligible(client, orgId, activityId, parsed.data.studentProfileId))) {
        throw new AppError(400, "no_longer_eligible", "This pupil is not eligible for the activity");
      }
      const locked = await lockActivityCapacity(client, orgId, activityId);
      const consentRequired = Boolean(existing.consent_required);
      const status = consentRequired
        ? "expected"
        : allocateRegistrationStatus({
            capacity: locked.capacity,
            confirmedCount: locked.confirmedCount,
            preferConfirmed: true,
          });
      await upsertParticipant(client, {
        organisationId: orgId,
        activityId,
        studentProfileId: parsed.data.studentProfileId,
        registrationStatus: status,
        waitingListPosition: status === "waitlisted" ? nextWaitingListPosition(locked.waitlistPositions) : null,
        source: "staff_assigned",
        confirmedAt: status === "confirmed" ? new Date().toISOString() : null,
        internalNote: parsed.data.note,
      });
      await auditActivity(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "activity.participant_added",
        activityId,
        after: { studentProfileId: parsed.data.studentProfileId, status },
      });
      return c.json({ registrationStatus: status, activityTitle: existing.title }, 201);
    }),
  );

  app.post("/activities/:activityId/participants/:studentId/offline-response", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      const studentId = uuidRouteParam(c, "studentId");
      const existing = await assertCanManageStaffActivity(client, actor, activityId);
      if (!canManageResponses(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          response: z.enum(["consented", "declined", "withdrawn"]),
          comment: z.string().max(4000).optional(),
          staffNote: z.string().max(4000).optional(),
          emergencyMedicalAcknowledged: z.boolean().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid response");
      if (!activityOpenForStaffChanges(String(existing.status))) {
        throw new AppError(409, "activity_closed", "This activity is no longer open to change");
      }
      if (!(await pupilIsEligible(client, orgId, activityId, studentId))) {
        throw new AppError(400, "no_longer_eligible", "This pupil is not eligible for the activity");
      }
      const result = await applyConsentDecision(client, {
        organisationId: orgId,
        activityId,
        studentProfileId: studentId,
        actorUserId: userId,
        title: String(existing.title),
        channel: "staff_offline",
        response: parsed.data.response,
        source: "staff_offline",
        comment: parsed.data.comment,
        staffNote: parsed.data.staffNote,
        emergencyMedicalAcknowledged: parsed.data.emergencyMedicalAcknowledged,
      });
      await auditActivity(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "activity.offline_consent",
        activityId,
        after: { studentProfileId: studentId, response: parsed.data.response, channel: "staff_offline" },
      });
      return c.json(result);
    }),
  );

  app.post("/activities/:activityId/participants/:studentId/promote", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      const studentId = uuidRouteParam(c, "studentId");
      const existing = await assertCanManageStaffActivity(client, actor, activityId);
      if (!activityOpenForStaffChanges(String(existing.status))) {
        throw new AppError(409, "activity_closed", "This activity is no longer open to change");
      }
      const locked = await lockActivityCapacity(client, orgId, activityId);
      const status = allocateRegistrationStatus({
        capacity: locked.capacity,
        confirmedCount: locked.confirmedCount,
        preferConfirmed: true,
      });
      if (status !== "confirmed") {
        throw new AppError(409, "activity_full", "This activity is full");
      }
      const current = await client.query<{ registration_status: string }>(
        `select registration_status from school_activity_participants
         where activity_id = $1 and student_profile_id = $2 and organisation_id = $3`,
        [activityId, studentId, orgId],
      );
      if (current.rows[0]?.registration_status !== "waitlisted") {
        throw new AppError(409, "conflict", "Only waitlisted pupils can be promoted");
      }
      await client.query(
        `update school_activity_participants
            set registration_status = 'confirmed', waiting_list_position = null, confirmed_at = now()
          where activity_id = $1 and student_profile_id = $2 and organisation_id = $3`,
        [activityId, studentId, orgId],
      );
      await auditActivity(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "activity.participant_promoted",
        activityId,
        after: { studentProfileId: studentId },
      });
      return c.json({ registrationStatus: "confirmed", title: existing.title });
    }),
  );

  app.post("/activities/:activityId/participants/:studentId/withdraw", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      const studentId = uuidRouteParam(c, "studentId");
      const existing = await assertCanManageStaffActivity(client, actor, activityId);
      if (!activityOpenForStaffChanges(String(existing.status))) {
        throw new AppError(409, "activity_closed", "This activity is no longer open to change");
      }
      await lockActivityCapacity(client, orgId, activityId);
      await client.query(
        `update school_activity_participants
            set registration_status = 'withdrawn', waiting_list_position = null, withdrawn_at = now()
          where activity_id = $1 and student_profile_id = $2 and organisation_id = $3`,
        [activityId, studentId, orgId],
      );
      await maybePromoteNextWaitlisted(client, {
        organisationId: orgId,
        activityId,
        actorUserId: userId,
        title: String(existing.title),
      });
      await auditActivity(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "activity.participant_removed",
        activityId,
        after: { studentProfileId: studentId },
      });
      return c.json({ ok: true });
    }),
  );

  app.patch("/activities/:activityId/participants/:studentId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      const studentId = uuidRouteParam(c, "studentId");
      await assertCanManageStaffActivity(client, actor, activityId);
      const parsed = z
        .object({
          attendanceStatus: z.string().optional(),
          internalNote: z.string().max(4000).nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid participant update");
      if (parsed.data.attendanceStatus && !isSchoolActivityAttendanceStatus(parsed.data.attendanceStatus)) {
        throw new AppError(400, "validation_failed", "Invalid attendance status");
      }
      await client.query(
        `update school_activity_participants
            set attendance_status = coalesce($4, attendance_status),
                internal_note = coalesce($5, internal_note)
          where activity_id = $1 and student_profile_id = $2 and organisation_id = $3`,
        [activityId, studentId, orgId, parsed.data.attendanceStatus ?? null, parsed.data.internalNote ?? null],
      );
      return c.json({ ok: true });
    }),
  );

  app.get("/activities/:activityId/safety-summary", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      const existing = await assertCanReadStaffActivity(client, actor, activityId);
      const assigned = await client.query(
        `select 1 from school_activity_staff where activity_id = $1 and staff_user_id = $2`,
        [activityId, userId],
      );
      const operational = activityStaffSeesMedicalWindow({
        status: String(existing.status),
        endsAt: String(existing.ends_at),
      });
      if (!canReadMedicalSummary(actor) && !(assigned.rows[0] && operational)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      if (!canReadMedicalSummary(actor) && assigned.rows[0] && operational) {
        const confirmed = await client.query<{ student_profile_id: string }>(
          `select student_profile_id from school_activity_participants
           where activity_id = $1 and organisation_id = $2
             and registration_status in ('confirmed', 'expected')`,
          [activityId, orgId],
        );
        const summaries = await loadActivitySafetySummaries(
          client,
          orgId,
          activityId,
          confirmed.rows.map((row) => row.student_profile_id),
          { includeMedicalFields: false },
        );
        return c.json({
          liveMedical: true,
          snapshot: false,
          participants: summaries.map((row) => ({
            studentProfileId: row.studentProfileId,
            legalName: row.legalName,
            emergencyContacts: row.emergencyContacts,
          })),
        });
      }
      const confirmed = await client.query<{ student_profile_id: string }>(
        `select student_profile_id from school_activity_participants
         where activity_id = $1 and organisation_id = $2
           and registration_status in ('confirmed', 'expected')`,
        [activityId, orgId],
      );
      const summaries = await loadActivitySafetySummaries(
        client,
        orgId,
        activityId,
        confirmed.rows.map((row) => row.student_profile_id),
        { includeMedicalFields: true },
      );
      return c.json({ liveMedical: true, snapshot: false, participants: summaries });
    }),
  );

  app.post("/activities/:activityId/documents", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      await assertCanManageStaffActivity(client, actor, activityId);
      const upload = await readUploadedFile(c);
      const visibility = upload.fields.visibility || "staff";
      if (!isSchoolActivityDocumentVisibility(visibility)) {
        throw new AppError(400, "validation_failed", "Invalid document visibility");
      }
      const title = (upload.fields.title || upload.filename).slice(0, 200);
      const validated = validateBytes({
        bytes: upload.bytes,
        filename: upload.filename,
        mime: upload.mime,
        domain: "activity",
      });
      return runUpload(storageOf(c), async (track) => {
        const pending = await insertPendingObject(client, {
          organisationId: orgId,
          domain: "activity",
          ownerRecordId: activityId,
          storage: storageOf(c),
          validated,
          uploadedBy: userId,
        });
        track(pending.storageKey);
        const created = await client.query<{ id: string }>(
          `insert into school_activity_documents (
             organisation_id, activity_id, title, visibility, stored_object_id, storage_backend,
             storage_key, original_filename, content_type, byte_size, created_by
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           returning id`,
          [
            orgId,
            activityId,
            title,
            visibility,
            pending.id,
            storageOf(c).backend,
            pending.storageKey,
            validated.originalFilename,
            validated.storedContentType,
            validated.byteSize,
            userId,
          ],
        );
        await putAndActivateObject(client, storageOf(c), scannerOf(c), {
          organisationId: orgId,
          objectId: pending.id,
          storageKey: pending.storageKey,
          bytes: upload.bytes,
          contentType: validated.storedContentType,
          filename: validated.originalFilename,
          actorUserId: userId,
          domain: "activity",
        });
        await writeAudit(client, {
          organisationId: orgId,
          actorUserId: userId,
          action: "activity.document.created",
          entityType: "school_activity_document",
          entityId: created.rows[0]!.id,
          after: { activityId, visibility },
        });
        const row = await client.query(`select * from school_activity_documents where id = $1`, [
          created.rows[0]!.id,
        ]);
        return c.json({ document: mapActivityDocument(row.rows[0] as Record<string, unknown>) }, 201);
      });
    }),
  );

  app.post("/activities/:activityId/documents/:documentId/delete", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      const documentId = uuidRouteParam(c, "documentId");
      await assertCanManageStaffActivity(client, actor, activityId);
      await client.query(
        `update school_activity_documents set deleted_at = now()
         where id = $1 and activity_id = $2 and organisation_id = $3 and deleted_at is null`,
        [documentId, activityId, orgId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "activity.document.removed",
        entityType: "school_activity_document",
        entityId: documentId,
        after: { activityId },
      });
      return c.json({ ok: true });
    }),
  );

  app.post("/activities/:activityId/updates", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const activityId = uuidRouteParam(c, "activityId");
      const existing = await assertCanManageStaffActivity(client, actor, activityId);
      const parsed = z
        .object({
          body: z.string().trim().min(1).max(4000),
          parentVisible: z.boolean().optional(),
          studentVisible: z.boolean().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid update");
      const created = await client.query<{ id: string }>(
        `insert into school_activity_updates (
           organisation_id, activity_id, body, parent_visible, student_visible, published_by
         ) values ($1,$2,$3,$4,$5,$6)
         returning id`,
        [
          orgId,
          activityId,
          parsed.data.body,
          parsed.data.parentVisible ?? true,
          parsed.data.studentVisible ?? false,
          userId,
        ],
      );
      await auditActivity(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "activity.update_published",
        activityId,
        after: { updateId: created.rows[0]!.id, title: existing.title },
      });
      return c.json({ id: created.rows[0]!.id }, 201);
    }),
  );
}

export { ACTIVITY_SELECT, loadActivityBundle };
