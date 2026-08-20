import { z } from "zod";
import { hashPassword } from "@schoolapp/auth";
import { PERMISSIONS } from "@schoolapp/domain";
import {
  AppError,
  assertAnyPermission,
  assertPermission,
  assignedStudentIds,
  canListAllStudents,
  canReadStudentProfile,
  writeAudit,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { studentListPermissions, withSchoolActor, routeParam } from "../school-context";
import {
  mapEnrolment,
  mapGuardianship,
  mapStaff,
  mapStaffAssignment,
  mapStudent,
} from "../serialize";

const studentCreateSchema = z.object({
  legalName: z.string().min(1).max(120),
  preferredName: z.string().max(80).optional(),
  admissionNumber: z.string().max(40).optional(),
  dateOfBirth: z.string().date().optional(),
  academicYearId: z.string().uuid().optional(),
  yearGroupId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  houseId: z.string().uuid().optional(),
  loginAlias: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9._-]+$/)
    .optional(),
  password: z.string().min(10).optional(),
});

const enrolmentSchema = z.object({
  academicYearId: z.string().uuid(),
  yearGroupId: z.string().uuid(),
  houseId: z.string().uuid().nullable().optional(),
  placementKind: z.enum(["primary", "secondary", "exceptional"]).default("primary"),
  startedOn: z.string().date().optional(),
  classId: z.string().uuid().optional(),
});

const staffCreateSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(120),
  jobTitle: z.string().max(80).optional(),
  employeeNumber: z.string().max(40).optional(),
  roleKeys: z.array(z.string().min(1)).min(1).default(["school.teacher"]),
  startedOn: z.string().date().optional(),
});

const guardianSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(120).optional(),
  relationship: z.string().min(1).max(40).default("other"),
  hasParentalResponsibility: z.boolean().optional(),
  isEmergencyContact: z.boolean().optional(),
  livesWithStudent: z.boolean().optional(),
  portalAccess: z.boolean().optional(),
  priority: z.number().int().min(1).max(9).optional(),
});

const STUDENT_LIST_SQL = `
  select
    sp.id,
    sp.user_id,
    sp.legal_name,
    u.preferred_name,
    u.date_of_birth::text,
    sp.admission_number,
    sp.enrolment_status,
    se.academic_year_id,
    se.year_group_id,
    yg.name as year_group_name,
    form.id as form_class_id,
    form.name as form_class_name
  from student_profiles sp
  left join users u on u.id = sp.user_id
  left join academic_years ay
    on ay.organisation_id = sp.organisation_id and ay.is_current
  left join student_enrolments se
    on se.student_profile_id = sp.id
   and se.academic_year_id = ay.id
   and se.is_primary
   and se.ended_on is null
  left join year_groups yg on yg.id = se.year_group_id
  left join lateral (
    select c.id, c.name
    from class_memberships cm
    join classes c on c.id = cm.class_id
    where cm.student_profile_id = sp.id
      and cm.ended_on is null
      and c.class_type = 'form'
      and (ay.id is null or cm.academic_year_id = ay.id)
    limit 1
  ) form on true
  where sp.organisation_id = $1
`;

