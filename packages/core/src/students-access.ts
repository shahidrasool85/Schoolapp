import { PERMISSIONS, type Actor } from "@schoolapp/domain";
import type pg from "pg";

export async function canReadStudentProfile(
  client: pg.PoolClient,
  actorUserId: string,
  organisationId: string,
  studentProfileId: string,
  permissions: ReadonlySet<string>,
): Promise<boolean> {
  const student = await client.query<{
    id: string;
    organisation_id: string;
    user_id: string | null;
  }>(
    `select id, organisation_id, user_id
     from student_profiles
     where id = $1`,
    [studentProfileId],
  );
  const row = student.rows[0];
  if (!row || row.organisation_id !== organisationId) {
    return false;
  }

  if (permissions.has(PERMISSIONS.STUDENTS_PROFILES_READ)) {
    return true;
  }

  if (permissions.has(PERMISSIONS.STUDENTS_PROFILES_READ_SELF) && row.user_id === actorUserId) {
    return true;
  }

  if (permissions.has(PERMISSIONS.STUDENTS_PROFILES_READ_OWN_CHILDREN)) {
    const linked = await guardianChildIds(client, actorUserId, organisationId);
    if (linked.has(studentProfileId)) {
      return true;
    }
  }

  if (permissions.has(PERMISSIONS.STUDENTS_PROFILES_READ_ASSIGNED)) {
    const assigned = await assignedStudentIds(client, actorUserId, organisationId);
    return assigned.has(studentProfileId);
  }

  return false;
}

export function canReadRestrictedContact(permissions: ReadonlySet<string>): boolean {
  return permissions.has(PERMISSIONS.STUDENTS_RESTRICTED_CONTACT_READ);
}

export async function assignedStudentIds(
  client: pg.PoolClient,
  actorUserId: string,
  organisationId: string,
): Promise<Set<string>> {
  const result = await client.query<{ student_profile_id: string }>(
    `select distinct cm.student_profile_id
     from class_staff_assignments csa
     join staff_profiles sp on sp.id = csa.staff_profile_id
     join class_memberships cm on cm.class_id = csa.class_id
     join academic_years ay
       on ay.id = cm.academic_year_id
      and ay.organisation_id = $2
      and ay.is_current
     where sp.user_id = $1
       and sp.organisation_id = $2
       and cm.organisation_id = $2
       and (csa.ended_on is null or csa.ended_on >= current_date)
       and (cm.ended_on is null or cm.ended_on >= current_date)`,
    [actorUserId, organisationId],
  );
  return new Set(result.rows.map((row) => row.student_profile_id));
}

export async function isAssignedToClass(
  client: pg.PoolClient,
  actorUserId: string,
  organisationId: string,
  classId: string,
): Promise<boolean> {
  const result = await client.query(
    `select 1
     from class_staff_assignments csa
     join staff_profiles sp on sp.id = csa.staff_profile_id
     where sp.user_id = $1
       and sp.organisation_id = $2
       and csa.organisation_id = $2
       and csa.class_id = $3
       and (csa.ended_on is null or csa.ended_on >= current_date)
     limit 1`,
    [actorUserId, organisationId, classId],
  );
  return result.rows.length > 0;
}

export async function guardianChildIds(
  client: pg.PoolClient,
  actorUserId: string,
  organisationId: string,
): Promise<Set<string>> {
  const result = await client.query<{ student_profile_id: string }>(
    `select student_profile_id
     from guardianships
     where guardian_user_id = $1
       and organisation_id = $2
       and portal_access = true
       and (ended_on is null or ended_on >= current_date)`,
    [actorUserId, organisationId],
  );
  return new Set(result.rows.map((row) => row.student_profile_id));
}

export function canListAllStudents(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.STUDENTS_PROFILES_READ);
}

export function canManageStudents(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.STUDENTS_PROFILES_MANAGE);
}

export function canManageAcademicStructure(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
}

export function canReadAcademicStructure(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.ACADEMIC_STRUCTURE_READ) ||
    actor.permissions.has(PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE)
  );
}
