import type pg from "pg";
import type { Actor } from "@schoolapp/domain";
import { PERMISSIONS, actorHas, actorHasAny } from "@schoolapp/domain";
import { writeAudit } from "./academic.js";
import { createInboxNotification } from "./admissions.js";
import { AppError } from "./errors.js";
import { notFound } from "./permissions.js";
import { MemoryRateLimiter } from "./public-forms-security.js";
import { assignedStudentIds, guardianChildIds } from "./students-access.js";
import { requireStaffUserInOrganisation } from "./behaviour-access.js";
import {
  PARENT_FACING_CONVERSATION_TYPES,
  conversationAllowsReplies,
  displayMessageBody,
  isMessageConversationType,
  isMessageParentContactPoint,
  isMessageRelatedDomain,
  messagePreview,
  messagingNotificationBody,
  relatedDomainLabel,
  sanitizeMessageBody,
  sanitizeMessageSubject,
  MESSAGE_BODY_MAX,
  MESSAGE_REDACTED_BODY,
} from "./messaging.js";

export const messagingRateLimiter = new MemoryRateLimiter();

export const MESSAGING_STAFF_READ_PERMISSIONS = [
  PERMISSIONS.MESSAGING_READ,
  PERMISSIONS.MESSAGING_READ_ASSIGNED,
  PERMISSIONS.MESSAGING_MANAGE,
  PERMISSIONS.MESSAGING_ADMISSIONS,
  PERMISSIONS.MESSAGING_STAFF_INTERNAL,
] as const;

export function canReadSchoolMessaging(actor: Actor): boolean {
  return actorHas(actor, PERMISSIONS.MESSAGING_READ) || actorHas(actor, PERMISSIONS.MESSAGING_MANAGE);
}

export function canManageMessaging(actor: Actor): boolean {
  return actorHas(actor, PERMISSIONS.MESSAGING_MANAGE);
}

export function canModerateMessaging(actor: Actor): boolean {
  return actorHas(actor, PERMISSIONS.MESSAGING_MODERATE);
}

export function canCreateSchoolMessaging(actor: Actor): boolean {
  return actorHas(actor, PERMISSIONS.MESSAGING_CREATE);
}

export function canCreateAssignedMessaging(actor: Actor): boolean {
  return actorHas(actor, PERMISSIONS.MESSAGING_CREATE_ASSIGNED);
}

export function canUseStaffInternal(actor: Actor): boolean {
  return actorHas(actor, PERMISSIONS.MESSAGING_STAFF_INTERNAL);
}

export function canUseAdmissionsMessaging(actor: Actor): boolean {
  return actorHas(actor, PERMISSIONS.MESSAGING_ADMISSIONS) || canManageMessaging(actor);
}

export function hasAnyStaffMessagingAccess(actor: Actor): boolean {
  return actorHasAny(actor, MESSAGING_STAFF_READ_PERMISSIONS) ||
    actorHas(actor, PERMISSIONS.MESSAGING_CREATE) ||
    actorHas(actor, PERMISSIONS.MESSAGING_CREATE_ASSIGNED);
}

function throwMessaging(code: string, message: string, status = 400): never {
  throw new AppError(status, code, message);
}

function rateLimitFor(kind: "create" | "send" | "upload", isStaff: boolean): number {
  const test = process.env.VITEST === "true";
  const base = test
    ? { create: 8, send: 15, upload: 6 }
    : { create: 40, send: 80, upload: 20 };
  return isStaff ? base[kind] * 2 : base[kind];
}

export function assertMessagingRateLimit(input: {
  organisationId: string;
  userId: string;
  kind: "create" | "send" | "upload";
  isStaff: boolean;
}): void {
  const limit = rateLimitFor(input.kind, input.isStaff);
  const decision = messagingRateLimiter.consume(
    `messaging:${input.kind}:${input.organisationId}:${input.userId}`,
    limit,
    60 * 60 * 1000,
  );
  if (!decision.allowed) {
    throw new AppError(429, "rate_limited", "Too many messages. Please try again later.", {
      retryAfterSeconds: decision.retryAfterSeconds,
    });
  }
}

async function schoolName(client: pg.PoolClient, organisationId: string): Promise<string> {
  const row = await client.query<{ name: string }>(
    "select name from organisations where id = $1",
    [organisationId],
  );
  return row.rows[0]?.name ?? "your school";
}

export async function auditMessaging(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    action: string;
    entityId: string;
    after?: Record<string, unknown>;
  },
): Promise<void> {
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: "message_conversation",
    entityId: input.entityId,
    after: input.after,
  });
}

type ConversationRow = {
  id: string;
  organisation_id: string;
  reference: string;
  conversation_type: string;
  subject: string;
  related_pupil_id: string | null;
  related_domain: string;
  related_record_id: string | null;
  status: string;
  replies_restricted: boolean;
  created_by: string;
  created_at: Date | string;
  last_message_at: Date | string;
  last_message_id: string | null;
  last_message_preview: string;
  closed_at: Date | string | null;
  closed_by: string | null;
  pupil_legal_name?: string | null;
  pupil_preferred_name?: string | null;
};

type ParticipantRow = {
  id: string;
  user_id: string;
  participant_kind: string;
  added_at: Date | string;
  left_at: Date | string | null;
  archived_at: Date | string | null;
  last_read_at: Date | string | null;
  full_name?: string | null;
};

export type ConversationAccess = {
  canRead: boolean;
  canReply: boolean;
  canManage: boolean;
  canModerate: boolean;
  participant: ParticipantRow | null;
};

