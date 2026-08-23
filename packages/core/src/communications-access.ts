import { PERMISSIONS, type Actor } from "@schoolapp/domain";
import type pg from "pg";
import { AppError } from "./errors.js";
import { createInboxNotification } from "./admissions.js";
import { writeAudit } from "./academic.js";
import { assignedClassIds, assignedStudentIds, isAssignedToClass } from "./students-access.js";
import { assertAnyPermission, notFound } from "./permissions.js";
import {
  communicationNotificationBody,
  isBroadcastTargetType,
  isStaffOnlyTargetType,
  summariseAnnouncementReceipts,
  type CommunicationTargetType,
} from "./communications.js";

export const ANNOUNCEMENT_SCHOOL_READ_PERMISSIONS = [
  PERMISSIONS.ANNOUNCEMENTS_READ,
  PERMISSIONS.ANNOUNCEMENTS_MANAGE,
  PERMISSIONS.ANNOUNCEMENTS_PUBLISH,
  PERMISSIONS.ANNOUNCEMENTS_BROADCAST,
] as const;

export const ANNOUNCEMENT_MANAGE_PERMISSIONS = [
  PERMISSIONS.ANNOUNCEMENTS_MANAGE,
  PERMISSIONS.ANNOUNCEMENTS_MANAGE_ASSIGNED,
] as const;

export const ANNOUNCEMENT_READ_PERMISSIONS = [
  PERMISSIONS.ANNOUNCEMENTS_READ,
  PERMISSIONS.ANNOUNCEMENTS_READ_ASSIGNED,
  PERMISSIONS.ANNOUNCEMENTS_MANAGE,
  PERMISSIONS.ANNOUNCEMENTS_MANAGE_ASSIGNED,
] as const;

export const CALENDAR_SCHOOL_READ_PERMISSIONS = [
  PERMISSIONS.CALENDAR_READ,
  PERMISSIONS.CALENDAR_MANAGE,
  PERMISSIONS.CALENDAR_MANAGE_SCHOOL,
] as const;

export const CALENDAR_MANAGE_PERMISSIONS = [
  PERMISSIONS.CALENDAR_MANAGE,
  PERMISSIONS.CALENDAR_MANAGE_ASSIGNED,
  PERMISSIONS.CALENDAR_MANAGE_SCHOOL,
] as const;

export const CALENDAR_READ_PERMISSIONS = [
  PERMISSIONS.CALENDAR_READ,
  PERMISSIONS.CALENDAR_READ_ASSIGNED,
  PERMISSIONS.CALENDAR_MANAGE,
  PERMISSIONS.CALENDAR_MANAGE_ASSIGNED,
  PERMISSIONS.CALENDAR_MANAGE_SCHOOL,
] as const;

export function canReadSchoolAnnouncements(actor: Actor): boolean {
  return ANNOUNCEMENT_SCHOOL_READ_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canManageSchoolAnnouncements(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ANNOUNCEMENTS_MANAGE);
}

export function canPublishAnnouncements(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.ANNOUNCEMENTS_PUBLISH) ||
    actor.permissions.has(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  );
}

export function canBroadcastAnnouncements(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.ANNOUNCEMENTS_BROADCAST) ||
    actor.permissions.has(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  );
}

export function canManageAssignedAnnouncements(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ANNOUNCEMENTS_MANAGE_ASSIGNED);
}

export function canReadAnnouncementReceipts(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.ANNOUNCEMENTS_ACKNOWLEDGEMENTS_READ) ||
    canManageSchoolAnnouncements(actor)
  );
}

export function canReadSchoolCalendar(actor: Actor): boolean {
  return CALENDAR_SCHOOL_READ_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canManageSchoolCalendar(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.CALENDAR_MANAGE_SCHOOL) ||
    actor.permissions.has(PERMISSIONS.CALENDAR_MANAGE)
  );
}

export function canManageAssignedCalendar(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.CALENDAR_MANAGE_ASSIGNED);
}

export type CommunicationTargetInput = {
  id?: string;
  targetType: CommunicationTargetType;
  classId?: string | null;
  yearGroupId?: string | null;
  studentProfileId?: string | null;
  staffUserId?: string | null;
};

