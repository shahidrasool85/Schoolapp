import { z } from "zod";
import { hashPassword } from "@schoolapp/auth";
import { PERMISSIONS, isSamePrimaryPlacement, portalAccessGranted } from "@schoolapp/domain";
import {
  AppError,
  assertAnyPermission,
  assertPermission,
  assignedStudentIds,
  canListAllStudents,
  assertCanReadStudentBehaviour,
  assertCanReadStudentPastoral,
  canAccessBehaviour,
  canAccessPastoral,
  canReadStudentProfile,
  loadStudentPortalDecision,
  summariseAttendanceMarks,
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
  portalAccess: z.boolean().optional().default(false),
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
    sp.gender,
    sp.address_line1,
    sp.address_line2,
    sp.address_town,
    sp.address_postcode,
    se.academic_year_id,
    ay.name as academic_year_name,
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
      and ay.id is not null
      and cm.academic_year_id = ay.id
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
                    g.started_on::text, g.ended_on::text, m.status as membership_status
             from guardianships g
             join users u on u.id = g.guardian_user_id
             left join organisation_memberships m
               on m.user_id = u.id
              and m.organisation_id = g.organisation_id
              and m.ended_at is null
             where g.student_profile_id = $1 and g.organisation_id = $2
             order by g.priority, u.full_name`,
            [id, orgId],
          )
        : { rows: [] };

      const canReadAttendance =
        actor.permissions.has(PERMISSIONS.ATTENDANCE_RECORD_READ) ||
        actor.permissions.has(PERMISSIONS.ATTENDANCE_RECORD_MANAGE) ||
        actor.permissions.has(PERMISSIONS.ATTENDANCE_RECORD_CORRECT) ||
        actor.permissions.has(PERMISSIONS.ATTENDANCE_RECORD_MANAGE_ASSIGNED);
      const attendanceRows = canReadAttendance
        ? await client.query<{ category: string }>(
            `select ac.category
             from attendance_marks am
             join attendance_codes ac on ac.id = am.attendance_code_id
             where am.organisation_id = $1 and am.student_profile_id = $2`,
            [orgId, id],
          )
        : { rows: [] };
      let canSeeBehaviour = false;
      if (canAccessBehaviour(actor)) {
        try {
          await assertCanReadStudentBehaviour(client, actor, id);
          canSeeBehaviour = true;
        } catch {
          canSeeBehaviour = false;
        }
      }
      let canSeePastoral = false;
      if (canAccessPastoral(actor)) {
        try {
          await assertCanReadStudentPastoral(client, actor, id);
          canSeePastoral = true;
        } catch {
          canSeePastoral = false;
        }
      }
      const behaviourCounts = canSeeBehaviour
        ? await client.query<{ incident_count: string; open_incidents: string; positive_count: string }>(
            `select
               (select count(*) from behaviour_incidents where organisation_id = $1 and student_profile_id = $2)::text as incident_count,
               (select count(*) from behaviour_incidents where organisation_id = $1 and student_profile_id = $2 and status in ('open', 'in_progress'))::text as open_incidents,
               (select count(*) from positive_behaviour_records where organisation_id = $1 and student_profile_id = $2)::text as positive_count`,
            [orgId, id],
          )
        : { rows: [] as Array<{ incident_count: string; open_incidents: string; positive_count: string }> };
      const pastoralCounts = canSeePastoral
        ? await client.query<{ open_count: string; latest_priority: string | null }>(
            `select
               (select count(*) from pastoral_concerns where organisation_id = $1 and student_profile_id = $2 and status in ('open', 'monitoring'))::text as open_count,
               (select priority from pastoral_concerns where organisation_id = $1 and student_profile_id = $2 order by concern_on desc, raised_at desc limit 1) as latest_priority`,
            [orgId, id],
          )
        : { rows: [] as Array<{ open_count: string; latest_priority: string | null }> };
      const portal = await loadStudentPortalDecision(client, orgId, id);
      const alias = actor.permissions.has(PERMISSIONS.STUDENTS_PROFILES_MANAGE)
        ? await client.query<{ alias: string }>(
            `select a.alias
             from user_login_aliases a
             join student_profiles sp on sp.user_id = a.user_id
             where sp.id = $1 and a.organisation_id = $2`,
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
        attendanceSummary: canReadAttendance ? summariseAttendanceMarks(attendanceRows.rows) : null,
        behaviourSummary: canSeeBehaviour
          ? {
              incidentCount: Number(behaviourCounts.rows[0]?.incident_count ?? 0),
              openIncidents: Number(behaviourCounts.rows[0]?.open_incidents ?? 0),
              positiveCount: Number(behaviourCounts.rows[0]?.positive_count ?? 0),
            }
          : null,
        pastoralSummary: canSeePastoral
          ? {
              openCount: Number(pastoralCounts.rows[0]?.open_count ?? 0),
              latestPriority: pastoralCounts.rows[0]?.latest_priority ?? null,
            }
          : null,
        portalAccess: {
          enabled: portal.enabled,
          source: portal.source,
          ...(actor.permissions.has(PERMISSIONS.STUDENTS_PROFILES_MANAGE)
            ? { hasLoginAlias: alias.rows.length > 0, alias: alias.rows[0]?.alias ?? null }
            : {}),
        },
      });
    }),
  );

  app.patch("/students/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_MANAGE);
      const parsed = z
        .object({
          legalName: z.string().min(1).max(120).optional(),
          preferredName: z.string().max(80).nullable().optional(),
          admissionNumber: z.string().max(40).nullable().optional(),
          enrolmentStatus: z.enum(["prospective", "admitted", "enrolled", "left", "alumni"]).optional(),
          dateOfBirth: z.string().date().nullable().optional(),
          gender: z.enum(["male", "female", "prefer_not_to_say"]).nullable().optional(),
          addressLine1: z.string().max(120).nullable().optional(),
          addressLine2: z.string().max(120).nullable().optional(),
          addressTown: z.string().max(80).nullable().optional(),
          addressPostcode: z.string().max(16).nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid student payload");
      const existing = await client.query(
        `select sp.id, sp.user_id, sp.legal_name, sp.admission_number, sp.enrolment_status,
                sp.gender, sp.address_line1, sp.address_line2, sp.address_town, sp.address_postcode,
                u.preferred_name, u.date_of_birth::text as date_of_birth
         from student_profiles sp
         left join users u on u.id = sp.user_id
         where sp.id = $1 and sp.organisation_id = $2`,
        [c.req.param("id"), orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const data = parsed.data;
      const updated = await client.query(
        `update student_profiles
         set legal_name = coalesce($3, legal_name),
             admission_number = case when $4::boolean then $5::text else admission_number end,
             enrolment_status = coalesce($6, enrolment_status),
             gender = case when $7::boolean then $8::text else gender end,
             address_line1 = case when $9::boolean then $10::text else address_line1 end,
             address_line2 = case when $11::boolean then $12::text else address_line2 end,
             address_town = case when $13::boolean then $14::text else address_town end,
             address_postcode = case when $15::boolean then $16::text else address_postcode end
         where id = $1 and organisation_id = $2
         returning id, user_id`,
        [
          c.req.param("id"),
          orgId,
          data.legalName ?? null,
          data.admissionNumber !== undefined,
          data.admissionNumber ?? null,
          data.enrolmentStatus ?? null,
          data.gender !== undefined,
          data.gender ?? null,
          data.addressLine1 !== undefined,
          data.addressLine1 ?? null,
          data.addressLine2 !== undefined,
          data.addressLine2 ?? null,
          data.addressTown !== undefined,
          data.addressTown ?? null,
          data.addressPostcode !== undefined,
          data.addressPostcode ?? null,
        ],
      );
      const profile = updated.rows[0]!;
      if (profile.user_id && (data.legalName || data.preferredName !== undefined || data.dateOfBirth !== undefined)) {
        // users_update_self only allows a user to update their own row. School
        // Admin writes pupil identity through this SECURITY DEFINER helper.
        await client.query(
          `select update_student_user_identity($1, $2, $3, $4, $5, $6, $7, $8::date)`,
          [
            userId,
            orgId,
            profile.id,
            data.legalName ?? null,
            data.preferredName !== undefined,
            data.preferredName ?? null,
            data.dateOfBirth !== undefined,
            data.dateOfBirth ?? null,
          ],
        );
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "student.profile.updated",
        entityType: "student_profile",
        entityId: c.req.param("id"),
        before: existing.rows[0],
        after: { ...existing.rows[0], ...data },
      });
      const listed = await client.query(`${STUDENT_LIST_SQL} and sp.id = $2`, [
        orgId,
        profile.id,
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
      const yearGroup = await client.query("select id from year_groups where id = $1 and organisation_id = $2", [
        parsed.data.yearGroupId,
        orgId,
      ]);
      if (!yearGroup.rows[0]) throw new AppError(404, "not_found", "Not found");
      if (parsed.data.classId) {
        const formClass = await client.query<{
          academic_year_id: string;
          year_group_id: string | null;
          class_type: string;
        }>(
          `select academic_year_id, year_group_id, class_type
           from classes
           where id = $1 and organisation_id = $2`,
          [parsed.data.classId, orgId],
        );
        if (!formClass.rows[0]) throw new AppError(404, "not_found", "Not found");
        if (
          formClass.rows[0].class_type !== "form" ||
          formClass.rows[0].academic_year_id !== parsed.data.academicYearId ||
          (formClass.rows[0].year_group_id != null && formClass.rows[0].year_group_id !== parsed.data.yearGroupId)
        ) {
          throw new AppError(400, "validation_failed", "Form class must belong to the selected academic year and year group");
        }
      }
      const startedOn = parsed.data.startedOn ?? year.rows[0].starts_on;
      const isPrimary = parsed.data.placementKind === "primary";
      const currentPlacement = await client.query<{
        academic_year_id: string;
        year_group_id: string;
        form_class_id: string | null;
      }>(
        `select se.academic_year_id, se.year_group_id, form.id as form_class_id
         from student_enrolments se
         left join lateral (
           select c.id
           from class_memberships cm
           join classes c on c.id = cm.class_id
           where cm.student_profile_id = se.student_profile_id
             and cm.academic_year_id = se.academic_year_id
             and cm.ended_on is null
             and c.class_type = 'form'
           limit 1
         ) form on true
         where se.student_profile_id = $1
           and se.organisation_id = $2
           and se.is_primary
           and se.ended_on is null
         order by se.started_on desc
         limit 1`,
        [studentId, orgId],
      );
      const current = currentPlacement.rows[0];
      if (
        current &&
        isSamePrimaryPlacement({
          currentAcademicYearId: current.academic_year_id,
          currentYearGroupId: current.year_group_id,
          currentFormClassId: current.form_class_id,
          academicYearId: parsed.data.academicYearId,
          yearGroupId: parsed.data.yearGroupId,
          classId: parsed.data.classId ?? null,
          placementKind: parsed.data.placementKind,
        })
      ) {
        throw new AppError(409, "conflict", "The pupil is already in this placement.");
      }

      if (isPrimary) {
        await client.query(
          `update student_enrolments
           set ended_on = $3::date, status = 'completed'
           where student_profile_id = $1
             and organisation_id = $2
             and is_primary
             and ended_on is null`,
          [studentId, orgId, startedOn],
        );
        await client.query(
          `update class_memberships
           set ended_on = $3::date
           where student_profile_id = $1
             and organisation_id = $2
             and academic_year_id <> $4
             and ended_on is null`,
          [studentId, orgId, startedOn, parsed.data.academicYearId],
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
      if (updated.rows[0].is_primary) {
        await client.query(
          `update class_memberships
           set ended_on = $4::date
           where student_profile_id = $1
             and organisation_id = $2
             and academic_year_id = $3
             and ended_on is null`,
          [
            updated.rows[0].student_profile_id,
            orgId,
            updated.rows[0].academic_year_id,
            parsed.data.endedOn,
          ],
        );
      }
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
      const studentId = c.req.param("id");
      const student = await client.query("select id from student_profiles where id = $1 and organisation_id = $2", [
        studentId,
        orgId,
      ]);
      if (!student.rows[0]) throw new AppError(404, "not_found", "Not found");
      const email = parsed.data.email.toLowerCase();
      const existing = await client.query(
        `select g.id
         from guardianships g
         join users u on u.id = g.guardian_user_id
         where g.student_profile_id = $1
           and g.organisation_id = $2
           and u.email = $3
           and g.ended_on is null`,
        [studentId, orgId, email],
      );
      let invitationToken: string | null = null;
      let guardianshipId: string;
      let invitationId: string | null = null;
      let guardianUserId: string;
      if (existing.rows[0]) {
        guardianshipId = existing.rows[0].id as string;
        const linked = await client.query<{ guardian_user_id: string }>(
          `select guardian_user_id from guardianships where id = $1 and organisation_id = $2`,
          [guardianshipId, orgId],
        );
        guardianUserId = linked.rows[0]!.guardian_user_id;
      } else {
        const created = await client.query(
          `select * from link_guardian($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            userId,
            orgId,
            studentId,
            email,
            parsed.data.fullName ?? null,
            parsed.data.relationship,
            parsed.data.hasParentalResponsibility ?? false,
            parsed.data.isEmergencyContact ?? false,
            parsed.data.livesWithStudent ?? false,
            portalAccessGranted(parsed.data.portalAccess),
            parsed.data.priority ?? 1,
          ],
        );
        const row = created.rows[0] as {
          guardianship_id: string;
          invitation_id: string | null;
          invitation_token: string | null;
          created_user_id: string;
        };
        guardianshipId = row.guardianship_id;
        invitationId = row.invitation_id;
        invitationToken = row.invitation_token;
        guardianUserId = row.created_user_id;
      }
      const listed = await client.query(
        `select g.id, g.student_profile_id, g.guardian_user_id, u.full_name, u.email,
                g.relationship, g.has_parental_responsibility, g.is_emergency_contact,
                g.lives_with_student, g.portal_access, g.priority,
                g.started_on::text, g.ended_on::text, m.status as membership_status
         from guardianships g
         join users u on u.id = g.guardian_user_id
         left join organisation_memberships m
           on m.user_id = u.id
          and m.organisation_id = g.organisation_id
          and m.ended_at is null
         where g.id = $1 and g.organisation_id = $2`,
        [guardianshipId, orgId],
      );
      return c.json(
        {
          guardianshipId,
          invitationId,
          invitationToken,
          guardianUserId,
          alreadyLinked: Boolean(existing.rows[0]),
          guardianship: listed.rows[0] ? mapGuardianship(listed.rows[0]) : null,
        },
        existing.rows[0] ? 200 : 201,
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
             ended_on = case when $9::boolean then $10::date else ended_on end
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
          parsed.data.endedOn !== undefined,
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
                g.portal_access, g.priority, g.started_on::text, g.ended_on::text,
                m.status as membership_status
         from guardianships g
         join users u on u.id = g.guardian_user_id
         join student_profiles sp on sp.id = g.student_profile_id
         left join organisation_memberships m
           on m.user_id = u.id
          and m.organisation_id = g.organisation_id
          and m.ended_at is null
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
        created_user_id: string;
      };
      return c.json(
        {
          staffProfileId: row.staff_profile_id,
          invitationId: row.invitation_id,
          invitationToken: row.invitation_token,
          userId: row.created_user_id,
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
         set job_title = case when $3::boolean then $4::text else job_title end,
             employee_number = case when $5::boolean then $6::text else employee_number end,
             started_on = case when $7::boolean then $8::date else started_on end
         where id = $1 and organisation_id = $2
         returning id`,
        [
          c.req.param("id"),
          orgId,
          parsed.data.jobTitle !== undefined,
          parsed.data.jobTitle ?? null,
          parsed.data.employeeNumber !== undefined,
          parsed.data.employeeNumber ?? null,
          parsed.data.startedOn !== undefined,
          parsed.data.startedOn ?? null,
        ],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      return c.json({ ok: true });
    }),
  );
}
