import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, createPools } from "./client.js";
import { migrate } from "./migrate.js";

const ownerUrl =
  process.env.TEST_DATABASE_OWNER_URL ??
  "postgres://schoolapp_owner:schoolapp_owner@127.0.0.1:5432/schoolapp_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://schoolapp_app:schoolapp_app@127.0.0.1:5432/schoolapp_test";

describe("user profile columns", () => {
  const pools = createPools({ appUrl, ownerUrl });

  beforeAll(async () => {
    await migrate(ownerUrl);
  }, 60_000);

  afterAll(async () => {
    await closePools(pools);
  });

  it("adds nullable contact and photo columns without rewriting existing users", async () => {
    const email = `legacy-${randomUUID().slice(0, 8)}@example.com`;
    const user = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Legacy Staff', 'staff', 'active') returning id`,
      [email],
    );
    const row = await pools.owner.query<{
      title: string | null;
      phone: string | null;
      address_line1: string | null;
      full_name: string;
    }>("select title, phone, address_line1, full_name from users where id = $1", [user.rows[0]!.id]);
    expect(row.rows[0]?.full_name).toBe("Legacy Staff");
    expect(row.rows[0]?.title).toBeNull();
    expect(row.rows[0]?.phone).toBeNull();
    expect(row.rows[0]?.address_line1).toBeNull();

    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, 'Legacy School', 'active') returning id",
      [`legacy-${randomUUID().slice(0, 8)}`],
    );
    await pools.owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
    const membership = await pools.owner.query<{ profile_photo_stored_object_id: string | null }>(
      `insert into organisation_memberships (organisation_id, user_id, status)
       values ($1, $2, 'active') returning profile_photo_stored_object_id`,
      [org.rows[0]!.id, user.rows[0]!.id],
    );
    expect(membership.rows[0]?.profile_photo_stored_object_id).toBeNull();

    const staff = await pools.owner.query<{ job_title: string | null; employee_number: string | null }>(
      `insert into staff_profiles (organisation_id, user_id, job_title, employee_number)
       values ($1, $2, 'Class teacher', 'EMP-1') returning job_title, employee_number`,
      [org.rows[0]!.id, user.rows[0]!.id],
    );
    expect(staff.rows[0]?.job_title).toBe("Class teacher");
    expect(staff.rows[0]?.employee_number).toBe("EMP-1");
  });
});
