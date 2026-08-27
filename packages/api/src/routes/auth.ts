import { z } from "zod";
import {
  accessCookieHeader,
  clearAccessCookieHeader,
  hashPassword,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from "@schoolapp/auth";
import {
  AppError,
  headerMatchesHostSlug,
  MemoryRateLimiter,
  passwordResetMail,
  pgErrorToAppError,
  PASSWORD_RESET_NEUTRAL_MESSAGE,
} from "@schoolapp/core";
import { withTenantContext } from "@schoolapp/db";
import type { SchoolappApi } from "../types";
import { readAccessToken } from "../auth-middleware";
import { mailOf, resetPasswordPath } from "../mail";

const forgotLimiter = new MemoryRateLimiter();

const loginSchema = z
  .object({
    email: z.string().email().optional(),
    password: z.string().min(8),
    organisationSlug: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.email) || Boolean(data.username), {
    message: "Email or username is required",
  });

const acceptSchema = z.object({
  token: z.string().min(16),
  fullName: z.string().min(1),
  password: z.string().min(10),
});

export function registerAuthRoutes(app: SchoolappApi) {
  app.post("/auth/login", async (c) => {
    const parsed = loginSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError(400, "validation_failed", "Invalid login payload");
    }
    const { config } = { config: c.get("config") };
    const host = c.get("tenantHost");
    if (host.kind === "school") {
      if (
        !headerMatchesHostSlug({
          hostSlug: host.slug,
          requestedSlug: parsed.data.organisationSlug ?? null,
        })
      ) {
        throw new AppError(
          403,
          "org_host_mismatch",
          "Organisation header does not match this school host",
        );
      }
    }

    let lookup;
    if (parsed.data.email) {
      lookup = await config.pools.app.query("select * from local_auth_lookup($1)", [
        parsed.data.email.toLowerCase(),
      ]);
    } else {
      const aliasSlug = host.kind === "school" ? host.slug : parsed.data.organisationSlug;
      if (!aliasSlug || !parsed.data.username) {
        throw new AppError(400, "validation_failed", "Invalid login payload");
      }
      lookup = await config.pools.app.query("select * from local_auth_lookup_alias($1, $2)", [
        aliasSlug,
        parsed.data.username,
      ]);
    }
    const row = lookup.rows[0] as
      | {
          user_id: string;
          password_hash: string;
          full_name: string;
          user_kind: string;
          status: string;
          organisation_id?: string;
        }
      | undefined;
    if (!row || row.status !== "active") {
      throw new AppError(401, "unauthenticated", "Invalid email or password");
    }
    const ok = await verifyPassword(row.password_hash, parsed.data.password);
    if (!ok) {
      throw new AppError(401, "unauthenticated", "Invalid email or password");
    }
    if (row.user_kind === "student") {
      // Student portal accounts authenticate via school alias (hostname or organisationSlug),
      // not via platform email lookup. Staff/parent email login is unchanged for multi-school/SSO.
      if (parsed.data.email) {
        throw new AppError(401, "unauthenticated", "Invalid email or password");
      }
      const studentOrgId =
        host.kind === "school" ? host.organisationId : row.organisation_id ?? null;
      if (!studentOrgId) {
        throw new AppError(401, "unauthenticated", "Invalid email or password");
      }
      const portal = await config.pools.app.query<{ ok: boolean }>(
        "select student_portal_is_enabled_for_user($1, $2) as ok",
        [studentOrgId, row.user_id],
      );
      if (!portal.rows[0]?.ok) {
        throw new AppError(401, "unauthenticated", "Invalid email or password");
      }
    }

    const sessionId = await withTenantContext(config.pools.app, row.user_id, null, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `insert into auth_sessions (user_id, refresh_token_hash, expires_at)
         values ($1, $2, now() + interval '30 days')
         returning id`,
        [row.user_id, "local-session"],
      );
      return inserted.rows[0]!.id;
    });

    const accessToken = await signAccessToken(
      config.authSecret,
      { sub: row.user_id, sid: sessionId },
      config.tokenTtlSeconds,
    );

    c.header("Set-Cookie", accessCookieHeader(accessToken, config.tokenTtlSeconds));

    return c.json({
      accessToken,
      organisationId:
        host.kind === "school"
          ? host.organisationId
          : parsed.data.username
            ? row.organisation_id ?? null
            : null,
      hostOrganisation:
        host.kind === "school"
          ? { id: host.organisationId, slug: host.slug, name: host.name }
          : null,
      user: {
        id: row.user_id,
        fullName: row.full_name,
        kind: row.user_kind,
      },
    });
  });

  app.post("/auth/logout", async (c) => {
    c.header("Set-Cookie", clearAccessCookieHeader());
    const token = readAccessToken(c);
    if (token) {
      try {
        const payload = await verifyAccessToken(c.get("config").authSecret, token);
        await c.get("config").pools.app.query("select revoke_auth_session($1, $2)", [
          payload.sub,
          payload.sid,
        ]);
      } catch {
        // Cookie is already cleared; revocation is best-effort.
      }
    }
    return c.json({ ok: true });
  });

  app.post("/invitations/accept", async (c) => {
    const parsed = acceptSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError(400, "validation_failed", "Invalid invitation payload");
    }
    const config = c.get("config");
    try {
      const preview = await config.pools.app.query<{
        invitation_id: string;
        email: string | null;
        existing_user_id: string | null;
        existing_user_status: string | null;
        has_credentials: boolean;
      }>("select * from lookup_invitation_for_accept($1)", [parsed.data.token]);
      const invite = preview.rows[0];
      if (!invite) {
        throw new AppError(404, "not_found", "Not found");
      }

      let passwordHash = "";
      if (invite.existing_user_id) {
        if (invite.existing_user_status !== "active") {
          throw new AppError(403, "forbidden", "This account cannot accept invitations");
        }
        if (invite.has_credentials) {
          if (!invite.email) {
            throw new AppError(409, "invitation_conflict", "This account cannot be claimed via invite");
          }
          const lookup = await config.pools.app.query(
            "select * from local_auth_lookup($1)",
            [invite.email],
          );
          const row = lookup.rows[0] as { password_hash: string } | undefined;
          const ok = row ? await verifyPassword(row.password_hash, parsed.data.password) : false;
          if (!ok) {
            throw new AppError(401, "unauthenticated", "Invalid email or password");
          }
        } else {
          passwordHash = await hashPassword(parsed.data.password);
        }
      } else {
        passwordHash = await hashPassword(parsed.data.password);
      }

      const result = await config.pools.app.query(
        "select * from accept_invitation($1, $2, $3)",
        [parsed.data.token, parsed.data.fullName, passwordHash],
      );
      const row = result.rows[0] as {
        accepted_user_id: string;
        accepted_organisation_id: string;
      };
      return c.json({ userId: row.accepted_user_id, organisationId: row.accepted_organisation_id });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw pgErrorToAppError(error) ?? new AppError(400, "validation_failed", "Could not accept invitation");
    }
  });

  app.post("/auth/forgot-password", async (c) => {
    const parsed = z.object({ email: z.string().email() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: true, message: PASSWORD_RESET_NEUTRAL_MESSAGE });
    }
    const host = c.get("tenantHost");
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const limit = forgotLimiter.consume(`forgot:${host.hostname ?? "unknown"}:${ip}`, 8, 15 * 60 * 1000);
    if (!limit.allowed) {
      return c.json({ ok: true, message: PASSWORD_RESET_NEUTRAL_MESSAGE });
    }
    const orgId = host.kind === "school" ? host.organisationId : null;
    try {
      const result = await c.get("config").pools.app.query<{
        created: boolean;
        reset_token: string | null;
        target_user_id: string | null;
        target_full_name: string | null;
        target_organisation_id: string | null;
      }>("select * from request_password_reset($1, $2)", [orgId, parsed.data.email.toLowerCase()]);
      const row = result.rows[0];
      if (row?.created && row.reset_token) {
        await mailOf(c).send(
          passwordResetMail({
            organisationId: row.target_organisation_id,
            toEmail: parsed.data.email.toLowerCase(),
            toName: row.target_full_name,
            resetPath: resetPasswordPath(row.reset_token),
          }),
        );
      }
    } catch {
      // Neutral response — do not distinguish missing accounts, tenant mismatch, or mail errors.
    }
    return c.json({ ok: true, message: PASSWORD_RESET_NEUTRAL_MESSAGE });
  });

  app.post("/auth/reset-password", async (c) => {
    const parsed = z
      .object({ token: z.string().min(16), password: z.string().min(10) })
      .safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError(400, "validation_failed", "Invalid reset payload");
    }
    try {
      const hash = await hashPassword(parsed.data.password);
      await c.get("config").pools.app.query("select * from consume_password_reset($1, $2)", [
        parsed.data.token,
        hash,
      ]);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw pgErrorToAppError(error) ?? new AppError(404, "not_found", "This link is invalid or has expired");
    }
  });

  app.post("/auth/activate", async (c) => {
    const parsed = z
      .object({
        token: z.string().min(16),
        password: z.string().min(10),
        fullName: z.string().min(1).optional(),
      })
      .safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError(400, "validation_failed", "Invalid activation payload");
    }
    const config = c.get("config");
    try {
      const preview = await config.pools.app.query(
        "select * from lookup_invitation_for_accept($1)",
        [parsed.data.token],
      );
      if (preview.rows[0]) {
        const hash = preview.rows[0].has_credentials
          ? ""
          : await hashPassword(parsed.data.password);
        if (preview.rows[0].has_credentials) {
          const lookup = await config.pools.app.query("select * from local_auth_lookup($1)", [
            preview.rows[0].email,
          ]);
          const row = lookup.rows[0] as { password_hash: string } | undefined;
          const ok = row ? await verifyPassword(row.password_hash, parsed.data.password) : false;
          if (!ok) throw new AppError(401, "unauthenticated", "Invalid email or password");
        }
        const accepted = await config.pools.app.query("select * from accept_invitation($1, $2, $3)", [
          parsed.data.token,
          parsed.data.fullName || "Student",
          hash,
        ]);
        return c.json({
          userId: accepted.rows[0].accepted_user_id,
          organisationId: accepted.rows[0].accepted_organisation_id,
        });
      }
      const hash = await hashPassword(parsed.data.password);
      const result = await config.pools.app.query("select * from consume_student_access_token($1, $2)", [
        parsed.data.token,
        hash,
      ]);
      return c.json({
        userId: result.rows[0].accepted_user_id,
        organisationId: result.rows[0].accepted_organisation_id,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw pgErrorToAppError(error) ?? new AppError(404, "not_found", "This link is invalid or has expired");
    }
  });
}
