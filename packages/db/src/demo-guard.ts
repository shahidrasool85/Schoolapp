import { readFileSync } from "node:fs";
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

/** Parse KEY=value lines, including quoted values from demo .env files. */
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx);
    let value = line.slice(idx + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    env[key] = value;
  }
  return env;
}

/**
 * Refuse to overwrite an existing env file that looks like production or a remote deploy.
 * Missing ALLOW_DEMO_SEED is allowed (first local setup will set it).
 */
export function assertExistingEnvAllowsDemoWrite(env: DemoGuardEnv): void {
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") {
    throw new DemoSeedBlockedError("Refusing to overwrite env because NODE_ENV=production");
  }
  if (env.PLATFORM_DOMAIN && env.PLATFORM_DOMAIN.trim().toLowerCase() !== "localhost") {
    throw new DemoSeedBlockedError(
      "Refusing to overwrite env because PLATFORM_DOMAIN is not localhost",
    );
  }
  assertLoopbackUrl("DATABASE_OWNER_URL", env.DATABASE_OWNER_URL);
  assertLoopbackUrl("DATABASE_URL", env.DATABASE_URL);
}

const isMain =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]!) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const existingPath = process.argv.slice(2).find((arg) => arg !== "--");
    if (existingPath) {
      const parsed = parseEnvFile(readFileSync(existingPath, "utf8"));
      assertExistingEnvAllowsDemoWrite(parsed);
    }
    assertExistingEnvAllowsDemoWrite({
      NODE_ENV: process.env.NODE_ENV,
      PLATFORM_DOMAIN: process.env.PLATFORM_DOMAIN,
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_OWNER_URL: process.env.DATABASE_OWNER_URL,
    });
    if ((process.env.NODE_ENV ?? "").toLowerCase() === "production") {
      throw new DemoSeedBlockedError("Demo seed is blocked when NODE_ENV=production");
    }
    const ownerUrl =
      process.env.DATABASE_OWNER_URL ??
      "postgres://schoolapp_owner:schoolapp_owner@127.0.0.1:5432/schoolapp";
    const appUrl =
      process.env.DATABASE_URL ?? "postgres://schoolapp_app:schoolapp_app@127.0.0.1:5432/schoolapp";
    assertDemoSeedAllowed({
      NODE_ENV: process.env.NODE_ENV,
      ALLOW_DEMO_SEED: process.env.ALLOW_DEMO_SEED ?? "true",
      PLATFORM_DOMAIN: process.env.PLATFORM_DOMAIN ?? "localhost",
      DATABASE_OWNER_URL: ownerUrl,
      DATABASE_URL: appUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
