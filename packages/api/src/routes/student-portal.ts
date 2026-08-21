import { z } from "zod";
import type pg from "pg";
import { PERMISSIONS } from "@schoolapp/domain";
import {
  AppError,
  assertAnyPermission,
  assertPermission,
  resolveStudentPortalAccess,
  writeAudit,
  yearGroupPortalEffective,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";

const overrideSchema = z.object({
  enabled: z.boolean().nullable(),
});

async function syncYearGroupLoginColumn(
  client: pg.PoolClient,
  orgId: string,
  yearGroupId: string,
  enabled: boolean,
) {
  await client.query(
    `update year_groups
     set student_login_enabled = $3
     where id = $1 and organisation_id = $2`,
    [yearGroupId, orgId, enabled],
  );
}

export async function upsertYearGroupPortalOverride(
  client: pg.PoolClient,
  orgId: string,
  yearGroupId: string,
  enabled: boolean | null,
): Promise<void> {
  if (enabled === null) {
    await client.query(
      `delete from student_portal_year_group_overrides
       where organisation_id = $1 and year_group_id = $2`,
      [orgId, yearGroupId],
    );
    const policy = await client.query<{ default_enabled: boolean }>(
      `select default_enabled from student_portal_policies where organisation_id = $1`,
      [orgId],
    );
    await syncYearGroupLoginColumn(
      client,
      orgId,
      yearGroupId,
      policy.rows[0]?.default_enabled ?? false,
    );
    return;
  }
  await client.query(
    `insert into student_portal_year_group_overrides (organisation_id, year_group_id, enabled)
     values ($1, $2, $3)
     on conflict (year_group_id) do update set enabled = excluded.enabled, updated_at = now()`,
    [orgId, yearGroupId, enabled],
  );
  await syncYearGroupLoginColumn(client, orgId, yearGroupId, enabled);
}

export function registerStudentPortalRoutes(app: SchoolappApi) {
  app.get("/student-portal-policy", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [
        PERMISSIONS.STUDENTS_PORTAL_ACCESS_MANAGE,
        PERMISSIONS.ORG_SETTINGS_MANAGE,
        PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE,
        PERMISSIONS.ACADEMIC_STRUCTURE_READ,
      ]);
      await client.query("select ensure_organisation_phase6_defaults($1)", [orgId]);
      const policy = await client.query<{ default_enabled: boolean; updated_at: string }>(
        `select default_enabled, updated_at
         from student_portal_policies
         where organisation_id = $1`,
        [orgId],
      );
      const schoolDefault = policy.rows[0]?.default_enabled ?? false;
      const yearGroups = await client.query<{
        id: string;
        code: string;
        name: string;
        override: boolean | null;
      }>(
        `select yg.id, yg.code, yg.name, ovr.enabled as override
         from year_groups yg
         left join student_portal_year_group_overrides ovr
           on ovr.year_group_id = yg.id and ovr.organisation_id = yg.organisation_id
         where yg.organisation_id = $1
         order by yg.sort_order, yg.code`,
        [orgId],
      );
      return c.json({
        policy: {
          defaultEnabled: schoolDefault,
          updatedAt: policy.rows[0]?.updated_at ?? null,
        },
        yearGroups: yearGroups.rows.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          override: row.override,
          effectiveEnabled: yearGroupPortalEffective(schoolDefault, row.override),
        })),
        classOverridesSupported: true,
        studentOverridesSupported: true,
        classAndStudentOverrideUi: "deferred",
      });
    }),
  );

  app.patch("/student-portal-policy", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PORTAL_ACCESS_MANAGE);
      const parsed = z.object({ defaultEnabled: z.boolean() }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid portal policy");
      await client.query("select ensure_organisation_phase6_defaults($1)", [orgId]);
      const existing = await client.query<{ default_enabled: boolean }>(
        `select default_enabled from student_portal_policies where organisation_id = $1`,
        [orgId],
      );
      const updated = await client.query(
        `insert into student_portal_policies (organisation_id, default_enabled, updated_by)
         values ($1, $2, $3)
         on conflict (organisation_id) do update
           set default_enabled = excluded.default_enabled,
               updated_by = excluded.updated_by,
               updated_at = now()
         returning default_enabled, updated_at`,
        [orgId, parsed.data.defaultEnabled, userId],
      );
      await client.query(
        `update year_groups yg
         set student_login_enabled = $2
         where yg.organisation_id = $1
           and not exists (
             select 1 from student_portal_year_group_overrides o
             where o.year_group_id = yg.id
           )`,
        [orgId, parsed.data.defaultEnabled],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "students.portal_policy.updated",
        entityType: "student_portal_policy",
        entityId: orgId,
        before: existing.rows[0] ?? null,
        after: { defaultEnabled: parsed.data.defaultEnabled },
      });
      return c.json({
        policy: {
          defaultEnabled: updated.rows[0]!.default_enabled,
          updatedAt: updated.rows[0]!.updated_at,
        },
      });
    }),
  );

  app.put("/student-portal-policy/year-groups/:yearGroupId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PORTAL_ACCESS_MANAGE);
      const parsed = overrideSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid year group portal override");
      const yearGroupId = uuidRouteParam(c, "yearGroupId");
      const yg = await client.query(`select id from year_groups where id = $1 and organisation_id = $2`, [
        yearGroupId,
        orgId,
      ]);
      if (!yg.rows[0]) throw new AppError(404, "not_found", "Not found");
      await upsertYearGroupPortalOverride(client, orgId, yearGroupId, parsed.data.enabled);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "students.portal_policy.year_group.updated",
        entityType: "year_group",
        entityId: yearGroupId,
        after: { enabled: parsed.data.enabled },
      });
      const policy = await client.query<{ default_enabled: boolean }>(
        `select default_enabled from student_portal_policies where organisation_id = $1`,
        [orgId],
      );
      return c.json({
        yearGroupId,
        override: parsed.data.enabled,
        effectiveEnabled: yearGroupPortalEffective(
          policy.rows[0]?.default_enabled ?? false,
          parsed.data.enabled,
        ),
      });
    }),
  );

  app.put("/student-portal-policy/classes/:classId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PORTAL_ACCESS_MANAGE);
      const parsed = overrideSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid class portal override");
      const classId = uuidRouteParam(c, "classId");
      const cls = await client.query(`select id from classes where id = $1 and organisation_id = $2`, [
        classId,
        orgId,
      ]);
      if (!cls.rows[0]) throw new AppError(404, "not_found", "Not found");
      if (parsed.data.enabled === null) {
        await client.query(
          `delete from student_portal_class_overrides where organisation_id = $1 and class_id = $2`,
          [orgId, classId],
        );
      } else {
        await client.query(
          `insert into student_portal_class_overrides (organisation_id, class_id, enabled)
           values ($1, $2, $3)
           on conflict (class_id) do update set enabled = excluded.enabled, updated_at = now()`,
          [orgId, classId, parsed.data.enabled],
        );
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "students.portal_policy.class.updated",
        entityType: "class",
        entityId: classId,
        after: { enabled: parsed.data.enabled },
      });
      return c.json({ classId, override: parsed.data.enabled });
    }),
  );

  app.put("/student-portal-policy/students/:studentId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PORTAL_ACCESS_MANAGE);
      const parsed = overrideSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid student portal override");
      const studentId = uuidRouteParam(c, "studentId");
      const student = await client.query(
        `select id from student_profiles where id = $1 and organisation_id = $2`,
        [studentId, orgId],
      );
      if (!student.rows[0]) throw new AppError(404, "not_found", "Not found");
      if (parsed.data.enabled === null) {
        await client.query(
          `delete from student_portal_student_overrides
           where organisation_id = $1 and student_profile_id = $2`,
          [orgId, studentId],
        );
      } else {
        await client.query(
          `insert into student_portal_student_overrides (organisation_id, student_profile_id, enabled)
           values ($1, $2, $3)
           on conflict (student_profile_id) do update set enabled = excluded.enabled, updated_at = now()`,
          [orgId, studentId, parsed.data.enabled],
        );
      }
      const effective = resolveStudentPortalAccess({
        schoolDefault: false,
        yearGroupOverride: null,
        classOverride: null,
        studentOverride: parsed.data.enabled,
      });
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "students.portal_policy.student.updated",
        entityType: "student_profile",
        entityId: studentId,
        after: { enabled: parsed.data.enabled, source: effective.source },
      });
      return c.json({ studentId, override: parsed.data.enabled });
    }),
  );
}
