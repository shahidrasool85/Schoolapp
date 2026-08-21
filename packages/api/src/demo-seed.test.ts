import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools } from "@schoolapp/db";
import { DEMO_ACCOUNTS, DEMO_EXTRA_ACCOUNTS, seedDemo } from "@schoolapp/db";
import { ensureMigrated, login, loginAlias, testApp, testPools } from "./test-helpers";

const ownerUrl =
  process.env.TEST_DATABASE_OWNER_URL ??
  "postgres://schoolapp_owner:schoolapp_owner@127.0.0.1:5432/schoolapp_api_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://schoolapp_app:schoolapp_app@127.0.0.1:5432/schoolapp_api_test";

describe("demo seed HTTP smoke", () => {
  const pools = testPools();
  const app = testApp(pools);
  let greenwoodId = "";
  let oakId = "";

  beforeAll(async () => {
    await ensureMigrated();
    const seeded = await seedDemo({
      ownerUrl,
      env: {
        NODE_ENV: "test",
        ALLOW_DEMO_SEED: "true",
        PLATFORM_DOMAIN: "localhost",
        DATABASE_OWNER_URL: ownerUrl,
        DATABASE_URL: appUrl,
      },
    });
    greenwoodId = seeded.organisations.find((org) => org.slug === "greenwood")!.id;
    oakId = seeded.organisations.find((org) => org.slug === "oakacademy")!.id;
  }, 60_000);

  afterAll(async () => {
    await closePools(pools);
  });

  it("resolves school hosts and keeps student lists isolated", async () => {
    const tenant = await app.request("/api/v1/public/tenant", {
      headers: { Host: "greenwood.localhost:3000" },
    });
    expect(tenant.status).toBe(200);
    const tenantBody = (await tenant.json()) as { kind: string; organisation: { name: string } };
    expect(tenantBody.kind).toBe("school");
    expect(tenantBody.organisation.name).toBe("Greenwood Academy");

    const token = await login(app, DEMO_ACCOUNTS.greenwoodAdmin.email!, DEMO_ACCOUNTS.greenwoodAdmin.password);
    const own = await app.request("/api/v1/students", {
      headers: { Authorization: `Bearer ${token}`, "X-Organisation-Id": greenwoodId },
    });
    expect(own.status).toBe(200);
    const ownBody = (await own.json()) as { students: Array<{ legalName: string }> };
    expect(ownBody.students.map((row) => row.legalName)).toContain(DEMO_ACCOUNTS.greenwoodStudent.fullName);
    expect(ownBody.students.map((row) => row.legalName)).not.toContain(
      DEMO_EXTRA_ACCOUNTS.oakStudent.fullName,
    );

    const spoof = await app.request("/api/v1/students", {
      headers: { Authorization: `Bearer ${token}`, "X-Organisation-Id": oakId },
    });
    expect(spoof.status).toBe(403);
  });

  it("lets labelled demo roles sign in, including the student alias", async () => {
    await expect(login(app, DEMO_ACCOUNTS.platformAdmin.email!, DEMO_ACCOUNTS.platformAdmin.password)).resolves.toBeTruthy();
    await expect(login(app, DEMO_ACCOUNTS.oakAdmin.email!, DEMO_ACCOUNTS.oakAdmin.password)).resolves.toBeTruthy();
    await expect(login(app, DEMO_ACCOUNTS.greenwoodParent.email!, DEMO_ACCOUNTS.greenwoodParent.password)).resolves.toBeTruthy();
    const studentToken = await loginAlias(
      app,
      "greenwood",
      DEMO_ACCOUNTS.greenwoodStudent.username!,
      DEMO_ACCOUNTS.greenwoodStudent.password,
    );
    expect(studentToken).toBeTruthy();
  });
});
