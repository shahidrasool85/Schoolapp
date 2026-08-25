import { z } from "zod";
import type { Context } from "hono";
import type pg from "pg";
import { PERMISSIONS, type Actor } from "@schoolapp/domain";
import {
  AppError,
  archiveOwnConversation,
  attachMessageFile,
  closeConversation,
  countUnreadMessages,
  createStaffConversation,
  hasAnyStaffMessagingAccess,
  listConversationMessages,
  listConversations,
  listPupilContactHistory,
  listPupilMessageRecipients,
  loadConversationDetail,
  markConversationRead,
  redactMessage,
  reopenConversation,
  sendConversationMessage,
} from "@schoolapp/core";
import type { ApiEnv, SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import {
  insertPendingObject,
  putAndActivateObject,
  readUploadedFile,
  runUpload,
  scannerOf,
  storageErrorToAppError,
  storageOf,
  validateBytes,
} from "../file-service";

const createSchema = z.object({
  conversationType: z.enum(["parent_teacher", "parent_school", "admissions", "staff_internal"]),
  subject: z.string().min(1).max(200),
  relatedPupilId: z.string().uuid().nullable().optional(),
  parentUserIds: z.array(z.string().uuid()).max(10).optional(),
  staffUserIds: z.array(z.string().uuid()).max(20).optional(),
  relatedDomain: z
    .enum(["none", "admissions_application", "school_charge", "school_activity", "learning_assignment", "attendance"])
    .optional(),
  relatedRecordId: z.string().uuid().nullable().optional(),
  body: z.string().max(8000).optional(),
});

const sendSchema = z.object({
  body: z.string().min(1).max(8000),
});

export async function uploadConversationAttachment(
  c: Context<ApiEnv>,
  client: pg.PoolClient,
  actor: Actor,
  orgId: string,
  userId: string,
  conversationId: string,
  messageId: string,
) {
  try {
    const uploaded = await readUploadedFile(c);
    const validated = validateBytes({
      bytes: uploaded.bytes,
      filename: uploaded.filename,
      mime: uploaded.mime,
      domain: "message",
    });
    return await runUpload(storageOf(c), async (track) => {
      const pending = await insertPendingObject(client, {
        organisationId: orgId,
        domain: "message",
        ownerRecordId: conversationId,
        storage: storageOf(c),
        validated,
        uploadedBy: userId,
      });
      track(pending.storageKey);
      await attachMessageFile(client, actor, {
        conversationId,
        messageId,
        storedObjectId: pending.id,
        originalFilename: validated.originalFilename,
      });
      await putAndActivateObject(client, storageOf(c), scannerOf(c), {
        organisationId: orgId,
        objectId: pending.id,
        storageKey: pending.storageKey,
        bytes: uploaded.bytes,
        contentType: validated.storedContentType,
        filename: validated.originalFilename,
        actorUserId: userId,
        domain: "message",
      });
      return c.json(
        {
          attachment: {
            storedObjectId: pending.id,
            originalFilename: validated.originalFilename,
            downloadPath: `/api/v1/files/${pending.id}`,
          },
        },
        201,
      );
    });
  } catch (error) {
    throw storageErrorToAppError(error);
  }
}

export function registerMessagingRoutes(app: SchoolappApi) {
  app.get("/messages/unread-count", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      if (!hasAnyStaffMessagingAccess(actor) && !actor.permissions.has(PERMISSIONS.MESSAGING_READ_OWN_CHILDREN)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      return c.json({ unreadCount: await countUnreadMessages(client, actor) });
    }),
  );

  app.get("/messages/conversations", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      if (!hasAnyStaffMessagingAccess(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const listed = await listConversations(client, actor, {
        folder: c.req.query("folder") ?? "inbox",
        status: c.req.query("status") ?? undefined,
        q: c.req.query("q") ?? undefined,
        pupilId: c.req.query("pupilId") ?? undefined,
        cursor: c.req.query("cursor") ?? undefined,
        limit: Number(c.req.query("limit") ?? 30) || 30,
      });
      return c.json(listed);
    }),
  );

  app.post("/messages/conversations", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      const parsed = createSchema.safeParse((await c.req.json().catch(() => null)) ?? {});
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid conversation");
      const created = await createStaffConversation(client, actor, parsed.data);
      return c.json(created, 201);
    }),
  );

  app.get("/messages/conversations/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      return c.json(await loadConversationDetail(client, actor, uuidRouteParam(c, "id")));
    }),
  );

  app.get("/messages/conversations/:id/messages", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      return c.json(
        await listConversationMessages(client, actor, uuidRouteParam(c, "id"), {
          before: c.req.query("before") ?? undefined,
          limit: Number(c.req.query("limit") ?? 50) || 50,
        }),
      );
    }),
  );

  app.post("/messages/conversations/:id/messages", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      const parsed = sendSchema.safeParse((await c.req.json().catch(() => null)) ?? {});
      if (!parsed.success) throw new AppError(400, "validation_failed", "Message text is required");
      const sent = await sendConversationMessage(client, actor, uuidRouteParam(c, "id"), parsed.data.body);
      return c.json(sent, 201);
    }),
  );

  app.post("/messages/conversations/:id/read", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      return c.json(await markConversationRead(client, actor, uuidRouteParam(c, "id")));
    }),
  );

  app.post("/messages/conversations/:id/close", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      const body = (await c.req.json().catch(() => ({}))) as { restrictReplies?: boolean };
      return c.json(await closeConversation(client, actor, uuidRouteParam(c, "id"), Boolean(body.restrictReplies)));
    }),
  );

  app.post("/messages/conversations/:id/reopen", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      return c.json(await reopenConversation(client, actor, uuidRouteParam(c, "id")));
    }),
  );

  app.post("/messages/conversations/:id/archive", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      const body = (await c.req.json().catch(() => ({}))) as { archived?: boolean };
      return c.json(await archiveOwnConversation(client, actor, uuidRouteParam(c, "id"), body.archived !== false));
    }),
  );

  app.post("/messages/conversations/:id/messages/:messageId/redact", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      return c.json(
        await redactMessage(client, actor, uuidRouteParam(c, "id"), uuidRouteParam(c, "messageId")),
      );
    }),
  );

  app.post("/messages/conversations/:id/messages/:messageId/attachments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      return uploadConversationAttachment(c, client, actor, orgId, userId, uuidRouteParam(c, "id"), uuidRouteParam(c, "messageId"));
    }),
  );

  app.get("/messages/pupils/:studentId/recipients", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      return c.json(await listPupilMessageRecipients(client, actor, uuidRouteParam(c, "studentId")));
    }),
  );

  app.get("/students/:studentId/contact-history", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      return c.json(await listPupilContactHistory(client, actor, uuidRouteParam(c, "studentId")));
    }),
  );
}
