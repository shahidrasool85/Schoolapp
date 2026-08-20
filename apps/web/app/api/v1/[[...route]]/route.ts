import { handle } from "hono/vercel";
import { createApiApp } from "@schoolapp/api";
import { createPools } from "@schoolapp/db";

const appUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_OWNER_URL;
const authSecret = process.env.AUTH_SECRET;

if (!appUrl || !ownerUrl || !authSecret) {
  throw new Error("DATABASE_URL, DATABASE_OWNER_URL, and AUTH_SECRET are required");
}

const pools = createPools({ appUrl, ownerUrl });

const app = createApiApp({
  pools,
  authSecret,
  tokenTtlSeconds: Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 900),
  platformDomain: (process.env.PLATFORM_DOMAIN ?? "localhost").trim().toLowerCase(),
  trustProxy: process.env.TRUST_PROXY === "true",
});

export const runtime = "nodejs";

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
