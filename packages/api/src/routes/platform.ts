import { z } from "zod";
import { PERMISSIONS, validateOrganisationSlug, slugValidationMessage } from "@schoolapp/domain";
import { AppError, pgErrorToAppError, schoolInviteUrl, staffInviteMail } from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { requirePlatformHost } from "../tenant-resolver";
import { inviteAcceptPath, mailOf } from "../mail";

type SchoolAdminStateRow = {
  organisation_id: string;
  invitation_id: string | null;
  invitation_status: string;
  invited_email: string | null;
  invited_full_name: string | null;
  expires_at: Date | string | null;
  membership_status: string | null;
  can_reissue: boolean;
};

function mapSchoolAdminState(row: SchoolAdminStateRow | undefined) {
  if (!row) {
    return {
      invitationStatus: "none" as const,
      canReissue: false,
      invitationId: null,
      email: null,
      fullName: null,
      expiresAt: null,
      membershipStatus: null,
    };
  }
  return {
    invitationStatus: row.invitation_status,
    canReissue: Boolean(row.can_reissue),
    invitationId: row.invitation_id,
    email: row.invited_email,
    fullName: row.invited_full_name,
    expiresAt: row.expires_at,
    membershipStatus: row.membership_status,
  };
}

const provisionSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
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
    requirePlatformHost(c);
    const config = c.get("config");
    const userId = c.get("userId");
    try {
      const [result, adminState] = await Promise.all([
        config.pools.app.query("select * from list_platform_organisations($1)", [userId]),
        config.pools.app.query<SchoolAdminStateRow>(
          "select * from list_platform_school_admin_state($1)",
          [userId],
        ),
      ]);
      const adminByOrg = new Map(adminState.rows.map((row) => [row.organisation_id, row]));
      return c.json({
        organisations: result.rows.map((row: Record<string, unknown>) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          status: row.status,
          createdAt: row.created_at,
          schoolAdmin: mapSchoolAdminState(adminByOrg.get(String(row.id))),
        })),
      });
    } catch (error) {
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.post("/platform/organisations", requireUser, async (c) => {
    requirePlatformHost(c);
    const parsed = provisionSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError(400, "validation_failed", "Invalid organisation payload");
    }
    const slug = validateOrganisationSlug(parsed.data.slug);
    if (!slug.ok) {
      throw new AppError(
        400,
        slug.error === "reserved" ? "reserved_slug" : "validation_failed",
        slugValidationMessage(slug.error),
      );
    }
    const userId = c.get("userId");
    try {
      const result = await c.get("config").pools.app.query(
        "select * from provision_organisation($1, $2, $3, $4, $5)",
        [
          userId,
          parsed.data.name,
          slug.slug,
          parsed.data.adminEmail.toLowerCase(),
          parsed.data.adminFullName,
        ],
      );
      const row = result.rows[0] as {
        organisation_id: string;
        invitation_id: string;
        invitation_token: string;
      };
      await mailOf(c).send(
        staffInviteMail({
          organisationId: row.organisation_id,
          organisationName: parsed.data.name,
          toEmail: parsed.data.adminEmail.toLowerCase(),
          toName: parsed.data.adminFullName,
          acceptPath: inviteAcceptPath(row.invitation_token),
        }),
      );
      return c.json(
        {
          organisationId: row.organisation_id,
          invitationId: row.invitation_id,
          invitationToken: row.invitation_token,
          slug: slug.slug,
        },
        201,
      );
    } catch (error) {
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.post("/platform/organisations/:organisationId/school-admin-invitation/reissue", requireUser, async (c) => {
    requirePlatformHost(c);
    const organisationId = c.req.param("organisationId");
    try {
      const result = await c.get("config").pools.app.query(
        "select * from reissue_school_admin_invitation_as_platform($1, $2)",
        [c.get("userId"), organisationId],
      );
      const row = result.rows[0] as {
        invitation_id: string;
        invitation_token: string;
        organisation_id: string;
        organisation_slug: string;
        organisation_name: string;
        email: string;
        invited_full_name: string;
        expires_at: Date | string;
      };
      const invitationUrl = schoolInviteUrl(
        row.organisation_slug,
        c.get("config").platformDomain,
        row.invitation_token,
      );
      await mailOf(c).send(
        staffInviteMail({
          organisationId: row.organisation_id,
          organisationName: row.organisation_name || "School",
          toEmail: row.email,
          toName: row.invited_full_name,
          acceptPath: inviteAcceptPath(row.invitation_token),
        }),
      );
      return c.json(
        {
          invitationId: row.invitation_id,
          invitationToken: row.invitation_token,
          invitationUrl,
          email: row.email,
          fullName: row.invited_full_name,
          expiresAt: row.expires_at,
        },
        201,
      );
    } catch (error) {
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.post("/platform/organisations/:organisationId/support-access", requireUser, async (c) => {
    requirePlatformHost(c);
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
    requirePlatformHost(c);
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

  app.post("/platform/organisations/:organisationId/slug", requireUser, async (c) => {
    requirePlatformHost(c);
    const parsed = z.object({ slug: z.string().min(1) }).safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError(400, "validation_failed", "Invalid slug payload");
    }
    const slug = validateOrganisationSlug(parsed.data.slug);
    if (!slug.ok) {
      throw new AppError(
        400,
        slug.error === "reserved" ? "reserved_slug" : "validation_failed",
        slugValidationMessage(slug.error),
      );
    }
    try {
      const result = await c.get("config").pools.app.query(
        "select change_organisation_slug_as_platform($1, $2, $3) as slug",
        [c.get("userId"), c.req.param("organisationId"), slug.slug],
      );
      return c.json({ slug: result.rows[0].slug as string });
    } catch (error) {
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.post("/platform/organisation-hostnames/:hostnameId/verify", requireUser, async (c) => {
    requirePlatformHost(c);
    try {
      await c.get("config").pools.app.query("select verify_organisation_hostname($1, $2)", [
        c.get("userId"),
        c.req.param("hostnameId"),
      ]);
      return c.json({ ok: true });
    } catch (error) {
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.post("/platform/organisation-hostnames/:hostnameId/activate", requireUser, async (c) => {
    requirePlatformHost(c);
    try {
      await c.get("config").pools.app.query("select activate_organisation_hostname($1, $2)", [
        c.get("userId"),
        c.req.param("hostnameId"),
      ]);
      return c.json({ ok: true });
    } catch (error) {
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.post("/platform/organisation-hostnames/:hostnameId/deactivate", requireUser, async (c) => {
    requirePlatformHost(c);
    try {
      await c.get("config").pools.app.query("select deactivate_organisation_hostname($1, $2)", [
        c.get("userId"),
        c.req.param("hostnameId"),
      ]);
      return c.json({ ok: true });
    } catch (error) {
      throw pgErrorToAppError(error) ?? error;
    }
  });
}

export const platformPermissions = PERMISSIONS;
