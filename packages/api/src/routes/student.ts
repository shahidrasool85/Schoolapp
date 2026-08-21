import { PERMISSIONS } from "@schoolapp/domain";
import {
  AppError,
  assertPermission,
  comingLater,
  countUnreadNotifications,
  loadOwnStudentProfile,
  requireStudentPortalEnabled,
  STUDENT_DASHBOARD_SECTIONS,
  summariseAttendanceMarks,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { withSchoolActor } from "../school-context";

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
        sections: { ...STUDENT_DASHBOARD_SECTIONS, attendance: { available: true } },
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
}
