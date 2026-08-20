import { z } from "zod";
import { ACCESS_COOKIE, hashPassword, signAccessToken, verifyPassword } from "@schoolapp/auth";
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

    c.header(
      "Set-Cookie",
      `${ACCESS_COOKIE}=${accessToken}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${config.tokenTtlSeconds}`,
    );

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
    c.header("Set-Cookie", `${ACCESS_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
    const token = readAccessToken(c);
    if (token) {
      // Best-effort; unauthenticated logout still clears the cookie.
    }
    return c.json({ ok: true });
  });

  app.post("/invitations/accept", async (c) => {
    const parsed = acceptSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw new AppError(400, "validation_failed", "Invalid invitation payload");
    }
    const passwordHash = await hashPassword(parsed.data.password);
    try {
      const result = await c.get("config").pools.app.query(
        "select * from accept_invitation($1, $2, $3)",
        [parsed.data.token, parsed.data.fullName, passwordHash],
      );
      const row = result.rows[0] as {
        accepted_user_id: string;
        accepted_organisation_id: string;
      };
      return c.json({ userId: row.accepted_user_id, organisationId: row.accepted_organisation_id });
    } catch (error) {
      throw pgErrorToAppError(error) ?? new AppError(400, "validation_failed", "Could not accept invitation");
    }
  });
}
