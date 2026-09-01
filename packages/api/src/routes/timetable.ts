import { z } from "zod";
import {
  APPLY_FROM_NO_REMAINING_LESSONS,
  PERMISSIONS,
  RECURRENCE_DELETE_BLOCKED,
  RECURRENCE_STRUCTURAL_EDIT_BLOCKED,
  computeRecurrenceStatus,
  effectiveUntilFromStopFrom,
  recurrencePatchTouchesStructure,
  validateRecurrenceApplyFrom,
  validateRecurrenceStopFrom,
} from "@schoolapp/domain";
import {
  AppError,
  assertAnyPermission,
  assertCanManageTimetable,
  assertCanReadClassTimetable,
  assertPermission,
  authorisedTimetableClassIds,
  coveredEntryIds,
  eachDateInclusive,
  permanentlyAssignedClassIds,
  participatingEntryIds,
  canManageCover,
  canManageRooms,
  canManageSchoolDay,
  canReadCover,
  canReadRooms,
  canReadSchoolTimetable,
  firstTimetableOccurrence,
  isoDate,
  isoWeekdayFromDate,
  isoWeekRange,
  listResolvedRecurrenceDates,
  loadRecurrenceLifecycle,
  loadStudentClassMembershipsOverlapping,
  pgErrorToAppError,
  recurringLessonSavedMessage,
  requireOrgRow,
  resolveAttendanceRegisterTarget,
  resolveRepeatUntilRule,
  resolveTimetableOccurrences,
  schoolToday,
  startOfIsoWeek,
  timetableConflictMessage,
  writeAudit,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import {
  mapRoom,
  mapSchoolDayPeriod,
  mapSchoolDayProfile,
  mapTimetableCover,
  mapTimetableEntry,
  mapTimetableException,
  mapTimetableOccurrence,
} from "../serialize";

const weekdaySchema = z.number().int().min(1).max(7);
const weekdaysSchema = z.array(weekdaySchema).min(1);
const timeSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const profileSchema = z.object({
  academicYearId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  weekdays: weekdaysSchema,
  startsAt: timeSchema,
  endsAt: timeSchema,
  isActive: z.boolean().optional(),
});

const periodSchema = z.object({
  name: z.string().trim().min(1).max(80),
  shortCode: z.string().trim().min(1).max(20).optional(),
  periodType: z.enum(["teaching", "registration", "break", "lunch", "assembly", "other"]),
  startsAt: timeSchema,
  endsAt: timeSchema,
  sortOrder: z.number().int().optional(),
  attendanceSessionTypeId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

const roomSchema = z.object({
  name: z.string().trim().min(1).max(80),
  shortCode: z.string().trim().min(1).max(20),
  building: z.string().trim().min(1).max(80).optional(),
  locationDetail: z.string().trim().min(1).max(200).optional(),
  capacity: z.number().int().positive().optional(),
  locationType: z.enum(["teaching", "non_teaching"]).optional(),
  isActive: z.boolean().optional(),
});

const teacherInputSchema = z.object({
  staffProfileId: z.string().uuid(),
  participationRole: z.enum(["teacher", "co_teacher", "teaching_assistant", "support"]).optional(),
  isPrimary: z.boolean().optional(),
});

const entrySchema = z.object({
  academicYearId: z.string().uuid(),
  termId: z.string().uuid().nullable().optional(),
  schoolDayPeriodId: z.string().uuid().nullable().optional(),
  customTime: z.boolean().optional(),
  weekday: weekdaySchema,
  startsAt: timeSchema.optional(),
  endsAt: timeSchema.optional(),
  classId: z.string().uuid(),
  yearGroupId: z.string().uuid().nullable().optional(),
  subjectId: z.string().uuid().nullable().optional(),
  roomId: z.string().uuid().nullable().optional(),
  lessonType: z.enum(["lesson", "registration", "assembly", "other"]).optional(),
  isActive: z.boolean().optional(),
  effectiveFrom: dateSchema,
  effectiveUntil: dateSchema.nullable().optional(),
  staffNotes: z.string().max(2000).nullable().optional(),
  teachers: z.array(teacherInputSchema).min(1),
  repeatUntil: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("end_of_term") }),
      z.object({ kind: z.literal("end_of_academic_year") }),
      z.object({ kind: z.literal("custom_date"), date: dateSchema }),
      z.object({ kind: z.literal("occurrence_count"), count: z.number().int() }),
    ])
    .optional(),
});

const recurrencePreviewSchema = z.object({
  academicYearId: z.string().uuid(),
  termId: z.string().uuid().nullable().optional(),
  weekday: weekdaySchema,
  effectiveFrom: dateSchema,
  effectiveUntil: dateSchema.nullable().optional(),
  schoolDayPeriodId: z.string().uuid().nullable().optional(),
  customTime: z.boolean().optional(),
  startsAt: timeSchema.optional(),
  endsAt: timeSchema.optional(),
  classId: z.string().uuid().optional(),
  subjectId: z.string().uuid().nullable().optional(),
  roomId: z.string().uuid().nullable().optional(),
  lessonType: z.enum(["lesson", "registration", "assembly", "other"]).optional(),
  teachers: z.array(teacherInputSchema).optional(),
  repeatUntil: entrySchema.shape.repeatUntil,
});

const exceptionSchema = z.object({
  timetableEntryId: z.string().uuid().nullable().optional(),
  date: dateSchema,
  exceptionType: z.enum([
    "cancelled",
    "room_changed",
    "teacher_changed",
    "replacement",
    "school_closure",
    "special_activity",
  ]),
  replacementRoomId: z.string().uuid().nullable().optional(),
  replacementSubjectId: z.string().uuid().nullable().optional(),
  replacementStartsAt: timeSchema.nullable().optional(),
  replacementEndsAt: timeSchema.nullable().optional(),
  replacementLessonType: z.enum(["lesson", "registration", "assembly", "other"]).nullable().optional(),
  parentVisibleNote: z.string().max(400).nullable().optional(),
  staffNotes: z.string().max(2000).nullable().optional(),
});

const coverSchema = z.object({
  timetableEntryId: z.string().uuid(),
  date: dateSchema,
  originalStaffProfileId: z.string().uuid().optional(),
  coveringStaffProfileId: z.string().uuid(),
  reason: z.string().max(400).nullable().optional(),
  staffNotes: z.string().max(2000).nullable().optional(),
});

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, "validation_failed", "The request is invalid");
  }
  return parsed.data;
}

async function loadEntryTeachers(client: Parameters<typeof requireOrgRow>[0], organisationId: string, entryId: string) {
  const result = await client.query(
    `select
       tet.staff_profile_id as "staffProfileId",
       u.full_name as "fullName",
       tet.participation_role as "participationRole",
       tet.is_primary as "isPrimary"
     from timetable_entry_teachers tet
     join staff_profiles sp on sp.id = tet.staff_profile_id
     join users u on u.id = sp.user_id
     where tet.organisation_id = $1 and tet.timetable_entry_id = $2
     order by tet.is_primary desc, u.full_name`,
    [organisationId, entryId],
  );
  return result.rows;
}

