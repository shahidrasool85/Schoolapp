import { PERMISSIONS } from "@schoolapp/domain";
import {
  activateDueAnnouncements,
  activateDueEvents,
  AppError,
  assertPermission,
  comingLater,
  countUnreadNotifications,
  guardianChildIds,
  loadPortalStudent,
  loadPortalStudentsByIds,
  loadSchool,
  loadViewerGuardianship,
  PARENT_CHILD_SECTIONS,
  portalChildSummary,
  requireLinkedChild,
  summariseAttendanceMarks,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { withSchoolActor, uuidRouteParam } from "../school-context";
import { listPupilAssignments, loadPupilAssignment } from "../learning-pupil";
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

export function registerParentRoutes(app: SchoolappApi) {
  app.get("/parent/dashboard", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_READ_OWN_CHILDREN);
      const school = await loadSchool(client, orgId);
      const childIds = await guardianChildIds(client, userId, orgId);
      const children = await loadPortalStudentsByIds(client, orgId, [...childIds]);
      const unreadCount = await countUnreadNotifications(client, orgId, userId);
      return c.json({
        school,
        children: children.map(portalChildSummary),
        upcoming: comingLater,
        recentActivity: comingLater,
        notifications: { unreadCount, preview: comingLater },
      });
    }),
  );

  app.get("/parent/children", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_READ_OWN_CHILDREN);
      const childIds = await guardianChildIds(client, userId, orgId);
      const children = await loadPortalStudentsByIds(client, orgId, [...childIds]);
      return c.json({
        children: children.map(portalChildSummary),
      });
    }),
  );

  app.get("/parent/children/:studentId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const student = await loadPortalStudent(client, orgId, studentId);
      if (!student) {
        throw new AppError(404, "not_found", "Not found");
      }
      const guardianship = await loadViewerGuardianship(client, orgId, studentId, userId);
      return c.json({
        child: {
          ...student,
          guardianship,
        },
        sections: {
          ...PARENT_CHILD_SECTIONS,
          attendance: { available: true },
          homework: { available: true },
          learning: { available: true },
          results: { available: true },
          reports: { available: true },
          teacherFeedback: { available: true },
        },
      });
    }),
  );

  app.get("/parent/children/:studentId/attendance", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ATTENDANCE_RECORD_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const from = c.req.query("from");
      const to = c.req.query("to");
      const rows = await client.query(
        `select
           am.id,
           am.student_profile_id,
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
        [orgId, studentId, from || null, to || null],
      );
      const summary = summariseAttendanceMarks(
        rows.rows.map((row) => ({ category: String(row.category) })),
      );
      return c.json({
        summary,
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

  app.get("/parent/children/:studentId/assignments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.LMS_ASSIGNMENTS_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const assignments = await listPupilAssignments(
        client,
        orgId,
        studentId,
        "parent",
        c.req.query("bucket"),
      );
      return c.json({ assignments });
    }),
  );

  app.get("/parent/children/:studentId/assignments/:assignmentId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.LMS_ASSIGNMENTS_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      const assignmentId = uuidRouteParam(c, "assignmentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const assignment = await loadPupilAssignment(client, orgId, studentId, assignmentId, "parent");
      return c.json({ assignment });
    }),
  );

  app.get("/parent/children/:studentId/results", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.RESULTS_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const results = await listPupilFormalResults(client, orgId, studentId, "parent");
      return c.json({ results });
    }),
  );

  app.get("/parent/children/:studentId/progress", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.RESULTS_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const progress = await listPupilSubjectProgress(client, orgId, studentId, "parent");
      return c.json({ progress });
    }),
  );

  app.get("/parent/children/:studentId/reports", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.REPORTS_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const reports = await listPupilPublishedReports(client, orgId, studentId);
      return c.json({ reports });
    }),
  );

  app.get("/parent/children/:studentId/reports/:reportId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.REPORTS_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      const reportId = uuidRouteParam(c, "reportId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const report = await loadPupilPublishedReport(client, orgId, studentId, reportId);
      return c.json({ report });
    }),
  );

  app.get("/parent/announcements", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ANNOUNCEMENTS_READ_OWN_CHILDREN);
      await activateDueAnnouncements(client, orgId, userId);
      const announcements = await listPortalAnnouncements(client, {
        orgId,
        userId,
        audienceRole: "parent",
      });
      return c.json({ announcements });
    }),
  );

  app.get("/parent/announcements/:announcementId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ANNOUNCEMENTS_READ_OWN_CHILDREN);
      await activateDueAnnouncements(client, orgId, userId);
      const announcementId = uuidRouteParam(c, "announcementId");
      const announcement = await loadPortalAnnouncement(client, {
        orgId,
        userId,
        announcementId,
        audienceRole: "parent",
      });
      const childIds = [...(await guardianChildIds(client, userId, orgId))];
      await markPortalAnnouncementRead(client, orgId, userId, announcementId);
      return c.json({
        announcement: {
          ...announcement,
          resources: await loadPortalAnnouncementResources(client, orgId, announcementId),
          related: await loadPortalAnnouncementSubjects(client, orgId, announcementId, userId, childIds),
        },
      });
    }),
  );

  app.post("/parent/announcements/:announcementId/read", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ANNOUNCEMENTS_READ_OWN_CHILDREN);
      const announcementId = uuidRouteParam(c, "announcementId");
      await loadPortalAnnouncement(client, { orgId, userId, announcementId, audienceRole: "parent" });
      const state = await markPortalAnnouncementRead(client, orgId, userId, announcementId);
      return c.json({ readAt: state.read_at, acknowledgedAt: state.acknowledged_at });
    }),
  );

  app.post("/parent/announcements/:announcementId/acknowledge", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ANNOUNCEMENTS_READ_OWN_CHILDREN);
      const announcementId = uuidRouteParam(c, "announcementId");
      await loadPortalAnnouncement(client, { orgId, userId, announcementId, audienceRole: "parent" });
      const state = await acknowledgePortalAnnouncement(client, orgId, userId, announcementId);
      return c.json({ readAt: state.read_at, acknowledgedAt: state.acknowledged_at });
    }),
  );

  app.get("/parent/calendar/events", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.CALENDAR_READ_OWN_CHILDREN);
      await activateDueEvents(client, orgId, userId);
      const events = await listPortalEvents(client, {
        orgId,
        userId,
        audienceRole: "parent",
        from: c.req.query("from"),
        to: c.req.query("to"),
      });
      const childIds = [...(await guardianChildIds(client, userId, orgId))];
      const withRelated = [];
      for (const event of events) {
        withRelated.push({
          ...event,
          related: await loadPortalEventSubjects(client, orgId, String(event.id), userId, childIds),
        });
      }
      return c.json({ events: withRelated });
    }),
  );

  app.get("/parent/calendar/events/:eventId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.CALENDAR_READ_OWN_CHILDREN);
      await activateDueEvents(client, orgId, userId);
      const eventId = uuidRouteParam(c, "eventId");
      const event = await loadPortalEvent(client, { orgId, userId, eventId, audienceRole: "parent" });
      const childIds = [...(await guardianChildIds(client, userId, orgId))];
      return c.json({
        event: {
          ...event,
          related: await loadPortalEventSubjects(client, orgId, eventId, userId, childIds),
        },
      });
    }),
  );
}
