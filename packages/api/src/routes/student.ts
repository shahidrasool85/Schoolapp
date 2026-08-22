import { PERMISSIONS } from "@schoolapp/domain";
import {
  AppError,
  assertPermission,
  comingLater,
  countUnreadNotifications,
  isLearningSubmissionStatus,
  loadOwnStudentProfile,
  pupilCanSaveDraftFrom,
  pupilCanSubmitFrom,
  requireStudentPortalEnabled,
  STUDENT_DASHBOARD_SECTIONS,
  summariseAttendanceMarks,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import { ensurePupilSubmission, listPupilAssignments, loadPupilAssignment } from "../learning-pupil";
import { z } from "zod";

export function registerStudentRoutes(app: SchoolappApi) {
  app.get("/student/me", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_READ_SELF);
      await requireStudentPortalEnabled(client, orgId, userId);
      const student = await loadOwnStudentProfile(client, orgId, userId);
      if (!student) {
        throw new AppError(404, "not_found", "Not found");
      }
      return c.json({ student });
    }),
  );

  app.get("/student/dashboard", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_READ_SELF);
      await requireStudentPortalEnabled(client, orgId, userId);
      const student = await loadOwnStudentProfile(client, orgId, userId);
      if (!student) {
        throw new AppError(404, "not_found", "Not found");
      }
      const unreadCount = await countUnreadNotifications(client, orgId, userId);
      return c.json({
        student,
        school: student.school,
        welcome: {
          title: `Hello, ${student.displayName}`,
          message: `Welcome to ${student.school.name}.`,
        },
        sections: {
          ...STUDENT_DASHBOARD_SECTIONS,
          attendance: { available: true },
          myLearning: { available: true },
          homework: { available: true },
        },
        notifications: { unreadCount, preview: comingLater },
      });
    }),
  );

  app.get("/student/attendance", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ATTENDANCE_RECORD_READ_SELF);
      const studentProfileId = await requireStudentPortalEnabled(client, orgId, userId);
      const from = c.req.query("from");
      const to = c.req.query("to");
      const rows = await client.query(
        `select
           am.id,
           am.mark_date::text,
           st.key as session_key,
           st.name as session_name,
           ac.code,
           ac.name as code_name,
           ac.category,
           am.late_minutes,
           am.parent_visible_note
         from attendance_marks am
         join attendance_session_types st on st.id = am.session_type_id
         join attendance_codes ac on ac.id = am.attendance_code_id
         where am.organisation_id = $1
           and am.student_profile_id = $2
           and ($3::date is null or am.mark_date >= $3::date)
           and ($4::date is null or am.mark_date <= $4::date)
         order by am.mark_date desc, st.sort_order`,
        [orgId, studentProfileId, from || null, to || null],
      );
      return c.json({
        summary: summariseAttendanceMarks(rows.rows.map((row) => ({ category: String(row.category) }))),
        marks: rows.rows.map((row) => ({
          id: row.id,
          date: row.mark_date,
          sessionKey: row.session_key,
          sessionName: row.session_name,
          code: row.code,
          codeName: row.code_name,
          category: row.category,
          lateMinutes: row.late_minutes,
          parentNote: row.parent_visible_note,
        })),
      });
    }),
  );

  app.get("/student/assignments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.LMS_ASSIGNMENTS_READ_SELF);
      const studentProfileId = await requireStudentPortalEnabled(client, orgId, userId);
      const bucket = c.req.query("bucket");
      const assignments = await listPupilAssignments(client, orgId, studentProfileId, "student", bucket);
      return c.json({ assignments });
    }),
  );

  app.get("/student/assignments/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.LMS_ASSIGNMENTS_READ_SELF);
      const studentProfileId = await requireStudentPortalEnabled(client, orgId, userId);
      const id = uuidRouteParam(c, "id");
      const assignment = await loadPupilAssignment(client, orgId, studentProfileId, id, "student");
      return c.json({ assignment });
    }),
  );

  app.post("/student/assignments/:id/submissions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.LMS_SUBMISSIONS_SUBMIT);
      const studentProfileId = await requireStudentPortalEnabled(client, orgId, userId);
      const assignmentId = uuidRouteParam(c, "id");
      await loadPupilAssignment(client, orgId, studentProfileId, assignmentId, "student");
      const parsed = z
        .object({
          textResponse: z.string().max(20000).nullable().optional(),
          comment: z.string().max(2000).nullable().optional(),
          submit: z.boolean().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid submission");
      const assignment = await client.query<{ status: string; submission_required: boolean }>(
        "select status, submission_required from learning_assignments where id = $1 and organisation_id = $2",
        [assignmentId, orgId],
      );
      if (assignment.rows[0]?.status !== "published") {
        throw new AppError(409, "conflict", "This assignment is not open for submissions");
      }
      const current = await ensurePupilSubmission(client, orgId, assignmentId, studentProfileId);
      const submit = parsed.data.submit !== false;
      if (submit) {
        if (!isLearningSubmissionStatus(current.status) || !pupilCanSubmitFrom(current.status)) {
          throw new AppError(409, "invalid_status_transition", "This assignment cannot be submitted now");
        }
        const nextNumber = await client.query<{ n: number }>(
          `select coalesce(max(revision_number), 0)::int + 1 as n
           from learning_submission_revisions
           where submission_id = $1`,
          [current.id],
        );
        const revision = await client.query<{ id: string }>(
          `insert into learning_submission_revisions (
             organisation_id, submission_id, revision_number, text_response, comment, submitted_by
           ) values ($1, $2, $3, $4, $5, $6)
           returning id`,
          [
            orgId,
            current.id,
            nextNumber.rows[0]?.n ?? 1,
            parsed.data.textResponse ?? null,
            parsed.data.comment ?? null,
            userId,
          ],
        );
        await client.query(
          `update learning_submissions
           set status = 'submitted', current_revision_id = $3, submitted_at = now(), submitted_by = $4
           where id = $1 and organisation_id = $2`,
          [current.id, orgId, revision.rows[0]!.id, userId],
        );
      } else {
        if (!isLearningSubmissionStatus(current.status) || !pupilCanSaveDraftFrom(current.status)) {
          throw new AppError(409, "invalid_status_transition", "This assignment cannot be edited now");
        }
        const nextNumber = await client.query<{ n: number }>(
          `select coalesce(max(revision_number), 0)::int + 1 as n
           from learning_submission_revisions
           where submission_id = $1`,
          [current.id],
        );
        const revision = await client.query<{ id: string }>(
          `insert into learning_submission_revisions (
             organisation_id, submission_id, revision_number, text_response, comment, submitted_by
           ) values ($1, $2, $3, $4, $5, $6)
           returning id`,
          [
            orgId,
            current.id,
            nextNumber.rows[0]?.n ?? 1,
            parsed.data.textResponse ?? null,
            parsed.data.comment ?? null,
            userId,
          ],
        );
        await client.query(
          `update learning_submissions
           set status = 'in_progress', current_revision_id = $3
           where id = $1 and organisation_id = $2`,
          [current.id, orgId, revision.rows[0]!.id],
        );
      }
      const body = await loadPupilAssignment(client, orgId, studentProfileId, assignmentId, "student");
      return c.json({ assignment: body }, submit ? 201 : 200);
    }),
  );
}
