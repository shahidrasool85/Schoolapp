import { z } from "zod";
import { PERMISSIONS } from "@schoolapp/domain";
import { AppError, pgErrorToAppError } from "@schoolapp/core";
import { withTenantContext } from "@schoolapp/db";
import type { SchoolappApi } from "../types";
import { requestedOrganisationId, requireUser } from "../auth-middleware";

const inviteSchema = z.object({
  email: z.string().email(),
  roleKeys: z.array(z.string().min(1)).min(1),
});

export function registerOrganisationRoutes(app: SchoolappApi) {
  app.get("/organisation", requireUser, async (c) => {
    const orgId = requestedOrganisationId(c);
    if (!orgId) {
      throw new AppError(400, "org_context_required", "X-Organisation-Id is required");
    }
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
              "select academic_year_start_month, locale, extras from organisation_settings where organisation_id = $1",
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
          settings: canReadSettings ? (settings?.rows[0] ?? null) : null,
          subscription: canReadBilling ? (subscription?.rows[0] ?? null) : null,
        });
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.post("/invitations", requireUser, async (c) => {
    const orgId = requestedOrganisationId(c);
    if (!orgId) {
      throw new AppError(400, "org_context_required", "X-Organisation-Id is required");
    }
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

  app.get("/organisation/support-access", requireUser, async (c) => {
    const orgId = requestedOrganisationId(c);
    if (!orgId) {
      throw new AppError(400, "org_context_required", "X-Organisation-Id is required");
    }
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
}

