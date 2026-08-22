import { PERMISSIONS, type Actor } from "@schoolapp/domain";
import type pg from "pg";
import { AppError } from "./errors.js";
import { notFound } from "./permissions.js";
import {
  assignedClassIds,
  assignedStudentIds,
  isAssignedToClass,
} from "./students-access.js";
import { createInboxNotification } from "./admissions.js";
import { academicNotificationBody } from "./assessments.js";

export const ASSESSMENT_SCHOOL_READ_PERMISSIONS = [
  PERMISSIONS.ASSESSMENTS_READ,
  PERMISSIONS.ASSESSMENTS_MANAGE,
  PERMISSIONS.ACADEMIC_OVERSIGHT,
] as const;

export const ASSESSMENT_MANAGE_PERMISSIONS = [
  PERMISSIONS.ASSESSMENTS_MANAGE,
  PERMISSIONS.ASSESSMENTS_MANAGE_ASSIGNED,
] as const;

export const ASSESSMENT_READ_PERMISSIONS = [
  ...ASSESSMENT_SCHOOL_READ_PERMISSIONS,
  PERMISSIONS.ASSESSMENTS_READ_ASSIGNED,
  PERMISSIONS.ASSESSMENTS_MANAGE_ASSIGNED,
] as const;

export const RESULT_SCHOOL_READ_PERMISSIONS = [
  PERMISSIONS.RESULTS_READ,
  PERMISSIONS.RESULTS_ENTER,
  PERMISSIONS.RESULTS_REVIEW,
  PERMISSIONS.RESULTS_PUBLISH,
  PERMISSIONS.ACADEMIC_OVERSIGHT,
] as const;

export const RESULT_ENTER_PERMISSIONS = [
  PERMISSIONS.RESULTS_ENTER,
  PERMISSIONS.RESULTS_ENTER_ASSIGNED,
] as const;

export const RESULT_READ_PERMISSIONS = [
  ...RESULT_SCHOOL_READ_PERMISSIONS,
  PERMISSIONS.RESULTS_READ_ASSIGNED,
  PERMISSIONS.RESULTS_ENTER_ASSIGNED,
] as const;

export const REPORT_SCHOOL_READ_PERMISSIONS = [
  PERMISSIONS.REPORTS_READ,
  PERMISSIONS.REPORTS_MANAGE,
  PERMISSIONS.REPORTS_REVIEW,
  PERMISSIONS.REPORTS_PUBLISH,
  PERMISSIONS.ACADEMIC_OVERSIGHT,
] as const;

export const REPORT_MANAGE_PERMISSIONS = [
  PERMISSIONS.REPORTS_MANAGE,
  PERMISSIONS.REPORTS_MANAGE_ASSIGNED,
] as const;

export const REPORT_READ_PERMISSIONS = [
  ...REPORT_SCHOOL_READ_PERMISSIONS,
  PERMISSIONS.REPORTS_READ_ASSIGNED,
  PERMISSIONS.REPORTS_MANAGE_ASSIGNED,
] as const;

export function canReadSchoolAssessments(actor: Actor): boolean {
  return ASSESSMENT_SCHOOL_READ_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canManageSchoolAssessments(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ASSESSMENTS_MANAGE);
}

export function canReadSchoolResults(actor: Actor): boolean {
  return RESULT_SCHOOL_READ_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canEnterSchoolResults(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.RESULTS_ENTER);
}

export function canReviewResults(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.RESULTS_REVIEW);
}

export function canPublishResults(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.RESULTS_PUBLISH);
}

export function canReadSchoolReports(actor: Actor): boolean {
  return REPORT_SCHOOL_READ_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canManageSchoolReports(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.REPORTS_MANAGE);
}

export function canReviewReports(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.REPORTS_REVIEW);
}

export function canPublishReports(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.REPORTS_PUBLISH);
}

export async function loadAuthorisedAssessmentClassIds(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
): Promise<Set<string> | null> {
  if (canReadSchoolAssessments(actor) || canReadSchoolResults(actor)) return null;
  return assignedClassIds(client, actor.userId, organisationId);
}