function encodeCursor(at: string | Date, id: string): string {
  const value = at instanceof Date ? at.toISOString() : String(at);
  return Buffer.from(`${value}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const idx = raw.lastIndexOf("|");
    if (idx <= 0) return null;
    return { at: raw.slice(0, idx), id: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}

async function loadParticipant(
  client: pg.PoolClient,
  organisationId: string,
  conversationId: string,
  userId: string,
): Promise<ParticipantRow | null> {
  const row = await client.query<ParticipantRow>(
    `select p.id, p.user_id, p.participant_kind, p.added_at, p.left_at, p.archived_at, p.last_read_at,
            u.full_name
     from message_participants p
     join users u on u.id = p.user_id
     where p.organisation_id = $1 and p.conversation_id = $2 and p.user_id = $3`,
    [organisationId, conversationId, userId],
  );
  return row.rows[0] ?? null;
}

async function activeMembershipKind(
  client: pg.PoolClient,
  organisationId: string,
  userId: string,
): Promise<"staff" | "parent" | null> {
  const row = await client.query<{ user_kind: string }>(
    `select u.user_kind
     from organisation_memberships m
     join users u on u.id = m.user_id
     where m.organisation_id = $1
       and m.user_id = $2
       and m.status = 'active'
       and m.ended_at is null
       and u.status = 'active'`,
    [organisationId, userId],
  );
  const kind = row.rows[0]?.user_kind;
  if (kind === "staff" || kind === "parent") return kind;
  return null;
}

export async function evaluateConversationAccess(
  client: pg.PoolClient,
  actor: Actor,
  conversation: ConversationRow,
): Promise<ConversationAccess> {
  const participant = await loadParticipant(client, conversation.organisation_id, conversation.id, actor.userId);
  const activeParticipant = participant && !participant.left_at ? participant : null;
  const manage = canManageMessaging(actor);
  const moderate = canModerateMessaging(actor);
  let canRead = false;

  if (actor.userKind === "parent") {
    if (
      actorHas(actor, PERMISSIONS.MESSAGING_READ_OWN_CHILDREN) &&
      activeParticipant &&
      conversation.conversation_type !== "staff_internal"
    ) {
      if (!conversation.related_pupil_id) {
        canRead = true;
      } else {
        const children = await guardianChildIds(client, actor.userId, conversation.organisation_id);
        canRead = children.has(conversation.related_pupil_id);
      }
    }
  } else {
    if (conversation.conversation_type === "staff_internal") {
      canRead = Boolean(
        canUseStaffInternal(actor) && (activeParticipant || manage),
      );
    } else if (conversation.conversation_type === "admissions") {
      canRead = Boolean(canUseAdmissionsMessaging(actor) || activeParticipant);
    } else if (canReadSchoolMessaging(actor)) {
      canRead = true;
    } else if (activeParticipant) {
      canRead = true;
    }
  }

  const canReply =
    canRead &&
    conversationAllowsReplies({
      status: conversation.status,
      repliesRestricted: conversation.replies_restricted,
    }) &&
    (actor.userKind === "parent"
      ? Boolean(actorHas(actor, PERMISSIONS.MESSAGING_REPLY_OWN) && activeParticipant)
      : Boolean(activeParticipant || manage || canCreateSchoolMessaging(actor) || canUseAdmissionsMessaging(actor)));

  return {
    canRead,
    canReply,
    canManage: canRead && manage,
    canModerate: canRead && moderate,
    participant: activeParticipant,
  };
}

export async function requireConversationAccess(
  client: pg.PoolClient,
  actor: Actor,
  conversation: ConversationRow,
  mode: "read" | "reply" | "manage" | "moderate" = "read",
): Promise<ConversationAccess> {
  const access = await evaluateConversationAccess(client, actor, conversation);
  if (!access.canRead) notFound();
  if (mode === "reply" && !access.canReply) {
    if (conversation.status !== "open" || conversation.replies_restricted) {
      throwMessaging("conversation_closed", "This conversation is closed", 409);
    }
    notFound();
  }
  if (mode === "manage" && !access.canManage) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
  if (mode === "moderate" && !access.canModerate) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
  return access;
}

export async function loadConversationRow(
  client: pg.PoolClient,
  organisationId: string,
  conversationId: string,
  forUpdate = false,
): Promise<ConversationRow> {
  const row = await client.query<ConversationRow>(
    `select c.*, sp.legal_name as pupil_legal_name, u.preferred_name as pupil_preferred_name
     from message_conversations c
     left join student_profiles sp on sp.id = c.related_pupil_id
     left join users u on u.id = sp.user_id
     where c.id = $1 and c.organisation_id = $2
     ${forUpdate ? "for update of c" : ""}`,
    [conversationId, organisationId],
  );
  if (!row.rows[0]) notFound();
  return row.rows[0];
}

export async function assertCanAccessMessageAttachment(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  storedObjectId: string,
): Promise<void> {
  const row = await client.query<{ conversation_id: string }>(
    `select conversation_id
     from message_attachments
     where stored_object_id = $1 and organisation_id = $2`,
    [storedObjectId, organisationId],
  );
  if (!row.rows[0]) notFound();
  const conversation = await loadConversationRow(client, organisationId, row.rows[0].conversation_id);
  await requireConversationAccess(client, actor, conversation, "read");
}

async function insertParticipant(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    conversationId: string;
    userId: string;
    kind: "staff" | "parent";
    addedBy: string;
  },
): Promise<void> {
  await client.query(
    `insert into message_participants (
       organisation_id, conversation_id, user_id, participant_kind, added_by
     ) values ($1, $2, $3, $4, $5)
     on conflict (conversation_id, user_id) do nothing`,
    [input.organisationId, input.conversationId, input.userId, input.kind, input.addedBy],
  );
}

async function ensureParentGuardian(
  client: pg.PoolClient,
  organisationId: string,
  pupilId: string,
  parentUserId: string,
): Promise<void> {
  const children = await guardianChildIds(client, parentUserId, organisationId);
  if (!children.has(pupilId)) {
    throwMessaging("recipient_unavailable", "Recipient is not available");
  }
  const membership = await activeMembershipKind(client, organisationId, parentUserId);
  if (membership !== "parent") {
    throwMessaging("recipient_unavailable", "Recipient is not available");
  }
}

async function assertPupilInOrganisation(
  client: pg.PoolClient,
  organisationId: string,
  pupilId: string,
): Promise<void> {
  const row = await client.query(
    "select 1 from student_profiles where id = $1 and organisation_id = $2",
    [pupilId, organisationId],
  );
  if (!row.rows[0]) notFound();
}

async function assertRelatedRecord(
  client: pg.PoolClient,
  organisationId: string,
  domain: string,
  recordId: string | null,
): Promise<void> {
  if (domain === "none") return;
  if (!recordId) throwMessaging("validation_failed", "Related context is not allowed");
  let sql = "";
  if (domain === "admissions_application") {
    sql = "select 1 from admissions_applications where id = $1 and organisation_id = $2";
  } else if (domain === "school_charge") {
    sql = "select 1 from school_charges where id = $1 and organisation_id = $2";
  } else if (domain === "school_activity") {
    sql = "select 1 from school_activities where id = $1 and organisation_id = $2";
  } else if (domain === "learning_assignment") {
    sql = "select 1 from learning_assignments where id = $1 and organisation_id = $2";
  } else if (domain === "attendance") {
    return;
  } else {
    throwMessaging("validation_failed", "Related context is not allowed");
  }
  const row = await client.query(sql, [recordId, organisationId]);
  if (!row.rows[0]) notFound();
}

async function requireCurrentlyAssigned(
  client: pg.PoolClient,
  actor: Actor,
  pupilId: string,
): Promise<void> {
  if (canCreateSchoolMessaging(actor) || canManageMessaging(actor)) return;
  if (!canCreateAssignedMessaging(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
  const assigned = await assignedStudentIds(client, actor.userId, actor.organisationId!);
  if (!assigned.has(pupilId)) {
    notFound();
  }
}

export async function listAssignedClassTeachers(
  client: pg.PoolClient,
  organisationId: string,
  pupilId: string,
): Promise<Array<{ userId: string; fullName: string; jobTitle: string | null; assignmentRole: string }>> {
  const result = await client.query<{
    user_id: string;
    full_name: string;
    job_title: string | null;
    assignment_role: string;
  }>(
    `select distinct u.id as user_id, u.full_name, sp.job_title, csa.assignment_role
     from class_memberships cm
     join academic_years ay on ay.id = cm.academic_year_id and ay.organisation_id = cm.organisation_id
     join class_staff_assignments csa
       on csa.class_id = cm.class_id
      and csa.organisation_id = cm.organisation_id
      and (csa.ended_on is null or csa.ended_on >= current_date)
     join staff_profiles sp on sp.id = csa.staff_profile_id
     join users u on u.id = sp.user_id
     join organisation_memberships m
       on m.user_id = u.id and m.organisation_id = cm.organisation_id
      and m.status = 'active' and m.ended_at is null
     where cm.student_profile_id = $1
       and cm.organisation_id = $2
       and (cm.ended_on is null or cm.ended_on >= current_date)
       and ay.is_current
       and csa.assignment_role in ('form_tutor', 'co_tutor', 'subject_teacher')
       and u.status = 'active'
       and u.user_kind = 'staff'`,
    [pupilId, organisationId],
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    fullName: row.full_name,
    jobTitle: row.job_title,
    assignmentRole: row.assignment_role,
  }));
}

export async function listParentContactPoints(
  client: pg.PoolClient,
  actor: Actor,
  studentId: string,
) {
  if (!actorHas(actor, PERMISSIONS.MESSAGING_READ_OWN_CHILDREN)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
  const children = await guardianChildIds(client, actor.userId, actor.organisationId!);
  if (!children.has(studentId)) notFound();
  const teachers = await listAssignedClassTeachers(client, actor.organisationId!, studentId);
  const formTutors = teachers.filter((row) => row.assignmentRole === "form_tutor" || row.assignmentRole === "co_tutor");
  return {
    studentId,
    contacts: [
      {
        contactPoint: "class_teacher" as const,
        available: teachers.length > 0,
        teachers: (formTutors.length > 0 ? formTutors : teachers).map((row) => ({
          userId: row.userId,
          fullName: row.fullName,
          jobTitle: row.jobTitle,
        })),
      },
      { contactPoint: "school_office" as const, available: true, teachers: [] },
      { contactPoint: "admissions" as const, available: true, teachers: [] },
    ],
  };
}

export async function listPupilMessageRecipients(
  client: pg.PoolClient,
  actor: Actor,
  studentId: string,
) {
  if (!hasAnyStaffMessagingAccess(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
  await assertPupilInOrganisation(client, actor.organisationId!, studentId);
  if (!canReadSchoolMessaging(actor) && !canCreateSchoolMessaging(actor) && !canUseAdmissionsMessaging(actor)) {
    const assigned = await assignedStudentIds(client, actor.userId, actor.organisationId!);
    if (!assigned.has(studentId)) notFound();
  }
  const result = await client.query<{ user_id: string; full_name: string; relationship: string }>(
    `select u.id as user_id, u.full_name, g.relationship
     from guardianships g
     join users u on u.id = g.guardian_user_id
     join organisation_memberships m
       on m.user_id = u.id and m.organisation_id = g.organisation_id
      and m.status = 'active' and m.ended_at is null
     where g.student_profile_id = $1
       and g.organisation_id = $2
       and g.portal_access = true
       and (g.ended_on is null or g.ended_on >= current_date)
       and u.status = 'active'`,
    [studentId, actor.organisationId],
  );
  return {
    studentId,
    parents: result.rows.map((row) => ({
      userId: row.user_id,
      fullName: row.full_name,
      relationship: row.relationship,
    })),
  };
}

function visibilitySql(actor: Actor): string {
  if (actor.userKind === "parent") {
    return `
      exists (
        select 1 from message_participants p
        where p.conversation_id = c.id
          and p.user_id = $2
          and p.left_at is null
      )
      and c.conversation_type <> 'staff_internal'
      and (
        c.related_pupil_id is null
        or c.related_pupil_id = any($3::uuid[])
      )
    `;
  }
  const schoolWide = canReadSchoolMessaging(actor);
  const admissions = canUseAdmissionsMessaging(actor);
  const staffInternal = canUseStaffInternal(actor);
  const manage = canManageMessaging(actor);
  return `
    (
      exists (
        select 1 from message_participants p
        where p.conversation_id = c.id
          and p.user_id = $2
          and p.left_at is null
      )
      or (
        ${schoolWide ? "true" : "false"}
        and c.conversation_type in ('parent_teacher', 'parent_school')
      )
      or (
        ${admissions ? "true" : "false"}
        and c.conversation_type = 'admissions'
      )
      or (
        ${staffInternal && manage ? "true" : "false"}
        and c.conversation_type = 'staff_internal'
      )
    )
    and (
      c.conversation_type <> 'staff_internal'
      or ${staffInternal ? "true" : "false"}
    )
    and cardinality($3::uuid[]) >= 0
  `;
}

export async function listConversations(
  client: pg.PoolClient,
  actor: Actor,
  input: {
    folder?: string;
    status?: string;
    q?: string;
    pupilId?: string;
    cursor?: string;
    limit?: number;
  },
) {
  const orgId = actor.organisationId!;
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 50);
  const children =
    actor.userKind === "parent" ? [...(await guardianChildIds(client, actor.userId, orgId))] : [];
  const vis = visibilitySql(actor);
  const params: unknown[] = [orgId, actor.userId, children];
  const where: string[] = ["c.organisation_id = $1", vis];

  if (input.pupilId) {
    params.push(input.pupilId);
    where.push(`c.related_pupil_id = $${params.length}`);
    if (actor.userKind === "parent" && !children.includes(input.pupilId)) notFound();
  }
  if (input.status && ["open", "closed", "archived"].includes(input.status)) {
    params.push(input.status);
    where.push(`c.status = $${params.length}`);
  }
  if (input.folder === "archived") {
    where.push(`exists (
      select 1 from message_participants p
      where p.conversation_id = c.id and p.user_id = $2 and p.archived_at is not null and p.left_at is null
    )`);
  } else if (input.folder !== "all") {
    where.push(`not exists (
      select 1 from message_participants p
      where p.conversation_id = c.id and p.user_id = $2 and p.archived_at is not null and p.left_at is null
    )`);
  }
  const q = sanitizeMessageSubject(input.q ?? "").toLowerCase();
  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    where.push(`(
      lower(c.subject) like $${idx}
      or lower(coalesce(sp.legal_name, '')) like $${idx}
      or lower(coalesce(u.preferred_name, '')) like $${idx}
      or exists (
        select 1 from message_participants p
        join users u on u.id = p.user_id
        where p.conversation_id = c.id and lower(u.full_name) like $${idx}
      )
    )`);
  }
  const cursor = decodeCursor(input.cursor);
  if (cursor) {
    params.push(cursor.at, cursor.id);
    where.push(`(c.last_message_at, c.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(limit + 1);
  const result = await client.query<ConversationRow & { unread_count: number }>(
    `select c.*, sp.legal_name as pupil_legal_name, u.preferred_name as pupil_preferred_name,
      coalesce((
        select count(*)::int from messages m
        join message_participants me
          on me.conversation_id = c.id and me.user_id = $2 and me.left_at is null
        where m.conversation_id = c.id
          and m.sender_user_id <> $2
          and (me.last_read_at is null or m.sent_at > me.last_read_at)
      ), 0) as unread_count
     from message_conversations c
     left join student_profiles sp on sp.id = c.related_pupil_id
     left join users u on u.id = sp.user_id
     where ${where.join(" and ")}
     order by c.last_message_at desc, c.id desc
     limit $${params.length}`,
    params,
  );
  const rows = result.rows;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const conversationIds = page.map((row) => row.id);
  const participants = conversationIds.length
    ? await client.query<ParticipantRow & { conversation_id: string }>(
        `select p.conversation_id, p.id, p.user_id, p.participant_kind, p.added_at, p.left_at,
                p.archived_at, p.last_read_at, u.full_name
         from message_participants p
         join users u on u.id = p.user_id
         where p.conversation_id = any($1::uuid[]) and p.left_at is null`,
        [conversationIds],
      )
    : { rows: [] as Array<ParticipantRow & { conversation_id: string }> };
  const byConversation = new Map<string, typeof participants.rows>();
  for (const row of participants.rows) {
    const list = byConversation.get(row.conversation_id) ?? [];
    list.push(row);
    byConversation.set(row.conversation_id, list);
  }
  return {
    conversations: page.map((row) =>
      mapConversationSummary(row, byConversation.get(row.id) ?? [], actor),
    ),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]!.last_message_at, page[page.length - 1]!.id) : null,
  };
}

