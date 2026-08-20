import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, createPools, withTenantContext } from "./client.js";
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

  it("keeps system roles and other users protected from the app role", async () => {
    const id = randomUUID().slice(0, 8);
    const user = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'RLS User', 'staff', 'active') returning id`,
      [`rls-user-${id}@example.com`],
    );
    const other = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Other', 'staff', 'active') returning id`,
      [`rls-other-${id}@example.com`],
    );
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-${id}`, "RLS School"],
    );
    await pools.owner.query(
      `insert into organisation_memberships (organisation_id, user_id, status)
       values ($1, $2, 'active')`,
      [org.rows[0]!.id, user.rows[0]!.id],
    );

    await withTenantContext(pools.app, user.rows[0]!.id, org.rows[0]!.id, async (client) => {
      await expect(
        client.query("update roles set name = 'hacked' where organisation_id is null and key = 'school.admin'"),
      ).rejects.toThrow();
      await expect(client.query("delete from users where id = $1", [other.rows[0]!.id])).rejects.toThrow();
      await expect(
        client.query(
          `insert into invitations (
             organisation_id, email, intended_role_keys, token_hash, expires_at
           ) values ($1, $2, array['school.teacher']::text[], $3, now() + interval '1 day')`,
          [org.rows[0]!.id, `sneaky-${id}@example.com`, `hash-${id}`],
        ),
      ).rejects.toThrow();
    });
  });

  it("rejects custom roles from another organisation on a membership", async () => {
    const id = randomUUID().slice(0, 8);
    const orgA = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-a-${id}`, "A"],
    );
    const orgB = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-b-${id}`, "B"],
    );
    const user = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Member', 'staff', 'active') returning id`,
      [`rls-m-${id}@example.com`],
    );
    const membership = await pools.owner.query<{ id: string }>(
      `insert into organisation_memberships (organisation_id, user_id, status)
       values ($1, $2, 'active') returning id`,
      [orgA.rows[0]!.id, user.rows[0]!.id],
    );
    const roleB = await pools.owner.query<{ id: string }>(
      `insert into roles (organisation_id, key, name) values ($1, 'custom', 'Custom B') returning id`,
      [orgB.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        "insert into membership_roles (membership_id, role_id) values ($1, $2)",
        [membership.rows[0]!.id, roleB.rows[0]!.id],
      ),
    ).rejects.toThrow(/membership_role_org_mismatch/);
  });

  it("allows only one linked student profile per user per organisation", async () => {
    const id = randomUUID().slice(0, 8);
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-stu-${id}`, "Students"],
    );
    const user = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Pupil', 'student', 'active') returning id`,
      [`rls-stu-${id}@example.com`],
    );
    await pools.owner.query(
      "insert into student_profiles (organisation_id, user_id, legal_name) values ($1, $2, 'One')",
      [org.rows[0]!.id, user.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        "insert into student_profiles (organisation_id, user_id, legal_name) values ($1, $2, 'Two')",
        [org.rows[0]!.id, user.rows[0]!.id],
      ),
    ).rejects.toThrow();
  });

  it("allows a new guardianship after the previous link has ended", async () => {
    const id = randomUUID().slice(0, 8);
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-g-${id}`, "Guardians"],
    );
    const guardian = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Guardian', 'parent', 'active') returning id`,
      [`rls-g-${id}@example.com`],
    );
    const student = await pools.owner.query<{ id: string }>(
      "insert into student_profiles (organisation_id, legal_name) values ($1, 'Child') returning id",
      [org.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into guardianships (
         organisation_id, student_profile_id, guardian_user_id, started_on, ended_on
       ) values ($1, $2, $3, '2024-01-01', '2024-12-31')`,
      [org.rows[0]!.id, student.rows[0]!.id, guardian.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into guardianships (
         organisation_id, student_profile_id, guardian_user_id, started_on
       ) values ($1, $2, $3, '2025-01-01')`,
      [org.rows[0]!.id, student.rows[0]!.id, guardian.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        `insert into guardianships (
           organisation_id, student_profile_id, guardian_user_id, started_on
         ) values ($1, $2, $3, '2025-02-01')`,
        [org.rows[0]!.id, student.rows[0]!.id, guardian.rows[0]!.id],
      ),
    ).rejects.toThrow();
  });
});