type ResolvedAudienceMember = {
  userId: string;
  audienceRole: "staff" | "parent" | "student";
  studentProfileId: string | null;
  classId: string | null;
  yearGroupId: string | null;
};

function staffRoleFilter(): string {
  return `r.key in (
    'school.admin', 'school.headteacher', 'school.teacher', 'school.admissions', 'school.staff'
  )`;
}

export async function assertCanTargetCommunication(
  client: pg.PoolClient,
  actor: Actor,
  target: CommunicationTargetInput,
  options: { scope: "announcement" | "calendar" },
): Promise<void> {
  if (isBroadcastTargetType(target.targetType)) {
    const allowed =
      options.scope === "calendar" ? canManageSchoolCalendar(actor) : canBroadcastAnnouncements(actor);
    if (!allowed) {
      throw new AppError(403, "forbidden", "School-wide targeting requires broadcast permission");
    }
  }

  if (target.targetType === "class") {
    if (!target.classId) throw new AppError(400, "validation_failed", "classId is required");
    const row = await client.query("select 1 from classes where id = $1 and organisation_id = $2", [
      target.classId,
      actor.organisationId,
    ]);
    if (!row.rows[0]) notFound();
    if (
      (options.scope === "announcement" &&
        (canManageSchoolAnnouncements(actor) || canBroadcastAnnouncements(actor))) ||
      (options.scope === "calendar" && canManageSchoolCalendar(actor))
    ) {
      return;
    }
    if (!(await isAssignedToClass(client, actor.userId, actor.organisationId!, target.classId))) {
      notFound();
    }
    return;
  }

  if (target.targetType === "student") {
    if (!target.studentProfileId) {
      throw new AppError(400, "validation_failed", "studentProfileId is required");
    }
    const row = await client.query("select 1 from student_profiles where id = $1 and organisation_id = $2", [
      target.studentProfileId,
      actor.organisationId,
    ]);
    if (!row.rows[0]) notFound();
    if (
      (options.scope === "announcement" &&
        (canManageSchoolAnnouncements(actor) || canBroadcastAnnouncements(actor))) ||
      (options.scope === "calendar" && canManageSchoolCalendar(actor))
    ) {
      return;
    }
    const assigned = await assignedStudentIds(client, actor.userId, actor.organisationId!);
    if (!assigned.has(target.studentProfileId)) notFound();
    return;
  }

  if (target.targetType === "year_group") {
    if (!target.yearGroupId) throw new AppError(400, "validation_failed", "yearGroupId is required");
    const row = await client.query("select 1 from year_groups where id = $1 and organisation_id = $2", [
      target.yearGroupId,
      actor.organisationId,
    ]);
    if (!row.rows[0]) notFound();
    return;
  }

  if (target.targetType === "staff_member") {
    if (!target.staffUserId) throw new AppError(400, "validation_failed", "staffUserId is required");
    const canSelectStaff =
      options.scope === "calendar"
        ? canManageSchoolCalendar(actor)
        : canBroadcastAnnouncements(actor) || canManageSchoolAnnouncements(actor);
    if (!canSelectStaff) {
      throw new AppError(403, "forbidden", "Selecting staff requires school-wide communication permission");
    }
    const row = await client.query(
      `select 1
       from organisation_memberships m
       join membership_roles mr on mr.membership_id = m.id
       join roles r on r.id = mr.role_id
       where m.organisation_id = $1
         and m.user_id = $2
         and m.status = 'active'
         and m.ended_at is null
         and ${staffRoleFilter()}`,
      [actor.organisationId, target.staffUserId],
    );
    if (!row.rows[0]) notFound();
  }
}

export async function resolveCommunicationAudience(
  client: pg.PoolClient,
  organisationId: string,
  targets: CommunicationTargetInput[],
): Promise<ResolvedAudienceMember[]> {
  const members: ResolvedAudienceMember[] = [];
  for (const target of targets) {
    members.push(...(await resolveOneTarget(client, organisationId, target)));
  }
  return members;
}

