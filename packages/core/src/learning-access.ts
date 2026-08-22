import { PERMISSIONS, type Actor } from "@schoolapp/domain";
import type pg from "pg";
import { AppError } from "./errors.js";
import { createInboxNotification } from "./admissions.js";
import { learningNotificationBody } from "./learning.js";
import { assignedClassIds, assignedStudentIds, isAssignedToClass } from "./students-access.js";
import { assertAnyPermission, notFound } from "./permissions.js";

export const LMS_SCHOOL_READ_PERMISSIONS = [
  PERMISSIONS.LMS_ASSIGNMENTS_READ,
  PERMISSIONS.LMS_ASSIGNMENTS_MANAGE,
  PERMISSIONS.LMS_SUBMISSIONS_READ,
  PERMISSIONS.LMS_SUBMISSIONS_MARK,
] as const;

export const LMS_ASSIGN_PERMISSIONS = [
  PERMISSIONS.LMS_ASSIGNMENTS_MANAGE,
  PERMISSIONS.LMS_ASSIGNMENTS_MANAGE_ASSIGNED,
] as const;

export const LMS_READ_WORK_PERMISSIONS = [
  PERMISSIONS.LMS_ASSIGNMENTS_READ,
  PERMISSIONS.LMS_ASSIGNMENTS_MANAGE,
  PERMISSIONS.LMS_ASSIGNMENTS_READ_ASSIGNED,
  PERMISSIONS.LMS_ASSIGNMENTS_MANAGE_ASSIGNED,
] as const;

export const LMS_READ_SUBMISSION_PERMISSIONS = [
  PERMISSIONS.LMS_SUBMISSIONS_READ,
  PERMISSIONS.LMS_SUBMISSIONS_MARK,
  PERMISSIONS.LMS_SUBMISSIONS_READ_ASSIGNED,
  PERMISSIONS.LMS_SUBMISSIONS_MARK_ASSIGNED,
] as const;

export const LMS_MARK_PERMISSIONS = [
  PERMISSIONS.LMS_SUBMISSIONS_MARK,
  PERMISSIONS.LMS_SUBMISSIONS_MARK_ASSIGNED,
] as const;

export function canManageSchoolLearning(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.LMS_ASSIGNMENTS_MANAGE);
}

export function canReadSchoolLearning(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.LMS_ASSIGNMENTS_READ) ||
    actor.permissions.has(PERMISSIONS.LMS_ASSIGNMENTS_MANAGE) ||
    actor.permissions.has(PERMISSIONS.LMS_SUBMISSIONS_READ) ||
    actor.permissions.has(PERMISSIONS.LMS_SUBMISSIONS_MARK)
  );
}

export function canManageAssignedLearning(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.LMS_ASSIGNMENTS_MANAGE_ASSIGNED);
}

export function canReadAssignedLearning(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.LMS_ASSIGNMENTS_READ_ASSIGNED) ||
    actor.permissions.has(PERMISSIONS.LMS_ASSIGNMENTS_MANAGE_ASSIGNED) ||
    actor.permissions.has(PERMISSIONS.LMS_SUBMISSIONS_READ_ASSIGNED) ||
    actor.permissions.has(PERMISSIONS.LMS_SUBMISSIONS_MARK_ASSIGNED)
  );
}

export function canMarkSchoolLearning(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.LMS_SUBMISSIONS_MARK);
}

export function canMarkAssignedLearning(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.LMS_SUBMISSIONS_MARK_ASSIGNED);
}

export function canReadOwnChildrenLearning(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.LMS_ASSIGNMENTS_READ_OWN_CHILDREN) ||
    actor.permissions.has(PERMISSIONS.LMS_SUBMISSIONS_READ_OWN_CHILDREN)
  );
}

export function canReadOwnLearning(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.LMS_ASSIGNMENTS_READ_SELF) ||
    actor.permissions.has(PERMISSIONS.LMS_SUBMISSIONS_READ_SELF) ||
    actor.permissions.has(PERMISSIONS.LMS_SUBMISSIONS_SUBMIT)
  );
}

