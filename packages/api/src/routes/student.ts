import { PERMISSIONS } from "@schoolapp/domain";
import {
  AppError,
  assertPermission,
  comingLater,
  countUnreadNotifications,
  loadOwnStudentProfile,
  STUDENT_DASHBOARD_SECTIONS,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { withSchoolActor } from "../school-context";

export function registerStudentRoutes(app: SchoolappApi) {
  app.get("/student/me", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_READ_SELF);
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
        sections: STUDENT_DASHBOARD_SECTIONS,
        notifications: { unreadCount, preview: comingLater },
      });
    }),
  );
}