export async function loadAuthorisedAssessmentStudentIds(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
): Promise<Set<string> | null> {
  if (canReadSchoolAssessments(actor) || canReadSchoolResults(actor)) return null;
  return assignedStudentIds(client, actor.userId, organisationId);
}

export async function assertCanTargetAssessmentClass(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  classId: string,
): Promise<void> {
  if (canManageSchoolAssessments(actor)) return;
  if (!actor.permissions.has(PERMISSIONS.ASSESSMENTS_MANAGE_ASSIGNED)) {
    notFound();
  }
  if (!(await isAssignedToClass(client, actor.userId, organisationId, classId))) {
    notFound();
  }
}

export async function assertCanManageAssessment(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  assessment: { id: string; created_by: string },
): Promise<void> {
  if (canManageSchoolAssessments(actor)) return;
  if (
    actor.permissions.has(PERMISSIONS.ASSESSMENTS_MANAGE_ASSIGNED) &&
    assessment.created_by === actor.userId
  ) {
    return;
  }
  notFound();
}

export async function canSeeAssessment(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  assessmentId: string,
): Promise<boolean> {
  if (canReadSchoolAssessments(actor) || canReadSchoolResults(actor)) return true;
  const assignedClasses = await assignedClassIds(client, actor.userId, organisationId);
  const assignedStudents = await assignedStudentIds(client, actor.userId, organisationId);
  const hit = await client.query<{ ok: number }>(
    `select 1 as ok
     from academic_assessments a
     where a.id = $1
       and a.organisation_id = $2
       and (
         a.created_by = $3
         or exists (
           select 1 from academic_assessment_classes ac
           where ac.assessment_id = a.id
             and ac.class_id = any ($4::uuid[])
         )
         or exists (
           select 1 from academic_assessment_inclusions i
           where i.assessment_id = a.id
             and (
               i.student_profile_id = any ($5::uuid[])
               or i.class_id = any ($4::uuid[])
             )
         )
       )
     limit 1`,
    [assessmentId, organisationId, actor.userId, [...assignedClasses], [...assignedStudents]],
  );
  return hit.rows.length > 0;
}

export async function assertCanReadAssessment(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  assessmentId: string,
): Promise<void> {
  if (!(await canSeeAssessment(client, actor, organisationId, assessmentId))) {
    notFound();
  }
}