async function resolveOneTarget(
  client: pg.PoolClient,
  organisationId: string,
  target: CommunicationTargetInput,
): Promise<ResolvedAudienceMember[]> {
  if (target.targetType === "whole_school") {
    const staff = await loadStaffAudience(client, organisationId);
    const parents = await loadParentAudience(client, organisationId);
    const students = await loadStudentAudience(client, organisationId);
    return [...staff, ...parents, ...students];
  }
  if (target.targetType === "staff") {
    return loadStaffAudience(client, organisationId);
  }
  if (target.targetType === "parents") {
    return loadParentAudience(client, organisationId);
  }
  if (target.targetType === "students") {
    return loadStudentAudience(client, organisationId);
  }
  if (target.targetType === "year_group" && target.yearGroupId) {
    return loadYearGroupAudience(client, organisationId, target.yearGroupId);
  }
  if (target.targetType === "class" && target.classId) {
    return loadClassAudience(client, organisationId, target.classId);
  }
  if (target.targetType === "student" && target.studentProfileId) {
    return loadStudentTargetAudience(client, organisationId, target.studentProfileId);
  }
  if (target.targetType === "staff_member" && target.staffUserId) {
    return [
      {
        userId: target.staffUserId,
        audienceRole: "staff",
        studentProfileId: null,
        classId: null,
        yearGroupId: null,
      },
    ];
  }
  return [];
}

async function loadStaffAudience(
  client: pg.PoolClient,
  organisationId: string,
): Promise<ResolvedAudienceMember[]> {
  const rows = await client.query<{ user_id: string }>(
    `select distinct m.user_id
     from organisation_memberships m
     join membership_roles mr on mr.membership_id = m.id
     join roles r on r.id = mr.role_id
     where m.organisation_id = $1
       and m.status = 'active'
       and m.ended_at is null
       and ${staffRoleFilter()}`,
    [organisationId],
  );
  return rows.rows.map((row) => ({
    userId: row.user_id,
    audienceRole: "staff" as const,
    studentProfileId: null,
    classId: null,
    yearGroupId: null,
  }));
}

async function loadParentAudience(
  client: pg.PoolClient,
  organisationId: string,
): Promise<ResolvedAudienceMember[]> {
  const rows = await client.query<{
    guardian_user_id: string;
    student_profile_id: string;
    class_id: string | null;
    year_group_id: string | null;
  }>(
    `select g.guardian_user_id, g.student_profile_id, form.id as class_id, se.year_group_id
     from guardianships g
     join student_profiles sp on sp.id = g.student_profile_id
     left join academic_years ay on ay.organisation_id = g.organisation_id and ay.is_current
     left join student_enrolments se
       on se.student_profile_id = sp.id
      and se.academic_year_id = ay.id
      and se.is_primary
      and se.ended_on is null
     left join lateral (
       select c.id
       from class_memberships cm
       join classes c on c.id = cm.class_id
       where cm.student_profile_id = sp.id
         and cm.ended_on is null
         and c.class_type = 'form'
         and ay.id is not null
         and cm.academic_year_id = ay.id
       limit 1
     ) form on true
     where g.organisation_id = $1
       and g.portal_access = true
       and (g.ended_on is null or g.ended_on >= current_date)`,
    [organisationId],
  );
  return rows.rows.map((row) => ({
    userId: row.guardian_user_id,
    audienceRole: "parent" as const,
    studentProfileId: row.student_profile_id,
    classId: row.class_id,
    yearGroupId: row.year_group_id,
  }));
}

async function loadStudentAudience(
  client: pg.PoolClient,
  organisationId: string,
): Promise<ResolvedAudienceMember[]> {
  const rows = await client.query<{
    user_id: string;
    student_profile_id: string;
    class_id: string | null;
    year_group_id: string | null;
  }>(
    `select sp.user_id, sp.id as student_profile_id, form.id as class_id, se.year_group_id
     from student_profiles sp
     join academic_years ay on ay.organisation_id = sp.organisation_id and ay.is_current
     join student_enrolments se
       on se.student_profile_id = sp.id
      and se.academic_year_id = ay.id
      and se.is_primary
      and se.ended_on is null
     left join lateral (
       select c.id
       from class_memberships cm
       join classes c on c.id = cm.class_id
       where cm.student_profile_id = sp.id
         and cm.ended_on is null
         and c.class_type = 'form'
         and cm.academic_year_id = ay.id
       limit 1
     ) form on true
     where sp.organisation_id = $1 and sp.user_id is not null`,
    [organisationId],
  );
  return rows.rows.map((row) => ({
    userId: row.user_id,
    audienceRole: "student" as const,
    studentProfileId: row.student_profile_id,
    classId: row.class_id,
    yearGroupId: row.year_group_id,
  }));
}