async function loadEntryRow(client: Parameters<typeof requireOrgRow>[0], organisationId: string, entryId: string) {
  const result = await client.query(
    `select
       te.*,
       te.starts_at::text,
       te.ends_at::text,
       te.effective_from::text,
       te.effective_until::text,
       c.name as class_name,
       yg.name as year_group_name,
       s.name as subject_name,
       r.name as room_name
     from timetable_entries te
     join classes c on c.id = te.class_id
     left join year_groups yg on yg.id = te.year_group_id
     left join subjects s on s.id = te.subject_id
     left join rooms r on r.id = te.room_id
     where te.id = $1 and te.organisation_id = $2`,
    [entryId, organisationId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, "not_found", "Not found");
  return { ...row, teachers: await loadEntryTeachers(client, organisationId, entryId) };
}

function entryLifecycleFields(row: Record<string, unknown>, today: string) {
  const effectiveFrom = String(row.effective_from ?? row.effectiveFrom);
  const effectiveUntil = (row.effective_until ?? row.effectiveUntil ?? null) as string | null;
  const isActive = Boolean(row.is_active ?? row.isActive);
  return {
    lifecycleStatus: computeRecurrenceStatus({
      effectiveFrom,
      effectiveUntil,
      isActive,
      today,
    }),
    effectiveFrom,
    effectiveUntil,
    isActive,
  };
}

async function mapManagedEntry(
  client: Parameters<typeof requireOrgRow>[0],
  organisationId: string,
  row: Record<string, unknown>,
  today: string,
  options?: { includeLifecycle?: boolean },
) {
  const entry = mapTimetableEntry(row);
  const fields = entryLifecycleFields(row, today);
  if (!options?.includeLifecycle) {
    return { ...entry, lifecycleStatus: fields.lifecycleStatus };
  }
  const lifecycle = await loadRecurrenceLifecycle(
    client,
    organisationId,
    {
      id: String(row.id),
      classId: String(row.class_id),
      weekday: Number(row.weekday),
      effectiveFrom: fields.effectiveFrom,
      effectiveUntil: fields.effectiveUntil,
      isActive: fields.isActive,
    },
    today,
  );
  return { ...entry, lifecycleStatus: lifecycle.status, lifecycle };
}

async function resolveEntryRepeatUntil(
  client: Parameters<typeof requireOrgRow>[0],
  organisationId: string,
  body: {
    academicYearId: string;
    weekday: number;
    effectiveFrom: string;
    termId?: string | null;
    effectiveUntil?: string | null;
    repeatUntil?: z.infer<typeof entrySchema>["repeatUntil"];
  },
) {
  if (!body.repeatUntil) {
    return {
      effectiveUntil: body.effectiveUntil ?? null,
      resolved: null as Awaited<ReturnType<typeof resolveRepeatUntilRule>> | null,
    };
  }
  const resolved = await resolveRepeatUntilRule(client, organisationId, {
    academicYearId: body.academicYearId,
    weekday: body.weekday,
    effectiveFrom: body.effectiveFrom,
    termId: body.termId ?? null,
    repeatUntil: body.repeatUntil,
  });
  if (!resolved.ok) {
    throw new AppError(400, "validation_failed", resolved.error);
  }
  return { effectiveUntil: resolved.effectiveUntil, resolved };
}

async function previewRecurrencePayload(
  client: Parameters<typeof requireOrgRow>[0],
  organisationId: string,
  body: z.infer<typeof recurrencePreviewSchema>,
) {
  const window = await resolveEntryRepeatUntil(client, organisationId, body);
  const listed = window.resolved?.ok
    ? { academicYear: window.resolved.academicYear, dates: window.resolved.dates }
    : await listResolvedRecurrenceDates(client, organisationId, {
        academicYearId: body.academicYearId,
        weekday: body.weekday,
        effectiveFrom: body.effectiveFrom,
        effectiveUntil: window.effectiveUntil,
        termId: body.termId ?? null,
      });
  let startsAt = body.startsAt ?? null;
  let endsAt = body.endsAt ?? null;
  if (body.schoolDayPeriodId && body.customTime !== true) {
    const period = await requireOrgRow(client, "school_day_periods", body.schoolDayPeriodId, organisationId);
    startsAt = String(period.starts_at);
    endsAt = String(period.ends_at);
  }
  let className: string | null = null;
  let subjectName: string | null = null;
  let roomName: string | null = null;
  const teacherNames: string[] = [];
  if (body.classId) {
    const row = await client.query<{ name: string }>(
      "select name from classes where id = $1 and organisation_id = $2",
      [body.classId, organisationId],
    );
    className = row.rows[0]?.name ?? null;
  }
  if (body.subjectId) {
    const row = await client.query<{ name: string }>(
      "select name from subjects where id = $1 and organisation_id = $2",
      [body.subjectId, organisationId],
    );
    subjectName = row.rows[0]?.name ?? null;
  }
  if (body.roomId) {
    const row = await client.query<{ name: string }>(
      "select name from rooms where id = $1 and organisation_id = $2",
      [body.roomId, organisationId],
    );
    roomName = row.rows[0]?.name ?? null;
  }
  for (const teacher of body.teachers ?? []) {
    const row = await client.query<{ full_name: string }>(
      `select u.full_name
       from staff_profiles sp
       join users u on u.id = sp.user_id
       where sp.id = $1 and sp.organisation_id = $2`,
      [teacher.staffProfileId, organisationId],
    );
    if (row.rows[0]) teacherNames.push(row.rows[0].full_name);
  }
  const dates = listed.dates;
  return {
    effectiveFrom: body.effectiveFrom,
    effectiveUntil: window.effectiveUntil,
    repeatUntilKind: window.resolved && window.resolved.ok ? window.resolved.kind : null,
    repeatUntilLabel:
      window.resolved && window.resolved.ok
        ? window.resolved.label
        : window.effectiveUntil
          ? `Ends ${window.effectiveUntil}`
          : "No end date",
    occurrenceCount: dates.length,
    dates,
    firstOccurrence: dates[0] ?? null,
    lastOccurrence: dates[dates.length - 1] ?? null,
    term: window.resolved && window.resolved.ok ? window.resolved.term : null,
    academicYear: listed.academicYear,
    weekday: body.weekday,
    startsAt,
    endsAt,
    className,
    subjectName,
    roomName,
    teacherNames,
  };
}

export function registerTimetableRoutes(app: SchoolappApi) {
  app.get("/timetable/overview", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [
        PERMISSIONS.TIMETABLE_READ,
        PERMISSIONS.TIMETABLE_READ_ASSIGNED,
        PERMISSIONS.TIMETABLE_MANAGE,
        PERMISSIONS.TIMETABLE_MANAGE_SCHOOL,
      ]);
      const today = await schoolToday(client, orgId);
      const weekStart = startOfIsoWeek(today);
      const from = weekStart;
      const to = addDaysSafe(weekStart, 6);
      const authorisedByDate = canReadSchoolTimetable(actor)
        ? null
        : await authorisedClassIdsByDate(client, actor, from, to);
      const classIds = authorisedByDate
        ? [...new Set([...authorisedByDate.values()].flatMap((ids) => [...ids]))]
        : null;
      const resolved = await resolveTimetableOccurrences(client, {
        organisationId: orgId,
        from,
        to,
        classIds,
        coveringUserId: canReadSchoolTimetable(actor) ? null : actor.userId,
      });
      const occurrences = canReadSchoolTimetable(actor)
        ? resolved
        : await filterAssignedOccurrences(client, actor, from, to, resolved);
      const covers = canReadCover(actor)
        ? await client.query<{ n: number }>(
            `select count(*)::int as n
             from timetable_covers tc
             join timetable_entries te on te.id = tc.timetable_entry_id
             join staff_profiles osp on osp.id = tc.original_staff_profile_id
             join staff_profiles csp on csp.id = tc.covering_staff_profile_id
             where tc.organisation_id = $1
               and tc.cover_date >= $2::date
               and tc.cover_date <= $3::date
               and (
                 $4::uuid[] is null
                 or te.class_id = any($4::uuid[])
                 or osp.user_id = $5
                 or csp.user_id = $5
               )`,
            [orgId, from, to, classIds, actor.userId],
          )
        : { rows: [{ n: 0 }] };
      const rooms = canReadRooms(actor)
        ? await client.query<{ n: number }>(
            "select count(*)::int as n from rooms where organisation_id = $1 and is_active",
            [orgId],
          )
        : { rows: [{ n: 0 }] };
      return c.json({
        today,
        week: { from, to },
        counts: {
          lessonsThisWeek: occurrences.filter((item) => item.status !== "cancelled").length,
          coversThisWeek: covers.rows[0]?.n ?? 0,
          rooms: rooms.rows[0]?.n ?? 0,
        },
        todayLessons: occurrences
          .filter((item) => item.date === today)
          .map((item) => mapTimetableOccurrence(item)),
      });
    }),
  );

  app.get("/timetable/school-day-profiles", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [
        PERMISSIONS.TIMETABLE_READ,
        PERMISSIONS.TIMETABLE_READ_ASSIGNED,
        PERMISSIONS.TIMETABLE_MANAGE_SCHOOL,
      ]);
      const yearId = c.req.query("academicYearId");
      const profiles = await client.query(
        `select id, academic_year_id, name, weekdays, starts_at::text, ends_at::text, is_active, created_at, updated_at
         from school_day_profiles
         where organisation_id = $1
           and ($2::uuid is null or academic_year_id = $2::uuid)
         order by name`,
        [orgId, yearId ?? null],
      );
      const periods = await client.query(
        `select id, school_day_profile_id, name, short_code, period_type, starts_at::text, ends_at::text,
                sort_order, attendance_session_type_id, is_active
         from school_day_periods
         where organisation_id = $1
         order by sort_order, starts_at`,
        [orgId],
      );
      return c.json({
        profiles: profiles.rows.map((row) => ({
          ...mapSchoolDayProfile(row),
          periods: periods.rows
            .filter((period) => period.school_day_profile_id === row.id)
            .map(mapSchoolDayPeriod),
        })),
      });
    }),
  );

  app.post("/timetable/school-day-profiles", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageSchoolDay(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const body = parseBody(profileSchema, await c.req.json());
      await requireOrgRow(client, "academic_years", body.academicYearId, orgId);
      const inserted = await client.query(
        `insert into school_day_profiles (
           organisation_id, academic_year_id, name, weekdays, starts_at, ends_at, is_active, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id, academic_year_id, name, weekdays, starts_at::text, ends_at::text, is_active, created_at, updated_at`,
        [orgId, body.academicYearId, body.name, body.weekdays, body.startsAt, body.endsAt, body.isActive ?? true, userId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "timetable.school_day.created",
        entityType: "school_day_profile",
        entityId: inserted.rows[0]!.id,
        after: inserted.rows[0],
      });
      return c.json({ profile: mapSchoolDayProfile(inserted.rows[0]!) }, 201);
    }),
  );

  app.patch("/timetable/school-day-profiles/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageSchoolDay(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      await requireOrgRow(client, "school_day_profiles", id, orgId);
      const body = parseBody(profileSchema.partial(), await c.req.json());
      if (body.academicYearId) await requireOrgRow(client, "academic_years", body.academicYearId, orgId);
      const updated = await client.query(
        `update school_day_profiles set
           academic_year_id = coalesce($3, academic_year_id),
           name = coalesce($4, name),
           weekdays = coalesce($5, weekdays),
           starts_at = coalesce($6, starts_at),
           ends_at = coalesce($7, ends_at),
           is_active = coalesce($8, is_active)
         where id = $1 and organisation_id = $2
         returning id, academic_year_id, name, weekdays, starts_at::text, ends_at::text, is_active, created_at, updated_at`,
        [
          id,
          orgId,
          body.academicYearId ?? null,
          body.name ?? null,
          body.weekdays ?? null,
          body.startsAt ?? null,
          body.endsAt ?? null,
          body.isActive ?? null,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "timetable.school_day.updated",
        entityType: "school_day_profile",
        entityId: id,
        after: updated.rows[0],
      });
      return c.json({ profile: mapSchoolDayProfile(updated.rows[0]!) });
    }),
  );

  app.post("/timetable/school-day-profiles/:id/periods", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageSchoolDay(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const profileId = uuidRouteParam(c, "id");
      await requireOrgRow(client, "school_day_profiles", profileId, orgId);
      const body = parseBody(periodSchema, await c.req.json());
      if (body.attendanceSessionTypeId) {
        await requireOrgRow(client, "attendance_session_types", body.attendanceSessionTypeId, orgId);
      }
      const inserted = await client.query(
        `insert into school_day_periods (
           organisation_id, school_day_profile_id, name, short_code, period_type,
           starts_at, ends_at, sort_order, attendance_session_type_id, is_active, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         returning id, school_day_profile_id, name, short_code, period_type, starts_at::text, ends_at::text,
                   sort_order, attendance_session_type_id, is_active`,
        [
          orgId,
          profileId,
          body.name,
          body.shortCode ?? null,
          body.periodType,
          body.startsAt,
          body.endsAt,
          body.sortOrder ?? 0,
          body.attendanceSessionTypeId ?? null,
          body.isActive ?? true,
          userId,
        ],
      );
      return c.json({ period: mapSchoolDayPeriod(inserted.rows[0]!) }, 201);
    }),
  );

  app.patch("/timetable/periods/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canManageSchoolDay(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      await requireOrgRow(client, "school_day_periods", id, orgId);
      const body = parseBody(periodSchema.partial(), await c.req.json());
      if (body.attendanceSessionTypeId) {
        await requireOrgRow(client, "attendance_session_types", body.attendanceSessionTypeId, orgId);
      }
      const updated = await client.query(
        `update school_day_periods set
           name = coalesce($3, name),
           short_code = coalesce($4, short_code),
           period_type = coalesce($5, period_type),
           starts_at = coalesce($6, starts_at),
           ends_at = coalesce($7, ends_at),
           sort_order = coalesce($8, sort_order),
           attendance_session_type_id = coalesce($9, attendance_session_type_id),
           is_active = coalesce($10, is_active)
         where id = $1 and organisation_id = $2
         returning id, school_day_profile_id, name, short_code, period_type, starts_at::text, ends_at::text,
                   sort_order, attendance_session_type_id, is_active`,
        [
          id,
          orgId,
          body.name ?? null,
          body.shortCode ?? null,
          body.periodType ?? null,
          body.startsAt ?? null,
          body.endsAt ?? null,
          body.sortOrder ?? null,
          body.attendanceSessionTypeId ?? null,
          body.isActive ?? null,
        ],
      );
      return c.json({ period: mapSchoolDayPeriod(updated.rows[0]!) });
    }),
  );

  app.delete("/timetable/periods/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageSchoolDay(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      const period = await requireOrgRow(client, "school_day_periods", id, orgId);
      const usage = await client.query<{ n: number }>(
        `select count(*)::int as n from timetable_entries
         where organisation_id = $1 and school_day_period_id = $2`,
        [orgId, id],
      );
      const count = usage.rows[0]?.n ?? 0;
      if (count > 0) {
        throw new AppError(
          409,
          "cannot_delete",
          `This period is used by ${count} timetable lesson${count === 1 ? "" : "s"} and cannot be deleted.`,
          { canArchive: true, usage: [{ key: "timetable_entries", label: "timetable lessons", count }] },
        );
      }
      await client.query("delete from school_day_periods where id = $1 and organisation_id = $2", [id, orgId]);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "timetable.period.deleted",
        entityType: "school_day_period",
        entityId: id,
        before: period,
      });
      return c.json({ deleted: true });
    }),
  );

  app.get("/timetable/rooms", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadRooms(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const rows = await client.query(
        `select id, name, short_code, building, location_detail, capacity, location_type, is_active
         from rooms
         where organisation_id = $1
           and ($2::boolean or is_active)
         order by name`,
        [orgId, canManageRooms(actor)],
      );
      return c.json({ rooms: rows.rows.map(mapRoom) });
    }),
  );

  app.post("/timetable/rooms", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageRooms(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const body = parseBody(roomSchema, await c.req.json());
      const inserted = await client.query(
        `insert into rooms (
           organisation_id, name, short_code, building, location_detail, capacity, location_type, is_active, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning id, name, short_code, building, location_detail, capacity, location_type, is_active`,
        [
          orgId,
          body.name,
          body.shortCode,
          body.building ?? null,
          body.locationDetail ?? null,
          body.capacity ?? null,
          body.locationType ?? "teaching",
          body.isActive ?? true,
          userId,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "timetable.room.created",
        entityType: "room",
        entityId: inserted.rows[0]!.id,
        after: inserted.rows[0],
      });
      return c.json({ room: mapRoom(inserted.rows[0]!) }, 201);
    }),
  );

  app.patch("/timetable/rooms/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageRooms(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      await requireOrgRow(client, "rooms", id, orgId);
      const body = parseBody(roomSchema.partial(), await c.req.json());
      const updated = await client.query(
        `update rooms set
           name = coalesce($3, name),
           short_code = coalesce($4, short_code),
           building = coalesce($5, building),
           location_detail = coalesce($6, location_detail),
           capacity = coalesce($7, capacity),
           location_type = coalesce($8, location_type),
           is_active = coalesce($9, is_active)
         where id = $1 and organisation_id = $2
         returning id, name, short_code, building, location_detail, capacity, location_type, is_active`,
        [
          id,
          orgId,
          body.name ?? null,
          body.shortCode ?? null,
          body.building ?? null,
          body.locationDetail ?? null,
          body.capacity ?? null,
          body.locationType ?? null,
          body.isActive ?? null,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "timetable.room.updated",
        entityType: "room",
        entityId: id,
        after: updated.rows[0],
      });
      return c.json({ room: mapRoom(updated.rows[0]!) });
    }),
  );

  app.get("/timetable/entries", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [
        PERMISSIONS.TIMETABLE_READ,
        PERMISSIONS.TIMETABLE_READ_ASSIGNED,
        PERMISSIONS.TIMETABLE_MANAGE,
      ]);
      const classId = c.req.query("classId");
      const staffProfileId = c.req.query("staffProfileId");
      const roomId = c.req.query("roomId");
      const academicYearId = c.req.query("academicYearId");
      if (classId) await requireOrgRow(client, "classes", classId, orgId);
      const definitionScope = canReadSchoolTimetable(actor)
        ? null
        : await timetableDefinitionScope(client, actor, isoDate());
      if (classId && definitionScope && !definitionScope.classIds.has(classId)) {
        const coveredInClass =
          definitionScope.entryIds.size === 0
            ? { rows: [] }
            : await client.query(
                `select 1 from timetable_entries
                 where organisation_id = $1 and class_id = $2 and id = any($3::uuid[])
                 limit 1`,
                [orgId, classId, [...definitionScope.entryIds]],
              );
        if (coveredInClass.rows.length === 0) throw new AppError(404, "not_found", "Not found");
      }
      const rows = await client.query(
        `select
           te.*,
           te.starts_at::text,
           te.ends_at::text,
           te.effective_from::text,
           te.effective_until::text,
           c.name as class_name,
           yg.name as year_group_name,
           s.name as subject_name,
           r.name as room_name
         from timetable_entries te
         join classes c on c.id = te.class_id
         left join year_groups yg on yg.id = te.year_group_id
         left join subjects s on s.id = te.subject_id
         left join rooms r on r.id = te.room_id
         where te.organisation_id = $1
           and ($2::uuid is null or te.academic_year_id = $2::uuid)
           and ($3::uuid is null or te.class_id = $3::uuid)
           and ($4::uuid is null or te.room_id = $4::uuid)
           and (
             $5::uuid[] is null
             or te.class_id = any($5::uuid[])
             or te.id = any($6::uuid[])
           )
           and (
             $7::uuid is null
             or exists (
               select 1 from timetable_entry_teachers tet
               where tet.timetable_entry_id = te.id and tet.staff_profile_id = $7::uuid
             )
           )
         order by te.weekday, te.starts_at, c.name`,
        [
          orgId,
          academicYearId ?? null,
          classId ?? null,
          roomId ?? null,
          definitionScope ? [...definitionScope.classIds] : null,
          definitionScope ? [...definitionScope.entryIds] : null,
          staffProfileId ?? null,
        ],
      );
      const today = await schoolToday(client, orgId);
      const mapped = [];
      for (const row of rows.rows) {
        mapped.push(
          await mapManagedEntry(
            client,
            orgId,
            { ...row, teachers: await loadEntryTeachers(client, orgId, String(row.id)) },
            today,
          ),
        );
      }
      return c.json({ entries: mapped, today });
    }),
  );

  app.get("/timetable/entries/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [
        PERMISSIONS.TIMETABLE_READ,
        PERMISSIONS.TIMETABLE_READ_ASSIGNED,
        PERMISSIONS.TIMETABLE_MANAGE,
      ]);
      const id = uuidRouteParam(c, "id");
      const entry = await loadEntryRow(client, orgId, id);
      if (!canReadSchoolTimetable(actor)) {
        const definitionScope = await timetableDefinitionScope(client, actor, isoDate());
        if (!definitionScope.classIds.has(String(entry.class_id)) && !definitionScope.entryIds.has(id)) {
          throw new AppError(404, "not_found", "Not found");
        }
      }
      const today = await schoolToday(client, orgId);
      return c.json({
        entry: await mapManagedEntry(client, orgId, entry, today, { includeLifecycle: true }),
        today,
      });
    }),
  );

  app.post("/timetable/entries/preview", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      await assertCanManageTimetable(actor);
      const body = parseBody(recurrencePreviewSchema, await c.req.json());
      const preview = await previewRecurrencePayload(client, orgId, body);
      return c.json({ preview });
    }),
  );

  app.post("/timetable/entries", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      await assertCanManageTimetable(actor);
      const parsed = parseBody(entrySchema, await c.req.json());
      const window = await resolveEntryRepeatUntil(client, orgId, parsed);
      const body = { ...parsed, effectiveUntil: window.effectiveUntil };
      const created = await insertTimetableEntry(client, orgId, userId, body);
      const firstOccurrence = await firstTimetableOccurrence(client, orgId, {
        academicYearId: body.academicYearId,
        termId: body.termId ?? null,
        weekday: body.weekday,
        effectiveFrom: body.effectiveFrom,
        effectiveUntil: body.effectiveUntil ?? null,
        startsAt: String(created.startsAt),
        endsAt: String(created.endsAt),
      });
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "timetable.entry.created",
        entityType: "timetable_entry",
        entityId: created.id,
        after: created,
      });
      return c.json(
        {
          entry: created,
          firstOccurrence,
          preview: window.resolved && window.resolved.ok
            ? {
                occurrenceCount: window.resolved.dates.length,
                dates: window.resolved.dates,
                repeatUntilLabel: window.resolved.label,
              }
            : undefined,
          message: firstOccurrence
            ? recurringLessonSavedMessage(firstOccurrence)
            : "Recurring lesson saved. It has no lesson in the current academic year window.",
        },
        201,
      );
    }),
  );

  app.patch("/timetable/entries/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      await assertCanManageTimetable(actor);
      const id = uuidRouteParam(c, "id");
      const existing = await loadEntryRow(client, orgId, id);
      const body = parseBody(entrySchema.partial(), await c.req.json());
      const today = await schoolToday(client, orgId);
      const lifecycle = await loadRecurrenceLifecycle(
        client,
        orgId,
        {
          id,
          classId: String(existing.class_id),
          weekday: Number(existing.weekday),
          effectiveFrom: String(existing.effective_from),
          effectiveUntil: (existing.effective_until as string | null) ?? null,
          isActive: Boolean(existing.is_active),
        },
        today,
      );
      if (!lifecycle.canEditStructure && recurrencePatchTouchesStructure(body as Record<string, unknown>)) {
        throw new AppError(409, "cannot_edit", RECURRENCE_STRUCTURAL_EDIT_BLOCKED, {
          usage: lifecycle.usage.filter((item) => item.count > 0),
        });
      }
      if (body.isActive === false && !lifecycle.canDelete) {
        throw new AppError(409, "cannot_edit", RECURRENCE_DELETE_BLOCKED, {
          usage: lifecycle.usage.filter((item) => item.count > 0),
        });
      }
      let startsAt = body.startsAt ?? String(existing.starts_at);
      let endsAt = body.endsAt ?? String(existing.ends_at);
      const periodId = body.schoolDayPeriodId ?? String(existing.school_day_period_id ?? "");
      if (periodId && body.customTime !== true) {
        const period = await requireOrgRow(client, "school_day_periods", periodId, orgId);
        startsAt = String(period.starts_at);
        endsAt = String(period.ends_at);
      }
      if (body.academicYearId) await requireOrgRow(client, "academic_years", body.academicYearId, orgId);
      if (body.termId) await requireOrgRow(client, "terms", body.termId, orgId);
      let nextEffectiveUntil = body.effectiveUntil;
      if (body.repeatUntil) {
        const window = await resolveEntryRepeatUntil(client, orgId, {
          academicYearId: body.academicYearId ?? String(existing.academic_year_id),
          weekday: body.weekday ?? Number(existing.weekday),
          effectiveFrom: body.effectiveFrom ?? String(existing.effective_from),
          termId: body.termId === undefined ? ((existing.term_id as string | null) ?? null) : body.termId,
          repeatUntil: body.repeatUntil,
        });
        nextEffectiveUntil = window.effectiveUntil;
      }
      if (body.classId) await requireOrgRow(client, "classes", body.classId, orgId);
      if (body.subjectId) await requireOrgRow(client, "subjects", body.subjectId, orgId);
      if (body.roomId) await requireOrgRow(client, "rooms", body.roomId, orgId);
      if (body.yearGroupId) await requireOrgRow(client, "year_groups", body.yearGroupId, orgId);
      const updated = await client.query(
        `update timetable_entries set
           academic_year_id = coalesce($3, academic_year_id),
           term_id = case when $4::text = 'clear' then null else coalesce($5::uuid, term_id) end,
           school_day_period_id = coalesce($6, school_day_period_id),
           weekday = coalesce($7, weekday),
           starts_at = $8,
           ends_at = $9,
           class_id = coalesce($10, class_id),
           year_group_id = coalesce($11, year_group_id),
           subject_id = coalesce($12, subject_id),
           room_id = case when $13::text = 'clear' then null else coalesce($14::uuid, room_id) end,
           lesson_type = coalesce($15, lesson_type),
           is_active = coalesce($16, is_active),
           effective_from = coalesce($17, effective_from),
           effective_until = case when $18::text = 'clear' then null else coalesce($19::date, effective_until) end,
           staff_notes = coalesce($20, staff_notes)
         where id = $1 and organisation_id = $2
         returning id`,
        [
          id,
          orgId,
          body.academicYearId ?? null,
          body.termId === null ? "clear" : null,
          body.termId ?? null,
          body.schoolDayPeriodId ?? null,
          body.weekday ?? null,
          startsAt,
          endsAt,
          body.classId ?? null,
          body.yearGroupId ?? null,
          body.subjectId ?? null,
          body.roomId === null ? "clear" : null,
          body.roomId ?? null,
          body.lessonType ?? null,
          body.isActive ?? null,
          body.effectiveFrom ?? null,
          nextEffectiveUntil === null ? "clear" : null,
          nextEffectiveUntil ?? null,
          body.staffNotes ?? null,
        ],
      );
      if (body.teachers) {
        await client.query("delete from timetable_entry_teachers where timetable_entry_id = $1 and organisation_id = $2", [
          id,
          orgId,
        ]);
        await insertTeachers(client, orgId, updated.rows[0]!.id, body.teachers);
      }
      const entry = await mapManagedEntry(client, orgId, await loadEntryRow(client, orgId, id), today, {
        includeLifecycle: true,
      });
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "timetable.entry.updated",
        entityType: "timetable_entry",
        entityId: id,
        after: entry,
      });
      return c.json({ entry });
    }),
  );

  app.get("/timetable/entries/:id/lifecycle", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      await assertCanManageTimetable(actor);
      const id = uuidRouteParam(c, "id");
      const existing = await loadEntryRow(client, orgId, id);
      const today = await schoolToday(client, orgId);
      const entry = await mapManagedEntry(client, orgId, existing, today, { includeLifecycle: true });
      const stopFrom = c.req.query("stopFrom");
      let lastScheduledLesson: string | null = null;
      if (stopFrom && /^\d{4}-\d{2}-\d{2}$/.test(stopFrom)) {
        const until = effectiveUntilFromStopFrom(stopFrom);
        const existingUntil = (existing.effective_until as string | null) ?? until;
        const listed = await listResolvedRecurrenceDates(client, orgId, {
          academicYearId: String(existing.academic_year_id),
          weekday: Number(existing.weekday),
          effectiveFrom: String(existing.effective_from),
          effectiveUntil: existingUntil < until ? existingUntil : until,
          termId: (existing.term_id as string | null) ?? null,
        });
        lastScheduledLesson = listed.dates[listed.dates.length - 1] ?? null;
      } else {
        const listed = await listResolvedRecurrenceDates(client, orgId, {
          academicYearId: String(existing.academic_year_id),
          weekday: Number(existing.weekday),
          effectiveFrom: String(existing.effective_from),
          effectiveUntil: (existing.effective_until as string | null) ?? today,
          termId: (existing.term_id as string | null) ?? null,
        });
        lastScheduledLesson = listed.dates[listed.dates.length - 1] ?? null;
      }
      return c.json({ entry, today, lastScheduledLesson });
    }),
  );

  app.post("/timetable/entries/:id/end", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      await assertCanManageTimetable(actor);
      const id = uuidRouteParam(c, "id");
      const existing = await loadEntryRow(client, orgId, id);
      const parsed = z.object({ stopFrom: dateSchema }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "A stop date is required");
      const today = await schoolToday(client, orgId);
      const lifecycle = await loadRecurrenceLifecycle(
        client,
        orgId,
        {
          id,
          classId: String(existing.class_id),
          weekday: Number(existing.weekday),
          effectiveFrom: String(existing.effective_from),
          effectiveUntil: (existing.effective_until as string | null) ?? null,
          isActive: Boolean(existing.is_active),
        },
        today,
      );
      if (!lifecycle.canEnd) {
        throw new AppError(
          409,
          "cannot_end",
          lifecycle.status === "ended"
            ? "This recurring lesson has already ended."
            : "Delete a future unused recurrence instead of ending it.",
        );
      }
      const year = await client.query<{ ends_on: string }>(
        `select ends_on::text from academic_years where id = $1 and organisation_id = $2`,
        [existing.academic_year_id, orgId],
      );
      if (!year.rows[0]) throw new AppError(404, "not_found", "Not found");
      const stop = validateRecurrenceStopFrom({
        stopFrom: parsed.data.stopFrom,
        effectiveFrom: String(existing.effective_from),
        today,
        yearEndsOn: year.rows[0].ends_on,
      });
      if (!stop.ok) throw new AppError(400, "validation_failed", stop.error);
      await client.query(
        `update timetable_entries
         set effective_until = $3::date, is_active = true
         where id = $1 and organisation_id = $2`,
        [id, orgId, stop.effectiveUntil],
      );
      const entry = await mapManagedEntry(client, orgId, await loadEntryRow(client, orgId, id), today, {
        includeLifecycle: true,
      });
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "timetable.entry.ended",
        entityType: "timetable_entry",
        entityId: id,
        before: { effectiveUntil: existing.effective_until },
        after: { effectiveUntil: stop.effectiveUntil, stopFrom: parsed.data.stopFrom },
      });
      return c.json({
        entry,
        message: `Recurring lesson ended. Lessons on or after ${parsed.data.stopFrom} will not be generated. Past timetable, attendance, cover and learning history are kept.`,
      });
    }),
  );

  app.post("/timetable/entries/:id/replace", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      await assertCanManageTimetable(actor);
      const id = uuidRouteParam(c, "id");
      const existing = await loadEntryRow(client, orgId, id);
      const body = parseBody(
        entrySchema.extend({ applyFrom: dateSchema }).partial().required({ applyFrom: true }),
        await c.req.json(),
      );
      const today = await schoolToday(client, orgId);
      const lifecycle = await loadRecurrenceLifecycle(
        client,
        orgId,
        {
          id,
          classId: String(existing.class_id),
          weekday: Number(existing.weekday),
          effectiveFrom: String(existing.effective_from),
          effectiveUntil: (existing.effective_until as string | null) ?? null,
          isActive: Boolean(existing.is_active),
        },
        today,
      );
      if (!lifecycle.canEnd) {
        throw new AppError(
          409,
          "cannot_replace",
          lifecycle.status === "ended"
            ? "This recurring lesson has already ended."
            : "Edit this unused future recurrence directly instead of replacing it.",
        );
      }
      const year = await client.query<{ ends_on: string }>(
        `select ends_on::text from academic_years where id = $1 and organisation_id = $2`,
        [existing.academic_year_id, orgId],
      );
      if (!year.rows[0]) throw new AppError(404, "not_found", "Not found");
      const originalUntil = (existing.effective_until as string | null) ?? null;
      const stop = validateRecurrenceApplyFrom({
        applyFrom: body.applyFrom,
        effectiveFrom: String(existing.effective_from),
        effectiveUntil: originalUntil,
        today,
        yearEndsOn: year.rows[0].ends_on,
      });
      if (!stop.ok) throw new AppError(400, "validation_failed", stop.error);
      // Client repeatUntil / effectiveUntil are ignored. The replacement always
      // inherits the stored original end date (including a legacy open end).
      const replacementBody = parseBody(entrySchema, {
        academicYearId: body.academicYearId ?? String(existing.academic_year_id),
        termId: body.termId === undefined ? ((existing.term_id as string | null) ?? undefined) : body.termId,
        schoolDayPeriodId:
          body.schoolDayPeriodId === undefined
            ? ((existing.school_day_period_id as string | null) ?? undefined)
            : body.schoolDayPeriodId,
        customTime: body.customTime,
        weekday: body.weekday ?? Number(existing.weekday),
        startsAt: body.startsAt ?? String(existing.starts_at),
        endsAt: body.endsAt ?? String(existing.ends_at),
        classId: body.classId ?? String(existing.class_id),
        yearGroupId:
          body.yearGroupId === undefined ? ((existing.year_group_id as string | null) ?? undefined) : body.yearGroupId,
        subjectId: body.subjectId === undefined ? ((existing.subject_id as string | null) ?? undefined) : body.subjectId,
        roomId: body.roomId === undefined ? ((existing.room_id as string | null) ?? undefined) : body.roomId,
        lessonType: body.lessonType ?? String(existing.lesson_type),
        effectiveFrom: body.applyFrom,
        effectiveUntil: stop.inheritedUntil,
        staffNotes: body.staffNotes === undefined ? ((existing.staff_notes as string | null) ?? undefined) : body.staffNotes,
        teachers:
          body.teachers ??
          ((existing.teachers as Array<{ staffProfileId: string; participationRole?: string; isPrimary?: boolean }>) ?? []),
      });
      const remaining = await listResolvedRecurrenceDates(client, orgId, {
        academicYearId: replacementBody.academicYearId,
        weekday: replacementBody.weekday,
        effectiveFrom: replacementBody.effectiveFrom,
        effectiveUntil: stop.inheritedUntil,
        termId: replacementBody.termId ?? null,
      });
      if (remaining.dates.length === 0) {
        throw new AppError(400, "validation_failed", APPLY_FROM_NO_REMAINING_LESSONS);
      }
      await client.query(
        `update timetable_entries
         set effective_until = $3::date, is_active = true
         where id = $1 and organisation_id = $2`,
        [id, orgId, stop.oldEffectiveUntil],
      );
      const created = await insertTimetableEntry(client, orgId, userId, replacementBody);
      const ended = await mapManagedEntry(client, orgId, await loadEntryRow(client, orgId, id), today, {
        includeLifecycle: true,
      });
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "timetable.entry.replaced",
        entityType: "timetable_entry",
        entityId: created.id,
        before: {
          endedEntryId: id,
          effectiveUntil: stop.oldEffectiveUntil,
          applyFrom: body.applyFrom,
          inheritedUntil: stop.inheritedUntil,
        },
        after: created,
      });
      return c.json({
        endedEntry: ended,
        entry: created,
        message: stop.inheritedUntil
          ? `The previous recurring lesson now ends before this date. The replacement starts from the chosen date and keeps the original end date (${stop.inheritedUntil}). Past timetable history is kept.`
          : "The previous recurring lesson now ends before this date. The replacement starts from the chosen date and keeps the original open end date. Past timetable history is kept.",
      });
    }),
  );

  app.delete("/timetable/entries/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      await assertCanManageTimetable(actor);
      const id = uuidRouteParam(c, "id");
      const existing = await loadEntryRow(client, orgId, id);
      const today = await schoolToday(client, orgId);
      const lifecycle = await loadRecurrenceLifecycle(
        client,
        orgId,
        {
          id,
          classId: String(existing.class_id),
          weekday: Number(existing.weekday),
          effectiveFrom: String(existing.effective_from),
          effectiveUntil: (existing.effective_until as string | null) ?? null,
          isActive: Boolean(existing.is_active),
        },
        today,
      );
      if (!lifecycle.canDelete) {
        throw new AppError(409, "cannot_delete", lifecycle.message || RECURRENCE_DELETE_BLOCKED, {
          usage: lifecycle.usage.filter((item) => item.count > 0),
        });
      }
      await client.query(`delete from timetable_entries where id = $1 and organisation_id = $2`, [id, orgId]);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "timetable.entry.deleted",
        entityType: "timetable_entry",
        entityId: id,
        before: mapTimetableEntry(existing),
      });
      return c.json({ ok: true });
    }),
  );

  app.get("/timetable/occurrences", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, [
        PERMISSIONS.TIMETABLE_READ,
        PERMISSIONS.TIMETABLE_READ_ASSIGNED,
        PERMISSIONS.TIMETABLE_MANAGE,
      ]);
      const fromQuery = c.req.query("from");
      const weekQuery = c.req.query("week");
      const today = await schoolToday(client, orgId);
      const week = isoWeekRange(weekQuery || fromQuery || today);
      const from = weekQuery || !fromQuery ? week.from : fromQuery;
      const to = c.req.query("to") ?? (weekQuery || !fromQuery ? week.to : addDaysSafe(from, 6));
      const classId = c.req.query("classId");
      const staffProfileId = c.req.query("staffProfileId");
      const roomId = c.req.query("roomId");
      const mine = c.req.query("mine") === "true";
      if (classId) await requireOrgRow(client, "classes", classId, orgId);
      if (roomId) await requireOrgRow(client, "rooms", roomId, orgId);
      const authorisedByDate = canReadSchoolTimetable(actor)
        ? null
        : await authorisedClassIdsByDate(client, actor, from, to);
      if (classId && authorisedByDate) {
        const allowedOnRange = [...authorisedByDate.values()].some((ids) => ids.has(classId));
        if (!allowedOnRange) throw new AppError(404, "not_found", "Not found");
      }
      const classIds = classId
        ? [classId]
        : authorisedByDate
          ? [...new Set([...authorisedByDate.values()].flatMap((ids) => [...ids]))]
          : null;
      const occurrences = await resolveTimetableOccurrences(client, {
        organisationId: orgId,
        from,
        to,
        academicYearId: c.req.query("academicYearId"),
        termId: c.req.query("termId"),
        classIds,
        staffProfileId: staffProfileId ?? null,
        coveringUserId: mine && !canReadSchoolTimetable(actor) ? userId : null,
        roomId: roomId ?? null,
        subjectId: c.req.query("subjectId") ?? null,
        yearGroupId: c.req.query("yearGroupId") ?? null,
        includeCancelled: c.req.query("includeCancelled") === "true",
      });
      const visible = canReadSchoolTimetable(actor)
        ? occurrences
        : await filterAssignedOccurrences(client, actor, from, to, occurrences);
      return c.json({
        from,
        to,
        weekCommencing: startOfIsoWeek(from),
        occurrences: visible.map((item) => mapTimetableOccurrence(item)),
      });
    }),
  );

  app.get("/timetable/my-day", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, [
        PERMISSIONS.TIMETABLE_READ,
        PERMISSIONS.TIMETABLE_READ_ASSIGNED,
        PERMISSIONS.TIMETABLE_MANAGE,
      ]);
      const date = c.req.query("date") ?? (await schoolToday(client, orgId));
      const classIds = await authorisedTimetableClassIds(client, actor, date);
      const occurrences = await resolveTimetableOccurrences(client, {
        organisationId: orgId,
        from: date,
        to: date,
        classIds: classIds ? [...classIds] : null,
        coveringUserId: canReadSchoolTimetable(actor) ? null : userId,
      });
      return c.json({
        date,
        weekday: isoWeekdayFromDate(date),
        occurrences: occurrences.map((item) => mapTimetableOccurrence(item)),
      });
    }),
  );

  app.post("/timetable/occurrences/attendance-register", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, [
        PERMISSIONS.ATTENDANCE_RECORD_MANAGE,
        PERMISSIONS.ATTENDANCE_RECORD_MANAGE_ASSIGNED,
      ]);
      const body = parseBody(
        z.object({ entryId: z.string().uuid(), date: dateSchema }),
        await c.req.json(),
      );
      const classIds = await authorisedTimetableClassIds(client, actor, body.date);
      const occurrences = await resolveTimetableOccurrences(client, {
        organisationId: orgId,
        from: body.date,
        to: body.date,
        classIds: classIds ? [...classIds] : null,
        coveringUserId: canReadSchoolTimetable(actor) ? null : userId,
        includeCancelled: true,
      });
      const occurrence = occurrences.find((item) => item.entryId === body.entryId);
      if (!occurrence || occurrence.status === "cancelled" || occurrence.status === "school_closure") {
        throw new AppError(404, "not_found", "Not found");
      }
      await assertCanReadClassTimetable(client, actor, occurrence.classId, body.date);
      const target = await resolveAttendanceRegisterTarget(client, orgId, occurrence);
      return c.json({
        classId: target.classId,
        date: target.date,
        sessionTypeId: target.sessionTypeId,
        sessionKey: target.sessionKey,
        registerPath: `/school/attendance/registers/${target.classId}?date=${target.date}&sessionTypeId=${target.sessionTypeId}`,
      });
    }),
  );

  app.get("/timetable/exceptions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadCover(actor) && !canReadSchoolTimetable(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const from = c.req.query("from");
      const to = c.req.query("to");
      const scope = canReadSchoolTimetable(actor)
        ? null
        : await timetableDefinitionScope(client, actor, isoDate());
      const includeInternal = canManageCover(actor);
      const rows = await client.query(
        `select
           id, timetable_entry_id, exception_date::text, exception_type,
           replacement_room_id, replacement_subject_id, replacement_starts_at::text,
           replacement_ends_at::text, replacement_lesson_type, parent_visible_note,
           staff_notes, created_by, created_at
         from timetable_exceptions
         where organisation_id = $1
           and ($2::date is null or exception_date >= $2::date)
           and ($3::date is null or exception_date <= $3::date)
           and (
             $4::uuid[] is null
             or exception_type = 'school_closure'
             or timetable_entry_id = any($5::uuid[])
             or exists (
               select 1 from timetable_entries te
               where te.id = timetable_exceptions.timetable_entry_id
                 and te.class_id = any($4::uuid[])
             )
           )
         order by exception_date desc, created_at desc`,
        [orgId, from ?? null, to ?? null, scope ? [...scope.classIds] : null, scope ? [...scope.entryIds] : null],
      );
      return c.json({
        exceptions: rows.rows.map((row) => mapTimetableException(row, { includeInternal })),
      });
    }),
  );

  app.post("/timetable/exceptions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageCover(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const body = parseBody(exceptionSchema, await c.req.json());
      if (body.exceptionType === "school_closure") {
        if (body.timetableEntryId) {
          throw new AppError(400, "validation_failed", "School closures are not attached to a single lesson");
        }
      } else if (!body.timetableEntryId) {
        throw new AppError(400, "validation_failed", "A timetable entry is required");
      } else {
        await requireOrgRow(client, "timetable_entries", body.timetableEntryId, orgId);
      }
      if (body.replacementRoomId) await requireOrgRow(client, "rooms", body.replacementRoomId, orgId);
      if (body.replacementSubjectId) await requireOrgRow(client, "subjects", body.replacementSubjectId, orgId);
      const inserted = await client.query(
        `insert into timetable_exceptions (
           organisation_id, timetable_entry_id, exception_date, exception_type,
           replacement_room_id, replacement_subject_id, replacement_starts_at, replacement_ends_at,
           replacement_lesson_type, parent_visible_note, staff_notes, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         returning id, timetable_entry_id, exception_date::text, exception_type,
                   replacement_room_id, replacement_subject_id, replacement_starts_at::text,
                   replacement_ends_at::text, replacement_lesson_type, parent_visible_note,
                   staff_notes, created_by, created_at`,
        [
          orgId,
          body.timetableEntryId ?? null,
          body.date,
          body.exceptionType,
          body.replacementRoomId ?? null,
          body.replacementSubjectId ?? null,
          body.replacementStartsAt ?? null,
          body.replacementEndsAt ?? null,
          body.replacementLessonType ?? null,
          body.parentVisibleNote ?? null,
          body.staffNotes ?? null,
          userId,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "timetable.exception.created",
        entityType: "timetable_exception",
        entityId: inserted.rows[0]!.id,
        after: inserted.rows[0],
      });
      return c.json({ exception: mapTimetableException(inserted.rows[0]!) }, 201);
    }),
  );

  app.get("/timetable/covers", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canReadCover(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const from = c.req.query("from");
      const to = c.req.query("to");
      const scope = canReadSchoolTimetable(actor)
        ? null
        : await timetableDefinitionScope(client, actor, isoDate());
      const includeInternal = canManageCover(actor);
      const rows = await client.query(
        `select
           tc.id, tc.timetable_entry_id, tc.cover_date::text,
           tc.original_staff_profile_id, ou.full_name as original_staff_name,
           tc.covering_staff_profile_id, cu.full_name as covering_staff_name,
           tc.reason, tc.staff_notes, tc.assigned_by, tc.assigned_at
         from timetable_covers tc
         join staff_profiles osp on osp.id = tc.original_staff_profile_id
         join users ou on ou.id = osp.user_id
         join staff_profiles csp on csp.id = tc.covering_staff_profile_id
         join users cu on cu.id = csp.user_id
         where tc.organisation_id = $1
           and ($2::date is null or tc.cover_date >= $2::date)
           and ($3::date is null or tc.cover_date <= $3::date)
           and (
             $4::uuid[] is null
             or exists (
               select 1 from timetable_entries te
               where te.id = tc.timetable_entry_id
                 and te.class_id = any($4::uuid[])
             )
             or osp.user_id = $5
             or csp.user_id = $5
           )
         order by tc.cover_date desc, tc.assigned_at desc`,
        [orgId, from ?? null, to ?? null, scope ? [...scope.classIds] : null, userId],
      );
      return c.json({ covers: rows.rows.map((row) => mapTimetableCover(row, { includeInternal })) });
    }),
  );

  app.post("/timetable/covers", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageCover(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const body = parseBody(coverSchema, await c.req.json());
      await requireOrgRow(client, "timetable_entries", body.timetableEntryId, orgId);
      await requireOrgRow(client, "staff_profiles", body.coveringStaffProfileId, orgId);
      let originalId = body.originalStaffProfileId;
      if (!originalId) {
        const primary = await client.query<{ staff_profile_id: string }>(
          `select staff_profile_id
           from timetable_entry_teachers
           where timetable_entry_id = $1 and organisation_id = $2
           order by is_primary desc
           limit 1`,
          [body.timetableEntryId, orgId],
        );
        originalId = primary.rows[0]?.staff_profile_id;
      }
      if (!originalId) throw new AppError(400, "validation_failed", "An original teacher is required");
      await requireOrgRow(client, "staff_profiles", originalId, orgId);
      const inserted = await client.query(
        `insert into timetable_covers (
           organisation_id, timetable_entry_id, cover_date, original_staff_profile_id,
           covering_staff_profile_id, reason, staff_notes, assigned_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id, timetable_entry_id, cover_date::text, original_staff_profile_id,
                   covering_staff_profile_id, reason, staff_notes, assigned_by, assigned_at`,
        [
          orgId,
          body.timetableEntryId,
          body.date,
          originalId,
          body.coveringStaffProfileId,
          body.reason ?? null,
          body.staffNotes ?? null,
          userId,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "timetable.cover.created",
        entityType: "timetable_cover",
        entityId: inserted.rows[0]!.id,
        after: inserted.rows[0],
      });
      return c.json({ cover: mapTimetableCover(inserted.rows[0]!) }, 201);
    }),
  );

  app.get("/dashboard/timetable", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, [
        PERMISSIONS.TIMETABLE_READ,
        PERMISSIONS.TIMETABLE_READ_ASSIGNED,
        PERMISSIONS.TIMETABLE_MANAGE,
      ]);
      const date = c.req.query("date") ?? (await schoolToday(client, orgId));
      const classIds = await authorisedTimetableClassIds(client, actor, date);
      const occurrences = await resolveTimetableOccurrences(client, {
        organisationId: orgId,
        from: date,
        to: date,
        classIds: classIds ? [...classIds] : null,
        coveringUserId: canReadSchoolTimetable(actor) ? null : userId,
      });
      const coversToday = canReadCover(actor)
        ? (
            await client.query<{ n: number }>(
              `select count(*)::int as n
               from timetable_covers tc
               join timetable_entries te on te.id = tc.timetable_entry_id
               join staff_profiles osp on osp.id = tc.original_staff_profile_id
               join staff_profiles csp on csp.id = tc.covering_staff_profile_id
               where tc.organisation_id = $1
                 and tc.cover_date = $2::date
                 and (
                   $3::uuid[] is null
                   or te.class_id = any($3::uuid[])
                   or osp.user_id = $4
                   or csp.user_id = $4
                 )`,
              [orgId, date, classIds ? [...classIds] : null, userId],
            )
          ).rows[0]?.n ?? 0
        : 0;
      return c.json({
        date,
        lessons: occurrences.map((item) => mapTimetableOccurrence(item)),
        coversToday,
      });
    }),
  );
}

