import { PERMISSIONS, type Actor } from "@schoolapp/domain";
import type pg from "pg";
import { AppError } from "./errors.js";
import { notFound } from "./permissions.js";

/**
 * Authoritative teacher academic scope for teaching operations.
 *
 * Ordinary teachers may only act on classes they are explicitly assigned to
 * via class_staff_assignments for the relevant academic year. Membership of
 * the organisation, sharing a year group, or academic-structure read is not
 * enough. Cover/timetable participation is intentionally excluded here —
 * those grants are for the cover date / lesson view, not homework targeting.
 */
export type TeacherAcademicScope = {
  classIds: Set<string>;
  yearGroupIds: Set<string>;
  /** Union of class_subjects on assigned classes. Empty means no subjects, not all subjects. */
  subjectIds: Set<string>;
  classYearGroup: Map<string, string | null>;
  classSubjectIds: Map<string, Set<string>>;
};

/**
 * Subjects a teacher may attach to learning work.
 * There is no teacher+class+subject assignment table; class_subjects is the
 * curriculum attached to a class. Never fall back to every organisation subject.
 */
export function allowedSubjectIdsForClasses(
  classSubjectIds: Map<string, Set<string>>,
  classIds?: string[] | null,
): Set<string> {
  if (!classIds?.length) {
    const all = new Set<string>();
    for (const subjects of classSubjectIds.values()) {
      for (const id of subjects) all.add(id);
    }
    return all;
  }
  let intersection: Set<string> | null = null;
  for (const classId of classIds) {
    const subjects = classSubjectIds.get(classId) ?? new Set<string>();
    if (intersection === null) {
      intersection = new Set(subjects);
      continue;
    }
    const next = new Set<string>();
    for (const id of intersection) {
      if (subjects.has(id)) next.add(id);
    }
    intersection = next;
  }
  return intersection ?? new Set();
}

export async function loadTeacherAcademicScope(
  client: pg.PoolClient,
  actorUserId: string,
  organisationId: string,
  options?: { academicYearId?: string | null; asOfDate?: string | null },
): Promise<TeacherAcademicScope> {
  const result = await client.query<{
    class_id: string;
    year_group_id: string | null;
    subject_id: string | null;
  }>(
    `select distinct
       c.id as class_id,
       c.year_group_id,
       cs.subject_id
     from class_staff_assignments csa
     join staff_profiles sp on sp.id = csa.staff_profile_id
     join classes c on c.id = csa.class_id
     join academic_years ay
       on ay.id = c.academic_year_id
      and ay.organisation_id = $2
     left join class_subjects cs
       on cs.class_id = c.id
      and cs.organisation_id = $2
     where sp.user_id = $1
       and sp.organisation_id = $2
       and csa.organisation_id = $2
       and c.organisation_id = $2
       and c.status = 'active'
       and (
         ($3::uuid is null and ay.is_current)
         or ay.id = $3::uuid
       )
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
       )`,
    [actorUserId, organisationId, options?.academicYearId ?? null, options?.asOfDate ?? null],
  );

  const classIds = new Set<string>();
  const yearGroupIds = new Set<string>();
  const subjectIds = new Set<string>();
  const classYearGroup = new Map<string, string | null>();
  const classSubjectIds = new Map<string, Set<string>>();
  for (const row of result.rows) {
    classIds.add(row.class_id);
    classYearGroup.set(row.class_id, row.year_group_id);
    if (!classSubjectIds.has(row.class_id)) classSubjectIds.set(row.class_id, new Set());
    if (row.year_group_id) yearGroupIds.add(row.year_group_id);
    if (row.subject_id) {
      subjectIds.add(row.subject_id);
      classSubjectIds.get(row.class_id)!.add(row.subject_id);
    }
  }
  return { classIds, yearGroupIds, subjectIds, classYearGroup, classSubjectIds };
}

export function actorHasSchoolWideTeachingScope(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.LMS_ASSIGNMENTS_MANAGE) ||
    actor.permissions.has(PERMISSIONS.LMS_ASSIGNMENTS_READ)
  );
}

export async function loadScopedTeachingClasses(
  client: pg.PoolClient,
  actor: Actor,
  options?: { academicYearId?: string | null; asOfDate?: string | null },
): Promise<TeacherAcademicScope | null> {
  if (actorHasSchoolWideTeachingScope(actor)) return null;
  return loadTeacherAcademicScope(client, actor.userId, actor.organisationId!, options);
}

export async function assertClassInTeacherScope(
  client: pg.PoolClient,
  actor: Actor,
  classId: string,
  options?: { academicYearId?: string | null },
): Promise<{ yearGroupId: string | null }> {
  const row = await client.query<{ id: string; year_group_id: string | null }>(
    `select id, year_group_id from classes
     where id = $1 and organisation_id = $2`,
    [classId, actor.organisationId],
  );
  if (!row.rows[0]) notFound();
  if (actor.permissions.has(PERMISSIONS.LMS_ASSIGNMENTS_MANAGE)) {
    return { yearGroupId: row.rows[0].year_group_id };
  }
  const scope = await loadTeacherAcademicScope(client, actor.userId, actor.organisationId!, options);
  if (!scope.classIds.has(classId)) {
    throw new AppError(403, "forbidden", "You can only assign work to classes you are assigned to teach");
  }
  return { yearGroupId: row.rows[0].year_group_id };
}

export async function assertYearGroupInTeacherScope(
  client: pg.PoolClient,
  actor: Actor,
  yearGroupId: string,
  options?: { academicYearId?: string | null; allowedClassIds?: string[] },
): Promise<void> {
  const row = await client.query(
    "select 1 from year_groups where id = $1 and organisation_id = $2",
    [yearGroupId, actor.organisationId],
  );
  if (!row.rows[0]) notFound();
  if (actor.permissions.has(PERMISSIONS.LMS_ASSIGNMENTS_MANAGE)) return;
  const scope = await loadTeacherAcademicScope(client, actor.userId, actor.organisationId!, options);
  if (!scope.yearGroupIds.has(yearGroupId)) {
    throw new AppError(403, "forbidden", "You can only target year groups of classes you are assigned to teach");
  }
  if (options?.allowedClassIds?.length) {
    const allowed = options.allowedClassIds.some((classId) => scope.classYearGroup.get(classId) === yearGroupId);
    if (!allowed) {
      throw new AppError(403, "forbidden", "Year group must match the selected class");
    }
  }
}

export async function assertSubjectInTeacherScope(
  client: pg.PoolClient,
  actor: Actor,
  subjectId: string,
  options?: { academicYearId?: string | null; classIds?: string[] },
): Promise<void> {
  const row = await client.query(
    "select 1 from subjects where id = $1 and organisation_id = $2",
    [subjectId, actor.organisationId],
  );
  if (!row.rows[0]) notFound();
  if (actor.permissions.has(PERMISSIONS.LMS_ASSIGNMENTS_MANAGE)) return;
  const scope = await loadTeacherAcademicScope(client, actor.userId, actor.organisationId!, {
    academicYearId: options?.academicYearId,
  });
  const allowed = allowedSubjectIdsForClasses(scope.classSubjectIds, options?.classIds);
  if (!allowed.has(subjectId)) {
    throw new AppError(
      403,
      "forbidden",
      "You can only assign work for subjects attached to classes you are assigned to teach",
    );
  }
}
