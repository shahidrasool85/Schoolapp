import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS, seedYearGroupsMessage } from "@schoolapp/domain";
import { closePools } from "@schoolapp/db";
import { addMembership, ensureMigrated, insertUser, login, testApp, testPools } from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`sux-${id}`, `Setup UX ${id}`],
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

describe("School setup UX hotfix", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("lets School Admin seed standard year groups and does not duplicate on repeat", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);

    const first = await app.request("/api/v1/year-groups/seed", {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      created: number;
      yearGroups: Array<{ code: string }>;
    };
    expect(firstBody.created).toBeGreaterThan(0);
    expect(seedYearGroupsMessage(firstBody.created)).toBe("Standard year groups created");
    expect(firstBody.yearGroups.some((group) => group.code === "R")).toBe(true);
    const firstCount = firstBody.yearGroups.length;

    const second = await app.request("/api/v1/year-groups/seed", {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      created: number;
      yearGroups: Array<{ code: string }>;
    };
    expect(secondBody.created).toBe(0);
    expect(seedYearGroupsMessage(secondBody.created)).toBe("Standard year groups are already set up");
    expect(secondBody.yearGroups).toHaveLength(firstCount);
  });

  it("rejects invalid branding hex and saves valid colours for School Admin", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);

    const invalid = await app.request("/api/v1/onboarding/branding", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ primaryColour: "navy", accentColour: "#2B78C9" }),
    });
    expect(invalid.status).toBe(400);

    const valid = await app.request("/api/v1/onboarding/branding", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({
        tagline: "Ready to learn",
        primaryColour: "#122C4A",
        accentColour: "#2B78C9",
      }),
    });
    expect(valid.status).toBe(200);
    const profile = (await (await app.request("/api/v1/onboarding/profile", { headers: hdrs })).json()) as {
      profile: { branding: { primaryColor: string; accentColor: string; tagline: string | null } };
    };
    expect(profile.profile.branding.primaryColor).toBe("#122C4A");
    expect(profile.profile.branding.accentColor).toBe("#2B78C9");
    expect(profile.profile.branding.tagline).toBe("Ready to learn");
  });

  it("lets School Admin jump setup progress without granting teachers new privileges", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const adminHdrs = jsonHeaders(adminToken, school.orgId);

    const progress = await app.request("/api/v1/onboarding/progress", {
      method: "PATCH",
      headers: adminHdrs,
      body: JSON.stringify({ currentStep: "branding" }),
    });
    expect(progress.status).toBe(200);
    const onboarding = (await (await app.request("/api/v1/onboarding", { headers: adminHdrs })).json()) as {
      progress: { currentStep: string };
      readiness: { items: Array<{ key: string; href: string }> };
    };
    expect(onboarding.progress.currentStep).toBe("branding");
    expect(onboarding.readiness.items.find((item) => item.key === "school_profile")?.href).toBe(
      "/school/setup?step=school_details",
    );
    expect(onboarding.readiness.items.find((item) => item.key === "branding")?.href).toBe(
      "/school/setup?step=branding",
    );

    const invited = await app.request("/api/v1/staff", {
      method: "POST",
      headers: adminHdrs,
      body: JSON.stringify({
        email: `teacher-${id}@example.com`,
        fullName: "Terry Teacher",
        roleKeys: ["school.teacher"],
      }),
    });
    expect(invited.status).toBe(201);
    const invitedBody = (await invited.json()) as { invitationToken: string };
    const accepted = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: invitedBody.invitationToken,
        fullName: "Terry Teacher",
        password: "teacher-pass-1",
      }),
    });
    expect(accepted.status).toBe(200);

    const teacherToken = await login(app, `teacher-${id}@example.com`, "teacher-pass-1");
    const teacherHdrs = jsonHeaders(teacherToken, school.orgId);
    const teacherMe = (await (await app.request("/api/v1/me", { headers: teacherHdrs })).json()) as {
      permissions: string[];
    };
    expect(teacherMe.permissions).not.toContain(PERMISSIONS.ONBOARDING_MANAGE);
    expect(teacherMe.permissions).not.toContain(PERMISSIONS.IMPORTS_MANAGE);
    expect(teacherMe.permissions).not.toContain(PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);

    const teacherSeed = await app.request("/api/v1/year-groups/seed", {
      method: "POST",
      headers: teacherHdrs,
      body: "{}",
    });
    expect(teacherSeed.status).toBe(403);

    const teacherProgress = await app.request("/api/v1/onboarding/progress", {
      method: "PATCH",
      headers: teacherHdrs,
      body: JSON.stringify({ currentStep: "completion" }),
    });
    expect(teacherProgress.status).toBe(403);

    const teacherBranding = await app.request("/api/v1/onboarding/branding", {
      method: "PATCH",
      headers: teacherHdrs,
      body: JSON.stringify({ primaryColour: "#000000" }),
    });
    expect(teacherBranding.status).toBe(403);
  });

  it("leaves Phase 21 finance routes available to School Admin", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const settings = await app.request("/api/v1/finance/settings", { headers: hdrs });
    expect(settings.status).toBe(200);
    const schedules = await app.request("/api/v1/finance/fee-schedules", { headers: hdrs });
    expect(schedules.status).toBe(200);
    const invoices = await app.request("/api/v1/finance/invoices", { headers: hdrs });
    expect(invoices.status).toBe(200);
  });
});