async function friendlyTimetableConflict(
  client: Parameters<typeof requireOrgRow>[0],
  orgId: string,
  error: unknown,
): Promise<never> {
  const appError = error instanceof AppError ? error : pgErrorToAppError(error);
  if (!(appError instanceof AppError) || appError.code !== "conflict" || !appError.details?.conflicts?.length) {
    throw appError ?? error;
  }
  const conflicts = [...appError.details.conflicts];
  for (const conflict of conflicts) {
    if (conflict.kind === "class" && (conflict.classId || conflict.entryId)) {
      const row = conflict.classId
        ? await client.query<{ name: string }>(
            "select name from classes where id = $1 and organisation_id = $2",
            [conflict.classId, orgId],
          )
        : await client.query<{ name: string }>(
            `select c.name from timetable_entries te
             join classes c on c.id = te.class_id
             where te.id = $1 and te.organisation_id = $2`,
            [conflict.entryId, orgId],
          );
      if (row.rows[0]) {
        (conflict as { className?: string }).className = row.rows[0].name;
      }
    }
    if (conflict.kind === "teacher" && conflict.staffProfileId) {
      const row = await client.query<{ full_name: string }>(
        `select u.full_name
         from staff_profiles sp
         join users u on u.id = sp.user_id
         where sp.id = $1 and sp.organisation_id = $2`,
        [conflict.staffProfileId, orgId],
      );
      if (row.rows[0]) {
        (conflict as { teacherName?: string }).teacherName = row.rows[0].full_name;
      }
    }
    if (conflict.kind === "room" && conflict.roomId) {
      const row = await client.query<{ name: string }>(
        "select name from rooms where id = $1 and organisation_id = $2",
        [conflict.roomId, orgId],
      );
      if (row.rows[0]) (conflict as { roomName?: string }).roomName = row.rows[0].name;
    }
  }
  throw new AppError(409, "conflict", timetableConflictMessage(conflicts), { conflicts });
}