async function loadYearGroupAudience(
  client: pg.PoolClient,
  organisationId: string,
  yearGroupId: string,
): Promise<ResolvedAudienceMember[]> {
  const students = await client.query<{
    user_id: string | null;
    student_profile_id: string;
    class_id: string | null;
    year_group_id: string;
  }>(
    `select sp.user_id, sp.id as student_profile_id, form.id as class_id, se.year_group_id
     from student_profiles sp
     join academic_years ay on ay.organisation_id = sp.organisation_id and ay.is_current
     join student_enrolments se
       on se.student_profile_id = sp.id
      and se.academic_year_id = ay.id
      and se.is_primary
      and se.ended_on is null
      and se.year_group_id = $2
     left join lateral (
       select c.id
       from class_memberships cm
       join classes c on c.id = cm.class_id
       where cm.student_profile_id = sp.id
         and cm.ended_on is null
         and c.class_type = 'form'
         and cm.academic_year_id = ay.id
       limit 1
     ) form on true
     where sp.organisation_id = $1`,
    [organisationId, yearGroupId],
  );
  return expandPupilsWithGuardiansAndStaff(client, organisationId, students.rows);
}

async function loadClassAudience(
  client: pg.PoolClient,
  organisationId: string,
  classId: string,
): Promise<ResolvedAudienceMember[]> {
  const students = await client.query<{
    user_id: string | null;
    student_profile_id: string;
    class_id: string;
    year_group_id: string | null;
  }>(
    `select sp.user_id, sp.id as student_profile_id, cm.class_id, c.year_group_id
     from class_memberships cm
     join classes c on c.id = cm.class_id
     join student_profiles sp on sp.id = cm.student_profile_id
     join academic_years ay on ay.id = cm.academic_year_id and ay.is_current
     where cm.organisation_id = $1
       and cm.class_id = $2
       and cm.ended_on is null`,
    [organisationId, classId],
  );
  const members = await expandPupilsWithGuardiansAndStaff(client, organisationId, students.rows);
  const staff = await client.query<{ user_id: string }>(
    `select distinct sp.user_id
     from class_staff_assignments csa
     join staff_profiles sp on sp.id = csa.staff_profile_id
     where csa.organisation_id = $1
       and csa.class_id = $2
       and (csa.ended_on is null or csa.ended_on >= current_date)`,
    [organisationId, classId],
  );
  for (const row of staff.rows) {
    members.push({
      userId: row.user_id,
      audienceRole: "staff",
      studentProfileId: null,
      classId,
      yearGroupId: students.rows[0]?.year_group_id ?? null,
    });
  }
  return members;
}

async function loadStudentTargetAudience(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
): Promise<ResolvedAudienceMember[]> {
  const student = await client.query<{
    user_id: string | null;
    student_profile_id: string;
    class_id: string | null;
    year_group_id: string | null;
  }>(
    `select sp.user_id, sp.id as student_profile_id, form.id as class_id, se.year_group_id
     from student_profiles sp
     left join academic_years ay on ay.organisation_id = sp.organisation_id and ay.is_current
     left join student_enrolments se
       on se.student_profile_id = sp.id
      and se.academic_year_id = ay.id
      and se.is_primary
      and se.ended_on is null
     left join lateral (
       select c.id
       from class_memberships cm
       join classes c on c.id = cm.class_id
       where cm.student_profile_id = sp.id
         and cm.ended_on is null
         and c.class_type = 'form'
         and ay.id is not null
         and cm.academic_year_id = ay.id
       limit 1
     ) form on true
     where sp.organisation_id = $1 and sp.id = $2`,
    [organisationId, studentProfileId],
  );
  return expandPupilsWithGuardiansAndStaff(client, organisationId, student.rows);
}

