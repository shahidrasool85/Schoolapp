import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, createPools, withTenantContext } from "./client.js";
import { DEMO_ACCOUNTS, DEMO_EXTRA_ACCOUNTS, DEMO_ORGANISATIONS } from "./demo-accounts.js";
import { migrate } from "./migrate.js";
import { seedDemo } from "./seed-demo.js";

const ownerUrl =
  process.env.TEST_DATABASE_OWNER_URL ??
  "postgres://schoolapp_owner:schoolapp_owner@127.0.0.1:5432/schoolapp_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://schoolapp_app:schoolapp_app@127.0.0.1:5432/schoolapp_test";

describe("demo seed", () => {
  const pools = createPools({ appUrl, ownerUrl });

  beforeAll(async () => {
    await migrate(ownerUrl);
    await seedDemo({
      ownerUrl,
      env: {
        NODE_ENV: "test",
        ALLOW_DEMO_SEED: "true",
        PLATFORM_DOMAIN: "localhost",
        DATABASE_OWNER_URL: ownerUrl,
        DATABASE_URL: appUrl,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await closePools(pools);
  });

  it("creates Greenwood and Oak Academy with distinct pupils", async () => {
    const orgs = await pools.owner.query<{ id: string; slug: string }>(
      "select id, slug::text as slug from organisations where slug = any($1::citext[])",
      [["greenwood", "oakacademy"]],
    );
    expect(orgs.rows.map((row) => row.slug).sort()).toEqual(["greenwood", "oakacademy"]);

    const greenwoodId = orgs.rows.find((row) => row.slug === "greenwood")!.id;
    const oakId = orgs.rows.find((row) => row.slug === "oakacademy")!.id;

    const gw = await pools.owner.query<{ legal_name: string }>(
      "select legal_name from student_profiles where organisation_id = $1 order by legal_name",
      [greenwoodId],
    );
    const oak = await pools.owner.query<{ legal_name: string }>(
      "select legal_name from student_profiles where organisation_id = $1 order by legal_name",
      [oakId],
    );
    expect(gw.rows.map((row) => row.legal_name)).toContain(DEMO_ACCOUNTS.greenwoodStudent.fullName);
    expect(gw.rows.map((row) => row.legal_name)).not.toContain(DEMO_EXTRA_ACCOUNTS.oakStudent.fullName);
    expect(oak.rows.map((row) => row.legal_name)).toContain(DEMO_EXTRA_ACCOUNTS.oakStudent.fullName);
    expect(oak.rows.map((row) => row.legal_name)).not.toContain(DEMO_ACCOUNTS.greenwoodStudent.fullName);
  });

  it("keeps RLS from leaking Oak pupils into the Greenwood admin context", async () => {
    const admin = await pools.owner.query<{ id: string }>(
      "select id from users where email = $1",
      [DEMO_ACCOUNTS.greenwoodAdmin.email],
    );
    const org = await pools.owner.query<{ id: string }>(
      "select id from organisations where slug = $1",
      [DEMO_ORGANISATIONS.greenwood.slug],
    );
    const names = await withTenantContext(pools.app, admin.rows[0]!.id, org.rows[0]!.id, async (client) => {
      const result = await client.query<{ legal_name: string }>("select legal_name from student_profiles");
      return result.rows.map((row) => row.legal_name);
    });
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain(DEMO_ACCOUNTS.greenwoodStudent.fullName);
    expect(names).not.toContain(DEMO_EXTRA_ACCOUNTS.oakStudent.fullName);
  });

  it("can look up the labelled demo logins", async () => {
    const email = await pools.app.query("select user_id from local_auth_lookup($1)", [
      DEMO_ACCOUNTS.greenwoodAdmin.email,
    ]);
    expect(email.rowCount).toBe(1);
    const alias = await pools.app.query("select user_id from local_auth_lookup_alias($1, $2)", [
      "greenwood",
      DEMO_ACCOUNTS.greenwoodStudent.username,
    ]);
    expect(alias.rowCount).toBe(1);
    const platform = await pools.app.query("select user_id from local_auth_lookup($1)", [
      DEMO_ACCOUNTS.platformAdmin.email,
    ]);
    expect(platform.rowCount).toBe(1);
  });
});