async function insertTimetableEntry(
  client: Parameters<typeof requireOrgRow>[0],
  orgId: string,
  userId: string,
  body: z.infer<typeof entrySchema>,
) {
  await requireOrgRow(client, "academic_years", body.academicYearId, orgId);
  await requireOrgRow(client, "classes", body.classId, orgId);
  if (body.termId) await requireOrgRow(client, "terms", body.termId, orgId);
  if (body.subjectId) await requireOrgRow(client, "subjects", body.subjectId, orgId);
  if (body.roomId) await requireOrgRow(client, "rooms", body.roomId, orgId);
  if (body.yearGroupId) await requireOrgRow(client, "year_groups", body.yearGroupId, orgId);
  let startsAt = body.startsAt;
  let endsAt = body.endsAt;
  const customTime = body.customTime === true || !body.schoolDayPeriodId;
  if (body.schoolDayPeriodId && !customTime) {
    const period = await requireOrgRow(client, "school_day_periods", body.schoolDayPeriodId, orgId);
    startsAt = String(period.starts_at);
    endsAt = String(period.ends_at);
  } else if (body.schoolDayPeriodId) {
    const period = await requireOrgRow(client, "school_day_periods", body.schoolDayPeriodId, orgId);
    startsAt = startsAt ?? String(period.starts_at);
    endsAt = endsAt ?? String(period.ends_at);
  }
  if (!startsAt || !endsAt) {
    throw new AppError(400, "validation_failed", "Start and end times are required");
  }
  await client.query("savepoint timetable_entry_write");
  try {
    const inserted = await client.query<{ id: string }>(
      `insert into timetable_entries (
         organisation_id, academic_year_id, term_id, school_day_period_id, weekday,
         starts_at, ends_at, class_id, year_group_id, subject_id, room_id, lesson_type,
         is_active, effective_from, effective_until, staff_notes, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       returning id`,
      [
        orgId,
        body.academicYearId,
        body.termId ?? null,
        body.schoolDayPeriodId ?? null,
        body.weekday,
        startsAt,
        endsAt,
        body.classId,
        body.yearGroupId ?? null,
        body.subjectId ?? null,
        body.roomId ?? null,
        body.lessonType ?? "lesson",
        body.isActive ?? true,
        body.effectiveFrom,
        body.effectiveUntil ?? null,
        body.staffNotes ?? null,
        userId,
      ],
    );
    await insertTeachers(client, orgId, inserted.rows[0]!.id, body.teachers);
    await client.query("release savepoint timetable_entry_write");
    return mapTimetableEntry(await loadEntryRow(client, orgId, inserted.rows[0]!.id));
  } catch (error) {
    await client.query("rollback to savepoint timetable_entry_write");
    return await friendlyTimetableConflict(client, orgId, error);
  }
}

