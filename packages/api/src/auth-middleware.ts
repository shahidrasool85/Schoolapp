import type { Context, Next } from "hono";
import { ACCESS_COOKIE, verifyAccessToken } from "@schoolapp/auth";
import { AppError, pgErrorToAppError } from "@schoolapp/core";
import type { ApiEnv } from "./types";

export function readAccessToken(c: Context<ApiEnv>): string | null {
  const header = c.req.header("Authorization");
  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  const cookie = c.req.header("Cookie");
  if (!cookie) {
    return null;
  }
  const match = cookie.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${ACCESS_COOKIE}=`));
  if (!match) {
    return null;
  }
  return decodeURIComponent(match.slice(`${ACCESS_COOKIE}=`.length));
}

export async function requireUser(c: Context<ApiEnv>, next: Next) {
  const config = c.get("config");
  const token = readAccessToken(c);
  if (!token) {
    throw new AppError(401, "unauthenticated", "Authentication required");
  }
  try {
    const payload = await verifyAccessToken(config.authSecret, token);
    await config.pools.app.query("select assert_active_session($1, $2)", [
      payload.sub,
      payload.sid,
    ]);
    c.set("accessToken", token);
    c.set("userId", payload.sub);
    c.set("sessionId", payload.sid);
  } catch (error) {
    const mapped = pgErrorToAppError(error);
    if (mapped) {
      throw mapped;
    }
    throw new AppError(401, "unauthenticated", "Authentication required");
  }
  await next();
}

export function requestedOrganisationId(c: Context): string | null {
  return c.req.header("X-Organisation-Id")?.trim() || null;
}
