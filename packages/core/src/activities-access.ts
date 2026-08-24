import { PERMISSIONS, type Actor } from "@schoolapp/domain";
import type pg from "pg";
import { AppError } from "./errors.js";
import { createInboxNotification } from "./admissions.js";
import { writeAudit } from "./academic.js";
import { assignedClassIds, assignedStudentIds, guardianChildIds } from "./students-access.js";
import { assertAnyPermission, notFound } from "./permissions.js";
import {
  activityNotificationBody,
  allocateRegistrationStatus,
  nextWaitingListPosition,
  snapshotConsentWording,
  type ConsentClauseSnapshot,
} from "./activities.js";

export const ACTIVITY_SCHOOL_READ_PERMISSIONS = [
  PERMISSIONS.ACTIVITIES_READ,
  PERMISSIONS.ACTIVITIES_MANAGE,
] as const;

export const ACTIVITY_MANAGE_PERMISSIONS = [
  PERMISSIONS.ACTIVITIES_MANAGE,
  PERMISSIONS.ACTIVITIES_MANAGE_ASSIGNED,
] as const;

export const ACTIVITY_READ_PERMISSIONS = [
  PERMISSIONS.ACTIVITIES_READ,
  PERMISSIONS.ACTIVITIES_MANAGE,
  PERMISSIONS.ACTIVITIES_READ_ASSIGNED,
  PERMISSIONS.ACTIVITIES_MANAGE_ASSIGNED,
] as const;

export function canReadSchoolActivities(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.ACTIVITIES_READ) ||
    actor.permissions.has(PERMISSIONS.ACTIVITIES_MANAGE)
  );
}

export function canManageSchoolActivities(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ACTIVITIES_MANAGE);
}

export function canManageAssignedActivities(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ACTIVITIES_MANAGE_ASSIGNED);
}

export function canPublishActivities(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ACTIVITIES_PUBLISH);
}

export function canReadParticipants(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.ACTIVITIES_PARTICIPANTS_READ) ||
    actor.permissions.has(PERMISSIONS.ACTIVITIES_PARTICIPANTS_MANAGE) ||
    canReadSchoolActivities(actor)
  );
}

export function canManageParticipants(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ACTIVITIES_PARTICIPANTS_MANAGE);
}

export function canReadResponses(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.ACTIVITIES_RESPONSES_READ) ||
    actor.permissions.has(PERMISSIONS.ACTIVITIES_RESPONSES_MANAGE) ||
    canReadParticipants(actor)
  );
}

export function canManageResponses(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ACTIVITIES_RESPONSES_MANAGE);
}

export function canReadMedicalSummary(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ACTIVITIES_MEDICAL_SUMMARY_READ);
}

export async function isActivityStaff(
  client: pg.PoolClient,
  organisationId: string,
  activityId: string,
  userId: string,
): Promise<boolean> {
  const row = await client.query(
    `select 1 from school_activity_staff
     where organisation_id = $1 and activity_id = $2 and staff_user_id = $3`,
    [organisationId, activityId, userId],
  );
  return Boolean(row.rows[0]);
}

export async function loadActivityRow(
  client: pg.PoolClient,
  organisationId: string,
  activityId: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `select a.*, t.key as activity_type_key, t.name as activity_type_name
     from school_activities a
     join school_activity_types t on t.id = a.activity_type_id
     where a.id = $1 and a.organisation_id = $2`,
    [activityId, organisationId],
  );
  return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
}

export async function assertCanReadStaffActivity(
  client: pg.PoolClient,
  actor: Actor,
  activityId: string,
): Promise<Record<string, unknown>> {
  assertAnyPermission(actor, ACTIVITY_READ_PERMISSIONS);
  const row = await loadActivityRow(client, actor.organisationId!, activityId);
  if (!row) notFound();
  if (canReadSchoolActivities(actor)) return row;
  if (String(row.created_by) === actor.userId) return row;
  if (await isActivityStaff(client, actor.organisationId!, activityId, actor.userId)) return row;
  const classIds = [...(await assignedClassIds(client, actor.userId, actor.organisationId!))];
  const studentIds = [...(await assignedStudentIds(client, actor.userId, actor.organisationId!))];
  if (!["published", "closed", "completed", "cancelled"].includes(String(row.status))) notFound();
  const targeted = await client.query(
    `select 1 from school_activity_targets t
     where t.activity_id = $1 and t.organisation_id = $2
       and (
         t.target_type = 'whole_school'
         or t.class_id = any($3::uuid[])
         or t.student_profile_id = any($4::uuid[])
         or t.year_group_id in (select c.year_group_id from classes c where c.id = any($3::uuid[]))
       )
     union all
     select 1 from school_activity_eligible_pupils e
     where e.activity_id = $1 and e.organisation_id = $2
       and e.student_profile_id = any($4::uuid[])
     limit 1`,
    [activityId, actor.organisationId, classIds, studentIds],
  );
  if (!targeted.rows[0]) notFound();
  return row;
}