export function registerPeopleRoutes(app: SchoolappApi) {
  app.get("/students", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, studentListPermissions);
      const q = c.req.query("q")?.trim();
      const yearGroupId = c.req.query("yearGroupId");
      const classId = c.req.query("classId");
      let assignedFilter: string[] | null = null;
      if (!canListAllStudents(actor) && actor.permissions.has(PERMISSIONS.STUDENTS_PROFILES_READ_ASSIGNED)) {
        assignedFilter = [...(await assignedStudentIds(client, userId, orgId))];
        if (assignedFilter.length === 0) {
          return c.json({ students: [] });
        }
      }
      const rows = await client.query(
        `${STUDENT_LIST_SQL}
         and ($2::text is null or sp.legal_name ilike '%' || $2 || '%' or sp.admission_number ilike '%' || $2 || '%')
         and ($3::uuid is null or se.year_group_id = $3)
         and ($4::uuid is null or form.id = $4)
         and ($5::uuid[] is null or sp.id = any($5::uuid[]))
         order by sp.legal_name`,
        [orgId, q || null, yearGroupId || null, classId || null, assignedFilter],
      );
      return c.json({ students: rows.rows.map(mapStudent) });
    }),
  );

  app.post("/students", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_MANAGE);
      const parsed = studentCreateSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid student payload");
      }
      if (parsed.data.loginAlias && !parsed.data.password) {
        throw new AppError(400, "validation_failed", "A password is required to enable student login");
      }
      const passwordHash = parsed.data.password ? await hashPassword(parsed.data.password) : null;
      const created = await client.query<{ provision_student: string }>(
        `select provision_student(
           $1, $2, $3, $4, $5, $6::date, $7::uuid, $8::uuid, $9::uuid, $10::uuid, $11::citext, $12
         )`,
        [
          userId,
          orgId,
          parsed.data.legalName,
          parsed.data.preferredName ?? null,
          parsed.data.admissionNumber ?? null,
          parsed.data.dateOfBirth ?? null,
          parsed.data.academicYearId ?? null,
          parsed.data.yearGroupId ?? null,
          parsed.data.classId ?? null,
          parsed.data.houseId ?? null,
          parsed.data.loginAlias ?? null,
          passwordHash,
        ],
      );
      const listed = await client.query(`${STUDENT_LIST_SQL} and sp.id = $2`, [
        orgId,
        created.rows[0]!.provision_student,
      ]);
      return c.json({ student: mapStudent(listed.rows[0]!) }, 201);
    }),
  );

  app.get("/students/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = routeParam(c, "id");
      const allowed = await canReadStudentProfile(client, userId, orgId, id, actor.permissions);
      if (!allowed) {
        throw new AppError(404, "not_found", "Not found");
      }
      const listed = await client.query(`${STUDENT_LIST_SQL} and sp.id = $2`, [orgId, id]);
      if (!listed.rows[0]) throw new AppError(404, "not_found", "Not found");
      const enrolments = await client.query(
        `select se.id, se.student_profile_id, se.academic_year_id, ay.name as academic_year_name,
                se.year_group_id, yg.name as year_group_name, se.house_id, h.name as house_name,
                se.status, se.is_primary, se.placement_kind, se.started_on::text, se.ended_on::text
         from student_enrolments se
         join academic_years ay on ay.id = se.academic_year_id
         join year_groups yg on yg.id = se.year_group_id
         left join houses h on h.id = se.house_id
         where se.student_profile_id = $1 and se.organisation_id = $2
         order by ay.starts_on desc, se.is_primary desc, se.started_on desc`,
        [id, orgId],
      );
      const memberships = await client.query(
        `select cm.id, cm.class_id, c.name as class_name, c.class_type, cm.student_profile_id,
                cm.academic_year_id, cm.started_on::text, cm.ended_on::text
         from class_memberships cm
         join classes c on c.id = cm.class_id
         where cm.student_profile_id = $1 and cm.organisation_id = $2
         order by cm.ended_on nulls first, cm.started_on desc`,
        [id, orgId],
      );
      const guardians = actor.permissions.has(PERMISSIONS.GUARDIANSHIPS_MANAGE)
        ? await client.query(
            `select g.id, g.student_profile_id, g.guardian_user_id, u.full_name, u.email,
                    g.relationship, g.has_parental_responsibility, g.is_emergency_contact,
                    g.lives_with_student, g.portal_access, g.priority,
                    g.started_on::text, g.ended_on::text
             from guardianships g
             join users u on u.id = g.guardian_user_id
             where g.student_profile_id = $1 and g.organisation_id = $2
             order by g.priority, u.full_name`,
            [id, orgId],
          )
        : { rows: [] };
      return c.json({
        student: mapStudent(listed.rows[0]),
        enrolments: enrolments.rows.map(mapEnrolment),
        classMemberships: memberships.rows.map((row) => ({
          id: row.id,
          classId: row.class_id,
          className: row.class_name,
          classType: row.class_type,
          academicYearId: row.academic_year_id,
          startedOn: row.started_on,
          endedOn: row.ended_on,
        })),
        guardians: guardians.rows.map(mapGuardianship),
      });
    }),
  );

  app.patch("/students/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_MANAGE);
      const parsed = z
        .object({
          legalName: z.string().min(1).max(120).optional(),
          admissionNumber: z.string().max(40).nullable().optional(),
          enrolmentStatus: z.enum(["prospective", "admitted", "enrolled", "left", "alumni"]).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid student payload");
      const existing = await client.query(
        `select id, legal_name, admission_number, enrolment_status
         from student_profiles where id = $1 and organisation_id = $2`,
        [c.req.param("id"), orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const updated = await client.query(
        `update student_profiles
         set legal_name = coalesce($3, legal_name),
             admission_number = coalesce($4, admission_number),
             enrolment_status = coalesce($5, enrolment_status)
         where id = $1 and organisation_id = $2
         returning id`,
        [
          c.req.param("id"),
          orgId,
          parsed.data.legalName ?? null,
          parsed.data.admissionNumber === undefined ? null : parsed.data.admissionNumber,
          parsed.data.enrolmentStatus ?? null,
        ],
      );
      if (parsed.data.legalName) {
        await client.query(
          `update users set full_name = $2
           where id = (select user_id from student_profiles where id = $1)`,
          [c.req.param("id"), parsed.data.legalName],
        );
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "student.profile.updated",
        entityType: "student_profile",
        entityId: c.req.param("id"),
        before: existing.rows[0],
        after: { ...existing.rows[0], ...parsed.data },
      });
      const listed = await client.query(`${STUDENT_LIST_SQL} and sp.id = $2`, [
        orgId,
        updated.rows[0]!.id,
      ]);
      return c.json({ student: mapStudent(listed.rows[0]!) });
    }),
  );

  app.post("/students/:id/enrolments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_MANAGE);
      const parsed = enrolmentSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid enrolment payload");
      const studentId = c.req.param("id");
      const student = await client.query(
        "select id from student_profiles where id = $1 and organisation_id = $2",
        [studentId, orgId],
      );
      if (!student.rows[0]) throw new AppError(404, "not_found", "Not found");

      const year = await client.query<{ starts_on: string }>(
        "select starts_on::text from academic_years where id = $1 and organisation_id = $2",
        [parsed.data.academicYearId, orgId],
      );
      if (!year.rows[0]) throw new AppError(404, "not_found", "Not found");
      const startedOn = parsed.data.startedOn ?? year.rows[0].starts_on;
      const isPrimary = parsed.data.placementKind === "primary";

      if (isPrimary) {
        await client.query(
          `update student_enrolments
           set ended_on = $4::date, status = 'completed'
           where student_profile_id = $1
             and academic_year_id = $2
             and organisation_id = $3
             and is_primary
             and ended_on is null`,
          [studentId, parsed.data.academicYearId, orgId, startedOn],
        );
      }

      const inserted = await client.query(
        `insert into student_enrolments (
           organisation_id, student_profile_id, academic_year_id, year_group_id, house_id,
           status, is_primary, placement_kind, started_on
         ) values ($1, $2, $3, $4, $5, 'enrolled', $6, $7, $8)
         returning id, student_profile_id, academic_year_id, year_group_id, house_id,
                   status, is_primary, placement_kind, started_on::text, ended_on::text`,
        [
          orgId,
          studentId,
          parsed.data.academicYearId,
          parsed.data.yearGroupId,
          parsed.data.houseId ?? null,
          isPrimary,
          parsed.data.placementKind,
          startedOn,
        ],
      );

      if (parsed.data.classId) {
        if (isPrimary) {
          await client.query(
            `update class_memberships cm
             set ended_on = $4::date
             from classes c
             where cm.class_id = c.id
               and cm.student_profile_id = $1
               and cm.academic_year_id = $2
               and cm.organisation_id = $3
               and cm.ended_on is null
               and c.class_type = 'form'`,
            [studentId, parsed.data.academicYearId, orgId, startedOn],
          );
        }
        await client.query(
          `insert into class_memberships (
             organisation_id, class_id, student_profile_id, academic_year_id, started_on
           ) values ($1, $2, $3, $4, $5)`,
          [orgId, parsed.data.classId, studentId, parsed.data.academicYearId, startedOn],
        );
      }

      await client.query(
        `update student_profiles set enrolment_status = 'enrolled'
         where id = $1 and organisation_id = $2`,
        [studentId, orgId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "student.enrolment.created",
        entityType: "student_enrolment",
        entityId: String(inserted.rows[0]!.id),
        after: inserted.rows[0],
      });
      return c.json({ enrolment: mapEnrolment(inserted.rows[0]!) }, 201);
    }),
  );

  app.patch("/student-enrolments/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_MANAGE);
      const parsed = z
        .object({
          endedOn: z.string().date(),
          status: z.enum(["withdrawn", "completed"]).default("completed"),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid enrolment payload");
      const updated = await client.query(
        `update student_enrolments
         set ended_on = $3::date, status = $4
         where id = $1 and organisation_id = $2 and ended_on is null
         returning id, student_profile_id, academic_year_id, year_group_id, house_id,
                   status, is_primary, placement_kind, started_on::text, ended_on::text`,
        [c.req.param("id"), orgId, parsed.data.endedOn, parsed.data.status],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "student.enrolment.ended",
        entityType: "student_enrolment",
        entityId: c.req.param("id"),
        after: updated.rows[0],
      });
      return c.json({ enrolment: mapEnrolment(updated.rows[0]) });
    }),
  );

  app.post("/students/:id/class-memberships", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_MANAGE);
      const parsed = z
        .object({
          classId: z.string().uuid(),
          startedOn: z.string().date().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid class membership payload");
      const cls = await client.query<{ academic_year_id: string; class_type: string; starts_on: string }>(
        `select c.academic_year_id, c.class_type, ay.starts_on::text
         from classes c
         join academic_years ay on ay.id = c.academic_year_id
         where c.id = $1 and c.organisation_id = $2`,
        [parsed.data.classId, orgId],
      );
      if (!cls.rows[0]) throw new AppError(404, "not_found", "Not found");
      const startedOn = parsed.data.startedOn ?? cls.rows[0].starts_on;
      if (cls.rows[0].class_type === "form") {
        await client.query(
          `update class_memberships cm
           set ended_on = $4::date
           from classes c
           where cm.class_id = c.id
             and cm.student_profile_id = $1
             and cm.academic_year_id = $2
             and cm.organisation_id = $3
             and cm.ended_on is null
             and c.class_type = 'form'`,
          [c.req.param("id"), cls.rows[0].academic_year_id, orgId, startedOn],
        );
      }
      const inserted = await client.query(
        `insert into class_memberships (
           organisation_id, class_id, student_profile_id, academic_year_id, started_on
         ) values ($1, $2, $3, $4, $5)
         returning id, class_id, student_profile_id, academic_year_id, started_on::text, ended_on::text`,
        [orgId, parsed.data.classId, c.req.param("id"), cls.rows[0].academic_year_id, startedOn],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "student.class_membership.created",
        entityType: "class_membership",
        entityId: String(inserted.rows[0]!.id),
        after: inserted.rows[0],
      });
      return c.json({ membership: inserted.rows[0] }, 201);
    }),
  );

  app.patch("/class-memberships/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_MANAGE);
      const parsed = z.object({ endedOn: z.string().date() }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid class membership payload");
      const updated = await client.query(
        `update class_memberships
         set ended_on = $3::date
         where id = $1 and organisation_id = $2 and ended_on is null
         returning id, class_id, student_profile_id, academic_year_id, started_on::text, ended_on::text`,
        [c.req.param("id"), orgId, parsed.data.endedOn],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "student.class_membership.ended",
        entityType: "class_membership",
        entityId: c.req.param("id"),
        after: updated.rows[0],
      });
      return c.json({ membership: updated.rows[0] });
    }),
  );

  app.post("/students/:id/guardians", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.GUARDIANSHIPS_MANAGE);
      const parsed = guardianSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid guardian payload");
      const created = await client.query(
        `select * from link_guardian($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          userId,
          orgId,
          c.req.param("id"),
          parsed.data.email.toLowerCase(),
          parsed.data.fullName ?? null,
          parsed.data.relationship,
          parsed.data.hasParentalResponsibility ?? false,
          parsed.data.isEmergencyContact ?? false,
          parsed.data.livesWithStudent ?? false,
          parsed.data.portalAccess ?? true,
          parsed.data.priority ?? 1,
        ],
      );
      const row = created.rows[0] as {
        guardianship_id: string;
        invitation_id: string | null;
        invitation_token: string | null;
        guardian_user_id: string;
      };
      return c.json(
        {
          guardianshipId: row.guardianship_id,
          invitationId: row.invitation_id,
          invitationToken: row.invitation_token,
          guardianUserId: row.guardian_user_id,
        },
        201,
      );
    }),
  );

  app.patch("/guardianships/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.GUARDIANSHIPS_MANAGE);
      const parsed = z
        .object({
          relationship: z.string().min(1).max(40).optional(),
          hasParentalResponsibility: z.boolean().optional(),
          isEmergencyContact: z.boolean().optional(),
          livesWithStudent: z.boolean().optional(),
          portalAccess: z.boolean().optional(),
          priority: z.number().int().min(1).max(9).optional(),
          endedOn: z.string().date().nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid guardianship payload");
      const updated = await client.query(
        `update guardianships
         set relationship = coalesce($3, relationship),
             has_parental_responsibility = coalesce($4, has_parental_responsibility),
             is_emergency_contact = coalesce($5, is_emergency_contact),
             lives_with_student = coalesce($6, lives_with_student),
             portal_access = coalesce($7, portal_access),
             priority = coalesce($8, priority),
             ended_on = coalesce($9::date, ended_on)
         where id = $1 and organisation_id = $2
         returning id, student_profile_id, guardian_user_id, relationship,
                   has_parental_responsibility, is_emergency_contact, lives_with_student,
                   portal_access, priority, started_on::text, ended_on::text`,
        [
          c.req.param("id"),
          orgId,
          parsed.data.relationship ?? null,
          parsed.data.hasParentalResponsibility ?? null,
          parsed.data.isEmergencyContact ?? null,
          parsed.data.livesWithStudent ?? null,
          parsed.data.portalAccess ?? null,
          parsed.data.priority ?? null,
          parsed.data.endedOn ?? null,
        ],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "guardianship.updated",
        entityType: "guardianship",
        entityId: c.req.param("id"),
        after: mapGuardianship(updated.rows[0]),
      });
      return c.json({ guardianship: mapGuardianship(updated.rows[0]) });
    }),
  );

  app.get("/guardians", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [
        PERMISSIONS.GUARDIANSHIPS_MANAGE,
        PERMISSIONS.ORG_MEMBERS_READ,
        PERMISSIONS.STUDENTS_PROFILES_READ,
      ]);
      const rows = await client.query(
        `select g.id, g.student_profile_id, sp.legal_name as student_legal_name,
                g.guardian_user_id, u.full_name, u.email, g.relationship,
                g.has_parental_responsibility, g.is_emergency_contact, g.lives_with_student,
                g.portal_access, g.priority, g.started_on::text, g.ended_on::text
         from guardianships g
         join users u on u.id = g.guardian_user_id
         join student_profiles sp on sp.id = g.student_profile_id
         where g.organisation_id = $1
         order by u.full_name, sp.legal_name`,
        [orgId],
      );
      return c.json({ guardians: rows.rows.map(mapGuardianship) });
    }),
  );

  app.get("/staff", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [PERMISSIONS.ORG_MEMBERS_READ, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE]);
      const rows = await client.query(
        `select sp.id, sp.user_id, u.full_name, u.email, sp.job_title, sp.employee_number,
                sp.started_on::text, m.status as membership_status,
                coalesce((
                  select array_agg(r.key order by r.key)
                  from membership_roles mr
                  join roles r on r.id = mr.role_id
                  where mr.membership_id = m.id
                ), '{}'::text[]) as role_keys
         from staff_profiles sp
         join users u on u.id = sp.user_id
         left join organisation_memberships m
           on m.user_id = sp.user_id and m.organisation_id = sp.organisation_id
         where sp.organisation_id = $1
         order by u.full_name`,
        [orgId],
      );
      return c.json({ staff: rows.rows.map(mapStaff) });
    }),
  );

  app.post("/staff", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_MEMBERS_MANAGE);
      const parsed = staffCreateSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid staff payload");
      const created = await client.query(
        "select * from provision_staff($1, $2, $3, $4, $5, $6, $7, $8::date)",
        [
          userId,
          orgId,
          parsed.data.email.toLowerCase(),
          parsed.data.fullName,
          parsed.data.jobTitle ?? null,
          parsed.data.employeeNumber ?? null,
          parsed.data.roleKeys,
          parsed.data.startedOn ?? null,
        ],
      );
      const row = created.rows[0] as {
        staff_profile_id: string;
        invitation_id: string;
        invitation_token: string;
        user_id: string;
      };
      return c.json(
        {
          staffProfileId: row.staff_profile_id,
          invitationId: row.invitation_id,
          invitationToken: row.invitation_token,
          userId: row.user_id,
        },
        201,
      );
    }),
  );

  app.get("/staff/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [PERMISSIONS.ORG_MEMBERS_READ, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE]);
      const rows = await client.query(
        `select sp.id, sp.user_id, u.full_name, u.email, sp.job_title, sp.employee_number,
                sp.started_on::text, m.status as membership_status,
                coalesce((
                  select array_agg(r.key order by r.key)
                  from membership_roles mr
                  join roles r on r.id = mr.role_id
                  where mr.membership_id = m.id
                ), '{}'::text[]) as role_keys
         from staff_profiles sp
         join users u on u.id = sp.user_id
         left join organisation_memberships m
           on m.user_id = sp.user_id and m.organisation_id = sp.organisation_id
         where sp.id = $1 and sp.organisation_id = $2`,
        [c.req.param("id"), orgId],
      );
      if (!rows.rows[0]) throw new AppError(404, "not_found", "Not found");
      const assignments = await client.query(
        `select csa.id, csa.class_id, c.name as class_name, csa.staff_profile_id,
                csa.assignment_role, csa.started_on::text, csa.ended_on::text,
                coalesce((
                  select json_agg(json_build_object('id', s.id, 'key', s.key, 'name', s.name) order by s.name)
                  from class_subjects cs
                  join subjects s on s.id = cs.subject_id
                  where cs.class_id = c.id
                ), '[]'::json) as subjects
         from class_staff_assignments csa
         join classes c on c.id = csa.class_id
         where csa.staff_profile_id = $1 and csa.organisation_id = $2
         order by csa.ended_on nulls first, c.name`,
        [c.req.param("id"), orgId],
      );
      return c.json({
        staff: mapStaff(rows.rows[0]),
        assignments: assignments.rows.map(mapStaffAssignment),
      });
    }),
  );

  app.patch("/staff/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ORG_MEMBERS_MANAGE);
      const parsed = z
        .object({
          jobTitle: z.string().max(80).nullable().optional(),
          employeeNumber: z.string().max(40).nullable().optional(),
          startedOn: z.string().date().nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid staff payload");
      const updated = await client.query(
        `update staff_profiles
         set job_title = coalesce($3, job_title),
             employee_number = coalesce($4, employee_number),
             started_on = coalesce($5::date, started_on)
         where id = $1 and organisation_id = $2
         returning id`,
        [
          c.req.param("id"),
          orgId,
          parsed.data.jobTitle ?? null,
          parsed.data.employeeNumber ?? null,
          parsed.data.startedOn ?? null,
        ],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      return c.json({ ok: true });
    }),
  );
}
