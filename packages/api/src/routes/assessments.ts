import { z } from "zod";
import type pg from "pg";
import { PERMISSIONS } from "@schoolapp/domain";
import {
  AppError,
  ASSESSMENT_MANAGE_PERMISSIONS,
  ASSESSMENT_READ_PERMISSIONS,
  REPORT_MANAGE_PERMISSIONS,
  REPORT_READ_PERMISSIONS,
  RESULT_ENTER_PERMISSIONS,
  RESULT_READ_PERMISSIONS,
  assertAnyPermission,
  assertCanEnterResultForPupil,
  assertCanManageAssessment,
  assertCanManageReport,
  assertCanReadAssessment,
  assertCanReadReport,
  assertCanReadStudentAcademic,
  assertCanTargetAssessmentClass,
  assignedClassIds,
  assignedStudentIds,
  canEnterResultsOnAssessment,
  canEnterSchoolResults,
  canManageSchoolAssessments,
  canManageSchoolReports,
  canPublishReports,
  canPublishResults,
  canReadSchoolAssessments,
  canReadSchoolReports,
  canReadSchoolResults,
  canReviewReports,
  canReviewResults,
  isScoreWithinMaximum,
  notifyReportPublished,
  notifyResultReleased,
  snapshotAssessmentInclusions,
  summariseAssessmentResults,
  summariseSubjectProgress,
  writeAudit,
  type ProgressPoint,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import {
  mapAcademicReport,
  mapAcademicReportSection,
  mapAcademicResult,
  mapAcademicTarget,
  mapAssessmentType,
  mapFormalAssessment,
  mapGradeScheme,
  mapReportingPeriod,
} from "../serialize";

const ASSESSMENT_SELECT = `
  select
    a.id,
    a.title,
    a.academic_year_id,
    ay.name as academic_year_name,
    a.reporting_period_id,
    rp.name as reporting_period_name,
    a.subject_id,
    sub.name as subject_name,
    a.year_group_id,
    yg.name as year_group_name,
    a.assessment_type_id,
    t.key as assessment_type_key,
    t.name as assessment_type_name,
    a.assessment_date::text,
    a.due_on::text,
    a.maximum_marks,
    a.weighting,
    a.grade_scheme_id,
    gs.name as grade_scheme_name,
    gs.scheme_kind as grade_scheme_kind,
    gs.is_numeric as grade_scheme_is_numeric,
    a.status,
    a.created_by,
    creator.full_name as created_by_name,
    a.created_at,
    a.published_at,
    a.source_learning_assignment_id,
    a.internal_notes
  from academic_assessments a
  join academic_years ay on ay.id = a.academic_year_id
  join subjects sub on sub.id = a.subject_id
  join year_groups yg on yg.id = a.year_group_id
  join academic_assessment_types t on t.id = a.assessment_type_id
  left join academic_reporting_periods rp on rp.id = a.reporting_period_id
  left join academic_grade_schemes gs on gs.id = a.grade_scheme_id
  left join users creator on creator.id = a.created_by
`;

const RESULT_SELECT = `
  select
    r.id,
    r.assessment_id,
    a.title as assessment_title,
    a.subject_id,
    sub.name as subject_name,
    a.assessment_date::text,
    a.published_at as assessment_published_at,
    r.student_profile_id,
    sp.legal_name as student_legal_name,
    r.raw_score,
    r.maximum_score,
    r.percentage,
    r.grade_scheme_level_id,
    l.label as grade_label,
    l.code as grade_code,
    l.numeric_value,
    r.teacher_judgement,
    r.comment,
    r.review_status,
    r.internal_review_note,
    r.released_to_student,
    r.released_to_parent,
    r.entered_by,
    entered.full_name as entered_by_name,
    r.entered_at,
    r.amended_by,
    r.amended_at,
    r.reviewed_by,
    r.reviewed_at
  from academic_results r
  join academic_assessments a on a.id = r.assessment_id
  join student_profiles sp on sp.id = r.student_profile_id
  left join subjects sub on sub.id = a.subject_id
  left join academic_grade_scheme_levels l on l.id = r.grade_scheme_level_id
  left join users entered on entered.id = r.entered_by
`;

const TARGET_SELECT = `
  select
    t.id,
    t.student_profile_id,
    t.academic_year_id,
    ay.name as academic_year_name,
    t.subject_id,
    sub.name as subject_name,
    t.grade_scheme_id,
    t.target_level_id,
    tl.label as target_label,
    t.target_value,
    t.baseline_level_id,
    bl.label as baseline_label,
    t.baseline_value,
    t.note
  from academic_targets t
  join academic_years ay on ay.id = t.academic_year_id
  join subjects sub on sub.id = t.subject_id
  left join academic_grade_scheme_levels tl on tl.id = t.target_level_id
  left join academic_grade_scheme_levels bl on bl.id = t.baseline_level_id
`;

const REPORT_SELECT = `
  select
    r.id,
    r.student_profile_id,
    sp.legal_name as student_legal_name,
    r.academic_year_id,
    ay.name as academic_year_name,
    r.reporting_period_id,
    p.name as reporting_period_name,
    r.status,
    r.general_comment,
    r.created_by,
    creator.full_name as created_by_name,
    r.created_at,
    r.submitted_at,
    r.reviewed_at,
    r.published_at,
    r.published_by
  from academic_reports r
  join student_profiles sp on sp.id = r.student_profile_id
  join academic_years ay on ay.id = r.academic_year_id
  join academic_reporting_periods p on p.id = r.reporting_period_id
  left join users creator on creator.id = r.created_by
`;

const assessmentBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  academicYearId: z.string().uuid().optional(),
  reportingPeriodId: z.string().uuid().nullable().optional(),
  subjectId: z.string().uuid(),
  yearGroupId: z.string().uuid(),
  assessmentTypeId: z.string().uuid().optional(),
  assessmentTypeKey: z.string().min(1).max(64).optional(),
  assessmentDate: z.string().min(8).max(32),
  dueOn: z.string().min(8).max(32).nullable().optional(),
  maximumMarks: z.number().positive().max(99999).nullable().optional(),
  weighting: z.number().min(0).max(100).nullable().optional(),
  gradeSchemeId: z.string().uuid().nullable().optional(),
  internalNotes: z.string().max(10000).nullable().optional(),
  classIds: z.array(z.string().uuid()).max(40).optional(),
  sourceLearningAssignmentId: z.string().uuid().nullable().optional(),
});

const resultRowSchema = z.object({
  studentProfileId: z.string().uuid(),
  rawScore: z.number().min(0).max(99999).nullable().optional(),
  maximumScore: z.number().positive().max(99999).nullable().optional(),
  gradeSchemeLevelId: z.string().uuid().nullable().optional(),
  teacherJudgement: z.string().max(200).nullable().optional(),
  comment: z.string().max(4000).nullable().optional(),
  releasedToStudent: z.boolean().optional(),
  releasedToParent: z.boolean().optional(),
  enteredBy: z.string().uuid().optional(),
  enteredAt: z.string().optional(),
  amendedBy: z.string().uuid().optional(),
  amendedAt: z.string().optional(),
});