export async function assertCanManageStaffActivity(
  client: pg.PoolClient,
  actor: Actor,
  activityId: string,
): Promise<Record<string, unknown>> {
  assertAnyPermission(actor, ACTIVITY_MANAGE_PERMISSIONS);
  const row = await loadActivityRow(client, actor.organisationId!, activityId);
  if (!row) notFound();
  if (canManageSchoolActivities(actor)) return row;
  if (String(row.created_by) === actor.userId && canManageAssignedActivities(actor)) return row;
  if (
    canManageAssignedActivities(actor) &&
    (await isActivityStaff(client, actor.organisationId!, activityId, actor.userId))
  ) {
    return row;
  }
  notFound();
}

export async function assertCanPublishActivity(
  client: pg.PoolClient,
  actor: Actor,
  activityId: string,
): Promise<Record<string, unknown>> {
  if (!canPublishActivities(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
  return assertCanManageStaffActivity(client, actor, activityId);
}

export type ActivityTargetInput = {
  targetType: string;
  classId?: string | null;
  yearGroupId?: string | null;
  studentProfileId?: string | null;
  staffUserId?: string | null;
};

export async function assertCanTargetActivity(
  client: pg.PoolClient,
  actor: Actor,
  target: ActivityTargetInput,
): Promise<void> {
  if (target.targetType === "whole_school" || target.targetType === "year_group") {
    if (!canManageSchoolActivities(actor)) {
      throw new AppError(403, "forbidden", "Whole-school and year-group targeting requires school-wide manage");
    }
  }
  if (target.targetType === "class" && target.classId) {
    if (canManageSchoolActivities(actor)) return;
    const assigned = await assignedClassIds(client, actor.userId, actor.organisationId!);
    if (!assigned.has(target.classId)) {
      throw new AppError(403, "forbidden", "You can only target assigned classes");
    }
  }
  if (target.targetType === "student" && target.studentProfileId) {
    if (canManageSchoolActivities(actor)) return;
    const assigned = await assignedStudentIds(client, actor.userId, actor.organisationId!);
    if (!assigned.has(target.studentProfileId)) {
      throw new AppError(404, "not_found", "Not found");
    }
  }
}

export async function replaceActivityTargets(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    activityId: string;
    actorUserId: string;
    targets: ActivityTargetInput[];
  },
): Promise<void> {
  await client.query(
    `delete from school_activity_targets where activity_id = $1 and organisation_id = $2`,
    [input.activityId, input.organisationId],
  );
  for (const target of input.targets) {
    await client.query(
      `insert into school_activity_targets (
         organisation_id, activity_id, target_type, class_id, year_group_id,
         student_profile_id, staff_user_id, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.organisationId,
        input.activityId,
        target.targetType,
        target.classId ?? null,
        target.yearGroupId ?? null,
        target.studentProfileId ?? null,
        target.staffUserId ?? null,
        input.actorUserId,
      ],
    );
  }
}

type EligibleRow = {
  studentProfileId: string;
  classId: string | null;
  yearGroupId: string | null;
  sourceTargetId: string;
};

async function resolveTargetPupils(
  client: pg.PoolClient,
  organisationId: string,
  academicYearId: string | null,
  target: {
    id: string;
    target_type: string;
    class_id: string | null;
    year_group_id: string | null;
    student_profile_id: string | null;
  },
): Promise<EligibleRow[]> {
  if (target.target_type === "staff_member") return [];
  if (target.target_type === "student" && target.student_profile_id) {
    const row = await client.query<{ class_id: string | null; year_group_id: string | null }>(
      `select cm.class_id, se.year_group_id
       from student_profiles sp
       left join student_enrolments se
         on se.student_profile_id = sp.id
        and se.organisation_id = sp.organisation_id
        and se.is_primary = true
        and se.status = 'enrolled'
        and se.ended_on is null
        and ($2::uuid is null or se.academic_year_id = $2)
       left join class_memberships cm
         on cm.student_profile_id = sp.id
        and cm.organisation_id = sp.organisation_id
        and cm.ended_on is null
       where sp.id = $1 and sp.organisation_id = $3
       limit 1`,
      [target.student_profile_id, academicYearId, organisationId],
    );
    return [
      {
        studentProfileId: target.student_profile_id,
        classId: row.rows[0]?.class_id ?? null,
        yearGroupId: row.rows[0]?.year_group_id ?? null,
        sourceTargetId: target.id,
      },
    ];
  }
  if (target.target_type === "class" && target.class_id) {
    const rows = await client.query<{ student_profile_id: string; year_group_id: string | null }>(
      `select cm.student_profile_id, se.year_group_id
       from class_memberships cm
       join student_profiles sp on sp.id = cm.student_profile_id
       left join student_enrolments se
         on se.student_profile_id = sp.id
        and se.organisation_id = cm.organisation_id
        and se.is_primary = true
        and se.status = 'enrolled'
        and se.ended_on is null
       where cm.class_id = $1
         and cm.organisation_id = $2
         and cm.ended_on is null
         and sp.enrolment_status = 'enrolled'`,
      [target.class_id, organisationId],
    );
    return rows.rows.map((row) => ({
      studentProfileId: row.student_profile_id,
      classId: target.class_id,
      yearGroupId: row.year_group_id,
      sourceTargetId: target.id,
    }));
  }
  if (target.target_type === "year_group" && target.year_group_id) {
    const rows = await client.query<{ student_profile_id: string; class_id: string | null }>(
      `select se.student_profile_id, cm.class_id
       from student_enrolments se
       join student_profiles sp on sp.id = se.student_profile_id
       left join class_memberships cm
         on cm.student_profile_id = se.student_profile_id
        and cm.organisation_id = se.organisation_id
        and cm.ended_on is null
       where se.organisation_id = $1
         and se.year_group_id = $2
         and se.is_primary = true
         and se.status = 'enrolled'
         and se.ended_on is null
         and sp.enrolment_status = 'enrolled'
         and ($3::uuid is null or se.academic_year_id = $3)`,
      [organisationId, target.year_group_id, academicYearId],
    );
    return rows.rows.map((row) => ({
      studentProfileId: row.student_profile_id,
      classId: row.class_id,
      yearGroupId: target.year_group_id,
      sourceTargetId: target.id,
    }));
  }
  if (target.target_type === "whole_school") {
    const rows = await client.query<{
      student_profile_id: string;
      class_id: string | null;
      year_group_id: string | null;
    }>(
      `select se.student_profile_id, cm.class_id, se.year_group_id
       from student_enrolments se
       join student_profiles sp on sp.id = se.student_profile_id
       join academic_years ay on ay.id = se.academic_year_id
       left join class_memberships cm
         on cm.student_profile_id = se.student_profile_id
        and cm.organisation_id = se.organisation_id
        and cm.ended_on is null
       where se.organisation_id = $1
         and se.is_primary = true
         and se.status = 'enrolled'
         and se.ended_on is null
         and sp.enrolment_status = 'enrolled'
         and ($2::uuid is null or se.academic_year_id = $2 or ay.is_current)`,
      [organisationId, academicYearId],
    );
    return rows.rows.map((row) => ({
      studentProfileId: row.student_profile_id,
      classId: row.class_id,
      yearGroupId: row.year_group_id,
      sourceTargetId: target.id,
    }));
  }
  return [];
}

export async function snapshotActivityEligibility(
  client: pg.PoolClient,
  organisationId: string,
  activityId: string,
): Promise<number> {
  const activity = await client.query<{ academic_year_id: string | null }>(
    `select academic_year_id from school_activities where id = $1 and organisation_id = $2`,
    [activityId, organisationId],
  );
  const academicYearId = activity.rows[0]?.academic_year_id ?? null;
  const targets = await client.query<{
    id: string;
    target_type: string;
    class_id: string | null;
    year_group_id: string | null;
    student_profile_id: string | null;
  }>(
    `select id, target_type, class_id, year_group_id, student_profile_id
     from school_activity_targets
     where activity_id = $1 and organisation_id = $2`,
    [activityId, organisationId],
  );
  const seen = new Set<string>();
  for (const target of targets.rows) {
    const pupils = await resolveTargetPupils(client, organisationId, academicYearId, target);
    for (const pupil of pupils) {
      if (seen.has(pupil.studentProfileId)) continue;
      seen.add(pupil.studentProfileId);
      await client.query(
        `insert into school_activity_eligible_pupils (
           organisation_id, activity_id, student_profile_id, source_target_id, class_id, year_group_id
         ) values ($1,$2,$3,$4,$5,$6)
         on conflict (activity_id, student_profile_id) do nothing`,
        [
          organisationId,
          activityId,
          pupil.studentProfileId,
          pupil.sourceTargetId,
          pupil.classId,
          pupil.yearGroupId,
        ],
      );
    }
  }
  const count = await client.query<{ n: number }>(
    `select count(*)::int as n from school_activity_eligible_pupils
     where activity_id = $1 and organisation_id = $2`,
    [activityId, organisationId],
  );
  return count.rows[0]?.n ?? 0;
}

export async function loadConsentClauses(
  client: pg.PoolClient,
  organisationId: string,
  activityId: string,
): Promise<ConsentClauseSnapshot[]> {
  const rows = await client.query<{
    clause_key: string;
    title: string;
    wording: string;
    required: boolean;
    sort_order: number;
  }>(
    `select clause_key, title, wording, required, sort_order
     from school_activity_consent_clauses
     where activity_id = $1 and organisation_id = $2
     order by sort_order, clause_key`,
    [activityId, organisationId],
  );
  return rows.rows.map((row) => ({
    clauseKey: row.clause_key,
    title: row.title,
    wording: row.wording,
    required: row.required,
    sortOrder: row.sort_order,
  }));
}

export async function parentUsersForActivityPupils(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileIds: string[],
): Promise<Array<{ userId: string; studentProfileId: string }>> {
  if (studentProfileIds.length === 0) return [];
  const rows = await client.query<{ guardian_user_id: string; student_profile_id: string }>(
    `select guardian_user_id, student_profile_id
     from guardianships
     where organisation_id = $1
       and student_profile_id = any($2::uuid[])
       and portal_access = true
       and (ended_on is null or ended_on >= current_date)`,
    [organisationId, studentProfileIds],
  );
  return rows.rows.map((row) => ({
    userId: row.guardian_user_id,
    studentProfileId: row.student_profile_id,
  }));
}

export async function guardianMayRespond(
  client: pg.PoolClient,
  organisationId: string,
  guardianUserId: string,
  studentProfileId: string,
): Promise<{ guardianshipId: string; hasParentalResponsibility: boolean } | null> {
  const row = await client.query<{
    id: string;
    has_parental_responsibility: boolean;
    portal_access: boolean;
  }>(
    `select id, has_parental_responsibility, portal_access
     from guardianships
     where organisation_id = $1
       and guardian_user_id = $2
       and student_profile_id = $3
       and (ended_on is null or ended_on >= current_date)`,
    [organisationId, guardianUserId, studentProfileId],
  );
  const link = row.rows[0];
  if (!link || !link.portal_access) return null;
  if (link.has_parental_responsibility) {
    return { guardianshipId: link.id, hasParentalResponsibility: true };
  }
  const holders = await client.query<{ n: number }>(
    `select count(*)::int as n from guardianships
     where organisation_id = $1
       and student_profile_id = $2
       and has_parental_responsibility = true
       and portal_access = true
       and (ended_on is null or ended_on >= current_date)`,
    [organisationId, studentProfileId],
  );
  if ((holders.rows[0]?.n ?? 0) > 0) return null;
  return { guardianshipId: link.id, hasParentalResponsibility: false };
}

async function notifyUsers(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    type: Parameters<typeof activityNotificationBody>[0];
    title: string;
    activityId: string;
    recipients: Array<{ userId: string; studentProfileId?: string }>;
    keySuffix?: string;
  },
): Promise<void> {
  const copy = activityNotificationBody(input.type, input.title);
  for (const recipient of input.recipients) {
    const suffix = input.keySuffix ?? recipient.studentProfileId ?? "na";
    await createInboxNotification(client, {
      organisationId: input.organisationId,
      recipientUserId: recipient.userId,
      actorUserId: input.actorUserId,
      type: input.type,
      category: "activities",
      title: copy.title,
      body: copy.body,
      actionTarget: {
        activityId: input.activityId,
        studentProfileId: recipient.studentProfileId ?? null,
      },
      idempotencyKey: `${input.type}:${input.activityId}:${recipient.userId}:${suffix}`,
    });
  }
}

export async function notifyActivityPublished(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    activityId: string;
    title: string;
    consentRequired: boolean;
    parentVisible: boolean;
    studentVisible: boolean;
  },
): Promise<void> {
  const eligible = await client.query<{ student_profile_id: string }>(
    `select student_profile_id from school_activity_eligible_pupils
     where activity_id = $1 and organisation_id = $2`,
    [input.activityId, input.organisationId],
  );
  const studentIds = eligible.rows.map((row) => row.student_profile_id);
  if (input.parentVisible) {
    const parents = await parentUsersForActivityPupils(client, input.organisationId, studentIds);
    await notifyUsers(client, {
      organisationId: input.organisationId,
      actorUserId: input.actorUserId,
      type: input.consentRequired ? "activity_consent_required" : "activity_published",
      title: input.title,
      activityId: input.activityId,
      recipients: parents,
    });
  }
  if (input.studentVisible) {
    const students = await client.query<{ user_id: string; student_profile_id: string }>(
      `select sp.user_id, sp.id as student_profile_id
       from student_profiles sp
       where sp.id = any($1::uuid[]) and sp.organisation_id = $2 and sp.user_id is not null`,
      [studentIds, input.organisationId],
    );
    await notifyUsers(client, {
      organisationId: input.organisationId,
      actorUserId: input.actorUserId,
      type: "activity_published",
      title: input.title,
      activityId: input.activityId,
      recipients: students.rows.map((row) => ({
        userId: row.user_id,
        studentProfileId: row.student_profile_id,
      })),
    });
  }
  const staff = await client.query<{ staff_user_id: string }>(
    `select staff_user_id from school_activity_staff
     where activity_id = $1 and organisation_id = $2`,
    [input.activityId, input.organisationId],
  );
  await notifyUsers(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    type: "activity_assignment",
    title: input.title,
    activityId: input.activityId,
    recipients: staff.rows.map((row) => ({ userId: row.staff_user_id })),
    keySuffix: "staff",
  });
}

export async function notifyActivityCancelled(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    activityId: string;
    title: string;
  },
): Promise<void> {
  const parents = await client.query<{ guardian_user_id: string; student_profile_id: string }>(
    `select distinct g.guardian_user_id, e.student_profile_id
     from school_activity_eligible_pupils e
     join guardianships g
       on g.student_profile_id = e.student_profile_id
      and g.organisation_id = e.organisation_id
     where e.activity_id = $1
       and e.organisation_id = $2
       and g.portal_access = true
       and (g.ended_on is null or g.ended_on >= current_date)`,
    [input.activityId, input.organisationId],
  );
  await notifyUsers(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    type: "activity_cancelled",
    title: input.title,
    activityId: input.activityId,
    recipients: parents.rows.map((row) => ({
      userId: row.guardian_user_id,
      studentProfileId: row.student_profile_id,
    })),
  });
  const students = await client.query<{ user_id: string; student_profile_id: string }>(
    `select sp.user_id, e.student_profile_id
     from school_activity_eligible_pupils e
     join student_profiles sp on sp.id = e.student_profile_id
     where e.activity_id = $1 and e.organisation_id = $2 and sp.user_id is not null`,
    [input.activityId, input.organisationId],
  );
  await notifyUsers(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    type: "activity_cancelled",
    title: input.title,
    activityId: input.activityId,
    recipients: students.rows.map((row) => ({
      userId: row.user_id,
      studentProfileId: row.student_profile_id,
    })),
    keySuffix: "student",
  });
}

export async function lockActivityCapacity(
  client: pg.PoolClient,
  organisationId: string,
  activityId: string,
): Promise<{ capacity: number | null; confirmedCount: number; waitlistPositions: number[] }> {
  const activity = await client.query<{ capacity: number | null }>(
    `select capacity from school_activities
     where id = $1 and organisation_id = $2
     for update`,
    [activityId, organisationId],
  );
  if (!activity.rows[0]) notFound();
  const counts = await client.query<{
    confirmed: number;
    positions: number[] | null;
  }>(
    `select
       count(*) filter (where registration_status = 'confirmed')::int as confirmed,
       array_agg(waiting_list_position) filter (where registration_status = 'waitlisted') as positions
     from school_activity_participants
     where activity_id = $1 and organisation_id = $2`,
    [activityId, organisationId],
  );
  return {
    capacity: activity.rows[0].capacity,
    confirmedCount: counts.rows[0]?.confirmed ?? 0,
    waitlistPositions: (counts.rows[0]?.positions ?? []).filter((value): value is number => value != null),
  };
}

export async function upsertParticipant(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    activityId: string;
    studentProfileId: string;
    registrationStatus: string;
    waitingListPosition: number | null;
    source: string;
    confirmedAt?: string | null;
    withdrawnAt?: string | null;
    internalNote?: string | null;
  },
): Promise<void> {
  await client.query(
    `insert into school_activity_participants (
       organisation_id, activity_id, student_profile_id, registration_status,
       waiting_list_position, source, confirmed_at, withdrawn_at, internal_note
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (activity_id, student_profile_id) do update set
       registration_status = excluded.registration_status,
       waiting_list_position = excluded.waiting_list_position,
       source = school_activity_participants.source,
       confirmed_at = coalesce(excluded.confirmed_at, school_activity_participants.confirmed_at),
       withdrawn_at = excluded.withdrawn_at,
       internal_note = coalesce(excluded.internal_note, school_activity_participants.internal_note)`,
    [
      input.organisationId,
      input.activityId,
      input.studentProfileId,
      input.registrationStatus,
      input.waitingListPosition,
      input.source,
      input.confirmedAt ?? null,
      input.withdrawnAt ?? null,
      input.internalNote ?? null,
    ],
  );
}

export async function recordActivityResponse(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    activityId: string;
    studentProfileId: string;
    actorUserId: string;
    guardianUserId?: string | null;
    guardianshipId?: string | null;
    channel: "parent_portal" | "student_portal" | "staff_offline";
    response: "consented" | "declined" | "withdrawn";
    comment?: string | null;
    emergencyMedicalAcknowledged?: boolean;
    consentVersion: number;
    wordingSnapshot: unknown;
    staffNote?: string | null;
    withdrawalReason?: string | null;
  },
): Promise<string> {
  await client.query(
    `update school_activity_responses
        set is_effective = false
      where activity_id = $1
        and student_profile_id = $2
        and organisation_id = $3
        and is_effective`,
    [input.activityId, input.studentProfileId, input.organisationId],
  );
  const inserted = await client.query<{ id: string }>(
    `insert into school_activity_responses (
       organisation_id, activity_id, student_profile_id, actor_user_id, guardian_user_id,
       guardianship_id, channel, response, is_effective, comment, emergency_medical_acknowledged,
       consent_version, wording_snapshot, staff_note, withdrawn_at, withdrawal_reason
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12::jsonb,$13,$14,$15)
     returning id`,
    [
      input.organisationId,
      input.activityId,
      input.studentProfileId,
      input.actorUserId,
      input.channel === "staff_offline" ? null : (input.guardianUserId ?? null),
      input.channel === "staff_offline" ? null : (input.guardianshipId ?? null),
      input.channel,
      input.response,
      input.comment ?? null,
      input.emergencyMedicalAcknowledged ?? false,
      input.consentVersion,
      JSON.stringify(input.wordingSnapshot),
      input.staffNote ?? null,
      input.response === "withdrawn" ? new Date().toISOString() : null,
      input.withdrawalReason ?? null,
    ],
  );
  return inserted.rows[0]!.id;
}

export async function applyConsentDecision(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    activityId: string;
    studentProfileId: string;
    actorUserId: string;
    title: string;
    channel: "parent_portal" | "student_portal" | "staff_offline";
    response: "consented" | "declined" | "withdrawn";
    source: string;
    guardianUserId?: string | null;
    guardianshipId?: string | null;
    comment?: string | null;
    emergencyMedicalAcknowledged?: boolean;
    staffNote?: string | null;
    withdrawalReason?: string | null;
    notifyParents?: boolean;
  },
): Promise<{ registrationStatus: string; waitingListPosition: number | null }> {
  const locked = await lockActivityCapacity(client, input.organisationId, input.activityId);
  const activity = await client.query<{
    consent_version: number;
  }>(
    `select consent_version from school_activities
     where id = $1 and organisation_id = $2`,
    [input.activityId, input.organisationId],
  );
  if (!activity.rows[0]) notFound();
  const clauses = await loadConsentClauses(client, input.organisationId, input.activityId);
  const snapshot = snapshotConsentWording(
    clauses,
    activity.rows[0].consent_version,
    new Date().toISOString(),
  );
  await recordActivityResponse(client, {
    organisationId: input.organisationId,
    activityId: input.activityId,
    studentProfileId: input.studentProfileId,
    actorUserId: input.actorUserId,
    guardianUserId: input.guardianUserId,
    guardianshipId: input.guardianshipId,
    channel: input.channel,
    response: input.response,
    comment: input.comment,
    emergencyMedicalAcknowledged: input.emergencyMedicalAcknowledged,
    consentVersion: activity.rows[0].consent_version,
    wordingSnapshot: snapshot,
    staffNote: input.staffNote,
    withdrawalReason: input.withdrawalReason,
  });

  let registrationStatus: string;
  let waitingListPosition: number | null = null;
  if (input.response === "declined") {
    registrationStatus = "declined";
  } else if (input.response === "withdrawn") {
    registrationStatus = "withdrawn";
  } else {
    registrationStatus = allocateRegistrationStatus({
      capacity: locked.capacity,
      confirmedCount: locked.confirmedCount,
      preferConfirmed: true,
    });
    if (registrationStatus === "waitlisted") {
      waitingListPosition = nextWaitingListPosition(locked.waitlistPositions);
    }
  }

  await upsertParticipant(client, {
    organisationId: input.organisationId,
    activityId: input.activityId,
    studentProfileId: input.studentProfileId,
    registrationStatus,
    waitingListPosition,
    source: input.source,
    confirmedAt: registrationStatus === "confirmed" ? new Date().toISOString() : null,
    withdrawnAt: input.response === "withdrawn" ? new Date().toISOString() : null,
  });

  if (input.response === "withdrawn" || input.response === "declined") {
    await maybePromoteNextWaitlisted(client, {
      organisationId: input.organisationId,
      activityId: input.activityId,
      actorUserId: input.actorUserId,
      title: input.title,
    });
  }

  if (input.notifyParents !== false) {
    const parents = await parentUsersForActivityPupils(client, input.organisationId, [
      input.studentProfileId,
    ]);
    if (registrationStatus === "confirmed") {
      await notifyUsers(client, {
        organisationId: input.organisationId,
        actorUserId: input.actorUserId,
        type: "activity_place_confirmed",
        title: input.title,
        activityId: input.activityId,
        recipients: parents,
      });
    } else if (registrationStatus === "waitlisted") {
      await notifyUsers(client, {
        organisationId: input.organisationId,
        actorUserId: input.actorUserId,
        type: "activity_waitlisted",
        title: input.title,
        activityId: input.activityId,
        recipients: parents,
      });
    }
  }

  return { registrationStatus, waitingListPosition };
}

export async function maybePromoteNextWaitlisted(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    activityId: string;
    actorUserId: string;
    title: string;
  },
): Promise<string | null> {
  const locked = await lockActivityCapacity(client, input.organisationId, input.activityId);
  const status = await client.query<{ status: string }>(
    `select status from school_activities where id = $1 and organisation_id = $2`,
    [input.activityId, input.organisationId],
  );
  if (!["published", "closed"].includes(String(status.rows[0]?.status))) return null;
  const nextStatus = allocateRegistrationStatus({
    capacity: locked.capacity,
    confirmedCount: locked.confirmedCount,
    preferConfirmed: true,
  });
  if (nextStatus !== "confirmed") return null;
  const next = await client.query<{ student_profile_id: string }>(
    `select student_profile_id
     from school_activity_participants
     where activity_id = $1 and organisation_id = $2 and registration_status = 'waitlisted'
     order by waiting_list_position, joined_at
     limit 1
     for update`,
    [input.activityId, input.organisationId],
  );
  const studentId = next.rows[0]?.student_profile_id;
  if (!studentId) return null;
  await client.query(
    `update school_activity_participants
        set registration_status = 'confirmed',
            waiting_list_position = null,
            confirmed_at = now()
      where activity_id = $1 and student_profile_id = $2 and organisation_id = $3`,
    [input.activityId, studentId, input.organisationId],
  );
  const parents = await parentUsersForActivityPupils(client, input.organisationId, [studentId]);
  await notifyUsers(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    type: "activity_promoted",
    title: input.title,
    activityId: input.activityId,
    recipients: parents,
  });
  return studentId;
}

export async function pupilIsEligible(
  client: pg.PoolClient,
  organisationId: string,
  activityId: string,
  studentProfileId: string,
): Promise<boolean> {
  const row = await client.query(
    `select 1 from school_activity_eligible_pupils
     where activity_id = $1 and organisation_id = $2 and student_profile_id = $3`,
    [activityId, organisationId, studentProfileId],
  );
  return Boolean(row.rows[0]);
}

export async function auditActivity(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string | null;
    action: string;
    activityId: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: "school_activity",
    entityId: input.activityId,
    before: input.before,
    after: input.after,
  });
}

export async function listCalendarActivities(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    from?: string | null;
    to?: string | null;
    studentIds?: string[] | null;
    staffUserId?: string | null;
    classIds?: string[] | null;
    schoolWide?: boolean;
    parentVisibleOnly?: boolean;
    studentVisibleOnly?: boolean;
    statuses?: string[];
  },
): Promise<Array<Record<string, unknown>>> {
  const statuses = input.statuses ?? ["published", "closed", "completed", "cancelled"];
  const rows = await client.query(
    `select a.id, a.title, a.description, a.starts_at, a.ends_at, a.all_day, a.location,
            a.external_address, a.status, a.parent_visible, a.student_visible,
            a.occurrence_kind, a.recurrence_weekdays, a.recurrence_until,
            t.key as activity_type_key, t.name as activity_type_name
     from school_activities a
     join school_activity_types t on t.id = a.activity_type_id
     where a.organisation_id = $1
       and a.status = any($2::text[])
       and ($3::boolean = false or a.parent_visible)
       and ($4::boolean = false or a.student_visible)
       and (
         $5::boolean = true
         or ($6::uuid is not null and (
           a.created_by = $6
           or exists (
             select 1 from school_activity_staff s
             where s.activity_id = a.id and s.staff_user_id = $6
           )
         ))
         or ($7::uuid[] is not null and exists (
           select 1 from school_activity_eligible_pupils e
           where e.activity_id = a.id and e.student_profile_id = any($7::uuid[])
         ))
         or ($8::uuid[] is not null and exists (
           select 1 from school_activity_targets t
           where t.activity_id = a.id
             and (
               t.target_type = 'whole_school'
               or t.class_id = any($8::uuid[])
               or t.student_profile_id = any($7::uuid[])
             )
         ))
       )
     order by a.starts_at, a.title`,
    [
      input.organisationId,
      statuses,
      input.parentVisibleOnly ?? false,
      input.studentVisibleOnly ?? false,
      input.schoolWide ?? false,
      input.staffUserId ?? null,
      input.studentIds ?? null,
      input.classIds ?? null,
    ],
  );
  return rows.rows as Array<Record<string, unknown>>;
}

export async function loadActivitySafetySummaries(
  client: pg.PoolClient,
  organisationId: string,
  activityId: string,
  studentIds: string[],
  options: { includeMedicalFields?: boolean } = {},
): Promise<
  Array<{
    studentProfileId: string;
    legalName: string;
    allergies: string | null;
    medication: string | null;
    dietaryRequirements: string | null;
    medicalConditions: string | null;
    emergencyContacts: Array<{
      name: string;
      relationship: string;
      email: string | null;
      isEmergencyContact: boolean;
      hasParentalResponsibility: boolean;
    }>;
  }>
> {
  if (studentIds.length === 0) return [];
  const includeMedical = options.includeMedicalFields === true;
  const pupils = includeMedical
    ? await client.query<{
        id: string;
        legal_name: string;
        allergies: string | null;
        medication: string | null;
        dietary_requirements: string | null;
        medical_conditions: string | null;
      }>(
        `select sp.id, sp.legal_name,
                n.allergies, n.medication, n.dietary_requirements, n.medical_conditions
         from student_profiles sp
         left join student_additional_needs n
           on n.student_profile_id = sp.id and n.organisation_id = sp.organisation_id
         where sp.organisation_id = $1
           and sp.id = any($2::uuid[])
           and exists (
             select 1 from school_activity_participants p
             where p.activity_id = $3
               and p.student_profile_id = sp.id
               and p.registration_status = 'confirmed'
           )`,
        [organisationId, studentIds, activityId],
      )
    : await client.query<{
        id: string;
        legal_name: string;
        allergies: string | null;
        medication: string | null;
        dietary_requirements: string | null;
        medical_conditions: string | null;
      }>(
        `select sp.id, sp.legal_name,
                null::text as allergies, null::text as medication,
                null::text as dietary_requirements, null::text as medical_conditions
         from student_profiles sp
         where sp.organisation_id = $1
           and sp.id = any($2::uuid[])
           and exists (
             select 1 from school_activity_participants p
             where p.activity_id = $3
               and p.student_profile_id = sp.id
               and p.registration_status = 'confirmed'
           )`,
        [organisationId, studentIds, activityId],
      );
  const contacts = await client.query<{
    student_profile_id: string;
    full_name: string;
    relationship: string;
    email: string | null;
    is_emergency_contact: boolean;
    has_parental_responsibility: boolean;
  }>(
    `select student_profile_id, full_name, relationship, email,
            is_emergency_contact, has_parental_responsibility
       from list_activity_safety_contacts($1, $2)
      where student_profile_id = any($3::uuid[])`,
    [organisationId, activityId, studentIds],
  );
  return pupils.rows.map((pupil) => ({
    studentProfileId: pupil.id,
    legalName: pupil.legal_name,
    allergies: pupil.allergies,
    medication: pupil.medication,
    dietaryRequirements: pupil.dietary_requirements,
    medicalConditions: pupil.medical_conditions,
    emergencyContacts: contacts.rows
      .filter((row) => row.student_profile_id === pupil.id)
      .filter((row) => row.is_emergency_contact || row.has_parental_responsibility)
      .map((row) => ({
        name: row.full_name,
        relationship: row.relationship,
        email: row.email,
        isEmergencyContact: row.is_emergency_contact,
        hasParentalResponsibility: row.has_parental_responsibility,
      })),
  }));
}

export { guardianChildIds };
