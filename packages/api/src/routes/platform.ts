import { z } from "zod";
import { PERMISSIONS } from "@schoolapp/domain";
import { AppError, pgErrorToAppError } from "@schoolapp/core";
import { withTenantContext } from "@schoolapp/db";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";

const provisionSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/),
  adminEmail: z.string().email(),
  adminFullName: z.string().min(1),
});

const supportSchema = z.object({
  reason: z.string().trim().min(8),
  scope: z.enum(["organisation", "organisation_metadata"]).default("organisation_metadata"),
  ttlMinutes: z.number().int().min(5).max(24 * 60).default(60),
});

export function registerPlatformRoutes(app: SchoolappApi) {
  app.get("/platform/organisations", requireUser, async (c) => {
    const config = c.get("config");
    const userId = c.get("userId");
    try {
      const result = await config.pools.app.query("select * from list_platform_organisations($1)", [
        userId,
      ]);
      return c.json({
        organisations: result.rows.map((row: Record<string, unknown>) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          status: row.status,
          createdAt: row.created_at,
        })),
      });
    } catch (error) {
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.post("/platform/organisations", requireUser, async (c) => {
    const parsed = provisionSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError(400, "validation_failed", "Invalid organisation payload");
    }
    const userId = c.get("userId");
    try {
      const result = await c.get("config").pools.app.query(
        "select * from provision_organisation($1, $2, $3, $4, $5)",
        [
          userId,
          parsed.data.name,
          parsed.data.slug,
          parsed.data.adminEmail.toLowerCase(),
          parsed.data.adminFullName,
        ],
      );
      const row = result.rows[0] as {
        organisation_id: string;
        invitation_id: string;
        invitation_token: string;
      };
      return c.json(
        {
          organisationId: row.organisation_id,
          invitationId: row.invitation_id,
          invitationToken: row.invitation_token,
        },
        201,
      );
    } catch (error) {
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.post("/platform/organisations/:organisationId/support-access", requireUser, async (c) => {
    const parsed = supportSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError(400, "validation_failed", "Invalid support-access payload");
    }
    const organisationId = c.req.param("organisationId");
    try {
      const result = await c.get("config").pools.app.query(
        "select open_support_access($1, $2, $3, $4, make_interval(mins => $5)) as id",
        [
          c.get("userId"),
          organisationId,
          parsed.data.reason,
          parsed.data.scope,
          parsed.data.ttlMinutes,
        ],
      );
      return c.json({ grantId: result.rows[0].id as string }, 201);
    } catch (error) {
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.post("/platform/support-access/:grantId/revoke", requireUser, async (c) => {
    try {
      await c.get("config").pools.app.query("select revoke_support_access($1, $2)", [
        c.get("userId"),
        c.req.param("grantId"),
      ]);
      return c.json({ ok: true });
    } catch (error) {
      throw pgErrorToAppError(error) ?? error;
    }
  });
}

export const platformPermissions = PERMISSIONS;