export async function assertCanEnterResultForPupil(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  studentProfileId: string,
): Promise<void> {
  if (canEnterSchoolResults(actor)) return;
  if (!actor.permissions.has(PERMISSIONS.RESULTS_ENTER_ASSIGNED)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
  const assigned = await assignedStudentIds(client, actor.userId, organisationId);
  if (!assigned.has(studentProfileId)) {
    notFound();
  }
}

export async function assertCanReadStudentAcademic(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  studentProfileId: string,
): Promise<void> {
  if (canReadSchoolAssessments(actor) || canReadSchoolResults(actor) || canReadSchoolReports(actor)) {
    return;
  }
  const assigned = await assignedStudentIds(client, actor.userId, organisationId);
  if (
    (actor.permissions.has(PERMISSIONS.ASSESSMENTS_READ_ASSIGNED) ||
      actor.permissions.has(PERMISSIONS.RESULTS_READ_ASSIGNED) ||
      actor.permissions.has(PERMISSIONS.RESULTS_ENTER_ASSIGNED) ||
      actor.permissions.has(PERMISSIONS.REPORTS_READ_ASSIGNED) ||
      actor.permissions.has(PERMISSIONS.REPORTS_MANAGE_ASSIGNED)) &&
    assigned.has(studentProfileId)
  ) {
    return;
  }
  notFound();
}

export async function assertCanManageReport(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  report: { created_by: string; student_profile_id: string },
): Promise<void> {
  if (canManageSchoolReports(actor)) return;
  if (!actor.permissions.has(PERMISSIONS.REPORTS_MANAGE_ASSIGNED)) {
    notFound();
  }
  const assigned = await assignedStudentIds(client, actor.userId, organisationId);
  if (!assigned.has(report.student_profile_id)) {
    notFound();
  }
}

export async function assertCanReadReport(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  report: { student_profile_id: string; created_by: string },
): Promise<void> {
  if (canReadSchoolReports(actor)) return;
  if (
    actor.permissions.has(PERMISSIONS.REPORTS_READ_ASSIGNED) ||
    actor.permissions.has(PERMISSIONS.REPORTS_MANAGE_ASSIGNED)
  ) {
    const assigned = await assignedStudentIds(client, actor.userId, organisationId);
    if (assigned.has(report.student_profile_id) || report.created_by === actor.userId) {
      return;
    }
  }
  notFound();
}

export async function snapshotAssessmentInclusions(
  client: pg.PoolClient,
  assessmentId: string,
): Promise<number> {
  const result = await client.query<{ snapshot_academic_assessment_inclusions: number }>(
    "select snapshot_academic_assessment_inclusions($1) as snapshot_academic_assessment_inclusions",
    [assessmentId],
  );
  return Number(result.rows[0]?.snapshot_academic_assessment_inclusions ?? 0);
}

export async function parentUsersForStudents(
  client: pg.PoolClient,
  organisationId: string,
  studentIds: string[],
): Promise<Map<string, string[]>> {
  if (studentIds.length === 0) return new Map();
  const result = await client.query<{ student_profile_id: string; guardian_user_id: string }>(
    `select student_profile_id, guardian_user_id
     from guardianships
     where organisation_id = $1
       and student_profile_id = any ($2::uuid[])
       and portal_access = true
       and (ended_on is null or ended_on >= current_date)`,
    [organisationId, studentIds],
  );
  const map = new Map<string, string[]>();
  for (const row of result.rows) {
    const list = map.get(row.student_profile_id) ?? [];
    list.push(row.guardian_user_id);
    map.set(row.student_profile_id, list);
  }
  return map;
}

export async function notifyResultReleased(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    studentProfileId: string;
    studentUserId: string | null;
    title: string;
    releasedToStudent: boolean;
    releasedToParent: boolean;
    resultId: string;
  },
): Promise<void> {
  const body = academicNotificationBody("result_published", input.title);
  if (input.releasedToStudent && input.studentUserId) {
    await createInboxNotification(client, {
      organisationId: input.organisationId,
      recipientUserId: input.studentUserId,
      actorUserId: input.actorUserId,
      type: "result_published",
      category: "results",
      title: "Assessment result available",
      body,
      actionTarget: { resultId: input.resultId },
      idempotencyKey: `result-student-${input.resultId}`,
    });
  }
  if (input.releasedToParent) {
    const parents = await parentUsersForStudents(client, input.organisationId, [
      input.studentProfileId,
    ]);
    for (const parentId of parents.get(input.studentProfileId) ?? []) {
      await createInboxNotification(client, {
        organisationId: input.organisationId,
        recipientUserId: parentId,
        actorUserId: input.actorUserId,
        type: "result_published",
        category: "results",
        title: "Assessment result available",
        body,
        actionTarget: { resultId: input.resultId },
        idempotencyKey: `result-parent-${input.resultId}-${parentId}`,
      });
    }
  }
}

export async function notifyReportPublished(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    studentProfileId: string;
    studentUserId: string | null;
    title: string;
    reportId: string;
  },
): Promise<void> {
  const body = academicNotificationBody("report_available", input.title);
  if (input.studentUserId) {
    await createInboxNotification(client, {
      organisationId: input.organisationId,
      recipientUserId: input.studentUserId,
      actorUserId: input.actorUserId,
      type: "report_available",
      category: "reports",
      title: "Progress report available",
      body,
      actionTarget: { reportId: input.reportId },
      idempotencyKey: `report-student-${input.reportId}`,
    });
  }
  const parents = await parentUsersForStudents(client, input.organisationId, [
    input.studentProfileId,
  ]);
  for (const parentId of parents.get(input.studentProfileId) ?? []) {
    await createInboxNotification(client, {
      organisationId: input.organisationId,
      recipientUserId: parentId,
      actorUserId: input.actorUserId,
      type: "report_available",
      category: "reports",
      title: "Progress report available",
      body,
      actionTarget: { reportId: input.reportId },
      idempotencyKey: `report-parent-${input.reportId}-${parentId}`,
    });
  }
}
