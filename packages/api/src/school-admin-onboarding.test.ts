import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ONBOARDING_WELCOME_PATH, PERMISSIONS, resolveStaffPostAuthPath } from "@schoolapp/domain";
import { closePools, withTenantContext } from "@schoolapp/db";
import { addMembership, ensureMigrated, insertUser, login, loginAlias, testApp, testPools } from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);

type OnboardingBody = {
  schoolName: string;
  progress: { currentStep: string; completedSteps: string[]; completedAt: string | null };
  readiness: { ready: boolean; items: Array<{ key: string; complete: boolean; required: boolean }> };
  setup: {
    status: "not_started" | "in_progress" | "completed";
    completedCount: number;
    totalSteps: number;
    percent: number;
    resumeStep: string;
    satisfiedSteps: string[];
    schoolName: string;
  };
  presentation: {
    automaticOnboardingDismissed: boolean;
    shouldAutoLaunch: boolean;
    showDashboardCard: boolean;
  };
};

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string, name = `Onboard ${id}`) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "School Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`onb-${id}`, name],
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
    name,
  };
}

async function seedExistingSchoolProgress(
  owner: ReturnType<typeof testPools>["owner"],
  orgId: string,
  label: string,
) {
  await owner.query("update organisations set name = $2, timezone = 'Europe/London' where id = $1", [orgId, label]);
  await owner.query(
    `update organisation_settings
     set tagline = 'Ambitious and kind', primary_colour = '#122C4A'
     where organisation_id = $1`,
    [orgId],
  );
  const year = await owner.query<{ id: string }>(
    `insert into academic_years (organisation_id, name, starts_on, ends_on, is_current)
     values ($1, '2026/27', '2026-09-01', '2027-07-31', true) returning id`,
    [orgId],
  );
  const group = await owner.query<{ id: string }>(
    `insert into year_groups (organisation_id, code, name, key_stage, sort_order)
     values ($1, '3', 'Year 3', 2, 3) returning id`,
    [orgId],
  );
  await owner.query(
    `insert into classes (organisation_id, academic_year_id, year_group_id, name, class_type)
     values ($1, $2, $3, '3A', 'form')`,
    [orgId, year.rows[0]!.id, group.rows[0]!.id],
  );
  await owner.query(
    `insert into subjects (organisation_id, key, name) values ($1, 'mathematics', 'Mathematics')`,
    [orgId],
  );
}

function jsonHeaders(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    "Content-Type": "application/json",
  };
}

