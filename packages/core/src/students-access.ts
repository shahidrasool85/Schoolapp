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
  asOfDate?: string,
): Promise<Set<string>> {
  const result = await client.query<{ student_profile_id: string }>(
    `select distinct cm.student_profile_id
     from class_staff_assignments csa
     join staff_profiles sp on sp.id = csa.staff_profile_id
     join class_memberships cm on cm.class_id = csa.class_id
     join academic_years ay
       on ay.id = cm.academic_year_id
      and ay.organisation_id = $2
     where sp.user_id = $1
       and sp.organisation_id = $2
       and cm.organisation_id = $2
       and (
         (
           $3::date is null
           and (csa.ended_on is null or csa.ended_on >= current_date)
           and (cm.ended_on is null or cm.ended_on >= current_date)
           and ay.is_current
         )
         or (
           $3::date is not null
           and csa.started_on <= $3::date
           and (csa.ended_on is null or csa.ended_on >= $3::date)
           and cm.started_on <= $3::date
           and (cm.ended_on is null or cm.ended_on >= $3::date)
           and ay.starts_on <= $3::date
           and ay.ends_on >= $3::date
         )
       )
     union
     select distinct cm.student_profile_id
     from timetable_covers tc
     join timetable_entries te on te.id = tc.timetable_entry_id
     join staff_profiles sp on sp.id = tc.covering_staff_profile_id
     join class_memberships cm on cm.class_id = te.class_id
     join academic_years ay
       on ay.id = cm.academic_year_id
      and ay.organisation_id = $2
     where sp.user_id = $1
       and sp.organisation_id = $2
       and tc.organisation_id = $2
       and cm.organisation_id = $2
       and (
         (
           $3::date is null
           and tc.cover_date = current_date
           and (cm.ended_on is null or cm.ended_on >= current_date)
           and cm.started_on <= current_date
           and ay.is_current
         )
         or (
           $3::date is not null
           and tc.cover_date = $3::date
           and cm.started_on <= $3::date
           and (cm.ended_on is null or cm.ended_on >= $3::date)
           and ay.starts_on <= $3::date
           and ay.ends_on >= $3::date
         )
       )`,
    [actorUserId, organisationId, asOfDate ?? null],
  );
  return new Set(result.rows.map((row) => row.student_profile_id));
}

export async function isAssignedToClass(
  client: pg.PoolClient,
  actorUserId: string,
  organisationId: string,
  classId: string,
  asOfDate?: string,
): Promise<boolean> {
  const result = await client.query(
    `select 1
     from class_staff_assignments csa
     join staff_profiles sp on sp.id = csa.staff_profile_id
     where sp.user_id = $1
       and sp.organisation_id = $2
       and csa.organisation_id = $2
       and csa.class_id = $3
       and (
         (
           $4::date is null
           and (csa.ended_on is null or csa.ended_on >= current_date)
         )
         or (
           $4::date is not null
           and csa.started_on <= $4::date
           and (csa.ended_on is null or csa.ended_on >= $4::date)
         )
       )
     union
     select 1
     from timetable_covers tc
     join timetable_entries te on te.id = tc.timetable_entry_id
     join staff_profiles sp on sp.id = tc.covering_staff_profile_id
     where sp.user_id = $1
       and sp.organisation_id = $2
       and tc.organisation_id = $2
       and te.class_id = $3
       and tc.cover_date = coalesce($4::date, current_date)
     limit 1`,
    [actorUserId, organisationId, classId, asOfDate ?? null],
  );
  return result.rows.length > 0;
}

export async function assignedClassIds(
  client: pg.PoolClient,
  actorUserId: string,
  organisationId: string,
  asOfDate?: string,
): Promise<Set<string>> {
  const result = await client.query<{ class_id: string }>(
    `select distinct csa.class_id
     from class_staff_assignments csa
     join staff_profiles sp on sp.id = csa.staff_profile_id
     where sp.user_id = $1
       and sp.organisation_id = $2
       and csa.organisation_id = $2
       and (
         (
           $3::date is null
           and (csa.ended_on is null or csa.ended_on >= current_date)
         )
         or (
           $3::date is not null
           and csa.started_on <= $3::date
           and (csa.ended_on is null or csa.ended_on >= $3::date)
         )
       )
     union
     select distinct te.class_id
     from timetable_covers tc
     join timetable_entries te on te.id = tc.timetable_entry_id
     join staff_profiles sp on sp.id = tc.covering_staff_profile_id
     where sp.user_id = $1
       and sp.organisation_id = $2
       and tc.organisation_id = $2
       and tc.cover_date = coalesce($3::date, current_date)`,
    [actorUserId, organisationId, asOfDate ?? null],
  );
  return new Set(result.rows.map((row) => row.class_id));
}

export async function classStudentIdsAsOf(
  client: pg.PoolClient,
  organisationId: string,
  classId: string,
  asOfDate: string,
): Promise<Set<string>> {
  const result = await client.query<{ student_profile_id: string }>(
    `select cm.student_profile_id
     from class_memberships cm
     where cm.organisation_id = $1
       and cm.class_id = $2
       and cm.started_on <= $3::date
       and (cm.ended_on is null or cm.ended_on >= $3::date)`,
    [organisationId, classId, asOfDate],
  );
  return new Set(result.rows.map((row) => row.student_profile_id));
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