async function unreadTotals(
  client: pg.PoolClient,
  actor: Actor,
): Promise<{ conversations: number; messages: number }> {
  const orgId = actor.organisationId!;
  const children =
    actor.userKind === "parent" ? [...(await guardianChildIds(client, actor.userId, orgId))] : [];
  const vis = visibilitySql(actor);
  const result = await client.query<{ conversations: number; messages: number }>(
    `select
       coalesce(count(*) filter (where unread > 0), 0)::int as conversations,
       coalesce(sum(unread), 0)::int as messages
     from (
       select (
         select count(*)::int from messages m
         join message_participants me
           on me.conversation_id = c.id and me.user_id = $2 and me.left_at is null
         where m.conversation_id = c.id
           and m.sender_user_id <> $2
           and (me.last_read_at is null or m.sent_at > me.last_read_at)
       ) as unread
       from message_conversations c
       where c.organisation_id = $1
         and ${vis}
         and not exists (
           select 1 from message_participants p
           where p.conversation_id = c.id and p.user_id = $2
             and p.archived_at is not null and p.left_at is null
         )
     ) counted`,
    [orgId, actor.userId, children],
  );
  return {
    conversations: result.rows[0]?.conversations ?? 0,
    messages: result.rows[0]?.messages ?? 0,
  };
}