describe("School Admin first-login onboarding", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("gives a new School Admin onboarding for incomplete setup", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, `New School ${id}`);
    const token = await login(app, school.adminEmail, "password-12x");
    const body = (await (await app.request("/api/v1/onboarding", { headers: jsonHeaders(token, school.orgId) })).json()) as OnboardingBody;
    expect(body.setup.schoolName).toBe(school.name);
    expect(body.setup.status).not.toBe("completed");
    expect(body.progress.completedAt).toBeNull();
    expect(body.presentation.shouldAutoLaunch).toBe(true);
    expect(body.presentation.showDashboardCard).toBe(true);
    expect(body.presentation.automaticOnboardingDismissed).toBe(false);
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: body.setup.status,
        automaticOnboardingDismissed: body.presentation.automaticOnboardingDismissed,
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);
  });

  it("shows an existing School Admin the welcome experience without hard-coded tenant data", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, `Existing Primary ${id}`);
    await seedExistingSchoolProgress(pools.owner, school.orgId, `Existing Primary ${id}`);
    const token = await login(app, school.adminEmail, "password-12x");
    const first = (await (
      await app.request("/api/v1/onboarding", { headers: jsonHeaders(token, school.orgId) })
    ).json()) as OnboardingBody;

    expect(first.setup.schoolName).toBe(`Existing Primary ${id}`);
    expect(first.setup.status).toBe("in_progress");
    expect(first.setup.completedCount).toBeGreaterThan(0);
    expect(first.setup.satisfiedSteps).toEqual(
      expect.arrayContaining(["school_details", "branding", "academic_year", "academic_structure"]),
    );
    expect(first.setup.resumeStep).not.toBe("school_details");
    expect(first.progress.completedAt).toBeNull();
    expect(first.presentation.shouldAutoLaunch).toBe(true);
    expect(first.presentation.showDashboardCard).toBe(true);

    const leave = await app.request("/api/v1/onboarding/progress", {
      method: "PATCH",
      headers: jsonHeaders(token, school.orgId),
      body: JSON.stringify({ currentStep: first.setup.resumeStep }),
    });
    expect(leave.status).toBe(200);
    const afterLeave = (await (
      await app.request("/api/v1/onboarding", { headers: jsonHeaders(token, school.orgId) })
    ).json()) as OnboardingBody;
    expect(afterLeave.setup.status).toBe("in_progress");
    expect(afterLeave.presentation.automaticOnboardingDismissed).toBe(false);
    expect(afterLeave.progress.completedAt).toBeNull();
    expect(afterLeave.setup.satisfiedSteps).toEqual(first.setup.satisfiedSteps);

    const saveLater = await app.request("/api/v1/onboarding/progress", {
      method: "PATCH",
      headers: jsonHeaders(token, school.orgId),
      body: JSON.stringify({ currentStep: "rooms", completedSteps: ["school_details", "branding"] }),
    });
    expect(saveLater.status).toBe(200);
    const saved = (await (
      await app.request("/api/v1/onboarding", { headers: jsonHeaders(token, school.orgId) })
    ).json()) as OnboardingBody;
    expect(saved.progress.currentStep).toBe("rooms");
    expect(saved.progress.completedSteps).toEqual(expect.arrayContaining(["school_details", "branding"]));
    expect(saved.setup.satisfiedSteps).toEqual(
      expect.arrayContaining(["school_details", "branding", "academic_year", "academic_structure"]),
    );
    expect(saved.presentation.shouldAutoLaunch).toBe(true);
    expect(saved.setup.status).toBe("in_progress");

    const dismiss = await app.request("/api/v1/onboarding/preference", {
      method: "PATCH",
      headers: jsonHeaders(token, school.orgId),
      body: JSON.stringify({ dismissAutomatic: true }),
    });
    expect(dismiss.status).toBe(200);

    const afterDismiss = (await (
      await app.request("/api/v1/onboarding", { headers: jsonHeaders(token, school.orgId) })
    ).json()) as OnboardingBody;
    expect(afterDismiss.presentation.automaticOnboardingDismissed).toBe(true);
    expect(afterDismiss.presentation.shouldAutoLaunch).toBe(false);
    expect(afterDismiss.presentation.showDashboardCard).toBe(false);
    expect(afterDismiss.setup.status).toBe("in_progress");
    expect(afterDismiss.progress.completedAt).toBeNull();
    expect(afterDismiss.setup.satisfiedSteps).toEqual(saved.setup.satisfiedSteps);
    expect(afterDismiss.progress.completedSteps).toEqual(saved.progress.completedSteps);
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: afterDismiss.setup.status,
        automaticOnboardingDismissed: true,
      }),
    ).toBe("/school");

    const secondAdminId = await insertUser(pools.owner, {
      email: `admin-b-${id}@example.com`,
      password: "password-12x",
      fullName: "Second Admin",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, secondAdminId, "school.admin");
    await pools.owner.query(
      "insert into staff_profiles (organisation_id, user_id, job_title) values ($1, $2, 'School Admin')",
      [school.orgId, secondAdminId],
    );
    const secondToken = await login(app, `admin-b-${id}@example.com`, "password-12x");
    const second = (await (
      await app.request("/api/v1/onboarding", { headers: jsonHeaders(secondToken, school.orgId) })
    ).json()) as OnboardingBody;
    expect(second.presentation.automaticOnboardingDismissed).toBe(false);
    expect(second.presentation.shouldAutoLaunch).toBe(true);
    expect(second.presentation.showDashboardCard).toBe(true);
    expect(second.setup.satisfiedSteps).toEqual(afterDismiss.setup.satisfiedSteps);
  });

  it("does not mark setup complete when required readiness is missing", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const premature = await app.request("/api/v1/onboarding/progress", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({
        currentStep: "completion",
        completedSteps: [
          "school_details",
          "branding",
          "academic_year",
          "academic_structure",
          "school_day",
          "rooms",
          "staff",
          "pupils",
          "portals",
          "completion",
        ],
        markComplete: true,
      }),
    });
    expect(premature.status).toBe(400);
    const body = (await (await app.request("/api/v1/onboarding", { headers: hdrs })).json()) as OnboardingBody;
    expect(body.progress.completedAt).toBeNull();
    expect(body.setup.status).not.toBe("completed");
    expect(body.presentation.shouldAutoLaunch).toBe(true);
  });

  it("marks setup completed only when readiness is satisfied and the admin finishes", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, `Ready School ${id}`);
    await seedExistingSchoolProgress(pools.owner, school.orgId, `Ready School ${id}`);
    await pools.owner.query(
      `insert into student_profiles (organisation_id, legal_name, admission_number)
       values ($1, 'Jordan Smith', $2)`,
      [school.orgId, `ADM-${id}`],
    );
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const before = (await (await app.request("/api/v1/onboarding", { headers: hdrs })).json()) as OnboardingBody;
    expect(before.readiness.ready).toBe(true);
    expect(before.setup.status).toBe("in_progress");

    const finish = await app.request("/api/v1/onboarding/progress", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ currentStep: "completion", markComplete: true, markReady: true }),
    });
    expect(finish.status).toBe(200);
    const done = (await (await app.request("/api/v1/onboarding", { headers: hdrs })).json()) as OnboardingBody;
    expect(done.setup.status).toBe("completed");
    expect(done.progress.completedAt).toBeTruthy();
    expect(done.presentation.shouldAutoLaunch).toBe(false);
    expect(done.presentation.showDashboardCard).toBe(false);
    const stillReadable = await app.request("/api/v1/onboarding", { headers: hdrs });
    expect(stillReadable.status).toBe(200);
    const profile = await app.request("/api/v1/onboarding/profile", { headers: hdrs });
    expect(profile.status).toBe(200);
  });

  it("does not launch School Admin onboarding for teachers, parents, students, or platform admins", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    const parentId = await insertUser(pools.owner, {
      email: `parent-${id}@example.com`,
      password: "password-12x",
      fullName: "Parent",
      kind: "parent",
    });
    await addMembership(pools.owner, school.orgId, parentId, "school.parent");
    const studentId = await insertUser(pools.owner, {
      email: `student-${id}@example.com`,
      password: "student-pass-1",
      fullName: "Student",
      kind: "student",
    });
    await addMembership(pools.owner, school.orgId, studentId, "school.student");
    const studentProfile = await pools.owner.query<{ id: string }>(
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
      [school.orgId, studentProfile.rows[0]!.id, year.rows[0]!.id, yearGroup.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into student_portal_policies (organisation_id, default_enabled)
       values ($1, true)
       on conflict (organisation_id) do update set default_enabled = true`,
      [school.orgId],
    );
    await pools.owner.query(
      "insert into user_login_aliases (organisation_id, user_id, alias) values ($1, $2, $3)",
      [school.orgId, studentId, `stu.${id}`],
    );
    await insertUser(pools.owner, {
      email: `platform-${id}@example.com`,
      password: "platform-pass-1",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });

    const teacherToken = await login(app, `teacher-${id}@example.com`, "password-12x");
    const parentToken = await login(app, `parent-${id}@example.com`, "password-12x");
    const studentToken = await loginAlias(app, school.slug, `stu.${id}`, "student-pass-1");
    const platformToken = await login(app, `platform-${id}@example.com`, "platform-pass-1");

    expect((await app.request("/api/v1/onboarding", { headers: jsonHeaders(teacherToken, school.orgId) })).status).toBe(403);
    expect((await app.request("/api/v1/onboarding/preference", {
      method: "PATCH",
      headers: jsonHeaders(teacherToken, school.orgId),
      body: JSON.stringify({ dismissAutomatic: true }),
    })).status).toBe(403);
    expect((await app.request("/api/v1/onboarding", { headers: jsonHeaders(parentToken, school.orgId) })).status).toBe(403);
    expect((await app.request("/api/v1/onboarding", { headers: jsonHeaders(studentToken, school.orgId) })).status).toBe(403);

    const platformMe = (await (
      await app.request("/api/v1/me", { headers: { Authorization: `Bearer ${platformToken}` } })
    ).json()) as { isPlatformAdmin: boolean; permissions: string[] };
    expect(platformMe.isPlatformAdmin).toBe(true);
    expect(platformMe.permissions ?? []).not.toContain(PERMISSIONS.ONBOARDING_MANAGE);
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: false,
        setupStatus: "not_started",
        automaticOnboardingDismissed: false,
      }),
    ).toBe("/school");
  });

  it("keeps tenant isolation for setup progress and per-admin dismissal", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, `School A ${id}`);
    const other = await createSchool(pools.owner, `${id}b`, `School B ${id}`);
    await seedExistingSchoolProgress(pools.owner, school.orgId, `School A ${id}`);
    const token = await login(app, school.adminEmail, "password-12x");
    const otherToken = await login(app, other.adminEmail, "password-12x");
    await app.request("/api/v1/onboarding", { headers: jsonHeaders(token, school.orgId) });
    await app.request("/api/v1/onboarding/preference", {
      method: "PATCH",
      headers: jsonHeaders(token, school.orgId),
      body: JSON.stringify({ dismissAutomatic: true }),
    });

    const cross = await app.request("/api/v1/onboarding", { headers: jsonHeaders(token, other.orgId) });
    expect([401, 403, 404]).toContain(cross.status);
    const otherView = (await (
      await app.request("/api/v1/onboarding", { headers: jsonHeaders(otherToken, other.orgId) })
    ).json()) as OnboardingBody;
    expect(otherView.presentation.automaticOnboardingDismissed).toBe(false);
    expect(otherView.setup.schoolName).toBe(other.name);

    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const leakedProgress = await client.query(
        "select organisation_id from organisation_setup_progress where organisation_id = $1",
        [other.orgId],
      );
      expect(leakedProgress.rows).toEqual([]);
      const leakedPref = await client.query(
        "select user_id from organisation_onboarding_preferences where organisation_id = $1",
        [other.orgId],
      );
      expect(leakedPref.rows).toEqual([]);
    });
  });

  it("does not let one School Admin change another admin's dismissal preference", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const otherAdminId = await insertUser(pools.owner, {
      email: `admin-c-${id}@example.com`,
      password: "password-12x",
      fullName: "Other Admin",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, otherAdminId, "school.admin");
    const token = await login(app, school.adminEmail, "password-12x");
    await app.request("/api/v1/onboarding/preference", {
      method: "PATCH",
      headers: jsonHeaders(token, school.orgId),
      body: JSON.stringify({ dismissAutomatic: true, userId: otherAdminId }),
    });
    await withTenantContext(pools.app, otherAdminId, school.orgId, async (client) => {
      const otherPref = await client.query(
        `select automatic_onboarding_dismissed_at
         from organisation_onboarding_preferences
         where organisation_id = $1 and user_id = $2`,
        [school.orgId, otherAdminId],
      );
      expect(otherPref.rows).toEqual([]);
    });
  });
});
