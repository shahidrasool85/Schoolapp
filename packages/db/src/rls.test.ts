import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, createPools } from "./client.js";
import { migrate } from "./migrate.js";

const ownerUrl =
  process.env.TEST_DATABASE_OWNER_URL ??
  "postgres://schoolapp_owner:schoolapp_owner@127.0.0.1:5432/schoolapp_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://schoolapp_app:schoolapp_app@127.0.0.1:5432/schoolapp_test";

describe("RLS catalog", () => {
  const pools = createPools({ appUrl, ownerUrl });

  beforeAll(async () => {
    await migrate(ownerUrl);
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("forces row level security on tenant tables", async () => {
    const result = await pools.owner.query<{ relname: string; relforcerowsecurity: boolean }>(
      `select c.relname, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in (
           'student_profiles', 'organisations', 'audit_events', 'organisation_memberships'
         )`,
    );
    expect(result.rows.length).toBe(4);
    for (const row of result.rows) {
      expect(row.relforcerowsecurity, row.relname).toBe(true);
    }
  });

  it("does not give the app role BYPASSRLS", async () => {
    const result = await pools.owner.query<{ rolbypassrls: boolean }>(
      "select rolbypassrls from pg_roles where rolname = 'schoolapp_app'",
    );
    expect(result.rows[0]?.rolbypassrls).toBe(false);
  });
});
