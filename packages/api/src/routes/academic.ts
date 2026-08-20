import { z } from "zod";
import { PERMISSIONS } from "@schoolapp/domain";
import {
  AppError,
  assertAnyPermission,
  assertPermission,
  canListAllStudents,
  isAssignedToClass,
  writeAudit,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { academicReadPermissions, withSchoolActor, routeParam } from "../school-context";
import {
  mapAcademicYear,
  mapClass,
  mapHouse,
  mapSubject,
  mapTerm,
  mapYearGroup,
} from "../serialize";

const yearSchema = z.object({
  name: z.string().min(1).max(32),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  isCurrent: z.boolean().optional(),
});

const termSchema = z.object({
  key: z.string().min(1).max(32),
  name: z.string().min(1).max(80),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  sortOrder: z.number().int().min(0).max(20).optional(),
});

const yearGroupSchema = z.object({
  code: z.string().min(1).max(8),
  name: z.string().min(1).max(80).optional(),
  studentLoginEnabled: z.boolean().optional(),
});

const subjectSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
});

const classSchema = z.object({
  name: z.string().min(1).max(80),
  academicYearId: z.string().uuid(),
  yearGroupId: z.string().uuid().nullable().optional(),
  classType: z.enum(["form", "teaching"]).default("form"),
});

