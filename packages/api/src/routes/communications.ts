import { z } from "zod";
import type pg from "pg";
import type { Actor } from "@schoolapp/domain";
import {
  AppError,
  activateDueAnnouncements,
  activateDueEvents,
  assertAnyPermission,
  assertCanManageStaffAnnouncement,
  assertCanManageStaffEvent,
  assertCanReadStaffAnnouncement,
  assertCanReadStaffEvent,
  assertCanTargetCommunication,
  assignedClassIds,
  assignedStudentIds,
  auditCommunication,
  canManageAssignedAnnouncements,
  canManageAssignedCalendar,
  canManageSchoolCalendar,
  canPublishAnnouncements,
  canReadAnnouncementReceipts,
  canReadSchoolAnnouncements,
  canReadSchoolCalendar,
  eventDatesValid,
  isAllowedLearningUrl,
  ANNOUNCEMENT_MANAGE_PERMISSIONS,
  ANNOUNCEMENT_READ_PERMISSIONS,
  CALENDAR_MANAGE_PERMISSIONS,
  CALENDAR_READ_PERMISSIONS,
  loadAnnouncementReceiptSummary,
  notifyAnnouncementPublished,
  notifyEventUpcoming,
  snapshotAnnouncementRecipients,
  snapshotEventAudience,
  type CommunicationTargetInput,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import {
  mapAnnouncement,
  mapCommunicationResource,
  mapCommunicationTarget,
  mapSchoolEvent,
  mapSchoolEventType,
} from "../serialize";

const targetSchema = z.object({
  targetType: z.enum([
    "whole_school",
    "staff",
    "parents",
    "students",
    "year_group",
    "class",
    "student",
    "staff_member",
  ]),
  classId: z.string().uuid().optional(),
  yearGroupId: z.string().uuid().optional(),
  studentProfileId: z.string().uuid().optional(),
  staffUserId: z.string().uuid().optional(),
});

const resourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  resourceKind: z.enum(["pdf", "worksheet", "image", "url", "video", "document"]),
  url: z.string().max(2000).nullable().optional(),
});

const announcementBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  priority: z.enum(["normal", "important", "urgent"]).optional(),
  publishAt: z.string().datetime({ offset: true }).nullable().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  acknowledgementRequired: z.boolean().optional(),
  pinned: z.boolean().optional(),
  createdBy: z.string().uuid().optional(),
  publishedBy: z.string().uuid().optional(),
  targets: z.array(targetSchema).max(80).optional(),
  resources: z.array(resourceSchema).max(20).optional(),
});

const announcementPatchSchema = announcementBodySchema.partial();

const eventBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).nullable().optional(),
  eventTypeId: z.string().uuid().optional(),
  eventTypeKey: z.string().min(1).max(64).optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  allDay: z.boolean().optional(),
  location: z.string().max(200).nullable().optional(),
  publishAt: z.string().datetime({ offset: true }).nullable().optional(),
  relatedKind: z
    .enum(["none", "academic_year", "term", "class", "year_group", "assessment", "assignment", "admissions_open_day"])
    .optional(),
  relatedId: z.string().uuid().nullable().optional(),
  resourceUrl: z.string().max(2000).nullable().optional(),
  createdBy: z.string().uuid().optional(),
  publishedBy: z.string().uuid().optional(),
  targets: z.array(targetSchema).max(80).optional(),
  resources: z.array(resourceSchema).max(20).optional(),
});

const eventPatchSchema = eventBodySchema.partial();

const ANNOUNCEMENT_SELECT = `
  select
    a.id,
    a.title,
    a.body,
    a.priority,
    case
      when a.status = 'published' and a.expires_at is not null and a.expires_at <= now() then 'expired'
      else a.status
    end as effective_status,
    a.status,
    a.publish_at,
    a.published_at,
    a.expires_at,
    a.acknowledgement_required,
    a.pinned,
    a.created_by,
    creator.full_name as created_by_name,
    a.published_by,
    publisher.full_name as published_by_name,
    a.created_at
  from announcements a
  left join users creator on creator.id = a.created_by
  left join users publisher on publisher.id = a.published_by
`;