async function expandPupilsWithGuardiansAndStaff(
  client: pg.PoolClient,
  organisationId: string,
  pupils: Array<{
    user_id: string | null;
    student_profile_id: string;
    class_id: string | null;
    year_group_id: string | null;
  }>,
): Promise<ResolvedAudienceMember[]> {
  const members: ResolvedAudienceMember[] = [];
  const studentIds = pupils.map((row) => row.student_profile_id);
  for (const pupil of pupils) {
    if (pupil.user_id) {
      members.push({
        userId: pupil.user_id,
        audienceRole: "student",
        studentProfileId: pupil.student_profile_id,
        classId: pupil.class_id,
        yearGroupId: pupil.year_group_id,
      });
    }
  }
  if (studentIds.length === 0) return members;
  const parents = await client.query<{
    guardian_user_id: string;
    student_profile_id: string;
  }>(
    `select guardian_user_id, student_profile_id
     from guardianships
     where organisation_id = $1
       and student_profile_id = any($2::uuid[])
       and portal_access = true
       and (ended_on is null or ended_on >= current_date)`,
    [organisationId, studentIds],
  );
  const byStudent = new Map(pupils.map((row) => [row.student_profile_id, row]));
  for (const parent of parents.rows) {
    const pupil = byStudent.get(parent.student_profile_id);
    members.push({
      userId: parent.guardian_user_id,
      audienceRole: "parent",
      studentProfileId: parent.student_profile_id,
      classId: pupil?.class_id ?? null,
      yearGroupId: pupil?.year_group_id ?? null,
    });
  }
  return members;
}

export async function snapshotAnnouncementRecipients(
  client: pg.PoolClient,
  organisationId: string,
  announcementId: string,
): Promise<number> {
  const targets = await client.query<{
    id: string;
    target_type: CommunicationTargetType;
    class_id: string | null;
    year_group_id: string | null;
    student_profile_id: string | null;
    staff_user_id: string | null;
  }>(
    `select id, target_type, class_id, year_group_id, student_profile_id, staff_user_id
     from announcement_targets
     where announcement_id = $1 and organisation_id = $2`,
    [announcementId, organisationId],
  );
  const audience = await resolveCommunicationAudience(
    client,
    organisationId,
    targets.rows.map((row) => ({
      id: row.id,
      targetType: row.target_type,
      classId: row.class_id,
      yearGroupId: row.year_group_id,
      studentProfileId: row.student_profile_id,
      staffUserId: row.staff_user_id,
    })),
  );
  const seenUsers = new Set<string>();
  for (const member of audience) {
    if (!seenUsers.has(member.userId)) {
      seenUsers.add(member.userId);
      await client.query(
        `insert into announcement_recipients (
           organisation_id, announcement_id, user_id, audience_role
         ) values ($1, $2, $3, $4)
         on conflict (announcement_id, user_id) do nothing`,
        [organisationId, announcementId, member.userId, member.audienceRole],
      );
    }
    if (member.studentProfileId) {
      await client.query(
        `insert into announcement_recipient_subjects (
           organisation_id, announcement_id, user_id, student_profile_id, class_id, year_group_id
         ) values ($1, $2, $3, $4, $5, $6)
         on conflict (announcement_id, user_id, student_profile_id) do nothing`,
        [
          organisationId,
          announcementId,
          member.userId,
          member.studentProfileId,
          member.classId,
          member.yearGroupId,
        ],
      );
    }
  }
  const count = await client.query<{ n: number }>(
    `select count(*)::int as n from announcement_recipients
     where announcement_id = $1 and organisation_id = $2`,
    [announcementId, organisationId],
  );
  return count.rows[0]?.n ?? 0;
}

