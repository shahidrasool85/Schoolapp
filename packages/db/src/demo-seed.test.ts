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

  it("seeds isolated Greenwood and Oak attendance history", async () => {
    const orgs = await pools.owner.query<{ id: string; slug: string }>(
      "select id, slug::text as slug from organisations where slug = any($1::citext[])",
      [["greenwood", "oakacademy"]],
    );
    const greenwoodId = orgs.rows.find((row) => row.slug === "greenwood")!.id;
    const oakId = orgs.rows.find((row) => row.slug === "oakacademy")!.id;
    const gw = await pools.owner.query<{ n: string; categories: string }>(
      `select count(*)::text as n, string_agg(distinct ac.category, ',') as categories
       from attendance_marks am
       join attendance_codes ac on ac.id = am.attendance_code_id
       where am.organisation_id = $1`,
      [greenwoodId],
    );
    const oak = await pools.owner.query<{ n: string }>(
      "select count(*)::text as n from attendance_marks where organisation_id = $1",
      [oakId],
    );
    expect(Number(gw.rows[0]?.n)).toBeGreaterThan(40);
    expect(gw.rows[0]?.categories).toContain("present");
    expect(gw.rows[0]?.categories).toContain("late");
    expect(gw.rows[0]?.categories).toContain("authorised_absence");
    expect(gw.rows[0]?.categories).toContain("unauthorised_absence");
    expect(Number(oak.rows[0]?.n)).toBeGreaterThan(10);

    const admin = await pools.owner.query<{ id: string }>(
      "select id from users where email = $1",
      [DEMO_ACCOUNTS.greenwoodAdmin.email],
    );
    await withTenantContext(pools.app, admin.rows[0]!.id, greenwoodId, async (client) => {
      const leaked = await client.query<{ n: string }>(
        "select count(*)::text as n from attendance_marks where organisation_id = $1",
        [oakId],
      );
      expect(leaked.rows[0]?.n).toBe("0");
    });
  });

  it("seeds isolated Greenwood and Oak learning work", async () => {
    const orgs = await pools.owner.query<{ id: string; slug: string }>(
      "select id, slug::text as slug from organisations where slug = any($1::citext[])",
      [["greenwood", "oakacademy"]],
    );
    const greenwoodId = orgs.rows.find((row) => row.slug === "greenwood")!.id;
    const oakId = orgs.rows.find((row) => row.slug === "oakacademy")!.id;
    const gw = await pools.owner.query<{ n: string; titles: string }>(
      `select count(*)::text as n, string_agg(title, ',') as titles
       from learning_assignments where organisation_id = $1`,
      [greenwoodId],
    );
    const oak = await pools.owner.query<{ n: string; titles: string }>(
      `select count(*)::text as n, string_agg(title, ',') as titles
       from learning_assignments where organisation_id = $1`,
      [oakId],
    );
    expect(Number(gw.rows[0]?.n)).toBeGreaterThanOrEqual(5);
    expect(gw.rows[0]?.titles).toContain("Year 3 Fractions");
    expect(gw.rows[0]?.titles).toContain("Year 5 Fractions");
    expect(oak.rows[0]?.titles).toContain("Oak comprehension");
    expect(oak.rows[0]?.titles).not.toContain("Year 3 Fractions");

    const admin = await pools.owner.query<{ id: string }>(
      "select id from users where email = $1",
      [DEMO_ACCOUNTS.greenwoodAdmin.email],
    );
    await withTenantContext(pools.app, admin.rows[0]!.id, greenwoodId, async (client) => {
      const leaked = await client.query<{ n: string }>(
        "select count(*)::text as n from learning_assignments where organisation_id = $1",
        [oakId],
      );
      expect(leaked.rows[0]?.n).toBe("0");
    });
  });

  it("seeds isolated Greenwood and Oak formal assessments", async () => {
    const orgs = await pools.owner.query<{ id: string; slug: string }>(
      "select id, slug::text as slug from organisations where slug = any($1::citext[])",
      [["greenwood", "oakacademy"]],
    );
    const greenwoodId = orgs.rows.find((row) => row.slug === "greenwood")!.id;
    const oakId = orgs.rows.find((row) => row.slug === "oakacademy")!.id;
    const gw = await pools.owner.query<{ n: string; titles: string }>(
      `select count(*)::text as n, string_agg(title, ',') as titles
       from academic_assessments where organisation_id = $1`,
      [greenwoodId],
    );
    const oak = await pools.owner.query<{ n: string; titles: string }>(
      `select count(*)::text as n, string_agg(title, ',') as titles
       from academic_assessments where organisation_id = $1`,
      [oakId],
    );
    expect(Number(gw.rows[0]?.n)).toBeGreaterThanOrEqual(3);
    expect(gw.rows[0]?.titles).toContain("Year 3 Maths Test");
    expect(gw.rows[0]?.titles).toContain("Year 3 English reading assessment");
    expect(gw.rows[0]?.titles).toContain("Year 3 Science practical");
    expect(oak.rows[0]?.titles).toContain("Oak Year 3 Maths check");
    expect(oak.rows[0]?.titles).not.toContain("Year 3 Maths Test");

    const reports = await pools.owner.query<{ statuses: string }>(
      `select string_agg(status, ',') as statuses
       from academic_reports where organisation_id = $1`,
      [greenwoodId],
    );
    expect(reports.rows[0]?.statuses).toContain("published");
    expect(reports.rows[0]?.statuses).toContain("draft");

    const admin = await pools.owner.query<{ id: string }>(
      "select id from users where email = $1",
      [DEMO_ACCOUNTS.greenwoodAdmin.email],
    );
    await withTenantContext(pools.app, admin.rows[0]!.id, greenwoodId, async (client) => {
      const leaked = await client.query<{ n: string }>(
        "select count(*)::text as n from academic_assessments where organisation_id = $1",
        [oakId],
      );
      expect(leaked.rows[0]?.n).toBe("0");
    });
  });

  it("seeds isolated Greenwood and Oak public admissions forms", async () => {
    const orgs = await pools.owner.query<{ id: string; slug: string }>(
      "select id, slug::text as slug from organisations where slug = any($1::citext[])",
      [["greenwood", "oakacademy"]],
    );
    const greenwoodId = orgs.rows.find((row) => row.slug === "greenwood")!.id;
    const oakId = orgs.rows.find((row) => row.slug === "oakacademy")!.id;
    const gw = await pools.owner.query<{ n: string; slugs: string }>(
      `select count(*)::text as n, string_agg(slug, ',') as slugs
       from admissions_forms where organisation_id = $1`,
      [greenwoodId],
    );
    const oak = await pools.owner.query<{ n: string; slugs: string }>(
      `select count(*)::text as n, string_agg(slug, ',') as slugs
       from admissions_forms where organisation_id = $1`,
      [oakId],
    );
    expect(gw.rows[0]?.slugs).toContain("year-3-enquiry");
    expect(gw.rows[0]?.slugs).toContain("year-3-application");
    expect(gw.rows[0]?.slugs).toContain("sixth-form-draft");
    expect(oak.rows[0]?.slugs).toContain("oak-enquiry");
    expect(oak.rows[0]?.slugs).not.toContain("year-3-enquiry");

    const admin = await pools.owner.query<{ id: string }>(
      "select id from users where email = $1",
      [DEMO_ACCOUNTS.greenwoodAdmin.email],
    );
    await withTenantContext(pools.app, admin.rows[0]!.id, greenwoodId, async (client) => {
      const leaked = await client.query<{ n: string }>(
        "select count(*)::text as n from admissions_forms where organisation_id = $1",
        [oakId],
      );
      expect(leaked.rows[0]?.n).toBe("0");
    });
  });

  it("seeds isolated Greenwood and Oak communications", async () => {
    const orgs = await pools.owner.query<{ id: string; slug: string }>(
      "select id, slug::text as slug from organisations where slug = any($1::citext[])",
      [["greenwood", "oakacademy"]],
    );
    const greenwoodId = orgs.rows.find((row) => row.slug === "greenwood")!.id;
    const oakId = orgs.rows.find((row) => row.slug === "oakacademy")!.id;
    const gw = await pools.owner.query<{ n: string; titles: string }>(
      `select count(*)::text as n, string_agg(title, ',') as titles
       from announcements where organisation_id = $1`,
      [greenwoodId],
    );
    const oak = await pools.owner.query<{ n: string; titles: string }>(
      `select count(*)::text as n, string_agg(title, ',') as titles
       from announcements where organisation_id = $1`,
      [oakId],
    );
    expect(gw.rows[0]?.titles).toContain("Welcome back to Greenwood");
    expect(gw.rows[0]?.titles).toContain("Staff briefing Friday");
    expect(gw.rows[0]?.titles).toContain("Acceptable use policy reminder");
    expect(oak.rows[0]?.titles).toContain("Oak Academy term start");
    expect(oak.rows[0]?.titles).not.toContain("Welcome back to Greenwood");

    const events = await pools.owner.query<{ titles: string }>(
      `select string_agg(title, ',') as titles from school_events where organisation_id = $1`,
      [greenwoodId],
    );
    expect(events.rows[0]?.titles).toContain("Year 3 science museum trip");
    expect(events.rows[0]?.titles).toContain("Staff meeting");

    const admin = await pools.owner.query<{ id: string }>(
      "select id from users where email = $1",
      [DEMO_ACCOUNTS.greenwoodAdmin.email],
    );
    await withTenantContext(pools.app, admin.rows[0]!.id, greenwoodId, async (client) => {
      const leaked = await client.query<{ n: string }>(
        "select count(*)::text as n from announcements where organisation_id = $1",
        [oakId],
      );
      expect(leaked.rows[0]?.n).toBe("0");
    });
  });
});
