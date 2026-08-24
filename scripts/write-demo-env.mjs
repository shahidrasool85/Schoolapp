import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, ".env");
const example = path.join(root, ".env.example");

const values = {
  PREFERRED_DEPLOYMENT_REGION: "uk",
  DATABASE_URL: "postgres://schoolapp_app:schoolapp_app@127.0.0.1:5432/schoolapp",
  DATABASE_OWNER_URL: "postgres://schoolapp_owner:schoolapp_owner@127.0.0.1:5432/schoolapp",
  AUTH_TOKEN_TTL_SECONDS: "900",
  PLATFORM_DOMAIN: "localhost",
  TRUST_PROXY: "false",
  ALLOW_DEMO_SEED: "true",
  PLATFORM_ADMIN_EMAIL: "demo.platform@schoolapp.test",
  PLATFORM_ADMIN_PASSWORD: "DemoPass-Platform-1",
  PLATFORM_ADMIN_NAME: "Demo Platform Admin",
  OBJECT_STORAGE_DRIVER: "filesystem",
  OBJECT_STORAGE_FS_ROOT: ".data/object-storage",
  FILE_SCANNER_DRIVER: "noop",
};

function parseEnv(text) {
  const map = new Map();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    let value = line.slice(idx + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(line.slice(0, idx), value);
  }
  return map;
}

function encodeEnvValue(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

let existing = new Map();
if (fs.existsSync(target)) {
  existing = parseEnv(fs.readFileSync(target, "utf8"));
} else if (fs.existsSync(example) && path.basename(target) === ".env") {
  existing = parseEnv(fs.readFileSync(example, "utf8"));
}

const authSecret = existing.get("AUTH_SECRET");
const keepSecret =
  authSecret && authSecret !== "replace-with-a-long-random-string"
    ? authSecret
    : "demo-local-auth-secret-not-for-production-use";

const merged = {
  ...Object.fromEntries(existing),
  ...values,
  AUTH_SECRET: keepSecret,
};
delete merged.PGDATABASE;
delete merged.PGSERVICE;

const body = Object.entries(merged)
  .map(([key, value]) => `${key}=${encodeEnvValue(value)}`)
  .join("\n");

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${body}\n`);
console.log(`Wrote ${target}`);
