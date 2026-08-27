import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@schoolapp/domain";
import { closePools, withTenantContext } from "@schoolapp/db";
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
const NEUTRAL_RESET = "If an account exists, reset instructions have been generated.";

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string, prefix = "p20") {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`${prefix}-${id}`, `Phase20 ${id}`],
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

function jsonHeaders(token: string, orgId: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    "Content-Type": "application/json",
    ...extra,
  };
}

function tokenFromPath(text: string, path: string): string | null {
  const match = text.match(new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`));
  return match?.[1] ?? null;
}

describe("Phase 20 onboarding and account lifecycle", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("lets a new empty organisation complete setup without demo seed", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);

    const students = await app.request("/api/v1/students", { headers: hdrs });
    expect(students.status).toBe(200);
    expect(((await students.json()) as { students: unknown[] }).students).toEqual([]);

    const staff = await app.request("/api/v1/staff", { headers: hdrs });
    expect(staff.status).toBe(200);

    const onboarding = (await (await app.request("/api/v1/onboarding", { headers: hdrs })).json()) as {
      readiness: { ready: boolean; items: Array<{ key: string; status: string; required: boolean }> };
    };
    expect(onboarding.readiness.ready).toBe(false);
    expect(onboarding.readiness.items.find((item) => item.key === "pupils")?.status).toBe("needs_attention");
    expect(onboarding.readiness.items.find((item) => item.key === "branding")?.status).toBe("optional");

    const profile = await app.request("/api/v1/onboarding/profile", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({
        name: "Riverside Primary",
        schoolCode: "RIV1",
        timezone: "Europe/London",
        locale: "en-GB",
        defaultCurrency: "GBP",
        contactEmail: `office-${id}@school.example`,
      }),
    });
    expect(profile.status).toBe(200);

    const branding = await app.request("/api/v1/onboarding/branding", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({
        tagline: "Ambitious. Kind. Ready.",
        primaryColour: "#123456",
        accentColour: "#2b6cb0",
      }),
    });
    expect(branding.status).toBe(200);

    const publicTenant = await app.request("/api/v1/public/tenant", {
      headers: { Host: `${school.slug}.localhost:3000` },
    });
    expect(publicTenant.status).toBe(200);
    const tenantBody = (await publicTenant.json()) as {
      organisation: { branding: Record<string, unknown>; name: string };
    };
    expect(tenantBody.organisation.name).toBe("Riverside Primary");
    expect(tenantBody.organisation.branding.tagline).toBe("Ambitious. Kind. Ready.");
    expect(tenantBody.organisation.branding.primaryColor).toBe("#123456");
    expect(JSON.stringify(tenantBody)).not.toContain("storage_key");
    expect(JSON.stringify(tenantBody)).not.toContain("token_hash");
    assertPortalSafe(tenantBody);

    const year = (await (
      await app.request("/api/v1/academic-years", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "2026/27",
          startsOn: "2026-09-01",
          endsOn: "2027-07-31",
          isCurrent: true,
        }),
      })
    ).json()) as { academicYear: { id: string } };
    await app.request("/api/v1/year-groups/seed", { method: "POST", headers: hdrs, body: "{}" });
    const groups = (await (await app.request("/api/v1/year-groups", { headers: hdrs })).json()) as {
      yearGroups: Array<{ id: string; code: string }>;
    };
    const year3 = groups.yearGroups.find((g) => g.code === "3")!;
    await app.request("/api/v1/classes", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "3A",
        academicYearId: year.academicYear.id,
        yearGroupId: year3.id,
        classType: "form",
      }),
    });
    await app.request("/api/v1/subjects", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ key: "mathematics", name: "Mathematics" }),
    });
    await app.request("/api/v1/students", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ legalName: "Jordan Smith", admissionNumber: `ADM-${id}` }),
    });

    const ready = (await (await app.request("/api/v1/onboarding", { headers: hdrs })).json()) as {
      readiness: { ready: boolean };
    };
    expect(ready.readiness.ready).toBe(true);

    const progress = await app.request("/api/v1/onboarding/progress", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ currentStep: "completion", markComplete: true, markReady: true }),
    });
    expect(progress.status).toBe(200);
  });

  it("manages staff invitations, roles, suspend/reactivate, and blocks teachers from admin actions", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "staff");
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);

    const created = await app.request("/api/v1/staff", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `teacher-${id}@example.com`,
        fullName: "Terry Teacher",
        roleKeys: ["school.teacher"],
        jobTitle: "Class teacher",
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      staffProfileId: string;
      invitationToken: string;
    };
    expect(createdBody.invitationToken.length).toBeGreaterThan(20);

    const listed = (await (await app.request("/api/v1/staff", { headers: hdrs })).json()) as {
      staff: Array<{ id: string; accountStatus: string; pendingInvitation: boolean }>;
    };
    const row = listed.staff.find((item) => item.id === createdBody.staffProfileId);
    expect(row?.accountStatus).toBe("invite_pending");

    const accepted = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: createdBody.invitationToken,
        fullName: "Terry Teacher",
        password: "teacher-pass-1",
      }),
    });
    expect(accepted.status).toBe(200);
    const reuse = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: createdBody.invitationToken,
        fullName: "Terry Teacher",
        password: "teacher-pass-1",
      }),
    });
    expect([400, 404]).toContain(reuse.status);

    const missing = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        fullName: "Nobody",
        password: "teacher-pass-1",
      }),
    });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { message: string } }).error.message).toBe(
      "This link is invalid or has expired",
    );

    const teacherToken = await login(app, `teacher-${id}@example.com`, "teacher-pass-1");
    const teacherHdrs = jsonHeaders(teacherToken, school.orgId);
    const teacherMe = (await (await app.request("/api/v1/me", { headers: teacherHdrs })).json()) as {
      permissions: string[];
    };
    expect(teacherMe.permissions).not.toContain(PERMISSIONS.ONBOARDING_MANAGE);
    expect(teacherMe.permissions).not.toContain(PERMISSIONS.IMPORTS_MANAGE);
    expect(teacherMe.permissions).not.toContain(PERMISSIONS.ORG_MEMBERS_MANAGE);
    expect(teacherMe.permissions).not.toContain(PERMISSIONS.ORG_ROLES_MANAGE);

    const teacherImport = await app.request("/api/v1/imports/pupils", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({ csv: "legal_name\nA" }),
    });
    expect(teacherImport.status).toBe(403);

    const teacherProgress = await app.request("/api/v1/onboarding/progress", {
      method: "PATCH",
      headers: teacherHdrs,
      body: JSON.stringify({ currentStep: "completion", markComplete: true }),
    });
    expect(teacherProgress.status).toBe(403);

    const teacherTemplate = await app.request("/api/v1/imports/templates/pupils", { headers: teacherHdrs });
    expect(teacherTemplate.status).toBe(403);

    const teacherRoles = await app.request(`/api/v1/staff/${createdBody.staffProfileId}/roles`, {
      method: "PATCH",
      headers: teacherHdrs,
      body: JSON.stringify({ roleKeys: ["school.admin"] }),
    });
    expect(teacherRoles.status).toBe(403);

    const adminRoles = await app.request(`/api/v1/staff/${createdBody.staffProfileId}/roles`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ roleKeys: ["school.teacher", "school.staff"] }),
    });
    expect(adminRoles.status).toBe(200);

    const beforeSuspend = await app.request(`/api/v1/staff/${createdBody.staffProfileId}`, { headers: hdrs });
    expect(beforeSuspend.status).toBe(200);

    const suspend = await app.request(`/api/v1/staff/${createdBody.staffProfileId}/suspend`, {
      method: "POST",
      headers: hdrs,
    });
    expect(suspend.status).toBe(200);
    const afterSuspendRes = await app.request(`/api/v1/staff/${createdBody.staffProfileId}`, { headers: hdrs });
    expect(afterSuspendRes.status).toBe(200);
    const afterSuspend = (await afterSuspendRes.json()) as {
      staff: { accountStatus: string };
    };
    expect(afterSuspend.staff?.accountStatus).toBe("suspended");

    const listedAfter = (await (await app.request("/api/v1/staff", { headers: hdrs })).json()) as {
      staff: Array<{ id: string; accountStatus: string }>;
    };
    expect(listedAfter.staff.find((item) => item.id === createdBody.staffProfileId)?.accountStatus).toBe(
      "suspended",
    );

    const teacherAfterSuspend = await app.request("/api/v1/me", { headers: teacherHdrs });
    expect([401, 403]).toContain(teacherAfterSuspend.status);

    const reactivate = await app.request(`/api/v1/staff/${createdBody.staffProfileId}/reactivate`, {
      method: "POST",
      headers: hdrs,
    });
    expect(reactivate.status).toBe(200);
    await login(app, `teacher-${id}@example.com`, "teacher-pass-1");
  });

  it("keeps parent portalAccess fail-closed and never auto-links across organisations", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "par");
    const other = await createSchool(pools.owner, `${id}b`, "parb");
    const token = await login(app, school.adminEmail, "password-12x");
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const otherHdrs = jsonHeaders(otherToken, other.orgId);

    const pupil = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ legalName: "Child One" }),
      })
    ).json()) as { student: { id: string } };
    const omitted = await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `parent-omit-${id}@example.com`,
        fullName: "Omit Parent",
        relationship: "mother",
      }),
    });
    expect(omitted.status).toBe(201);
    const omittedBody = (await omitted.json()) as { guardianship: { portalAccess: boolean } };
    expect(omittedBody.guardianship.portalAccess).toBe(false);

    const explicitFalse = await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `parent-false-${id}@example.com`,
        fullName: "False Parent",
        relationship: "father",
        portalAccess: false,
      }),
    });
    expect(((await explicitFalse.json()) as { guardianship: { portalAccess: boolean } }).guardianship.portalAccess).toBe(
      false,
    );

    const enabled = await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `parent-on-${id}@example.com`,
        fullName: "On Parent",
        relationship: "carer",
        portalAccess: true,
      }),
    });
    const enabledBody = (await enabled.json()) as {
      invitationToken: string;
      guardianship: { id: string; portalAccess: boolean; accountStatus: string };
    };
    expect(enabledBody.guardianship.portalAccess).toBe(true);
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: enabledBody.invitationToken,
        fullName: "On Parent",
        password: "parent-pass-1",
      }),
    });
    const parentToken = await login(app, `parent-on-${id}@example.com`, "parent-pass-1");
    const children = await app.request("/api/v1/parent/children", {
      headers: jsonHeaders(parentToken, school.orgId),
    });
    expect(children.status).toBe(200);
    const childBody = await children.json();
    assertPortalSafe(childBody);

    const otherPupil = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers: otherHdrs,
        body: JSON.stringify({ legalName: "Other Child" }),
      })
    ).json()) as { student: { id: string } };
    const cross = await app.request(`/api/v1/students/${otherPupil.student.id}/guardians`, {
      method: "POST",
      headers: otherHdrs,
      body: JSON.stringify({
        email: `parent-on-${id}@example.com`,
        fullName: "On Parent",
        relationship: "mother",
        portalAccess: true,
      }),
    });
    expect(cross.status).toBe(201);
    const guardians = (await (await app.request("/api/v1/guardians", { headers: otherHdrs })).json()) as {
      guardians: Array<{ guardianEmail: string; portalAccess: boolean }>;
    };
    expect(guardians.guardians.some((g) => g.guardianEmail === `parent-on-${id}@example.com`)).toBe(true);

    const linkCross = await app.request(`/api/v1/students/${pupil.student.id}/guardians/link-existing`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ guardianUserId: school.adminId }),
    });
    expect([400, 404, 409]).toContain(linkCross.status);
  });

  it("creates student portal credentials with a one-time activation token", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "stu");
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "2026/27",
        startsOn: "2026-09-01",
        endsOn: "2027-07-31",
        isCurrent: true,
      }),
    });
    await app.request("/api/v1/year-groups/seed", { method: "POST", headers: hdrs, body: "{}" });
    const groups = (await (await app.request("/api/v1/year-groups", { headers: hdrs })).json()) as {
      yearGroups: Array<{ id: string; code: string }>;
    };
    const year3 = groups.yearGroups.find((g) => g.code === "3")!;
    await app.request(`/api/v1/year-groups/${year3.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ studentLoginEnabled: true }),
    });
    const years = (await (await app.request("/api/v1/academic-years", { headers: hdrs })).json()) as {
      academicYears: Array<{ id: string }>;
    };
    const pupil = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          legalName: "Student One",
          academicYearId: years.academicYears[0]!.id,
          yearGroupId: year3.id,
        }),
      })
    ).json()) as { student: { id: string } };

    const issued = await app.request(`/api/v1/students/${pupil.student.id}/portal-login`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ alias: `stu.${id}` }),
    });
    expect(issued.status).toBe(201);
    const issuedBody = (await issued.json()) as { activationToken: string; loginAlias: string };
    expect(issuedBody.loginAlias).toBe(`stu.${id}`);
    expect(JSON.stringify(issuedBody)).not.toContain("password_hash");

    const activated = await app.request("/api/v1/auth/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: issuedBody.activationToken, password: "student-pass-1" }),
    });
    expect(activated.status).toBe(200);
    const replay = await app.request("/api/v1/auth/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: issuedBody.activationToken, password: "student-pass-1" }),
    });
    expect([400, 404]).toContain(replay.status);

    const studentToken = await loginAlias(app, school.slug, `stu.${id}`, "student-pass-1");
    const me = await app.request("/api/v1/student/me", {
      headers: jsonHeaders(studentToken, school.orgId),
    });
    expect(me.status).toBe(200);
    assertPortalSafe(await me.json());
  });

  it("issues password resets with hashed single-use tokens and neutral copy", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "rst");
    const other = await createSchool(pools.owner, `${id}x`, "rstx");
    const host = `${school.slug}.localhost:3000`;

    const unknown = await app.request("/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: host },
      body: JSON.stringify({ email: `nobody-${id}@example.com` }),
    });
    expect(unknown.status).toBe(200);
    const unknownBody = (await unknown.json()) as { message: string };
    expect(unknownBody.message).toContain("If an account exists");

    const otherHost = await app.request("/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: `${other.slug}.localhost:3000` },
      body: JSON.stringify({ email: school.adminEmail }),
    });
    expect(otherHost.status).toBe(200);
    expect(((await otherHost.json()) as { message: string }).message).toContain("If an account exists");

    const forgot = await app.request("/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: host },
      body: JSON.stringify({ email: school.adminEmail }),
    });
    expect(forgot.status).toBe(200);
    expect(((await forgot.json()) as { message: string }).message).toBe(NEUTRAL_RESET);

    const adminToken = await login(app, school.adminEmail, "password-12x");
    const mail = (await (
      await app.request("/api/v1/onboarding/mail", { headers: jsonHeaders(adminToken, school.orgId) })
    ).json()) as { messages: Array<{ purpose: string; bodyText: string; toEmail: string }> };
    const resetMail = mail.messages.find((message) => message.purpose === "password_reset");
    expect(resetMail?.toEmail).toBe(school.adminEmail);
    expect(resetMail?.bodyText.toLowerCase()).not.toContain("password-12x");
    const resetToken = tokenFromPath(resetMail?.bodyText ?? "", "/reset-password");
    expect(resetToken).toBeTruthy();

    const hashes = await pools.owner.query("select token_hash from account_tokens where purpose = 'password_reset'");
    expect(hashes.rows.every((row) => row.token_hash !== resetToken)).toBe(true);

    const reset = await app.request("/api/v1/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resetToken, password: "password-99x" }),
    });
    expect(reset.status).toBe(200);
    await login(app, school.adminEmail, "password-99x");
    const reused = await app.request("/api/v1/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resetToken, password: "password-00x" }),
    });
    expect([400, 404]).toContain(reused.status);

    const expiredForgot = await app.request("/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: host },
      body: JSON.stringify({ email: school.adminEmail }),
    });
    expect(expiredForgot.status).toBe(200);
    const mail2 = (await (
      await app.request("/api/v1/onboarding/mail", {
        headers: jsonHeaders(await login(app, school.adminEmail, "password-99x"), school.orgId),
      })
    ).json()) as { messages: Array<{ purpose: string; bodyText: string }> };
    const nextToken = tokenFromPath(
      mail2.messages.find((message) => message.purpose === "password_reset")?.bodyText ?? "",
      "/reset-password",
    );
    await pools.owner.query(
      `update account_tokens
          set expires_at = now() - interval '1 minute'
        where token_hash = hash_invite_token($1)`,
      [nextToken],
    );
    const expired = await app.request("/api/v1/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: nextToken, password: "password-11x" }),
    });
    expect([400, 404]).toContain(expired.status);

    const bogus = await app.request("/api/v1/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "a".repeat(32), password: "password-11x" }),
    });
    expect([400, 404]).toContain(bogus.status);
  });

  it("validates imports, skips duplicates, isolates tenants, and rejects admin roles", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "imp");
    const other = await createSchool(pools.owner, `${id}o`, "impo");
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const otherHdrs = jsonHeaders(await login(app, other.adminEmail, "password-12x"), other.orgId);

    await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "2026/27",
        startsOn: "2026-09-01",
        endsOn: "2027-07-31",
        isCurrent: true,
      }),
    });
    await app.request("/api/v1/year-groups/seed", { method: "POST", headers: hdrs, body: "{}" });

    const template = await app.request("/api/v1/imports/templates/pupils", { headers: hdrs });
    expect(template.status).toBe(200);
    const csvText = await template.text();
    expect(csvText.startsWith("=")).toBe(false);

    const preview = await app.request("/api/v1/imports/pupils", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        csv: [
          "legal_name,preferred_name,date_of_birth,admission_number,academic_year,year_group,form_class,address_line1,address_town,address_postcode",
          `Jordan Smith,Jordan,2016-04-12,ADM-${id},2026/27,3,,1 High Street,London,SW1A 1AA`,
          ",,,,2026/27,3,,,,",
        ].join("\n"),
      }),
    });
    expect(preview.status).toBe(201);
    const previewBody = (await preview.json()) as {
      importId: string;
      validCount: number;
      errorCount: number;
      rows: Array<{ status: string }>;
    };
    expect(previewBody.validCount).toBe(1);
    expect(previewBody.errorCount).toBeGreaterThan(0);

    const confirm = await app.request(`/api/v1/imports/${previewBody.importId}/confirm`, {
      method: "POST",
      headers: hdrs,
    });
    expect(confirm.status).toBe(200);
    expect(((await confirm.json()) as { imported: number }).imported).toBe(1);

    const repeat = await app.request("/api/v1/imports/pupils", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        csv: [
          "legal_name,preferred_name,date_of_birth,admission_number,academic_year,year_group,form_class,address_line1,address_town,address_postcode",
          `Jordan Smith,Jordan,2016-04-12,ADM-${id},2026/27,3,,1 High Street,London,SW1A 1AA`,
        ].join("\n"),
      }),
    });
    const repeatBody = (await repeat.json()) as { duplicateCount: number; validCount: number };
    expect(repeatBody.duplicateCount).toBe(1);
    expect(repeatBody.validCount).toBe(0);

    const otherPeek = await app.request(`/api/v1/imports/${previewBody.importId}`, { headers: otherHdrs });
    expect(otherPeek.status).toBe(404);

    const adminImport = await app.request("/api/v1/imports/staff", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        csv: "full_name,email,job_title,role\nBoss,boss@school.example,Head,school.admin",
      }),
    });
    const adminBody = (await adminImport.json()) as { rows: Array<{ status: string; issues: Array<{ code: string }> }> };
    expect(adminBody.rows[0]?.status).toBe("error");
  });

  it("keeps FORCE RLS on onboarding, mail, import, and token tables", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "rls");
    const other = await createSchool(pools.owner, `${id}x`, "rlsx");
    const token = await login(app, school.adminEmail, "password-12x");
    await app.request("/api/v1/onboarding", { headers: jsonHeaders(token, school.orgId) });
    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const leakedProgress = await client.query(
        "select organisation_id from organisation_setup_progress where organisation_id = $1",
        [other.orgId],
      );
      expect(leakedProgress.rows).toEqual([]);
      const leakedMail = await client.query("select id from mail_outbox where organisation_id = $1", [other.orgId]);
      expect(leakedMail.rows).toEqual([]);
      const leakedImports = await client.query("select id from data_imports where organisation_id = $1", [other.orgId]);
      expect(leakedImports.rows).toEqual([]);
      const leakedTokens = await client.query("select id from account_tokens where organisation_id = $1", [
        other.orgId,
      ]);
      expect(leakedTokens.rows).toEqual([]);
    });
  });
});
