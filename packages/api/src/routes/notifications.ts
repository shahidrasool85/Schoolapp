import { z } from "zod";
import { PERMISSIONS } from "@schoolapp/domain";
import {
  AppError,
  assertPermission,
  countUnreadNotifications,
  listInboxNotifications,
  markNotificationRead,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { routeParam, withSchoolActor } from "../school-context";

const patchSchema = z.object({
  read: z.literal(true),
});

export function registerNotificationRoutes(app: SchoolappApi) {
  app.get("/notifications", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.NOTIFICATIONS_INBOX_READ);
      const unreadOnly = c.req.query("unreadOnly") === "true";
      const notifications = await listInboxNotifications(client, orgId, userId, unreadOnly);
      const unreadCount = await countUnreadNotifications(client, orgId, userId);
      return c.json({ notifications, unreadCount });
    }),
  );

  app.patch("/notifications/:notificationId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.NOTIFICATIONS_INBOX_READ);
      const parsed = patchSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid notification payload");
      }
      const notification = await markNotificationRead(
        client,
        orgId,
        userId,
        routeParam(c, "notificationId"),
      );
      return c.json({ notification });
    }),
  );
}
