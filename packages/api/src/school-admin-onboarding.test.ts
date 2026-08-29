import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ONBOARDING_WELCOME_PATH,
  PERMISSIONS,
  onboardingWelcomeCopy,
  resolveStaffPostAuthPath,
  setupSidebarBadge,
} from "@schoolapp/domain";
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

const LEGACY_COMPLETED_AT = "2026-01-15T09:30:00.000Z";

async function markLegacySetupCompleted(
  owner: ReturnType<typeof testPools>["owner"],
  orgId: string,
  completedAt = LEGACY_COMPLETED_AT,
) {
  await owner.query(
    `insert into organisation_setup_progress (
       organisation_id, current_step, completed_steps, completed_at, ready_marked_at
     ) values ($1, 'completion', $2, $3::timestamptz, $3::timestamptz)
     on conflict (organisation_id) do update set
       current_step = excluded.current_step,
       completed_steps = excluded.completed_steps,
       completed_at = excluded.completed_at,
       ready_marked_at = excluded.ready_marked_at`,
    [
      orgId,
      ["school_details", "branding", "academic_year", "academic_structure", "completion"],
      completedAt,
    ],
  );
  return completedAt;
}

async function readCompletedAt(
  owner: ReturnType<typeof testPools>["owner"],
  orgId: string,
) {
  const row = await owner.query<{ completed_at: Date | string | null }>(
    "select completed_at from organisation_setup_progress where organisation_id = $1",
    [orgId],
  );
  const value = row.rows[0]?.completed_at ?? null;
  return value ? new Date(value).toISOString() : null;
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
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: first.setup.status,
        automaticOnboardingDismissed: first.presentation.automaticOnboardingDismissed,
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: first.setup.status,
        automaticOnboardingDismissed: false,
        requestedNext: "/school/dashboard",
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);

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
    expect(setupSidebarBadge({
      status: afterDismiss.setup.status,
      percent: afterDismiss.setup.percent,
      dismissed: true,
    })).toEqual({
      badge: `${afterDismiss.setup.percent}%`,
      badgeTone: "subtle",
      emphasis: false,
    });
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: afterDismiss.setup.status,
        automaticOnboardingDismissed: true,
      }),
    ).toBe("/school");
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: afterDismiss.setup.status,
        automaticOnboardingDismissed: true,
        requestedNext: "/school/dashboard",
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
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: second.setup.status,
        automaticOnboardingDismissed: false,
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);
  });

  it("sends a direct /login to welcome and preserves an explicit pupil deep link", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, `Login Route ${id}`);
    await seedExistingSchoolProgress(pools.owner, school.orgId, `Login Route ${id}`);
    const token = await login(app, school.adminEmail, "password-12x");
    const body = (await (
      await app.request("/api/v1/onboarding", { headers: jsonHeaders(token, school.orgId) })
    ).json()) as OnboardingBody;
    expect(body.presentation.shouldAutoLaunch).toBe(true);
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: body.setup.status,
        automaticOnboardingDismissed: false,
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: body.setup.status,
        automaticOnboardingDismissed: false,
        requestedNext: "/school/pupils/123",
      }),
    ).toBe("/school/pupils/123");
  });

  it("does not inflate factual progress when a step is only visited", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, `Visit Only ${id}`);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const before = (await (await app.request("/api/v1/onboarding", { headers: hdrs })).json()) as OnboardingBody;
    expect(before.setup.satisfiedSteps).not.toContain("academic_structure");
    const visit = await app.request("/api/v1/onboarding/progress", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({
        currentStep: "school_day",
        completedSteps: ["school_details", "branding", "academic_year", "academic_structure"],
      }),
    });
    expect(visit.status).toBe(200);
    const after = (await (await app.request("/api/v1/onboarding", { headers: hdrs })).json()) as OnboardingBody;
    expect(after.progress.completedSteps).toEqual(
      expect.arrayContaining(["school_details", "branding", "academic_year", "academic_structure"]),
    );
    expect(after.setup.satisfiedSteps).not.toContain("academic_structure");
    expect(after.setup.satisfiedSteps).not.toContain("branding");
    expect(after.setup.completedCount).toBe(before.setup.completedCount);
    expect(after.readiness.ready).toBe(false);
  });

  it("lets the first School Admin finish setup without pupils or extra staff", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, `Foundation ${id}`);
    await seedExistingSchoolProgress(pools.owner, school.orgId, `Foundation ${id}`);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const before = (await (await app.request("/api/v1/onboarding", { headers: hdrs })).json()) as OnboardingBody;
    expect(before.readiness.ready).toBe(true);
    expect(before.readiness.items.find((item) => item.key === "pupils")?.complete).toBe(false);
    expect(before.readiness.items.find((item) => item.key === "pupils")?.required).toBe(false);
    const finish = await app.request("/api/v1/onboarding/progress", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ currentStep: "completion", markComplete: true, markReady: true }),
    });
    expect(finish.status).toBe(200);
    const done = (await (await app.request("/api/v1/onboarding", { headers: hdrs })).json()) as OnboardingBody;
    expect(done.setup.status).toBe("completed");
    expect(done.progress.completedAt).toBeTruthy();
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
    expect(done.presentation.shouldAutoLaunch).toBe(true);
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

    const teacherView = (await (
      await app.request("/api/v1/onboarding", { headers: jsonHeaders(teacherToken, school.orgId) })
    ).json()) as OnboardingBody;
    expect(teacherView.presentation.shouldAutoLaunch).toBe(false);
    expect(teacherView.presentation.showDashboardCard).toBe(false);
    expect((await app.request("/api/v1/onboarding/preference", {
      method: "PATCH",
      headers: jsonHeaders(teacherToken, school.orgId),
      body: JSON.stringify({ dismissAutomatic: true }),
    })).status).toBe(403);
    expect((await app.request("/api/v1/onboarding/progress", {
      method: "PATCH",
      headers: jsonHeaders(teacherToken, school.orgId),
      body: JSON.stringify({ currentStep: "completion", markComplete: true }),
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

  it("shows a legacy completed school the welcome once without changing completed_at", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, `Kingswood School ${id}`);
    await seedExistingSchoolProgress(pools.owner, school.orgId, `Kingswood School ${id}`);
    const completedAt = await markLegacySetupCompleted(pools.owner, school.orgId);
    expect(await readCompletedAt(pools.owner, school.orgId)).toBe(new Date(completedAt).toISOString());

    const token = await login(app, school.adminEmail, "password-12x");
    const first = (await (
      await app.request("/api/v1/onboarding", { headers: jsonHeaders(token, school.orgId) })
    ).json()) as OnboardingBody;

    expect(first.setup.schoolName).toBe(`Kingswood School ${id}`);
    expect(first.setup.status).toBe("completed");
    expect(first.progress.completedAt).toBeTruthy();
    expect(new Date(first.progress.completedAt!).toISOString()).toBe(new Date(completedAt).toISOString());
    expect(first.presentation.automaticOnboardingDismissed).toBe(false);
    expect(first.presentation.shouldAutoLaunch).toBe(true);
    expect(first.presentation.showDashboardCard).toBe(false);
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: first.setup.status,
        automaticOnboardingDismissed: false,
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: first.setup.status,
        automaticOnboardingDismissed: false,
        requestedNext: "/school",
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);

    const copy = onboardingWelcomeCopy({
      schoolName: first.setup.schoolName,
      status: first.setup.status,
      completedCount: first.setup.completedCount,
      totalSteps: first.setup.totalSteps,
      currentStep: first.progress.currentStep,
      completedSteps: first.progress.completedSteps,
    });
    expect(copy.heading).toBe("Welcome to LuvLearn");
    expect(copy.title).toBe(`${first.setup.schoolName} is already set up.`);
    expect(copy.primaryLabel).toBe("Review School Setup");
    expect(copy.showProgress).toBe(false);
    expect(copy.completeBadge).toBe("School setup complete ✓");
    expect(copy.dismissLabel).toBe("Don't show this again");
    expect(`${copy.title} ${copy.lede} ${copy.primaryLabel}`.toLowerCase()).not.toContain("finish setting up");
    expect(copy.lede.toLowerCase()).not.toContain("continue setting up");

    expect(await readCompletedAt(pools.owner, school.orgId)).toBe(new Date(completedAt).toISOString());
    const prefsBeforeDismiss = await pools.owner.query(
      `select automatic_onboarding_dismissed_at
       from organisation_onboarding_preferences
       where organisation_id = $1 and user_id = $2`,
      [school.orgId, school.adminId],
    );
    expect(prefsBeforeDismiss.rows).toEqual([]);

    const afterDashboardOnly = (await (
      await app.request("/api/v1/onboarding", { headers: jsonHeaders(token, school.orgId) })
    ).json()) as OnboardingBody;
    expect(afterDashboardOnly.presentation.automaticOnboardingDismissed).toBe(false);
    expect(afterDashboardOnly.presentation.shouldAutoLaunch).toBe(true);
    expect(afterDashboardOnly.setup.status).toBe("completed");
    expect(new Date(afterDashboardOnly.progress.completedAt!).toISOString()).toBe(
      new Date(completedAt).toISOString(),
    );
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: afterDashboardOnly.setup.status,
        automaticOnboardingDismissed: false,
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);

    const dismiss = await app.request("/api/v1/onboarding/preference", {
      method: "PATCH",
      headers: jsonHeaders(token, school.orgId),
      body: JSON.stringify({ dismissAutomatic: true }),
    });
    expect(dismiss.status).toBe(200);
    expect(await readCompletedAt(pools.owner, school.orgId)).toBe(new Date(completedAt).toISOString());

    const afterDismiss = (await (
      await app.request("/api/v1/onboarding", { headers: jsonHeaders(token, school.orgId) })
    ).json()) as OnboardingBody;
    expect(afterDismiss.presentation.automaticOnboardingDismissed).toBe(true);
    expect(afterDismiss.presentation.shouldAutoLaunch).toBe(false);
    expect(afterDismiss.presentation.showDashboardCard).toBe(false);
    expect(afterDismiss.setup.status).toBe("completed");
    expect(new Date(afterDismiss.progress.completedAt!).toISOString()).toBe(new Date(completedAt).toISOString());
    expect(setupSidebarBadge({
      status: afterDismiss.setup.status,
      percent: afterDismiss.setup.percent,
      dismissed: true,
    })).toEqual({
      badge: null,
      badgeTone: "subtle",
      emphasis: false,
    });
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: afterDismiss.setup.status,
        automaticOnboardingDismissed: true,
      }),
    ).toBe("/school");
    expect(await readCompletedAt(pools.owner, school.orgId)).toBe(new Date(completedAt).toISOString());
    const prefsAfterDismiss = await pools.owner.query(
      `select automatic_onboarding_dismissed_at
       from organisation_onboarding_preferences
       where organisation_id = $1 and user_id = $2`,
      [school.orgId, school.adminId],
    );
    expect(prefsAfterDismiss.rows).toHaveLength(1);
    expect(prefsAfterDismiss.rows[0]?.automatic_onboarding_dismissed_at).toBeTruthy();
  });

  it("gives a new School Admin on a completed school the completed-school welcome once", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, `Completed Campus ${id}`);
    await seedExistingSchoolProgress(pools.owner, school.orgId, `Completed Campus ${id}`);
    const completedAt = await markLegacySetupCompleted(pools.owner, school.orgId);

    const newAdminId = await insertUser(pools.owner, {
      email: `admin-new-${id}@example.com`,
      password: "password-12x",
      fullName: "New School Admin",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, newAdminId, "school.admin");
    await pools.owner.query(
      "insert into staff_profiles (organisation_id, user_id, job_title) values ($1, $2, 'School Admin')",
      [school.orgId, newAdminId],
    );

    const token = await login(app, `admin-new-${id}@example.com`, "password-12x");
    const body = (await (
      await app.request("/api/v1/onboarding", { headers: jsonHeaders(token, school.orgId) })
    ).json()) as OnboardingBody;
    expect(body.setup.status).toBe("completed");
    expect(body.presentation.shouldAutoLaunch).toBe(true);
    expect(body.presentation.showDashboardCard).toBe(false);
    expect(body.presentation.automaticOnboardingDismissed).toBe(false);
    const copy = onboardingWelcomeCopy({
      schoolName: body.setup.schoolName,
      status: body.setup.status,
      completedCount: body.setup.completedCount,
      totalSteps: body.setup.totalSteps,
    });
    expect(copy.title).toBe(`${body.setup.schoolName} is already set up.`);
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: body.setup.status,
        automaticOnboardingDismissed: false,
      }),
    ).toBe(ONBOARDING_WELCOME_PATH);
    expect(await readCompletedAt(pools.owner, school.orgId)).toBe(new Date(completedAt).toISOString());
  });

  it("does not give a teacher the School Admin welcome on a completed school", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, `Teacher Campus ${id}`);
    await seedExistingSchoolProgress(pools.owner, school.orgId, `Teacher Campus ${id}`);
    await markLegacySetupCompleted(pools.owner, school.orgId);
    const teacherId = await insertUser(pools.owner, {
      email: `teacher-done-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    const teacherToken = await login(app, `teacher-done-${id}@example.com`, "password-12x");
    const teacherView = (await (
      await app.request("/api/v1/onboarding", { headers: jsonHeaders(teacherToken, school.orgId) })
    ).json()) as OnboardingBody;
    expect(teacherView.setup.status).toBe("completed");
    expect(teacherView.presentation.shouldAutoLaunch).toBe(false);
    expect(teacherView.presentation.showDashboardCard).toBe(false);
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: false,
        setupStatus: teacherView.setup.status,
        automaticOnboardingDismissed: false,
      }),
    ).toBe("/school");
  });

  it("preserves an explicit deep link on a completed school that has not dismissed welcome", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, `Deep Link Campus ${id}`);
    await seedExistingSchoolProgress(pools.owner, school.orgId, `Deep Link Campus ${id}`);
    await markLegacySetupCompleted(pools.owner, school.orgId);
    const token = await login(app, school.adminEmail, "password-12x");
    const body = (await (
      await app.request("/api/v1/onboarding", { headers: jsonHeaders(token, school.orgId) })
    ).json()) as OnboardingBody;
    expect(body.setup.status).toBe("completed");
    expect(body.presentation.shouldAutoLaunch).toBe(true);
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: body.setup.status,
        automaticOnboardingDismissed: false,
        requestedNext: "/school/pupils/123",
      }),
    ).toBe("/school/pupils/123");
    expect(
      resolveStaffPostAuthPath({
        canManageSetup: true,
        setupStatus: body.setup.status,
        automaticOnboardingDismissed: false,
        requestedNext: "/invite?token=abc",
      }),
    ).toBe("/invite?token=abc");
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