export async function countUnreadConversations(
  client: pg.PoolClient,
  actor: Actor,
): Promise<number> {
  return (await unreadTotals(client, actor)).conversations;
}

export async function countUnreadMessages(
  client: pg.PoolClient,
  actor: Actor,
): Promise<number> {
  return (await unreadTotals(client, actor)).messages;
}

function mapConversationSummary(
  row: ConversationRow & { unread_count?: number },
  participants: Array<ParticipantRow & { conversation_id?: string }>,
  actor: Actor,
) {
  const others = participants.filter((item) => item.user_id !== actor.userId);
  return {
    id: row.id,
    reference: row.reference,
    conversationType: row.conversation_type,
    subject: row.subject,
    status: row.status,
    repliesRestricted: row.replies_restricted,
    relatedPupilId: row.related_pupil_id,
    pupilName: row.pupil_preferred_name || row.pupil_legal_name || null,
    relatedDomain: row.related_domain === "none" ? null : row.related_domain,
    relatedRecordId: row.related_record_id,
    relatedLabel: relatedDomainLabel(row.related_domain),
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    unreadCount: row.unread_count ?? 0,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    participants: others.map((item) => ({
      userId: item.user_id,
      fullName: item.full_name ?? null,
      kind: item.participant_kind,
    })),
  };
}