export async function assertCanManageLearningWork(
  client: pg.PoolClient,
  actor: Actor,
): Promise<void> {
  assertAnyPermission(actor, LMS_ASSIGN_PERMISSIONS);
  if (canManageSchoolLearning(actor) || canManageAssignedLearning(actor)) return;
  notFound();
}

export async function assertCanAccessClassForLearning(
  client: pg.PoolClient,
  actor: Actor,
  classId: string,
): Promise<void> {
  if (canManageSchoolLearning(actor) || canReadSchoolLearning(actor)) return;
  if (!(await isAssignedToClass(client, actor.userId, actor.organisationId!, classId))) {
    notFound();
  }
}

export async function assertCanTargetClass(
  client: pg.PoolClient,
  actor: Actor,
  classId: string,
): Promise<void> {
  assertAnyPermission(actor, LMS_ASSIGN_PERMISSIONS);
  if (canManageSchoolLearning(actor)) return;
  if (!(await isAssignedToClass(client, actor.userId, actor.organisationId!, classId))) {
    notFound();
  }
}

export async function assertCanTargetStudent(
  client: pg.PoolClient,
  actor: Actor,
  studentProfileId: string,
): Promise<void> {
  assertAnyPermission(actor, LMS_ASSIGN_PERMISSIONS);
  if (canManageSchoolLearning(actor)) return;
  const assigned = await assignedStudentIds(client, actor.userId, actor.organisationId!);
  if (!assigned.has(studentProfileId)) notFound();
}

export async function assertCanTargetYearGroup(
  client: pg.PoolClient,
  actor: Actor,
  yearGroupId: string,
): Promise<void> {
  if (!canManageSchoolLearning(actor)) {
    throw new AppError(
      403,
      "forbidden",
      "Year-group targeting requires school-wide learning management",
    );
  }
  const row = await client.query(
    "select 1 from year_groups where id = $1 and organisation_id = $2",
    [yearGroupId, actor.organisationId],
  );
  if (!row.rows[0]) notFound();
}

export async function loadAuthorisedLearningClassIds(
  client: pg.PoolClient,
  actor: Actor,
): Promise<Set<string> | null> {
  if (canReadSchoolLearning(actor) || canManageSchoolLearning(actor)) return null;
  return assignedClassIds(client, actor.userId, actor.organisationId!);
}

export async function loadAuthorisedLearningStudentIds(
  client: pg.PoolClient,
  actor: Actor,
): Promise<Set<string> | null> {
  if (canReadSchoolLearning(actor) || canManageSchoolLearning(actor)) return null;
  return assignedStudentIds(client, actor.userId, actor.organisationId!);
}

export async function assertCanReadAssignment(
  client: pg.PoolClient,
  actor: Actor,
  assignmentId: string,
): Promise<void> {
  assertAnyPermission(actor, LMS_READ_WORK_PERMISSIONS);
  if (canReadSchoolLearning(actor) || canManageSchoolLearning(actor)) return;

  const result = await client.query<{ created_by: string; class_id: string | null; student_profile_id: string }>(
    `select a.created_by, t.class_id, r.student_profile_id
     from learning_assignments a
     left join learning_assignment_targets t on t.assignment_id = a.id
     left join learning_assignment_recipients r on r.assignment_id = a.id
     where a.id = $1 and a.organisation_id = $2`,
    [assignmentId, actor.organisationId],
  );
  if (result.rows.length === 0) notFound();
  if (result.rows.some((row) => row.created_by === actor.userId)) return;

  const classIds = await assignedClassIds(client, actor.userId, actor.organisationId!);
  const studentIds = await assignedStudentIds(client, actor.userId, actor.organisationId!);
  const allowed = result.rows.some(
    (row) =>
      (row.class_id && classIds.has(row.class_id)) ||
      (row.student_profile_id && studentIds.has(row.student_profile_id)),
  );
  if (!allowed) notFound();
}

export async function assertCanManageAssignment(
  client: pg.PoolClient,
  actor: Actor,
  assignmentId: string,
): Promise<void> {
  assertAnyPermission(actor, LMS_ASSIGN_PERMISSIONS);
  if (canManageSchoolLearning(actor)) return;
  await assertCanReadAssignment(client, actor, assignmentId);
  if (!canManageAssignedLearning(actor)) notFound();
}

