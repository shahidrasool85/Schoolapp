import { PERMISSIONS, type Actor } from "@schoolapp/domain";
import type pg from "pg";
import { AppError } from "./errors.js";
import { notFound } from "./permissions.js";
import { assignedClassIds, isAssignedToClass } from "./students-access.js";
import { dateInRange, inferAttendanceSessionKey, isoWeekdayFromDate } from "./timetable.js";

export const TIMETABLE_SCHOOL_READ_PERMISSIONS = [
  PERMISSIONS.TIMETABLE_READ,
  PERMISSIONS.TIMETABLE_MANAGE,
  PERMISSIONS.TIMETABLE_MANAGE_SCHOOL,
] as const;

export const TIMETABLE_READ_PERMISSIONS = [
  ...TIMETABLE_SCHOOL_READ_PERMISSIONS,
  PERMISSIONS.TIMETABLE_READ_ASSIGNED,
] as const;

export const TIMETABLE_MANAGE_PERMISSIONS = [
  PERMISSIONS.TIMETABLE_MANAGE,
  PERMISSIONS.TIMETABLE_MANAGE_SCHOOL,
] as const;

export function canReadSchoolTimetable(actor: Actor): boolean {
  return TIMETABLE_SCHOOL_READ_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canManageSchoolTimetable(actor: Actor): boolean {
  return TIMETABLE_MANAGE_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canManageSchoolDay(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.TIMETABLE_MANAGE_SCHOOL);
}

export function canReadAssignedTimetable(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.TIMETABLE_READ_ASSIGNED);
}

export function canReadRooms(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.TIMETABLE_ROOMS_READ) ||
    actor.permissions.has(PERMISSIONS.TIMETABLE_ROOMS_MANAGE) ||
    canReadSchoolTimetable(actor)
  );
}

export function canManageRooms(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.TIMETABLE_ROOMS_MANAGE);
}

export function canReadCover(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.TIMETABLE_COVER_READ) ||
    actor.permissions.has(PERMISSIONS.TIMETABLE_COVER_MANAGE) ||
    canReadSchoolTimetable(actor)
  );
}

export function canManageCover(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.TIMETABLE_COVER_MANAGE);
}

export function canReadOwnChildrenTimetable(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.TIMETABLE_READ_OWN_CHILDREN);
}

export function canReadOwnTimetable(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.TIMETABLE_READ_SELF);
}

export async function coveringClassIds(
  client: pg.PoolClient,
  actorUserId: string,
  organisationId: string,
  asOfDate: string,
): Promise<Set<string>> {
  const result = await client.query<{ class_id: string }>(
    `select distinct te.class_id
     from timetable_covers tc
     join timetable_entries te on te.id = tc.timetable_entry_id
     join staff_profiles sp on sp.id = tc.covering_staff_profile_id
     where sp.user_id = $1
       and sp.organisation_id = $2
       and tc.organisation_id = $2
       and te.organisation_id = $2
       and tc.cover_date = $3::date`,
    [actorUserId, organisationId, asOfDate],
  );
  return new Set(result.rows.map((row) => row.class_id));
}

export async function isCoveringClass(
  client: pg.PoolClient,
  actorUserId: string,
  organisationId: string,
  classId: string,
  asOfDate: string,
): Promise<boolean> {
  const result = await client.query(
    `select 1
     from timetable_covers tc
     join timetable_entries te on te.id = tc.timetable_entry_id
     join staff_profiles sp on sp.id = tc.covering_staff_profile_id
     where sp.user_id = $1
       and sp.organisation_id = $2
       and tc.organisation_id = $2
       and te.class_id = $3
       and tc.cover_date = $4::date
     limit 1`,
    [actorUserId, organisationId, classId, asOfDate],
  );
  return result.rows.length > 0;
}

export async function participatingClassIds(
  client: pg.PoolClient,
  actorUserId: string,
  organisationId: string,
): Promise<Set<string>> {
  const result = await client.query<{ class_id: string }>(
    `select distinct te.class_id
     from timetable_entry_teachers tet
     join timetable_entries te on te.id = tet.timetable_entry_id
     join staff_profiles sp on sp.id = tet.staff_profile_id
     where sp.user_id = $1
       and sp.organisation_id = $2
       and tet.organisation_id = $2
       and te.is_active`,
    [actorUserId, organisationId],
  );
  return new Set(result.rows.map((row) => row.class_id));
}

