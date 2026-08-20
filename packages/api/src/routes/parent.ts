import { PERMISSIONS } from "@schoolapp/domain";
import {
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
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { withSchoolActor, uuidRouteParam } from "../school-context";

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
        sections: PARENT_CHILD_SECTIONS,
      });
    }),
  );
}
