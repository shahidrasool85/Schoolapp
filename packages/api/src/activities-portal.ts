import type pg from "pg";
import { z } from "zod";
import {
  AppError,
  activityDocumentVisibleToAudience,
  activityResponseWindowOpen,
  activityVisibleOnPortal,
  applyConsentDecision,
  allocateRegistrationStatus,
  auditActivity,
  guardianMayRespond,
  lockActivityCapacity,
  maybePromoteNextWaitlisted,
  nextWaitingListPosition,
  pupilIsEligible,
  requireLinkedChild,
  requireStudentPortalEnabled,
  upsertParticipant,
} from "@schoolapp/core";
import {
  mapActivityClause,
  mapActivityDocument,
  mapActivityUpdate,
  mapSchoolActivity,
} from "./serialize";
import { expandActivityOccurrences } from "@schoolapp/core";

const PORTAL_ACTIVITY_SELECT = `
  select a.*, t.key as activity_type_key, t.name as activity_type_name, e.student_profile_id
  from school_activities a
  join school_activity_types t on t.id = a.activity_type_id
  join school_activity_eligible_pupils e
    on e.activity_id = a.id and e.organisation_id = a.organisation_id
`;

export async function listPortalActivities(
  client: pg.PoolClient,
  input: {
    orgId: string;
    studentIds: string[];
    audience: "parent" | "student";
  },
) {
  if (input.studentIds.length === 0) return [];
  const rows = await client.query(
    `${PORTAL_ACTIVITY_SELECT}
     where a.organisation_id = $1
       and e.student_profile_id = any($2::uuid[])
       and a.status in ('published', 'closed', 'completed', 'cancelled')
       and ($3::text = 'parent' and a.parent_visible or $3::text = 'student' and a.student_visible)
     order by a.starts_at, a.title`,
    [input.orgId, input.studentIds, input.audience],
  );
  const unique = new Map<string, Record<string, unknown>>();
  for (const row of rows.rows as Array<Record<string, unknown>>) {
    unique.set(String(row.id), row);
  }
  const activities = [...unique.values()];
  const result = [];
  for (const activity of activities) {
    const activityId = String(activity.id);
    const children = [];
    for (const studentId of input.studentIds) {
      const eligible = rows.rows.some(
        (row) => String(row.id) === activityId && String(row.student_profile_id) === studentId,
      );
      if (!eligible) continue;
      const participant = await client.query<{
        registration_status: string;
        waiting_list_position: number | null;
      }>(
        `select registration_status, waiting_list_position
         from school_activity_participants
         where activity_id = $1 and student_profile_id = $2 and organisation_id = $3`,
        [activityId, studentId, input.orgId],
      );
      const response = await client.query<{ response: string }>(
        `select response from school_activity_responses
         where activity_id = $1 and student_profile_id = $2 and organisation_id = $3 and is_effective`,
        [activityId, studentId, input.orgId],
      );
      const consent = response.rows[0]?.response ?? "pending";
      children.push({
        studentProfileId: studentId,
        consentResponse: consent,
        registrationStatus: participant.rows[0]?.registration_status ?? null,
        waitingListPosition: participant.rows[0]?.waiting_list_position ?? null,
        actionRequired:
          input.audience === "parent" &&
          Boolean(activity.consent_required) &&
          consent === "pending" &&
          activity.status === "published",
      });
    }
    result.push({
      ...mapSchoolActivity(activity, { portal: true }),
      children,
    });
  }
  return result;
}

