import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schoolPublicOrigin } from "@schoolapp/core";
import { closePools } from "@schoolapp/db";
import { addMembership, ensureMigrated, insertUser, testApp, testPools } from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);

async function seedSchool(
  owner: ReturnType<typeof testPools>["owner"],
  id: string,
  name: string,
  status: "active" | "suspended" = "active",
) {
  const adminId = await insertUser(owner, {
    email: `finder-${id}@example.com`,
    password: "password-12x",
    fullName: `${name} Admin`,
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string; name: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, $3) returning id, slug, name",
    [`kingswood-${id}`.slice(0, 48), name, status],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return org.rows[0]!;
}

describe("public school finder", () => {
  const pools = testPools();
  const app = testApp(pools);
  const production = testApp(pools, { platformDomain: "luvlearn.co.uk" });

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("returns only active schools with safe public fields and a trusted login URL", async () => {
    const id = suffix();
    const active = await seedSchool(pools.owner, `${id}a`, `Kingswood School ${id}`);
    const inactive = await seedSchool(pools.owner, `${id}i`, `Kingswood Closed ${id}`, "suspended");

    const empty = await app.request("/api/v1/public/schools?q=K", { headers: { Host: "localhost:3000" } });
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { schools: unknown[] }).schools).toEqual([]);

    const found = await app.request(`/api/v1/public/schools?q=Kingswood School ${id}`, {
      headers: { Host: "localhost:3000" },
    });
    expect(found.status).toBe(200);
    const body = (await found.json()) as {
      schools: Array<{ name: string; slug: string; loginUrl: string; logoUrl: string | null; id?: string }>;
    };
    expect(body.schools.some((row) => row.slug === active.slug)).toBe(true);
    expect(body.schools.some((row) => row.slug === inactive.slug)).toBe(false);
    const match = body.schools.find((row) => row.slug === active.slug)!;
    expect(match.name).toBe(active.name);
    expect(match).not.toHaveProperty("id");
    expect(match.loginUrl).toBe(`${schoolPublicOrigin(active.slug, "localhost")}/login`);
    expect(match.loginUrl.startsWith("http://")).toBe(true);
    expect(match.loginUrl).not.toContain("evil");

    const openRedirect = await app.request("/api/v1/public/schools?q=https://evil.example", {
      headers: { Host: "localhost:3000" },
    });
    const redirectBody = (await openRedirect.json()) as { schools: Array<{ loginUrl: string }> };
    expect(redirectBody.schools.every((row) => !row.loginUrl.includes("evil.example"))).toBe(true);
  });

  it("stays on the platform host and does not advertise itself on a school host", async () => {
    const id = suffix();
    const school = await seedSchool(pools.owner, id, `Finder ${id}`);
    const fromSchool = await app.request("/api/v1/public/schools?q=Finder", {
      headers: { Host: `${school.slug}.localhost:3000` },
    });
    expect(fromSchool.status).toBe(404);

    const prod = await production.request("/api/v1/public/schools?q=Finder", {
      headers: { Host: "app.luvlearn.co.uk" },
    });
    expect(prod.status).toBe(200);
    const body = (await prod.json()) as { schools: Array<{ slug: string; loginUrl: string }> };
    const match = body.schools.find((row) => row.slug === school.slug);
    if (match) {
      expect(match.loginUrl).toBe(`https://${school.slug}.luvlearn.co.uk/login`);
    }
  });
});
