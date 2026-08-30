import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS, canAccessSchoolSettingsAdmin } from "@schoolapp/domain";
import { closePools } from "@schoolapp/db";
import { addMembership, ensureMigrated, insertUser, login, testApp, testPools } from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);

function jsonHeaders(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    "Content-Type": "application/json",
  };
}

async function createSchool(
  owner: ReturnType<typeof testPools>["owner"],
  id: string,
  name = `Subjects ${id}`,
) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "School Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status, timezone) values ($1, $2, 'active', 'Europe/London') returning id, slug",
    [`sub-${id}`, name],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return {
    adminId,
    orgId: org.rows[0]!.id,
    slug: org.rows[0]!.slug,
    adminEmail: `admin-${id}@example.com`,
    name,
  };
}

async function addRoleUser(
  owner: ReturnType<typeof testPools>["owner"],
  orgId: string,
  id: string,
  role: "school.teacher" | "school.headteacher" | "school.parent" | "school.student",
  kind: "staff" | "parent" | "student",
) {
  const userId = await insertUser(owner, {
    email: `${role.split(".").at(-1)}-${id}@example.com`,
    password: "password-12x",
    fullName: role,
    kind,
  });
  await addMembership(owner, orgId, userId, role);
  return { userId, email: `${role.split(".").at(-1)}-${id}@example.com` };
}

