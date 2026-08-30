import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@schoolapp/domain";
import { closePools, withTenantContext } from "@schoolapp/db";
import {
  addMembership,
  ensureMigrated,
  insertUser,
  login,
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
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`p2-${id}`, `Phase2 ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [
    org.rows[0]!.id,
  ]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return { adminId, orgId: org.rows[0]!.id, slug: org.rows[0]!.slug, adminEmail: `admin-${id}@example.com` };
}

describe("Phase 2 people and school structure", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("creates academic structure, students, staff, and parent links through /api/v1", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": school.orgId,
    };

    const year = await app.request("/api/v1/academic-years", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "2026/27",
        startsOn: "2026-09-01",
        endsOn: "2027-07-31",
        isCurrent: true,
      }),
    });
    expect(year.status).toBe(201);
    const yearBody = (await year.json()) as { academicYear: { id: string } };

    const seed = await app.request("/api/v1/year-groups/seed", { method: "POST", headers, body: "{}" });
    expect(seed.status).toBe(200);
    const groups = (await seed.json()) as { yearGroups: Array<{ id: string; code: string }> };
    const year3 = groups.yearGroups.find((g) => g.code === "3");
    expect(year3).toBeTruthy();

    const subject = await app.request("/api/v1/subjects", {
      method: "POST",
      headers,
      body: JSON.stringify({ key: "mathematics", name: "Mathematics" }),
    });
    expect(subject.status).toBe(201);
    const subjectBody = (await subject.json()) as { subject: { id: string } };

    const cls = await app.request("/api/v1/classes", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "3A",
        academicYearId: yearBody.academicYear.id,
        yearGroupId: year3!.id,
        classType: "form",
      }),
    });
    expect(cls.status).toBe(201);
    const classBody = (await cls.json()) as { class: { id: string } };

    await app.request(`/api/v1/classes/${classBody.class.id}/subjects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subjectId: subjectBody.subject.id }),
    });

    const staff = await app.request("/api/v1/staff", {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: `teacher-${id}@example.com`,
        fullName: "Terry Teacher",
        roleKeys: ["school.teacher"],
        jobTitle: "Class teacher",
      }),
    });
    expect(staff.status).toBe(201);
    const staffBody = (await staff.json()) as {
      staffProfileId: string;
      invitationToken: string;
    };

    const accepted = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: staffBody.invitationToken,
        fullName: "Terry Teacher",
        password: "teacher-pass-1",
      }),
    });
    expect(accepted.status).toBe(200);

    const assigned = await app.request(`/api/v1/classes/${classBody.class.id}/staff`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        staffProfileId: staffBody.staffProfileId,
        assignmentRole: "form_tutor",
      }),
    });
    expect(assigned.status).toBe(201);

    const student = await app.request("/api/v1/students", {
      method: "POST",
      headers,
      body: JSON.stringify({
        legalName: "Sam Student",
        admissionNumber: `ADM-${id}`,
        academicYearId: yearBody.academicYear.id,
        yearGroupId: year3!.id,
        classId: classBody.class.id,
      }),
    });
    expect(student.status).toBe(201);
    const studentBody = (await student.json()) as {
      student: { id: string; currentYearGroupName: string; currentFormClassName: string };
    };
    expect(studentBody.student.currentYearGroupName).toBe("Year 3");
    expect(studentBody.student.currentFormClassName).toBe("3A");

    const guardian = await app.request(`/api/v1/students/${studentBody.student.id}/guardians`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: `parent-${id}@example.com`,
        fullName: "Pat Parent",
        relationship: "mother",
        hasParentalResponsibility: true,
        portalAccess: true,
      }),
    });
    expect(guardian.status).toBe(201);
    const guardianBody = (await guardian.json()) as { invitationToken: string };
    const parentAccept = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: guardianBody.invitationToken,
        fullName: "Pat Parent",
        password: "parent-pass-1",
      }),
    });
    expect(parentAccept.status).toBe(200);

    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    const children = await app.request("/api/v1/parent/children", {
      headers: { Authorization: `Bearer ${parentToken}`, "X-Organisation-Id": school.orgId },
    });
    expect(children.status).toBe(200);
    const childrenBody = (await children.json()) as { children: Array<{ legalName: string }> };
    expect(childrenBody.children.map((c) => c.legalName)).toEqual(["Sam Student"]);
    expect(JSON.stringify(childrenBody)).not.toContain("restricted");
  });

  it("returns 404 for cross-tenant student ids and ignores spoofed organisation headers", async () => {
    const id = suffix();
    const a = await createSchool(pools.owner, `a-${id}`);
    const b = await createSchool(pools.owner, `b-${id}`);
    const tokenA = await login(app, a.adminEmail, "password-12x");
    const tokenB = await login(app, b.adminEmail, "password-12x");

    const createdB = await app.request("/api/v1/students", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenB}`,
        "Content-Type": "application/json",
        "X-Organisation-Id": b.orgId,
      },
      body: JSON.stringify({ legalName: "Pupil B" }),
    });
    const pupilB = (await createdB.json()) as { student: { id: string } };

    const spoof = await app.request(`/api/v1/students/${pupilB.student.id}`, {
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "X-Organisation-Id": b.orgId,
      },
    });
    expect(spoof.status).toBe(403);

    const cross = await app.request(`/api/v1/students/${pupilB.student.id}`, {
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "X-Organisation-Id": a.orgId,
      },
    });
    expect(cross.status).toBe(404);
  });

  it("restricts teachers to assigned pupils and parents to their own children", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const headers = {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": school.orgId,
    };

    const year = await (
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
    ).json() as { academicYear: { id: string } };
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

    const assignedPupil = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers,
        body: JSON.stringify({
          legalName: "Assigned Pupil",
          academicYearId: year.academicYear.id,
          yearGroupId: yg.id,
          classId: classA.class.id,
        }),
      })
    ).json()) as { student: { id: string } };
    const otherPupil = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers,
        body: JSON.stringify({ legalName: "Other Pupil" }),
      })
    ).json()) as { student: { id: string } };

    const teacher = (await (
      await app.request("/api/v1/staff", {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: `t-${id}@example.com`,
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

    const teacherToken = await login(app, `t-${id}@example.com`, "teacher-pass-1");
    const teacherHeaders = {
      Authorization: `Bearer ${teacherToken}`,
      "X-Organisation-Id": school.orgId,
    };
    const list = await app.request("/api/v1/students", { headers: teacherHeaders });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { students: Array<{ legalName: string }> };
    expect(listBody.students.map((s) => s.legalName)).toEqual(["Assigned Pupil"]);

    const allowed = await app.request(`/api/v1/students/${assignedPupil.student.id}`, {
      headers: teacherHeaders,
    });
    expect(allowed.status).toBe(200);
    const denied = await app.request(`/api/v1/students/${otherPupil.student.id}`, {
      headers: teacherHeaders,
    });
    expect(denied.status).toBe(404);

    const parent = (await (
      await app.request(`/api/v1/students/${assignedPupil.student.id}/guardians`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: `p-${id}@example.com`,
          fullName: "Parent One",
          relationship: "father",
          portalAccess: true,
        }),
      })
    ).json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: parent.invitationToken,
        fullName: "Parent One",
        password: "parent-pass-1",
      }),
    });
    const parentToken = await login(app, `p-${id}@example.com`, "parent-pass-1");
    const parentHeaders = {
      Authorization: `Bearer ${parentToken}`,
      "X-Organisation-Id": school.orgId,
    };
    const own = await app.request(`/api/v1/parent/children/${assignedPupil.student.id}`, {
      headers: parentHeaders,
    });
    expect(own.status).toBe(200);
    const classmate = await app.request(`/api/v1/parent/children/${otherPupil.student.id}`, {
      headers: parentHeaders,
    });
    expect(classmate.status).toBe(404);
    const staffList = await app.request("/api/v1/students", { headers: parentHeaders });
    expect(staffList.status).toBe(403);
  });

  it("keeps historical enrolments and class memberships when a pupil moves", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": school.orgId,
    };
    const yearOne = (await (
      await app.request("/api/v1/academic-years", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "2025/26",
          startsOn: "2025-09-01",
          endsOn: "2026-07-31",
          isCurrent: true,
        }),
      })
    ).json()) as { academicYear: { id: string } };
    await app.request("/api/v1/year-groups/seed", { method: "POST", headers, body: "{}" });
    const groups = (await (await app.request("/api/v1/year-groups", { headers })).json()) as {
      yearGroups: Array<{ id: string; code: string }>;
    };
    const y3 = groups.yearGroups.find((g) => g.code === "3")!;
    const y4 = groups.yearGroups.find((g) => g.code === "4")!;
    const classA = (await (
      await app.request("/api/v1/classes", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "3A",
          academicYearId: yearOne.academicYear.id,
          yearGroupId: y3.id,
          classType: "form",
        }),
      })
    ).json()) as { class: { id: string } };
    const classB = (await (
      await app.request("/api/v1/classes", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "3B",
          academicYearId: yearOne.academicYear.id,
          yearGroupId: y3.id,
          classType: "form",
        }),
      })
    ).json()) as { class: { id: string } };

    const student = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers,
        body: JSON.stringify({
          legalName: "Moving Pupil",
          academicYearId: yearOne.academicYear.id,
          yearGroupId: y3.id,
          classId: classA.class.id,
        }),
      })
    ).json()) as { student: { id: string } };

    const moved = await app.request(`/api/v1/students/${student.student.id}/class-memberships`, {
      method: "POST",
      headers,
      body: JSON.stringify({ classId: classB.class.id, startedOn: "2026-01-12" }),
    });
    expect(moved.status).toBe(201);

    const yearTwo = (await (
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
    const next = await app.request(`/api/v1/students/${student.student.id}/enrolments`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        academicYearId: yearTwo.academicYear.id,
        yearGroupId: y4.id,
        startedOn: "2026-09-01",
      }),
    });
    expect(next.status).toBe(201);

    const detail = await app.request(`/api/v1/students/${student.student.id}`, { headers });
    const body = (await detail.json()) as {
      student: { currentYearGroupName: string | null };
      enrolments: Array<{ academicYearName: string | null; yearGroupName: string | null; endedOn: string | null }>;
      classMemberships: Array<{ className: string; endedOn: string | null }>;
    };
    expect(body.student.currentYearGroupName).toBe("Year 4");
    expect(body.enrolments.some((e) => e.academicYearName === "2025/26" && e.yearGroupName === "Year 3")).toBe(
      true,
    );
    const yearOneEnrolment = body.enrolments.find(
      (e) => e.academicYearName === "2025/26" && e.yearGroupName === "Year 3",
    );
    expect(yearOneEnrolment?.endedOn).toBe("2026-09-01");
    const yearTwoEnrolment = body.enrolments.find(
      (e) => e.academicYearName === "2026/27" && e.yearGroupName === "Year 4",
    );
    expect(yearTwoEnrolment?.endedOn).toBeNull();
    const formA = body.classMemberships.find((m) => m.className === "3A");
    const formB = body.classMemberships.find((m) => m.className === "3B");
    expect(formA?.endedOn).toBe("2026-01-12");
    expect(formB?.endedOn).toBe("2026-09-01");
  });

  it("scopes parent children to the requested organisation and keeps student login org-scoped", async () => {
    const id = suffix();
    const a = await createSchool(pools.owner, `pa-${id}`);
    const b = await createSchool(pools.owner, `pb-${id}`);
    const tokenA = await login(app, a.adminEmail, "password-12x");
    const tokenB = await login(app, b.adminEmail, "password-12x");
    const headersA = {
      Authorization: `Bearer ${tokenA}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": a.orgId,
    };
    const headersB = {
      Authorization: `Bearer ${tokenB}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": b.orgId,
    };

    const childA = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({ legalName: "Child A" }),
      })
    ).json()) as { student: { id: string } };
    const childB = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers: headersB,
        body: JSON.stringify({ legalName: "Child B" }),
      })
    ).json()) as { student: { id: string } };

    const inviteA = (await (
      await app.request(`/api/v1/students/${childA.student.id}/guardians`, {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          email: `multi-${id}@example.com`,
          fullName: "Multi Parent",
          relationship: "mother",
          portalAccess: true,
        }),
      })
    ).json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: inviteA.invitationToken,
        fullName: "Multi Parent",
        password: "parent-pass-1",
      }),
    });
    await app.request(`/api/v1/students/${childB.student.id}/guardians`, {
      method: "POST",
      headers: headersB,
      body: JSON.stringify({
        email: `multi-${id}@example.com`,
        fullName: "Multi Parent",
        relationship: "mother",
        portalAccess: true,
      }),
    });

    const parentToken = await login(app, `multi-${id}@example.com`, "parent-pass-1");
    const inA = (await (
      await app.request("/api/v1/parent/children", {
        headers: { Authorization: `Bearer ${parentToken}`, "X-Organisation-Id": a.orgId },
      })
    ).json()) as { children: Array<{ legalName: string }> };
    const inB = (await (
      await app.request("/api/v1/parent/children", {
        headers: { Authorization: `Bearer ${parentToken}`, "X-Organisation-Id": b.orgId },
      })
    ).json()) as { children: Array<{ legalName: string }> };
    expect(inA.children.map((c) => c.legalName)).toEqual(["Child A"]);
    expect(inB.children.map((c) => c.legalName)).toEqual(["Child B"]);

    await app.request("/api/v1/year-groups", {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({ code: "6", name: "Year 6", studentLoginEnabled: true }),
    });
    const groups = (await (await app.request("/api/v1/year-groups", { headers: headersA })).json()) as {
      yearGroups: Array<{ id: string; code: string }>;
    };
    const y6 = groups.yearGroups.find((g) => g.code === "6")!;
    const year = (await (
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
    const loginStudent = await app.request("/api/v1/students", {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        legalName: "Logged In Pupil",
        academicYearId: year.academicYear.id,
        yearGroupId: y6.id,
        loginAlias: `pupil.${id}`,
        password: "student-pass-1",
      }),
    });
    expect(loginStudent.status).toBe(201);

    const studentLogin = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationSlug: a.slug,
        username: `pupil.${id}`,
        password: "student-pass-1",
      }),
    });
    expect(studentLogin.status).toBe(200);

    const otherSchoolLogin = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationSlug: b.slug,
        username: `pupil.${id}`,
        password: "student-pass-1",
      }),
    });
    expect(otherSchoolLogin.status).toBe(401);
  });

  it("does not let a year group, class, or enrolment attach to another organisation", async () => {
    const id = suffix();
    const a = await createSchool(pools.owner, `xa-${id}`);
    const b = await createSchool(pools.owner, `xb-${id}`);
    const tokenA = await login(app, a.adminEmail, "password-12x");
    const headersA = {
      Authorization: `Bearer ${tokenA}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": a.orgId,
    };
    await app.request("/api/v1/year-groups/seed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await login(app, b.adminEmail, "password-12x")}`,
        "Content-Type": "application/json",
        "X-Organisation-Id": b.orgId,
      },
      body: "{}",
    });
    const bGroups = await withTenantContext(pools.app, b.adminId, b.orgId, async (client) => {
      const rows = await client.query<{ id: string }>(
        "select id from year_groups where organisation_id = $1 limit 1",
        [b.orgId],
      );
      return rows.rows[0]!.id;
    });
    const year = await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        name: "2026/27",
        startsOn: "2026-09-01",
        endsOn: "2027-07-31",
        isCurrent: true,
      }),
    });
    const yearBody = (await year.json()) as { academicYear: { id: string } };
    const cls = await app.request("/api/v1/classes", {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        name: "Hijack",
        academicYearId: yearBody.academicYear.id,
        yearGroupId: bGroups,
        classType: "form",
      }),
    });
    expect(cls.status).toBeGreaterThanOrEqual(400);
  });

  it("keeps Headteacher academic manage without member-management, and Teacher without school-wide read", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const headId = await insertUser(pools.owner, {
      email: `head-${id}@example.com`,
      password: "password-12x",
      fullName: "Head",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, headId, "school.headteacher");
    const perms = await pools.app.query<{ permission_key: string }>(
      "select permission_key from list_permissions_for_membership($1, $2)",
      [headId, school.orgId],
    );
    const set = new Set(perms.rows.map((r) => r.permission_key));
    expect(set.has(PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE)).toBe(true);
    expect(set.has(PERMISSIONS.ORG_MEMBERS_MANAGE)).toBe(false);
    expect(set.has(PERMISSIONS.STUDENTS_PROFILES_READ)).toBe(true);
  });

  it("does not expose unassigned class rosters to teachers", async () => {
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
    const yg = groups.yearGroups.find((g) => g.code === "5")!;
    const classA = (await (
      await app.request("/api/v1/classes", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "5A",
          academicYearId: year.academicYear.id,
          yearGroupId: yg.id,
          classType: "form",
        }),
      })
    ).json()) as { class: { id: string } };
    const classB = (await (
      await app.request("/api/v1/classes", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "5B",
          academicYearId: year.academicYear.id,
          yearGroupId: yg.id,
          classType: "form",
        }),
      })
    ).json()) as { class: { id: string } };

    await app.request("/api/v1/students", {
      method: "POST",
      headers,
      body: JSON.stringify({
        legalName: "Assigned Five",
        academicYearId: year.academicYear.id,
        yearGroupId: yg.id,
        classId: classA.class.id,
      }),
    });
    await app.request("/api/v1/students", {
      method: "POST",
      headers,
      body: JSON.stringify({
        legalName: "Unassigned Five",
        academicYearId: year.academicYear.id,
        yearGroupId: yg.id,
        classId: classB.class.id,
      }),
    });

    const teacher = (await (
      await app.request("/api/v1/staff", {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: `roster-${id}@example.com`,
          fullName: "Roster Teacher",
          roleKeys: ["school.teacher"],
        }),
      })
    ).json()) as { staffProfileId: string; invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: teacher.invitationToken,
        fullName: "Roster Teacher",
        password: "teacher-pass-1",
      }),
    });
    await app.request(`/api/v1/classes/${classA.class.id}/staff`, {
      method: "POST",
      headers,
      body: JSON.stringify({ staffProfileId: teacher.staffProfileId, assignmentRole: "form_tutor" }),
    });

    const teacherToken = await login(app, `roster-${id}@example.com`, "teacher-pass-1");
    const teacherHeaders = {
      Authorization: `Bearer ${teacherToken}`,
      "X-Organisation-Id": school.orgId,
    };
    const assignedClass = (await (
      await app.request(`/api/v1/classes/${classA.class.id}`, { headers: teacherHeaders })
    ).json()) as { members: Array<{ legalName: string }> };
    const otherClass = (await (
      await app.request(`/api/v1/classes/${classB.class.id}`, { headers: teacherHeaders })
    ).json()) as { members: Array<{ legalName: string }> };
    expect(assignedClass.members.map((m) => m.legalName)).toEqual(["Assigned Five"]);
    expect(otherClass.members).toEqual([]);
    expect(JSON.stringify(otherClass)).not.toContain("Unassigned Five");
  });

  it("activates an invited parent membership after they obtain credentials elsewhere", async () => {
    const id = suffix();
    const a = await createSchool(pools.owner, `ga-${id}`);
    const b = await createSchool(pools.owner, `gb-${id}`);
    const tokenA = await login(app, a.adminEmail, "password-12x");
    const tokenB = await login(app, b.adminEmail, "password-12x");
    const headersA = {
      Authorization: `Bearer ${tokenA}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": a.orgId,
    };
    const headersB = {
      Authorization: `Bearer ${tokenB}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": b.orgId,
    };

    const childA1 = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({ legalName: "Child A1" }),
      })
    ).json()) as { student: { id: string } };
    const childA2 = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({ legalName: "Child A2" }),
      })
    ).json()) as { student: { id: string } };
    const childB = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers: headersB,
        body: JSON.stringify({ legalName: "Child B" }),
      })
    ).json()) as { student: { id: string } };

    await app.request(`/api/v1/students/${childA1.student.id}/guardians`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        email: `late-${id}@example.com`,
        fullName: "Late Parent",
        relationship: "mother",
        portalAccess: true,
      }),
    });
    const inviteB = (await (
      await app.request(`/api/v1/students/${childB.student.id}/guardians`, {
        method: "POST",
        headers: headersB,
        body: JSON.stringify({
          email: `late-${id}@example.com`,
          fullName: "Late Parent",
          relationship: "mother",
          portalAccess: true,
        }),
      })
    ).json()) as { invitationToken: string };
    const accepted = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: inviteB.invitationToken,
        fullName: "Late Parent",
        password: "parent-pass-1",
      }),
    });
    expect(accepted.status).toBe(200);

    const secondLink = await app.request(`/api/v1/students/${childA2.student.id}/guardians`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        email: `late-${id}@example.com`,
        fullName: "Late Parent",
        relationship: "mother",
        portalAccess: true,
      }),
    });
    expect(secondLink.status).toBe(201);

    const parentToken = await login(app, `late-${id}@example.com`, "parent-pass-1");
    const inA = await app.request("/api/v1/parent/children", {
      headers: { Authorization: `Bearer ${parentToken}`, "X-Organisation-Id": a.orgId },
    });
    expect(inA.status).toBe(200);
    const inABody = (await inA.json()) as { children: Array<{ legalName: string }> };
    expect(inABody.children.map((c) => c.legalName).sort()).toEqual(["Child A1", "Child A2"]);
  });

  it("refuses student alias login when the current year group disables it, and keeps aliases org-unique", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const headers = {
      Authorization: `Bearer ${token}`,
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
    const createdGroup = await app.request("/api/v1/year-groups", {
      method: "POST",
      headers,
      body: JSON.stringify({ code: "6", name: "Year 6", studentLoginEnabled: true }),
    });
    expect(createdGroup.status).toBe(201);
    const group = (await createdGroup.json()) as { yearGroup: { id: string } };
    const first = await app.request("/api/v1/students", {
      method: "POST",
      headers,
      body: JSON.stringify({
        legalName: "Alias Pupil",
        academicYearId: year.academicYear.id,
        yearGroupId: group.yearGroup.id,
        loginAlias: `alias.${id}`,
        password: "student-pass-1",
      }),
    });
    expect(first.status).toBe(201);
    const duplicate = await app.request("/api/v1/students", {
      method: "POST",
      headers,
      body: JSON.stringify({
        legalName: "Other Alias Pupil",
        academicYearId: year.academicYear.id,
        yearGroupId: group.yearGroup.id,
        loginAlias: `alias.${id}`,
        password: "student-pass-2",
      }),
    });
    expect(duplicate.status).toBe(409);

    const enabledLogin = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationSlug: school.slug,
        username: `alias.${id}`,
        password: "student-pass-1",
      }),
    });
    expect(enabledLogin.status).toBe(200);

    const disabled = await app.request(`/api/v1/year-groups/${group.yearGroup.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ studentLoginEnabled: false }),
    });
    expect(disabled.status).toBe(200);
    const disabledLogin = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationSlug: school.slug,
        username: `alias.${id}`,
        password: "student-pass-1",
      }),
    });
    expect(disabledLogin.status).toBe(401);
  });

  it("hides a child from the parent portal when portal access is off, even with parental responsibility", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": school.orgId,
    };
    const visible = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers,
        body: JSON.stringify({ legalName: "Visible Child" }),
      })
    ).json()) as { student: { id: string } };
    const hidden = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers,
        body: JSON.stringify({ legalName: "Hidden Child" }),
      })
    ).json()) as { student: { id: string } };

    const invite = (await (
      await app.request(`/api/v1/students/${visible.student.id}/guardians`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: `pr-${id}@example.com`,
          fullName: "PR Parent",
          relationship: "father",
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
        fullName: "PR Parent",
        password: "parent-pass-1",
      }),
    });
    await app.request(`/api/v1/students/${hidden.student.id}/guardians`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: `pr-${id}@example.com`,
        fullName: "PR Parent",
        relationship: "father",
        hasParentalResponsibility: true,
        portalAccess: false,
      }),
    });

    const parentToken = await login(app, `pr-${id}@example.com`, "parent-pass-1");
    const parentHeaders = {
      Authorization: `Bearer ${parentToken}`,
      "X-Organisation-Id": school.orgId,
    };
    const children = (await (
      await app.request("/api/v1/parent/children", { headers: parentHeaders })
    ).json()) as { children: Array<{ legalName: string }> };
    expect(children.children.map((c) => c.legalName)).toEqual(["Visible Child"]);
    const hiddenDetail = await app.request(`/api/v1/parent/children/${hidden.student.id}`, {
      headers: parentHeaders,
    });
    expect(hiddenDetail.status).toBe(404);
  });

  it("does not rewrite another year's form membership when adding a form class", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": school.orgId,
    };
    const yearOne = (await (
      await app.request("/api/v1/academic-years", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "2025/26",
          startsOn: "2025-09-01",
          endsOn: "2026-07-31",
          isCurrent: true,
        }),
      })
    ).json()) as { academicYear: { id: string } };
    await app.request("/api/v1/year-groups/seed", { method: "POST", headers, body: "{}" });
    const groups = (await (await app.request("/api/v1/year-groups", { headers })).json()) as {
      yearGroups: Array<{ id: string; code: string }>;
    };
    const y3 = groups.yearGroups.find((g) => g.code === "3")!;
    const y4 = groups.yearGroups.find((g) => g.code === "4")!;
    const classA = (await (
      await app.request("/api/v1/classes", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "3A",
          academicYearId: yearOne.academicYear.id,
          yearGroupId: y3.id,
          classType: "form",
        }),
      })
    ).json()) as { class: { id: string } };
    const student = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers,
        body: JSON.stringify({
          legalName: "Year Move Pupil",
          academicYearId: yearOne.academicYear.id,
          yearGroupId: y3.id,
          classId: classA.class.id,
        }),
      })
    ).json()) as { student: { id: string } };
    const yearTwo = (await (
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
    const classNext = (await (
      await app.request("/api/v1/classes", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "4A",
          academicYearId: yearTwo.academicYear.id,
          yearGroupId: y4.id,
          classType: "form",
        }),
      })
    ).json()) as { class: { id: string } };
    const added = await app.request(`/api/v1/students/${student.student.id}/class-memberships`, {
      method: "POST",
      headers,
      body: JSON.stringify({ classId: classNext.class.id, startedOn: "2026-09-01" }),
    });
    expect(added.status).toBe(201);

    const detail = await app.request(`/api/v1/students/${student.student.id}`, { headers });
    const body = (await detail.json()) as {
      student: { currentFormClassName: string | null };
      classMemberships: Array<{ className: string; endedOn: string | null }>;
    };
    expect(body.student.currentFormClassName).toBe("4A");
    expect(body.classMemberships.find((m) => m.className === "3A")?.endedOn).toBeNull();
    expect(body.classMemberships.find((m) => m.className === "4A")?.endedOn).toBeNull();
  });

  it("rejects clearing the current academic year and hides current form when a primary enrolment ends", async () => {
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
          startsOn: "2026-01-01",
          endsOn: "2026-12-31",
          isCurrent: true,
        }),
      })
    ).json()) as { academicYear: { id: string } };
    await app.request("/api/v1/year-groups/seed", { method: "POST", headers, body: "{}" });
    const groups = (await (await app.request("/api/v1/year-groups", { headers })).json()) as {
      yearGroups: Array<{ id: string; code: string }>;
    };
    const yg = groups.yearGroups.find((g) => g.code === "2")!;
    const cls = (await (
      await app.request("/api/v1/classes", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "2A",
          academicYearId: year.academicYear.id,
          yearGroupId: yg.id,
          classType: "form",
        }),
      })
    ).json()) as { class: { id: string } };
    const student = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers,
        body: JSON.stringify({
          legalName: "Leaver Pupil",
          academicYearId: year.academicYear.id,
          yearGroupId: yg.id,
          classId: cls.class.id,
        }),
      })
    ).json()) as { student: { id: string } };
    const teacher = (await (
      await app.request("/api/v1/staff", {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: `leave-${id}@example.com`,
          fullName: "Leave Teacher",
          roleKeys: ["school.teacher"],
        }),
      })
    ).json()) as { staffProfileId: string; invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: teacher.invitationToken,
        fullName: "Leave Teacher",
        password: "teacher-pass-1",
      }),
    });
    await app.request(`/api/v1/classes/${cls.class.id}/staff`, {
      method: "POST",
      headers,
      body: JSON.stringify({ staffProfileId: teacher.staffProfileId, assignmentRole: "form_tutor" }),
    });

    const unset = await app.request(`/api/v1/academic-years/${year.academicYear.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ isCurrent: false }),
    });
    expect(unset.status).toBe(409);
    const unsetBody = (await unset.json()) as { error: { code: string; message: string } };
    expect(unsetBody.error.code).toBe("cannot_clear_current");
    expect(unsetBody.error.message).toMatch(/Select another academic year as current before removing this one/i);
    const stillCurrent = (await (
      await app.request(`/api/v1/students/${student.student.id}`, { headers })
    ).json()) as { student: { currentFormClassName: string | null; currentYearGroupName: string | null } };
    expect(stillCurrent.student.currentFormClassName).toBe("2A");
    expect(stillCurrent.student.currentYearGroupName).not.toBeNull();
    const enrolments = (await (
      await app.request(`/api/v1/students/${student.student.id}`, { headers })
    ).json()) as { enrolments: Array<{ id: string; endedOn: string | null }> };
    const open = enrolments.enrolments.find((e) => e.endedOn === null);
    expect(open).toBeTruthy();
    const ended = await app.request(`/api/v1/student-enrolments/${open!.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ endedOn: "2026-08-01", status: "withdrawn" }),
    });
    expect(ended.status).toBe(200);

    const afterLeave = (await (
      await app.request(`/api/v1/students/${student.student.id}`, { headers })
    ).json()) as {
      student: { currentFormClassName: string | null };
      classMemberships: Array<{ className: string; endedOn: string | null }>;
    };
    expect(afterLeave.student.currentFormClassName).toBeNull();
    expect(afterLeave.classMemberships.find((m) => m.className === "2A")?.endedOn).toBe("2026-08-01");

    const teacherToken = await login(app, `leave-${id}@example.com`, "teacher-pass-1");
    const teacherList = (await (
      await app.request("/api/v1/students", {
        headers: { Authorization: `Bearer ${teacherToken}`, "X-Organisation-Id": school.orgId },
      })
    ).json()) as { students: Array<{ legalName: string }> };
    expect(teacherList.students).toEqual([]);
  });

  it("clears nullable student, staff, and guardianship fields when PATCH sends null", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Organisation-Id": school.orgId,
    };
    const student = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers,
        body: JSON.stringify({ legalName: "Nullable Pupil", admissionNumber: `ADM-${id}` }),
      })
    ).json()) as { student: { id: string; admissionNumber: string | null } };
    expect(student.student.admissionNumber).toBe(`ADM-${id}`);
    const clearedStudent = await app.request(`/api/v1/students/${student.student.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ admissionNumber: null }),
    });
    expect(clearedStudent.status).toBe(200);
    const studentAfter = (await (
      await app.request(`/api/v1/students/${student.student.id}`, { headers })
    ).json()) as { student: { admissionNumber: string | null } };
    expect(studentAfter.student.admissionNumber).toBeNull();

    const staff = (await (
      await app.request("/api/v1/staff", {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: `job-${id}@example.com`,
          fullName: "Job Staff",
          roleKeys: ["school.teacher"],
          jobTitle: "Tutor",
        }),
      })
    ).json()) as { staffProfileId: string; invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: staff.invitationToken,
        fullName: "Job Staff",
        password: "teacher-pass-1",
      }),
    });
    const clearedStaff = await app.request(`/api/v1/staff/${staff.staffProfileId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ jobTitle: null }),
    });
    expect(clearedStaff.status).toBe(200);
    const staffAfter = (await (
      await app.request(`/api/v1/staff/${staff.staffProfileId}`, { headers })
    ).json()) as { staff: { jobTitle: string | null } };
    expect(staffAfter.staff.jobTitle).toBeNull();

    const guardian = (await (
      await app.request(`/api/v1/students/${student.student.id}/guardians`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: `end-${id}@example.com`,
          fullName: "End Parent",
          relationship: "mother",
        }),
      })
    ).json()) as { guardianshipId: string };
    const ended = await app.request(`/api/v1/guardianships/${guardian.guardianshipId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ endedOn: "2026-06-01" }),
    });
    expect(ended.status).toBe(200);
    const reopened = await app.request(`/api/v1/guardianships/${guardian.guardianshipId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ endedOn: null }),
    });
    expect(reopened.status).toBe(200);
    const reopenedBody = (await reopened.json()) as { guardianship: { endedOn: string | null } };
    expect(reopenedBody.guardianship.endedOn).toBeNull();
  });
});