async function insertTeachers(
  client: Parameters<typeof requireOrgRow>[0],
  orgId: string,
  entryId: string,
  teachers: z.infer<typeof teacherInputSchema>[],
) {
  for (const teacher of teachers) {
    await requireOrgRow(client, "staff_profiles", teacher.staffProfileId, orgId);
    await client.query(
      `insert into timetable_entry_teachers (
         organisation_id, timetable_entry_id, staff_profile_id, participation_role, is_primary
       ) values ($1,$2,$3,$4,$5)`,
      [
        orgId,
        entryId,
        teacher.staffProfileId,
        teacher.participationRole ?? "teacher",
        teacher.isPrimary ?? teachers.length === 1,
      ],
    );
  }
}

async function timetableDefinitionScope(
  client: Parameters<typeof requireOrgRow>[0],
  actor: Parameters<typeof authorisedTimetableClassIds>[1],
  asOfDate: string,
) {
  const classIds = await permanentlyAssignedClassIds(client, actor.userId, actor.organisationId!, asOfDate);
  const participating = await participatingEntryIds(client, actor.userId, actor.organisationId!);
  const covered = await coveredEntryIds(client, actor.userId, actor.organisationId!, asOfDate);
  return {
    classIds,
    entryIds: new Set([...participating, ...covered]),
  };
}

