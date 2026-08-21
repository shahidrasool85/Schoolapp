import { z } from "zod";
import { PERMISSIONS, YEAR_GROUP_CODES } from "@schoolapp/domain";
import { AppError, pgErrorToAppError, assertPermission, assignedStudentIds } from "@schoolapp/core";
import { withTenantContext } from "@schoolapp/db";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { withSchoolActor } from "../school-context";
import { requireBoundOrganisationId, assertCustomHostnameAllowed } from "../tenant-resolver";
import { writeAudit } from "@schoolapp/core";
import { validateOrganisationSlug, slugValidationMessage } from "@schoolapp/domain";

const inviteSchema = z.object({
  email: z.string().email(),
  roleKeys: z.array(z.string().min(1)).min(1),
});

export function registerOrganisationRoutes(app: SchoolappApi) {
  app.get("/organisation", requireUser, async (c) => {
    const orgId = requireBoundOrganisationId(c);
    const config = c.get("config");
    try {
      return await withTenantContext(config.pools.app, c.get("userId"), orgId, async (client) => {
        const org = await client.query(
          "select id, slug, name, status, timezone, country_code from organisations where id = $1",
          [orgId],
        );
        if (!org.rows[0]) {
          throw new AppError(404, "not_found", "Not found");
        }
        const perms = await client.query<{ permission_key: string }>(
          "select permission_key from list_permissions_for_membership($1, $2)",
          [c.get("userId"), orgId],
        );
        const keys = new Set(perms.rows.map((r) => r.permission_key));
        const grant = await client.query<{ scope: string }>(
          `select scope from support_access_grants
           where actor_user_id = $1 and organisation_id = $2
             and revoked_at is null and expires_at > now() and scope = 'organisation'
           limit 1`,
          [c.get("userId"), orgId],
        );
        const breakGlass = (grant.rowCount ?? 0) > 0;
        const canReadSettings = keys.has(PERMISSIONS.ORG_SETTINGS_READ) || breakGlass;
        const canReadBilling = keys.has(PERMISSIONS.ORG_BILLING_READ);

        const settings = canReadSettings
          ? await client.query(
              `select academic_year_start_month, locale, max_year_group_code, extras
               from organisation_settings where organisation_id = $1`,
              [orgId],
            )
          : null;
        const subscription = canReadBilling
          ? await client.query(
              `select s.status, p.key as plan_key, p.entitlements, p.pricing
               from organisation_subscriptions s
               left join plans p on p.id = s.plan_id
               where s.organisation_id = $1`,
              [orgId],
            )
          : null;

        return c.json({
          organisation: org.rows[0],
          settings: canReadSettings
            ? settings?.rows[0]
              ? {
                  academicYearStartMonth: settings.rows[0].academic_year_start_month,
                  locale: settings.rows[0].locale,
                  maxYearGroupCode: settings.rows[0].max_year_group_code,
                  extras: settings.rows[0].extras,
                }
              : null
            : null,
          subscription: canReadBilling ? (subscription?.rows[0] ?? null) : null,
        });
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.post("/invitations", requireUser, async (c) => {
    const orgId = requireBoundOrganisationId(c);
    const parsed = inviteSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError(400, "validation_failed", "Invalid invitation payload");
    }
    try {
      const result = await c.get("config").pools.app.query(
        "select * from create_school_invitation($1, $2, $3, $4)",
        [c.get("userId"), orgId, parsed.data.email.toLowerCase(), parsed.data.roleKeys],
      );
      const row = result.rows[0] as { invitation_id: string; invitation_token: string };
      return c.json(
        { invitationId: row.invitation_id, invitationToken: row.invitation_token },
        201,
      );
    } catch (error) {
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.patch("/organisation/settings", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const parsed = z
        .object({
          academicYearStartMonth: z.number().int().min(1).max(12).optional(),
          locale: z.string().min(2).max(16).optional(),
          maxYearGroupCode: z.enum(YEAR_GROUP_CODES).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid settings payload");
      }
      const updated = await client.query(
        `update organisation_settings
         set academic_year_start_month = coalesce($2, academic_year_start_month),
             locale = coalesce($3, locale),
             max_year_group_code = coalesce($4, max_year_group_code)
         where organisation_id = $1
         returning academic_year_start_month, locale, max_year_group_code, extras`,
        [
          orgId,
          parsed.data.academicYearStartMonth ?? null,
          parsed.data.locale ?? null,
          parsed.data.maxYearGroupCode ?? null,
        ],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      return c.json({
        settings: {
          academicYearStartMonth: updated.rows[0].academic_year_start_month,
          locale: updated.rows[0].locale,
          maxYearGroupCode: updated.rows[0].max_year_group_code,
          extras: updated.rows[0].extras,
        },
      });
    }),
  );

  app.get("/dashboard", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const year = await client.query(
        `select id, name, starts_on::text, ends_on::text, is_current
         from academic_years
         where organisation_id = $1 and is_current
         limit 1`,
        [orgId],
      );
      const counts = { students: 0, staff: 0, parents: 0, classes: 0, yearGroups: 0, subjects: 0 };
      if (actor.permissions.has(PERMISSIONS.STUDENTS_PROFILES_READ) ||
          actor.permissions.has(PERMISSIONS.STUDENTS_PROFILES_MANAGE)) {
        const students = await client.query<{ n: number }>(
          "select count(*)::int as n from student_profiles where organisation_id = $1",
          [orgId],
        );
        counts.students = students.rows[0]?.n ?? 0;
      } else if (actor.permissions.has(PERMISSIONS.STUDENTS_PROFILES_READ_ASSIGNED)) {
        counts.students = (await assignedStudentIds(client, userId, orgId)).size;
      }
      if (actor.permissions.has(PERMISSIONS.ORG_MEMBERS_READ)) {
        const staff = await client.query<{ n: number }>(
          "select count(*)::int as n from staff_profiles where organisation_id = $1",
          [orgId],
        );
        const parents = await client.query<{ n: number }>(
          `select count(distinct guardian_user_id)::int as n
           from guardianships
           where organisation_id = $1 and (ended_on is null or ended_on >= current_date)`,
          [orgId],
        );
        counts.staff = staff.rows[0]?.n ?? 0;
        counts.parents = parents.rows[0]?.n ?? 0;
      }
      if (
        actor.permissions.has(PERMISSIONS.ACADEMIC_STRUCTURE_READ) ||
        actor.permissions.has(PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE)
      ) {
        const classes = await client.query<{ n: number }>(
          "select count(*)::int as n from classes where organisation_id = $1",
          [orgId],
        );
        const yearGroups = await client.query<{ n: number }>(
          "select count(*)::int as n from year_groups where organisation_id = $1",
          [orgId],
        );
        const subjects = await client.query<{ n: number }>(
          "select count(*)::int as n from subjects where organisation_id = $1",
          [orgId],
        );
        counts.classes = classes.rows[0]?.n ?? 0;
        counts.yearGroups = yearGroups.rows[0]?.n ?? 0;
        counts.subjects = subjects.rows[0]?.n ?? 0;
      }
      return c.json({
        currentAcademicYear: year.rows[0]
          ? {
              id: year.rows[0].id,
              name: year.rows[0].name,
              startsOn: year.rows[0].starts_on,
              endsOn: year.rows[0].ends_on,
              isCurrent: year.rows[0].is_current,
            }
          : null,
        counts,
      });
    }),
  );

  app.get("/organisation/support-access", requireUser, async (c) => {
    const orgId = requireBoundOrganisationId(c);
    const config = c.get("config");
    try {
      return await withTenantContext(config.pools.app, c.get("userId"), orgId, async (client) => {
        const perms = await client.query<{ permission_key: string }>(
          "select permission_key from list_permissions_for_membership($1, $2)",
          [c.get("userId"), orgId],
        );
        const keys = new Set(perms.rows.map((r) => r.permission_key));
        if (!keys.has(PERMISSIONS.ORG_SUPPORT_ACCESS_READ) && !keys.has(PERMISSIONS.AUDIT_READ)) {
          throw new AppError(403, "forbidden", "Missing permission");
        }
        const grants = await client.query(
          `select id, actor_user_id, reason, scope, expires_at, revoked_at, created_at
           from support_access_grants
           where organisation_id = $1
           order by created_at desc`,
          [orgId],
        );
        return c.json({
          grants: grants.rows.map((row: Record<string, unknown>) => ({
            id: row.id,
            actorUserId: row.actor_user_id,
            reason: row.reason,
            scope: row.scope,
            expiresAt: row.expires_at,
            revokedAt: row.revoked_at,
            createdAt: row.created_at,
          })),
        });
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.patch("/organisation/slug", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const parsed = z.object({ slug: z.string().min(1) }).safeParse(await c.req.json());
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid slug payload");
      }
      const slug = validateOrganisationSlug(parsed.data.slug);
      if (!slug.ok) {
        throw new AppError(
          slug.error === "reserved" ? 400 : 400,
          slug.error === "reserved" ? "reserved_slug" : "validation_failed",
          slugValidationMessage(slug.error),
        );
      }
      const before = await client.query<{ slug: string; name: string }>(
        "select slug, name from organisations where id = $1",
        [orgId],
      );
      if (!before.rows[0]) throw new AppError(404, "not_found", "Not found");
      try {
        await client.query("update organisations set slug = $2 where id = $1", [orgId, slug.slug]);
      } catch (error) {
        throw pgErrorToAppError(error) ?? error;
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "org.slug.changed",
        entityType: "organisation",
        entityId: orgId,
        before: { slug: before.rows[0].slug },
        after: { slug: slug.slug },
      });
      return c.json({ slug: slug.slug });
    }),
  );

  app.get("/organisation/hostnames", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_READ);
      const rows = await client.query<{
        id: string;
        hostname: string;
        kind: string;
        verification_status: string;
        is_active: boolean;
        created_at: string;
        verified_at: string | null;
      }>(
        `select id, hostname, kind, verification_status, is_active, created_at, verified_at
         from organisation_hostnames
         where organisation_id = $1
         order by created_at desc`,
        [orgId],
      );
      return c.json({
        hostnames: rows.rows.map((row) => ({
          id: row.id,
          hostname: row.hostname,
          kind: row.kind,
          verificationStatus: row.verification_status,
          isActive: row.is_active,
          createdAt: row.created_at,
          verifiedAt: row.verified_at,
        })),
      });
    }),
  );

  app.post("/organisation/hostnames", requireUser, async (c) =>
    withSchoolActor(c, async ({ actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const parsed = z.object({ hostname: z.string().min(1) }).safeParse(await c.req.json());
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid hostname payload");
      }
      const hostname = parsed.data.hostname.trim().toLowerCase();
      assertCustomHostnameAllowed(hostname, c.get("config").platformDomain);
      try {
        const result = await c.get("config").pools.app.query(
          "select * from register_organisation_hostname($1, $2, $3)",
          [userId, orgId, hostname],
        );
        const row = result.rows[0] as {
          hostname_id: string;
          hostname: string;
          verification_status: string;
          is_active: boolean;
          verification_token: string;
        };
        return c.json(
          {
            id: row.hostname_id,
            hostname: row.hostname,
            verificationStatus: row.verification_status,
            isActive: row.is_active,
            verificationToken: row.verification_token,
          },
          201,
        );
      } catch (error) {
        throw pgErrorToAppError(error) ?? error;
      }
    }),
  );

  app.delete("/organisation/hostnames/:hostnameId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const hostnameId = c.req.param("hostnameId");
      const deleted = await client.query(
        `delete from organisation_hostnames
         where id = $1 and organisation_id = $2 and verification_status = 'pending' and is_active = false
         returning id`,
        [hostnameId, orgId],
      );
      if (!deleted.rows[0]) {
        throw new AppError(404, "not_found", "Not found");
      }
      return c.json({ ok: true });
    }),
  );
}