export async function snapshotEventAudience(
  client: pg.PoolClient,
  organisationId: string,
  eventId: string,
): Promise<number> {
  const targets = await client.query<{
    id: string;
    target_type: CommunicationTargetType;
    class_id: string | null;
    year_group_id: string | null;
    student_profile_id: string | null;
    staff_user_id: string | null;
  }>(
    `select id, target_type, class_id, year_group_id, student_profile_id, staff_user_id
     from school_event_targets
     where event_id = $1 and organisation_id = $2`,
    [eventId, organisationId],
  );
  const audience = await resolveCommunicationAudience(
    client,
    organisationId,
    targets.rows.map((row) => ({
      id: row.id,
      targetType: row.target_type,
      classId: row.class_id,
      yearGroupId: row.year_group_id,
      studentProfileId: row.student_profile_id,
      staffUserId: row.staff_user_id,
    })),
  );
  const seenUsers = new Set<string>();
  for (const member of audience) {
    if (!seenUsers.has(member.userId)) {
      seenUsers.add(member.userId);
      await client.query(
        `insert into school_event_audience (
           organisation_id, event_id, user_id, audience_role
         ) values ($1, $2, $3, $4)
         on conflict (event_id, user_id) do nothing`,
        [organisationId, eventId, member.userId, member.audienceRole],
      );
    }
    if (member.studentProfileId) {
      await client.query(
        `insert into school_event_audience_subjects (
           organisation_id, event_id, user_id, student_profile_id, class_id, year_group_id
         ) values ($1, $2, $3, $4, $5, $6)
         on conflict (event_id, user_id, student_profile_id) do nothing`,
        [organisationId, eventId, member.userId, member.studentProfileId, member.classId, member.yearGroupId],
      );
    }
  }
  const count = await client.query<{ n: number }>(
    `select count(*)::int as n from school_event_audience where event_id = $1 and organisation_id = $2`,
    [eventId, organisationId],
  );
  return count.rows[0]?.n ?? 0;
}

export async function notifyAnnouncementPublished(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    announcementId: string;
    title: string;
    priority: string;
    acknowledgementRequired: boolean;
  },
): Promise<void> {
  const recipients = await client.query<{ user_id: string; audience_role: string }>(
    `select user_id, audience_role
     from announcement_recipients
     where announcement_id = $1 and organisation_id = $2`,
    [input.announcementId, input.organisationId],
  );
  const important = input.priority === "important" || input.priority === "urgent";
  for (const recipient of recipients.rows) {
    const kind = input.acknowledgementRequired ? "acknowledgement" : important ? "important" : "published";
    await createInboxNotification(client, {
      organisationId: input.organisationId,
      recipientUserId: recipient.user_id,
      actorUserId: input.actorUserId,
      type: input.acknowledgementRequired
        ? "announcement_acknowledgement"
        : important
          ? "announcement_important"
          : "announcement_published",
      category: "announcement",
      title: important || input.acknowledgementRequired ? "School notice" : "New announcement",
      body: communicationNotificationBody(kind, input.title),
      actionTarget: { announcementId: input.announcementId, audienceRole: recipient.audience_role },
      idempotencyKey: `announcement:published:${input.announcementId}:${recipient.user_id}`,
    });
  }
}

export async function notifyEventUpcoming(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    eventId: string;
    title: string;
    startsAt: string | null;
  },
): Promise<void> {
  if (!input.startsAt) return;
  const start = new Date(input.startsAt).getTime();
  if (Number.isNaN(start) || start > Date.now() + 14 * 24 * 60 * 60 * 1000) return;
  const recipients = await client.query<{ user_id: string }>(
    `select user_id from school_event_audience where event_id = $1 and organisation_id = $2`,
    [input.eventId, input.organisationId],
  );
  for (const recipient of recipients.rows) {
    await createInboxNotification(client, {
      organisationId: input.organisationId,
      recipientUserId: recipient.user_id,
      actorUserId: input.actorUserId,
      type: "calendar_upcoming",
      category: "calendar",
      title: "Upcoming school event",
      body: communicationNotificationBody("upcoming", input.title),
      actionTarget: { eventId: input.eventId },
      idempotencyKey: `calendar:upcoming:${input.eventId}:${recipient.user_id}`,
    });
  }
}

export async function activateDueAnnouncements(
  client: pg.PoolClient,
  organisationId: string,
  actorUserId: string,
): Promise<string[]> {
  const due = await client.query<{
    id: string;
    title: string;
    priority: string;
    acknowledgement_required: boolean;
    created_by: string;
    published_by: string | null;
  }>(
    `update announcements
     set status = 'published'
     where organisation_id = $1
       and status = 'scheduled'
       and publish_at is not null
       and publish_at <= now()
     returning id, title, priority, acknowledgement_required, created_by, published_by`,
    [organisationId],
  );
  const ids: string[] = [];
  for (const row of due.rows) {
    await snapshotAnnouncementRecipients(client, organisationId, row.id);
    await notifyAnnouncementPublished(client, {
      organisationId,
      actorUserId: row.published_by ?? row.created_by ?? actorUserId,
      announcementId: row.id,
      title: row.title,
      priority: row.priority,
      acknowledgementRequired: row.acknowledgement_required,
    });
    ids.push(row.id);
  }
  await client.query(
    `update announcements
     set status = 'expired'
     where organisation_id = $1
       and status = 'published'
       and expires_at is not null
       and expires_at <= now()`,
    [organisationId],
  );
  return ids;
}

