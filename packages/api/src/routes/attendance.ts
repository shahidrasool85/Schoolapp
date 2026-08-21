import { z } from "zod";
import type pg from "pg";
import { PERMISSIONS } from "@schoolapp/domain";
import {
  AppError,
  assertAnyPermission,
  assertPermission,
  assignedClassIds,
  assertCanAccessRegister,
  assertCanReadStudentAttendance,
  canCorrectAttendance,
  canManageAssignedAttendance,
  canManageSchoolAttendance,
  canReadSchoolAttendance,
  classStudentIdsAsOf,
  currentAcademicYear,
  isoDate,
  isAttendanceCategory,
  summariseAttendanceMarks,
  writeAudit,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import {
  mapAttendanceCode,
  mapAttendanceMark,
  mapAttendanceSessionType,
} from "../serialize";

const MARK_SELECT = `
  select
    am.id,
    am.student_profile_id,
    sp.legal_name as student_legal_name,
    am.academic_year_id,
    am.session_type_id,
    st.key as session_key,
    st.name as session_name,
    am.mark_date::text,
    am.attendance_code_id,
    ac.code,
    ac.name as code_name,
    ac.category,
    am.late_minutes,
    am.reason,
    am.note,
    am.parent_visible_note,
    am.class_id,
    c.name as class_name,
    am.year_group_id,
    yg.name as year_group_name,
    am.recorded_by,
    rec.full_name as recorded_by_name,
    am.recorded_at,
    am.last_corrected_by,
    corr.full_name as last_corrected_by_name,
    am.last_corrected_at
  from attendance_marks am
  join student_profiles sp on sp.id = am.student_profile_id
  join attendance_session_types st on st.id = am.session_type_id
  join attendance_codes ac on ac.id = am.attendance_code_id
  left join classes c on c.id = am.class_id
  left join year_groups yg on yg.id = am.year_group_id
  left join users rec on rec.id = am.recorded_by
  left join users corr on corr.id = am.last_corrected_by
`;

const registerBodySchema = z.object({
  classId: z.string().uuid(),
  date: z.string().date(),
  sessionTypeId: z.string().uuid(),
  markAllPresent: z.boolean().optional(),
  marks: z
    .array(
      z.object({
        studentProfileId: z.string().uuid(),
        codeId: z.string().uuid().optional(),
        code: z.string().min(1).max(16).optional(),
        lateMinutes: z.number().int().min(0).max(180).nullable().optional(),
        reason: z.string().max(200).nullable().optional(),
        note: z.string().max(1000).nullable().optional(),
        parentVisibleNote: z.string().max(500).nullable().optional(),
      }),
    )
    .max(80)
    .default([]),
});

const markPatchSchema = z.object({
  codeId: z.string().uuid().optional(),
  code: z.string().min(1).max(16).optional(),
  lateMinutes: z.number().int().min(0).max(180).nullable().optional(),
  reason: z.string().max(200).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  parentVisibleNote: z.string().max(500).nullable().optional(),
});

async function academicYearForDate(
  client: pg.PoolClient,
  orgId: string,
  date: string,
): Promise<{ id: string; name: string; starts_on: string; ends_on: string }> {
  const result = await client.query<{ id: string; name: string; starts_on: string; ends_on: string }>(
    `select id, name, starts_on::text, ends_on::text
     from academic_years
     where organisation_id = $1
       and starts_on <= $2::date
       and ends_on >= $2::date
     order by is_current desc, starts_on desc
     limit 1`,
    [orgId, date],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(400, "validation_failed", "Attendance date is outside the academic year");
  }
  return row;
}

function optionalUuidQuery(value: string | undefined): string | null {
  if (!value) return null;
  if (!z.string().uuid().safeParse(value).success) {
    throw new AppError(404, "not_found", "Not found");
  }
  return value;
}

async function loadSessionType(
  client: pg.PoolClient,
  orgId: string,
  sessionTypeId: string,
): Promise<{ id: string; key: string; name: string; is_active: boolean }> {
  const result = await client.query<{ id: string; key: string; name: string; is_active: boolean }>(
    `select id, key, name, is_active
     from attendance_session_types
     where id = $1 and organisation_id = $2`,
    [sessionTypeId, orgId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, "not_found", "Not found");
  return row;
}

async function loadClassContext(
  client: pg.PoolClient,
  orgId: string,
  classId: string,
): Promise<{ id: string; name: string; academic_year_id: string; year_group_id: string | null }> {
  const result = await client.query<{
    id: string;
    name: string;
    academic_year_id: string;
    year_group_id: string | null;
  }>(
    `select id, name, academic_year_id, year_group_id
     from classes
     where id = $1 and organisation_id = $2`,
    [classId, orgId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, "not_found", "Not found");
  return row;
}

async function resolveCodeId(
  client: pg.PoolClient,
  orgId: string,
  input: { codeId?: string; code?: string },
): Promise<string> {
  if (input.codeId) {
    const byId = await client.query<{ id: string }>(
      `select id from attendance_codes where id = $1 and organisation_id = $2`,
      [input.codeId, orgId],
    );
    if (!byId.rows[0]) throw new AppError(404, "not_found", "Not found");
    return byId.rows[0].id;
  }
  if (input.code) {
    const byCode = await client.query<{ id: string }>(
      `select id from attendance_codes where organisation_id = $1 and code = $2`,
      [orgId, input.code],
    );
    if (!byCode.rows[0]) throw new AppError(404, "not_found", "Not found");
    return byCode.rows[0].id;
  }
  throw new AppError(400, "validation_failed", "An attendance code is required");
}

async function presentCodeId(client: pg.PoolClient, orgId: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `select id from attendance_codes
     where organisation_id = $1 and code = 'present' and is_active
     order by sort_order
     limit 1`,
    [orgId],
  );
  if (!result.rows[0]) {
    throw new AppError(400, "validation_failed", "Present attendance code is not configured");
  }
  return result.rows[0].id;
}

async function upsertMark(
  client: pg.PoolClient,
  input: {
    orgId: string;
    studentProfileId: string;
    academicYearId: string;
    sessionTypeId: string;
    date: string;
    codeId: string;
    lateMinutes: number | null;
    reason: string | null;
    note: string | null;
    parentVisibleNote: string | null;
    classId: string | null;
    yearGroupId: string | null;
  },
): Promise<Record<string, unknown>> {
  const result = await client.query(
    `insert into attendance_marks (
       organisation_id, student_profile_id, academic_year_id, session_type_id, mark_date,
       attendance_code_id, reason, note, parent_visible_note, late_minutes, class_id, year_group_id
     ) values ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12)
     on conflict (organisation_id, student_profile_id, mark_date, session_type_id)
     do update set
       attendance_code_id = excluded.attendance_code_id,
       reason = excluded.reason,
       note = excluded.note,
       parent_visible_note = excluded.parent_visible_note,
       late_minutes = excluded.late_minutes,
       class_id = coalesce(excluded.class_id, attendance_marks.class_id),
       year_group_id = coalesce(excluded.year_group_id, attendance_marks.year_group_id)
     returning id`,
    [
      input.orgId,
      input.studentProfileId,
      input.academicYearId,
      input.sessionTypeId,
      input.date,
      input.codeId,
      input.reason,
      input.note,
      input.parentVisibleNote,
      input.lateMinutes,
      input.classId,
      input.yearGroupId,
    ],
  );
  const listed = await client.query(`${MARK_SELECT} where am.id = $1 and am.organisation_id = $2`, [
    result.rows[0]!.id,
    input.orgId,
  ]);
  return listed.rows[0] as Record<string, unknown>;
}

function requireAttendanceRead(actor: { permissions: ReadonlySet<string> }) {
  assertAnyPermission(actor, [
    PERMISSIONS.ATTENDANCE_RECORD_READ,
    PERMISSIONS.ATTENDANCE_RECORD_MANAGE,
    PERMISSIONS.ATTENDANCE_RECORD_CORRECT,
    PERMISSIONS.ATTENDANCE_RECORD_MANAGE_ASSIGNED,
  ]);
}

export function registerAttendanceRoutes(app: SchoolappApi) {
  app.get("/attendance/session-types", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      requireAttendanceRead(actor);
      await client.query("select ensure_organisation_phase6_defaults($1)", [orgId]);
      const rows = await client.query(
        `select id, key, name, sort_order, typical_start_time::text, typical_end_time::text, is_active
         from attendance_session_types
         where organisation_id = $1
         order by sort_order, key`,
        [orgId],
      );
      return c.json({ sessionTypes: rows.rows.map(mapAttendanceSessionType) });
    }),
  );

  app.post("/attendance/session-types", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ATTENDANCE_CONFIG_MANAGE);
      const parsed = z
        .object({
          key: z
            .string()
            .min(1)
            .max(32)
            .regex(/^[a-z0-9_]+$/),
          name: z.string().min(1).max(80),
          sortOrder: z.number().int().min(0).max(50).optional(),
          typicalStartTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
          typicalEndTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid session payload");
      const inserted = await client.query(
        `insert into attendance_session_types (
           organisation_id, key, name, sort_order, typical_start_time, typical_end_time
         ) values ($1,$2,$3,$4,$5::time,$6::time)
         returning id, key, name, sort_order, typical_start_time::text, typical_end_time::text, is_active`,
        [
          orgId,
          parsed.data.key,
          parsed.data.name,
          parsed.data.sortOrder ?? 0,
          parsed.data.typicalStartTime ?? null,
          parsed.data.typicalEndTime ?? null,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "attendance.session_type.created",
        entityType: "attendance_session_type",
        entityId: String(inserted.rows[0]!.id),
        after: mapAttendanceSessionType(inserted.rows[0]!),
      });
      return c.json({ sessionType: mapAttendanceSessionType(inserted.rows[0]!) }, 201);
    }),
  );

  app.patch("/attendance/session-types/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ATTENDANCE_CONFIG_MANAGE);
      const parsed = z
        .object({
          name: z.string().min(1).max(80).optional(),
          isActive: z.boolean().optional(),
          sortOrder: z.number().int().min(0).max(50).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid session payload");
      const updated = await client.query(
        `update attendance_session_types
         set name = coalesce($3, name),
             is_active = coalesce($4, is_active),
             sort_order = coalesce($5, sort_order)
         where id = $1 and organisation_id = $2
         returning id, key, name, sort_order, typical_start_time::text, typical_end_time::text, is_active`,
        [
          uuidRouteParam(c, "id"),
          orgId,
          parsed.data.name ?? null,
          parsed.data.isActive ?? null,
          parsed.data.sortOrder ?? null,
        ],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      return c.json({ sessionType: mapAttendanceSessionType(updated.rows[0]) });
    }),
  );

  app.get("/attendance/codes", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      requireAttendanceRead(actor);
      await client.query("select ensure_organisation_phase6_defaults($1)", [orgId]);
      const rows = await client.query(
        `select id, code, name, category, requires_late_minutes, is_active, sort_order
         from attendance_codes
         where organisation_id = $1
         order by sort_order, code`,
        [orgId],
      );
      return c.json({ codes: rows.rows.map(mapAttendanceCode) });
    }),
  );

  app.post("/attendance/codes", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ATTENDANCE_CONFIG_MANAGE);
      const parsed = z
        .object({
          code: z.string().min(1).max(16),
          name: z.string().min(1).max(80),
          category: z.enum([
            "present",
            "late",
            "authorised_absence",
            "unauthorised_absence",
            "not_required",
          ]),
          sortOrder: z.number().int().min(0).max(100).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid attendance code payload");
      const inserted = await client.query(
        `insert into attendance_codes (
           organisation_id, code, name, category, requires_late_minutes, sort_order
         ) values ($1,$2,$3,$4,$5,$6)
         returning id, code, name, category, requires_late_minutes, is_active, sort_order`,
        [
          orgId,
          parsed.data.code,
          parsed.data.name,
          parsed.data.category,
          parsed.data.category === "late",
          parsed.data.sortOrder ?? 10,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "attendance.code.created",
        entityType: "attendance_code",
        entityId: String(inserted.rows[0]!.id),
        after: mapAttendanceCode(inserted.rows[0]!),
      });
      return c.json({ code: mapAttendanceCode(inserted.rows[0]!) }, 201);
    }),
  );

  app.get("/attendance/my-classes", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      requireAttendanceRead(actor);
      const requestedDate = c.req.query("date") || isoDate();
      const year = await academicYearForDate(client, orgId, requestedDate).catch(async () => {
        const current = await currentAcademicYear(client, orgId);
        if (!current) throw new AppError(400, "validation_failed", "No academic year is configured");
        return current;
      });
      const suggestedDate =
        requestedDate >= year.starts_on && requestedDate <= year.ends_on
          ? requestedDate
          : year.starts_on;
      let classFilter: string[] | null = null;
      if (!canReadSchoolAttendance(actor) && canManageAssignedAttendance(actor)) {
        classFilter = [...(await assignedClassIds(client, userId, orgId, suggestedDate))];
        if (classFilter.length === 0) {
          return c.json({
            date: requestedDate,
            suggestedDate,
            academicYearId: year.id,
            classes: [],
          });
        }
      }
      const rows = await client.query(
        `select c.id, c.name, c.class_type, c.academic_year_id, c.year_group_id,
                yg.name as year_group_name, ay.name as academic_year_name
         from classes c
         join academic_years ay on ay.id = c.academic_year_id
         left join year_groups yg on yg.id = c.year_group_id
         where c.organisation_id = $1
           and c.academic_year_id = $2
           and ($3::uuid[] is null or c.id = any($3::uuid[]))
         order by yg.sort_order nulls last, c.name`,
        [orgId, year.id, classFilter],
      );
      return c.json({
        date: requestedDate,
        suggestedDate,
        academicYearId: year.id,
        classes: rows.rows.map((row) => ({
          id: row.id,
          name: row.name,
          classType: row.class_type,
          academicYearId: row.academic_year_id,
          yearGroupId: row.year_group_id,
          yearGroupName: row.year_group_name ?? null,
          academicYearName: row.academic_year_name ?? null,
        })),
      });
    }),
  );

  app.get("/attendance/registers", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const classId = c.req.query("classId");
      const date = c.req.query("date");
      const sessionTypeId = c.req.query("sessionTypeId");
      if (!classId || !date || !sessionTypeId) {
        throw new AppError(400, "validation_failed", "classId, date and sessionTypeId are required");
      }
      if (!z.string().uuid().safeParse(classId).success || !z.string().uuid().safeParse(sessionTypeId).success) {
        throw new AppError(404, "not_found", "Not found");
      }
      if (!z.string().date().safeParse(date).success) {
        throw new AppError(400, "validation_failed", "Invalid date");
      }
      await assertCanAccessRegister(client, actor, classId, date);
      const cls = await loadClassContext(client, orgId, classId);
      const session = await loadSessionType(client, orgId, sessionTypeId);
      const year = await academicYearForDate(client, orgId, date);
      const pupils = await client.query(
        `select
           sp.id as student_profile_id,
           sp.legal_name,
           u.preferred_name,
           am.id as mark_id,
           am.attendance_code_id,
           ac.code,
           ac.name as code_name,
           ac.category,
           am.late_minutes,
           am.reason,
           am.note,
           am.parent_visible_note,
           am.recorded_by,
           rec.full_name as recorded_by_name,
           am.recorded_at,
           am.last_corrected_by,
           am.last_corrected_at
         from class_memberships cm
         join student_profiles sp on sp.id = cm.student_profile_id
         left join users u on u.id = sp.user_id
         left join attendance_marks am
           on am.student_profile_id = sp.id
          and am.organisation_id = cm.organisation_id
          and am.mark_date = $3::date
          and am.session_type_id = $4
         left join attendance_codes ac on ac.id = am.attendance_code_id
         left join users rec on rec.id = am.recorded_by
         where cm.organisation_id = $1
           and cm.class_id = $2
           and cm.started_on <= $3::date
           and (cm.ended_on is null or cm.ended_on >= $3::date)
         order by sp.legal_name`,
        [orgId, classId, date, sessionTypeId],
      );
      return c.json({
        class: { id: cls.id, name: cls.name, yearGroupId: cls.year_group_id },
        date,
        academicYearId: year.id,
        sessionType: mapAttendanceSessionType(session),
        pupils: pupils.rows.map((row) => ({
          studentProfileId: row.student_profile_id,
          legalName: row.legal_name,
          preferredName: row.preferred_name ?? null,
          mark: row.mark_id
            ? mapAttendanceMark(
                {
                  id: row.mark_id,
                  student_profile_id: row.student_profile_id,
                  student_legal_name: row.legal_name,
                  academic_year_id: year.id,
                  session_type_id: sessionTypeId,
                  mark_date: date,
                  attendance_code_id: row.attendance_code_id,
                  code: row.code,
                  code_name: row.code_name,
                  category: row.category,
                  late_minutes: row.late_minutes,
                  reason: row.reason,
                  note: row.note,
                  parent_visible_note: row.parent_visible_note,
                  recorded_by: row.recorded_by,
                  recorded_by_name: row.recorded_by_name,
                  recorded_at: row.recorded_at,
                  last_corrected_by: row.last_corrected_by,
                  last_corrected_at: row.last_corrected_at,
                },
                { includeInternal: true },
              )
            : null,
        })),
      });
    }),
  );

  app.put("/attendance/registers", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const parsed = registerBodySchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid register payload");
      const { classId, date, sessionTypeId } = parsed.data;
      await assertCanAccessRegister(client, actor, classId, date);
      const cls = await loadClassContext(client, orgId, classId);
      await loadSessionType(client, orgId, sessionTypeId);
      const year = await academicYearForDate(client, orgId, date);
      const roster = await classStudentIdsAsOf(client, orgId, classId, date);
      const canWriteInternal = canManageSchoolAttendance(actor) || canCorrectAttendance(actor);
      const presentId = parsed.data.markAllPresent ? await presentCodeId(client, orgId) : null;

      const requested = new Map(parsed.data.marks.map((mark) => [mark.studentProfileId, mark]));
      const targets = new Set(requested.keys());
      if (presentId) {
        for (const studentId of roster) targets.add(studentId);
      }

      const saved = [];
      for (const studentId of targets) {
        if (!roster.has(studentId)) {
          throw new AppError(404, "not_found", "Not found");
        }
        const exception = requested.get(studentId);
        const codeId = exception
          ? await resolveCodeId(client, orgId, exception)
          : presentId!;
        const before = await client.query(
          `select id, attendance_code_id, reason, note, parent_visible_note, late_minutes
           from attendance_marks
           where organisation_id = $1 and student_profile_id = $2
             and mark_date = $3::date and session_type_id = $4`,
          [orgId, studentId, date, sessionTypeId],
        );
        const row = await upsertMark(client, {
          orgId,
          studentProfileId: studentId,
          academicYearId: year.id,
          sessionTypeId,
          date,
          codeId,
          lateMinutes: exception?.lateMinutes ?? null,
          reason: exception?.reason ?? null,
          note: canWriteInternal ? (exception?.note ?? null) : (before.rows[0]?.note ?? null),
          parentVisibleNote: canWriteInternal
            ? (exception?.parentVisibleNote ?? null)
            : (before.rows[0]?.parent_visible_note ?? null),
          classId,
          yearGroupId: cls.year_group_id,
        });
        saved.push(mapAttendanceMark(row, { includeInternal: true }));
        await writeAudit(client, {
          organisationId: orgId,
          actorUserId: userId,
          action: before.rows[0] ? "attendance.mark.updated" : "attendance.mark.recorded",
          entityType: "attendance_mark",
          entityId: String(row.id),
          before: before.rows[0] ?? null,
          after: {
            studentProfileId: studentId,
            date,
            sessionTypeId,
            codeId,
          },
        });
      }

      return c.json({ marks: saved, date, classId, sessionTypeId });
    }),
  );

  app.get("/attendance/marks", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      requireAttendanceRead(actor);
      const date = c.req.query("date");
      if (date && !z.string().date().safeParse(date).success) {
        throw new AppError(400, "validation_failed", "Invalid date");
      }
      const sessionTypeId = optionalUuidQuery(c.req.query("sessionTypeId"));
      const yearGroupId = optionalUuidQuery(c.req.query("yearGroupId"));
      const classId = optionalUuidQuery(c.req.query("classId"));
      const studentId = optionalUuidQuery(c.req.query("studentId"));
      const codeId = optionalUuidQuery(c.req.query("codeId"));
      const category = c.req.query("category");
      if (category && !isAttendanceCategory(category)) {
        throw new AppError(400, "validation_failed", "Invalid attendance category");
      }
      const assignedOnly = !canReadSchoolAttendance(actor);
      if (assignedOnly && !classId && !studentId) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      if (classId) {
        await assertCanAccessRegister(client, actor, classId, date || isoDate());
      }
      if (studentId) {
        await assertCanReadStudentAttendance(client, actor, studentId, date);
      }
      let assignedFilter: string[] | null = null;
      if (assignedOnly && !classId && !studentId) {
        assignedFilter = [];
      } else if (assignedOnly && !studentId) {
        assignedFilter = [...(await assignedClassIds(client, userId, orgId, date || isoDate()))];
      }
      const rows = await client.query(
        `${MARK_SELECT}
         where am.organisation_id = $1
           and ($2::date is null or am.mark_date = $2::date)
           and ($3::uuid is null or am.session_type_id = $3)
           and ($4::uuid is null or am.year_group_id = $4)
           and ($5::uuid is null or am.class_id = $5)
           and ($6::uuid is null or am.student_profile_id = $6)
           and ($7::uuid is null or am.attendance_code_id = $7)
           and ($8::text is null or ac.category = $8)
           and ($9::uuid[] is null or am.class_id = any($9::uuid[]))
         order by am.mark_date desc, sp.legal_name, st.sort_order
         limit 500`,
        [
          orgId,
          date || null,
          sessionTypeId || null,
          yearGroupId || null,
          classId || null,
          studentId || null,
          codeId || null,
          category || null,
          assignedFilter,
        ],
      );
      return c.json({ marks: rows.rows.map((row) => mapAttendanceMark(row, { includeInternal: true })) });
    }),
  );

  app.get("/attendance/marks/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadSchoolAttendance(actor) && !canCorrectAttendance(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const id = uuidRouteParam(c, "id");
      const existing = await client.query(`${MARK_SELECT} where am.id = $1 and am.organisation_id = $2`, [
        id,
        orgId,
      ]);
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      return c.json({ mark: mapAttendanceMark(existing.rows[0], { includeInternal: true }) });
    }),
  );

  app.patch("/attendance/marks/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canCorrectAttendance(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const parsed = markPatchSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid attendance correction");
      const id = uuidRouteParam(c, "id");
      const existing = await client.query(`${MARK_SELECT} where am.id = $1 and am.organisation_id = $2`, [
        id,
        orgId,
      ]);
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const codeId =
        parsed.data.codeId || parsed.data.code
          ? await resolveCodeId(client, orgId, parsed.data)
          : existing.rows[0].attendance_code_id;
      const updated = await client.query(
        `update attendance_marks
         set attendance_code_id = $3,
             late_minutes = $4,
             reason = $5,
             note = $6,
             parent_visible_note = $7
         where id = $1 and organisation_id = $2
         returning id`,
        [
          id,
          orgId,
          codeId,
          parsed.data.lateMinutes === undefined ? existing.rows[0].late_minutes : parsed.data.lateMinutes,
          parsed.data.reason === undefined ? existing.rows[0].reason : parsed.data.reason,
          parsed.data.note === undefined ? existing.rows[0].note : parsed.data.note,
          parsed.data.parentVisibleNote === undefined
            ? existing.rows[0].parent_visible_note
            : parsed.data.parentVisibleNote,
        ],
      );
      const listed = await client.query(`${MARK_SELECT} where am.id = $1 and am.organisation_id = $2`, [
        updated.rows[0]!.id,
        orgId,
      ]);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "attendance.mark.corrected",
        entityType: "attendance_mark",
        entityId: id,
        before: mapAttendanceMark(existing.rows[0], { includeInternal: true }),
        after: mapAttendanceMark(listed.rows[0]!, { includeInternal: true }),
      });
      return c.json({ mark: mapAttendanceMark(listed.rows[0]!, { includeInternal: true }) });
    }),
  );

  app.get("/attendance/marks/:id/revisions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadSchoolAttendance(actor) && !canCorrectAttendance(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const id = uuidRouteParam(c, "id");
      const mark = await client.query(`select id from attendance_marks where id = $1 and organisation_id = $2`, [
        id,
        orgId,
      ]);
      if (!mark.rows[0]) throw new AppError(404, "not_found", "Not found");
      const rows = await client.query(
        `select r.id, r.attendance_code_id, ac.code, ac.name as code_name, ac.category,
                r.reason, r.note, r.parent_visible_note, r.late_minutes,
                r.recorded_by, rec.full_name as recorded_by_name, r.recorded_at,
                r.superseded_by, sup.full_name as superseded_by_name, r.superseded_at
         from attendance_mark_revisions r
         join attendance_codes ac on ac.id = r.attendance_code_id
         left join users rec on rec.id = r.recorded_by
         left join users sup on sup.id = r.superseded_by
         where r.mark_id = $1 and r.organisation_id = $2
         order by r.superseded_at desc`,
        [id, orgId],
      );
      return c.json({
        revisions: rows.rows.map((row) => ({
          id: row.id,
          codeId: row.attendance_code_id,
          code: row.code,
          codeName: row.code_name,
          category: row.category,
          reason: row.reason,
          note: row.note,
          parentNote: row.parent_visible_note,
          lateMinutes: row.late_minutes,
          recordedBy: row.recorded_by,
          recordedByName: row.recorded_by_name,
          recordedAt: row.recorded_at,
          supersededBy: row.superseded_by,
          supersededByName: row.superseded_by_name,
          supersededAt: row.superseded_at,
        })),
      });
    }),
  );

  app.get("/attendance/students/:studentId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const studentId = uuidRouteParam(c, "studentId");
      await assertCanReadStudentAttendance(client, actor, studentId);
      const from = c.req.query("from");
      const to = c.req.query("to");
      const student = await client.query(
        `select id, legal_name from student_profiles where id = $1 and organisation_id = $2`,
        [studentId, orgId],
      );
      if (!student.rows[0]) throw new AppError(404, "not_found", "Not found");
      const rows = await client.query(
        `${MARK_SELECT}
         where am.organisation_id = $1
           and am.student_profile_id = $2
           and ($3::date is null or am.mark_date >= $3::date)
           and ($4::date is null or am.mark_date <= $4::date)
         order by am.mark_date desc, st.sort_order`,
        [orgId, studentId, from || null, to || null],
      );
      const summary = summariseAttendanceMarks(
        rows.rows.map((row) => ({ category: String(row.category) })),
      );
      return c.json({
        student: { id: student.rows[0].id, legalName: student.rows[0].legal_name },
        summary,
        marks: rows.rows.map((row) => mapAttendanceMark(row, { includeInternal: true })),
      });
    }),
  );

  app.get("/attendance/students/:studentId/summary", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const studentId = uuidRouteParam(c, "studentId");
      await assertCanReadStudentAttendance(client, actor, studentId);
      const student = await client.query(
        `select id from student_profiles where id = $1 and organisation_id = $2`,
        [studentId, orgId],
      );
      if (!student.rows[0]) throw new AppError(404, "not_found", "Not found");
      const rows = await client.query<{ category: string }>(
        `select ac.category
         from attendance_marks am
         join attendance_codes ac on ac.id = am.attendance_code_id
         where am.organisation_id = $1 and am.student_profile_id = $2`,
        [orgId, studentId],
      );
      return c.json({ summary: summariseAttendanceMarks(rows.rows) });
    }),
  );
}
