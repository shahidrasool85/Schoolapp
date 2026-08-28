import { handle } from "hono/vercel";
import { createApiApp } from "@schoolapp/api";
import { createPools } from "@schoolapp/db";
import { createFileScannerFromEnv, createObjectStorageFromEnv } from "@schoolapp/storage";

function runtimeEnv(name: string): string | undefined {
  return process.env[name];
}

function createRouteHandler() {
  const appUrl = runtimeEnv("DATABASE_URL");
  const ownerUrl = runtimeEnv("DATABASE_OWNER_URL");
  const authSecret = runtimeEnv("AUTH_SECRET");

  if (!appUrl || !ownerUrl || !authSecret) {
    throw new Error("DATABASE_URL, DATABASE_OWNER_URL, and AUTH_SECRET are required");
  }

  const pools = createPools({ appUrl, ownerUrl });
  const app = createApiApp({
    pools,
    authSecret,
    tokenTtlSeconds: Number(runtimeEnv("AUTH_TOKEN_TTL_SECONDS") ?? 900),
    platformDomain: (runtimeEnv("PLATFORM_DOMAIN") ?? "localhost").trim().toLowerCase(),
    trustProxy: runtimeEnv("TRUST_PROXY") === "true",
    storage: createObjectStorageFromEnv(),
    fileScanner: createFileScannerFromEnv(),
  });
  return handle(app);
}

type RouteHandler = ReturnType<typeof handle>;
let cachedHandler: RouteHandler | undefined;

const route: RouteHandler = (...args) => {
  cachedHandler ??= createRouteHandler();
  return cachedHandler(...args);
};

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = route;
export const POST = route;
export const PUT = route;
export const PATCH = route;
export const DELETE = route;
export const OPTIONS = route;
