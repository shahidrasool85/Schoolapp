import { PERMISSIONS } from "@schoolapp/domain";
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
    const linked = await client.query(
      `select 1 from guardianships
       where student_profile_id = $1
         and guardian_user_id = $2
         and organisation_id = $3
         and portal_access = true
         and (ended_on is null or ended_on >= current_date)`,
      [studentProfileId, actorUserId, organisationId],
    );
    if ((linked.rowCount ?? 0) > 0) {
      return true;
    }
  }

  if (permissions.has(PERMISSIONS.STUDENTS_PROFILES_READ_ASSIGNED)) {
    const assigned = await client.query(
      `select 1
       from class_staff_assignments csa
       join staff_profiles sp on sp.id = csa.staff_profile_id
       join class_memberships cm on cm.class_id = csa.class_id
       where sp.user_id = $1
         and sp.organisation_id = $2
         and cm.student_profile_id = $3
         and cm.organisation_id = $2
         and (csa.ended_on is null or csa.ended_on >= current_date)
         and (cm.ended_on is null or cm.ended_on >= current_date)`,
      [actorUserId, organisationId, studentProfileId],
    );
    return (assigned.rowCount ?? 0) > 0;
  }

  return false;
}

export function canReadRestrictedContact(permissions: ReadonlySet<string>): boolean {
  return permissions.has(PERMISSIONS.STUDENTS_RESTRICTED_CONTACT_READ);
}
