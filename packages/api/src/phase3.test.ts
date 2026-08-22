import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withTenantContext } from "@schoolapp/db";
import {
  addMembership,
  assertPortalSafe,
  ensureMigrated,
  insertNotification,
  insertUser,
  login,
  loginAlias,
  testApp,
  testPools,
} from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string; name: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug, name",
    [`p3-${id}`, `Phase3 ${id}`],
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

describe("Phase 3 parent and student portals", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("lets a parent see authorised children only, including across schools, and hides sensitive fields", async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, `a-${id}`);
    const schoolB = await createSchool(pools.owner, `b-${id}`);
    const adminA = await login(app, schoolA.adminEmail, "password-12x");
    const adminB = await login(app, schoolB.adminEmail, "password-12x");
    const headersA = {
      Authorization: `Bearer ${adminA}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": schoolA.orgId,
    };
    const headersB = {
      Authorization: `Bearer ${adminB}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": schoolB.orgId,
    };

    await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        name: "2026/27",
        startsOn: "2026-09-01",
        endsOn: "2027-07-31",
        isCurrent: true,
      }),
    });
    await app.request("/api/v1/year-groups/seed", { method: "POST", headers: headersA, body: "{}" });
    const groups = (await (await app.request("/api/v1/year-groups", { headers: headersA })).json()) as {
      yearGroups: Array<{ id: string; code: string }>;
    };
    const year3 = groups.yearGroups.find((g) => g.code === "3")!;
    const years = (await (await app.request("/api/v1/academic-years", { headers: headersA })).json()) as {
      academicYears: Array<{ id: string }>;
    };
    const classA = (await (
      await app.request("/api/v1/classes", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          name: "3A",
          academicYearId: years.academicYears[0]!.id,
          yearGroupId: year3.id,
          classType: "form",
        }),
      })
    ).json()) as { class: { id: string } };

    const childA1 = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          legalName: "Alex Apple",
          preferredName: "Alex",
          academicYearId: years.academicYears[0]!.id,
          yearGroupId: year3.id,
          classId: classA.class.id,
        }),
      })
    ).json()) as { student: { id: string } };
    const childA2 = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({ legalName: "Blair Banana" }),
      })
    ).json()) as { student: { id: string } };
    const childB = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers: headersB,
        body: JSON.stringify({ legalName: "Casey Cherry" }),
      })
    ).json()) as { student: { id: string } };
    const stranger = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({ legalName: "Drew Date" }),
      })
    ).json()) as { student: { id: string } };

    const invite = (await (
      await app.request(`/api/v1/students/${childA1.student.id}/guardians`, {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          email: `parent-${id}@example.com`,
          fullName: "Pat Parent",
          relationship: "mother",
          hasParentalResponsibility: true,
        }),
      })
    ).json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: invite.invitationToken,
        fullName: "Pat Parent",
        password: "parent-pass-1",
      }),
    });
    await app.request(`/api/v1/students/${childA2.student.id}/guardians`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        email: `parent-${id}@example.com`,
        fullName: "Pat Parent",
        relationship: "mother",
        portalAccess: true,
      }),
    });
    await app.request(`/api/v1/students/${childB.student.id}/guardians`, {
      method: "POST",
      headers: headersB,
      body: JSON.stringify({
        email: `parent-${id}@example.com`,
        fullName: "Pat Parent",
        relationship: "mother",
      }),
    });

    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    const parentA = {
      Authorization: `Bearer ${parentToken}`,
      "X-Organisation-Id": schoolA.orgId,
    };
    const parentB = {
      Authorization: `Bearer ${parentToken}`,
      "X-Organisation-Id": schoolB.orgId,
    };

    const dashboardA = await app.request("/api/v1/parent/dashboard", { headers: parentA });
    expect(dashboardA.status).toBe(200);
    const dashA = (await dashboardA.json()) as {
      school: { name: string };
      children: Array<{ legalName: string; school: { name: string } }>;
      upcoming: { available: boolean };
    };
    assertPortalSafe(dashA);
    expect(dashA.school.name).toBe(schoolA.name);
    expect(dashA.children.map((c) => c.legalName).sort()).toEqual(["Alex Apple", "Blair Banana"]);
    expect(dashA.upcoming.available).toBe(false);
    expect(dashA.children.every((c) => c.school.name === schoolA.name)).toBe(true);

    const listB = await app.request("/api/v1/parent/children", { headers: parentB });
    expect(listB.status).toBe(200);
    const childrenB = (await listB.json()) as { children: Array<{ legalName: string }> };
    assertPortalSafe(childrenB);
    expect(childrenB.children.map((c) => c.legalName)).toEqual(["Casey Cherry"]);

    const own = await app.request(`/api/v1/parent/children/${childA1.student.id}`, {
      headers: parentA,
    });
    expect(own.status).toBe(200);
    const ownBody = (await own.json()) as {
      child: {
        legalName: string;
        displayName: string;
        currentYearGroupName: string | null;
        currentFormClassName: string | null;
        guardianship: { relationship: string; portalAccess: boolean };
      };
      sections: { attendance: { available: boolean } };
    };
    assertPortalSafe(ownBody);
    expect(ownBody.child.legalName).toBe("Alex Apple");
    expect(ownBody.child.displayName).toBe("Alex");
    expect(ownBody.child.currentYearGroupName).toBe("Year 3");
    expect(ownBody.child.currentFormClassName).toBe("3A");
    expect(ownBody.child.guardianship.relationship).toBe("mother");
    expect(ownBody.child.guardianship.portalAccess).toBe(true);
    expect(ownBody.sections.attendance.available).toBe(true);

    const classmate = await app.request(`/api/v1/parent/children/${stranger.student.id}`, {
      headers: parentA,
    });
    expect(classmate.status).toBe(404);

    const crossChild = await app.request(`/api/v1/parent/children/${childB.student.id}`, {
      headers: parentA,
    });
    expect(crossChild.status).toBe(404);

    const spoofOrg = await app.request("/api/v1/parent/children", {
      headers: {
        Authorization: `Bearer ${parentToken}`,
        "X-Organisation-Id": randomUUID(),
      },
    });
    expect(spoofOrg.status).toBe(403);

    const malformed = await app.request("/api/v1/parent/children/not-a-uuid", {
      headers: parentA,
    });
    expect(malformed.status).toBe(404);

    const staffApi = await app.request("/api/v1/students", { headers: parentA });
    expect(staffApi.status).toBe(403);
    const studentApi = await app.request("/api/v1/student/me", { headers: parentA });
    expect(studentApi.status).toBe(403);
  });

  it("hides children when portal_access is false even if parental responsibility is true", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const headers = {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": school.orgId,
    };
    const visible = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers,
        body: JSON.stringify({ legalName: "Visible" }),
      })
    ).json()) as { student: { id: string } };
    const hidden = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers,
        body: JSON.stringify({ legalName: "Hidden" }),
      })
    ).json()) as { student: { id: string } };
    const invite = (await (
      await app.request(`/api/v1/students/${visible.student.id}/guardians`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: `blocked-${id}@example.com`,
          fullName: "Blocked Parent",
          hasParentalResponsibility: true,
          portalAccess: true,
        }),
      })
    ).json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: invite.invitationToken,
        fullName: "Blocked Parent",
        password: "parent-pass-1",
      }),
    });
    await app.request(`/api/v1/students/${hidden.student.id}/guardians`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: `blocked-${id}@example.com`,
        fullName: "Blocked Parent",
        hasParentalResponsibility: true,
        portalAccess: false,
      }),
    });

    const parentToken = await login(app, `blocked-${id}@example.com`, "parent-pass-1");
    const parentHeaders = {
      Authorization: `Bearer ${parentToken}`,
      "X-Organisation-Id": school.orgId,
    };
    const list = (await (
      await app.request("/api/v1/parent/children", { headers: parentHeaders })
    ).json()) as { children: Array<{ legalName: string }> };
    expect(list.children.map((c) => c.legalName)).toEqual(["Visible"]);
    const hiddenDetail = await app.request(`/api/v1/parent/children/${hidden.student.id}`, {
      headers: parentHeaders,
    });
    expect(hiddenDetail.status).toBe(404);
    assertPortalSafe(list);
  });

  it("lets a student read only their own record and rejects spoofed school context", async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, `sa-${id}`);
    const schoolB = await createSchool(pools.owner, `sb-${id}`);
    const adminA = await login(app, schoolA.adminEmail, "password-12x");
    const adminB = await login(app, schoolB.adminEmail, "password-12x");
    const headersA = {
      Authorization: `Bearer ${adminA}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": schoolA.orgId,
    };
    const headersB = {
      Authorization: `Bearer ${adminB}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": schoolB.orgId,
    };

    await app.request("/api/v1/year-groups", {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({ code: "6", name: "Year 6", studentLoginEnabled: true }),
    });
    await app.request("/api/v1/year-groups", {
      method: "POST",
      headers: headersB,
      body: JSON.stringify({ code: "6", name: "Year 6", studentLoginEnabled: true }),
    });
    const groupsA = (await (await app.request("/api/v1/year-groups", { headers: headersA })).json()) as {
      yearGroups: Array<{ id: string; code: string }>;
    };
    const groupsB = (await (await app.request("/api/v1/year-groups", { headers: headersB })).json()) as {
      yearGroups: Array<{ id: string; code: string }>;
    };
    const yearA = (await (
      await app.request("/api/v1/academic-years", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          name: "2026/27",
          startsOn: "2026-09-01",
          endsOn: "2027-07-31",
          isCurrent: true,
        }),
      })
    ).json()) as { academicYear: { id: string } };
    const yearB = (await (
      await app.request("/api/v1/academic-years", {
        method: "POST",
        headers: headersB,
        body: JSON.stringify({
          name: "2026/27",
          startsOn: "2026-09-01",
          endsOn: "2027-07-31",
          isCurrent: true,
        }),
      })
    ).json()) as { academicYear: { id: string } };
    const y6a = groupsA.yearGroups.find((g) => g.code === "6")!;
    const y6b = groupsB.yearGroups.find((g) => g.code === "6")!;
    const classA = (await (
      await app.request("/api/v1/classes", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          name: "6B",
          academicYearId: yearA.academicYear.id,
          yearGroupId: y6a.id,
          classType: "form",
        }),
      })
    ).json()) as { class: { id: string } };

    const studentA = await app.request("/api/v1/students", {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        legalName: "Sam Student",
        preferredName: "Sam",
        academicYearId: yearA.academicYear.id,
        yearGroupId: y6a.id,
        classId: classA.class.id,
        loginAlias: `sam.${id}`,
        password: "student-pass-1",
      }),
    });
    expect(studentA.status).toBe(201);
    const studentB = await app.request("/api/v1/students", {
      method: "POST",
      headers: headersB,
      body: JSON.stringify({
        legalName: "Other Pupil",
        academicYearId: yearB.academicYear.id,
        yearGroupId: y6b.id,
        loginAlias: `sam.${id}`,
        password: "student-pass-2",
      }),
    });
    expect(studentB.status).toBe(201);
    const pupilB = (await studentB.json()) as { student: { id: string } };

    const token = await loginAlias(app, schoolA.slug, `sam.${id}`, "student-pass-1");
    const studentLogin = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationSlug: schoolA.slug,
        username: `sam.${id}`,
        password: "student-pass-1",
      }),
    });
    expect(studentLogin.status).toBe(200);
    const loginBody = (await studentLogin.json()) as { organisationId: string | null };
    expect(loginBody.organisationId).toBe(schoolA.orgId);
    const studentHeaders = {
      Authorization: `Bearer ${token}`,
      "X-Organisation-Id": schoolA.orgId,
    };

    const me = await app.request("/api/v1/student/me", { headers: studentHeaders });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as {
      student: {
        legalName: string;
        displayName: string;
        currentYearGroupName: string | null;
        currentFormClassName: string | null;
        school: { name: string };
      };
    };
    assertPortalSafe(meBody);
    expect(meBody.student.legalName).toBe("Sam Student");
    expect(meBody.student.displayName).toBe("Sam");
    expect(meBody.student.currentYearGroupName).toBe("Year 6");
    expect(meBody.student.currentFormClassName).toBe("6B");
    expect(meBody.student.school.name).toBe(schoolA.name);

    const dashboard = await app.request("/api/v1/student/dashboard", { headers: studentHeaders });
    expect(dashboard.status).toBe(200);
    const dash = (await dashboard.json()) as {
      welcome: { title: string };
      sections: { homework: { available: boolean } };
    };
    assertPortalSafe(dash);
    expect(dash.welcome.title).toContain("Sam");
    expect(dash.sections.homework.available).toBe(true);

    const spoofSchool = await app.request("/api/v1/student/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Organisation-Id": schoolB.orgId,
      },
    });
    expect(spoofSchool.status).toBe(403);

    const aliasOnB = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationSlug: schoolB.slug,
        username: `sam.${id}`,
        password: "student-pass-1",
      }),
    });
    expect(aliasOnB.status).toBe(401);

    const parentApi = await app.request("/api/v1/parent/children", { headers: studentHeaders });
    expect(parentApi.status).toBe(403);
    const staffList = await app.request("/api/v1/students", { headers: studentHeaders });
    expect(staffList.status).toBe(403);
    const otherPupil = await app.request(`/api/v1/parent/children/${pupilB.student.id}`, {
      headers: studentHeaders,
    });
    expect(otherPupil.status).toBe(403);
  });

  it("isolates notifications by recipient and organisation, returning 404 for foreign ids", async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, `na-${id}`);
    const schoolB = await createSchool(pools.owner, `nb-${id}`);
    const adminA = await login(app, schoolA.adminEmail, "password-12x");
    const adminB = await login(app, schoolB.adminEmail, "password-12x");
    const headersA = {
      Authorization: `Bearer ${adminA}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": schoolA.orgId,
    };
    const headersB = {
      Authorization: `Bearer ${adminB}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": schoolB.orgId,
    };

    const studentA = await app.request("/api/v1/students", {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({ legalName: "Notify Child A" }),
    });
    const pupilA = (await studentA.json()) as { student: { id: string } };
    const studentB = await app.request("/api/v1/students", {
      method: "POST",
      headers: headersB,
      body: JSON.stringify({ legalName: "Notify Child B" }),
    });
    const pupilB = (await studentB.json()) as { student: { id: string } };

    const inviteA = (await (
      await app.request(`/api/v1/students/${pupilA.student.id}/guardians`, {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          email: `nparent-a-${id}@example.com`,
          fullName: "Parent A",
        }),
      })
    ).json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: inviteA.invitationToken,
        fullName: "Parent A",
        password: "parent-pass-1",
      }),
    });
    const inviteB = (await (
      await app.request(`/api/v1/students/${pupilB.student.id}/guardians`, {
        method: "POST",
        headers: headersB,
        body: JSON.stringify({
          email: `nparent-b-${id}@example.com`,
          fullName: "Parent B",
        }),
      })
    ).json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: inviteB.invitationToken,
        fullName: "Parent B",
        password: "parent-pass-1",
      }),
    });
    await app.request(`/api/v1/students/${pupilB.student.id}/guardians`, {
      method: "POST",
      headers: headersB,
      body: JSON.stringify({
        email: `nparent-a-${id}@example.com`,
        fullName: "Parent A",
      }),
    });

    const tokenA = await login(app, `nparent-a-${id}@example.com`, "parent-pass-1");
    const tokenB = await login(app, `nparent-b-${id}@example.com`, "parent-pass-1");
    const meA = (await (
      await app.request("/api/v1/me", {
        headers: { Authorization: `Bearer ${tokenA}`, "X-Organisation-Id": schoolA.orgId },
      })
    ).json()) as { user: { id: string } };
    const meB = (await (
      await app.request("/api/v1/me", {
        headers: { Authorization: `Bearer ${tokenB}`, "X-Organisation-Id": schoolB.orgId },
      })
    ).json()) as { user: { id: string } };

    const noteA = await insertNotification(pools.owner, {
      organisationId: schoolA.orgId,
      recipientUserId: meA.user.id,
      type: "school_announcement",
      category: "announcement",
      title: "Term dates",
      body: "Term starts in September.",
      actionTarget: { resourceType: "announcement", resourceId: randomUUID() },
    });
    const noteB = await insertNotification(pools.owner, {
      organisationId: schoolB.orgId,
      recipientUserId: meB.user.id,
      title: "School B only",
      body: "Not visible in school A.",
    });
    const noteAForBParent = await insertNotification(pools.owner, {
      organisationId: schoolA.orgId,
      recipientUserId: meB.user.id,
      title: "Wrong recipient",
      body: "Parent B is not in school A.",
    });
    const noteAInB = await insertNotification(pools.owner, {
      organisationId: schoolB.orgId,
      recipientUserId: meA.user.id,
      title: "School B inbox",
      body: "Visible only when Parent A selects school B.",
    });

    const inboxA = await app.request("/api/v1/notifications", {
      headers: { Authorization: `Bearer ${tokenA}`, "X-Organisation-Id": schoolA.orgId },
    });
    expect(inboxA.status).toBe(200);
    const inboxABody = (await inboxA.json()) as {
      notifications: Array<{ id: string; title: string }>;
      unreadCount: number;
    };
    assertPortalSafe(inboxABody);
    expect(inboxABody.notifications.map((n) => n.id)).toEqual([noteA]);
    expect(inboxABody.notifications.map((n) => n.title)).toEqual(["Term dates"]);
    expect(inboxABody.unreadCount).toBe(1);
    expect(inboxABody.notifications.some((n) => n.id === noteB)).toBe(false);
    expect(inboxABody.notifications.some((n) => n.id === noteAForBParent)).toBe(false);

    const inboxAInB = await app.request("/api/v1/notifications", {
      headers: { Authorization: `Bearer ${tokenA}`, "X-Organisation-Id": schoolB.orgId },
    });
    expect(inboxAInB.status).toBe(200);
    const inboxAInBBody = (await inboxAInB.json()) as { notifications: Array<{ id: string }> };
    expect(inboxAInBBody.notifications.map((n) => n.id)).toEqual([noteAInB]);

    const crossUser = await app.request(`/api/v1/notifications/${noteA}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenB}`,
        "Content-Type": "application/json",
        "X-Organisation-Id": schoolB.orgId,
      },
      body: JSON.stringify({ read: true }),
    });
    expect(crossUser.status).toBe(404);

    const crossTenant = await app.request(`/api/v1/notifications/${noteB}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "Content-Type": "application/json",
        "X-Organisation-Id": schoolA.orgId,
      },
      body: JSON.stringify({ read: true }),
    });
    expect(crossTenant.status).toBe(404);

    const marked = await app.request(`/api/v1/notifications/${noteA}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "Content-Type": "application/json",
        "X-Organisation-Id": schoolA.orgId,
      },
      body: JSON.stringify({ read: true }),
    });
    expect(marked.status).toBe(200);
    const markedBody = (await marked.json()) as { notification: { readAt: string | null } };
    expect(markedBody.notification.readAt).toBeTruthy();

    const missingOrg = await app.request("/api/v1/notifications", {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(missingOrg.status).toBe(400);

    const badId = await app.request("/api/v1/notifications/not-a-uuid", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "Content-Type": "application/json",
        "X-Organisation-Id": schoolA.orgId,
      },
      body: JSON.stringify({ read: true }),
    });
    expect(badId.status).toBe(404);

    const spoof = await app.request("/api/v1/notifications", {
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "X-Organisation-Id": randomUUID(),
      },
    });
    expect(spoof.status).toBe(403);
  });

  it("keeps teacher assigned-only access unchanged while portals are available", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const headers = {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": school.orgId,
    };
    const year = (await (
      await app.request("/api/v1/academic-years", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "2026/27",
          startsOn: "2026-09-01",
          endsOn: "2027-07-31",
          isCurrent: true,
        }),
      })
    ).json()) as { academicYear: { id: string } };
    await app.request("/api/v1/year-groups/seed", { method: "POST", headers, body: "{}" });
    const groups = (await (await app.request("/api/v1/year-groups", { headers })).json()) as {
      yearGroups: Array<{ id: string; code: string }>;
    };
    const yg = groups.yearGroups.find((g) => g.code === "4")!;
    const classA = (await (
      await app.request("/api/v1/classes", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "4A",
          academicYearId: year.academicYear.id,
          yearGroupId: yg.id,
          classType: "form",
        }),
      })
    ).json()) as { class: { id: string } };
    const assigned = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers,
        body: JSON.stringify({
          legalName: "Assigned",
          academicYearId: year.academicYear.id,
          yearGroupId: yg.id,
          classId: classA.class.id,
        }),
      })
    ).json()) as { student: { id: string } };
    const other = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers,
        body: JSON.stringify({ legalName: "Unassigned" }),
      })
    ).json()) as { student: { id: string } };
    const teacher = (await (
      await app.request("/api/v1/staff", {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: `teach-${id}@example.com`,
          fullName: "Tina Teacher",
          roleKeys: ["school.teacher"],
        }),
      })
    ).json()) as { staffProfileId: string; invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: teacher.invitationToken,
        fullName: "Tina Teacher",
        password: "teacher-pass-1",
      }),
    });
    await app.request(`/api/v1/classes/${classA.class.id}/staff`, {
      method: "POST",
      headers,
      body: JSON.stringify({ staffProfileId: teacher.staffProfileId, assignmentRole: "form_tutor" }),
    });
    const teacherToken = await login(app, `teach-${id}@example.com`, "teacher-pass-1");
    const teacherHeaders = {
      Authorization: `Bearer ${teacherToken}`,
      "X-Organisation-Id": school.orgId,
    };
    const allowed = await app.request(`/api/v1/students/${assigned.student.id}`, {
      headers: teacherHeaders,
    });
    expect(allowed.status).toBe(200);
    const denied = await app.request(`/api/v1/students/${other.student.id}`, {
      headers: teacherHeaders,
    });
    expect(denied.status).toBe(404);
    const parentPortal = await app.request("/api/v1/parent/children", { headers: teacherHeaders });
    expect(parentPortal.status).toBe(403);
    const studentPortal = await app.request("/api/v1/student/me", { headers: teacherHeaders });
    expect(studentPortal.status).toBe(403);
    const inbox = await app.request("/api/v1/notifications", { headers: teacherHeaders });
    expect(inbox.status).toBe(200);
  });
});
