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
  isoDate,
  listCalendarActivities,
  archiveOwnConversation,
  countUnreadMessages,
  createParentConversation,
  listConversationMessages,
  listConversations,
  listParentContactPoints,
  loadConversationDetail,
  markConversationRead,
  sendConversationMessage,
  loadEffectiveEngagementPolicy,
  loadParentFinance,
  loadParentInvoice,
  loadParentStatement,
  loadPupilYearGroupId,
} from "@schoolapp/core";
import { listPupilTimetable } from "./timetable";
import { mapTimetableOccurrence } from "../serialize";
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
import {
  calendarItemsFromActivities,
  listPortalActivities,
  loadPortalActivityDetail,
  parentRespondToActivity,
} from "../activities-portal";
import { listParentCharges, loadParentCharge, startParentCheckout } from "../payments-portal";
import { paymentProviderOf, publicOriginFromRequest } from "../payments-context";
import { z } from "zod";
import { uploadConversationAttachment } from "./messaging";
import {
  buildLeaderboard,
  listPracticeForPupil,
  listRewardsForStudent,
  loadPlayableActivity,
  pupilProgressSummary,
  startPracticeAttempt,
  submitPracticeAttempt,
  competitionTargetStudentIds,
} from "../engagement-service";
import { mapCompetition } from "../serialize";

