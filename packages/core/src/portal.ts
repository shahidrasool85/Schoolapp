import type pg from "pg";
import { PORTAL_COMING_LATER_MESSAGE } from "@schoolapp/domain";
import { AppError } from "./errors.js";
import { guardianChildIds } from "./students-access.js";

export const comingLater = Object.freeze({
  available: false,
  message: PORTAL_COMING_LATER_MESSAGE,
});

export type ComingLater = typeof comingLater;

export type PortalSchool = {
  id: string;
  name: string;
};

export type PortalStudentView = {
  id: string;
  displayName: string;
  legalName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  admissionNumber: string | null;
  enrolmentStatus: string;
  currentAcademicYearId: string | null;
  currentAcademicYearName: string | null;
  currentYearGroupId: string | null;
  currentYearGroupName: string | null;
  currentFormClassId: string | null;
  currentFormClassName: string | null;
  houseName: string | null;
  school: PortalSchool;
};

export const PORTAL_STUDENT_SQL = `
  select
    sp.id,
    sp.legal_name,
    u.preferred_name,
    u.date_of_birth::text,
    sp.admission_number,
    sp.enrolment_status,
    se.academic_year_id,
    ay.name as academic_year_name,
    se.year_group_id,
    yg.name as year_group_name,
    form.id as form_class_id,
    form.name as form_class_name,
    h.name as house_name,
    o.id as school_id,
    o.name as school_name
  from student_profiles sp
  join organisations o on o.id = sp.organisation_id
  left join users u on u.id = sp.user_id
  left join academic_years ay
    on ay.organisation_id = sp.organisation_id and ay.is_current
  left join student_enrolments se
    on se.student_profile_id = sp.id
   and se.academic_year_id = ay.id
   and se.is_primary
   and se.ended_on is null
  left join year_groups yg on yg.id = se.year_group_id
  left join houses h on h.id = se.house_id
  left join lateral (
    select c.id, c.name
    from class_memberships cm
    join classes c on c.id = cm.class_id
    where cm.student_profile_id = sp.id
      and cm.ended_on is null
      and c.class_type = 'form'
      and ay.id is not null
      and cm.academic_year_id = ay.id
    limit 1
  ) form on true
`;

export function mapPortalStudent(row: Record<string, unknown>): PortalStudentView {
  const legalName = String(row.legal_name ?? "");
  const preferredName = (row.preferred_name as string | null) ?? null;
  return {
    id: String(row.id),
    displayName: preferredName?.trim() || legalName,
    legalName,
    preferredName,
    dateOfBirth: (row.date_of_birth as string | null) ?? null,
    admissionNumber: (row.admission_number as string | null) ?? null,
    enrolmentStatus: String(row.enrolment_status),
    currentAcademicYearId: (row.academic_year_id as string | null) ?? null,
    currentAcademicYearName: (row.academic_year_name as string | null) ?? null,
    currentYearGroupId: (row.year_group_id as string | null) ?? null,
    currentYearGroupName: (row.year_group_name as string | null) ?? null,
    currentFormClassId: (row.form_class_id as string | null) ?? null,
    currentFormClassName: (row.form_class_name as string | null) ?? null,
    houseName: (row.house_name as string | null) ?? null,
    school: {
      id: String(row.school_id),
      name: String(row.school_name),
    },
  };
}

export function portalChildSummary(student: PortalStudentView) {
  return {
    id: student.id,
    displayName: student.displayName,
    legalName: student.legalName,
    preferredName: student.preferredName,
    currentYearGroupName: student.currentYearGroupName,
    currentFormClassName: student.currentFormClassName,
    currentAcademicYearName: student.currentAcademicYearName,
    school: student.school,
    enrolmentStatus: student.enrolmentStatus,
  };
}

export async function loadSchool(
  client: pg.PoolClient,
  organisationId: string,
): Promise<PortalSchool> {
  const result = await client.query<{ id: string; name: string }>(
    "select id, name from organisations where id = $1",
    [organisationId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, "not_found", "Not found");
  }
  return { id: row.id, name: row.name };
}

export async function loadPortalStudentsByIds(
  client: pg.PoolClient,
  organisationId: string,
  studentIds: string[],
): Promise<PortalStudentView[]> {
  if (studentIds.length === 0) return [];
  const result = await client.query(
    `${PORTAL_STUDENT_SQL}
     where sp.organisation_id = $1
       and sp.id = any ($2::uuid[])
     order by sp.legal_name`,
    [organisationId, studentIds],
  );
  return result.rows.map((row) => mapPortalStudent(row as Record<string, unknown>));
}

export async function loadPortalStudent(
  client: pg.PoolClient,
  organisationId: string,
  studentId: string,
): Promise<PortalStudentView | null> {
  const result = await client.query(
    `${PORTAL_STUDENT_SQL}
     where sp.organisation_id = $1
       and sp.id = $2`,
    [organisationId, studentId],
  );
  const row = result.rows[0];
  return row ? mapPortalStudent(row as Record<string, unknown>) : null;
}

export async function loadOwnStudentProfile(
  client: pg.PoolClient,
  organisationId: string,
  userId: string,
): Promise<PortalStudentView | null> {
  const result = await client.query(
    `${PORTAL_STUDENT_SQL}
     where sp.organisation_id = $1
       and sp.user_id = $2`,
    [organisationId, userId],
  );
  const row = result.rows[0];
  return row ? mapPortalStudent(row as Record<string, unknown>) : null;
}

export async function requireLinkedChild(
  client: pg.PoolClient,
  userId: string,
  organisationId: string,
  studentId: string,
): Promise<Set<string>> {
  const childIds = await guardianChildIds(client, userId, organisationId);
  if (!childIds.has(studentId)) {
    throw new AppError(404, "not_found", "Not found");
  }
  return childIds;
}

export async function loadViewerGuardianship(
  client: pg.PoolClient,
  organisationId: string,
  studentId: string,
  guardianUserId: string,
): Promise<{
  relationship: string;
  hasParentalResponsibility: boolean;
  isEmergencyContact: boolean;
  livesWithStudent: boolean;
  portalAccess: boolean;
  priority: number;
} | null> {
  const result = await client.query<{
    relationship: string;
    has_parental_responsibility: boolean;
    is_emergency_contact: boolean;
    lives_with_student: boolean;
    portal_access: boolean;
    priority: number;
  }>(
    `select relationship, has_parental_responsibility, is_emergency_contact,
            lives_with_student, portal_access, priority
     from guardianships
     where organisation_id = $1
       and student_profile_id = $2
       and guardian_user_id = $3
       and (ended_on is null or ended_on >= current_date)`,
    [organisationId, studentId, guardianUserId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    relationship: row.relationship,
    hasParentalResponsibility: row.has_parental_responsibility,
    isEmergencyContact: row.is_emergency_contact,
    livesWithStudent: row.lives_with_student,
    portalAccess: row.portal_access,
    priority: row.priority,
  };
}

export const PARENT_CHILD_SECTIONS = Object.freeze({
  attendance: { available: true as const },
  homework: { available: true as const },
  learning: { available: true as const },
  results: { available: true as const },
  teacherFeedback: { available: true as const },
  reports: { available: true as const },
  timetable: { available: true as const },
  achievements: comingLater,
  activities: { available: true as const },
  payments: { available: true as const },
  competitions: comingLater,
});

export const STUDENT_DASHBOARD_SECTIONS = Object.freeze({
  myLearning: { available: true as const },
  homework: { available: true as const },
  results: { available: true as const },
  timetable: { available: true as const },
  activities: { available: true as const },
  challenges: comingLater,
  achievements: comingLater,
});