async function filterAssignedOccurrences(
  client: Parameters<typeof requireOrgRow>[0],
  actor: Parameters<typeof authorisedTimetableClassIds>[1],
  from: string,
  to: string,
  occurrences: Awaited<ReturnType<typeof resolveTimetableOccurrences>>,
) {
  const permanentByDate = new Map<string, Set<string>>();
  for (const date of eachDateInclusive(from, to)) {
    permanentByDate.set(
      date,
      await permanentlyAssignedClassIds(client, actor.userId, actor.organisationId!, date),
    );
  }
  return occurrences.filter((item) => {
    if (permanentByDate.get(item.date)?.has(item.classId)) return true;
    return item.teachers.some((teacher) => teacher.userId === actor.userId);
  });
}

async function authorisedClassIdsByDate(
  client: Parameters<typeof requireOrgRow>[0],
  actor: Parameters<typeof authorisedTimetableClassIds>[1],
  from: string,
  to: string,
) {
  const map = new Map<string, Set<string>>();
  for (const date of eachDateInclusive(from, to)) {
    const ids = await authorisedTimetableClassIds(client, actor, date);
    map.set(date, ids ?? new Set());
  }
  return map;
}

function addDaysSafe(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function listPupilTimetable(
  client: Parameters<typeof requireOrgRow>[0],
  organisationId: string,
  studentProfileId: string,
  from: string,
  to: string,
) {
  const memberships = await loadStudentClassMembershipsOverlapping(
    client,
    organisationId,
    studentProfileId,
    from,
    to,
  );
  if (memberships.length === 0) return [];
  const occurrences = await resolveTimetableOccurrences(client, {
    organisationId,
    from,
    to,
    classIds: [...new Set(memberships.map((row) => row.classId))],
    includeCancelled: true,
  });
  return occurrences.filter((item) =>
    memberships.some(
      (membership) =>
        membership.classId === item.classId &&
        membership.startedOn <= item.date &&
        (membership.endedOn === null || membership.endedOn >= item.date),
    ),
  );
}
