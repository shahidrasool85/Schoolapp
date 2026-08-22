import type pg from "pg";
import { AppError, summariseSubjectProgress, type ProgressPoint } from "@schoolapp/core";
import { mapAcademicReport, mapAcademicReportSection, mapAcademicResult } from "./serialize";

const PUPIL_RESULT_SQL = `
  select
    r.id,
    r.assessment_id,
    a.title as assessment_title,
    a.subject_id,
    sub.name as subject_name,
    a.assessment_date::text,
    a.published_at as assessment_published_at,
    r.raw_score,
    r.maximum_score,
    r.percentage,
    r.grade_scheme_level_id,
    l.label as grade_label,
    l.code as grade_code,
    l.numeric_value,
    r.teacher_judgement,
    r.comment,
    r.released_to_student,
    r.released_to_parent
  from academic_results r
  join academic_assessments a on a.id = r.assessment_id
  left join subjects sub on sub.id = a.subject_id
  left join academic_grade_scheme_levels l on l.id = r.grade_scheme_level_id
`;

export async function listPupilFormalResults(
  client: pg.PoolClient,
  organisationId: string,
  studentId: string,
  audience: "student" | "parent",
) {
  const releaseColumn = audience === "student" ? "r.released_to_student" : "r.released_to_parent";
  const result = await client.query(
    `${PUPIL_RESULT_SQL}
     where r.organisation_id = $1
       and r.student_profile_id = $2
       and a.published_at is not null
       and ${releaseColumn} = true
     order by a.assessment_date desc, a.title`,
    [organisationId, studentId],
  );
  return result.rows.map((row) => mapAcademicResult(row as Record<string, unknown>, { audience }));
}

export async function listPupilPublishedReports(
  client: pg.PoolClient,
  organisationId: string,
  studentId: string,
) {
  const reports = await client.query(
    `select
       r.id,
       r.student_profile_id,
       sp.legal_name as student_legal_name,
       r.academic_year_id,
       ay.name as academic_year_name,
       r.reporting_period_id,
       p.name as reporting_period_name,
       r.status,
       pub.payload,
       pub.published_at
     from academic_reports r
     join student_profiles sp on sp.id = r.student_profile_id
     join academic_years ay on ay.id = r.academic_year_id
     join academic_reporting_periods p on p.id = r.reporting_period_id
     join lateral (
       select payload, published_at
       from academic_report_publications pub
       where pub.report_id = r.id
       order by pub.published_at desc
       limit 1
     ) pub on true
     where r.organisation_id = $1
       and r.student_profile_id = $2
       and r.status in ('published', 'archived')
     order by pub.published_at desc`,
    [organisationId, studentId],
  );
  return reports.rows.map((row) => {
    const payload = (row.payload ?? {}) as {
      generalComment?: string | null;
      sections?: Array<Record<string, unknown>>;
    };
    return {
      ...mapAcademicReport({
        ...row,
        general_comment: payload.generalComment ?? null,
      }),
      sections: (payload.sections ?? []).map((section) => mapAcademicReportSection(section)),
    };
  });
}

export async function loadPupilPublishedReport(
  client: pg.PoolClient,
  organisationId: string,
  studentId: string,
  reportId: string,
) {
  const reports = await listPupilPublishedReports(client, organisationId, studentId);
  const report = reports.find((row) => row.id === reportId);
  if (!report) {
    throw new AppError(404, "not_found", "Not found");
  }
  return report;
}

export async function listPupilSubjectProgress(
  client: pg.PoolClient,
  organisationId: string,
  studentId: string,
  audience: "student" | "parent",
) {
  const releaseColumn = audience === "student" ? "r.released_to_student" : "r.released_to_parent";
  const result = await client.query(
    `${PUPIL_RESULT_SQL}
     where r.organisation_id = $1
       and r.student_profile_id = $2
       and a.published_at is not null
       and ${releaseColumn} = true
     order by a.subject_id, a.assessment_date`,
    [organisationId, studentId],
  );
  const bySubject = new Map<string, ProgressPoint[]>();
  const names = new Map<string, string | null>();
  for (const row of result.rows) {
    const subjectId = String(row.subject_id);
    names.set(subjectId, (row.subject_name as string | null) ?? null);
    const points = bySubject.get(subjectId) ?? [];
    points.push({
      assessmentId: String(row.assessment_id),
      assessmentDate: String(row.assessment_date),
      subjectId,
      percentage: row.percentage != null ? Number(row.percentage) : null,
      numericValue: row.numeric_value != null ? Number(row.numeric_value) : null,
      gradeLabel: (row.grade_label as string | null) ?? null,
      teacherJudgement: (row.teacher_judgement as string | null) ?? null,
    });
    bySubject.set(subjectId, points);
  }
  return [...bySubject.entries()].map(([subjectId, points]) => ({
    subjectId,
    subjectName: names.get(subjectId) ?? null,
    ...summariseSubjectProgress(points),
    history: points,
  }));
}