function optionalUuidQuery(value: string | undefined): string | null {
  if (!value) return null;
  if (!z.string().uuid().safeParse(value).success) {
    throw new AppError(404, "not_found", "Not found");
  }
  return value;
}

async function loadAssessmentTypeId(
  client: pg.PoolClient,
  orgId: string,
  input: { assessmentTypeId?: string; assessmentTypeKey?: string },
): Promise<string> {
  if (input.assessmentTypeId) {
    const row = await client.query<{ id: string }>(
      "select id from academic_assessment_types where id = $1 and organisation_id = $2",
      [input.assessmentTypeId, orgId],
    );
    if (!row.rows[0]) throw new AppError(404, "not_found", "Not found");
    return row.rows[0].id;
  }
  if (input.assessmentTypeKey) {
    const row = await client.query<{ id: string }>(
      "select id from academic_assessment_types where organisation_id = $1 and key = $2",
      [orgId, input.assessmentTypeKey],
    );
    if (!row.rows[0]) throw new AppError(404, "not_found", "Not found");
    return row.rows[0].id;
  }
  throw new AppError(400, "validation_failed", "An assessment type is required");
}

async function loadAssessmentRow(client: pg.PoolClient, orgId: string, id: string) {
  const result = await client.query(`${ASSESSMENT_SELECT} where a.organisation_id = $1 and a.id = $2`, [
    orgId,
    id,
  ]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new AppError(404, "not_found", "Not found");
  return row;
}

async function loadAssessmentClasses(client: pg.PoolClient, assessmentId: string) {
  const result = await client.query<{ id: string; class_id: string; name: string }>(
    `select ac.id, ac.class_id, c.name
     from academic_assessment_classes ac
     join classes c on c.id = ac.class_id
     where ac.assessment_id = $1
     order by c.name`,
    [assessmentId],
  );
  return result.rows.map((row) => ({ id: row.id, classId: row.class_id, className: row.name }));
}

async function replaceAssessmentClasses(
  client: pg.PoolClient,
  orgId: string,
  assessmentId: string,
  classIds: string[],
) {
  await client.query("delete from academic_assessment_classes where assessment_id = $1", [assessmentId]);
  for (const classId of classIds) {
    await client.query(
      `insert into academic_assessment_classes (organisation_id, assessment_id, class_id)
       values ($1, $2, $3)`,
      [orgId, assessmentId, classId],
    );
  }
}

async function loadReportRow(client: pg.PoolClient, orgId: string, id: string) {
  const result = await client.query(`${REPORT_SELECT} where r.organisation_id = $1 and r.id = $2`, [
    orgId,
    id,
  ]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new AppError(404, "not_found", "Not found");
  return row;
}

async function loadReportSections(client: pg.PoolClient, reportId: string) {
  const result = await client.query(
    `select
       s.id,
       s.subject_id,
       sub.name as subject_name,
       s.teacher_user_id,
       u.full_name as teacher_name,
       s.attainment_summary,
       s.progress_judgement,
       s.teacher_comment,
       s.target_next_steps,
       s.sort_order
     from academic_report_sections s
     join subjects sub on sub.id = s.subject_id
     left join users u on u.id = s.teacher_user_id
     where s.report_id = $1
     order by s.sort_order, sub.name`,
    [reportId],
  );
  return result.rows.map((row) => mapAcademicReportSection(row as Record<string, unknown>));
}

async function freezeReportPublication(
  client: pg.PoolClient,
  orgId: string,
  reportId: string,
  actorUserId: string,
) {
  const report = await loadReportRow(client, orgId, reportId);
  const sections = await loadReportSections(client, reportId);
  await client.query(
    `insert into academic_report_publications (organisation_id, report_id, payload, published_by)
     values ($1, $2, $3::jsonb, $4)`,
    [
      orgId,
      reportId,
      JSON.stringify({
        generalComment: report.general_comment ?? null,
        studentLegalName: report.student_legal_name ?? null,
        academicYearName: report.academic_year_name ?? null,
        reportingPeriodName: report.reporting_period_name ?? null,
        sections,
      }),
      actorUserId,
    ],
  );
}

export function registerAssessmentRoutes(app: SchoolappApi) {
  app.get("/assessments/types", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, ASSESSMENT_READ_PERMISSIONS);
      const rows = await client.query(
        `select id, key, name, sort_order, is_system
         from academic_assessment_types
         where organisation_id = $1
         order by sort_order, name`,
        [orgId],
      );
      return c.json({ types: rows.rows.map((row) => mapAssessmentType(row as Record<string, unknown>)) });
    }),
  );

  app.get("/assessments/grade-schemes", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [...ASSESSMENT_READ_PERMISSIONS, ...RESULT_READ_PERMISSIONS]);
      const schemes = await client.query(
        `select id, key, name, scheme_kind, subject_id, year_group_id, is_numeric, is_system
         from academic_grade_schemes
         where organisation_id = $1
         order by name`,
        [orgId],
      );
      const levels = await client.query(
        `select id, scheme_id, code, label, sort_order, numeric_value, min_percentage, max_percentage
         from academic_grade_scheme_levels
         where organisation_id = $1
         order by sort_order`,
        [orgId],
      );
      return c.json({
        schemes: schemes.rows.map((scheme) =>
          mapGradeScheme(
            scheme as Record<string, unknown>,
            levels.rows.filter((level) => level.scheme_id === scheme.id) as Array<Record<string, unknown>>,
          ),
        ),
      });
    }),
  );

  app.post("/assessments/grade-schemes", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageSchoolAssessments(actor) && !actor.permissions.has(PERMISSIONS.ACADEMIC_OVERSIGHT)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const body = z
        .object({
          key: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
          name: z.string().trim().min(1).max(120),
          schemeKind: z.enum([
            "percentage",
            "letter",
            "numeric",
            "teacher_judgement",
            "age_related",
            "school_defined",
          ]),
          subjectId: z.string().uuid().nullable().optional(),
          yearGroupId: z.string().uuid().nullable().optional(),
          isNumeric: z.boolean().optional(),
          levels: z
            .array(
              z.object({
                code: z.string().trim().min(1).max(32),
                label: z.string().trim().min(1).max(80),
                sortOrder: z.number().int(),
                numericValue: z.number().nullable().optional(),
              }),
            )
            .max(40)
            .optional(),
        })
        .parse(await c.req.json());
      const inserted = await client.query<{ id: string }>(
        `insert into academic_grade_schemes (
           organisation_id, key, name, scheme_kind, subject_id, year_group_id, is_numeric
         ) values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          orgId,
          body.key,
          body.name,
          body.schemeKind,
          body.subjectId ?? null,
          body.yearGroupId ?? null,
          body.isNumeric ?? (body.schemeKind === "percentage" || body.schemeKind === "numeric"),
        ],
      );
      const schemeId = inserted.rows[0]!.id;
      for (const level of body.levels ?? []) {
        await client.query(
          `insert into academic_grade_scheme_levels (
             organisation_id, scheme_id, code, label, sort_order, numeric_value
           ) values ($1, $2, $3, $4, $5, $6)`,
          [orgId, schemeId, level.code, level.label, level.sortOrder, level.numericValue ?? null],
        );
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "assessment.grade_scheme.create",
        entityType: "academic_grade_scheme",
        entityId: schemeId,
        after: { key: body.key, name: body.name },
      });
      return c.json({ scheme: { id: schemeId } }, 201);
    }),
  );

  app.get("/assessments/reporting-periods", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [...ASSESSMENT_READ_PERMISSIONS, ...REPORT_READ_PERMISSIONS]);
      const yearId = optionalUuidQuery(c.req.query("academicYearId"));
      const rows = await client.query(
        `select
           p.id, p.academic_year_id, ay.name as academic_year_name, p.term_id, t.name as term_name,
           p.name, p.starts_on::text, p.ends_on::text, p.status,
           p.publish_starts_on::text, p.publish_ends_on::text
         from academic_reporting_periods p
         join academic_years ay on ay.id = p.academic_year_id
         left join terms t on t.id = p.term_id
         where p.organisation_id = $1
           and ($2::uuid is null or p.academic_year_id = $2)
         order by p.starts_on, p.name`,
        [orgId, yearId],
      );
      return c.json({
        reportingPeriods: rows.rows.map((row) => mapReportingPeriod(row as Record<string, unknown>)),
      });
    }),
  );

  app.post("/assessments/reporting-periods", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageSchoolAssessments(actor) && !canManageSchoolReports(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const body = z
        .object({
          academicYearId: z.string().uuid(),
          termId: z.string().uuid().nullable().optional(),
          name: z.string().trim().min(1).max(120),
          startsOn: z.string().min(8).max(32),
          endsOn: z.string().min(8).max(32),
          status: z.enum(["planned", "open", "closed", "published"]).optional(),
          publishStartsOn: z.string().min(8).max(32).nullable().optional(),
          publishEndsOn: z.string().min(8).max(32).nullable().optional(),
        })
        .parse(await c.req.json());
      const inserted = await client.query(
        `insert into academic_reporting_periods (
           organisation_id, academic_year_id, term_id, name, starts_on, ends_on, status,
           publish_starts_on, publish_ends_on
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning *`,
        [
          orgId,
          body.academicYearId,
          body.termId ?? null,
          body.name,
          body.startsOn,
          body.endsOn,
          body.status ?? "planned",
          body.publishStartsOn ?? null,
          body.publishEndsOn ?? null,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "assessment.reporting_period.create",
        entityType: "academic_reporting_period",
        entityId: String(inserted.rows[0]!.id),
        after: { name: body.name },
      });
      return c.json({ reportingPeriod: mapReportingPeriod(inserted.rows[0] as Record<string, unknown>) }, 201);
    }),
  );

  app.patch("/assessments/reporting-periods/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageSchoolAssessments(actor) && !canManageSchoolReports(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const id = uuidRouteParam(c, "id");
      const existing = await client.query("select * from academic_reporting_periods where id = $1 and organisation_id = $2", [
        id,
        orgId,
      ]);
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const body = z
        .object({
          name: z.string().trim().min(1).max(120).optional(),
          startsOn: z.string().min(8).max(32).optional(),
          endsOn: z.string().min(8).max(32).optional(),
          status: z.enum(["planned", "open", "closed", "published"]).optional(),
          publishStartsOn: z.string().min(8).max(32).nullable().optional(),
          publishEndsOn: z.string().min(8).max(32).nullable().optional(),
        })
        .parse(await c.req.json());
      const updated = await client.query(
        `update academic_reporting_periods
         set name = coalesce($3, name),
             starts_on = coalesce($4::date, starts_on),
             ends_on = coalesce($5::date, ends_on),
             status = coalesce($6, status),
             publish_starts_on = case when $7::text = '__omit' then publish_starts_on else $7::date end,
             publish_ends_on = case when $8::text = '__omit' then publish_ends_on else $8::date end
         where id = $1 and organisation_id = $2
         returning *`,
        [
          id,
          orgId,
          body.name ?? null,
          body.startsOn ?? null,
          body.endsOn ?? null,
          body.status ?? null,
          body.publishStartsOn === undefined ? "__omit" : body.publishStartsOn,
          body.publishEndsOn === undefined ? "__omit" : body.publishEndsOn,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "assessment.reporting_period.update",
        entityType: "academic_reporting_period",
        entityId: id,
        before: existing.rows[0],
        after: updated.rows[0],
      });
      return c.json({ reportingPeriod: mapReportingPeriod(updated.rows[0] as Record<string, unknown>) });
    }),
  );

  app.get("/assessments/context", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [...ASSESSMENT_READ_PERMISSIONS, ...RESULT_READ_PERMISSIONS, ...REPORT_READ_PERMISSIONS]);
      const [types, schemes, years, subjects, groups, classes, periods] = await Promise.all([
        client.query("select id, key, name, sort_order, is_system from academic_assessment_types where organisation_id = $1 order by sort_order", [orgId]),
        client.query("select id, key, name, scheme_kind, is_numeric from academic_grade_schemes where organisation_id = $1 order by name", [orgId]),
        client.query("select id, name, is_current from academic_years where organisation_id = $1 order by starts_on desc", [orgId]),
        client.query("select id, name from subjects where organisation_id = $1 order by name", [orgId]),
        client.query("select id, name, code from year_groups where organisation_id = $1 order by sort_order", [orgId]),
        client.query(
          `select c.id, c.name, c.year_group_id, c.academic_year_id
           from classes c
           where c.organisation_id = $1
           order by c.name`,
          [orgId],
        ),
        client.query(
          `select id, academic_year_id, name, status from academic_reporting_periods where organisation_id = $1 order by starts_on`,
          [orgId],
        ),
      ]);
      let visibleClasses = classes.rows;
      if (!canReadSchoolAssessments(actor) && !canReadSchoolResults(actor) && !canReadSchoolReports(actor)) {
        const assigned = await assignedClassIds(client, actor.userId, orgId);
        visibleClasses = classes.rows.filter((row) => assigned.has(String(row.id)));
      }
      return c.json({
        types: types.rows.map((row) => mapAssessmentType(row as Record<string, unknown>)),
        gradeSchemes: schemes.rows,
        academicYears: years.rows,
        subjects: subjects.rows,
        yearGroups: groups.rows,
        classes: visibleClasses,
        reportingPeriods: periods.rows,
      });
    }),
  );

  app.get("/assessments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, ASSESSMENT_READ_PERMISSIONS);
      const status = c.req.query("status");
      const classId = optionalUuidQuery(c.req.query("classId"));
      const subjectId = optionalUuidQuery(c.req.query("subjectId"));
      const yearGroupId = optionalUuidQuery(c.req.query("yearGroupId"));
      const assignedClasses = canReadSchoolAssessments(actor)
        ? null
        : [...(await assignedClassIds(client, actor.userId, orgId))];
      const assignedStudents = canReadSchoolAssessments(actor)
        ? null
        : [...(await assignedStudentIds(client, actor.userId, orgId))];
      const rows = await client.query(
        `${ASSESSMENT_SELECT}
         where a.organisation_id = $1
           and ($2::text is null or a.status = $2)
           and ($3::uuid is null or a.subject_id = $3)
           and ($4::uuid is null or a.year_group_id = $4)
           and ($5::uuid is null or exists (
             select 1 from academic_assessment_classes ac
             where ac.assessment_id = a.id and ac.class_id = $5
           ))
           and (
             $6::uuid[] is null
             or a.created_by = $8
             or exists (
               select 1 from academic_assessment_classes ac
               where ac.assessment_id = a.id and ac.class_id = any ($6::uuid[])
             )
             or exists (
               select 1 from academic_assessment_inclusions i
               where i.assessment_id = a.id
                 and (i.student_profile_id = any ($7::uuid[]) or i.class_id = any ($6::uuid[]))
             )
           )
         order by a.assessment_date desc, a.title`,
        [
          orgId,
          status || null,
          subjectId,
          yearGroupId,
          classId,
          assignedClasses,
          assignedStudents,
          actor.userId,
        ],
      );
      return c.json({
        assessments: rows.rows.map((row) =>
          mapFormalAssessment(row as Record<string, unknown>, { includeInternalNotes: true }),
        ),
      });
    }),
  );

  app.post("/assessments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, ASSESSMENT_MANAGE_PERMISSIONS);
      const body = assessmentBodySchema.parse(await c.req.json());
      const typeId = await loadAssessmentTypeId(client, orgId, body);
      const classIds = body.classIds ?? [];
      if (classIds.length === 0 && !canManageSchoolAssessments(actor)) {
        throw new AppError(403, "forbidden", "Year-group assessments require school-wide assessment management");
      }
      for (const classId of classIds) {
        await assertCanTargetAssessmentClass(client, actor, orgId, classId);
      }
      const year = body.academicYearId
        ? body.academicYearId
        : (
            await client.query<{ id: string }>(
              "select id from academic_years where organisation_id = $1 and is_current limit 1",
              [orgId],
            )
          ).rows[0]?.id;
      if (!year) throw new AppError(400, "validation_failed", "An academic year is required");
      const inserted = await client.query<{ id: string }>(
        `insert into academic_assessments (
           organisation_id, academic_year_id, reporting_period_id, title, subject_id, year_group_id,
           assessment_type_id, assessment_date, due_on, maximum_marks, weighting, grade_scheme_id,
           internal_notes, source_learning_assignment_id, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         returning id`,
        [
          orgId,
          year,
          body.reportingPeriodId ?? null,
          body.title,
          body.subjectId,
          body.yearGroupId,
          typeId,
          body.assessmentDate,
          body.dueOn ?? null,
          body.maximumMarks ?? null,
          body.weighting ?? null,
          body.gradeSchemeId ?? null,
          body.internalNotes ?? null,
          body.sourceLearningAssignmentId ?? null,
          userId,
        ],
      );
      const id = inserted.rows[0]!.id;
      await replaceAssessmentClasses(client, orgId, id, classIds);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "assessment.create",
        entityType: "academic_assessment",
        entityId: id,
        after: { title: body.title, status: "draft" },
      });
      const row = await loadAssessmentRow(client, orgId, id);
      return c.json(
        {
          assessment: {
            ...mapFormalAssessment(row, { includeInternalNotes: true }),
            classes: await loadAssessmentClasses(client, id),
          },
        },
        201,
      );
    }),
  );

  app.get("/assessments/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, ASSESSMENT_READ_PERMISSIONS);
      const id = uuidRouteParam(c, "id");
      const row = await loadAssessmentRow(client, orgId, id);
      await assertCanReadAssessment(client, actor, orgId, id);
      return c.json({
        assessment: {
          ...mapFormalAssessment(row, { includeInternalNotes: true }),
          classes: await loadAssessmentClasses(client, id),
        },
      });
    }),
  );

  app.patch("/assessments/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, ASSESSMENT_MANAGE_PERMISSIONS);
      const id = uuidRouteParam(c, "id");
      const existing = await loadAssessmentRow(client, orgId, id);
      await assertCanManageAssessment(client, actor, orgId, {
        id,
        created_by: String(existing.created_by),
      });
      if (existing.status !== "draft" && existing.status !== "open") {
        throw new AppError(409, "invalid_status_transition", "Only draft or open assessments can be edited");
      }
      const body = assessmentBodySchema.partial().parse(await c.req.json());
      const typeId = body.assessmentTypeId || body.assessmentTypeKey
        ? await loadAssessmentTypeId(client, orgId, body)
        : null;
      if (body.classIds) {
        for (const classId of body.classIds) {
          await assertCanTargetAssessmentClass(client, actor, orgId, classId);
        }
        await replaceAssessmentClasses(client, orgId, id, body.classIds);
      }
      await client.query(
        `update academic_assessments
         set title = coalesce($3, title),
             reporting_period_id = case when $4::text = '__omit' then reporting_period_id else $4::uuid end,
             subject_id = coalesce($5::uuid, subject_id),
             year_group_id = coalesce($6::uuid, year_group_id),
             assessment_type_id = coalesce($7::uuid, assessment_type_id),
             assessment_date = coalesce($8::date, assessment_date),
             due_on = case when $9::text = '__omit' then due_on else $9::date end,
             maximum_marks = case when $10::text = '__omit' then maximum_marks else $10::numeric end,
             weighting = case when $11::text = '__omit' then weighting else $11::numeric end,
             grade_scheme_id = case when $12::text = '__omit' then grade_scheme_id else $12::uuid end,
             internal_notes = case when $13::text = '__omit' then internal_notes else $13 end
         where id = $1 and organisation_id = $2`,
        [
          id,
          orgId,
          body.title ?? null,
          body.reportingPeriodId === undefined ? "__omit" : body.reportingPeriodId,
          body.subjectId ?? null,
          body.yearGroupId ?? null,
          typeId,
          body.assessmentDate ?? null,
          body.dueOn === undefined ? "__omit" : body.dueOn,
          body.maximumMarks === undefined ? "__omit" : String(body.maximumMarks),
          body.weighting === undefined ? "__omit" : String(body.weighting),
          body.gradeSchemeId === undefined ? "__omit" : body.gradeSchemeId,
          body.internalNotes === undefined ? "__omit" : body.internalNotes,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "assessment.update",
        entityType: "academic_assessment",
        entityId: id,
        before: { title: existing.title },
        after: { title: body.title ?? existing.title },
      });
      const row = await loadAssessmentRow(client, orgId, id);
      return c.json({
        assessment: {
          ...mapFormalAssessment(row, { includeInternalNotes: true }),
          classes: await loadAssessmentClasses(client, id),
        },
      });
    }),
  );

  async function transitionAssessment(
    client: pg.PoolClient,
    actor: Parameters<typeof assertCanManageAssessment>[1],
    orgId: string,
    userId: string,
    id: string,
    to: string,
    action: string,
  ) {
    const existing = await loadAssessmentRow(client, orgId, id);
    await assertCanManageAssessment(client, actor, orgId, {
      id,
      created_by: String(existing.created_by),
    });
    if (to === "reviewed" && !canReviewResults(actor) && !canManageSchoolAssessments(actor)) {
      throw new AppError(403, "forbidden", "Missing permission");
    }
    if (to === "published" && !canPublishResults(actor) && !canManageSchoolAssessments(actor)) {
      throw new AppError(403, "forbidden", "Missing permission");
    }
    await client.query("update academic_assessments set status = $2 where id = $1 and organisation_id = $3", [
      id,
      to,
      orgId,
    ]);
    if (to === "open") {
      await snapshotAssessmentInclusions(client, id);
    }
    if (to === "published") {
      const released = await client.query(
        `select r.id, r.student_profile_id, r.released_to_student, r.released_to_parent, sp.user_id
         from academic_results r
         join student_profiles sp on sp.id = r.student_profile_id
         where r.assessment_id = $1
           and (r.released_to_student or r.released_to_parent)`,
        [id],
      );
      for (const row of released.rows) {
        await notifyResultReleased(client, {
          organisationId: orgId,
          actorUserId: userId,
          studentProfileId: row.student_profile_id,
          studentUserId: row.user_id,
          title: String(existing.title),
          releasedToStudent: row.released_to_student,
          releasedToParent: row.released_to_parent,
          resultId: row.id,
        });
      }
    }
    await writeAudit(client, {
      organisationId: orgId,
      actorUserId: userId,
      action,
      entityType: "academic_assessment",
      entityId: id,
      before: { status: existing.status },
      after: { status: to },
    });
    return loadAssessmentRow(client, orgId, id);
  }

  app.post("/assessments/:id/open", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await transitionAssessment(client, actor, orgId, userId, id, "open", "assessment.opened");
      return c.json({ assessment: mapFormalAssessment(row, { includeInternalNotes: true }) });
    }),
  );
  app.post("/assessments/:id/complete", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await transitionAssessment(client, actor, orgId, userId, id, "completed", "assessment.completed");
      return c.json({ assessment: mapFormalAssessment(row, { includeInternalNotes: true }) });
    }),
  );
  app.post("/assessments/:id/review", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await transitionAssessment(client, actor, orgId, userId, id, "reviewed", "assessment.reviewed");
      return c.json({ assessment: mapFormalAssessment(row, { includeInternalNotes: true }) });
    }),
  );
  app.post("/assessments/:id/publish", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await transitionAssessment(client, actor, orgId, userId, id, "published", "assessment.published");
      return c.json({ assessment: mapFormalAssessment(row, { includeInternalNotes: true }) });
    }),
  );
  app.post("/assessments/:id/archive", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await transitionAssessment(client, actor, orgId, userId, id, "archived", "assessment.archived");
      return c.json({ assessment: mapFormalAssessment(row, { includeInternalNotes: true }) });
    }),
  );

  app.get("/assessments/:id/results", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, RESULT_READ_PERMISSIONS);
      const id = uuidRouteParam(c, "id");
      await assertCanReadAssessment(client, actor, orgId, id);
      const assignedStudents = canReadSchoolResults(actor)
        ? null
        : [...(await assignedStudentIds(client, actor.userId, orgId))];
      const inclusions = await client.query(
        `select i.student_profile_id, sp.legal_name, i.class_id, c.name as class_name
         from academic_assessment_inclusions i
         join student_profiles sp on sp.id = i.student_profile_id
         left join classes c on c.id = i.class_id
         where i.assessment_id = $1
           and ($2::uuid[] is null or i.student_profile_id = any ($2::uuid[]))
         order by sp.legal_name`,
        [id, assignedStudents],
      );
      const results = await client.query(
        `${RESULT_SELECT}
         where r.organisation_id = $1 and r.assessment_id = $2
           and ($3::uuid[] is null or r.student_profile_id = any ($3::uuid[]))
         order by sp.legal_name`,
        [orgId, id, assignedStudents],
      );
      const byStudent = new Map(results.rows.map((row) => [String(row.student_profile_id), row]));
      return c.json({
        pupils: inclusions.rows.map((row) => ({
          studentProfileId: row.student_profile_id,
          legalName: row.legal_name,
          classId: row.class_id,
          className: row.class_name,
          result: mapAcademicResult(byStudent.get(String(row.student_profile_id)) as Record<string, unknown> | undefined, {
            audience: "staff",
          }),
        })),
      });
    }),
  );

  app.put("/assessments/:id/results", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, RESULT_ENTER_PERMISSIONS);
      const id = uuidRouteParam(c, "id");
      const assessment = await loadAssessmentRow(client, orgId, id);
      await assertCanReadAssessment(client, actor, orgId, id);
      if (!canEnterResultsOnAssessment(String(assessment.status))) {
        throw new AppError(409, "invalid_status_transition", "Results can only be entered while the assessment is open, completed, or reviewed");
      }
      const body = z.object({ results: z.array(resultRowSchema).max(200) }).parse(await c.req.json());
      const published = Boolean(assessment.published_at);
      const assessmentMax =
        assessment.maximum_marks != null ? Number(assessment.maximum_marks) : null;
      for (const row of body.results) {
        await assertCanEnterResultForPupil(client, actor, orgId, row.studentProfileId);
        if (!isScoreWithinMaximum(row.rawScore ?? null, assessmentMax)) {
          throw new AppError(400, "validation_failed", "Score must be between 0 and the maximum marks");
        }
        const existing = await client.query<{
          id: string;
          released_to_student: boolean;
          released_to_parent: boolean;
        }>(
          "select id, released_to_student, released_to_parent from academic_results where assessment_id = $1 and student_profile_id = $2",
          [id, row.studentProfileId],
        );
        let resultId: string;
        if (existing.rows[0]) {
          const updated = await client.query<{ id: string }>(
            `update academic_results
             set raw_score = $3,
                 maximum_score = $4,
                 grade_scheme_level_id = $5,
                 teacher_judgement = $6,
                 comment = $7,
                 released_to_student = coalesce($8, released_to_student),
                 released_to_parent = coalesce($9, released_to_parent)
             where id = $1 and organisation_id = $2
             returning id`,
            [
              existing.rows[0].id,
              orgId,
              row.rawScore ?? null,
              assessmentMax,
              row.gradeSchemeLevelId ?? null,
              row.teacherJudgement ?? null,
              row.comment ?? null,
              row.releasedToStudent ?? null,
              row.releasedToParent ?? null,
            ],
          );
          resultId = updated.rows[0]!.id;
          await writeAudit(client, {
            organisationId: orgId,
            actorUserId: userId,
            action: "assessment.result.amended",
            entityType: "academic_result",
            entityId: resultId,
            after: { studentProfileId: row.studentProfileId, rawScore: row.rawScore ?? null },
          });
        } else {
          const inserted = await client.query<{ id: string }>(
            `insert into academic_results (
               organisation_id, assessment_id, student_profile_id, raw_score, maximum_score,
               grade_scheme_level_id, teacher_judgement, comment, released_to_student,
               released_to_parent, entered_by
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             returning id`,
            [
              orgId,
              id,
              row.studentProfileId,
              row.rawScore ?? null,
              assessmentMax,
              row.gradeSchemeLevelId ?? null,
              row.teacherJudgement ?? null,
              row.comment ?? null,
              row.releasedToStudent ?? false,
              row.releasedToParent ?? false,
              userId,
            ],
          );
          resultId = inserted.rows[0]!.id;
          await writeAudit(client, {
            organisationId: orgId,
            actorUserId: userId,
            action: "assessment.result.entered",
            entityType: "academic_result",
            entityId: resultId,
            after: { studentProfileId: row.studentProfileId, rawScore: row.rawScore ?? null },
          });
        }
        const nowReleasedStudent = row.releasedToStudent ?? existing.rows[0]?.released_to_student ?? false;
        const nowReleasedParent = row.releasedToParent ?? existing.rows[0]?.released_to_parent ?? false;
        const newlyReleased =
          published &&
          ((nowReleasedStudent && !existing.rows[0]?.released_to_student) ||
            (nowReleasedParent && !existing.rows[0]?.released_to_parent));
        if (newlyReleased) {
          const pupil = await client.query<{ user_id: string | null }>(
            "select user_id from student_profiles where id = $1",
            [row.studentProfileId],
          );
          await notifyResultReleased(client, {
            organisationId: orgId,
            actorUserId: userId,
            studentProfileId: row.studentProfileId,
            studentUserId: pupil.rows[0]?.user_id ?? null,
            title: String(assessment.title),
            releasedToStudent: nowReleasedStudent,
            releasedToParent: nowReleasedParent,
            resultId,
          });
        }
      }
      return c.json({ ok: true, count: body.results.length });
    }),
  );

  app.post("/assessments/:id/results/:studentId/review", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canReviewResults(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const id = uuidRouteParam(c, "id");
      const studentId = uuidRouteParam(c, "studentId");
      await assertCanReadAssessment(client, actor, orgId, id);
      const body = z
        .object({
          reviewStatus: z.enum(["reviewed", "approved"]),
          internalReviewNote: z.string().max(4000).nullable().optional(),
        })
        .parse(await c.req.json());
      const updated = await client.query<{ id: string }>(
        `update academic_results
         set review_status = $4, internal_review_note = coalesce($5, internal_review_note)
         where assessment_id = $1 and student_profile_id = $2 and organisation_id = $3
         returning id`,
        [id, studentId, orgId, body.reviewStatus, body.internalReviewNote ?? null],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "assessment.result.reviewed",
        entityType: "academic_result",
        entityId: updated.rows[0].id,
        after: { reviewStatus: body.reviewStatus },
      });
      return c.json({ ok: true });
    }),
  );

  app.get("/assessments/:id/summary", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, RESULT_READ_PERMISSIONS);
      const id = uuidRouteParam(c, "id");
      await assertCanReadAssessment(client, actor, orgId, id);
      const assessment = await loadAssessmentRow(client, orgId, id);
      const included = await client.query<{ n: string }>(
        "select count(*)::text as n from academic_assessment_inclusions where assessment_id = $1",
        [id],
      );
      const results = await client.query(
        `${RESULT_SELECT} where r.organisation_id = $1 and r.assessment_id = $2`,
        [orgId, id],
      );
      return c.json({
        summary: summariseAssessmentResults({
          isNumeric: Boolean(assessment.grade_scheme_is_numeric) || assessment.maximum_marks != null,
          percentages: results.rows.map((row) => (row.percentage != null ? Number(row.percentage) : null)),
          gradeLabels: results.rows.map((row) => (row.grade_label as string | null) ?? null),
          reviewStatuses: results.rows.map((row) => String(row.review_status)),
          includedCount: Number(included.rows[0]?.n ?? 0),
        }),
      });
    }),
  );

  app.get("/students/:studentId/academic", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [...ASSESSMENT_READ_PERMISSIONS, ...RESULT_READ_PERMISSIONS, ...REPORT_READ_PERMISSIONS]);
      const studentId = uuidRouteParam(c, "studentId");
      await assertCanReadStudentAcademic(client, actor, orgId, studentId);
      const results = await client.query(
        `${RESULT_SELECT}
         where r.organisation_id = $1 and r.student_profile_id = $2
         order by a.assessment_date desc, a.title`,
        [orgId, studentId],
      );
      const targets = await client.query(`${TARGET_SELECT} where t.organisation_id = $1 and t.student_profile_id = $2 order by sub.name`, [
        orgId,
        studentId,
      ]);
      const reports = await client.query(`${REPORT_SELECT} where r.organisation_id = $1 and r.student_profile_id = $2 order by r.created_at desc`, [
        orgId,
        studentId,
      ]);
      const pointsBySubject = new Map<string, ProgressPoint[]>();
      for (const row of results.rows) {
        const subjectId = String(row.subject_id);
        const list = pointsBySubject.get(subjectId) ?? [];
        list.push({
          assessmentId: String(row.assessment_id),
          assessmentDate: String(row.assessment_date),
          subjectId,
          percentage: row.percentage != null ? Number(row.percentage) : null,
          numericValue: row.numeric_value != null ? Number(row.numeric_value) : null,
          gradeLabel: (row.grade_label as string | null) ?? null,
          teacherJudgement: (row.teacher_judgement as string | null) ?? null,
        });
        pointsBySubject.set(subjectId, list);
      }
      return c.json({
        results: results.rows.map((row) => mapAcademicResult(row as Record<string, unknown>, { audience: "staff" })),
        targets: targets.rows.map((row) => mapAcademicTarget(row as Record<string, unknown>)),
        reports: reports.rows.map((row) => mapAcademicReport(row as Record<string, unknown>, { includeWorkflow: true })),
        progress: [...pointsBySubject.entries()].map(([subjectId, points]) => ({
          subjectId,
          subjectName: results.rows.find((row) => String(row.subject_id) === subjectId)?.subject_name ?? null,
          ...summariseSubjectProgress(points),
        })),
      });
    }),
  );

  app.get("/students/:studentId/targets", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const studentId = uuidRouteParam(c, "studentId");
      await assertCanReadStudentAcademic(client, actor, orgId, studentId);
      const targets = await client.query(`${TARGET_SELECT} where t.organisation_id = $1 and t.student_profile_id = $2 order by sub.name`, [
        orgId,
        studentId,
      ]);
      return c.json({ targets: targets.rows.map((row) => mapAcademicTarget(row as Record<string, unknown>)) });
    }),
  );

  app.post("/students/:studentId/targets", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageSchoolAssessments(actor) && !canEnterSchoolResults(actor) && !actor.permissions.has(PERMISSIONS.RESULTS_ENTER_ASSIGNED)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const studentId = uuidRouteParam(c, "studentId");
      await assertCanReadStudentAcademic(client, actor, orgId, studentId);
      const body = z
        .object({
          academicYearId: z.string().uuid(),
          subjectId: z.string().uuid(),
          gradeSchemeId: z.string().uuid().nullable().optional(),
          targetLevelId: z.string().uuid().nullable().optional(),
          targetValue: z.string().max(80).nullable().optional(),
          baselineLevelId: z.string().uuid().nullable().optional(),
          baselineValue: z.string().max(80).nullable().optional(),
          note: z.string().max(2000).nullable().optional(),
        })
        .parse(await c.req.json());
      if (!canEnterSchoolResults(actor) && !canManageSchoolAssessments(actor)) {
        await assertCanEnterResultForPupil(client, actor, orgId, studentId);
      }
      const inserted = await client.query<{ id: string }>(
        `insert into academic_targets (
           organisation_id, student_profile_id, academic_year_id, subject_id, grade_scheme_id,
           target_level_id, target_value, baseline_level_id, baseline_value, note, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         returning id`,
        [
          orgId,
          studentId,
          body.academicYearId,
          body.subjectId,
          body.gradeSchemeId ?? null,
          body.targetLevelId ?? null,
          body.targetValue ?? null,
          body.baselineLevelId ?? null,
          body.baselineValue ?? null,
          body.note ?? null,
          userId,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "assessment.target.changed",
        entityType: "academic_target",
        entityId: inserted.rows[0]!.id,
        after: { studentProfileId: studentId, subjectId: body.subjectId },
      });
      const row = await client.query(`${TARGET_SELECT} where t.id = $1`, [inserted.rows[0]!.id]);
      return c.json({ target: mapAcademicTarget(row.rows[0] as Record<string, unknown>) }, 201);
    }),
  );

  app.patch("/academic-targets/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const existing = await client.query<{ student_profile_id: string }>(
        "select student_profile_id from academic_targets where id = $1 and organisation_id = $2",
        [id, orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      await assertCanReadStudentAcademic(client, actor, orgId, existing.rows[0].student_profile_id);
      if (!canManageSchoolAssessments(actor) && !canEnterSchoolResults(actor)) {
        await assertCanEnterResultForPupil(client, actor, orgId, existing.rows[0].student_profile_id);
      }
      const body = z
        .object({
          targetLevelId: z.string().uuid().nullable().optional(),
          targetValue: z.string().max(80).nullable().optional(),
          baselineLevelId: z.string().uuid().nullable().optional(),
          baselineValue: z.string().max(80).nullable().optional(),
          note: z.string().max(2000).nullable().optional(),
        })
        .parse(await c.req.json());
      await client.query(
        `update academic_targets
         set target_level_id = case when $3::text = '__omit' then target_level_id else $3::uuid end,
             target_value = case when $4::text = '__omit' then target_value else $4 end,
             baseline_level_id = case when $5::text = '__omit' then baseline_level_id else $5::uuid end,
             baseline_value = case when $6::text = '__omit' then baseline_value else $6 end,
             note = case when $7::text = '__omit' then note else $7 end
         where id = $1 and organisation_id = $2`,
        [
          id,
          orgId,
          body.targetLevelId === undefined ? "__omit" : body.targetLevelId,
          body.targetValue === undefined ? "__omit" : body.targetValue,
          body.baselineLevelId === undefined ? "__omit" : body.baselineLevelId,
          body.baselineValue === undefined ? "__omit" : body.baselineValue,
          body.note === undefined ? "__omit" : body.note,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "assessment.target.changed",
        entityType: "academic_target",
        entityId: id,
        after: body,
      });
      const row = await client.query(`${TARGET_SELECT} where t.id = $1`, [id]);
      return c.json({ target: mapAcademicTarget(row.rows[0] as Record<string, unknown>) });
    }),
  );

  app.get("/reports", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, REPORT_READ_PERMISSIONS);
      const status = c.req.query("status");
      const periodId = optionalUuidQuery(c.req.query("reportingPeriodId"));
      const assignedStudents = canReadSchoolReports(actor)
        ? null
        : [...(await assignedStudentIds(client, actor.userId, orgId))];
      const rows = await client.query(
        `${REPORT_SELECT}
         where r.organisation_id = $1
           and ($2::text is null or r.status = $2)
           and ($3::uuid is null or r.reporting_period_id = $3)
           and ($4::uuid[] is null or r.student_profile_id = any ($4::uuid[]) or r.created_by = $5)
         order by r.updated_at desc`,
        [orgId, status || null, periodId, assignedStudents, actor.userId],
      );
      return c.json({
        reports: rows.rows.map((row) => mapAcademicReport(row as Record<string, unknown>, { includeWorkflow: true })),
      });
    }),
  );

  app.post("/reports", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, REPORT_MANAGE_PERMISSIONS);
      const body = z
        .object({
          studentProfileId: z.string().uuid(),
          academicYearId: z.string().uuid(),
          reportingPeriodId: z.string().uuid(),
          generalComment: z.string().max(8000).nullable().optional(),
        })
        .parse(await c.req.json());
      if (!canManageSchoolReports(actor)) {
        await assertCanManageReport(client, actor, orgId, {
          created_by: userId,
          student_profile_id: body.studentProfileId,
        });
      }
      const inserted = await client.query<{ id: string }>(
        `insert into academic_reports (
           organisation_id, student_profile_id, academic_year_id, reporting_period_id,
           general_comment, created_by
         ) values ($1,$2,$3,$4,$5,$6)
         returning id`,
        [orgId, body.studentProfileId, body.academicYearId, body.reportingPeriodId, body.generalComment ?? null, userId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "assessment.report.create",
        entityType: "academic_report",
        entityId: inserted.rows[0]!.id,
        after: { studentProfileId: body.studentProfileId },
      });
      const row = await loadReportRow(client, orgId, inserted.rows[0]!.id);
      return c.json({ report: mapAcademicReport(row, { includeWorkflow: true }), sections: [] }, 201);
    }),
  );

  app.get("/reports/:id{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}}", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, REPORT_READ_PERMISSIONS);
      const id = uuidRouteParam(c, "id");
      const row = await loadReportRow(client, orgId, id);
      await assertCanReadReport(client, actor, orgId, {
        student_profile_id: String(row.student_profile_id),
        created_by: String(row.created_by),
      });
      return c.json({
        report: mapAcademicReport(row, { includeWorkflow: true }),
        sections: await loadReportSections(client, id),
      });
    }),
  );

  app.patch("/reports/:id{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}}", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, REPORT_MANAGE_PERMISSIONS);
      const id = uuidRouteParam(c, "id");
      const existing = await loadReportRow(client, orgId, id);
      await assertCanManageReport(client, actor, orgId, {
        created_by: String(existing.created_by),
        student_profile_id: String(existing.student_profile_id),
      });
      const body = z.object({ generalComment: z.string().max(8000).nullable().optional() }).parse(await c.req.json());
      await client.query("update academic_reports set general_comment = $3 where id = $1 and organisation_id = $2", [
        id,
        orgId,
        body.generalComment ?? null,
      ]);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "assessment.report.update",
        entityType: "academic_report",
        entityId: id,
      });
      const row = await loadReportRow(client, orgId, id);
      return c.json({
        report: mapAcademicReport(row, { includeWorkflow: true }),
        sections: await loadReportSections(client, id),
      });
    }),
  );

  app.post("/reports/:id{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}}/sections", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, REPORT_MANAGE_PERMISSIONS);
      const id = uuidRouteParam(c, "id");
      const existing = await loadReportRow(client, orgId, id);
      await assertCanManageReport(client, actor, orgId, {
        created_by: String(existing.created_by),
        student_profile_id: String(existing.student_profile_id),
      });
      const body = z
        .object({
          subjectId: z.string().uuid(),
          teacherUserId: z.string().uuid().nullable().optional(),
          attainmentSummary: z.string().max(2000).nullable().optional(),
          progressJudgement: z.string().max(2000).nullable().optional(),
          teacherComment: z.string().max(4000).nullable().optional(),
          targetNextSteps: z.string().max(2000).nullable().optional(),
          sortOrder: z.number().int().optional(),
        })
        .parse(await c.req.json());
      await client.query(
        `insert into academic_report_sections (
           organisation_id, report_id, subject_id, teacher_user_id, attainment_summary,
           progress_judgement, teacher_comment, target_next_steps, sort_order
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          orgId,
          id,
          body.subjectId,
          body.teacherUserId ?? null,
          body.attainmentSummary ?? null,
          body.progressJudgement ?? null,
          body.teacherComment ?? null,
          body.targetNextSteps ?? null,
          body.sortOrder ?? 0,
        ],
      );
      return c.json({
        report: mapAcademicReport(existing, { includeWorkflow: true }),
        sections: await loadReportSections(client, id),
      }, 201);
    }),
  );

  app.patch("/reports/:id{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}}/sections/:sectionId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, REPORT_MANAGE_PERMISSIONS);
      const id = uuidRouteParam(c, "id");
      const sectionId = uuidRouteParam(c, "sectionId");
      const existing = await loadReportRow(client, orgId, id);
      await assertCanManageReport(client, actor, orgId, {
        created_by: String(existing.created_by),
        student_profile_id: String(existing.student_profile_id),
      });
      const body = z
        .object({
          attainmentSummary: z.string().max(2000).nullable().optional(),
          progressJudgement: z.string().max(2000).nullable().optional(),
          teacherComment: z.string().max(4000).nullable().optional(),
          targetNextSteps: z.string().max(2000).nullable().optional(),
          teacherUserId: z.string().uuid().nullable().optional(),
        })
        .parse(await c.req.json());
      const updated = await client.query(
        `update academic_report_sections
         set attainment_summary = coalesce($3, attainment_summary),
             progress_judgement = coalesce($4, progress_judgement),
             teacher_comment = coalesce($5, teacher_comment),
             target_next_steps = coalesce($6, target_next_steps),
             teacher_user_id = case when $7::text = '__omit' then teacher_user_id else $7::uuid end
         where id = $1 and report_id = $2
         returning id`,
        [
          sectionId,
          id,
          body.attainmentSummary ?? null,
          body.progressJudgement ?? null,
          body.teacherComment ?? null,
          body.targetNextSteps ?? null,
          body.teacherUserId === undefined ? "__omit" : body.teacherUserId,
        ],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      return c.json({
        report: mapAcademicReport(existing, { includeWorkflow: true }),
        sections: await loadReportSections(client, id),
      });
    }),
  );

  async function transitionReport(
    client: pg.PoolClient,
    actor: Parameters<typeof assertCanManageReport>[1],
    orgId: string,
    userId: string,
    id: string,
    to: string,
    action: string,
  ) {
    const existing = await loadReportRow(client, orgId, id);
    if (to === "submitted_for_review" || to === "draft") {
      await assertCanManageReport(client, actor, orgId, {
        created_by: String(existing.created_by),
        student_profile_id: String(existing.student_profile_id),
      });
    } else if (to === "approved") {
      if (!canReviewReports(actor)) throw new AppError(403, "forbidden", "Missing permission");
      await assertCanReadReport(client, actor, orgId, {
        student_profile_id: String(existing.student_profile_id),
        created_by: String(existing.created_by),
      });
    } else if (to === "published" || to === "archived") {
      if (!canPublishReports(actor) && !canManageSchoolReports(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
    }
    await client.query("update academic_reports set status = $2 where id = $1 and organisation_id = $3", [
      id,
      to,
      orgId,
    ]);
    if (to === "published") {
      await freezeReportPublication(client, orgId, id, userId);
      const pupil = await client.query<{ user_id: string | null }>(
        "select user_id from student_profiles where id = $1",
        [existing.student_profile_id],
      );
      await notifyReportPublished(client, {
        organisationId: orgId,
        actorUserId: userId,
        studentProfileId: String(existing.student_profile_id),
        studentUserId: pupil.rows[0]?.user_id ?? null,
        title: `${existing.reporting_period_name ?? "Report"} report`,
        reportId: id,
      });
    }
    await writeAudit(client, {
      organisationId: orgId,
      actorUserId: userId,
      action,
      entityType: "academic_report",
      entityId: id,
      before: { status: existing.status },
      after: { status: to },
    });
    return loadReportRow(client, orgId, id);
  }

  app.post("/reports/:id{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}}/submit", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await transitionReport(client, actor, orgId, userId, id, "submitted_for_review", "assessment.report.submitted");
      return c.json({ report: mapAcademicReport(row, { includeWorkflow: true }), sections: await loadReportSections(client, id) });
    }),
  );
  app.post("/reports/:id{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}}/approve", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await transitionReport(client, actor, orgId, userId, id, "approved", "assessment.report.approved");
      return c.json({ report: mapAcademicReport(row, { includeWorkflow: true }), sections: await loadReportSections(client, id) });
    }),
  );
  app.post("/reports/:id{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}}/publish", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await transitionReport(client, actor, orgId, userId, id, "published", "assessment.report.published");
      return c.json({ report: mapAcademicReport(row, { includeWorkflow: true }), sections: await loadReportSections(client, id) });
    }),
  );
  app.post("/reports/:id{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}}/archive", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const row = await transitionReport(client, actor, orgId, userId, id, "archived", "assessment.report.archived");
      return c.json({ report: mapAcademicReport(row, { includeWorkflow: true }), sections: await loadReportSections(client, id) });
    }),
  );
}