export async function loadConversationDetail(
  client: pg.PoolClient,
  actor: Actor,
  conversationId: string,
) {
  const conversation = await loadConversationRow(client, actor.organisationId!, conversationId);
  const access = await requireConversationAccess(client, actor, conversation, "read");
  const participants = await client.query<ParticipantRow>(
    `select p.id, p.user_id, p.participant_kind, p.added_at, p.left_at, p.archived_at, p.last_read_at, u.full_name
     from message_participants p
     join users u on u.id = p.user_id
     where p.conversation_id = $1 and p.left_at is null
     order by p.added_at`,
    [conversationId],
  );
  const unread = access.participant
    ? await client.query<{ count: string }>(
        `select count(*)::text as count from messages m
         where m.conversation_id = $1
           and m.sender_user_id <> $2
           and ($3::timestamptz is null or m.sent_at > $3)`,
        [conversationId, actor.userId, access.participant.last_read_at ?? null],
      )
    : { rows: [{ count: "0" }] };
  return {
    conversation: {
      ...mapConversationSummary(
        { ...conversation, unread_count: Number(unread.rows[0]?.count ?? 0) },
        participants.rows,
        actor,
      ),
      repliesRestricted: conversation.replies_restricted,
      createdBy: conversation.created_by,
      canReply: access.canReply,
      canManage: access.canManage,
      canModerate: access.canModerate,
      isParticipant: Boolean(access.participant),
      participants: participants.rows.map((item) => ({
        userId: item.user_id,
        fullName: item.full_name ?? null,
        kind: item.participant_kind,
      })),
    },
  };
}

async function nextReference(client: pg.PoolClient, organisationId: string): Promise<string> {
  const row = await client.query<{ next_message_reference: string }>(
    "select next_message_reference($1)",
    [organisationId],
  );
  return row.rows[0]!.next_message_reference;
}

async function insertUserMessage(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    conversationId: string;
    senderUserId: string;
    body: string;
    messageType?: "user" | "system";
  },
): Promise<{ id: string; sentAt: Date | string; preview: string }> {
  const body = input.messageType === "system" ? input.body : sanitizeMessageBody(input.body);
  if (!body) throwMessaging("validation_failed", "Message text is required");
  if (body.length > MESSAGE_BODY_MAX) {
    throwMessaging("validation_failed", "Message is too long");
  }
  const inserted = await client.query<{ id: string; sent_at: Date }>(
    `insert into messages (
       organisation_id, conversation_id, sender_user_id, body, message_type
     ) values ($1, $2, $3, $4, $5)
     returning id, sent_at`,
    [input.organisationId, input.conversationId, input.senderUserId, body, input.messageType ?? "user"],
  );
  const preview = messagePreview(body);
  await client.query(
    `update message_conversations
     set last_message_at = $2, last_message_id = $3, last_message_preview = $4
     where id = $1`,
    [input.conversationId, inserted.rows[0]!.sent_at, inserted.rows[0]!.id, preview],
  );
  return { id: inserted.rows[0]!.id, sentAt: inserted.rows[0]!.sent_at, preview };
}

async function notifyParticipants(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    conversation: ConversationRow;
    messageId: string;
    actorUserId: string;
    extraUserIds?: string[];
  },
): Promise<void> {
  const name = await schoolName(client, input.organisationId);
  const body = messagingNotificationBody(name);
  const participants = await client.query<{ user_id: string }>(
    `select user_id from message_participants
     where conversation_id = $1 and left_at is null and user_id <> $2`,
    [input.conversation.id, input.actorUserId],
  );
  const ids = new Set(participants.rows.map((row) => row.user_id));
  if (input.conversation.conversation_type === "parent_school" || input.conversation.conversation_type === "admissions") {
    const staff = await client.query<{ user_id: string }>(
      `select distinct m.user_id
       from organisation_memberships m
       join membership_roles mr on mr.membership_id = m.id
       join role_permissions rp on rp.role_id = mr.role_id
       where m.organisation_id = $1
         and m.status = 'active' and m.ended_at is null
         and rp.permission_key = any($2::text[])`,
      [
        input.organisationId,
        input.conversation.conversation_type === "admissions"
          ? [PERMISSIONS.MESSAGING_ADMISSIONS, PERMISSIONS.MESSAGING_MANAGE]
          : [PERMISSIONS.MESSAGING_MANAGE],
      ],
    );
    for (const row of staff.rows) ids.add(row.user_id);
  }
  for (const extra of input.extraUserIds ?? []) ids.add(extra);
  ids.delete(input.actorUserId);
  for (const recipientUserId of ids) {
    await createInboxNotification(client, {
      organisationId: input.organisationId,
      recipientUserId,
      actorUserId: input.actorUserId,
      type: "message_received",
      category: "messaging",
      title: "New message",
      body,
      actionTarget: { conversationId: input.conversation.id, messageId: input.messageId },
      idempotencyKey: `message:received:${input.messageId}:${recipientUserId}`,
    });
  }
}