export async function loadPortalActivityDetail(
  client: pg.PoolClient,
  input: {
    orgId: string;
    activityId: string;
    studentId: string;
    audience: "parent" | "student";
  },
) {
  const activity = await client.query(
    `${PORTAL_ACTIVITY_SELECT}
     where a.id = $1 and a.organisation_id = $2 and e.student_profile_id = $3`,
    [input.activityId, input.orgId, input.studentId],
  );
  const row = activity.rows[0] as Record<string, unknown> | undefined;
  if (!row || !activityVisibleOnPortal({
    status: String(row.status),
    parentVisible: row.parent_visible !== false,
    studentVisible: row.student_visible !== false,
    audience: input.audience,
  })) {
    throw new AppError(404, "not_found", "Not found");
  }
  const [clauses, documents, updates, participant, response] = await Promise.all([
    input.audience === "parent"
      ? client.query(
          `select * from school_activity_consent_clauses where activity_id = $1 order by sort_order`,
          [input.activityId],
        )
      : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
    client.query(
      `select * from school_activity_documents where activity_id = $1 and deleted_at is null`,
      [input.activityId],
    ),
    client.query(
      `select * from school_activity_updates where activity_id = $1 order by published_at desc`,
      [input.activityId],
    ),
    client.query(
      `select registration_status, waiting_list_position
       from school_activity_participants
       where activity_id = $1 and student_profile_id = $2`,
      [input.activityId, input.studentId],
    ),
    client.query(
      `select response, wording_snapshot, consent_version, responded_at, comment, channel
       from school_activity_responses
       where activity_id = $1 and student_profile_id = $2 and is_effective`,
      [input.activityId, input.studentId],
    ),
  ]);
  const visibleDocs = documents.rows.filter((doc) =>
    activityDocumentVisibleToAudience(String(doc.visibility), input.audience),
  );
  const visibleUpdates = updates.rows.filter((update) =>
    input.audience === "parent" ? update.parent_visible : update.student_visible,
  );
  return {
    activity: mapSchoolActivity(row, { portal: true }),
    consentClauses: clauses.rows.map((item) => mapActivityClause(item as Record<string, unknown>)),
    documents: visibleDocs.map((item) => mapActivityDocument(item as Record<string, unknown>)),
    updates: visibleUpdates.map((item) => mapActivityUpdate(item as Record<string, unknown>)),
    child: {
      studentProfileId: input.studentId,
      consentResponse: (response.rows[0] as { response?: string } | undefined)?.response ?? "pending",
      registrationStatus: (participant.rows[0] as { registration_status?: string } | undefined)?.registration_status ?? null,
      waitingListPosition:
        (participant.rows[0] as { waiting_list_position?: number | null } | undefined)?.waiting_list_position ?? null,
      lastResponse: input.audience === "parent" ? (response.rows[0] ?? null) : null,
    },
  };
}

const respondSchema = z.object({
  response: z.enum(["consented", "declined", "withdrawn"]),
  comment: z.string().max(4000).optional(),
  emergencyMedicalAcknowledged: z.boolean().optional(),
  confirm: z.literal(true),
  createdBy: z.string().uuid().optional(),
  guardianUserId: z.string().uuid().optional(),
});

export async function parentRespondToActivity(
  client: pg.PoolClient,
  input: {
    orgId: string;
    userId: string;
    studentId: string;
    activityId: string;
    body: unknown;
  },
) {
  await requireLinkedChild(client, input.userId, input.orgId, input.studentId);
  const guardian = await guardianMayRespond(client, input.orgId, input.userId, input.studentId);
  if (!guardian) throw new AppError(403, "forbidden", "You cannot respond for this child");
  const parsed = respondSchema.safeParse(input.body);
  if (!parsed.success) {
    throw new AppError(400, "validation_failed", "Consent must be confirmed explicitly");
  }
  const activity = await client.query(
    `select * from school_activities where id = $1 and organisation_id = $2`,
    [input.activityId, input.orgId],
  );
  const row = activity.rows[0];
  if (!row || !activityVisibleOnPortal({
    status: row.status,
    parentVisible: row.parent_visible,
    audience: "parent",
  })) {
    throw new AppError(404, "not_found", "Not found");
  }
  if (row.status === "cancelled") {
    throw new AppError(409, "activity_cancelled", "This activity has been cancelled");
  }
  if (row.status === "completed" || row.status === "archived") {
    throw new AppError(409, "activity_closed", "This activity is no longer open to change");
  }
  if (!(await pupilIsEligible(client, input.orgId, input.activityId, input.studentId))) {
    throw new AppError(400, "no_longer_eligible", "This pupil is not eligible for the activity");
  }
  if (parsed.data.response !== "withdrawn") {
    if (
      !activityResponseWindowOpen({
        status: row.status,
        responseDeadlineAt: row.response_deadline_at,
        allowAfterDeadline: row.allow_responses_after_deadline,
      })
    ) {
      throw new AppError(409, "response_deadline_passed", "The response deadline has passed");
    }
  }
  if (!row.consent_required && !row.parent_response_required && parsed.data.response !== "withdrawn") {
    throw new AppError(400, "validation_failed", "Parent response is not required for this activity");
  }
  const result = await applyConsentDecision(client, {
    organisationId: input.orgId,
    activityId: input.activityId,
    studentProfileId: input.studentId,
    actorUserId: input.userId,
    title: row.title,
    channel: "parent_portal",
    response: parsed.data.response,
    source: "parent_consent",
    guardianUserId: input.userId,
    guardianshipId: guardian.guardianshipId,
    comment: parsed.data.comment,
    emergencyMedicalAcknowledged: parsed.data.emergencyMedicalAcknowledged,
  });
  await auditActivity(client, {
    organisationId: input.orgId,
    actorUserId: input.userId,
    action: parsed.data.response === "withdrawn" ? "activity.consent_withdrawn" : "activity.consent_given",
    activityId: input.activityId,
    after: { studentProfileId: input.studentId, response: parsed.data.response, channel: "parent_portal" },
  });
  return result;
}

