import { PERMISSIONS, type Actor } from "@schoolapp/domain";
import type pg from "pg";
import { AppError } from "./errors.js";
import { resolveStudentPortalAccess, type StudentPortalDecision } from "./student-portal.js";
import { assignedStudentIds, isAssignedToClass } from "./students-access.js";
import { assertAnyPermission, notFound } from "./permissions.js";

export const ATTENDANCE_SCHOOL_READ_PERMISSIONS = [
  PERMISSIONS.ATTENDANCE_RECORD_READ,
  PERMISSIONS.ATTENDANCE_RECORD_MANAGE,
  PERMISSIONS.ATTENDANCE_RECORD_CORRECT,
] as const;

export const ATTENDANCE_REGISTER_PERMISSIONS = [
  PERMISSIONS.ATTENDANCE_RECORD_MANAGE,
  PERMISSIONS.ATTENDANCE_RECORD_MANAGE_ASSIGNED,
] as const;

export function canReadSchoolAttendance(actor: Actor): boolean {
  return ATTENDANCE_SCHOOL_READ_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canManageSchoolAttendance(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ATTENDANCE_RECORD_MANAGE);
}

export function canCorrectAttendance(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.ATTENDANCE_RECORD_CORRECT) ||
    actor.permissions.has(PERMISSIONS.ATTENDANCE_RECORD_MANAGE)
  );
}

export function canManageAssignedAttendance(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ATTENDANCE_RECORD_MANAGE_ASSIGNED);
}

export function canManageAttendanceConfig(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ATTENDANCE_CONFIG_MANAGE);
}

export function canReadOwnChildrenAttendance(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ATTENDANCE_RECORD_READ_OWN_CHILDREN);
}

export function canReadOwnAttendance(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ATTENDANCE_RECORD_READ_SELF);
}

export async function assertCanAccessRegister(
  client: pg.PoolClient,
  actor: Actor,
  classId: string,
  asOfDate: string,
): Promise<void> {
  assertAnyPermission(actor, ATTENDANCE_REGISTER_PERMISSIONS);
  if (canManageSchoolAttendance(actor)) return;
  if (!(await isAssignedToClass(client, actor.userId, actor.organisationId!, classId, asOfDate))) {
    notFound();
  }
}

export async function assertCanReadStudentAttendance(
  client: pg.PoolClient,
  actor: Actor,
  studentProfileId: string,
  asOfDate?: string,
): Promise<void> {
  if (canReadSchoolAttendance(actor) || canManageSchoolAttendance(actor)) {
    return;
  }
  if (canManageAssignedAttendance(actor)) {
    const assigned = await assignedStudentIds(
      client,
      actor.userId,
      actor.organisationId!,
      asOfDate,
    );
    if (assigned.has(studentProfileId)) return;
    notFound();
  }
  notFound();
}

export async function loadStudentPortalDecision(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
): Promise<StudentPortalDecision> {
  const result = await client.query<{
    school_default: boolean;
    year_group_override: boolean | null;
    class_override: boolean | null;
    student_override: boolean | null;
  }>(
    `select
       coalesce(pol.default_enabled, false) as school_default,
       yg_ovr.enabled as year_group_override,
       cl_ovr.enabled as class_override,
       st_ovr.enabled as student_override
     from student_profiles sp
     left join student_portal_policies pol
       on pol.organisation_id = sp.organisation_id
     left join academic_years ay
       on ay.organisation_id = sp.organisation_id and ay.is_current
     left join student_enrolments se
       on se.student_profile_id = sp.id
      and se.academic_year_id = ay.id
      and se.is_primary
      and se.ended_on is null
     left join student_portal_year_group_overrides yg_ovr
       on yg_ovr.year_group_id = se.year_group_id
      and yg_ovr.organisation_id = sp.organisation_id
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
     left join student_portal_class_overrides cl_ovr
       on cl_ovr.class_id = form.class_id
      and cl_ovr.organisation_id = sp.organisation_id
     left join student_portal_student_overrides st_ovr
       on st_ovr.student_profile_id = sp.id
      and st_ovr.organisation_id = sp.organisation_id
     where sp.id = $1 and sp.organisation_id = $2`,
    [studentProfileId, organisationId],
  );
  const row = result.rows[0];
  if (!row) {
    return { enabled: false, source: "school" };
  }
  return resolveStudentPortalAccess({
    schoolDefault: row.school_default,
    yearGroupOverride: row.year_group_override,
    classOverride: row.class_override,
    studentOverride: row.student_override,
  });
}

export async function requireStudentPortalEnabled(
  client: pg.PoolClient,
  organisationId: string,
  userId: string,
): Promise<string> {
  const profile = await client.query<{ id: string }>(
    `select sp.id
     from student_profiles sp
     join academic_years ay
       on ay.organisation_id = sp.organisation_id
      and ay.is_current
     join student_enrolments se
       on se.student_profile_id = sp.id
      and se.academic_year_id = ay.id
      and se.is_primary
      and se.ended_on is null
     where sp.organisation_id = $1 and sp.user_id = $2`,
    [organisationId, userId],
  );
  const studentProfileId = profile.rows[0]?.id;
  if (!studentProfileId) {
    throw new AppError(404, "not_found", "Not found");
  }
  const decision = await loadStudentPortalDecision(client, organisationId, studentProfileId);
  if (!decision.enabled) {
    throw new AppError(403, "student_portal_disabled", "Student portal access is not enabled");
  }
  return studentProfileId;
}

export function studentDocumentVisibleToAudience(
  visibility: string,
  audience: "staff" | "parent" | "student",
): boolean {
  if (audience === "staff") return true;
  if (audience === "parent") {
    return visibility === "staff_and_parents" || visibility === "staff_parents_and_student";
  }
  return visibility === "staff_parents_and_student";
}

export function buildStudentDocumentKey(input: {
  organisationId: string;
  studentProfileId: string;
  documentId: string;
  filename: string;
}): string {
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "document";
  return `org/${input.organisationId}/students/${input.studentProfileId}/documents/${input.documentId}/${safeName}`;
}