export async function createStaffConversation(
  client: pg.PoolClient,
  actor: Actor,
  input: {
    conversationType: string;
    subject: string;
    relatedPupilId?: string | null;
    parentUserIds?: string[];
    staffUserIds?: string[];
    relatedDomain?: string | null;
    relatedRecordId?: string | null;
    body?: string;
  },
) {
  if (!hasAnyStaffMessagingAccess(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
  assertMessagingRateLimit({
    organisationId: actor.organisationId!,
    userId: actor.userId,
    kind: "create",
    isStaff: true,
  });
  if (!isMessageConversationType(input.conversationType)) {
    throwMessaging("validation_failed", "Conversation type is invalid");
  }
  const subject = sanitizeMessageSubject(input.subject);
  if (!subject) throwMessaging("validation_failed", "Subject is required");
  const relatedDomain = input.relatedDomain && input.relatedDomain !== "none" ? input.relatedDomain : "none";
  if (!isMessageRelatedDomain(relatedDomain)) {
    throwMessaging("validation_failed", "Related context is not allowed");
  }
  const relatedRecordId = relatedDomain === "none" ? null : input.relatedRecordId ?? null;
  await assertRelatedRecord(client, actor.organisationId!, relatedDomain, relatedRecordId);

  if (input.conversationType === "staff_internal") {
    if (!canUseStaffInternal(actor)) throw new AppError(403, "forbidden", "Missing permission");
    if (input.parentUserIds?.length) throwMessaging("validation_failed", "Staff conversations cannot include parents");
  } else if (input.conversationType === "admissions") {
    if (!canUseAdmissionsMessaging(actor) && !canCreateSchoolMessaging(actor)) {
      throw new AppError(403, "forbidden", "Missing permission");
    }
  } else if (input.conversationType === "parent_school") {
    if (!canCreateSchoolMessaging(actor) && !canManageMessaging(actor)) {
      throw new AppError(403, "forbidden", "Missing permission");
    }
  } else if (input.conversationType === "parent_teacher") {
    if (!input.relatedPupilId) throwMessaging("validation_failed", "A pupil is required");
  }

  if (input.relatedPupilId) {
    await assertPupilInOrganisation(client, actor.organisationId!, input.relatedPupilId);
    if (input.conversationType === "parent_teacher") {
      await requireCurrentlyAssigned(client, actor, input.relatedPupilId);
    }
  }

  const parentIds = [...new Set(input.parentUserIds ?? [])];
  const staffIds = [...new Set([actor.userId, ...(input.staffUserIds ?? [])])];

  if (PARENT_FACING_CONVERSATION_TYPES.includes(input.conversationType) && parentIds.length === 0) {
    throwMessaging("validation_failed", "At least one parent recipient is required");
  }
  for (const parentId of parentIds) {
    if (input.relatedPupilId) {
      await ensureParentGuardian(client, actor.organisationId!, input.relatedPupilId, parentId);
    } else if (relatedDomain === "admissions_application" && relatedRecordId) {
      const contact = await client.query(
        `select 1 from admissions_application_contacts
         where application_id = $1 and organisation_id = $2 and user_id = $3`,
        [relatedRecordId, actor.organisationId, parentId],
      );
      if (!contact.rows[0]) throwMessaging("recipient_unavailable", "Recipient is not available");
    } else {
      const membership = await activeMembershipKind(client, actor.organisationId!, parentId);
      if (membership !== "parent") throwMessaging("recipient_unavailable", "Recipient is not available");
    }
  }
  for (const staffId of staffIds) {
    if (staffId === actor.userId) continue;
    await requireStaffUserInOrganisation(client, actor.organisationId!, staffId);
  }

  const reference = await nextReference(client, actor.organisationId!);
  const created = await client.query<{ id: string }>(
    `insert into message_conversations (
       organisation_id, reference, conversation_type, subject, related_pupil_id,
       related_domain, related_record_id, created_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning id`,
    [
      actor.organisationId,
      reference,
      input.conversationType,
      subject,
      input.relatedPupilId ?? null,
      relatedDomain,
      relatedRecordId,
      actor.userId,
    ],
  );
  const conversationId = created.rows[0]!.id;
  await insertParticipant(client, {
    organisationId: actor.organisationId!,
    conversationId,
    userId: actor.userId,
    kind: "staff",
    addedBy: actor.userId,
  });
  for (const parentId of parentIds) {
    await insertParticipant(client, {
      organisationId: actor.organisationId!,
      conversationId,
      userId: parentId,
      kind: "parent",
      addedBy: actor.userId,
    });
  }
  for (const staffId of staffIds) {
    if (staffId === actor.userId) continue;
    await insertParticipant(client, {
      organisationId: actor.organisationId!,
      conversationId,
      userId: staffId,
      kind: "staff",
      addedBy: actor.userId,
    });
  }
  let firstMessageId: string | null = null;
  if (input.body) {
    const locked = await loadConversationRow(client, actor.organisationId!, conversationId, true);
    const sent = await insertUserMessage(client, {
      organisationId: actor.organisationId!,
      conversationId,
      senderUserId: actor.userId,
      body: input.body,
    });
    firstMessageId = sent.id;
    await notifyParticipants(client, {
      organisationId: actor.organisationId!,
      conversation: locked,
      messageId: sent.id,
      actorUserId: actor.userId,
    });
  }
  await auditMessaging(client, {
    organisationId: actor.organisationId!,
    actorUserId: actor.userId,
    action: "messaging.conversation.created",
    entityId: conversationId,
    after: {
      conversationType: input.conversationType,
      relatedPupilId: input.relatedPupilId ?? null,
      participantCount: 1 + parentIds.length + Math.max(0, staffIds.length - 1),
    },
  });
  return loadConversationDetail(client, actor, conversationId).then((detail) => ({
    ...detail,
    firstMessageId,
  }));
}

export async function createParentConversation(
  client: pg.PoolClient,
  actor: Actor,
  input: {
    studentId: string;
    contactPoint: string;
    subject: string;
    body: string;
    teacherUserId?: string | null;
  },
) {
  if (!actorHas(actor, PERMISSIONS.MESSAGING_REPLY_OWN) && !actorHas(actor, PERMISSIONS.MESSAGING_READ_OWN_CHILDREN)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
  assertMessagingRateLimit({
    organisationId: actor.organisationId!,
    userId: actor.userId,
    kind: "create",
    isStaff: false,
  });
  if (!isMessageParentContactPoint(input.contactPoint)) {
    throwMessaging("validation_failed", "That contact is not available");
  }
  const children = await guardianChildIds(client, actor.userId, actor.organisationId!);
  if (!children.has(input.studentId)) notFound();
  const subject = sanitizeMessageSubject(input.subject);
  if (!subject) throwMessaging("validation_failed", "Subject is required");
  const body = sanitizeMessageBody(input.body);
  if (!body) throwMessaging("validation_failed", "Message text is required");

  let conversationType: "parent_teacher" | "parent_school" | "admissions" = "parent_school";
  const staffIds: string[] = [];
  if (input.contactPoint === "class_teacher") {
    conversationType = "parent_teacher";
    const teachers = await listAssignedClassTeachers(client, actor.organisationId!, input.studentId);
    const formTutors = teachers.filter((row) => row.assignmentRole === "form_tutor" || row.assignmentRole === "co_tutor");
    const pool = formTutors.length > 0 ? formTutors : teachers;
    if (pool.length === 0) throwMessaging("recipient_unavailable", "A class teacher is not available");
    if (input.teacherUserId) {
      if (!pool.some((row) => row.userId === input.teacherUserId)) {
        throwMessaging("recipient_unavailable", "That staff member is not available");
      }
      staffIds.push(input.teacherUserId);
    } else if (pool.length === 1) {
      staffIds.push(pool[0]!.userId);
    } else {
      throwMessaging("validation_failed", "Please choose an assigned teacher");
    }
  } else if (input.contactPoint === "admissions") {
    conversationType = "admissions";
  }

  const reference = await nextReference(client, actor.organisationId!);
  const created = await client.query<{ id: string }>(
    `insert into message_conversations (
       organisation_id, reference, conversation_type, subject, related_pupil_id,
       related_domain, created_by
     ) values ($1,$2,$3,$4,$5,'none',$6)
     returning id`,
    [actor.organisationId, reference, conversationType, subject, input.studentId, actor.userId],
  );
  const conversationId = created.rows[0]!.id;
  await insertParticipant(client, {
    organisationId: actor.organisationId!,
    conversationId,
    userId: actor.userId,
    kind: "parent",
    addedBy: actor.userId,
  });
  for (const staffId of staffIds) {
    await insertParticipant(client, {
      organisationId: actor.organisationId!,
      conversationId,
      userId: staffId,
      kind: "staff",
      addedBy: actor.userId,
    });
  }
  const locked = await loadConversationRow(client, actor.organisationId!, conversationId, true);
  const sent = await insertUserMessage(client, {
    organisationId: actor.organisationId!,
    conversationId,
    senderUserId: actor.userId,
    body,
  });
  await notifyParticipants(client, {
    organisationId: actor.organisationId!,
    conversation: locked,
    messageId: sent.id,
    actorUserId: actor.userId,
    extraUserIds: staffIds,
  });
  await auditMessaging(client, {
    organisationId: actor.organisationId!,
    actorUserId: actor.userId,
    action: "messaging.conversation.created",
    entityId: conversationId,
    after: { conversationType, contactPoint: input.contactPoint, relatedPupilId: input.studentId },
  });
  return loadConversationDetail(client, actor, conversationId);
}

export async function sendConversationMessage(
  client: pg.PoolClient,
  actor: Actor,
  conversationId: string,
  body: string,
) {
  assertMessagingRateLimit({
    organisationId: actor.organisationId!,
    userId: actor.userId,
    kind: "send",
    isStaff: actor.userKind !== "parent",
  });
  const conversation = await loadConversationRow(client, actor.organisationId!, conversationId, true);
  const access = await requireConversationAccess(client, actor, conversation, "reply");
  if (!access.participant && actor.userKind !== "parent") {
    await insertParticipant(client, {
      organisationId: actor.organisationId!,
      conversationId,
      userId: actor.userId,
      kind: "staff",
      addedBy: actor.userId,
    });
  }
  const sent = await insertUserMessage(client, {
    organisationId: actor.organisationId!,
    conversationId,
    senderUserId: actor.userId,
    body,
  });
  await notifyParticipants(client, {
    organisationId: actor.organisationId!,
    conversation,
    messageId: sent.id,
    actorUserId: actor.userId,
  });
  await auditMessaging(client, {
    organisationId: actor.organisationId!,
    actorUserId: actor.userId,
    action: "messaging.message.sent",
    entityId: conversationId,
    after: { messageId: sent.id },
  });
  return {
    message: {
      id: sent.id,
      conversationId,
      senderUserId: actor.userId,
      body: sanitizeMessageBody(body),
      messageType: "user",
      sentAt: sent.sentAt,
      redacted: false,
      attachments: [],
    },
  };
}

export async function listConversationMessages(
  client: pg.PoolClient,
  actor: Actor,
  conversationId: string,
  input: { before?: string; limit?: number },
) {
  const conversation = await loadConversationRow(client, actor.organisationId!, conversationId);
  await requireConversationAccess(client, actor, conversation, "read");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const cursor = decodeCursor(input.before);
  const params: unknown[] = [conversationId, actor.organisationId];
  let where = "m.conversation_id = $1 and m.organisation_id = $2";
  if (cursor) {
    params.push(cursor.at, cursor.id);
    where += ` and (m.sent_at, m.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(limit + 1);
  const result = await client.query<{
    id: string;
    sender_user_id: string;
    body: string;
    message_type: string;
    sent_at: Date;
    redacted_at: Date | null;
    sender_name: string | null;
  }>(
    `select m.id, m.sender_user_id, m.body, m.message_type, m.sent_at, m.redacted_at, u.full_name as sender_name
     from messages m
     join users u on u.id = m.sender_user_id
     where ${where}
     order by m.sent_at desc, m.id desc
     limit $${params.length}`,
    params,
  );
  const hasMore = result.rows.length > limit;
  const page = (hasMore ? result.rows.slice(0, limit) : result.rows).slice().reverse();
  const attachments = page.length
    ? await client.query<{
        id: string;
        message_id: string;
        stored_object_id: string;
        original_filename: string;
      }>(
        `select id, message_id, stored_object_id, original_filename
         from message_attachments
         where message_id = any($1::uuid[])`,
        [page.map((row) => row.id)],
      )
    : { rows: [] as Array<{ id: string; message_id: string; stored_object_id: string; original_filename: string }> };
  const byMessage = new Map<string, typeof attachments.rows>();
  for (const row of attachments.rows) {
    const list = byMessage.get(row.message_id) ?? [];
    list.push(row);
    byMessage.set(row.message_id, list);
  }
  return {
    messages: page.map((row) => ({
      id: row.id,
      conversationId,
      senderUserId: row.sender_user_id,
      senderName: row.sender_name,
      body: displayMessageBody({ body: row.body, redactedAt: row.redacted_at }),
      messageType: row.message_type,
      sentAt: row.sent_at,
      redacted: Boolean(row.redacted_at),
      attachments: (byMessage.get(row.id) ?? []).map((file) => ({
        id: file.id,
        originalFilename: file.original_filename,
        downloadPath: `/api/v1/files/${file.stored_object_id}`,
      })),
    })),
    nextCursor: hasMore
      ? encodeCursor(result.rows[limit - 1]!.sent_at, result.rows[limit - 1]!.id)
      : null,
  };
}

export async function markConversationRead(
  client: pg.PoolClient,
  actor: Actor,
  conversationId: string,
) {
  const conversation = await loadConversationRow(client, actor.organisationId!, conversationId);
  const access = await requireConversationAccess(client, actor, conversation, "read");
  if (!access.participant) {
    return { read: true };
  }
  const latest = await client.query<{ id: string; sent_at: Date }>(
    `select id, sent_at from messages where conversation_id = $1 order by sent_at desc, id desc limit 1`,
    [conversationId],
  );
  await client.query(
    `update message_participants
     set last_read_at = greatest(coalesce(last_read_at, to_timestamp(0)), coalesce($3::timestamptz, now())),
         last_read_message_id = coalesce($4, last_read_message_id)
     where conversation_id = $1 and user_id = $2`,
    [conversationId, actor.userId, latest.rows[0]?.sent_at ?? new Date(), latest.rows[0]?.id ?? null],
  );
  return { read: true };
}

export async function closeConversation(
  client: pg.PoolClient,
  actor: Actor,
  conversationId: string,
  restrictReplies = false,
) {
  const conversation = await loadConversationRow(client, actor.organisationId!, conversationId, true);
  await requireConversationAccess(client, actor, conversation, "manage");
  await client.query(
    `update message_conversations
     set status = 'closed', replies_restricted = $3, closed_at = now(), closed_by = $2
     where id = $1`,
    [conversationId, actor.userId, restrictReplies],
  );
  await insertUserMessage(client, {
    organisationId: actor.organisationId!,
    conversationId,
    senderUserId: actor.userId,
    body: "This conversation is closed. New replies are not allowed unless a member of staff reopens it.",
    messageType: "system",
  });
  await auditMessaging(client, {
    organisationId: actor.organisationId!,
    actorUserId: actor.userId,
    action: "messaging.conversation.closed",
    entityId: conversationId,
    after: { restrictReplies },
  });
  return loadConversationDetail(client, actor, conversationId);
}

export async function reopenConversation(
  client: pg.PoolClient,
  actor: Actor,
  conversationId: string,
) {
  const conversation = await loadConversationRow(client, actor.organisationId!, conversationId, true);
  await requireConversationAccess(client, actor, conversation, "manage");
  await client.query(
    `update message_conversations
     set status = 'open', replies_restricted = false, closed_at = null, closed_by = null
     where id = $1`,
    [conversationId],
  );
  await insertUserMessage(client, {
    organisationId: actor.organisationId!,
    conversationId,
    senderUserId: actor.userId,
    body: "This conversation was reopened.",
    messageType: "system",
  });
  await auditMessaging(client, {
    organisationId: actor.organisationId!,
    actorUserId: actor.userId,
    action: "messaging.conversation.reopened",
    entityId: conversationId,
  });
  return loadConversationDetail(client, actor, conversationId);
}

export async function archiveOwnConversation(
  client: pg.PoolClient,
  actor: Actor,
  conversationId: string,
  archived: boolean,
) {
  const conversation = await loadConversationRow(client, actor.organisationId!, conversationId);
  await requireConversationAccess(client, actor, conversation, "read");
  await client.query(
    `update message_participants
     set archived_at = case when $3 then coalesce(archived_at, now()) else null end
     where conversation_id = $1 and user_id = $2`,
    [conversationId, actor.userId, archived],
  );
  return { archived };
}

export async function redactMessage(
  client: pg.PoolClient,
  actor: Actor,
  conversationId: string,
  messageId: string,
) {
  const conversation = await loadConversationRow(client, actor.organisationId!, conversationId, true);
  await requireConversationAccess(client, actor, conversation, "moderate");
  const updated = await client.query(
    `update messages
     set redacted_at = now()
     where id = $1 and conversation_id = $2 and organisation_id = $3 and redacted_at is null
     returning id`,
    [messageId, conversationId, actor.organisationId],
  );
  if (!updated.rows[0]) notFound();
  if (conversation.last_message_id === messageId) {
    await client.query(
      `update message_conversations set last_message_preview = $2 where id = $1`,
      [conversationId, MESSAGE_REDACTED_BODY.slice(0, 140)],
    );
  }
  await auditMessaging(client, {
    organisationId: actor.organisationId!,
    actorUserId: actor.userId,
    action: "messaging.message.redacted",
    entityId: conversationId,
    after: { messageId },
  });
  return { redacted: true, body: MESSAGE_REDACTED_BODY };
}

export async function attachMessageFile(
  client: pg.PoolClient,
  actor: Actor,
  input: {
    conversationId: string;
    messageId: string;
    storedObjectId: string;
    originalFilename: string;
  },
) {
  assertMessagingRateLimit({
    organisationId: actor.organisationId!,
    userId: actor.userId,
    kind: "upload",
    isStaff: actor.userKind !== "parent",
  });
  const conversation = await loadConversationRow(client, actor.organisationId!, input.conversationId);
  await requireConversationAccess(client, actor, conversation, "reply");
  const message = await client.query<{ sender_user_id: string }>(
    `select sender_user_id from messages
     where id = $1 and conversation_id = $2 and organisation_id = $3 and redacted_at is null`,
    [input.messageId, input.conversationId, actor.organisationId],
  );
  if (!message.rows[0] || message.rows[0].sender_user_id !== actor.userId) notFound();
  await client.query(
    `insert into message_attachments (
       organisation_id, conversation_id, message_id, stored_object_id, original_filename
     ) values ($1,$2,$3,$4,$5)`,
    [
      actor.organisationId,
      input.conversationId,
      input.messageId,
      input.storedObjectId,
      input.originalFilename,
    ],
  );
  await auditMessaging(client, {
    organisationId: actor.organisationId!,
    actorUserId: actor.userId,
    action: "messaging.attachment.uploaded",
    entityId: input.conversationId,
    after: { messageId: input.messageId, storedObjectId: input.storedObjectId },
  });
}

export async function listPupilContactHistory(
  client: pg.PoolClient,
  actor: Actor,
  studentId: string,
) {
  if (!canReadSchoolMessaging(actor) && !canManageMessaging(actor) && !canCreateAssignedMessaging(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
  await assertPupilInOrganisation(client, actor.organisationId!, studentId);
  if (!canReadSchoolMessaging(actor)) {
    const assigned = await assignedStudentIds(client, actor.userId, actor.organisationId!);
    if (!assigned.has(studentId)) notFound();
  }
  const listed = await listConversations(client, actor, { pupilId: studentId, folder: "all", limit: 50 });
  return {
    studentId,
    conversations: listed.conversations.map((row) => ({
      id: row.id,
      subject: row.subject,
      conversationType: row.conversationType,
      status: row.status,
      lastMessageAt: row.lastMessageAt,
      participants: row.participants,
    })),
  };
}