export function registerParentRoutes(app: SchoolappApi) {
  app.get("/parent/dashboard", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_READ_OWN_CHILDREN);
      const school = await loadSchool(client, orgId);
      const childIds = await guardianChildIds(client, userId, orgId);
      const children = await loadPortalStudentsByIds(client, orgId, [...childIds]);
      const unreadCount = await countUnreadNotifications(client, orgId, userId);
      const messagingUnreadCount = await countUnreadMessages(client, actor);
      const today = isoDate();
      const upcoming = [];
      for (const child of children) {
        const lessons = await listPupilTimetable(client, orgId, child.id, today, addDaysSafe(today, 7));
        const next = lessons.find((item) => item.status !== "cancelled" && item.status !== "school_closure");
        upcoming.push({
          studentId: child.id,
          displayName: child.displayName,
          nextLesson: next ? mapTimetableOccurrence(next, { includeInternal: false }) : null,
        });
      }
      return c.json({
        school,
        children: children.map(portalChildSummary),
        upcoming: { available: true, items: upcoming },
        recentActivity: comingLater,
        notifications: { unreadCount, preview: comingLater },
        messaging: { unreadCount: messagingUnreadCount },
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
          timetable: { available: true },
          payments: { available: true },
          achievements: { available: true },
          competitions: { available: true },
          rewards: { available: true },
          practice: { available: true },
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
      const childIds = [...(await guardianChildIds(client, userId, orgId))];
      const announcements = await listPortalAnnouncements(client, {
        orgId,
        userId,
        audienceRole: "parent",
        allowedStudentIds: childIds,
      });
      return c.json({ announcements });
    }),
  );

  app.get("/parent/announcements/:announcementId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ANNOUNCEMENTS_READ_OWN_CHILDREN);
      await activateDueAnnouncements(client, orgId, userId);
      const announcementId = uuidRouteParam(c, "announcementId");
      const childIds = [...(await guardianChildIds(client, userId, orgId))];
      const announcement = await loadPortalAnnouncement(client, {
        orgId,
        userId,
        announcementId,
        audienceRole: "parent",
        allowedStudentIds: childIds,
      });
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
      const childIds = [...(await guardianChildIds(client, userId, orgId))];
      await loadPortalAnnouncement(client, {
        orgId,
        userId,
        announcementId,
        audienceRole: "parent",
        allowedStudentIds: childIds,
      });
      const state = await markPortalAnnouncementRead(client, orgId, userId, announcementId);
      return c.json({ readAt: state.read_at, acknowledgedAt: state.acknowledged_at });
    }),
  );

  app.post("/parent/announcements/:announcementId/acknowledge", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ANNOUNCEMENTS_READ_OWN_CHILDREN);
      const announcementId = uuidRouteParam(c, "announcementId");
      const childIds = [...(await guardianChildIds(client, userId, orgId))];
      await loadPortalAnnouncement(client, {
        orgId,
        userId,
        announcementId,
        audienceRole: "parent",
        allowedStudentIds: childIds,
      });
      const state = await acknowledgePortalAnnouncement(client, orgId, userId, announcementId);
      return c.json({ readAt: state.read_at, acknowledgedAt: state.acknowledged_at });
    }),
  );

  app.get("/parent/calendar/events", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.CALENDAR_READ_OWN_CHILDREN);
      await activateDueEvents(client, orgId, userId);
      const childIds = [...(await guardianChildIds(client, userId, orgId))];
      const events = await listPortalEvents(client, {
        orgId,
        userId,
        audienceRole: "parent",
        from: c.req.query("from"),
        to: c.req.query("to"),
        allowedStudentIds: childIds,
      });
      const withRelated = [];
      for (const event of events) {
        withRelated.push({
          ...event,
          related: await loadPortalEventSubjects(client, orgId, String(event.id), userId, childIds),
        });
      }
      const from = c.req.query("from") ?? isoDate();
      const to = c.req.query("to") ?? addDaysSafe(from, 14);
      const activityFrom = c.req.query("from") ?? null;
      const activityTo = c.req.query("to") ?? null;
      const lessons = [];
      for (const childId of childIds) {
        const items = await listPupilTimetable(client, orgId, childId, from, to);
        for (const item of items) {
          lessons.push({
            studentId: childId,
            ...mapTimetableOccurrence(item, { includeInternal: false }),
          });
        }
      }
      const activityRows = await listCalendarActivities(client, {
        organisationId: orgId,
        from: activityFrom,
        to: activityTo,
        studentIds: childIds,
        parentVisibleOnly: true,
      });
      return c.json({
        events: withRelated,
        lessons,
        activities: calendarItemsFromActivities(activityRows, activityFrom, activityTo),
      });
    }),
  );

  app.get("/parent/children/:studentId/timetable", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.TIMETABLE_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const from = c.req.query("from") ?? isoDate();
      const to = c.req.query("to") ?? addDaysSafe(from, 6);
      const lessons = await listPupilTimetable(client, orgId, studentId, from, to);
      return c.json({
        from,
        to,
        occurrences: lessons.map((item) => mapTimetableOccurrence(item, { includeInternal: false })),
      });
    }),
  );

  app.get("/parent/calendar/events/:eventId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.CALENDAR_READ_OWN_CHILDREN);
      await activateDueEvents(client, orgId, userId);
      const eventId = uuidRouteParam(c, "eventId");
      const childIds = [...(await guardianChildIds(client, userId, orgId))];
      const event = await loadPortalEvent(client, {
        orgId,
        userId,
        eventId,
        audienceRole: "parent",
        allowedStudentIds: childIds,
      });
      return c.json({
        event: {
          ...event,
          related: await loadPortalEventSubjects(client, orgId, eventId, userId, childIds),
        },
      });
    }),
  );

  app.get("/parent/activities", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACTIVITIES_READ_OWN_CHILDREN);
      const childIds = [...(await guardianChildIds(client, userId, orgId))];
      const activities = await listPortalActivities(client, {
        orgId,
        studentIds: childIds,
        audience: "parent",
      });
      return c.json({ activities });
    }),
  );

  app.get("/parent/children/:studentId/activities", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACTIVITIES_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const activities = await listPortalActivities(client, {
        orgId,
        studentIds: [studentId],
        audience: "parent",
      });
      return c.json({ activities });
    }),
  );

  app.get("/parent/children/:studentId/activities/:activityId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACTIVITIES_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      const activityId = uuidRouteParam(c, "activityId");
      await requireLinkedChild(client, userId, orgId, studentId);
      return c.json(await loadPortalActivityDetail(client, { orgId, activityId, studentId, audience: "parent" }));
    }),
  );

  app.post("/parent/children/:studentId/activities/:activityId/respond", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACTIVITIES_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      const activityId = uuidRouteParam(c, "activityId");
      const result = await parentRespondToActivity(client, {
        orgId,
        userId,
        studentId,
        activityId,
        body: await c.req.json(),
      });
      return c.json(result);
    }),
  );

  app.get("/parent/payments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const charges = await listParentCharges(client, { orgId, userId, actor });
      return c.json({ charges });
    }),
  );

  app.get("/parent/children/:studentId/payments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const studentId = uuidRouteParam(c, "studentId");
      const charges = await listParentCharges(client, { orgId, userId, actor, studentId });
      return c.json({ charges });
    }),
  );

  app.get("/parent/payments/:chargeId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      return c.json(await loadParentCharge(client, {
        orgId,
        userId,
        actor,
        chargeId: uuidRouteParam(c, "chargeId"),
      }));
    }),
  );

  app.get("/parent/finance", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      return c.json(await loadParentFinance(client, orgId, actor));
    }),
  );

  app.get("/parent/finance/invoices/:invoiceId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      return c.json(await loadParentInvoice(client, orgId, actor, uuidRouteParam(c, "invoiceId")));
    }),
  );

  app.get("/parent/finance/statement", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const from = c.req.query("from") ?? `${new Date().getUTCFullYear()}-01-01`;
      const to = c.req.query("to") ?? new Date().toISOString().slice(0, 10);
      return c.json(await loadParentStatement(client, orgId, actor, from, to));
    }),
  );

  app.post("/parent/payments/:chargeId/checkout", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const chargeId = uuidRouteParam(c, "chargeId");
      const parsed = z
        .object({
          amountMinor: z.number().int().positive().optional(),
          idempotencyKey: z.string().min(8).max(120).optional(),
        })
        .safeParse((await c.req.json().catch(() => ({}))) ?? {});
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid checkout");
      const origin = publicOriginFromRequest(c);
      const result = await startParentCheckout(client, {
        orgId,
        actor,
        chargeId,
        provider: paymentProviderOf(c),
        amountMinor: parsed.data.amountMinor,
        idempotencyKey: parsed.data.idempotencyKey,
        successUrl: `${origin}/parent/payments/${chargeId}?status=pending`,
        cancelUrl: `${origin}/parent/payments/${chargeId}?status=cancelled`,
      });
      return c.json({ checkoutUrl: result.checkoutUrl, sessionId: result.session.id });
    }),
  );

  app.get("/parent/messages", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      assertPermission(actor, PERMISSIONS.MESSAGING_READ_OWN_CHILDREN);
      return c.json(
        await listConversations(client, actor, {
          folder: c.req.query("folder") ?? "inbox",
          q: c.req.query("q") ?? undefined,
          pupilId: c.req.query("pupilId") ?? undefined,
          cursor: c.req.query("cursor") ?? undefined,
          limit: Number(c.req.query("limit") ?? 30) || 30,
        }),
      );
    }),
  );

  app.get("/parent/messages/contacts", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      const studentId = c.req.query("studentId");
      if (!studentId) throw new AppError(400, "validation_failed", "A child is required");
      return c.json(await listParentContactPoints(client, actor, studentId));
    }),
  );

  app.post("/parent/messages", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      const parsed = z
        .object({
          studentId: z.string().uuid(),
          contactPoint: z.enum(["class_teacher", "school_office", "admissions"]),
          subject: z.string().min(1).max(200),
          body: z.string().min(1).max(8000),
          teacherUserId: z.string().uuid().nullable().optional(),
        })
        .safeParse((await c.req.json().catch(() => null)) ?? {});
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid conversation");
      const created = await createParentConversation(client, actor, parsed.data);
      return c.json(created, 201);
    }),
  );

  app.get("/parent/messages/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      assertPermission(actor, PERMISSIONS.MESSAGING_READ_OWN_CHILDREN);
      return c.json(await loadConversationDetail(client, actor, uuidRouteParam(c, "id")));
    }),
  );

  app.get("/parent/messages/:id/messages", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      assertPermission(actor, PERMISSIONS.MESSAGING_READ_OWN_CHILDREN);
      return c.json(
        await listConversationMessages(client, actor, uuidRouteParam(c, "id"), {
          before: c.req.query("before") ?? undefined,
          limit: Number(c.req.query("limit") ?? 50) || 50,
        }),
      );
    }),
  );

  app.post("/parent/messages/:id/messages", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      assertPermission(actor, PERMISSIONS.MESSAGING_REPLY_OWN);
      const parsed = z.object({ body: z.string().min(1).max(8000) }).safeParse((await c.req.json().catch(() => null)) ?? {});
      if (!parsed.success) throw new AppError(400, "validation_failed", "Message text is required");
      return c.json(await sendConversationMessage(client, actor, uuidRouteParam(c, "id"), parsed.data.body), 201);
    }),
  );

  app.post("/parent/messages/:id/read", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      assertPermission(actor, PERMISSIONS.MESSAGING_READ_OWN_CHILDREN);
      return c.json(await markConversationRead(client, actor, uuidRouteParam(c, "id")));
    }),
  );

  app.post("/parent/messages/:id/archive", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      assertPermission(actor, PERMISSIONS.MESSAGING_READ_OWN_CHILDREN);
      const body = (await c.req.json().catch(() => ({}))) as { archived?: boolean };
      return c.json(await archiveOwnConversation(client, actor, uuidRouteParam(c, "id"), body.archived !== false));
    }),
  );

  app.post("/parent/messages/:id/messages/:messageId/attachments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.MESSAGING_REPLY_OWN);
      return uploadConversationAttachment(
        c,
        client,
        actor,
        orgId,
        userId,
        uuidRouteParam(c, "id"),
        uuidRouteParam(c, "messageId"),
      );
    }),
  );

  app.get("/parent/children/:studentId/engagement", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.REWARDS_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const yearGroupId = await loadPupilYearGroupId(client, orgId, studentId);
      const policy = await loadEffectiveEngagementPolicy(client, orgId, yearGroupId);
      const progress = await pupilProgressSummary({
        client,
        organisationId: orgId,
        studentProfileId: studentId,
        audience: "parent",
        policy,
      });
      const practice = policy.parentAssistedMode
        ? await listPracticeForPupil({ client, organisationId: orgId, studentProfileId: studentId, policy })
        : [];
      const rewards = await listRewardsForStudent({
        client,
        organisationId: orgId,
        studentProfileId: studentId,
        audience: "parent",
        policy,
      });
      return c.json({ progress, practice, rewards, parentAssistedMode: policy.parentAssistedMode });
    }),
  );

  app.get("/parent/children/:studentId/rewards", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.REWARDS_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const yearGroupId = await loadPupilYearGroupId(client, orgId, studentId);
      const policy = await loadEffectiveEngagementPolicy(client, orgId, yearGroupId);
      const rewards = await listRewardsForStudent({
        client,
        organisationId: orgId,
        studentProfileId: studentId,
        audience: "parent",
        policy,
      });
      return c.json({ rewards });
    }),
  );

  app.get("/parent/children/:studentId/achievements", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACHIEVEMENTS_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const yearGroupId = await loadPupilYearGroupId(client, orgId, studentId);
      const policy = await loadEffectiveEngagementPolicy(client, orgId, yearGroupId);
      const progress = await pupilProgressSummary({
        client,
        organisationId: orgId,
        studentProfileId: studentId,
        audience: "parent",
        policy,
      });
      return c.json({ achievements: progress.achievements, xp: progress.xp, rewardPoints: progress.rewardPoints });
    }),
  );

  app.get("/parent/children/:studentId/competitions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.COMPETITIONS_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const yearGroupId = await loadPupilYearGroupId(client, orgId, studentId);
      const policy = await loadEffectiveEngagementPolicy(client, orgId, yearGroupId);
      if (!policy.competitionsEnabled) return c.json({ competitions: [] });
      const rows = await client.query(
        `select * from competitions
         where organisation_id = $1
           and parent_visible = true
           and staff_only = false
           and status in ('published', 'active', 'completed')
         order by starts_at nulls last, title`,
        [orgId],
      );
      const visible = [];
      for (const row of rows.rows) {
        const targetIds = await competitionTargetStudentIds(client, orgId, row.id);
        if (!targetIds || targetIds.has(studentId)) visible.push(row);
      }
      return c.json({ competitions: visible.map(mapCompetition) });
    }),
  );

  app.get("/parent/children/:studentId/competitions/:id/leaderboard", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.COMPETITIONS_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const yearGroupId = await loadPupilYearGroupId(client, orgId, studentId);
      const policy = await loadEffectiveEngagementPolicy(client, orgId, yearGroupId);
      const board = await buildLeaderboard({
        client,
        organisationId: orgId,
        competitionId: uuidRouteParam(c, "id"),
        audience: "parent",
        policy,
        requestedScope: c.req.query("scope"),
        viewerStudentId: studentId,
      });
      return c.json(board);
    }),
  );

  app.get("/parent/children/:studentId/practice", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.LEARNING_PRACTICE_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const yearGroupId = await loadPupilYearGroupId(client, orgId, studentId);
      const policy = await loadEffectiveEngagementPolicy(client, orgId, yearGroupId);
      if (!policy.parentAssistedMode) {
        return c.json({ practice: [], parentAssistedMode: false, childFriendlyUi: policy.childFriendlyUi });
      }
      const practice = await listPracticeForPupil({
        client,
        organisationId: orgId,
        studentProfileId: studentId,
        policy,
      });
      return c.json({ practice, parentAssistedMode: policy.parentAssistedMode, childFriendlyUi: policy.childFriendlyUi });
    }),
  );

  app.get("/parent/children/:studentId/practice/:assignmentId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.LEARNING_PRACTICE_READ_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const yearGroupId = await loadPupilYearGroupId(client, orgId, studentId);
      const policy = await loadEffectiveEngagementPolicy(client, orgId, yearGroupId);
      if (!policy.parentAssistedMode) {
        throw new AppError(403, "forbidden", "Parent-assisted learning is not enabled for this year group");
      }
      const playable = await loadPlayableActivity({
        client,
        organisationId: orgId,
        assignmentId: uuidRouteParam(c, "assignmentId"),
        studentProfileId: studentId,
        includeAnswers: false,
      });
      return c.json(playable);
    }),
  );

  app.post("/parent/children/:studentId/practice/:assignmentId/start", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.LEARNING_PRACTICE_SUBMIT_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const yearGroupId = await loadPupilYearGroupId(client, orgId, studentId);
      const policy = await loadEffectiveEngagementPolicy(client, orgId, yearGroupId);
      if (!policy.parentAssistedMode) {
        throw new AppError(403, "forbidden", "Parent-assisted learning is not enabled for this year group");
      }
      const started = await startPracticeAttempt({
        client,
        organisationId: orgId,
        assignmentId: uuidRouteParam(c, "assignmentId"),
        studentProfileId: studentId,
        actorUserId: userId,
        channel: "parent_assisted",
      });
      return c.json(started, 201);
    }),
  );

  app.post("/parent/children/:studentId/practice/attempts/:attemptId/submit", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.LEARNING_PRACTICE_SUBMIT_OWN_CHILDREN);
      const studentId = uuidRouteParam(c, "studentId");
      await requireLinkedChild(client, userId, orgId, studentId);
      const yearGroupId = await loadPupilYearGroupId(client, orgId, studentId);
      const policy = await loadEffectiveEngagementPolicy(client, orgId, yearGroupId);
      if (!policy.parentAssistedMode) {
        throw new AppError(403, "forbidden", "Parent-assisted learning is not enabled for this year group");
      }
      const body = (await c.req.json().catch(() => ({}))) as { answers?: Record<string, unknown> };
      const result = await submitPracticeAttempt({
        client,
        organisationId: orgId,
        attemptId: uuidRouteParam(c, "attemptId"),
        studentProfileId: studentId,
        answers: body.answers ?? {},
        actorUserId: userId,
        expectedChannel: "parent_assisted",
      });
      return c.json(result);
    }),
  );
}

function addDaysSafe(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
