import type pg from "pg";
import { AppError } from "./errors.js";

export type InboxNotification = {
  id: string;
  type: string;
  category: string;
  title: string;
  body: string;
  actionTarget: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
};

export function mapNotification(row: Record<string, unknown>): InboxNotification {
  const actionTarget = row.action_target;
  return {
    id: String(row.id),
    type: String(row.type),
    category: String(row.category),
    title: String(row.title),
    body: String(row.body),
    actionTarget:
      actionTarget && typeof actionTarget === "object" && !Array.isArray(actionTarget)
        ? (actionTarget as Record<string, unknown>)
        : null,
    createdAt: String(row.created_at),
    readAt: row.read_at ? String(row.read_at) : null,
  };
}

export async function listInboxNotifications(
  client: pg.PoolClient,
  organisationId: string,
  recipientUserId: string,
  unreadOnly = false,
): Promise<InboxNotification[]> {
  const result = await client.query(
    `select id, type, category, title, body, action_target, created_at, read_at
     from notifications
     where organisation_id = $1
       and recipient_user_id = $2
       and ($3::boolean = false or read_at is null)
     order by created_at desc
     limit 100`,
    [organisationId, recipientUserId, unreadOnly],
  );
  return result.rows.map((row) => mapNotification(row as Record<string, unknown>));
}

export async function countUnreadNotifications(
  client: pg.PoolClient,
  organisationId: string,
  recipientUserId: string,
): Promise<number> {
  const result = await client.query<{ n: number }>(
    `select count(*)::int as n
     from notifications
     where organisation_id = $1
       and recipient_user_id = $2
       and read_at is null`,
    [organisationId, recipientUserId],
  );
  return result.rows[0]?.n ?? 0;
}

export async function markNotificationRead(
  client: pg.PoolClient,
  organisationId: string,
  recipientUserId: string,
  notificationId: string,
): Promise<InboxNotification> {
  const result = await client.query(
    `update notifications
     set read_at = coalesce(read_at, now())
     where id = $1
       and organisation_id = $2
       and recipient_user_id = $3
     returning id, type, category, title, body, action_target, created_at, read_at`,
    [notificationId, organisationId, recipientUserId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, "not_found", "Not found");
  }
  return mapNotification(row as Record<string, unknown>);
}
