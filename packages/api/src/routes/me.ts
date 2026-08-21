import { AppError, pgErrorToAppError } from "@schoolapp/core";
import { withTenantContext } from "@schoolapp/db";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { boundOrganisationId } from "../tenant-resolver";

export function registerMeRoutes(app: SchoolappApi) {
  app.get("/me", requireUser, async (c) => {
    const config = c.get("config");
    const userId = c.get("userId");
    const orgId = boundOrganisationId(c);

    try {
      return await withTenantContext(config.pools.app, userId, orgId, async (client) => {
        const user = await client.query<{
          id: string;
          email: string | null;
          full_name: string;
          user_kind: string;
          status: string;
        }>("select id, email, full_name, user_kind, status from users where id = $1", [userId]);
        const row = user.rows[0];
        if (!row || row.status !== "active") {
          throw new AppError(401, "unauthenticated", "Authentication required");
        }

        const platform = await client.query("select 1 from platform_admins where user_id = $1", [
          userId,
        ]);
        const isPlatformAdmin = (platform.rowCount ?? 0) > 0 && !orgId;

        let permissions: string[] = [];
        let roleKeys: string[] = [];
        let membershipId: string | null = null;
        if (orgId) {
          const perms = await client.query("select permission_key from list_permissions_for_membership($1, $2)", [
            userId,
            orgId,
          ]);
          permissions = perms.rows.map((r: { permission_key: string }) => r.permission_key);
          const memberships = await client.query("select * from list_memberships_for_user($1)", [userId]);
          const current = memberships.rows.find((m: { organisation_id: string }) => m.organisation_id === orgId) as
            | {
                membership_id: string;
                role_keys: string[];
                status: string;
              }
            | undefined;
          if (!current || current.status !== "active") {
            const grant = await client.query(
              `select id from support_access_grants
               where actor_user_id = $1 and organisation_id = $2
                 and revoked_at is null and expires_at > now()
               limit 1`,
              [userId, orgId],
            );
            if (!grant.rows[0]) {
              throw new AppError(403, "org_membership_required", "Active organisation membership is required");
            }
          } else {
            membershipId = current.membership_id;
            roleKeys = current.role_keys ?? [];
          }
        }

        const host = c.get("tenantHost");
        return c.json({
          user: {
            id: row.id,
            email: row.email,
            fullName: row.full_name,
            kind: row.user_kind,
          },
          isPlatformAdmin,
          organisationId: orgId,
          membershipId,
          roleKeys,
          permissions,
          context: orgId ? "organisation" : isPlatformAdmin ? "platform" : "user",
          hostOrganisation:
            host.kind === "school"
              ? { id: host.organisationId, slug: host.slug, name: host.name }
              : null,
        });
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.get("/me/memberships", requireUser, async (c) => {
    const config = c.get("config");
    const userId = c.get("userId");
    const result = await config.pools.app.query("select * from list_memberships_for_user($1)", [userId]);
    return c.json({
      memberships: result.rows.map((row: Record<string, unknown>) => ({
        membershipId: row.membership_id,
        organisationId: row.organisation_id,
        name: row.organisation_name,
        slug: row.organisation_slug,
        status: row.status,
        roleKeys: row.role_keys ?? [],
      })),
    });
  });
}