export async function canSeeLearningRecipient(
  client: pg.PoolClient,
  actor: Actor,
  assignmentId: string,
  studentProfileId: string,
): Promise<boolean> {
  if (canReadSchoolLearning(actor) || canManageSchoolLearning(actor) || canMarkSchoolLearning(actor)) {
    return true;
  }
  const assignedStudents = await assignedStudentIds(client, actor.userId, actor.organisationId!);
  if (assignedStudents.has(studentProfileId)) return true;
  const recipient = await client.query<{ class_id: string | null }>(
    `select class_id from learning_assignment_recipients
     where assignment_id = $1 and student_profile_id = $2 and organisation_id = $3`,
    [assignmentId, studentProfileId, actor.organisationId],
  );
  if (!recipient.rows[0]) return false;
  const classIds = await assignedClassIds(client, actor.userId, actor.organisationId!);
  return Boolean(recipient.rows[0].class_id && classIds.has(recipient.rows[0].class_id));
}

export async function assertCanReadOrMarkSubmission(
  client: pg.PoolClient,
  actor: Actor,
  studentProfileId: string,
  mode: "read" | "mark",
  assignmentId?: string,
): Promise<void> {
  if (mode === "mark") {
    assertAnyPermission(actor, LMS_MARK_PERMISSIONS);
  } else {
    assertAnyPermission(actor, LMS_READ_SUBMISSION_PERMISSIONS);
  }
  if (assignmentId) {
    if (!(await canSeeLearningRecipient(client, actor, assignmentId, studentProfileId))) {
      notFound();
    }
    return;
  }
  if (canReadSchoolLearning(actor) || canManageSchoolLearning(actor) || canMarkSchoolLearning(actor)) {
    return;
  }
  const assigned = await assignedStudentIds(client, actor.userId, actor.organisationId!);
  if (!assigned.has(studentProfileId)) notFound();
}

export type ResolvedRecipient = {
  studentProfileId: string;
  classId: string | null;
  yearGroupId: string | null;
  sourceTargetId: string;
};

export async function resolveTargetRecipients(
  client: pg.PoolClient,
  organisationId: string,
  academicYearId: string,
  target: {
    id: string;
    targetType: string;
    classId: string | null;
    yearGroupId: string | null;
    studentProfileId: string | null;
  },
): Promise<ResolvedRecipient[]> {
  if (target.targetType === "class" && target.classId) {
    const rows = await client.query<{
      student_profile_id: string;
      class_id: string;
      year_group_id: string | null;
    }>(
      `select cm.student_profile_id, cm.class_id, c.year_group_id
       from class_memberships cm
       join classes c on c.id = cm.class_id
       where cm.organisation_id = $1
         and cm.class_id = $2
         and cm.ended_on is null`,
      [organisationId, target.classId],
    );
    return rows.rows.map((row) => ({
      studentProfileId: row.student_profile_id,
      classId: row.class_id,
      yearGroupId: row.year_group_id,
      sourceTargetId: target.id,
    }));
  }
  if (target.targetType === "year_group" && target.yearGroupId) {
    const rows = await client.query<{
      student_profile_id: string;
      year_group_id: string;
      class_id: string | null;
    }>(
      `select se.student_profile_id, se.year_group_id, form.class_id
       from student_enrolments se
       left join lateral (
         select cm.class_id
         from class_memberships cm
         join classes c on c.id = cm.class_id
         where cm.student_profile_id = se.student_profile_id
           and cm.ended_on is null
           and c.class_type = 'form'
           and cm.academic_year_id = se.academic_year_id
         limit 1
       ) form on true
       where se.organisation_id = $1
         and se.academic_year_id = $2
         and se.year_group_id = $3
         and se.is_primary
         and se.ended_on is null
         and se.status = 'enrolled'`,
      [organisationId, academicYearId, target.yearGroupId],
    );
    return rows.rows.map((row) => ({
      studentProfileId: row.student_profile_id,
      classId: row.class_id,
      yearGroupId: row.year_group_id,
      sourceTargetId: target.id,
    }));
  }
  if (target.targetType === "student" && target.studentProfileId) {
    const row = await client.query<{
      student_profile_id: string;
      year_group_id: string | null;
      class_id: string | null;
    }>(
      `select sp.id as student_profile_id, se.year_group_id, form.class_id
       from student_profiles sp
       left join academic_years ay
         on ay.organisation_id = sp.organisation_id and ay.id = $3
       left join student_enrolments se
         on se.student_profile_id = sp.id
        and se.academic_year_id = ay.id
        and se.is_primary
        and se.ended_on is null
       left join lateral (
         select cm.class_id
         from class_memberships cm
         join classes c on c.id = cm.class_id
         where cm.student_profile_id = sp.id
           and cm.ended_on is null
           and c.class_type = 'form'
           and ay.id is not null
           and cm.academic_year_id = ay.id
         limit 1
       ) form on true
       where sp.id = $1 and sp.organisation_id = $2`,
      [target.studentProfileId, organisationId, academicYearId],
    );
    const found = row.rows[0];
    if (!found) return [];
    return [
      {
        studentProfileId: found.student_profile_id,
        classId: found.class_id,
        yearGroupId: found.year_group_id,
        sourceTargetId: target.id,
      },
    ];
  }
  return [];
}

