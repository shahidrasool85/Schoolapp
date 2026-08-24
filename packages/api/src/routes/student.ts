import { PERMISSIONS } from "@schoolapp/domain";
import {
  activateDueAnnouncements,
  activateDueEvents,
  AppError,
  assertPermission,
  comingLater,
  countUnreadNotifications,
  isLearningSubmissionStatus,
  loadOwnStudentProfile,
  pupilCanWriteOnAssignment,
  requireStudentPortalEnabled,
  STUDENT_DASHBOARD_SECTIONS,
  summariseAttendanceMarks,
  isoDate,
} from "@schoolapp/core";
import { listPupilTimetable } from "./timetable";
import { mapTimetableOccurrence } from "../serialize";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import { ensurePupilSubmission, listPupilAssignments, loadPupilAssignment } from "../learning-pupil";
import {
  copyRevisionAttachments,
  insertPendingObject,
  putAndActivateObject,
  readUploadedFile,
  scannerOf,
  storageErrorToAppError,
  storageOf,
  validateBytes,
} from "../file-service";
import {
  listPupilFormalResults,
  listPupilPublishedReports,
  listPupilSubjectProgress,
  loadPupilPublishedReport,
} from "../academic-pupil";
import {
  acknowledgePortalAnnouncement,
  listPortalAnnouncements,
  listPortalEvents,
  loadPortalAnnouncement,
  loadPortalAnnouncementResources,
  loadPortalAnnouncementSubjects,
  loadPortalEvent,
  loadPortalEventSubjects,
  markPortalAnnouncementRead,
} from "../communications-portal";
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
      const today = isoDate();
      const lessons = await listPupilTimetable(client, orgId, student.id, today, addDaysSafe(today, 7));
      const todayLessons = lessons.filter((item) => item.date === today && item.status !== "cancelled");
      const nextLesson = lessons.find((item) => item.status !== "cancelled" && item.status !== "school_closure") ?? null;
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
          results: { available: true },
          timetable: { available: true },
        },
        timetable: {
          today: todayLessons.map((item) => mapTimetableOccurrence(item, { includeInternal: false })),
          nextLesson: nextLesson ? mapTimetableOccurrence(nextLesson, { includeInternal: false }) : null,
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
      const assignmentStatus = assignment.rows[0]?.status ?? "";
      const submit = parsed.data.submit !== false;
      if (assignmentStatus !== "published" && assignmentStatus !== "closed") {
        throw new AppError(409, "conflict", "This assignment is not open for submissions");
      }
      const existing = await client.query<{ id: string; status: string; current_revision_id: string | null }>(
        `select id, status, current_revision_id from learning_submissions
         where organisation_id = $1 and assignment_id = $2 and student_profile_id = $3`,
        [orgId, assignmentId, studentProfileId],
      );
      if (!existing.rows[0] && assignmentStatus !== "published") {
        throw new AppError(409, "conflict", "This assignment is not open for submissions");
      }
      const current = existing.rows[0] ?? (await ensurePupilSubmission(client, orgId, assignmentId, studentProfileId));
      if (
        !isLearningSubmissionStatus(current.status) ||
        !pupilCanWriteOnAssignment(assignmentStatus, current.status, submit ? "submit" : "save")
      ) {
        throw new AppError(
          409,
          assignmentStatus === "published" ? "invalid_status_transition" : "conflict",
          submit ? "This assignment cannot be submitted now" : "This assignment cannot be edited now",
        );
      }
      const previousRevisionId = (
        await client.query<{ current_revision_id: string | null }>(
          `select current_revision_id from learning_submissions where id = $1`,
          [current.id],
        )
      ).rows[0]?.current_revision_id ?? null;
      if (submit) {
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
        await copyRevisionAttachments(client, orgId, previousRevisionId, revision.rows[0]!.id);
      } else {
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
        await copyRevisionAttachments(client, orgId, previousRevisionId, revision.rows[0]!.id);
      }
      const body = await loadPupilAssignment(client, orgId, studentProfileId, assignmentId, "student");
      return c.json({ assignment: body }, submit ? 201 : 200);
    }),
  );

  app.post("/student/assignments/:id/attachments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.LMS_SUBMISSIONS_SUBMIT);
      const studentProfileId = await requireStudentPortalEnabled(client, orgId, userId);
      const assignmentId = uuidRouteParam(c, "id");
      await loadPupilAssignment(client, orgId, studentProfileId, assignmentId, "student");
      const assignment = await client.query<{ status: string }>(
        "select status from learning_assignments where id = $1 and organisation_id = $2",
        [assignmentId, orgId],
      );
      const assignmentStatus = assignment.rows[0]?.status ?? "";
      const current = await ensurePupilSubmission(client, orgId, assignmentId, studentProfileId);
      if (
        !isLearningSubmissionStatus(current.status) ||
        !pupilCanWriteOnAssignment(assignmentStatus, current.status, "save")
      ) {
        throw new AppError(409, "conflict", "This assignment cannot be edited now");
      }
      let revisionId = (
        await client.query<{ current_revision_id: string | null }>(
          `select current_revision_id from learning_submissions where id = $1`,
          [current.id],
        )
      ).rows[0]?.current_revision_id;
      if (!revisionId) {
        const created = await client.query<{ id: string }>(
          `insert into learning_submission_revisions (
             organisation_id, submission_id, revision_number, text_response, comment, submitted_by
           ) values ($1, $2, 1, null, null, $3)
           returning id`,
          [orgId, current.id, userId],
        );
        revisionId = created.rows[0]!.id;
        await client.query(
          `update learning_submissions
           set status = 'in_progress', current_revision_id = $3
           where id = $1 and organisation_id = $2`,
          [current.id, orgId, revisionId],
        );
      }
      try {
        const upload = await readUploadedFile(c);
        const validated = validateBytes({
          filename: upload.filename,
          mime: upload.mime,
          bytes: upload.bytes,
          domain: "learning_submission",
        });
        const pending = await insertPendingObject(client, {
          organisationId: orgId,
          domain: "learning_submission",
          ownerRecordId: current.id,
          storage: storageOf(c),
          validated,
          uploadedBy: userId,
        });
        const attachment = await client.query<{ id: string }>(
          `insert into learning_submission_attachments (
             organisation_id, revision_id, filename, content_type, byte_size,
             storage_backend, storage_key, stored_object_id
           ) values ($1,$2,$3,$4,$5,$6,$7,$8)
           returning id`,
          [
            orgId,
            revisionId,
            validated.originalFilename,
            validated.storedContentType,
            validated.byteSize,
            storageOf(c).backend,
            pending.storageKey,
            pending.id,
          ],
        );
        await putAndActivateObject(client, storageOf(c), scannerOf(c), {
          organisationId: orgId,
          objectId: pending.id,
          storageKey: pending.storageKey,
          bytes: upload.bytes,
          contentType: validated.storedContentType,
          filename: validated.originalFilename,
          actorUserId: userId,
          domain: "learning_submission",
        });
        const assignmentBody = await loadPupilAssignment(client, orgId, studentProfileId, assignmentId, "student");
        return c.json(
          {
            attachment: {
              id: attachment.rows[0]!.id,
              filename: validated.originalFilename,
              downloadPath: `/api/v1/files/${pending.id}`,
            },
            assignment: assignmentBody,
          },
          201,
        );
      } catch (error) {
        throw storageErrorToAppError(error);
      }
    }),
  );

  app.get("/student/results", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.RESULTS_READ_SELF);
      const studentProfileId = await requireStudentPortalEnabled(client, orgId, userId);
      const results = await listPupilFormalResults(client, orgId, studentProfileId, "student");
      return c.json({ results });
    }),
  );

  app.get("/student/progress", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.RESULTS_READ_SELF);
      const studentProfileId = await requireStudentPortalEnabled(client, orgId, userId);
      const progress = await listPupilSubjectProgress(client, orgId, studentProfileId, "student");
      return c.json({ progress });
    }),
  );

  app.get("/student/reports", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.REPORTS_READ_SELF);
      const studentProfileId = await requireStudentPortalEnabled(client, orgId, userId);
      const reports = await listPupilPublishedReports(client, orgId, studentProfileId);
      return c.json({ reports });
    }),
  );

  app.get("/student/reports/:reportId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.REPORTS_READ_SELF);
      const studentProfileId = await requireStudentPortalEnabled(client, orgId, userId);
      const reportId = uuidRouteParam(c, "reportId");
      const report = await loadPupilPublishedReport(client, orgId, studentProfileId, reportId);
      return c.json({ report });
    }),
  );

  app.get("/student/announcements", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ANNOUNCEMENTS_READ_SELF);
      const studentProfileId = await requireStudentPortalEnabled(client, orgId, userId);
      await activateDueAnnouncements(client, orgId, userId);
      const announcements = await listPortalAnnouncements(client, {
        orgId,
        userId,
        audienceRole: "student",
      });
      return c.json({ announcements, studentProfileId });
    }),
  );

  app.get("/student/announcements/:announcementId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ANNOUNCEMENTS_READ_SELF);
      const studentProfileId = await requireStudentPortalEnabled(client, orgId, userId);
      await activateDueAnnouncements(client, orgId, userId);
      const announcementId = uuidRouteParam(c, "announcementId");
      const announcement = await loadPortalAnnouncement(client, {
        orgId,
        userId,
        announcementId,
        audienceRole: "student",
      });
      await markPortalAnnouncementRead(client, orgId, userId, announcementId);
      return c.json({
        announcement: {
          ...announcement,
          resources: await loadPortalAnnouncementResources(client, orgId, announcementId),
          related: await loadPortalAnnouncementSubjects(client, orgId, announcementId, userId, [
            studentProfileId,
          ]),
        },
      });
    }),
  );

  app.post("/student/announcements/:announcementId/read", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ANNOUNCEMENTS_READ_SELF);
      await requireStudentPortalEnabled(client, orgId, userId);
      const announcementId = uuidRouteParam(c, "announcementId");
      await loadPortalAnnouncement(client, { orgId, userId, announcementId, audienceRole: "student" });
      const state = await markPortalAnnouncementRead(client, orgId, userId, announcementId);
      return c.json({ readAt: state.read_at, acknowledgedAt: state.acknowledged_at });
    }),
  );

  app.post("/student/announcements/:announcementId/acknowledge", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ANNOUNCEMENTS_READ_SELF);
      await requireStudentPortalEnabled(client, orgId, userId);
      const announcementId = uuidRouteParam(c, "announcementId");
      await loadPortalAnnouncement(client, { orgId, userId, announcementId, audienceRole: "student" });
      const state = await acknowledgePortalAnnouncement(client, orgId, userId, announcementId);
      return c.json({ readAt: state.read_at, acknowledgedAt: state.acknowledged_at });
    }),
  );

  app.get("/student/calendar/events", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.CALENDAR_READ_SELF);
      const studentProfileId = await requireStudentPortalEnabled(client, orgId, userId);
      await activateDueEvents(client, orgId, userId);
      const events = await listPortalEvents(client, {
        orgId,
        userId,
        audienceRole: "student",
        from: c.req.query("from"),
        to: c.req.query("to"),
      });
      const withRelated = [];
      for (const event of events) {
        withRelated.push({
          ...event,
          related: await loadPortalEventSubjects(client, orgId, String(event.id), userId, [studentProfileId]),
        });
      }
      const from = c.req.query("from") ?? isoDate();
      const to = c.req.query("to") ?? addDaysSafe(from, 14);
      const lessons = await listPupilTimetable(client, orgId, studentProfileId, from, to);
      return c.json({
        events: withRelated,
        lessons: lessons.map((item) => mapTimetableOccurrence(item, { includeInternal: false })),
      });
    }),
  );

  app.get("/student/timetable", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.TIMETABLE_READ_SELF);
      const studentProfileId = await requireStudentPortalEnabled(client, orgId, userId);
      const requestedStudentId = c.req.query("studentId");
      if (requestedStudentId && requestedStudentId !== studentProfileId) {
        throw new AppError(404, "not_found", "Not found");
      }
      const from = c.req.query("from") ?? isoDate();
      const to = c.req.query("to") ?? addDaysSafe(from, 6);
      const lessons = await listPupilTimetable(client, orgId, studentProfileId, from, to);
      return c.json({
        from,
        to,
        occurrences: lessons.map((item) => mapTimetableOccurrence(item, { includeInternal: false })),
      });
    }),
  );

  app.get("/student/calendar/events/:eventId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.CALENDAR_READ_SELF);
      const studentProfileId = await requireStudentPortalEnabled(client, orgId, userId);
      await activateDueEvents(client, orgId, userId);
      const eventId = uuidRouteParam(c, "eventId");
      const event = await loadPortalEvent(client, { orgId, userId, eventId, audienceRole: "student" });
      return c.json({
        event: {
          ...event,
          related: await loadPortalEventSubjects(client, orgId, eventId, userId, [studentProfileId]),
        },
      });
    }),
  );
}

function addDaysSafe(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
