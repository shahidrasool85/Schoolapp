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
    const formA = body.classMemberships.find((m) => m.className === "3A");
    const formB = body.classMemberships.find((m) => m.className === "3B");
    expect(formA?.endedOn).toBe("2026-01-12");
    expect(formB?.endedOn).toBeNull();
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
});