const EVENT_SELECT = `
  select
    e.id,
    e.title,
    e.description,
    e.event_type_id,
    et.key as event_type_key,
    et.name as event_type_name,
    e.starts_at,
    e.ends_at,
    e.all_day,
    e.location,
    e.status,
    e.publish_at,
    e.published_at,
    e.related_kind,
    e.related_id,
    e.resource_url,
    e.acknowledgement_required,
    e.created_by,
    creator.full_name as created_by_name,
    e.published_by
  from school_events e
  join school_event_types et on et.id = e.event_type_id
  left join users creator on creator.id = e.created_by
`;

async function insertTargets(
  client: pg.PoolClient,
  actor: Actor,
  orgId: string,
  parentColumn: "announcement_id" | "event_id",
  parentId: string,
  targets: Array<z.infer<typeof targetSchema>>,
  scope: "announcement" | "calendar",
): Promise<void> {
  for (const target of targets) {
    await assertCanTargetCommunication(client, actor, target as CommunicationTargetInput, { scope });
    await client.query(
      `insert into ${parentColumn === "announcement_id" ? "announcement_targets" : "school_event_targets"} (
         organisation_id, ${parentColumn}, target_type, class_id, year_group_id, student_profile_id, staff_user_id, created_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        orgId,
        parentId,
        target.targetType,
        target.classId ?? null,
        target.yearGroupId ?? null,
        target.studentProfileId ?? null,
        target.staffUserId ?? null,
        actor.userId,
      ],
    );
  }
}

async function insertResources(
  client: pg.PoolClient,
  actor: Actor,
  orgId: string,
  kind: "announcement" | "event",
  parentId: string,
  resources: Array<z.infer<typeof resourceSchema>>,
): Promise<void> {
  const table = kind === "announcement" ? "announcement_resources" : "school_event_resources";
  const parentCol = kind === "announcement" ? "announcement_id" : "event_id";
  for (const [index, resource] of resources.entries()) {
    if (resource.url && !isAllowedLearningUrl(resource.url)) {
      throw new AppError(400, "validation_failed", "Resource URL is not allowed");
    }
    if (!resource.url) {
      throw new AppError(400, "validation_failed", "A public URL is required until object storage is configured");
    }
    await client.query(
      `insert into ${table} (
         organisation_id, ${parentCol}, title, resource_kind, url, created_by, sort_order
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [orgId, parentId, resource.title, resource.resourceKind, resource.url, actor.userId, index],
    );
  }
}

async function loadAnnouncementRow(client: pg.PoolClient, orgId: string, announcementId: string) {
  const result = await client.query(`${ANNOUNCEMENT_SELECT} where a.id = $1 and a.organisation_id = $2`, [
    announcementId,
    orgId,
  ]);
  if (!result.rows[0]) throw new AppError(404, "not_found", "Not found");
  return result.rows[0] as Record<string, unknown>;
}

async function loadEventRow(client: pg.PoolClient, orgId: string, eventId: string) {
  const result = await client.query(`${EVENT_SELECT} where e.id = $1 and e.organisation_id = $2`, [eventId, orgId]);
  if (!result.rows[0]) throw new AppError(404, "not_found", "Not found");
  return result.rows[0] as Record<string, unknown>;
}

async function loadAnnouncementTargets(client: pg.PoolClient, orgId: string, announcementId: string) {
  const result = await client.query(
    `select t.id, t.target_type, t.class_id, c.name as class_name,
            t.year_group_id, yg.name as year_group_name,
            t.student_profile_id, sp.legal_name as student_legal_name,
            t.staff_user_id, u.full_name as staff_name
     from announcement_targets t
     left join classes c on c.id = t.class_id
     left join year_groups yg on yg.id = t.year_group_id
     left join student_profiles sp on sp.id = t.student_profile_id
     left join users u on u.id = t.staff_user_id
     where t.announcement_id = $1 and t.organisation_id = $2
     order by t.created_at`,
    [announcementId, orgId],
  );
  return result.rows.map((row) => mapCommunicationTarget(row as Record<string, unknown>));
}

async function loadEventTargets(client: pg.PoolClient, orgId: string, eventId: string) {
  const result = await client.query(
    `select t.id, t.target_type, t.class_id, c.name as class_name,
            t.year_group_id, yg.name as year_group_name,
            t.student_profile_id, sp.legal_name as student_legal_name,
            t.staff_user_id, u.full_name as staff_name
     from school_event_targets t
     left join classes c on c.id = t.class_id
     left join year_groups yg on yg.id = t.year_group_id
     left join student_profiles sp on sp.id = t.student_profile_id
     left join users u on u.id = t.staff_user_id
     where t.event_id = $1 and t.organisation_id = $2
     order by t.created_at`,
    [eventId, orgId],
  );
  return result.rows.map((row) => mapCommunicationTarget(row as Record<string, unknown>));
}

async function loadAnnouncementResources(client: pg.PoolClient, orgId: string, announcementId: string) {
  const result = await client.query(
    `select id, title, resource_kind, url, content_type, byte_size, storage_backend
     from announcement_resources
     where announcement_id = $1 and organisation_id = $2
     order by sort_order, created_at`,
    [announcementId, orgId],
  );
  return result.rows.map((row) => mapCommunicationResource(row as Record<string, unknown>));
}

async function loadEventResources(client: pg.PoolClient, orgId: string, eventId: string) {
  const result = await client.query(
    `select id, title, resource_kind, url, content_type, byte_size, storage_backend
     from school_event_resources
     where event_id = $1 and organisation_id = $2
     order by sort_order, created_at`,
    [eventId, orgId],
  );
  return result.rows.map((row) => mapCommunicationResource(row as Record<string, unknown>));
}

async function loadEventTypeId(
  client: pg.PoolClient,
  orgId: string,
  input: { eventTypeId?: string; eventTypeKey?: string },
): Promise<string> {
  if (input.eventTypeId) {
    const row = await client.query<{ id: string }>(
      "select id from school_event_types where id = $1 and organisation_id = $2",
      [input.eventTypeId, orgId],
    );
    if (!row.rows[0]) throw new AppError(404, "not_found", "Not found");
    return row.rows[0].id;
  }
  if (input.eventTypeKey) {
    const row = await client.query<{ id: string }>(
      "select id from school_event_types where organisation_id = $1 and key = $2",
      [orgId, input.eventTypeKey],
    );
    if (!row.rows[0]) throw new AppError(404, "not_found", "Not found");
    return row.rows[0].id;
  }
  throw new AppError(400, "validation_failed", "An event type is required");
}

function resolvePublishStatus(publishAt?: string | null): "draft" | "scheduled" | "published" {
  if (!publishAt) return "published";
  return new Date(publishAt).getTime() > Date.now() ? "scheduled" : "published";
}

export function registerCommunicationRoutes(app: SchoolappApi) {
  app.get("/announcements", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, ANNOUNCEMENT_READ_PERMISSIONS);
      await activateDueAnnouncements(client, orgId, userId);
      const status = c.req.query("status");
      const classIds = canReadSchoolAnnouncements(actor)
        ? null
        : [...(await assignedClassIds(client, userId, orgId))];
      const studentIds = canReadSchoolAnnouncements(actor)
        ? null
        : [...(await assignedStudentIds(client, userId, orgId))];
      const rows = await client.query(
        `${ANNOUNCEMENT_SELECT}
         where a.organisation_id = $1
           and ($2::text is null or a.status = $2 or (
             $2 = 'expired' and a.status = 'published' and a.expires_at is not null and a.expires_at <= now()
           ))
           and (
             $3::boolean = true
             or a.created_by = $4
             or exists (
               select 1 from announcement_recipients r
               where r.announcement_id = a.id and r.user_id = $4
             )
             or (
               a.status in ('published', 'expired')
               and exists (
                 select 1 from announcement_targets t
                 where t.announcement_id = a.id
                   and (
                     t.target_type in ('whole_school', 'staff')
                     or t.class_id = any($5::uuid[])
                     or t.student_profile_id = any($6::uuid[])
                   )
               )
             )
           )
         order by a.pinned desc, a.created_at desc`,
        [orgId, status || null, canReadSchoolAnnouncements(actor), userId, classIds, studentIds],
      );
      return c.json({
        announcements: rows.rows.map((row) => mapAnnouncement(row as Record<string, unknown>)),
      });
    }),
  );

  app.post("/announcements", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, ANNOUNCEMENT_MANAGE_PERMISSIONS);
      const parsed = announcementBodySchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid announcement");
      const created = await client.query<{ id: string }>(
        `insert into announcements (
           organisation_id, title, body, priority, publish_at, expires_at,
           acknowledgement_required, pinned, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning id`,
        [
          orgId,
          parsed.data.title,
          parsed.data.body,
          parsed.data.priority ?? "normal",
          parsed.data.publishAt ?? null,
          parsed.data.expiresAt ?? null,
          parsed.data.acknowledgementRequired ?? false,
          parsed.data.pinned ?? false,
          actor.userId,
        ],
      );
      const id = created.rows[0]!.id;
      if (parsed.data.targets?.length) {
        await insertTargets(client, actor, orgId, "announcement_id", id, parsed.data.targets, "announcement");
      }
      if (parsed.data.resources?.length) {
        await insertResources(client, actor, orgId, "announcement", id, parsed.data.resources);
      }
      await auditCommunication(client, {
        organisationId: orgId,
        actorUserId: actor.userId,
        action: "announcement.create",
        entityType: "announcement",
        entityId: id,
        after: { title: parsed.data.title },
      });
      const row = await loadAnnouncementRow(client, orgId, id);
      return c.json(
        {
          announcement: {
            ...mapAnnouncement(row),
            targets: await loadAnnouncementTargets(client, orgId, id),
            resources: await loadAnnouncementResources(client, orgId, id),
          },
        },
        201,
      );
    }),
  );

  app.get("/announcements/:announcementId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const announcementId = uuidRouteParam(c, "announcementId");
      await activateDueAnnouncements(client, orgId, userId);
      await assertCanReadStaffAnnouncement(client, actor, announcementId);
      const row = await loadAnnouncementRow(client, orgId, announcementId);
      const summary = await loadAnnouncementReceiptSummary(
        client,
        orgId,
        announcementId,
        Boolean(row.acknowledgement_required),
      );
      return c.json({
        announcement: {
          ...mapAnnouncement(row),
          targets: await loadAnnouncementTargets(client, orgId, announcementId),
          resources: await loadAnnouncementResources(client, orgId, announcementId),
          receipts: summary,
        },
      });
    }),
  );

  app.patch("/announcements/:announcementId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const announcementId = uuidRouteParam(c, "announcementId");
      const current = await assertCanManageStaffAnnouncement(client, actor, announcementId);
      if (current.status !== "draft" && current.status !== "scheduled") {
        throw new AppError(409, "invalid_status_transition", "Only draft or scheduled notices can be edited");
      }
      const parsed = announcementPatchSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid announcement");
      await client.query(
        `update announcements
         set title = coalesce($3, title),
             body = coalesce($4, body),
             priority = coalesce($5, priority),
             publish_at = case when $6 then $7::timestamptz else publish_at end,
             expires_at = case when $8 then $9::timestamptz else expires_at end,
             acknowledgement_required = coalesce($10, acknowledgement_required),
             pinned = coalesce($11, pinned)
         where id = $1 and organisation_id = $2`,
        [
          announcementId,
          orgId,
          parsed.data.title ?? null,
          parsed.data.body ?? null,
          parsed.data.priority ?? null,
          parsed.data.publishAt !== undefined,
          parsed.data.publishAt ?? null,
          parsed.data.expiresAt !== undefined,
          parsed.data.expiresAt ?? null,
          parsed.data.acknowledgementRequired ?? null,
          parsed.data.pinned ?? null,
        ],
      );
      if (parsed.data.targets) {
        await client.query("delete from announcement_targets where announcement_id = $1 and organisation_id = $2", [
          announcementId,
          orgId,
        ]);
        await insertTargets(client, actor, orgId, "announcement_id", announcementId, parsed.data.targets, "announcement");
      }
      if (parsed.data.resources) {
        await client.query("delete from announcement_resources where announcement_id = $1 and organisation_id = $2", [
          announcementId,
          orgId,
        ]);
        await insertResources(client, actor, orgId, "announcement", announcementId, parsed.data.resources);
      }
      const row = await loadAnnouncementRow(client, orgId, announcementId);
      return c.json({
        announcement: {
          ...mapAnnouncement(row),
          targets: await loadAnnouncementTargets(client, orgId, announcementId),
          resources: await loadAnnouncementResources(client, orgId, announcementId),
        },
      });
    }),
  );

  app.post("/announcements/:announcementId/publish", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const announcementId = uuidRouteParam(c, "announcementId");
      await assertCanManageStaffAnnouncement(client, actor, announcementId);
      if (!canPublishAnnouncements(actor) && !canManageAssignedAnnouncements(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const body = (await c.req.json().catch(() => ({}))) as { publishAt?: string | null };
      const publishAt = body.publishAt ?? null;
      const next = resolvePublishStatus(publishAt);
      const targets = await client.query("select 1 from announcement_targets where announcement_id = $1", [
        announcementId,
      ]);
      if (targets.rowCount === 0) {
        throw new AppError(400, "validation_failed", "At least one audience target is required");
      }
      await client.query(
        `update announcements
         set status = $3, publish_at = coalesce($4::timestamptz, publish_at, now())
         where id = $1 and organisation_id = $2`,
        [announcementId, orgId, next, publishAt],
      );
      if (next === "published") {
        await snapshotAnnouncementRecipients(client, orgId, announcementId);
        const row = await loadAnnouncementRow(client, orgId, announcementId);
        await notifyAnnouncementPublished(client, {
          organisationId: orgId,
          actorUserId: actor.userId,
          announcementId,
          title: String(row.title),
          priority: String(row.priority),
          acknowledgementRequired: Boolean(row.acknowledgement_required),
        });
      }
      await auditCommunication(client, {
        organisationId: orgId,
        actorUserId: actor.userId,
        action: next === "scheduled" ? "announcement.schedule" : "announcement.publish",
        entityType: "announcement",
        entityId: announcementId,
      });
      const row = await loadAnnouncementRow(client, orgId, announcementId);
      return c.json({
        announcement: {
          ...mapAnnouncement(row),
          targets: await loadAnnouncementTargets(client, orgId, announcementId),
          receipts: await loadAnnouncementReceiptSummary(
            client,
            orgId,
            announcementId,
            Boolean(row.acknowledgement_required),
          ),
        },
      });
    }),
  );

  app.post("/announcements/:announcementId/archive", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const announcementId = uuidRouteParam(c, "announcementId");
      await assertCanManageStaffAnnouncement(client, actor, announcementId);
      await client.query(`update announcements set status = 'archived' where id = $1 and organisation_id = $2`, [
        announcementId,
        orgId,
      ]);
      await auditCommunication(client, {
        organisationId: orgId,
        actorUserId: actor.userId,
        action: "announcement.archive",
        entityType: "announcement",
        entityId: announcementId,
      });
      return c.json({ announcement: mapAnnouncement(await loadAnnouncementRow(client, orgId, announcementId)) });
    }),
  );

  app.get("/announcements/:announcementId/receipts", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const announcementId = uuidRouteParam(c, "announcementId");
      const current = await assertCanReadStaffAnnouncement(client, actor, announcementId);
      if (!canReadAnnouncementReceipts(actor) && current.created_by !== actor.userId) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const row = await loadAnnouncementRow(client, orgId, announcementId);
      const summary = await loadAnnouncementReceiptSummary(
        client,
        orgId,
        announcementId,
        Boolean(row.acknowledgement_required),
      );
      const recipients = await client.query(
        `select r.user_id, u.full_name, r.audience_role, r.delivered_at, r.read_at, r.acknowledged_at
         from announcement_recipients r
         join users u on u.id = r.user_id
         where r.announcement_id = $1 and r.organisation_id = $2
         order by u.full_name`,
        [announcementId, orgId],
      );
      return c.json({
        totals: summary,
        recipients: recipients.rows.map((item) => ({
          userId: item.user_id,
          name: item.full_name,
          audienceRole: item.audience_role,
          deliveredAt: item.delivered_at,
          readAt: item.read_at,
          acknowledgedAt: item.acknowledged_at,
        })),
      });
    }),
  );

  app.post("/announcements/:announcementId/read", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const announcementId = uuidRouteParam(c, "announcementId");
      await assertCanReadStaffAnnouncement(client, actor, announcementId);
      const updated = await client.query(
        `update announcement_recipients
         set read_at = coalesce(read_at, now())
         where announcement_id = $1 and organisation_id = $2 and user_id = $3
         returning read_at, acknowledged_at`,
        [announcementId, orgId, userId],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      return c.json({
        readAt: updated.rows[0].read_at,
        acknowledgedAt: updated.rows[0].acknowledged_at,
      });
    }),
  );

  app.post("/announcements/:announcementId/acknowledge", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const announcementId = uuidRouteParam(c, "announcementId");
      await assertCanReadStaffAnnouncement(client, actor, announcementId);
      const updated = await client.query(
        `update announcement_recipients
         set acknowledged_at = coalesce(acknowledged_at, now()),
             read_at = coalesce(read_at, now())
         where announcement_id = $1 and organisation_id = $2 and user_id = $3
         returning read_at, acknowledged_at`,
        [announcementId, orgId, userId],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      return c.json({
        readAt: updated.rows[0].read_at,
        acknowledgedAt: updated.rows[0].acknowledged_at,
      });
    }),
  );

  app.get("/calendar/event-types", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, CALENDAR_READ_PERMISSIONS);
      const rows = await client.query(
        `select id, key, name, sort_order, is_system
         from school_event_types
         where organisation_id = $1
         order by sort_order, name`,
        [orgId],
      );
      return c.json({ eventTypes: rows.rows.map((row) => mapSchoolEventType(row as Record<string, unknown>)) });
    }),
  );

  app.get("/calendar/events", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, CALENDAR_READ_PERMISSIONS);
      await activateDueEvents(client, orgId, userId);
      const from = c.req.query("from");
      const to = c.req.query("to");
      const mine = c.req.query("mine") === "true";
      const classIds = canReadSchoolCalendar(actor) ? null : [...(await assignedClassIds(client, userId, orgId))];
      const studentIds = canReadSchoolCalendar(actor)
        ? null
        : [...(await assignedStudentIds(client, userId, orgId))];
      const rows = await client.query(
        `${EVENT_SELECT}
         where e.organisation_id = $1
           and ($2::timestamptz is null or e.ends_at >= $2::timestamptz)
           and ($3::timestamptz is null or e.starts_at <= $3::timestamptz)
           and (
             $4::boolean = true
             or e.created_by = $5
             or exists (
               select 1 from school_event_audience au
               where au.event_id = e.id and au.user_id = $5
             )
             or (
               e.status = 'published'
               and exists (
                 select 1 from school_event_targets t
                 where t.event_id = e.id
                   and (
                     t.target_type in ('whole_school', 'staff')
                     or t.class_id = any($6::uuid[])
                     or t.student_profile_id = any($7::uuid[])
                   )
               )
             )
           )
           and ($8::boolean = false or exists (
             select 1 from school_event_audience au
             where au.event_id = e.id and au.user_id = $5
           ) or e.created_by = $5)
         order by e.starts_at, e.title`,
        [
          orgId,
          from || null,
          to || null,
          canReadSchoolCalendar(actor) && !mine,
          userId,
          classIds,
          studentIds,
          mine,
        ],
      );
      return c.json({
        events: rows.rows.map((row) => mapSchoolEvent(row as Record<string, unknown>)),
      });
    }),
  );

  app.post("/calendar/events", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, CALENDAR_MANAGE_PERMISSIONS);
      const parsed = eventBodySchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid event");
      if (!eventDatesValid(parsed.data.startsAt, parsed.data.endsAt)) {
        throw new AppError(400, "validation_failed", "Event end must be on or after the start");
      }
      if (parsed.data.resourceUrl && !isAllowedLearningUrl(parsed.data.resourceUrl)) {
        throw new AppError(400, "validation_failed", "Resource URL is not allowed");
      }
      const eventTypeId = await loadEventTypeId(client, orgId, parsed.data);
      const created = await client.query<{ id: string }>(
        `insert into school_events (
           organisation_id, title, description, event_type_id, starts_at, ends_at, all_day,
           location, publish_at, related_kind, related_id, resource_url, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         returning id`,
        [
          orgId,
          parsed.data.title,
          parsed.data.description ?? null,
          eventTypeId,
          parsed.data.startsAt,
          parsed.data.endsAt,
          parsed.data.allDay ?? false,
          parsed.data.location ?? null,
          parsed.data.publishAt ?? null,
          parsed.data.relatedKind ?? "none",
          parsed.data.relatedId ?? null,
          parsed.data.resourceUrl ?? null,
          actor.userId,
        ],
      );
      const id = created.rows[0]!.id;
      if (parsed.data.targets?.length) {
        await insertTargets(client, actor, orgId, "event_id", id, parsed.data.targets, "calendar");
      }
      if (parsed.data.resources?.length) {
        await insertResources(client, actor, orgId, "event", id, parsed.data.resources);
      }
      await auditCommunication(client, {
        organisationId: orgId,
        actorUserId: actor.userId,
        action: "calendar.event.create",
        entityType: "school_event",
        entityId: id,
        after: { title: parsed.data.title },
      });
      return c.json(
        {
          event: {
            ...mapSchoolEvent(await loadEventRow(client, orgId, id)),
            targets: await loadEventTargets(client, orgId, id),
            resources: await loadEventResources(client, orgId, id),
          },
        },
        201,
      );
    }),
  );

  app.get("/calendar/events/:eventId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const eventId = uuidRouteParam(c, "eventId");
      await activateDueEvents(client, orgId, userId);
      await assertCanReadStaffEvent(client, actor, eventId);
      return c.json({
        event: {
          ...mapSchoolEvent(await loadEventRow(client, orgId, eventId)),
          targets: await loadEventTargets(client, orgId, eventId),
          resources: await loadEventResources(client, orgId, eventId),
        },
      });
    }),
  );

  app.patch("/calendar/events/:eventId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const eventId = uuidRouteParam(c, "eventId");
      const current = await assertCanManageStaffEvent(client, actor, eventId);
      if (current.status !== "draft" && current.status !== "scheduled") {
        throw new AppError(409, "invalid_status_transition", "Only draft or scheduled events can be edited");
      }
      const parsed = eventPatchSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid event");
      let eventTypeId: string | null = null;
      if (parsed.data.eventTypeId || parsed.data.eventTypeKey) {
        eventTypeId = await loadEventTypeId(client, orgId, parsed.data);
      }
      if (parsed.data.startsAt && parsed.data.endsAt && !eventDatesValid(parsed.data.startsAt, parsed.data.endsAt)) {
        throw new AppError(400, "validation_failed", "Event end must be on or after the start");
      }
      if (parsed.data.resourceUrl && !isAllowedLearningUrl(parsed.data.resourceUrl)) {
        throw new AppError(400, "validation_failed", "Resource URL is not allowed");
      }
      await client.query(
        `update school_events
         set title = coalesce($3, title),
             description = case when $4 then $5 else description end,
             event_type_id = coalesce($6::uuid, event_type_id),
             starts_at = coalesce($7::timestamptz, starts_at),
             ends_at = coalesce($8::timestamptz, ends_at),
             all_day = coalesce($9, all_day),
             location = case when $10 then $11 else location end,
             publish_at = case when $12 then $13::timestamptz else publish_at end,
             related_kind = coalesce($14, related_kind),
             related_id = case when $15 then $16::uuid else related_id end,
             resource_url = case when $17 then $18 else resource_url end
         where id = $1 and organisation_id = $2`,
        [
          eventId,
          orgId,
          parsed.data.title ?? null,
          parsed.data.description !== undefined,
          parsed.data.description ?? null,
          eventTypeId,
          parsed.data.startsAt ?? null,
          parsed.data.endsAt ?? null,
          parsed.data.allDay ?? null,
          parsed.data.location !== undefined,
          parsed.data.location ?? null,
          parsed.data.publishAt !== undefined,
          parsed.data.publishAt ?? null,
          parsed.data.relatedKind ?? null,
          parsed.data.relatedId !== undefined,
          parsed.data.relatedId ?? null,
          parsed.data.resourceUrl !== undefined,
          parsed.data.resourceUrl ?? null,
        ],
      );
      if (parsed.data.targets) {
        await client.query("delete from school_event_targets where event_id = $1 and organisation_id = $2", [
          eventId,
          orgId,
        ]);
        await insertTargets(client, actor, orgId, "event_id", eventId, parsed.data.targets, "calendar");
      }
      if (parsed.data.resources) {
        await client.query("delete from school_event_resources where event_id = $1 and organisation_id = $2", [
          eventId,
          orgId,
        ]);
        await insertResources(client, actor, orgId, "event", eventId, parsed.data.resources);
      }
      return c.json({
        event: {
          ...mapSchoolEvent(await loadEventRow(client, orgId, eventId)),
          targets: await loadEventTargets(client, orgId, eventId),
          resources: await loadEventResources(client, orgId, eventId),
        },
      });
    }),
  );

  app.post("/calendar/events/:eventId/publish", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const eventId = uuidRouteParam(c, "eventId");
      await assertCanManageStaffEvent(client, actor, eventId);
      if (!canManageSchoolCalendar(actor) && !canManageAssignedCalendar(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const body = (await c.req.json().catch(() => ({}))) as { publishAt?: string | null };
      const publishAt = body.publishAt ?? null;
      const next = resolvePublishStatus(publishAt);
      const targets = await client.query("select 1 from school_event_targets where event_id = $1", [eventId]);
      if (targets.rowCount === 0) {
        throw new AppError(400, "validation_failed", "At least one audience target is required");
      }
      await client.query(
        `update school_events
         set status = $3, publish_at = coalesce($4::timestamptz, publish_at, now())
         where id = $1 and organisation_id = $2`,
        [eventId, orgId, next, publishAt],
      );
      if (next === "published") {
        await snapshotEventAudience(client, orgId, eventId);
        const row = await loadEventRow(client, orgId, eventId);
        await notifyEventUpcoming(client, {
          organisationId: orgId,
          actorUserId: actor.userId,
          eventId,
          title: String(row.title),
          startsAt: String(row.starts_at),
        });
      }
      await auditCommunication(client, {
        organisationId: orgId,
        actorUserId: actor.userId,
        action: next === "scheduled" ? "calendar.event.schedule" : "calendar.event.publish",
        entityType: "school_event",
        entityId: eventId,
      });
      return c.json({
        event: {
          ...mapSchoolEvent(await loadEventRow(client, orgId, eventId)),
          targets: await loadEventTargets(client, orgId, eventId),
        },
      });
    }),
  );

  app.post("/calendar/events/:eventId/archive", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const eventId = uuidRouteParam(c, "eventId");
      await assertCanManageStaffEvent(client, actor, eventId);
      await client.query(`update school_events set status = 'archived' where id = $1 and organisation_id = $2`, [
        eventId,
        orgId,
      ]);
      return c.json({ event: mapSchoolEvent(await loadEventRow(client, orgId, eventId)) });
    }),
  );
}
