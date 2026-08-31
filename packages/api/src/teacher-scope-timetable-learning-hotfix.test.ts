import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools } from "@schoolapp/db";
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

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`hf-${id}`, `Hotfix ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return {
    adminId,
    orgId: org.rows[0]!.id,
    slug: org.rows[0]!.slug,
    adminEmail: `admin-${id}@example.com`,
  };
}

function headers(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Organisation-Id": orgId,
  };
}

async function seedStructure(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof headers>) {
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
  const year7 = groups.yearGroups.find((g) => g.code === "7")!;
  const year8 = groups.yearGroups.find((g) => g.code === "8")!;
  expect(year3).toBeTruthy();
  expect(year7).toBeTruthy();
  expect(year8).toBeTruthy();
  const classA = (await (
    await app.request("/api/v1/classes", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "3A",
        academicYearId: year.academicYear.id,
        yearGroupId: year3.id,
        classType: "form",
      }),
    })
  ).json()) as { class: { id: string } };
  const classB = (await (
    await app.request("/api/v1/classes", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "3B",
        academicYearId: year.academicYear.id,
        yearGroupId: year3.id,
        classType: "form",
      }),
    })
  ).json()) as { class: { id: string } };
  const class7 = (await (
    await app.request("/api/v1/classes", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "7A",
        academicYearId: year.academicYear.id,
        yearGroupId: year7.id,
        classType: "form",
      }),
    })
  ).json()) as { class: { id: string } };
  const subject = (await (
    await app.request("/api/v1/subjects", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ key: "mathematics", name: "Mathematics" }),
    })
  ).json()) as { subject: { id: string } };
  await app.request(`/api/v1/year-groups/${year3.id}`, {
    method: "PATCH",
    headers: hdrs,
    body: JSON.stringify({ studentLoginEnabled: true }),
  });
  return {
    yearId: year.academicYear.id,
    year3Id: year3.id,
    year7Id: year7.id,
    year8Id: year8.id,
    classAId: classA.class.id,
    classBId: classB.class.id,
    class7Id: class7.class.id,
    subjectId: subject.subject.id,
  };
}

async function inviteStaff(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  input: {
    email: string;
    fullName: string;
    roleKey: string;
    classId?: string;
    password?: string;
  },
) {
  const staff = (await (
    await app.request("/api/v1/staff", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: input.email,
        fullName: input.fullName,
        roleKeys: [input.roleKey],
        jobTitle: "Staff",
      }),
    })
  ).json()) as { staffProfileId: string; invitationToken: string };
  const password = input.password ?? "teacher-pass-1";
  await app.request("/api/v1/invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: staff.invitationToken,
      fullName: input.fullName,
      password,
    }),
  });
  if (input.classId) {
    await app.request(`/api/v1/classes/${input.classId}/staff`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        staffProfileId: staff.staffProfileId,
        assignmentRole: "form_tutor",
      }),
    });
  }
  return { email: input.email, staffProfileId: staff.staffProfileId, password };
}

async function createStudent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  input: {
    legalName: string;
    academicYearId: string;
    yearGroupId: string;
    classId?: string;
    loginAlias?: string;
    password?: string;
  },
) {
  const created = await app.request("/api/v1/students", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(input),
  });
  expect(created.status).toBe(201);
  return (await created.json()) as { student: { id: string } };
}

describe("teacher scope, timetable and learning hotfix", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("stops ordinary teachers and Headteachers managing portal policy or rooms", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const other = await createSchool(pools.owner, `b-${id}`);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const teacher = await inviteStaff(app, hdrs, {
      email: `arifa-${id}@example.com`,
      fullName: "Arifa Aslam",
      roleKey: "school.teacher",
      classId: seeded.classAId,
    });
    const head = await inviteStaff(app, hdrs, {
      email: `head-${id}@example.com`,
      fullName: "Head Teacher",
      roleKey: "school.headteacher",
      password: "head-pass-12x",
    });
    const teacherToken = await login(app, teacher.email, teacher.password);
    const teacherHdrs = headers(teacherToken, school.orgId);
    const headToken = await login(app, head.email, head.password);
    const headHdrs = headers(headToken, school.orgId);

    expect((await app.request("/api/v1/student-portal-policy", { headers: teacherHdrs })).status).toBe(403);
    expect(
      (
        await app.request("/api/v1/student-portal-policy", {
          method: "PATCH",
          headers: teacherHdrs,
          body: JSON.stringify({ defaultEnabled: true }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`/api/v1/student-portal-policy/year-groups/${seeded.year7Id}`, {
          method: "PUT",
          headers: teacherHdrs,
          body: JSON.stringify({ enabled: false }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`/api/v1/student-portal-policy/year-groups/${seeded.year8Id}`, {
          method: "PUT",
          headers: teacherHdrs,
          body: JSON.stringify({ enabled: true }),
        })
      ).status,
    ).toBe(403);
    expect((await app.request("/api/v1/student-portal-policy", { headers: headHdrs })).status).toBe(403);
    expect(
      (
        await app.request(`/api/v1/year-groups/${seeded.year7Id}`, {
          method: "PATCH",
          headers: teacherHdrs,
          body: JSON.stringify({ studentLoginEnabled: false }),
        })
      ).status,
    ).toBe(403);

    const adminGet = await app.request("/api/v1/student-portal-policy", { headers: hdrs });
    expect(adminGet.status).toBe(200);

    expect(
      (
        await app.request("/api/v1/timetable/rooms", {
          method: "POST",
          headers: teacherHdrs,
          body: JSON.stringify({ name: "Should fail", shortCode: "NO" }),
        })
      ).status,
    ).toBe(403);
    const roomsRead = await app.request("/api/v1/timetable/rooms", { headers: teacherHdrs });
    expect(roomsRead.status).toBe(200);
    const createdRoom = await app.request("/api/v1/timetable/rooms", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Hall", shortCode: "HALL" }),
    });
    expect(createdRoom.status).toBe(201);

    const parentId = await insertUser(pools.owner, {
      email: `parent-${id}@example.com`,
      password: "parent-pass-1",
      fullName: "Parent",
      kind: "parent",
    });
    await addMembership(pools.owner, school.orgId, parentId, "school.parent");
    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    expect(
      (await app.request("/api/v1/student-portal-policy", { headers: headers(parentToken, school.orgId) })).status,
    ).toBe(403);
    expect(
      (
        await app.request("/api/v1/timetable/rooms", {
          method: "POST",
          headers: headers(parentToken, school.orgId),
          body: JSON.stringify({ name: "Parent room", shortCode: "PR" }),
        })
      ).status,
    ).toBe(403);

    const otherAdmin = await login(app, other.adminEmail, "password-12x");
    expect(
      (await app.request("/api/v1/student-portal-policy", { headers: headers(teacherToken, other.orgId) })).status,
    ).toBe(403);
    expect(
      (
        await app.request("/api/v1/timetable/rooms", {
          method: "POST",
          headers: headers(otherAdmin, other.orgId),
          body: JSON.stringify({ name: "Other hall", shortCode: "OH" }),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await app.request("/api/v1/timetable/rooms", {
          method: "POST",
          headers: headers(adminToken, other.orgId),
          body: JSON.stringify({ name: "Cross tenant", shortCode: "XT" }),
        })
      ).status,
    ).toBe(403);
  });

  it("scopes teacher homework to assigned classes and shows published work in My Learning", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const other = await createSchool(pools.owner, `b-${id}`);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const otherAdmin = await login(app, other.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const otherHdrs = headers(otherAdmin, other.orgId);
    const seeded = await seedStructure(app, hdrs);
    const otherSeeded = await seedStructure(app, otherHdrs);
    const teacher = await inviteStaff(app, hdrs, {
      email: `arifa-${id}@example.com`,
      fullName: "Arifa Aslam",
      roleKey: "school.teacher",
      classId: seeded.classAId,
    });
    const teacherToken = await login(app, teacher.email, teacher.password);
    const teacherHdrs = headers(teacherToken, school.orgId);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Year 3A Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `p3a.${id}`,
      password: "student-pass-1",
    });
    await createStudent(app, hdrs, {
      legalName: "Year 3B Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classBId,
      loginAlias: `p3b.${id}`,
      password: "student-pass-1",
    });

    const context = await app.request("/api/v1/learning/context", { headers: teacherHdrs });
    expect(context.status).toBe(200);
    const contextBody = (await context.json()) as {
      classes: Array<{ id: string; name: string }>;
      yearGroups: Array<{ id: string }>;
      canTargetYearGroups: boolean;
    };
    expect(contextBody.classes.map((row) => row.id)).toEqual([seeded.classAId]);
    expect(contextBody.yearGroups.map((row) => row.id)).toEqual([seeded.year3Id]);
    expect(contextBody.canTargetYearGroups).toBe(false);

    const ok = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        title: "Mathquiz",
        workTypeKey: "homework",
        intendedYearGroupId: seeded.year3Id,
        availableFrom: new Date(Date.now() + 86400000).toISOString(),
        targets: [{ targetType: "class", classId: seeded.classAId }],
      }),
    });
    expect(ok.status).toBe(201);
    const assignment = (await ok.json()) as { assignment: { id: string } };

    expect(
      (
        await app.request("/api/v1/learning/assignments", {
          method: "POST",
          headers: teacherHdrs,
          body: JSON.stringify({
            title: "Unrelated class",
            workTypeKey: "homework",
            targets: [{ targetType: "class", classId: seeded.classBId }],
          }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/api/v1/learning/assignments", {
          method: "POST",
          headers: teacherHdrs,
          body: JSON.stringify({
            title: "Year 7 forge",
            workTypeKey: "homework",
            intendedYearGroupId: seeded.year7Id,
            targets: [{ targetType: "class", classId: seeded.classAId }],
          }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/api/v1/learning/assignments", {
          method: "POST",
          headers: teacherHdrs,
          body: JSON.stringify({
            title: "Year 8",
            workTypeKey: "homework",
            targets: [{ targetType: "class", classId: seeded.class7Id }],
          }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/api/v1/learning/assignments", {
          method: "POST",
          headers: teacherHdrs,
          body: JSON.stringify({
            title: "Other school",
            workTypeKey: "homework",
            targets: [{ targetType: "class", classId: otherSeeded.classAId }],
          }),
        })
      ).status,
    ).toBe(404);

    const published = await app.request(`/api/v1/learning/assignments/${assignment.assignment.id}/publish`, {
      method: "POST",
      headers: teacherHdrs,
      body: "{}",
    });
    expect(published.status).toBe(200);
    const progress = (await published.json()) as { assignment: { status: string; progress: { assigned: number } } };
    expect(progress.assignment.status).toBe("published");
    expect(progress.assignment.progress.assigned).toBe(1);

    const studentToken = await loginAlias(app, school.slug, `p3a.${id}`, "student-pass-1");
    const studentHdrs = headers(studentToken, school.orgId);
    const listed = await app.request("/api/v1/student/assignments?bucket=assigned", { headers: studentHdrs });
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as { assignments: Array<{ id: string; title: string }> };
    expect(listedBody.assignments.map((row) => row.id)).toContain(assignment.assignment.id);
    const detail = await app.request(`/api/v1/student/assignments/${assignment.assignment.id}`, {
      headers: studentHdrs,
    });
    expect(detail.status).toBe(200);

    const inbox = await app.request("/api/v1/notifications", { headers: studentHdrs });
    const inboxBody = (await inbox.json()) as { notifications: Array<{ body: string; type: string }> };
    expect(inboxBody.notifications.some((row) => row.body === "New learning work: Mathquiz")).toBe(true);

    const otherStudentToken = await loginAlias(app, school.slug, `p3b.${id}`, "student-pass-1");
    const otherListed = await app.request("/api/v1/student/assignments?bucket=assigned", {
      headers: headers(otherStudentToken, school.orgId),
    });
    const otherBody = (await otherListed.json()) as { assignments: Array<{ id: string }> };
    expect(otherBody.assignments.map((row) => row.id)).not.toContain(assignment.assignment.id);
    expect(pupil.student.id).toBeTruthy();
  });

  it("derives period times, expands recurring lessons into Monday weeks, and blocks used period deletes", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const arifa = await inviteStaff(app, hdrs, {
      email: `arifa-${id}@example.com`,
      fullName: "Arifa Aslam",
      roleKey: "school.teacher",
      classId: seeded.classAId,
    });
    const otherTeacher = await inviteStaff(app, hdrs, {
      email: `other-${id}@example.com`,
      fullName: "Other Teacher",
      roleKey: "school.teacher",
      classId: seeded.classBId,
    });
    await createStudent(app, hdrs, {
      legalName: "3A Student",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `st3a.${id}`,
      password: "student-pass-1",
    });
    await createStudent(app, hdrs, {
      legalName: "3B Student",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classBId,
      loginAlias: `st3b.${id}`,
      password: "student-pass-1",
    });

    const profile = (await (
      await app.request("/api/v1/timetable/school-day-profiles", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: seeded.yearId,
          name: "Standard day",
          weekdays: [1, 2, 3, 4, 5],
          startsAt: "08:30",
          endsAt: "15:15",
        }),
      })
    ).json()) as { profile: { id: string } };
    const period1 = (await (
      await app.request(`/api/v1/timetable/school-day-profiles/${profile.profile.id}/periods`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Period 1",
          periodType: "teaching",
          startsAt: "09:00",
          endsAt: "11:00",
          sortOrder: 1,
        }),
      })
    ).json()) as { period: { id: string } };
    const unused = (await (
      await app.request(`/api/v1/timetable/school-day-profiles/${profile.profile.id}/periods`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Unused",
          periodType: "break",
          startsAt: "11:00",
          endsAt: "11:15",
          sortOrder: 2,
        }),
      })
    ).json()) as { period: { id: string } };

    const teacherToken = await login(app, arifa.email, arifa.password);
    const teacherHdrs = headers(teacherToken, school.orgId);
    expect(
      (
        await app.request("/api/v1/timetable/entries", {
          method: "POST",
          headers: teacherHdrs,
          body: JSON.stringify({
            academicYearId: seeded.yearId,
            schoolDayPeriodId: period1.period.id,
            weekday: 1,
            classId: seeded.classAId,
            effectiveFrom: "2026-09-03",
            teachers: [{ staffProfileId: arifa.staffProfileId, isPrimary: true }],
          }),
        })
      ).status,
    ).toBe(403);

    const created = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: seeded.yearId,
        schoolDayPeriodId: period1.period.id,
        customTime: false,
        weekday: 1,
        startsAt: "12:00",
        endsAt: "13:00",
        classId: seeded.classAId,
        subjectId: seeded.subjectId,
        effectiveFrom: "2026-09-03",
        teachers: [{ staffProfileId: arifa.staffProfileId, isPrimary: true }],
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      entry: { id: string; startsAt: string; endsAt: string };
      firstOccurrence: { date: string } | null;
      message: string;
    };
    expect(createdBody.entry.startsAt.startsWith("09:00")).toBe(true);
    expect(createdBody.entry.endsAt.startsWith("11:00")).toBe(true);
    expect(createdBody.firstOccurrence?.date).toBe("2026-09-07");
    expect(createdBody.message).toContain("Monday 7 September");

    const retry = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: seeded.yearId,
        schoolDayPeriodId: period1.period.id,
        weekday: 1,
        classId: seeded.classAId,
        effectiveFrom: "2026-09-03",
        teachers: [{ staffProfileId: arifa.staffProfileId, isPrimary: true }],
      }),
    });
    expect(retry.status).toBe(409);
    const retryBody = (await retry.json()) as { error: { message: string } };
    expect(retryBody.error.message).toMatch(/3A|Arifa Aslam/);

    const midWeek = await app.request(`/api/v1/timetable/occurrences?week=2026-09-03&classId=${seeded.classAId}`, {
      headers: hdrs,
    });
    const midWeekBody = (await midWeek.json()) as {
      weekCommencing: string;
      from: string;
      occurrences: Array<{ date: string }>;
    };
    expect(midWeekBody.weekCommencing).toBe("2026-08-31");
    expect(midWeekBody.from).toBe("2026-08-31");
    expect(midWeekBody.occurrences.some((row) => row.date === "2026-09-07")).toBe(false);

    const week = await app.request(
      `/api/v1/timetable/occurrences?from=2026-09-07&to=2026-09-11&classId=${seeded.classAId}`,
      { headers: hdrs },
    );
    const weekBody = (await week.json()) as { occurrences: Array<{ date: string; className: string }> };
    expect(weekBody.occurrences.map((row) => row.date)).toEqual(["2026-09-07"]);
    expect(weekBody.occurrences[0]?.className).toBe("3A");

    const studentToken = await loginAlias(app, school.slug, `st3a.${id}`, "student-pass-1");
    const studentWeek = await app.request("/api/v1/student/timetable?from=2026-09-07", {
      headers: headers(studentToken, school.orgId),
    });
    const studentBody = (await studentWeek.json()) as {
      weekCommencing: string;
      occurrences: Array<{ date: string; subjectName: string | null; className: string }>;
    };
    expect(studentBody.weekCommencing).toBe("2026-09-07");
    expect(studentBody.occurrences.some((row) => row.date === "2026-09-07" && row.className === "3A")).toBe(true);

    const otherStudent = await loginAlias(app, school.slug, `st3b.${id}`, "student-pass-1");
    const otherStudentWeek = await app.request("/api/v1/student/timetable?from=2026-09-07", {
      headers: headers(otherStudent, school.orgId),
    });
    const otherStudentBody = (await otherStudentWeek.json()) as { occurrences: Array<{ className: string }> };
    expect(otherStudentBody.occurrences.some((row) => row.className === "3A")).toBe(false);

    const arifaTok = await login(app, arifa.email, arifa.password);
    const mine = await app.request(
      `/api/v1/timetable/occurrences?from=2026-09-07&to=2026-09-11&mine=true`,
      { headers: headers(arifaTok, school.orgId) },
    );
    const mineBody = (await mine.json()) as { occurrences: Array<{ date: string; className: string }> };
    expect(mineBody.occurrences.some((row) => row.date === "2026-09-07" && row.className === "3A")).toBe(true);

    const otherTok = await login(app, otherTeacher.email, otherTeacher.password);
    const otherMine = await app.request(
      `/api/v1/timetable/occurrences?from=2026-09-07&to=2026-09-11&mine=true`,
      { headers: headers(otherTok, school.orgId) },
    );
    const otherMineBody = (await otherMine.json()) as { occurrences: Array<{ className: string }> };
    expect(otherMineBody.occurrences.some((row) => row.className === "3A")).toBe(false);

    const deleteUnused = await app.request(`/api/v1/timetable/periods/${unused.period.id}`, {
      method: "DELETE",
      headers: hdrs,
    });
    expect(deleteUnused.status).toBe(200);
    const deleteUsed = await app.request(`/api/v1/timetable/periods/${period1.period.id}`, {
      method: "DELETE",
      headers: hdrs,
    });
    expect(deleteUsed.status).toBe(409);
    const deleteUsedBody = (await deleteUsed.json()) as { error: { message: string } };
    expect(deleteUsedBody.error.message).toMatch(/used by 1 timetable lesson/);
    expect(deleteUsedBody.error.message).not.toMatch(/cascade/i);
  });
});
