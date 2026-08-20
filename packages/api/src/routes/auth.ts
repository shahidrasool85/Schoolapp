import { z } from "zod";
import {
  accessCookieHeader,
  clearAccessCookieHeader,
  hashPassword,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from "@schoolapp/auth";
import { AppError, pgErrorToAppError } from "@schoolapp/core";
import { withTenantContext } from "@schoolapp/db";
import type { SchoolappApi } from "../types";
import { readAccessToken } from "../auth-middleware";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
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
    const lookup = await config.pools.app.query(
      "select * from local_auth_lookup($1)",
      [parsed.data.email.toLowerCase()],
    );
    const row = lookup.rows[0] as
      | {
          user_id: string;
          password_hash: string;
          full_name: string;
          user_kind: string;
          status: string;
        }
      | undefined;
    if (!row || row.status !== "active") {
      throw new AppError(401, "unauthenticated", "Invalid email or password");
    }
    const ok = await verifyPassword(row.password_hash, parsed.data.password);
    if (!ok) {
      throw new AppError(401, "unauthenticated", "Invalid email or password");
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
        if (!invite.has_credentials || !invite.email) {
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
}
