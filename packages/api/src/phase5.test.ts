import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS, RESERVED_SUBDOMAINS } from "@schoolapp/domain";
import { closePools, withTenantContext } from "@schoolapp/db";
import {
  addMembership,
  ensureMigrated,
  insertUser,
  login,
  loginAlias,
  testApp,
  testPools,
} from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);

async function seedSchool(
  owner: ReturnType<typeof testPools>["owner"],
  id: string,
  name: string,
) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: `${name} Admin`,
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string; name: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug, name",
    [id, name],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [
    org.rows[0]!.id,
  ]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return {
    adminId,
    orgId: org.rows[0]!.id,
    slug: org.rows[0]!.slug,
    name: org.rows[0]!.name,
    adminEmail: `admin-${id}@example.com`,
  };
}

describe("Phase 5 SaaS hostname tenancy", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("keeps reserved subdomain catalogue in sync with SQL", async () => {
    const rows = await pools.app.query<{ slug: string }>(
      "select slug::text as slug from reserved_subdomains order by slug",
    );
    expect(rows.rows.map((r) => r.slug).sort()).toEqual([...RESERVED_SUBDOMAINS].sort());
  });

  it("resolves a valid school subdomain to the correct organisation", async () => {
    const id = suffix();
    const school = await seedSchool(pools.owner, `greenwood-${id}`, "Greenwood Academy");
    const res = await app.request("/api/v1/public/tenant", {
      headers: { Host: `${school.slug}.localhost:3000` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kind: string;
      organisation: { id: string; slug: string; name: string };
    };
    expect(body.kind).toBe("school");
    expect(body.organisation.id).toBe(school.orgId);
    expect(body.organisation.slug).toBe(school.slug);
    expect(body.organisation.name).toBe("Greenwood Academy");
  });

  it("fails safely for an unknown school subdomain", async () => {
    const res = await app.request("/api/v1/public/tenant", {
      headers: { Host: `nosuch-${suffix()}.localhost:3000` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("tenant_not_found");

    const blocked = await app.request("/api/v1/organisation", {
      headers: { Host: `nosuch-${suffix()}.localhost:3000` },
    });
    expect(blocked.status).toBe(404);
  });

  it("rejects reserved, duplicate, and malformed slugs", async () => {
    const id = suffix();
    const platformId = await insertUser(pools.owner, {
      email: `platform-${id}@example.com`,
      password: "platform-pass-1",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    void platformId;
    const token = await login(app, `platform-${id}@example.com`, "platform-pass-1");
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Host: "localhost:3000",
    };

    const reserved = await app.request("/api/v1/platform/organisations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Reserved",
        slug: "www",
        adminEmail: `reserved-${id}@example.com`,
        adminFullName: "Ada",
      }),
    });
    expect(reserved.status).toBe(400);
    expect(((await reserved.json()) as { error: { code: string } }).error.code).toBe("reserved_slug");

    const malformed = await app.request("/api/v1/platform/organisations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Bad",
        slug: "Green Wood",
        adminEmail: `malformed-${id}@example.com`,
        adminFullName: "Ada",
      }),
    });
    expect(malformed.status).toBe(400);

    const punycode = await app.request("/api/v1/platform/organisations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Bad",
        slug: "xn--greenwood",
        adminEmail: `puny-${id}@example.com`,
        adminFullName: "Ada",
      }),
    });
    expect(punycode.status).toBe(400);

    const first = await app.request("/api/v1/platform/organisations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "First",
        slug: `dup-${id}`,
        adminEmail: `dup1-${id}@example.com`,
        adminFullName: "Ada",
      }),
    });
    expect(first.status).toBe(201);
    const duplicate = await app.request("/api/v1/platform/organisations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Second",
        slug: `dup-${id}`,
        adminEmail: `dup2-${id}@example.com`,
        adminFullName: "Ada",
      }),
    });
    expect(duplicate.status).toBe(409);
  });

  it("rejects a cross-tenant Host and X-Organisation-Id mismatch", async () => {
    const id = suffix();
    const greenwood = await seedSchool(pools.owner, `gw-${id}`, "Greenwood");
    const oak = await seedSchool(pools.owner, `oak-${id}`, "Oak Academy");
    const token = await login(app, greenwood.adminEmail, "password-12x");
    const spoof = await app.request("/api/v1/organisation", {
      headers: {
        Authorization: `Bearer ${token}`,
        Host: `${greenwood.slug}.localhost:3000`,
        "X-Organisation-Id": oak.orgId,
      },
    });
    expect(spoof.status).toBe(403);
    expect(((await spoof.json()) as { error: { code: string } }).error.code).toBe("org_host_mismatch");
  });

  it("does not let an authenticated user access another school by changing Host", async () => {
    const id = suffix();
    const greenwood = await seedSchool(pools.owner, `gwa-${id}`, "Greenwood");
    const oak = await seedSchool(pools.owner, `oakb-${id}`, "Oak Academy");
    await pools.owner.query(
      "insert into student_profiles (organisation_id, legal_name) values ($1, $2), ($3, $4)",
      [greenwood.orgId, "Pupil Greenwood", oak.orgId, "Pupil Oak"],
    );
    const token = await login(app, greenwood.adminEmail, "password-12x");
    const otherHost = await app.request("/api/v1/organisation", {
      headers: {
        Authorization: `Bearer ${token}`,
        Host: `${oak.slug}.localhost:3000`,
      },
    });
    expect(otherHost.status).toBe(403);
    expect(((await otherHost.json()) as { error: { code: string } }).error.code).toMatch(
      /org_membership_required|support_grant_required/,
    );

    const own = await app.request("/api/v1/students", {
      headers: {
        Authorization: `Bearer ${token}`,
        Host: `${greenwood.slug}.localhost:3000`,
      },
    });
    expect(own.status).toBe(200);
    const ownBody = (await own.json()) as { students: Array<{ legalName: string }> };
    expect(ownBody.students.map((s) => s.legalName)).toEqual(["Pupil Greenwood"]);
  });

  it("gives a multi-school user the host school's context only", async () => {
    const id = suffix();
    const greenwood = await seedSchool(pools.owner, `gwm-${id}`, "Greenwood");
    const oak = await seedSchool(pools.owner, `oakm-${id}`, "Oak Academy");
    const teacherId = await insertUser(pools.owner, {
      email: `multi-${id}@example.com`,
      password: "password-12x",
      fullName: "Multi Staff",
      kind: "staff",
    });
    await addMembership(pools.owner, greenwood.orgId, teacherId, "school.teacher");
    await addMembership(pools.owner, oak.orgId, teacherId, "school.teacher");
    const token = await login(app, `multi-${id}@example.com`, "password-12x");

    const atGreenwood = await app.request("/api/v1/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        Host: `${greenwood.slug}.localhost:3000`,
      },
    });
    expect(atGreenwood.status).toBe(200);
    const greenwoodBody = (await atGreenwood.json()) as {
      organisationId: string;
      hostOrganisation: { slug: string };
    };
    expect(greenwoodBody.organisationId).toBe(greenwood.orgId);
    expect(greenwoodBody.hostOrganisation.slug).toBe(greenwood.slug);

    const atOak = await app.request("/api/v1/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        Host: `${oak.slug}.localhost:3000`,
        "X-Organisation-Id": greenwood.orgId,
      },
    });
    expect(atOak.status).toBe(403);
  });

  it("keeps parent, student, and staff restrictions organisation-scoped on a school host", async () => {
    const id = suffix();
    const schoolA = await seedSchool(pools.owner, `pa-${id}`, "School A");
    const schoolB = await seedSchool(pools.owner, `pb-${id}`, "School B");
    const parentId = await insertUser(pools.owner, {
      email: `parent-${id}@example.com`,
      password: "password-12x",
      fullName: "Parent",
      kind: "parent",
    });
    const studentUser = await insertUser(pools.owner, {
      email: `stu-${id}@example.com`,
      password: "password-12x",
      fullName: "Student",
      kind: "student",
    });
    await addMembership(pools.owner, schoolA.orgId, parentId, "school.parent");
    await addMembership(pools.owner, schoolA.orgId, studentUser, "school.student");
    const childA = await pools.owner.query<{ id: string }>(
      `insert into student_profiles (organisation_id, legal_name, user_id, enrolment_status)
       values ($1, 'Child A', $2, 'enrolled') returning id`,
      [schoolA.orgId, studentUser],
    );
    const childB = await pools.owner.query<{ id: string }>(
      `insert into student_profiles (organisation_id, legal_name, enrolment_status)
       values ($1, 'Child B', 'enrolled') returning id`,
      [schoolB.orgId],
    );
    await pools.owner.query(
      `insert into guardianships (
         organisation_id, guardian_user_id, student_profile_id, relationship, portal_access
       ) values ($1, $2, $3, 'mother', true)`,
      [schoolA.orgId, parentId, childA.rows[0]!.id],
    );

    await pools.owner.query(
      `insert into student_portal_student_overrides (organisation_id, student_profile_id, enabled)
       values ($1, $2, true)`,
      [schoolA.orgId, childA.rows[0]!.id],
    );
    const year = await pools.owner.query<{ id: string }>(
      `insert into academic_years (organisation_id, name, starts_on, ends_on, is_current)
       values ($1, '2026/27', current_date - 10, current_date + 200, true) returning id`,
      [schoolA.orgId],
    );
    const yearGroup = await pools.owner.query<{ id: string }>(
      `insert into year_groups (organisation_id, code, name, key_stage, sort_order)
       values ($1, '3', 'Year 3', 2, 3) returning id`,
      [schoolA.orgId],
    );
    await pools.owner.query(
      `insert into student_enrolments (
         organisation_id, student_profile_id, academic_year_id, year_group_id,
         status, is_primary, placement_kind, started_on
       ) values ($1, $2, $3, $4, 'enrolled', true, 'primary', current_date - 10)`,
      [schoolA.orgId, childA.rows[0]!.id, year.rows[0]!.id, yearGroup.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into user_login_aliases (organisation_id, user_id, alias)
       values ($1, $2, $3)`,
      [schoolA.orgId, studentUser, `stu.${id}`],
    );

    const parentToken = await login(app, `parent-${id}@example.com`, "password-12x");
    const parentOk = await app.request("/api/v1/parent/children", {
      headers: {
        Authorization: `Bearer ${parentToken}`,
        Host: `${schoolA.slug}.localhost:3000`,
      },
    });
    expect(parentOk.status).toBe(200);
    const parentBody = (await parentOk.json()) as { children: Array<{ id: string }> };
    expect(parentBody.children.map((c) => c.id)).toEqual([childA.rows[0]!.id]);

    const parentOther = await app.request(`/api/v1/parent/children/${childB.rows[0]!.id}`, {
      headers: {
        Authorization: `Bearer ${parentToken}`,
        Host: `${schoolA.slug}.localhost:3000`,
      },
    });
    expect(parentOther.status).toBe(404);

    const parentOnB = await app.request("/api/v1/parent/children", {
      headers: {
        Authorization: `Bearer ${parentToken}`,
        Host: `${schoolB.slug}.localhost:3000`,
      },
    });
    expect(parentOnB.status).toBe(403);

    const platformEmail = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `stu-${id}@example.com`,
        password: "password-12x",
      }),
    });
    expect(platformEmail.status).toBe(401);

    const studentToken = await loginAlias(app, schoolA.slug, `stu.${id}`, "password-12x");
    const studentMe = await app.request("/api/v1/student/me", {
      headers: {
        Authorization: `Bearer ${studentToken}`,
        Host: `${schoolA.slug}.localhost:3000`,
      },
    });
    expect(studentMe.status).toBe(200);
    const studentOther = await app.request("/api/v1/student/me", {
      headers: {
        Authorization: `Bearer ${studentToken}`,
        Host: `${schoolB.slug}.localhost:3000`,
      },
    });
    expect(studentOther.status).toBe(403);

    const adminA = await login(app, schoolA.adminEmail, "password-12x");
    const staffB = await app.request("/api/v1/students", {
      headers: {
        Authorization: `Bearer ${adminA}`,
        Host: `${schoolB.slug}.localhost:3000`,
      },
    });
    expect(staffB.status).toBe(403);
  });

  it("does not select a tenant on the root platform hostname", async () => {
    const id = suffix();
    await seedSchool(pools.owner, `root-${id}`, "Should Not Auto Select");
    const res = await app.request("/api/v1/public/tenant", {
      headers: { Host: "localhost:3000" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; organisation: unknown };
    expect(body.kind).toBe("platform");
    expect(body.organisation).toBeNull();

    const ip = await app.request("/api/v1/public/tenant", {
      headers: { Host: "127.0.0.1:3000" },
    });
    expect(ip.status).toBe(200);
    expect(((await ip.json()) as { kind: string }).kind).toBe("platform");
  });

  it("classifies production platform, school, and unknown hosts using PLATFORM_DOMAIN", async () => {
    const production = "luvlearn.co.uk";
    const prodApp = testApp(pools, { platformDomain: production });
    const id = suffix();
    const school = await seedSchool(pools.owner, `school1-${id}`, "School One");

    const appHost = await prodApp.request("/api/v1/public/tenant", {
      headers: { Host: "app.luvlearn.co.uk" },
    });
    expect(appHost.status).toBe(200);
    const appBody = (await appHost.json()) as { kind: string; organisation: unknown };
    expect(appBody.kind).toBe("platform");
    expect(appBody.organisation).toBeNull();

    const apex = await prodApp.request("/api/v1/public/tenant", {
      headers: { Host: "luvlearn.co.uk" },
    });
    expect(apex.status).toBe(200);
    expect(((await apex.json()) as { kind: string }).kind).toBe("platform");

    const www = await prodApp.request("/api/v1/public/tenant", {
      headers: { Host: "www.luvlearn.co.uk" },
    });
    expect(www.status).toBe(200);
    expect(((await www.json()) as { kind: string }).kind).toBe("platform");

    const reserved = await prodApp.request("/api/v1/public/tenant", {
      headers: { Host: "api.luvlearn.co.uk" },
    });
    expect(reserved.status).toBe(200);
    expect(((await reserved.json()) as { kind: string }).kind).toBe("platform");

    const schoolHost = await prodApp.request("/api/v1/public/tenant", {
      headers: { Host: `${school.slug}.luvlearn.co.uk` },
    });
    expect(schoolHost.status).toBe(200);
    const schoolBody = (await schoolHost.json()) as {
      kind: string;
      organisation: { id: string; slug: string };
    };
    expect(schoolBody.kind).toBe("school");
    expect(schoolBody.organisation.id).toBe(school.orgId);
    expect(schoolBody.organisation.slug).toBe(school.slug);

    const unregistered = await prodApp.request("/api/v1/public/tenant", {
      headers: { Host: `ghost-${id}.luvlearn.co.uk` },
    });
    expect(unregistered.status).toBe(404);
    expect(((await unregistered.json()) as { error: { code: string } }).error.code).toBe(
      "tenant_not_found",
    );

    const nested = await prodApp.request("/api/v1/public/tenant", {
      headers: { Host: "foo.bar.luvlearn.co.uk" },
    });
    expect(nested.status).toBe(404);

    const untrustedForward = await prodApp.request("/api/v1/public/tenant", {
      headers: {
        Host: "app.luvlearn.co.uk",
        "X-Forwarded-Host": `${school.slug}.luvlearn.co.uk`,
      },
    });
    expect(untrustedForward.status).toBe(200);
    expect(((await untrustedForward.json()) as { kind: string }).kind).toBe("platform");

    const trustedProd = testApp(pools, { platformDomain: production, trustProxy: true });
    const reservedTerminator = await trustedProd.request("/api/v1/public/tenant", {
      headers: {
        Host: "app.luvlearn.co.uk",
        "X-Forwarded-Host": `${school.slug}.luvlearn.co.uk`,
      },
    });
    expect(reservedTerminator.status).toBe(200);
    expect(
      ((await reservedTerminator.json()) as { kind: string; organisation: { id: string } }).kind,
    ).toBe("school");

    const schoolNotSpoofed = await trustedProd.request("/api/v1/public/tenant", {
      headers: {
        Host: `${school.slug}.luvlearn.co.uk`,
        "X-Forwarded-Host": "app.luvlearn.co.uk",
      },
    });
    expect(schoolNotSpoofed.status).toBe(200);
    expect(((await schoolNotSpoofed.json()) as { kind: string }).kind).toBe("school");

    const login = await prodApp.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "app.luvlearn.co.uk" },
      body: JSON.stringify({ email: school.adminEmail, password: "password-12x" }),
    });
    expect(login.status).toBe(200);
    expect(((await login.json()) as { accessToken: string }).accessToken).toBeTruthy();
  });

  it("resolves local-development hostnames and ignores untrusted X-Forwarded-Host", async () => {
    const id = suffix();
    const school = await seedSchool(pools.owner, `local-${id}`, "Local School");
    const local = await app.request("/api/v1/public/tenant", {
      headers: { Host: `${school.slug}.localhost:3000` },
    });
    expect(local.status).toBe(200);

    const spoofed = await app.request("/api/v1/public/tenant", {
      headers: {
        Host: "localhost:3000",
        "X-Forwarded-Host": `${school.slug}.localhost:3000`,
      },
    });
    expect(spoofed.status).toBe(200);
    expect(((await spoofed.json()) as { kind: string }).kind).toBe("platform");

    const trustedApp = testApp(pools, { trustProxy: true });
    const forwarded = await trustedApp.request("/api/v1/public/tenant", {
      headers: {
        Host: "127.0.0.1:3000",
        "X-Forwarded-Host": `${school.slug}.localhost:3000`,
      },
    });
    expect(forwarded.status).toBe(200);
    expect(((await forwarded.json()) as { kind: string; organisation: { id: string } }).organisation.id).toBe(
      school.orgId,
    );
  });

  it("does not resolve unverified custom domains and does resolve verified active ones", async () => {
    const id = suffix();
    const school = await seedSchool(pools.owner, `custom-${id}`, "Custom School");
    const platformId = await insertUser(pools.owner, {
      email: `plat-host-${id}@example.com`,
      password: "platform-pass-1",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    void platformId;
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const platformToken = await login(app, `plat-host-${id}@example.com`, "platform-pass-1");
    const hostname = `portal-${id}.greenwoodacademy.org.uk`;

    const created = await app.request("/api/v1/organisation/hostnames", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
        Host: `${school.slug}.localhost:3000`,
      },
      body: JSON.stringify({ hostname }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string; verificationStatus: string; isActive: boolean };
    expect(createdBody.verificationStatus).toBe("pending");
    expect(createdBody.isActive).toBe(false);

    const pending = await app.request("/api/v1/public/tenant", {
      headers: { Host: hostname },
    });
    expect(pending.status).toBe(404);

    const otherSchool = await seedSchool(pools.owner, `customb-${id}`, "Other Custom");
    const otherAdmin = await login(app, otherSchool.adminEmail, "password-12x");
    const squat = await app.request("/api/v1/organisation/hostnames", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${otherAdmin}`,
        "Content-Type": "application/json",
        Host: `${otherSchool.slug}.localhost:3000`,
      },
      body: JSON.stringify({ hostname }),
    });
    expect(squat.status).toBe(201);
    const squatBody = (await squat.json()) as { id: string };

    const platformSubdomainCustom = await app.request("/api/v1/organisation/hostnames", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
        Host: `${school.slug}.localhost:3000`,
      },
      body: JSON.stringify({ hostname: `spoof.${school.slug}.localhost` }),
    });
    expect(platformSubdomainCustom.status).toBe(400);

    const prodApp = testApp(pools, { platformDomain: "schoolapp-domain.com" });
    const infraHost = await prodApp.request("/api/v1/organisation/hostnames", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
        Host: `${school.slug}.schoolapp-domain.com`,
      },
      body: JSON.stringify({ hostname: "portal.localhost" }),
    });
    expect(infraHost.status).toBe(400);

    const activateUnverified = await app.request(
      `/api/v1/platform/organisation-hostnames/${createdBody.id}/activate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${platformToken}`,
          Host: "localhost:3000",
        },
      },
    );
    expect(activateUnverified.status).toBe(409);

    const verifiedOnly = await app.request(
      `/api/v1/platform/organisation-hostnames/${createdBody.id}/verify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${platformToken}`,
          Host: "localhost:3000",
        },
      },
    );
    expect(verifiedOnly.status).toBe(200);

    const verifiedInactive = await app.request("/api/v1/public/tenant", {
      headers: { Host: hostname },
    });
    expect(verifiedInactive.status).toBe(404);

    const activated = await app.request(
      `/api/v1/platform/organisation-hostnames/${createdBody.id}/activate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${platformToken}`,
          Host: "localhost:3000",
        },
      },
    );
    expect(activated.status).toBe(200);

    const verified = await app.request("/api/v1/public/tenant", {
      headers: { Host: hostname },
    });
    expect(verified.status).toBe(200);
    const verifiedBody = (await verified.json()) as {
      kind: string;
      source: string;
      organisation: { id: string };
    };
    expect(verifiedBody.kind).toBe("school");
    expect(verifiedBody.source).toBe("custom_domain");
    expect(verifiedBody.organisation.id).toBe(school.orgId);

    const secondActivate = await app.request(
      `/api/v1/platform/organisation-hostnames/${squatBody.id}/activate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${platformToken}`,
          Host: "localhost:3000",
        },
      },
    );
    expect(secondActivate.status).toBe(409);

    const secondVerify = await app.request(
      `/api/v1/platform/organisation-hostnames/${squatBody.id}/verify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${platformToken}`,
          Host: "localhost:3000",
        },
      },
    );
    expect(secondVerify.status).toBe(200);
    const secondVerifiedActivate = await app.request(
      `/api/v1/platform/organisation-hostnames/${squatBody.id}/activate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${platformToken}`,
          Host: "localhost:3000",
        },
      },
    );
    expect(secondVerifiedActivate.status).toBe(409);
  });

  it("onboards a school transactionally and blocks public signup", async () => {
    const id = suffix();
    await insertUser(pools.owner, {
      email: `onboard-${id}@example.com`,
      password: "platform-pass-1",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    const token = await login(app, `onboard-${id}@example.com`, "platform-pass-1");
    const created = await app.request("/api/v1/platform/organisations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Host: "localhost:3000",
      },
      body: JSON.stringify({
        name: "Kingswood School",
        slug: `kingswood-${id}`,
        adminEmail: `head-${id}@example.com`,
        adminFullName: "Head Admin",
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { organisationId: string };
    const settings = await pools.owner.query(
      "select academic_year_start_month, locale from organisation_settings where organisation_id = $1",
      [createdBody.organisationId],
    );
    expect(settings.rows[0]?.academic_year_start_month).toBe(9);
    expect(settings.rows[0]?.locale).toBe("en-GB");
    const audit = await pools.owner.query(
      "select action from audit_events where organisation_id = $1 and action = 'platform.organisation.provisioned'",
      [createdBody.organisationId],
    );
    expect(audit.rowCount).toBe(1);

    const signup = await app.request("/api/v1/public/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost:3000" },
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(signup.status).toBe(403);
    expect(((await signup.json()) as { error: { code: string } }).error.code).toBe(
      "onboarding_public_disabled",
    );
  });

  it("does not let a retired slug be claimed by another organisation", async () => {
    const id = suffix();
    const school = await seedSchool(pools.owner, `oldslug-${id}`, "Old Slug School");
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const changed = await app.request("/api/v1/organisation/slug", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
        Host: `${school.slug}.localhost:3000`,
      },
      body: JSON.stringify({ slug: `newslug-${id}` }),
    });
    expect(changed.status).toBe(200);

    const oldHost = await app.request("/api/v1/public/tenant", {
      headers: { Host: `oldslug-${id}.localhost:3000` },
    });
    expect(oldHost.status).toBe(404);

    await insertUser(pools.owner, {
      email: `plat-slug-${id}@example.com`,
      password: "platform-pass-1",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    const platformToken = await login(app, `plat-slug-${id}@example.com`, "platform-pass-1");
    const reuse = await app.request("/api/v1/platform/organisations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${platformToken}`,
        "Content-Type": "application/json",
        Host: "localhost:3000",
      },
      body: JSON.stringify({
        name: "Takeover",
        slug: `oldslug-${id}`,
        adminEmail: `takeover-${id}@example.com`,
        adminFullName: "No",
      }),
    });
    expect(reuse.status).toBe(409);
  });

  it("does not treat school display name as tenant authority", async () => {
    const id = suffix();
    const school = await seedSchool(pools.owner, `visual-${id}`, "Greenwood Academy");
    const token = await login(app, school.adminEmail, "password-12x");
    const res = await app.request("/api/v1/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        Host: `${school.slug}.localhost:3000`,
      },
    });
    const body = (await res.json()) as { permissions: string[]; hostOrganisation: { name: string } };
    expect(body.hostOrganisation.name).toBe("Greenwood Academy");
    expect(body.permissions).toContain(PERMISSIONS.ORG_SETTINGS_READ);
  });

  it("keeps RLS tenant context after hostname routing", async () => {
    const id = suffix();
    const school = await seedSchool(pools.owner, `rls-${id}`, "RLS School");
    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const org = await client.query("select slug from organisations");
      expect(org.rows).toHaveLength(1);
      expect(org.rows[0]?.slug).toBe(school.slug);
    });
  });
});