export async function activateDueEvents(
  client: pg.PoolClient,
  organisationId: string,
  actorUserId: string,
): Promise<string[]> {
  const due = await client.query<{
    id: string;
    title: string;
    starts_at: string;
    created_by: string;
    published_by: string | null;
  }>(
    `update school_events
     set status = 'published'
     where organisation_id = $1
       and status = 'scheduled'
       and publish_at is not null
       and publish_at <= now()
     returning id, title, starts_at::text, created_by, published_by`,
    [organisationId],
  );
  const ids: string[] = [];
  for (const row of due.rows) {
    await snapshotEventAudience(client, organisationId, row.id);
    await notifyEventUpcoming(client, {
      organisationId,
      actorUserId: row.published_by ?? row.created_by ?? actorUserId,
      eventId: row.id,
      title: row.title,
      startsAt: row.starts_at,
    });
    ids.push(row.id);
  }
  return ids;
}

export async function assertCanReadStaffAnnouncement(
  client: pg.PoolClient,
  actor: Actor,
  announcementId: string,
): Promise<{ created_by: string; status: string }> {
  assertAnyPermission(actor, ANNOUNCEMENT_READ_PERMISSIONS);
  const row = await client.query<{ created_by: string; status: string }>(
    `select created_by, status from announcements where id = $1 and organisation_id = $2`,
    [announcementId, actor.organisationId],
  );
  if (!row.rows[0]) notFound();
  if (canReadSchoolAnnouncements(actor) || canManageSchoolAnnouncements(actor)) return row.rows[0];
  if (row.rows[0].created_by === actor.userId) return row.rows[0];
  const allowed = await announcementVisibleToAssignedStaff(client, actor, announcementId);
  if (!allowed) notFound();
  return row.rows[0];
}

export async function assertCanManageStaffAnnouncement(
  client: pg.PoolClient,
  actor: Actor,
  announcementId: string,
): Promise<{ created_by: string; status: string }> {
  assertAnyPermission(actor, ANNOUNCEMENT_MANAGE_PERMISSIONS);
  const row = await client.query<{ created_by: string; status: string }>(
    `select created_by, status from announcements where id = $1 and organisation_id = $2`,
    [announcementId, actor.organisationId],
  );
  if (!row.rows[0]) notFound();
  if (canManageSchoolAnnouncements(actor)) return row.rows[0];
  if (canManageAssignedAnnouncements(actor) && row.rows[0].created_by === actor.userId) return row.rows[0];
  notFound();
}

export async function announcementVisibleToAssignedStaff(
  client: pg.PoolClient,
  actor: Actor,
  announcementId: string,
): Promise<boolean> {
  const recipient = await client.query(
    `select 1 from announcement_recipients
     where announcement_id = $1 and organisation_id = $2 and user_id = $3
       and audience_role = 'staff'`,
    [announcementId, actor.organisationId, actor.userId],
  );
  if (recipient.rows[0]) return true;
  const published = await client.query<{ status: string }>(
    `select status from announcements where id = $1 and organisation_id = $2`,
    [announcementId, actor.organisationId],
  );
  if (!published.rows[0] || !["published", "expired"].includes(published.rows[0].status)) {
    return false;
  }
  const classIds = await assignedClassIds(client, actor.userId, actor.organisationId!);
  const studentIds = await assignedStudentIds(client, actor.userId, actor.organisationId!);
  const targets = await client.query<{
    target_type: CommunicationTargetType;
    class_id: string | null;
    student_profile_id: string | null;
  }>(
    `select target_type, class_id, student_profile_id
     from announcement_targets
     where announcement_id = $1 and organisation_id = $2`,
    [announcementId, actor.organisationId],
  );
  return targets.rows.some(
    (row) =>
      row.target_type === "whole_school" ||
      row.target_type === "staff" ||
      (row.class_id && classIds.has(row.class_id)) ||
      (row.student_profile_id && studentIds.has(row.student_profile_id)),
  );
}