describe("subject creation and school settings permission hotfix", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("lets School Admin create a subject, lists it, and marks readiness complete", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);

    const before = (await (await app.request("/api/v1/onboarding", { headers: hdrs })).json()) as {
      readiness: { items: Array<{ key: string; complete: boolean }> };
    };
    expect(before.readiness.items.find((item) => item.key === "subjects")?.complete).toBe(false);

    const created = await app.request("/api/v1/subjects", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "English", key: "Eng" }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { subject: { id: string; key: string; name: string } };
    expect(createdBody.subject.name).toBe("English");
    expect(createdBody.subject.key).toBe("eng");

    const list = (await (await app.request("/api/v1/subjects", { headers: hdrs })).json()) as {
      subjects: Array<{ id: string; key: string; name: string }>;
    };
    expect(list.subjects.some((row) => row.id === createdBody.subject.id && row.key === "eng")).toBe(true);

    const after = (await (await app.request("/api/v1/onboarding", { headers: hdrs })).json()) as {
      readiness: { items: Array<{ key: string; complete: boolean }> };
    };
    expect(after.readiness.items.find((item) => item.key === "subjects")?.complete).toBe(true);
  });

  it("rejects duplicate keys in the same school and allows the same key in another school", async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, `${id}a`, `School A ${id}`);
    const schoolB = await createSchool(pools.owner, `${id}b`, `School B ${id}`);
    const tokenA = await login(app, schoolA.adminEmail, "password-12x");
    const tokenB = await login(app, schoolB.adminEmail, "password-12x");
    const hdrsA = jsonHeaders(tokenA, schoolA.orgId);
    const hdrsB = jsonHeaders(tokenB, schoolB.orgId);

    const [first, raced] = await Promise.all([
      app.request("/api/v1/subjects", {
        method: "POST",
        headers: hdrsA,
        body: JSON.stringify({ name: "Mathematics", key: "MATH" }),
      }),
      app.request("/api/v1/subjects", {
        method: "POST",
        headers: hdrsA,
        body: JSON.stringify({ name: "Maths again", key: "math" }),
      }),
    ]);
    expect([first.status, raced.status].sort()).toEqual([201, 409]);
    const conflict = first.status === 409 ? first : raced;
    const duplicateBody = (await conflict.json()) as { error: { message: string } };
    expect(duplicateBody.error.message).toMatch(/already exists/i);

    const duplicate = await app.request("/api/v1/subjects", {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({ name: "Maths", key: "MATH" }),
    });
    expect(duplicate.status).toBe(409);

    const otherSchool = await app.request("/api/v1/subjects", {
      method: "POST",
      headers: hdrsB,
      body: JSON.stringify({ name: "Mathematics", key: "math" }),
    });
    expect(otherSchool.status).toBe(201);

    const leaked = await app.request("/api/v1/subjects", {
      headers: jsonHeaders(tokenA, schoolB.orgId),
    });
    expect([401, 403, 404]).toContain(leaked.status);

    const countA = await pools.owner.query<{ n: string }>(
      "select count(*)::text as n from subjects where organisation_id = $1 and key = 'math'",
      [schoolA.orgId],
    );
    expect(countA.rows[0]?.n).toBe("1");
  });

  it("returns a visible validation error for invalid subject input", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);

    const invalid = await app.request("/api/v1/subjects", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "English", key: "Eng!" }),
    });
    expect(invalid.status).toBe(400);
    const body = (await invalid.json()) as { error: { code: string; message: string; details?: { fieldKey?: string } } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message).toMatch(/letters, numbers, and hyphens/i);
    expect(body.error.details?.fieldKey).toBe("key");
    expect(body.error.message).not.toBe("Request failed");
  });

  it("keeps School Settings administration off ordinary teachers while branding stays public", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, `Kingswood ${id}`);
    const teacher = await addRoleUser(pools.owner, school.orgId, id, "school.teacher", "staff");
    const head = await addRoleUser(pools.owner, school.orgId, `${id}h`, "school.headteacher", "staff");
    const parent = await addRoleUser(pools.owner, school.orgId, `${id}p`, "school.parent", "parent");
    const studentId = await insertUser(pools.owner, {
      email: `student-${id}@example.com`,
      password: "student-pass-1",
      fullName: "Student",
      kind: "student",
    });
    await addMembership(pools.owner, school.orgId, studentId, "school.student");
    const platformId = await insertUser(pools.owner, {
      email: `platform-${id}@example.com`,
      password: "platform-pass-1",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });

    const adminToken = await login(app, school.adminEmail, "password-12x");
    const teacherToken = await login(app, teacher.email, "password-12x");
    const headToken = await login(app, head.email, "password-12x");
    const parentToken = await login(app, parent.email, "password-12x");
    const studentToken = await login(app, `student-${id}@example.com`, "student-pass-1");
    const platformToken = await login(app, `platform-${id}@example.com`, "platform-pass-1");

    const adminMe = (await (
      await app.request("/api/v1/me", { headers: jsonHeaders(adminToken, school.orgId) })
    ).json()) as { permissions: string[] };
    const teacherMe = (await (
      await app.request("/api/v1/me", { headers: jsonHeaders(teacherToken, school.orgId) })
    ).json()) as { permissions: string[] };
    const headMe = (await (
      await app.request("/api/v1/me", { headers: jsonHeaders(headToken, school.orgId) })
    ).json()) as { permissions: string[] };

    expect(adminMe.permissions).toContain(PERMISSIONS.ORG_SETTINGS_MANAGE);
    expect(canAccessSchoolSettingsAdmin(adminMe.permissions)).toBe(true);
    expect(teacherMe.permissions).toContain(PERMISSIONS.ORG_SETTINGS_READ);
    expect(teacherMe.permissions).not.toContain(PERMISSIONS.ORG_SETTINGS_MANAGE);
    expect(canAccessSchoolSettingsAdmin(teacherMe.permissions)).toBe(false);
    expect(headMe.permissions).toContain(PERMISSIONS.ORG_SETTINGS_READ);
    expect(headMe.permissions).not.toContain(PERMISSIONS.ORG_SETTINGS_MANAGE);
    expect(canAccessSchoolSettingsAdmin(headMe.permissions)).toBe(false);

    expect((await app.request("/api/v1/onboarding/profile", { headers: jsonHeaders(adminToken, school.orgId) })).status).toBe(200);
    expect((await app.request("/api/v1/onboarding/profile", { headers: jsonHeaders(teacherToken, school.orgId) })).status).toBe(403);
    expect((await app.request("/api/v1/onboarding/profile", { headers: jsonHeaders(headToken, school.orgId) })).status).toBe(200);

    const teacherPatch = await app.request("/api/v1/onboarding/profile", {
      method: "PATCH",
      headers: jsonHeaders(teacherToken, school.orgId),
      body: JSON.stringify({ name: "Hacked" }),
    });
    expect(teacherPatch.status).toBe(403);

    const teacherOrgPatch = await app.request("/api/v1/organisation/settings", {
      method: "PATCH",
      headers: jsonHeaders(teacherToken, school.orgId),
      body: JSON.stringify({ locale: "en-GB" }),
    });
    expect(teacherOrgPatch.status).toBe(403);

    const teacherSubject = await app.request("/api/v1/subjects", {
      method: "POST",
      headers: jsonHeaders(teacherToken, school.orgId),
      body: JSON.stringify({ name: "English", key: "eng" }),
    });
    expect(teacherSubject.status).toBe(403);

    const teacherSubjects = await app.request("/api/v1/subjects", {
      headers: jsonHeaders(teacherToken, school.orgId),
    });
    expect(teacherSubjects.status).toBe(200);

    const publicTenant = await app.request("/api/v1/public/tenant", {
      headers: { Host: `${school.slug}.localhost:3000` },
    });
    expect(publicTenant.status).toBe(200);
    const tenantBody = (await publicTenant.json()) as {
      kind: string;
      organisation: { name: string; branding?: { logoUrl: string | null } };
    };
    expect(tenantBody.kind).toBe("school");
    expect(tenantBody.organisation.name).toBe(school.name);
    expect(tenantBody.organisation).toHaveProperty("branding");

    expect((await app.request("/api/v1/onboarding/profile", { headers: jsonHeaders(parentToken, school.orgId) })).status).toBe(403);
    expect((await app.request("/api/v1/subjects", {
      method: "POST",
      headers: jsonHeaders(parentToken, school.orgId),
      body: JSON.stringify({ name: "English", key: "eng" }),
    })).status).toBe(403);
    expect((await app.request("/api/v1/onboarding/profile", { headers: jsonHeaders(studentToken, school.orgId) })).status).toBe(403);
    expect((await app.request("/api/v1/subjects", {
      method: "POST",
      headers: jsonHeaders(studentToken, school.orgId),
      body: JSON.stringify({ name: "English", key: "eng" }),
    })).status).toBe(403);

    const platformMe = (await (
      await app.request("/api/v1/me", { headers: { Authorization: `Bearer ${platformToken}` } })
    ).json()) as { isPlatformAdmin: boolean; permissions: string[] };
    expect(platformMe.isPlatformAdmin).toBe(true);
    expect(platformMe.permissions ?? []).not.toContain(PERMISSIONS.ORG_SETTINGS_MANAGE);
    expect((await app.request("/api/v1/onboarding/profile", {
      headers: jsonHeaders(platformToken, school.orgId),
    })).status).toBeGreaterThanOrEqual(400);

    void platformId;
  });
});