export async function snapshotAssignmentRecipients(
  client: pg.PoolClient,
  organisationId: string,
  assignmentId: string,
  academicYearId: string,
): Promise<number> {
  const targets = await client.query<{
    id: string;
    target_type: string;
    class_id: string | null;
    year_group_id: string | null;
    student_profile_id: string | null;
  }>(
    `select id, target_type, class_id, year_group_id, student_profile_id
     from learning_assignment_targets
     where assignment_id = $1 and organisation_id = $2`,
    [assignmentId, organisationId],
  );
  const seen = new Set<string>();
  for (const target of targets.rows) {
    const recipients = await resolveTargetRecipients(client, organisationId, academicYearId, {
      id: target.id,
      targetType: target.target_type,
      classId: target.class_id,
      yearGroupId: target.year_group_id,
      studentProfileId: target.student_profile_id,
    });
    for (const recipient of recipients) {
      if (seen.has(recipient.studentProfileId)) continue;
      seen.add(recipient.studentProfileId);
      await client.query(
        `insert into learning_assignment_recipients (
           organisation_id, assignment_id, student_profile_id, source_target_id, class_id, year_group_id
         ) values ($1, $2, $3, $4, $5, $6)
         on conflict (assignment_id, student_profile_id) do nothing`,
        [
          organisationId,
          assignmentId,
          recipient.studentProfileId,
          recipient.sourceTargetId,
          recipient.classId,
          recipient.yearGroupId,
        ],
      );
    }
  }
  const count = await client.query<{ n: number }>(
    `select count(*)::int as n from learning_assignment_recipients
     where assignment_id = $1 and organisation_id = $2`,
    [assignmentId, organisationId],
  );
  return count.rows[0]?.n ?? 0;
}

async function recipientUsers(
  client: pg.PoolClient,
  organisationId: string,
  assignmentId: string,
): Promise<Array<{ userId: string; studentProfileId: string }>> {
  const rows = await client.query<{ user_id: string; student_profile_id: string }>(
    `select sp.user_id, r.student_profile_id
     from learning_assignment_recipients r
     join student_profiles sp on sp.id = r.student_profile_id
     where r.assignment_id = $1
       and r.organisation_id = $2
       and sp.user_id is not null`,
    [assignmentId, organisationId],
  );
  return rows.rows
    .filter((row) => row.user_id)
    .map((row) => ({ userId: row.user_id, studentProfileId: row.student_profile_id }));
}

