import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@schoolapp/domain";
import { closePools } from "@schoolapp/db";
import {
  addMembership,
  assertPortalSafe,
  ensureMigrated,
  insertUser,
  login,
  loginAlias,
  testApp,
  testPools,
} from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);

const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = Uint8Array.from(PNG_1X1);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

async function createSchool(
  owner: ReturnType<typeof testPools>["owner"],
  id: string,
  prefix = "brand",
  name?: string,
) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string; name: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug, name",
    [`${prefix}-${id}`, name ?? `Brand School ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  await owner.query(
    "insert into staff_profiles (organisation_id, user_id, job_title) values ($1, $2, 'School Admin')",
    [org.rows[0]!.id, adminId],
  );
  return {
    adminId,
    orgId: org.rows[0]!.id,
    slug: org.rows[0]!.slug,
    name: org.rows[0]!.name,
    adminEmail: `admin-${id}@example.com`,
  };
}

function jsonHeaders(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    "Content-Type": "application/json",
  };
}

function authHeaders(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
  };
}

function imageForm(bytes: Uint8Array, filename = "logo.png") {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), filename);
  return form;
}

describe("School branding", () => {
  const pools = testPools();
  const app = testApp(pools);
  const productionApp = testApp(pools, { platformDomain: "luvlearn.co.uk" });

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("returns public branding for a tenant without uploaded assets", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const res = await app.request("/api/v1/public/tenant", {
      headers: { Host: `${school.slug}.localhost:3000` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kind: string;
      hostname: string;
      organisation: {
        id: string;
        slug: string;
        name: string;
        branding: {
          logoUrl: string | null;
          heroImageUrl: string | null;
          tagline: string | null;
        };
      };
    };
    expect(body.kind).toBe("school");
    expect(body.organisation.id).toBe(school.orgId);
    expect(body.organisation.name).toBe(school.name);
    expect(body.organisation.branding.logoUrl).toBeNull();
    expect(body.organisation.branding.heroImageUrl).toBeNull();
    expect(body.organisation.branding.tagline).toBeNull();
    expect(JSON.stringify(body)).not.toContain("storage_key");
    expect(JSON.stringify(body)).not.toContain("password_hash");
    expect(JSON.stringify(body)).not.toContain("token_hash");
    expect(JSON.stringify(body)).not.toContain("extras");
    assertPortalSafe(body);
  });

  it("lets School Admin update the display name without changing slug or hostname", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "name", "Riverside School");
    const token = await login(app, school.adminEmail, "password-12x");
    const before = await pools.owner.query<{ slug: string; name: string }>(
      "select slug, name from organisations where id = $1",
      [school.orgId],
    );
    const patch = await app.request("/api/v1/onboarding/profile", {
      method: "PATCH",
      headers: jsonHeaders(token, school.orgId),
      body: JSON.stringify({ name: "Riverside Preparatory School" }),
    });
    expect(patch.status).toBe(200);
    const after = await pools.owner.query<{ slug: string; name: string }>(
      "select slug, name from organisations where id = $1",
      [school.orgId],
    );
    expect(after.rows[0]!.name).toBe("Riverside Preparatory School");
    expect(after.rows[0]!.slug).toBe(before.rows[0]!.slug);
    expect(after.rows[0]!.slug).toBe(school.slug);

    const tenant = await app.request("/api/v1/public/tenant", {
      headers: { Host: `${school.slug}.localhost:3000` },
    });
    const tenantBody = (await tenant.json()) as { organisation: { name: string; slug: string } };
    expect(tenantBody.organisation.name).toBe("Riverside Preparatory School");
    expect(tenantBody.organisation.slug).toBe(school.slug);
  });

  it("lets School Admin upload, preview, replace, and remove logo and cover images", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = authHeaders(token, school.orgId);

    const logo = await app.request("/api/v1/onboarding/branding/logo", {
      method: "POST",
      headers: hdrs,
      body: imageForm(pngHeader(64, 64), "crest.png"),
    });
    expect(logo.status).toBe(201);

    const hero = await app.request("/api/v1/onboarding/branding/hero", {
      method: "POST",
      headers: hdrs,
      body: imageForm(pngHeader(640, 360), "cover.png"),
    });
    expect(hero.status).toBe(201);

    const profile = (await (await app.request("/api/v1/onboarding/profile", {
      headers: jsonHeaders(token, school.orgId),
    })).json()) as {
      profile: { branding: { logoUrl: string | null; heroImageUrl: string | null } };
    };
    expect(profile.profile.branding.logoUrl).toMatch(/^\/api\/v1\/public\/branding\/logo\?v=/);
    expect(profile.profile.branding.heroImageUrl).toMatch(/^\/api\/v1\/public\/branding\/hero\?v=/);

    const publicTenant = await app.request("/api/v1/public/tenant", {
      headers: { Host: `${school.slug}.localhost:3000` },
    });
    const tenantBody = (await publicTenant.json()) as {
      organisation: { branding: Record<string, unknown> };
    };
    expect(String(tenantBody.organisation.branding.logoUrl)).toMatch(/\?v=/);
    expect(String(tenantBody.organisation.branding.heroImageUrl)).toMatch(/\?v=/);
    expect(JSON.stringify(tenantBody)).not.toContain("storage_key");
    expect(JSON.stringify(tenantBody)).not.toContain("logo_object_id");
    assertPortalSafe(tenantBody);

    const firstLogoUrl = String(tenantBody.organisation.branding.logoUrl);
    const replace = await app.request("/api/v1/onboarding/branding/logo", {
      method: "POST",
      headers: hdrs,
      body: imageForm(pngHeader(80, 80), "crest-v2.png"),
    });
    expect(replace.status).toBe(201);
    const afterReplace = (await (
      await app.request("/api/v1/public/tenant", { headers: { Host: `${school.slug}.localhost:3000` } })
    ).json()) as { organisation: { branding: { logoUrl: string } } };
    expect(afterReplace.organisation.branding.logoUrl).not.toBe(firstLogoUrl);

    const asset = await app.request(afterReplace.organisation.branding.logoUrl, {
      headers: { Host: `${school.slug}.localhost:3000` },
    });
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toMatch(/image\/png/);
    expect(asset.headers.get("cache-control")).toMatch(/max-age=86400/);

    const removed = await app.request("/api/v1/onboarding/branding/logo", {
      method: "DELETE",
      headers: hdrs,
    });
    expect(removed.status).toBe(200);
    const afterRemove = (await (
      await app.request("/api/v1/public/tenant", { headers: { Host: `${school.slug}.localhost:3000` } })
    ).json()) as { organisation: { branding: { logoUrl: string | null; heroImageUrl: string | null } } };
    expect(afterRemove.organisation.branding.logoUrl).toBeNull();
    expect(afterRemove.organisation.branding.heroImageUrl).toMatch(/hero\?v=/);

    const missing = await app.request("/api/v1/public/branding/logo", {
      headers: { Host: `${school.slug}.localhost:3000` },
    });
    expect(missing.status).toBe(404);
  });

  it("rejects unsupported, undersized, and oversized branding uploads", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = authHeaders(token, school.orgId);

    const svg = new FormData();
    svg.append(
      "file",
      new Blob(["<svg xmlns='http://www.w3.org/2000/svg'></svg>"], { type: "image/svg+xml" }),
      "logo.svg",
    );
    const svgRes = await app.request("/api/v1/onboarding/branding/logo", {
      method: "POST",
      headers: hdrs,
      body: svg,
    });
    expect(svgRes.status).toBe(400);

    const tiny = await app.request("/api/v1/onboarding/branding/logo", {
      method: "POST",
      headers: hdrs,
      body: imageForm(PNG_1X1, "tiny.png"),
    });
    expect(tiny.status).toBe(400);

    const hugeBytes = new Uint8Array(5 * 1024 * 1024 + 24);
    hugeBytes.set(pngHeader(64, 64), 0);
    const huge = await app.request("/api/v1/onboarding/branding/logo", {
      method: "POST",
      headers: hdrs,
      body: imageForm(hugeBytes, "huge.png"),
    });
    expect(huge.status).toBe(400);
  });

  it("keeps branding tenant-isolated and blocks teachers from changing it", async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, `${id}a`, "ba");
    const schoolB = await createSchool(pools.owner, `${id}b`, "bb");
    const tokenA = await login(app, schoolA.adminEmail, "password-12x");
    const tokenB = await login(app, schoolB.adminEmail, "password-12x");

    await app.request("/api/v1/onboarding/branding/logo", {
      method: "POST",
      headers: authHeaders(tokenA, schoolA.orgId),
      body: imageForm(pngHeader(64, 64)),
    });
    await app.request("/api/v1/onboarding/branding", {
      method: "PATCH",
      headers: jsonHeaders(tokenA, schoolA.orgId),
      body: JSON.stringify({ tagline: "School A only" }),
    });

    const tenantB = (await (
      await app.request("/api/v1/public/tenant", { headers: { Host: `${schoolB.slug}.localhost:3000` } })
    ).json()) as { organisation: { branding: { tagline: string | null; logoUrl: string | null } } };
    expect(tenantB.organisation.branding.tagline).toBeNull();
    expect(tenantB.organisation.branding.logoUrl).toBeNull();

    const stolen = await app.request("/api/v1/public/branding/logo", {
      headers: { Host: `${schoolB.slug}.localhost:3000` },
    });
    expect(stolen.status).toBe(404);

    const crossPatch = await app.request("/api/v1/onboarding/branding", {
      method: "PATCH",
      headers: jsonHeaders(tokenA, schoolB.orgId),
      body: JSON.stringify({ tagline: "cross tenant" }),
    });
    expect([401, 403, 404]).toContain(crossPatch.status);

    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "teacher-pass-1",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, schoolA.orgId, teacherId, "school.teacher");
    const teacherToken = await login(app, `teacher-${id}@example.com`, "teacher-pass-1");
    const teacherMe = (await (
      await app.request("/api/v1/me", { headers: jsonHeaders(teacherToken, schoolA.orgId) })
    ).json()) as { permissions: string[] };
    expect(teacherMe.permissions).not.toContain(PERMISSIONS.ORG_SETTINGS_MANAGE);

    const teacherPatch = await app.request("/api/v1/onboarding/branding", {
      method: "PATCH",
      headers: jsonHeaders(teacherToken, schoolA.orgId),
      body: JSON.stringify({ tagline: "teacher change" }),
    });
    expect(teacherPatch.status).toBe(403);
    const teacherUpload = await app.request("/api/v1/onboarding/branding/logo", {
      method: "POST",
      headers: authHeaders(teacherToken, schoolA.orgId),
      body: imageForm(pngHeader(64, 64)),
    });
    expect(teacherUpload.status).toBe(403);

    void tokenB;
  });

  it("keeps production host classification and authentication working", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "kingswood", "Kingswood School");
    await pools.owner.query("update organisations set slug = $2 where id = $1", [
      school.orgId,
      `kingswood-${id}`,
    ]);
    const slug = `kingswood-${id}`;

    const platform = await productionApp.request("/api/v1/public/tenant", {
      headers: { Host: "app.luvlearn.co.uk" },
    });
    expect(platform.status).toBe(200);
    expect(((await platform.json()) as { kind: string }).kind).toBe("platform");

    const schoolHost = await productionApp.request("/api/v1/public/tenant", {
      headers: { Host: `${slug}.luvlearn.co.uk` },
    });
    expect(schoolHost.status).toBe(200);
    const schoolBody = (await schoolHost.json()) as {
      kind: string;
      organisation: { name: string; slug: string; branding: { logoUrl: string | null } };
    };
    expect(schoolBody.kind).toBe("school");
    expect(schoolBody.organisation.name).toBe("Kingswood School");
    expect(schoolBody.organisation.slug).toBe(slug);
    expect(schoolBody.organisation.branding.logoUrl).toBeNull();

    const platformId = await insertUser(pools.owner, {
      email: `platform-${id}@example.com`,
      password: "platform-pass-1",
      fullName: "Platform Admin",
      kind: "platform_admin",
      platformAdmin: true,
    });
    void platformId;
    const platformToken = await login(productionApp, `platform-${id}@example.com`, "platform-pass-1");
    const platformMe = await productionApp.request("/api/v1/me", {
      headers: { Authorization: `Bearer ${platformToken}`, Host: "app.luvlearn.co.uk" },
    });
    expect(platformMe.status).toBe(200);
    expect(((await platformMe.json()) as { isPlatformAdmin: boolean }).isPlatformAdmin).toBe(true);

    const staffToken = await login(app, school.adminEmail, "password-12x");
    expect(staffToken.length).toBeGreaterThan(10);

    const parentId = await insertUser(pools.owner, {
      email: `parent-${id}@example.com`,
      password: "password-12x",
      fullName: "Parent",
      kind: "parent",
    });
    await addMembership(pools.owner, school.orgId, parentId, "school.parent");
    const parentToken = await login(app, `parent-${id}@example.com`, "password-12x");
    expect(parentToken.length).toBeGreaterThan(10);

    const studentId = await insertUser(pools.owner, {
      email: `student-${id}@example.com`,
      password: "student-pass-1",
      fullName: "Student",
      kind: "student",
    });
    await addMembership(pools.owner, school.orgId, studentId, "school.student");
    const profile = await pools.owner.query<{ id: string }>(
      `insert into student_profiles (organisation_id, user_id, legal_name)
       values ($1, $2, 'Student One') returning id`,
      [school.orgId, studentId],
    );
    const year = await pools.owner.query<{ id: string }>(
      `insert into academic_years (organisation_id, name, starts_on, ends_on, is_current)
       values ($1, '2026/27', current_date - 10, current_date + 200, true) returning id`,
      [school.orgId],
    );
    const yearGroup = await pools.owner.query<{ id: string }>(
      `insert into year_groups (organisation_id, code, name, key_stage, sort_order)
       values ($1, '3', 'Year 3', 2, 3) returning id`,
      [school.orgId],
    );
    await pools.owner.query(
      `insert into student_enrolments (
         organisation_id, student_profile_id, academic_year_id, year_group_id,
         status, is_primary, placement_kind, started_on
       ) values ($1, $2, $3, $4, 'enrolled', true, 'primary', current_date - 10)`,
      [school.orgId, profile.rows[0]!.id, year.rows[0]!.id, yearGroup.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into student_portal_policies (organisation_id, default_enabled)
       values ($1, true)
       on conflict (organisation_id) do update set default_enabled = true`,
      [school.orgId],
    );
    await pools.owner.query(
      `insert into student_portal_student_overrides (organisation_id, student_profile_id, enabled)
       values ($1, $2, true)
       on conflict (student_profile_id) do update set enabled = true`,
      [school.orgId, profile.rows[0]!.id],
    );
    await pools.owner.query(
      "insert into user_login_aliases (organisation_id, user_id, alias) values ($1, $2, $3)",
      [school.orgId, studentId, `stu.${id}`],
    );
    const studentToken = await loginAlias(app, slug, `stu.${id}`, "student-pass-1");
    expect(studentToken.length).toBeGreaterThan(10);
  });
});
