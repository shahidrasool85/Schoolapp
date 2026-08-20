import argon2 from "argon2";
import pg from "pg";
import { migrate } from "@schoolapp/db";
import { createPools, type DbPools } from "@schoolapp/db";
import { createApiApp } from "./app";
import type { SchoolappApi } from "./types";

const ownerUrl =
  process.env.TEST_DATABASE_OWNER_URL ??
  "postgres://schoolapp_owner:schoolapp_owner@127.0.0.1:5432/schoolapp_api_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://schoolapp_app:schoolapp_app@127.0.0.1:5432/schoolapp_api_test";

export const TEST_AUTH_SECRET = "phase1-test-secret-phase1-test-secret";

let migrated = false;

export async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  await migrate(ownerUrl);
  migrated = true;
}

export function testPools(): DbPools {
  return createPools({ appUrl, ownerUrl });
}

export function testApp(pools: DbPools): SchoolappApi {
  return createApiApp({
    pools,
    authSecret: TEST_AUTH_SECRET,
    tokenTtlSeconds: 3600,
  });
}

export async function insertUser(
  owner: pg.Pool,
  input: {
    email: string;
    password: string;
    fullName: string;
    kind: "platform_admin" | "staff" | "parent" | "student";
    platformAdmin?: boolean;
  },
): Promise<string> {
  const hash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await owner.query<{ id: string }>(
    `insert into users (email, full_name, user_kind, status)
     values ($1, $2, $3, 'active') returning id`,
    [input.email, input.fullName, input.kind],
  );
  const id = user.rows[0]!.id;
  await owner.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [
    id,
    hash,
  ]);
  if (input.platformAdmin) {
    await owner.query("insert into platform_admins (user_id) values ($1)", [id]);
  }
  return id;
}

export async function addMembership(
  owner: pg.Pool,
  organisationId: string,
  userId: string,
  roleKey: string,
): Promise<void> {
  const membership = await owner.query<{ id: string }>(
    `insert into organisation_memberships (organisation_id, user_id, status)
     values ($1, $2, 'active') returning id`,
    [organisationId, userId],
  );
  await owner.query(
    `insert into membership_roles (membership_id, role_id)
     select $1, r.id from roles r where r.key = $2 and r.organisation_id is null`,
    [membership.rows[0]!.id, roleKey],
  );
}

export async function login(app: SchoolappApi, email: string, password: string): Promise<string> {
  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
    throw new Error(`login failed ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { accessToken: string };
  return body.accessToken;
}
