import type pg from "pg";
import {
  AppError,
  isLearningStudentBucket,
  isLearningVisibleToPupil,
  parentLearningStatus,
  studentLearningBuckets,
} from "@schoolapp/core";
import { mapLearningAssignment, mapLearningMark, mapLearningResource } from "./serialize";

const PUPIL_ASSIGNMENT_SQL = `
  select
    a.id,
    a.title,
    a.description,
    a.work_type_id,
    wt.key as work_type_key,
    wt.name as work_type_name,
    a.subject_id,
    sub.name as subject_name,
    a.academic_year_id,
    ay.name as academic_year_name,
    a.intended_year_group_id,
    yg.name as intended_year_group_name,
    a.created_by,
    creator.full_name as created_by_name,
    a.created_at,
    a.due_at,
    a.available_from,
    a.status,
    a.published_at,
    a.estimated_duration_minutes,
    a.maximum_marks,
    a.submission_required,
    r.assigned_at,
    s.id as submission_id,
    s.status as submission_status,
    s.submitted_at,
    s.current_revision_id,
    rev.text_response,
    rev.comment,
    rev.revision_number,
    m.id as mark_id,
    m.score,
    m.maximum_marks as mark_maximum_marks,
    m.feedback,
    m.released_to_student,
    m.released_to_parent,
    m.marked_at
  from learning_assignment_recipients r
  join learning_assignments a on a.id = r.assignment_id
  join learning_work_types wt on wt.id = a.work_type_id
  join academic_years ay on ay.id = a.academic_year_id
  left join subjects sub on sub.id = a.subject_id
  left join year_groups yg on yg.id = a.intended_year_group_id
  left join users creator on creator.id = a.created_by
  left join learning_submissions s
    on s.assignment_id = a.id and s.student_profile_id = r.student_profile_id
  left join learning_submission_revisions rev on rev.id = s.current_revision_id
  left join learning_marks m on m.submission_id = s.id
`;

export type PupilLearningAudience = "student" | "parent";

function visibleRow(row: Record<string, unknown>, now = new Date()): boolean {
  return isLearningVisibleToPupil({
    assignmentStatus: String(row.status),
    availableFrom: row.available_from ? String(row.available_from) : null,
    dueAt: row.due_at ? String(row.due_at) : null,
    submissionStatus: row.submission_status ? String(row.submission_status) : null,
    releasedToStudent: Boolean(row.released_to_student),
    now,
  });
}

export function serializePupilAssignment(
  row: Record<string, unknown>,
  audience: PupilLearningAudience,
) {
  const releasedToStudent = Boolean(row.released_to_student);
  const releasedToParent = Boolean(row.released_to_parent);
  const rawStatus = row.submission_status ? String(row.submission_status) : "not_started";
  const publicStatus =
    audience === "parent"
      ? parentLearningStatus({
          dueAt: row.due_at ? String(row.due_at) : null,
          submissionStatus: rawStatus,
          releasedToParent,
        })
      : audience === "student" &&
          !releasedToStudent &&
          (rawStatus === "returned" || rawStatus === "completed")
        ? "submitted"
        : rawStatus;
  const assignment = mapLearningAssignment(row);
  const buckets = studentLearningBuckets({
    assignmentStatus: String(row.status),
    availableFrom: row.available_from ? String(row.available_from) : null,
    dueAt: row.due_at ? String(row.due_at) : null,
    submissionStatus: rawStatus,
    releasedToStudent: audience === "parent" ? releasedToParent : releasedToStudent,
  });
  return {
    ...assignment,
    assignedAt: row.assigned_at ?? null,
    buckets,
    parentStatus: audience === "parent" ? publicStatus : undefined,
    submission: {
      id: row.submission_id ?? null,
      status: publicStatus,
      submittedAt: row.submitted_at ?? null,
      textResponse: row.text_response ?? null,
      comment: row.comment ?? null,
      revisionNumber: row.revision_number ?? null,
    },
    mark: mapLearningMark(
      row.mark_id
        ? {
            id: row.mark_id,
            score: row.score,
            maximum_marks: row.mark_maximum_marks,
            feedback: row.feedback,
            released_to_student: releasedToStudent,
            released_to_parent: releasedToParent,
            marked_at: row.marked_at,
            submission_status: publicStatus,
          }
        : null,
      { audience },
    ),
  };
}

