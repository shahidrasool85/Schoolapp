import type pg from "pg";
import { AppError } from "@schoolapp/core";
import { mapAnnouncement, mapCommunicationResource, mapRelatedSubject, mapSchoolEvent } from "./serialize";

const PORTAL_ANNOUNCEMENT_SELECT = `
  select
    a.id,
    a.title,
    a.body,
    a.priority,
    case
      when a.status = 'published' and a.expires_at is not null and a.expires_at <= now() then 'expired'
      else a.status
    end as effective_status,
    a.publish_at,
    a.published_at,
    a.expires_at,
    a.acknowledgement_required,
    a.pinned,
    a.created_at,
    r.read_at,
    r.acknowledged_at
  from announcements a
  join announcement_recipients r
    on r.announcement_id = a.id
   and r.organisation_id = a.organisation_id
`;

const PORTAL_EVENT_SELECT = `
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
    e.resource_url
  from school_events e
  join school_event_types et on et.id = e.event_type_id
  join school_event_audience au
    on au.event_id = e.id
   and au.organisation_id = e.organisation_id
`;

export async function loadPortalAnnouncementResources(
  client: pg.PoolClient,
  orgId: string,
  announcementId: string,
) {
  const result = await client.query(
    `select id, title, resource_kind, url, content_type, byte_size, storage_backend
     from announcement_resources
     where announcement_id = $1 and organisation_id = $2
     order by sort_order, created_at`,
    [announcementId, orgId],
  );
  return result.rows.map((row) => mapCommunicationResource(row as Record<string, unknown>));
}

export async function loadPortalAnnouncementSubjects(
  client: pg.PoolClient,
  orgId: string,
  announcementId: string,
  userId: string,
  allowedStudentIds?: string[],
) {
  const result = await client.query(
    `select s.student_profile_id, sp.legal_name as student_legal_name,
            s.class_id, c.name as class_name, s.year_group_id, yg.name as year_group_name
     from announcement_recipient_subjects s
     join student_profiles sp on sp.id = s.student_profile_id
     left join classes c on c.id = s.class_id
     left join year_groups yg on yg.id = s.year_group_id
     where s.announcement_id = $1
       and s.organisation_id = $2
       and s.user_id = $3
       and ($4::uuid[] is null or s.student_profile_id = any($4::uuid[]))
     order by sp.legal_name`,
    [announcementId, orgId, userId, allowedStudentIds ?? null],
  );
  return result.rows.map((row) => mapRelatedSubject(row as Record<string, unknown>));
}

function liveParentSubjectIds(audienceRole: "parent" | "student", allowedStudentIds?: string[]) {
  return audienceRole === "parent" ? (allowedStudentIds ?? []) : null;
}

export async function listPortalAnnouncements(
  client: pg.PoolClient,
  input: {
    orgId: string;
    userId: string;
    audienceRole: "parent" | "student";
    includeExpired?: boolean;
    allowedStudentIds?: string[];
  },
) {
  const result = await client.query(
    `${PORTAL_ANNOUNCEMENT_SELECT}
     where a.organisation_id = $1
       and r.user_id = $2
       and r.audience_role = $3
       and a.status in ('published', 'expired')
       and (
         $4::boolean = true
         or a.status = 'published' and (a.expires_at is null or a.expires_at > now())
       )
       and (
         ($3 = 'student' and r.audience_role = 'student')
         or (
           $3 = 'parent'
           and exists (
             select 1
             from announcement_recipient_subjects s
             where s.announcement_id = a.id
               and s.organisation_id = a.organisation_id
               and s.user_id = r.user_id
               and s.student_profile_id = any($5::uuid[])
           )
         )
       )
     order by a.pinned desc, a.published_at desc, a.created_at desc`,
    [
      input.orgId,
      input.userId,
      input.audienceRole,
      input.includeExpired ?? false,
      liveParentSubjectIds(input.audienceRole, input.allowedStudentIds),
    ],
  );
  return result.rows.map((row) => mapAnnouncement(row as Record<string, unknown>, { audience: input.audienceRole }));
}