export async function assertCanReadStaffEvent(
  client: pg.PoolClient,
  actor: Actor,
  eventId: string,
): Promise<{ created_by: string; status: string }> {
  assertAnyPermission(actor, CALENDAR_READ_PERMISSIONS);
  const row = await client.query<{ created_by: string; status: string }>(
    `select created_by, status from school_events where id = $1 and organisation_id = $2`,
    [eventId, actor.organisationId],
  );
  if (!row.rows[0]) notFound();
  if (canReadSchoolCalendar(actor) || canManageSchoolCalendar(actor)) return row.rows[0];
  if (row.rows[0].created_by === actor.userId) return row.rows[0];
  const allowed = await eventVisibleToAssignedStaff(client, actor, eventId);
  if (!allowed) notFound();
  return row.rows[0];
}

export async function assertCanManageStaffEvent(
  client: pg.PoolClient,
  actor: Actor,
  eventId: string,
): Promise<{ created_by: string; status: string }> {
  assertAnyPermission(actor, CALENDAR_MANAGE_PERMISSIONS);
  const row = await client.query<{ created_by: string; status: string }>(
    `select created_by, status from school_events where id = $1 and organisation_id = $2`,
    [eventId, actor.organisationId],
  );
  if (!row.rows[0]) notFound();
  if (canManageSchoolCalendar(actor)) return row.rows[0];
  if (canManageAssignedCalendar(actor) && row.rows[0].created_by === actor.userId) return row.rows[0];
  notFound();
}

export async function eventVisibleToAssignedStaff(
  client: pg.PoolClient,
  actor: Actor,
  eventId: string,
): Promise<boolean> {
  const recipient = await client.query(
    `select 1 from school_event_audience
     where event_id = $1 and organisation_id = $2 and user_id = $3
       and audience_role = 'staff'`,
    [eventId, actor.organisationId, actor.userId],
  );
  if (recipient.rows[0]) return true;
  const published = await client.query<{ status: string }>(
    `select status from school_events where id = $1 and organisation_id = $2`,
    [eventId, actor.organisationId],
  );
  if (!published.rows[0] || published.rows[0].status !== "published") {
    return false;
  }
  const classIds = await assignedClassIds(client, actor.userId, actor.organisationId!);
  const studentIds = await assignedStudentIds(client, actor.userId, actor.organisationId!);
  const targets = await client.query<{
    target_type: CommunicationTargetType;
    class_id: string | null;
    student_profile_id: string | null;
  }>(
    `select target_type, class_id, student_profile_id
     from school_event_targets
     where event_id = $1 and organisation_id = $2`,
    [eventId, actor.organisationId],
  );
  return targets.rows.some(
    (row) =>
      row.target_type === "whole_school" ||
      row.target_type === "staff" ||
      (row.class_id && classIds.has(row.class_id)) ||
      (row.student_profile_id && studentIds.has(row.student_profile_id)),
  );
}

export function targetsAreStaffOnly(targets: Array<{ targetType: string }>): boolean {
  if (targets.length === 0) return false;
  return targets.every((target) => isStaffOnlyTargetType(target.targetType as CommunicationTargetType));
}

export async function loadAnnouncementReceiptSummary(
  client: pg.PoolClient,
  organisationId: string,
  announcementId: string,
  acknowledgementRequired: boolean,
) {
  const counts = await client.query<{ recipients: number; read: number; acknowledged: number }>(
    `select
       count(*)::int as recipients,
       count(read_at)::int as read,
       count(acknowledged_at)::int as acknowledged
     from announcement_recipients
     where announcement_id = $1 and organisation_id = $2`,
    [announcementId, organisationId],
  );
  return summariseAnnouncementReceipts({
    recipients: counts.rows[0]?.recipients ?? 0,
    read: counts.rows[0]?.read ?? 0,
    acknowledged: counts.rows[0]?.acknowledged ?? 0,
    acknowledgementRequired,
  });
}

export async function auditCommunication(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await writeAudit(client, input);
}