export function registerAcademicRoutes(app: SchoolappApi) {
  app.get("/academic-years", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const rows = await client.query(
        `select id, name, starts_on::text, ends_on::text, is_current, created_at
         from academic_years
         where organisation_id = $1
         order by starts_on desc`,
        [orgId],
      );
      return c.json({ academicYears: rows.rows.map(mapAcademicYear) });
    }),
  );

  app.post("/academic-years", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = yearSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid academic year payload");
      }
      if (parsed.data.endsOn < parsed.data.startsOn) {
        throw new AppError(400, "validation_failed", "Academic year end must be on or after start");
      }
      const inserted = await client.query(
        `insert into academic_years (
           organisation_id, name, starts_on, ends_on, is_current
         ) values ($1, $2, $3, $4, $5)
         returning id, name, starts_on::text, ends_on::text, is_current, created_at`,
        [
          orgId,
          parsed.data.name,
          parsed.data.startsOn,
          parsed.data.endsOn,
          parsed.data.isCurrent ?? false,
        ],
      );
      const row = inserted.rows[0]!;
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.year.created",
        entityType: "academic_year",
        entityId: String(row.id),
        after: mapAcademicYear(row),
      });
      return c.json({ academicYear: mapAcademicYear(row) }, 201);
    }),
  );

  app.patch("/academic-years/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = yearSchema.partial().safeParse(await c.req.json());
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid academic year payload");
      }
      const existing = await client.query(
        `select id, name, starts_on::text, ends_on::text, is_current, created_at
         from academic_years where id = $1 and organisation_id = $2`,
        [c.req.param("id"), orgId],
      );
      if (!existing.rows[0]) {
        throw new AppError(404, "not_found", "Not found");
      }
      const current = existing.rows[0];
      const updated = await client.query(
        `update academic_years
         set name = $3, starts_on = $4, ends_on = $5, is_current = $6
         where id = $1 and organisation_id = $2
         returning id, name, starts_on::text, ends_on::text, is_current, created_at`,
        [
          c.req.param("id"),
          orgId,
          parsed.data.name ?? current.name,
          parsed.data.startsOn ?? current.starts_on,
          parsed.data.endsOn ?? current.ends_on,
          parsed.data.isCurrent ?? current.is_current,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.year.updated",
        entityType: "academic_year",
        entityId: c.req.param("id"),
        before: mapAcademicYear(existing.rows[0]),
        after: mapAcademicYear(updated.rows[0]!),
      });
      return c.json({ academicYear: mapAcademicYear(updated.rows[0]!) });
    }),
  );

  app.get("/academic-years/:id/terms", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const year = await client.query("select id from academic_years where id = $1 and organisation_id = $2", [
        c.req.param("id"),
        orgId,
      ]);
      if (!year.rows[0]) throw new AppError(404, "not_found", "Not found");
      const rows = await client.query(
        `select id, academic_year_id, key, name, starts_on::text, ends_on::text, sort_order
         from terms
         where academic_year_id = $1 and organisation_id = $2
         order by sort_order, starts_on`,
        [c.req.param("id"), orgId],
      );
      return c.json({ terms: rows.rows.map(mapTerm) });
    }),
  );

  app.post("/academic-years/:id/terms", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = termSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid term payload");
      const inserted = await client.query(
        `insert into terms (
           organisation_id, academic_year_id, key, name, starts_on, ends_on, sort_order
         ) values ($1, $2, $3, $4, $5, $6, $7)
         returning id, academic_year_id, key, name, starts_on::text, ends_on::text, sort_order`,
        [
          orgId,
          c.req.param("id"),
          parsed.data.key,
          parsed.data.name,
          parsed.data.startsOn,
          parsed.data.endsOn,
          parsed.data.sortOrder ?? 0,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.term.created",
        entityType: "term",
        entityId: String(inserted.rows[0]!.id),
        after: mapTerm(inserted.rows[0]!),
      });
      return c.json({ term: mapTerm(inserted.rows[0]!) }, 201);
    }),
  );

  app.get("/year-groups", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const rows = await client.query(
        `select id, code, name, key_stage, sort_order, student_login_enabled
         from year_groups
         where organisation_id = $1
         order by sort_order, code`,
        [orgId],
      );
      return c.json({ yearGroups: rows.rows.map(mapYearGroup) });
    }),
  );

  app.post("/year-groups", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = yearGroupSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid year group payload");
      const inserted = await client.query(
        `insert into year_groups (organisation_id, code, name, student_login_enabled, sort_order)
         values ($1, $2, $3, $4, coalesce((select year_group_code_rank($2)), 0))
         returning id, code, name, key_stage, sort_order, student_login_enabled`,
        [
          orgId,
          parsed.data.code,
          parsed.data.name ?? defaultYearName(parsed.data.code),
          parsed.data.studentLoginEnabled ?? false,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.year_group.created",
        entityType: "year_group",
        entityId: String(inserted.rows[0]!.id),
        after: mapYearGroup(inserted.rows[0]!),
      });
      return c.json({ yearGroup: mapYearGroup(inserted.rows[0]!) }, 201);
    }),
  );

  app.post("/year-groups/seed", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const result = await client.query<{ seed_standard_year_groups: number }>(
        "select seed_standard_year_groups($1, $2)",
        [userId, orgId],
      );
      const rows = await client.query(
        `select id, code, name, key_stage, sort_order, student_login_enabled
         from year_groups where organisation_id = $1 order by sort_order, code`,
        [orgId],
      );
      return c.json({
        created: result.rows[0]?.seed_standard_year_groups ?? 0,
        yearGroups: rows.rows.map(mapYearGroup),
      });
    }),
  );

  app.patch("/year-groups/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = yearGroupSchema.partial().safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid year group payload");
      const existing = await client.query(
        `select id, code, name, key_stage, sort_order, student_login_enabled
         from year_groups where id = $1 and organisation_id = $2`,
        [c.req.param("id"), orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const updated = await client.query(
        `update year_groups
         set name = coalesce($3, name),
             student_login_enabled = coalesce($4, student_login_enabled)
         where id = $1 and organisation_id = $2
         returning id, code, name, key_stage, sort_order, student_login_enabled`,
        [
          c.req.param("id"),
          orgId,
          parsed.data.name ?? null,
          parsed.data.studentLoginEnabled ?? null,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.year_group.updated",
        entityType: "year_group",
        entityId: c.req.param("id"),
        before: mapYearGroup(existing.rows[0]),
        after: mapYearGroup(updated.rows[0]!),
      });
      return c.json({ yearGroup: mapYearGroup(updated.rows[0]!) });
    }),
  );

  app.get("/subjects", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const rows = await client.query(
        `select id, key, name from subjects where organisation_id = $1 order by name`,
        [orgId],
      );
      return c.json({ subjects: rows.rows.map(mapSubject) });
    }),
  );

  app.post("/subjects", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = subjectSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid subject payload");
      const inserted = await client.query(
        `insert into subjects (organisation_id, key, name) values ($1, $2, $3)
         returning id, key, name`,
        [orgId, parsed.data.key, parsed.data.name],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.subject.created",
        entityType: "subject",
        entityId: String(inserted.rows[0]!.id),
        after: mapSubject(inserted.rows[0]!),
      });
      return c.json({ subject: mapSubject(inserted.rows[0]!) }, 201);
    }),
  );

  app.patch("/subjects/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = z.object({ name: z.string().min(1).max(80) }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid subject payload");
      const updated = await client.query(
        `update subjects set name = $3 where id = $1 and organisation_id = $2 returning id, key, name`,
        [c.req.param("id"), orgId, parsed.data.name],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      return c.json({ subject: mapSubject(updated.rows[0]) });
    }),
  );

  app.get("/houses", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const rows = await client.query(
        `select id, name from houses where organisation_id = $1 order by name`,
        [orgId],
      );
      return c.json({ houses: rows.rows.map(mapHouse) });
    }),
  );

  app.post("/houses", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = z.object({ name: z.string().min(1).max(80) }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid house payload");
      const inserted = await client.query(
        `insert into houses (organisation_id, name) values ($1, $2) returning id, name`,
        [orgId, parsed.data.name],
      );
      return c.json({ house: mapHouse(inserted.rows[0]!) }, 201);
    }),
  );

  app.get("/classes", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const academicYearId = c.req.query("academicYearId");
      const rows = await client.query(
        `select c.id, c.name, c.class_type, c.academic_year_id, c.year_group_id,
                yg.name as year_group_name, ay.name as academic_year_name
         from classes c
         join academic_years ay on ay.id = c.academic_year_id
         left join year_groups yg on yg.id = c.year_group_id
         where c.organisation_id = $1
           and ($2::uuid is null or c.academic_year_id = $2)
         order by ay.starts_on desc, yg.sort_order nulls last, c.name`,
        [orgId, academicYearId || null],
      );
      return c.json({ classes: rows.rows.map(mapClass) });
    }),
  );

  app.post("/classes", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = classSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid class payload");
      const inserted = await client.query(
        `insert into classes (organisation_id, academic_year_id, year_group_id, name, class_type)
         values ($1, $2, $3, $4, $5)
         returning id, name, class_type, academic_year_id, year_group_id`,
        [
          orgId,
          parsed.data.academicYearId,
          parsed.data.yearGroupId ?? null,
          parsed.data.name,
          parsed.data.classType,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.class.created",
        entityType: "class",
        entityId: String(inserted.rows[0]!.id),
        after: mapClass(inserted.rows[0]!),
      });
      return c.json({ class: mapClass(inserted.rows[0]!) }, 201);
    }),
  );

  app.get("/classes/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const classId = routeParam(c, "id");
      const cls = await client.query(
        `select c.id, c.name, c.class_type, c.academic_year_id, c.year_group_id,
                yg.name as year_group_name, ay.name as academic_year_name
         from classes c
         join academic_years ay on ay.id = c.academic_year_id
         left join year_groups yg on yg.id = c.year_group_id
         where c.id = $1 and c.organisation_id = $2`,
        [classId, orgId],
      );
      if (!cls.rows[0]) throw new AppError(404, "not_found", "Not found");
      const subjects = await client.query(
        `select s.id, s.key, s.name
         from class_subjects cs
         join subjects s on s.id = cs.subject_id
         where cs.class_id = $1 and cs.organisation_id = $2
         order by s.name`,
        [classId, orgId],
      );
      const staff = await client.query(
        `select csa.id, csa.staff_profile_id, csa.assignment_role,
                csa.started_on::text, csa.ended_on::text, u.full_name, u.email, sp.job_title
         from class_staff_assignments csa
         join staff_profiles sp on sp.id = csa.staff_profile_id
         join users u on u.id = sp.user_id
         where csa.class_id = $1 and csa.organisation_id = $2
         order by csa.ended_on nulls first, u.full_name`,
        [classId, orgId],
      );
      const canSeeMembers =
        canListAllStudents(actor) ||
        (actor.permissions.has(PERMISSIONS.STUDENTS_PROFILES_READ_ASSIGNED) &&
          (await isAssignedToClass(client, userId, orgId, classId)));
      const members = canSeeMembers
        ? await client.query(
            `select cm.id, cm.student_profile_id, cm.started_on::text, cm.ended_on::text, sp.legal_name
             from class_memberships cm
             join student_profiles sp on sp.id = cm.student_profile_id
             where cm.class_id = $1 and cm.organisation_id = $2
             order by cm.ended_on nulls first, sp.legal_name`,
            [classId, orgId],
          )
        : { rows: [] };
      return c.json({
        class: mapClass(cls.rows[0]),
        subjects: subjects.rows.map(mapSubject),
        staff: staff.rows.map((row) => ({
          id: row.id,
          staffProfileId: row.staff_profile_id,
          assignmentRole: row.assignment_role,
          startedOn: row.started_on,
          endedOn: row.ended_on,
          fullName: row.full_name,
          email: row.email,
          jobTitle: row.job_title,
        })),
        members: members.rows.map((row) => ({
          id: row.id,
          studentProfileId: row.student_profile_id,
          legalName: row.legal_name,
          startedOn: row.started_on,
          endedOn: row.ended_on,
        })),
      });
    }),
  );

  app.post("/classes/:id/subjects", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = z.object({ subjectId: z.string().uuid() }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid class subject payload");
      const inserted = await client.query(
        `insert into class_subjects (organisation_id, class_id, subject_id)
         values ($1, $2, $3)
         returning id, class_id, subject_id`,
        [orgId, c.req.param("id"), parsed.data.subjectId],
      );
      return c.json({ classSubject: inserted.rows[0] }, 201);
    }),
  );

  app.delete("/classes/:id/subjects/:subjectId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const deleted = await client.query(
        `delete from class_subjects
         where organisation_id = $1 and class_id = $2 and subject_id = $3
         returning id`,
        [orgId, c.req.param("id"), c.req.param("subjectId")],
      );
      if (!deleted.rows[0]) throw new AppError(404, "not_found", "Not found");
      return c.json({ ok: true });
    }),
  );

  app.post("/classes/:id/staff", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = z
        .object({
          staffProfileId: z.string().uuid(),
          assignmentRole: z
            .enum(["form_tutor", "co_tutor", "subject_teacher", "head_of_year", "other"])
            .default("subject_teacher"),
          startedOn: z.string().date().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid staff assignment payload");
      const startedOn =
        parsed.data.startedOn ??
        (await classStartDate(client, orgId, routeParam(c, "id")));
      const inserted = await client.query(
        `insert into class_staff_assignments (
           organisation_id, class_id, staff_profile_id, assignment_role, started_on
         ) values ($1, $2, $3, $4, $5)
         returning id, class_id, staff_profile_id, assignment_role, started_on::text, ended_on::text`,
        [
          orgId,
          c.req.param("id"),
          parsed.data.staffProfileId,
          parsed.data.assignmentRole,
          startedOn,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.class_staff.assigned",
        entityType: "class_staff_assignment",
        entityId: String(inserted.rows[0]!.id),
        after: inserted.rows[0],
      });
      return c.json({ assignment: inserted.rows[0] }, 201);
    }),
  );

  app.patch("/class-staff-assignments/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = z.object({ endedOn: z.string().date() }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid assignment payload");
      const updated = await client.query(
        `update class_staff_assignments
         set ended_on = $3::date
         where id = $1 and organisation_id = $2 and ended_on is null
         returning id, class_id, staff_profile_id, assignment_role, started_on::text, ended_on::text`,
        [c.req.param("id"), orgId, parsed.data.endedOn],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.class_staff.ended",
        entityType: "class_staff_assignment",
        entityId: c.req.param("id"),
        after: updated.rows[0],
      });
      return c.json({ assignment: updated.rows[0] });
    }),
  );
}

function defaultYearName(code: string): string {
  if (code === "N") return "Nursery";
  if (code === "R") return "Reception";
  return `Year ${code}`;
}

async function classStartDate(
  client: import("pg").PoolClient,
  orgId: string,
  classId: string,
): Promise<string> {
  const result = await client.query(
    `select ay.starts_on::text
     from classes c
     join academic_years ay on ay.id = c.academic_year_id
     where c.id = $1 and c.organisation_id = $2`,
    [classId, orgId],
  );
  if (!result.rows[0]) throw new AppError(404, "not_found", "Not found");
  return result.rows[0].starts_on as string;
}