async function parentUsersForStudents(
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

export async function notifyLearningAssigned(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    assignmentId: string;
    title: string;
    dueAt: string | null;
  },
): Promise<void> {
  const students = await recipientUsers(client, input.organisationId, input.assignmentId);
  const parents = await parentUsersForStudents(
    client,
    input.organisationId,
    students.map((row) => row.studentProfileId),
  );
  const dueSoon =
    input.dueAt != null && new Date(input.dueAt).getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000;
  for (const student of students) {
    await createInboxNotification(client, {
      organisationId: input.organisationId,
      recipientUserId: student.userId,
      actorUserId: input.actorUserId,
      type: "learning_assigned",
      category: "homework",
      title: "New learning work",
      body: learningNotificationBody("assigned", input.title),
      actionTarget: { assignmentId: input.assignmentId, studentProfileId: student.studentProfileId },
      idempotencyKey: `learning:assigned:${input.assignmentId}:${student.userId}`,
    });
    if (dueSoon) {
      await createInboxNotification(client, {
        organisationId: input.organisationId,
        recipientUserId: student.userId,
        actorUserId: input.actorUserId,
        type: "learning_due",
        category: "homework",
        title: "Learning work due soon",
        body: learningNotificationBody("due", input.title),
        actionTarget: { assignmentId: input.assignmentId, studentProfileId: student.studentProfileId },
        idempotencyKey: `learning:due:${input.assignmentId}:${student.userId}`,
      });
    }
  }
  for (const parent of parents) {
    await createInboxNotification(client, {
      organisationId: input.organisationId,
      recipientUserId: parent.userId,
      actorUserId: input.actorUserId,
      type: "learning_assigned",
      category: "homework",
      title: "New learning work",
      body: learningNotificationBody("assigned", input.title),
      actionTarget: { assignmentId: input.assignmentId, studentProfileId: parent.studentProfileId },
      idempotencyKey: `learning:assigned:${input.assignmentId}:${parent.userId}:${parent.studentProfileId}`,
    });
  }
}

export async function notifyLearningFeedback(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    assignmentId: string;
    submissionId: string;
    title: string;
    studentUserId: string | null;
    studentProfileId: string;
    releaseToStudent: boolean;
    releaseToParent: boolean;
    resubmission: boolean;
  },
): Promise<void> {
  if (input.releaseToStudent && input.studentUserId) {
    await createInboxNotification(client, {
      organisationId: input.organisationId,
      recipientUserId: input.studentUserId,
      actorUserId: input.actorUserId,
      type: input.resubmission ? "learning_resubmission" : "learning_feedback",
      category: "feedback",
      title: input.resubmission ? "Please resubmit" : "Feedback available",
      body: learningNotificationBody(input.resubmission ? "resubmission" : "feedback", input.title),
      actionTarget: {
        assignmentId: input.assignmentId,
        submissionId: input.submissionId,
        studentProfileId: input.studentProfileId,
      },
      idempotencyKey: input.resubmission
        ? `learning:resubmit:${input.submissionId}:${input.studentUserId}`
        : `learning:feedback:${input.submissionId}:${input.studentUserId}`,
    });
  }
  if (input.releaseToParent) {
    const parents = await parentUsersForStudents(client, input.organisationId, [input.studentProfileId]);
    for (const parent of parents) {
      await createInboxNotification(client, {
        organisationId: input.organisationId,
        recipientUserId: parent.userId,
        actorUserId: input.actorUserId,
        type: "learning_feedback",
        category: "feedback",
        title: "Feedback available",
        body: learningNotificationBody("feedback", input.title),
        actionTarget: {
          assignmentId: input.assignmentId,
          submissionId: input.submissionId,
          studentProfileId: input.studentProfileId,
        },
        idempotencyKey: `learning:feedback:${input.submissionId}:${parent.userId}`,
      });
    }
  }
}

export function buildLearningResourceKey(input: {
  organisationId: string;
  assignmentId: string;
  resourceId: string;
  filename: string;
}): string {
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "resource";
  return `org/${input.organisationId}/learning/${input.assignmentId}/resources/${input.resourceId}/${safeName}`;
}

export function buildSubmissionAttachmentKey(input: {
  organisationId: string;
  submissionId: string;
  revisionId: string;
  filename: string;
}): string {
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "attachment";
  return `org/${input.organisationId}/learning/submissions/${input.submissionId}/${input.revisionId}/${safeName}`;
}