export async function listPupilAssignments(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
  audience: PupilLearningAudience,
  bucket?: string,
) {
  const rows = await client.query(
    `${PUPIL_ASSIGNMENT_SQL}
     where r.organisation_id = $1
       and r.student_profile_id = $2
       and a.status in ('published', 'closed', 'archived')
     order by a.due_at nulls last, r.assigned_at desc`,
    [organisationId, studentProfileId],
  );
  const now = new Date();
  const items = rows.rows
    .filter((row) => visibleRow(row as Record<string, unknown>, now))
    .map((row) => serializePupilAssignment(row as Record<string, unknown>, audience));
  if (bucket) {
    if (bucket === "due") {
      return items.filter(
        (item) => item.buckets.includes("due_soon") || item.buckets.includes("overdue"),
      );
    }
    if (!isLearningStudentBucket(bucket)) {
      throw new AppError(400, "validation_failed", "Unknown learning filter");
    }
    return items.filter((item) => item.buckets.includes(bucket));
  }
  return items;
}

export async function loadPupilAssignment(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
  assignmentId: string,
  audience: PupilLearningAudience,
) {
  const result = await client.query(
    `${PUPIL_ASSIGNMENT_SQL}
     where r.organisation_id = $1
       and r.student_profile_id = $2
       and a.id = $3
       and a.status in ('published', 'closed', 'archived')`,
    [organisationId, studentProfileId, assignmentId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || !visibleRow(row)) {
    throw new AppError(404, "not_found", "Not found");
  }
  const resources = await client.query(
    `select r.id, r.title, r.resource_kind, r.url, r.content_type, r.byte_size, r.storage_backend,
            r.stored_object_id, r.original_filename, o.status as file_status
     from learning_assignment_resources ar
     join learning_resources r on r.id = ar.resource_id
     left join stored_objects o on o.id = r.stored_object_id
     where ar.assignment_id = $1 and ar.organisation_id = $2
       and r.deleted_at is null
     order by ar.sort_order, r.created_at`,
    [assignmentId, organisationId],
  );
  const attachments = row.current_revision_id
    ? await client.query(
        `select a.id, a.filename, a.content_type, a.byte_size, a.stored_object_id, o.status as file_status
         from learning_submission_attachments a
         left join stored_objects o on o.id = a.stored_object_id
         where a.revision_id = $1 and a.organisation_id = $2 and a.deleted_at is null
         order by a.created_at`,
        [row.current_revision_id, organisationId],
      )
    : { rows: [] as Array<Record<string, unknown>> };
  return {
    ...serializePupilAssignment(row, audience),
    resources: resources.rows.map((item) => ({
      ...mapLearningResource(item as Record<string, unknown>),
      originalFilename: item.original_filename ?? null,
      downloadPath:
        item.stored_object_id && item.file_status === "active" ? `/api/v1/files/${item.stored_object_id}` : null,
    })),
    submission: {
      ...serializePupilAssignment(row, audience).submission,
      attachments: attachments.rows.map((item) => ({
        id: item.id,
        filename: item.filename,
        contentType: item.content_type,
        byteSize: item.byte_size,
        downloadPath:
          audience === "parent"
            ? null
            : item.stored_object_id && item.file_status === "active"
              ? `/api/v1/files/${item.stored_object_id}`
              : null,
      })),
    },
  };
}

export async function ensurePupilSubmission(
  client: pg.PoolClient,
  organisationId: string,
  assignmentId: string,
  studentProfileId: string,
): Promise<{ id: string; status: string }> {
  const existing = await client.query<{ id: string; status: string }>(
    `select id, status from learning_submissions
     where organisation_id = $1 and assignment_id = $2 and student_profile_id = $3`,
    [organisationId, assignmentId, studentProfileId],
  );
  if (existing.rows[0]) return existing.rows[0];
  const created = await client.query<{ id: string; status: string }>(
    `insert into learning_submissions (
       organisation_id, assignment_id, student_profile_id, status
     ) values ($1, $2, $3, 'not_started')
     returning id, status`,
    [organisationId, assignmentId, studentProfileId],
  );
  return created.rows[0]!;
}
