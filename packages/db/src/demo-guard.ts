import path from "node:path";
import { fileURLToPath } from "node:url";

export class DemoSeedBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoSeedBlockedError";
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export type DemoGuardEnv = {
  NODE_ENV?: string;
  ALLOW_DEMO_SEED?: string;
  PLATFORM_DOMAIN?: string;
  DATABASE_URL?: string;
  DATABASE_OWNER_URL?: string;
};

export function postgresHost(connectionString: string): string | null {
  try {
    const normalized = connectionString.replace(/^postgres(?:ql)?:/i, "http:");
    const url = new URL(normalized);
    return url.hostname.trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

function assertLoopbackUrl(label: string, value: string | undefined): void {
  if (!value) return;
  const host = postgresHost(value);
  if (!host || !LOOPBACK_HOSTS.has(host)) {
    throw new DemoSeedBlockedError(
      `Demo seed is blocked because ${label} is not a loopback Postgres URL`,
    );
  }
}

/**
 * Hard stop for the local demo seed/reset path.
 * Production, remote databases, and non-localhost SaaS domains are never allowed.
 */
export function assertDemoSeedAllowed(env: DemoGuardEnv = process.env): void {
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") {
    throw new DemoSeedBlockedError("Demo seed is blocked when NODE_ENV=production");
  }
  if (env.ALLOW_DEMO_SEED !== "true") {
    throw new DemoSeedBlockedError(
      "Demo seed requires ALLOW_DEMO_SEED=true (local demo only; never set this in production)",
    );
  }
  const domain = (env.PLATFORM_DOMAIN ?? "localhost").trim().toLowerCase();
  if (domain !== "localhost") {
    throw new DemoSeedBlockedError("Demo seed only runs when PLATFORM_DOMAIN=localhost");
  }
  if (!env.DATABASE_OWNER_URL) {
    throw new DemoSeedBlockedError("DATABASE_OWNER_URL is required for demo seed");
  }
  assertLoopbackUrl("DATABASE_OWNER_URL", env.DATABASE_OWNER_URL);
  assertLoopbackUrl("DATABASE_URL", env.DATABASE_URL);
}

const isMain =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]!) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    assertDemoSeedAllowed();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