export async function loadPortalAnnouncement(
  client: pg.PoolClient,
  input: {
    orgId: string;
    userId: string;
    announcementId: string;
    audienceRole: "parent" | "student";
    allowedStudentIds?: string[];
  },
) {
  const result = await client.query(
    `${PORTAL_ANNOUNCEMENT_SELECT}
     where a.organisation_id = $1
       and a.id = $2
       and r.user_id = $3
       and r.audience_role = $4
       and a.status in ('published', 'expired')
       and (
         ($4 = 'student' and r.audience_role = 'student')
         or (
           $4 = 'parent'
           and exists (
             select 1
             from announcement_recipient_subjects s
             where s.announcement_id = a.id
               and s.organisation_id = a.organisation_id
               and s.user_id = r.user_id
               and s.student_profile_id = any($5::uuid[])
           )
         )
       )`,
    [
      input.orgId,
      input.announcementId,
      input.userId,
      input.audienceRole,
      liveParentSubjectIds(input.audienceRole, input.allowedStudentIds),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, "not_found", "Not found");
  return mapAnnouncement(row as Record<string, unknown>, { audience: input.audienceRole });
}

export async function markPortalAnnouncementRead(
  client: pg.PoolClient,
  orgId: string,
  userId: string,
  announcementId: string,
) {
  const result = await client.query(
    `update announcement_recipients
     set read_at = coalesce(read_at, now())
     where announcement_id = $1
       and organisation_id = $2
       and user_id = $3
     returning read_at, acknowledged_at`,
    [announcementId, orgId, userId],
  );
  if (!result.rows[0]) throw new AppError(404, "not_found", "Not found");
  return result.rows[0];
}

export async function acknowledgePortalAnnouncement(
  client: pg.PoolClient,
  orgId: string,
  userId: string,
  announcementId: string,
) {
  const required = await client.query<{ acknowledgement_required: boolean }>(
    `select a.acknowledgement_required
     from announcements a
     join announcement_recipients r
       on r.announcement_id = a.id and r.organisation_id = a.organisation_id
     where a.id = $1 and a.organisation_id = $2 and r.user_id = $3
       and a.status in ('published', 'expired')`,
    [announcementId, orgId, userId],
  );
  if (!required.rows[0]) throw new AppError(404, "not_found", "Not found");
  if (!required.rows[0].acknowledgement_required) {
    throw new AppError(400, "validation_failed", "Acknowledgement is not required for this notice");
  }
  const result = await client.query(
    `update announcement_recipients
     set acknowledged_at = coalesce(acknowledged_at, now()),
         read_at = coalesce(read_at, now())
     where announcement_id = $1
       and organisation_id = $2
       and user_id = $3
     returning read_at, acknowledged_at`,
    [announcementId, orgId, userId],
  );
  if (!result.rows[0]) throw new AppError(404, "not_found", "Not found");
  return result.rows[0];
}

export async function listPortalEvents(
  client: pg.PoolClient,
  input: {
    orgId: string;
    userId: string;
    audienceRole: "parent" | "student";
    from?: string | null;
    to?: string | null;
    allowedStudentIds?: string[];
  },
) {
  const result = await client.query(
    `${PORTAL_EVENT_SELECT}
     where e.organisation_id = $1
       and au.user_id = $2
       and au.audience_role = $3
       and e.status = 'published'
       and ($4::timestamptz is null or e.ends_at >= $4::timestamptz)
       and ($5::timestamptz is null or e.starts_at <= $5::timestamptz)
       and (
         ($3 = 'student' and au.audience_role = 'student')
         or (
           $3 = 'parent'
           and exists (
             select 1
             from school_event_audience_subjects s
             where s.event_id = e.id
               and s.organisation_id = e.organisation_id
               and s.user_id = au.user_id
               and s.student_profile_id = any($6::uuid[])
           )
         )
       )
     order by e.starts_at, e.title`,
    [
      input.orgId,
      input.userId,
      input.audienceRole,
      input.from ?? null,
      input.to ?? null,
      liveParentSubjectIds(input.audienceRole, input.allowedStudentIds),
    ],
  );
  return result.rows.map((row) => mapSchoolEvent(row as Record<string, unknown>, { audience: input.audienceRole }));
}

export async function loadPortalEvent(
  client: pg.PoolClient,
  input: {
    orgId: string;
    userId: string;
    eventId: string;
    audienceRole: "parent" | "student";
    allowedStudentIds?: string[];
  },
) {
  const result = await client.query(
    `${PORTAL_EVENT_SELECT}
     where e.organisation_id = $1
       and e.id = $2
       and au.user_id = $3
       and au.audience_role = $4
       and e.status in ('published', 'cancelled')
       and (
         ($4 = 'student' and au.audience_role = 'student')
         or (
           $4 = 'parent'
           and exists (
             select 1
             from school_event_audience_subjects s
             where s.event_id = e.id
               and s.organisation_id = e.organisation_id
               and s.user_id = au.user_id
               and s.student_profile_id = any($5::uuid[])
           )
         )
       )`,
    [
      input.orgId,
      input.eventId,
      input.userId,
      input.audienceRole,
      liveParentSubjectIds(input.audienceRole, input.allowedStudentIds),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, "not_found", "Not found");
  return mapSchoolEvent(row as Record<string, unknown>, { audience: input.audienceRole });
}

export async function loadPortalEventSubjects(
  client: pg.PoolClient,
  orgId: string,
  eventId: string,
  userId: string,
  allowedStudentIds?: string[],
) {
  const result = await client.query(
    `select s.student_profile_id, sp.legal_name as student_legal_name,
            s.class_id, c.name as class_name, s.year_group_id, yg.name as year_group_name
     from school_event_audience_subjects s
     join student_profiles sp on sp.id = s.student_profile_id
     left join classes c on c.id = s.class_id
     left join year_groups yg on yg.id = s.year_group_id
     where s.event_id = $1
       and s.organisation_id = $2
       and s.user_id = $3
       and ($4::uuid[] is null or s.student_profile_id = any($4::uuid[]))
     order by sp.legal_name`,
    [eventId, orgId, userId, allowedStudentIds ?? null],
  );
  return result.rows.map((row) => mapRelatedSubject(row as Record<string, unknown>));
}