export async function studentSignupForActivity(
  client: pg.PoolClient,
  input: {
    orgId: string;
    userId: string;
    activityId: string;
    withdraw?: boolean;
  },
) {
  const studentId = await requireStudentPortalEnabled(client, input.orgId, input.userId);
  const activity = await client.query(
    `select * from school_activities where id = $1 and organisation_id = $2`,
    [input.activityId, input.orgId],
  );
  const row = activity.rows[0];
  if (!row || !activityVisibleOnPortal({
    status: row.status,
    studentVisible: row.student_visible,
    audience: "student",
  })) {
    throw new AppError(404, "not_found", "Not found");
  }
  if (row.status === "cancelled") {
    throw new AppError(409, "activity_cancelled", "This activity has been cancelled");
  }
  if (!(await pupilIsEligible(client, input.orgId, input.activityId, studentId))) {
    throw new AppError(404, "not_found", "Not found");
  }
  if (input.withdraw) {
    if (row.status === "completed" || row.status === "archived") {
      throw new AppError(409, "activity_closed", "This activity is no longer open to change");
    }
    await lockActivityCapacity(client, input.orgId, input.activityId);
    await client.query(
      `update school_activity_participants
          set registration_status = 'withdrawn', waiting_list_position = null, withdrawn_at = now()
        where activity_id = $1 and student_profile_id = $2 and organisation_id = $3`,
      [input.activityId, studentId, input.orgId],
    );
    await maybePromoteNextWaitlisted(client, {
      organisationId: input.orgId,
      activityId: input.activityId,
      actorUserId: input.userId,
      title: String(row.title),
    });
    await auditActivity(client, {
      organisationId: input.orgId,
      actorUserId: input.userId,
      action: "activity.student_withdrawn",
      activityId: input.activityId,
      after: { studentProfileId: studentId },
    });
    return { registrationStatus: "withdrawn", waitingListPosition: null };
  }
  if (
    !activityResponseWindowOpen({
      status: row.status,
      responseDeadlineAt: row.response_deadline_at,
      allowAfterDeadline: row.allow_responses_after_deadline,
    })
  ) {
    throw new AppError(409, "response_deadline_passed", "Sign-up is no longer open for this activity");
  }
  if (!row.student_signup_enabled) {
    throw new AppError(403, "forbidden", "Student sign-up is not enabled for this activity");
  }
  if (row.consent_required) {
    throw new AppError(403, "forbidden", "This activity requires parent consent rather than student sign-up");
  }
  const locked = await lockActivityCapacity(client, input.orgId, input.activityId);
  const status = allocateRegistrationStatus({
    capacity: locked.capacity,
    confirmedCount: locked.confirmedCount,
    preferConfirmed: true,
  });
  const waitingListPosition =
    status === "waitlisted" ? nextWaitingListPosition(locked.waitlistPositions) : null;
  await upsertParticipant(client, {
    organisationId: input.orgId,
    activityId: input.activityId,
    studentProfileId: studentId,
    registrationStatus: status,
    waitingListPosition,
    source: "student_signup",
    confirmedAt: status === "confirmed" ? new Date().toISOString() : null,
  });
  await auditActivity(client, {
    organisationId: input.orgId,
    actorUserId: input.userId,
    action: "activity.student_signup",
    activityId: input.activityId,
    after: { studentProfileId: studentId, status },
  });
  return { registrationStatus: status, waitingListPosition };
}

export function calendarItemsFromActivities(
  rows: Array<Record<string, unknown>>,
  from?: string | null,
  to?: string | null,
) {
  const items = [];
  for (const row of rows) {
    const occurrences = expandActivityOccurrences({
      startsAt: row.starts_at as string | Date,
      endsAt: row.ends_at as string | Date,
      occurrenceKind: String(row.occurrence_kind ?? "one_off"),
      recurrenceWeekdays: row.recurrence_weekdays,
      recurrenceUntil: row.recurrence_until ?? null,
      from: from ?? null,
      to: to ?? null,
    });
    for (const occurrence of occurrences) {
      items.push({
        source: "activity" as const,
        id: row.id,
        title: row.title,
        description: row.description ?? null,
        activityTypeKey: row.activity_type_key ?? null,
        activityTypeName: row.activity_type_name ?? null,
        status: row.status,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        allDay: row.all_day,
        location: row.location ?? null,
      });
    }
  }
  return items;
}