export async function authorisedTimetableClassIds(
  client: pg.PoolClient,
  actor: Actor,
  asOfDate?: string,
): Promise<Set<string> | null> {
  if (canReadSchoolTimetable(actor)) return null;
  const assigned = await assignedClassIds(client, actor.userId, actor.organisationId!, asOfDate);
  const covering = asOfDate
    ? await coveringClassIds(client, actor.userId, actor.organisationId!, asOfDate)
    : new Set<string>();
  return new Set([...assigned, ...covering]);
}

export async function assertCanReadClassTimetable(
  client: pg.PoolClient,
  actor: Actor,
  classId: string,
  asOfDate?: string,
): Promise<void> {
  if (canReadSchoolTimetable(actor)) return;
  if (!canReadAssignedTimetable(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
  const assigned = await isAssignedToClass(client, actor.userId, actor.organisationId!, classId, asOfDate);
  const covering = asOfDate
    ? await isCoveringClass(client, actor.userId, actor.organisationId!, classId, asOfDate)
    : false;
  if (!assigned && !covering) {
    notFound();
  }
}

export async function assertCanManageTimetable(actor: Actor): Promise<void> {
  if (!canManageSchoolTimetable(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export async function requireOrgRow(
  client: pg.PoolClient,
  table:
    | "academic_years"
    | "terms"
    | "classes"
    | "subjects"
    | "rooms"
    | "school_day_profiles"
    | "school_day_periods"
    | "staff_profiles"
    | "timetable_entries"
    | "year_groups"
    | "attendance_session_types",
  id: string,
  organisationId: string,
): Promise<Record<string, unknown>> {
  const result = await client.query<Record<string, unknown>>(
    `select * from ${table} where id = $1 and organisation_id = $2`,
    [id, organisationId],
  );
  const row = result.rows[0];
  if (!row) notFound();
  return row;
}

export type ClosureDateSet = Set<string>;

export async function loadSchoolClosureDates(
  client: pg.PoolClient,
  organisationId: string,
  from: string,
  to: string,
): Promise<ClosureDateSet> {
  const closures = new Set<string>();
  const explicit = await client.query<{ exception_date: string }>(
    `select exception_date::text
     from timetable_exceptions
     where organisation_id = $1
       and exception_type = 'school_closure'
       and timetable_entry_id is null
       and exception_date >= $2::date
       and exception_date <= $3::date`,
    [organisationId, from, to],
  );
  for (const row of explicit.rows) closures.add(row.exception_date);

  const holidays = await client.query<{ day: string }>(
    `select gs::date::text as day
     from school_events se
     join school_event_types st on st.id = se.event_type_id
     join generate_series(se.starts_at::date, se.ends_at::date, interval '1 day') gs on true
     where se.organisation_id = $1
       and se.status = 'published'
       and st.key in ('school_holiday', 'inset_day')
       and se.starts_at::date <= $3::date
       and se.ends_at::date >= $2::date`,
    [organisationId, from, to],
  );
  for (const row of holidays.rows) closures.add(row.day);
  return closures;
}

export async function loadTermWindows(
  client: pg.PoolClient,
  organisationId: string,
  academicYearId: string,
): Promise<Array<{ id: string; startsOn: string; endsOn: string }>> {
  const result = await client.query<{ id: string; starts_on: string; ends_on: string }>(
    `select id, starts_on::text, ends_on::text
     from terms
     where organisation_id = $1 and academic_year_id = $2
     order by starts_on`,
    [organisationId, academicYearId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
  }));
}

export function dateIsSchoolDate(
  date: string,
  terms: Array<{ id: string; startsOn: string; endsOn: string }>,
  termId: string | null,
  closures: ClosureDateSet,
): boolean {
  if (closures.has(date)) return false;
  if (termId) {
    const term = terms.find((item) => item.id === termId);
    return Boolean(term && dateInRange(date, term.startsOn, term.endsOn));
  }
  return terms.some((term) => dateInRange(date, term.startsOn, term.endsOn));
}

export type OccurrenceTeacher = {
  staffProfileId: string;
  userId: string | null;
  fullName: string;
  participationRole: string;
  isPrimary: boolean;
  isCover: boolean;
  originalStaffProfileId: string | null;
};

export type ResolvedOccurrence = {
  entryId: string;
  date: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  academicYearId: string;
  termId: string | null;
  periodId: string | null;
  periodName: string | null;
  periodType: string | null;
  classId: string;
  className: string;
  yearGroupId: string | null;
  yearGroupName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  roomId: string | null;
  roomName: string | null;
  roomCode: string | null;
  lessonType: string;
  status: ResolvedOccurrenceStatus;
  teachers: OccurrenceTeacher[];
  parentVisibleNote: string | null;
  staffNotes: string | null;
  attendanceSessionTypeId: string | null;
  covered: boolean;
};

type EntryRow = {
  id: string;
  academic_year_id: string;
  term_id: string | null;
  school_day_period_id: string | null;
  weekday: number;
  starts_at: string;
  ends_at: string;
  class_id: string;
  class_name: string;
  year_group_id: string | null;
  year_group_name: string | null;
  subject_id: string | null;
  subject_name: string | null;
  room_id: string | null;
  room_name: string | null;
  room_code: string | null;
  lesson_type: string;
  effective_from: string;
  effective_until: string | null;
  staff_notes: string | null;
  period_name: string | null;
  period_type: string | null;
  attendance_session_type_id: string | null;
};

export async function resolveTimetableOccurrences(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    from: string;
    to: string;
    academicYearId?: string | null;
    termId?: string | null;
    classIds?: string[] | null;
    staffProfileId?: string | null;
    coveringUserId?: string | null;
    roomId?: string | null;
    subjectId?: string | null;
    yearGroupId?: string | null;
    includeCancelled?: boolean;
  },
): Promise<ResolvedOccurrence[]> {
  const year =
    input.academicYearId ??
    (
      await client.query<{ id: string }>(
        `select id from academic_years
         where organisation_id = $1 and is_current
         limit 1`,
        [input.organisationId],
      )
    ).rows[0]?.id;
  if (!year) return [];

  const terms = await loadTermWindows(client, input.organisationId, year);
  const closures = await loadSchoolClosureDates(client, input.organisationId, input.from, input.to);
  const entries = await client.query<EntryRow>(
    `select
       te.id,
       te.academic_year_id,
       te.term_id,
       te.school_day_period_id,
       te.weekday,
       te.starts_at::text,
       te.ends_at::text,
       te.class_id,
       c.name as class_name,
       te.year_group_id,
       yg.name as year_group_name,
       te.subject_id,
       s.name as subject_name,
       te.room_id,
       r.name as room_name,
       r.short_code as room_code,
       te.lesson_type,
       te.effective_from::text,
       te.effective_until::text,
       te.staff_notes,
       p.name as period_name,
       p.period_type,
       p.attendance_session_type_id
     from timetable_entries te
     join classes c on c.id = te.class_id
     left join year_groups yg on yg.id = te.year_group_id
     left join subjects s on s.id = te.subject_id
     left join rooms r on r.id = te.room_id
     left join school_day_periods p on p.id = te.school_day_period_id
     where te.organisation_id = $1
       and te.academic_year_id = $2
       and te.is_active
       and te.effective_from <= $4::date
       and (te.effective_until is null or te.effective_until >= $3::date)
       and ($5::uuid is null or te.term_id is null or te.term_id = $5::uuid)
       and ($6::uuid[] is null or te.class_id = any($6::uuid[]))
       and ($7::uuid is null or te.room_id = $7::uuid)
       and ($8::uuid is null or te.subject_id = $8::uuid)
       and ($9::uuid is null or te.year_group_id = $9::uuid)`,
    [
      input.organisationId,
      year,
      input.from,
      input.to,
      input.termId ?? null,
      input.classIds ?? null,
      input.roomId ?? null,
      input.subjectId ?? null,
      input.yearGroupId ?? null,
    ],
  );

  if (entries.rows.length === 0) return [];

  const entryIds = entries.rows.map((row) => row.id);
  const teachers = await client.query<{
    timetable_entry_id: string;
    staff_profile_id: string;
    user_id: string | null;
    full_name: string;
    participation_role: string;
    is_primary: boolean;
  }>(
    `select
       tet.timetable_entry_id,
       tet.staff_profile_id,
       sp.user_id,
       u.full_name,
       tet.participation_role,
       tet.is_primary
     from timetable_entry_teachers tet
     join staff_profiles sp on sp.id = tet.staff_profile_id
     join users u on u.id = sp.user_id
     where tet.organisation_id = $1
       and tet.timetable_entry_id = any($2::uuid[])
     order by tet.is_primary desc, u.full_name`,
    [input.organisationId, entryIds],
  );
  const teachersByEntry = new Map<string, OccurrenceTeacher[]>();
  for (const row of teachers.rows) {
    const list = teachersByEntry.get(row.timetable_entry_id) ?? [];
    list.push({
      staffProfileId: row.staff_profile_id,
      userId: row.user_id,
      fullName: row.full_name,
      participationRole: row.participation_role,
      isPrimary: row.is_primary,
      isCover: false,
      originalStaffProfileId: null,
    });
    teachersByEntry.set(row.timetable_entry_id, list);
  }

  const exceptions = await client.query<{
    timetable_entry_id: string | null;
    exception_date: string;
    exception_type: string;
    replacement_room_id: string | null;
    replacement_room_name: string | null;
    replacement_room_code: string | null;
    replacement_subject_id: string | null;
    replacement_subject_name: string | null;
    replacement_starts_at: string | null;
    replacement_ends_at: string | null;
    replacement_lesson_type: string | null;
    parent_visible_note: string | null;
    staff_notes: string | null;
  }>(
    `select
       ex.timetable_entry_id,
       ex.exception_date::text,
       ex.exception_type,
       ex.replacement_room_id,
       rr.name as replacement_room_name,
       rr.short_code as replacement_room_code,
       ex.replacement_subject_id,
       rs.name as replacement_subject_name,
       ex.replacement_starts_at::text,
       ex.replacement_ends_at::text,
       ex.replacement_lesson_type,
       ex.parent_visible_note,
       ex.staff_notes
     from timetable_exceptions ex
     left join rooms rr on rr.id = ex.replacement_room_id
     left join subjects rs on rs.id = ex.replacement_subject_id
     where ex.organisation_id = $1
       and ex.exception_date >= $2::date
       and ex.exception_date <= $3::date
       and (ex.timetable_entry_id is null or ex.timetable_entry_id = any($4::uuid[]))`,
    [input.organisationId, input.from, input.to, entryIds],
  );
  const exceptionsByKey = new Map<string, (typeof exceptions.rows)[number]>();
  for (const row of exceptions.rows) {
    if (row.timetable_entry_id) {
      exceptionsByKey.set(`${row.timetable_entry_id}:${row.exception_date}:${row.exception_type}`, row);
    }
  }

  const covers = await client.query<{
    timetable_entry_id: string;
    cover_date: string;
    original_staff_profile_id: string;
    covering_staff_profile_id: string;
    covering_user_id: string | null;
    covering_name: string;
  }>(
    `select
       tc.timetable_entry_id,
       tc.cover_date::text,
       tc.original_staff_profile_id,
       tc.covering_staff_profile_id,
       sp.user_id as covering_user_id,
       u.full_name as covering_name
     from timetable_covers tc
     join staff_profiles sp on sp.id = tc.covering_staff_profile_id
     join users u on u.id = sp.user_id
     where tc.organisation_id = $1
       and tc.timetable_entry_id = any($2::uuid[])
       and tc.cover_date >= $3::date
       and tc.cover_date <= $4::date`,
    [input.organisationId, entryIds, input.from, input.to],
  );
  const coversByKey = new Map<string, (typeof covers.rows)[number][]>();
  for (const row of covers.rows) {
    const key = `${row.timetable_entry_id}:${row.cover_date}`;
    const list = coversByKey.get(key) ?? [];
    list.push(row);
    coversByKey.set(key, list);
  }

  const out: ResolvedOccurrence[] = [];
  for (const entry of entries.rows) {
    for (let cursor = input.from; cursor <= input.to; ) {
      if (
        isoWeekdayFromDate(cursor) === entry.weekday &&
        dateInRange(cursor, entry.effective_from, entry.effective_until) &&
        dateIsSchoolDate(cursor, terms, entry.term_id ?? input.termId ?? null, closures)
      ) {
        const dayExceptions = exceptions.rows.filter(
          (item) => item.timetable_entry_id === entry.id && item.exception_date === cursor,
        );
        const cancelled = dayExceptions.find((item) => item.exception_type === "cancelled");
        const changed = dayExceptions.find((item) => item.exception_type !== "cancelled");
        if (cancelled && !input.includeCancelled) {
          cursor = nextDate(cursor);
          continue;
        }
        const dayCovers = coversByKey.get(`${entry.id}:${cursor}`) ?? [];
        if (input.staffProfileId) {
          const participates = (teachersByEntry.get(entry.id) ?? []).some(
            (teacher) => teacher.staffProfileId === input.staffProfileId,
          );
          const covering = dayCovers.some((cover) => cover.covering_staff_profile_id === input.staffProfileId);
          if (!participates && !covering) {
            cursor = nextDate(cursor);
            continue;
          }
        }
        if (input.coveringUserId) {
          const participates = (teachersByEntry.get(entry.id) ?? []).some(
            (teacher) => teacher.userId === input.coveringUserId,
          );
          const covering = dayCovers.some((cover) => cover.covering_user_id === input.coveringUserId);
          if (!participates && !covering) {
            cursor = nextDate(cursor);
            continue;
          }
        }

        let teachersForDay = [...(teachersByEntry.get(entry.id) ?? [])];
        for (const cover of dayCovers) {
          teachersForDay = teachersForDay.filter((teacher) => teacher.staffProfileId !== cover.original_staff_profile_id);
          teachersForDay.push({
            staffProfileId: cover.covering_staff_profile_id,
            userId: cover.covering_user_id,
            fullName: cover.covering_name,
            participationRole: "teacher",
            isPrimary: true,
            isCover: true,
            originalStaffProfileId: cover.original_staff_profile_id,
          });
        }

        const status = cancelled
          ? "cancelled"
          : changed
            ? (changed.exception_type as ResolvedOccurrenceStatus)
            : dayCovers.length > 0
              ? "covered"
              : "scheduled";

        out.push({
          entryId: entry.id,
          date: cursor,
          weekday: entry.weekday,
          startsAt: changed?.replacement_starts_at ?? entry.starts_at,
          endsAt: changed?.replacement_ends_at ?? entry.ends_at,
          academicYearId: entry.academic_year_id,
          termId: entry.term_id,
          periodId: entry.school_day_period_id,
          periodName: entry.period_name,
          periodType: entry.period_type,
          classId: entry.class_id,
          className: entry.class_name,
          yearGroupId: entry.year_group_id,
          yearGroupName: entry.year_group_name,
          subjectId: changed?.replacement_subject_id ?? entry.subject_id,
          subjectName: changed?.replacement_subject_name ?? entry.subject_name,
          roomId: changed?.replacement_room_id ?? entry.room_id,
          roomName: changed?.replacement_room_name ?? entry.room_name,
          roomCode: changed?.replacement_room_code ?? entry.room_code,
          lessonType: changed?.replacement_lesson_type ?? entry.lesson_type,
          status,
          teachers: teachersForDay,
          parentVisibleNote: changed?.parent_visible_note ?? cancelled?.parent_visible_note ?? null,
          staffNotes: changed?.staff_notes ?? cancelled?.staff_notes ?? entry.staff_notes,
          attendanceSessionTypeId: entry.attendance_session_type_id,
          covered: dayCovers.length > 0,
        });
      }
      cursor = nextDate(cursor);
    }
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || a.startsAt.localeCompare(b.startsAt) || a.className.localeCompare(b.className));
  return out;
}

function nextDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export async function resolveAttendanceRegisterTarget(
  client: pg.PoolClient,
  organisationId: string,
  occurrence: Pick<ResolvedOccurrence, "classId" | "date" | "startsAt" | "periodType" | "attendanceSessionTypeId">,
): Promise<{ classId: string; date: string; sessionTypeId: string; sessionKey: string }> {
  if (occurrence.attendanceSessionTypeId) {
    const typed = await client.query<{ id: string; key: string }>(
      `select id, key from attendance_session_types
       where id = $1 and organisation_id = $2 and is_active`,
      [occurrence.attendanceSessionTypeId, organisationId],
    );
    if (typed.rows[0]) {
      return {
        classId: occurrence.classId,
        date: occurrence.date,
        sessionTypeId: typed.rows[0].id,
        sessionKey: typed.rows[0].key,
      };
    }
  }
  const inferred = inferAttendanceSessionKey(occurrence.startsAt, occurrence.periodType);
  const session = await client.query<{ id: string; key: string }>(
    `select id, key from attendance_session_types
     where organisation_id = $1 and key = $2 and is_active
     limit 1`,
    [organisationId, inferred],
  );
  const row = session.rows[0];
  if (!row) {
    throw new AppError(404, "not_found", "No matching attendance session type");
  }
  return {
    classId: occurrence.classId,
    date: occurrence.date,
    sessionTypeId: row.id,
    sessionKey: row.key,
  };
}

export async function loadStudentClassIdsAsOf(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
  asOfDate: string,
): Promise<string[]> {
  const result = await client.query<{ class_id: string }>(
    `select cm.class_id
     from class_memberships cm
     where cm.organisation_id = $1
       and cm.student_profile_id = $2
       and cm.started_on <= $3::date
       and (cm.ended_on is null or cm.ended_on >= $3::date)`,
    [organisationId, studentProfileId, asOfDate],
  );
  return result.rows.map((row) => row.class_id);
}
