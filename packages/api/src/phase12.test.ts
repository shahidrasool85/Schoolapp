import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`p12-${id}`, `Phase12 ${id}`],
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
  await app.request(`/api/v1/academic-years/${year.academicYear.id}/terms`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      key: "autumn",
      name: "Autumn",
      startsOn: "2026-09-01",
      endsOn: "2026-12-18",
      sortOrder: 1,
    }),
  });
  await app.request("/api/v1/year-groups/seed", { method: "POST", headers: hdrs, body: "{}" });
  const groups = (await (await app.request("/api/v1/year-groups", { headers: hdrs })).json()) as {
    yearGroups: Array<{ id: string; code: string }>;
  };
  const year3 = groups.yearGroups.find((g) => g.code === "3")!;
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
    classAId: classA.class.id,
    classBId: classB.class.id,
    subjectId: subject.subject.id,
  };
}

async function inviteTeacher(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  id: string,
  classId?: string,
) {
  const staff = (await (
    await app.request("/api/v1/staff", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `teacher-${id}@example.com`,
        fullName: "Terry Teacher",
        roleKeys: ["school.teacher"],
        jobTitle: "Class teacher",
      }),
    })
  ).json()) as { staffProfileId: string; invitationToken: string };
  await app.request("/api/v1/invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: staff.invitationToken,
      fullName: "Terry Teacher",
      password: "teacher-pass-1",
    }),
  });
  if (classId) {
    await app.request(`/api/v1/classes/${classId}/staff`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        staffProfileId: staff.staffProfileId,
        assignmentRole: "form_tutor",
      }),
    });
  }
  return { email: `teacher-${id}@example.com`, staffProfileId: staff.staffProfileId };
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

describe("Phase 12 timetable", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("creates rooms, school-day periods, timetable entries and resolves recurring dates", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, suffix(), structure.classAId);

    const room = await app.request("/api/v1/timetable/rooms", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Year 3A", shortCode: "3A" }),
    });
    expect(room.status).toBe(201);
    const roomBody = (await room.json()) as { room: { id: string } };

    const profile = await app.request("/api/v1/timetable/school-day-profiles", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: structure.yearId,
        name: "Standard day",
        weekdays: [1, 2, 3, 4, 5],
        startsAt: "08:30",
        endsAt: "15:15",
      }),
    });
    expect(profile.status).toBe(201);
    const profileBody = (await profile.json()) as { profile: { id: string } };
    const period = await app.request(`/api/v1/timetable/school-day-profiles/${profileBody.profile.id}/periods`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Period 1",
        periodType: "teaching",
        startsAt: "08:45",
        endsAt: "09:35",
        sortOrder: 1,
      }),
    });
    expect(period.status).toBe(201);
    const periodBody = (await period.json()) as { period: { id: string } };

    const created = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: structure.yearId,
        schoolDayPeriodId: periodBody.period.id,
        weekday: 1,
        classId: structure.classAId,
        subjectId: structure.subjectId,
        roomId: roomBody.room.id,
        effectiveFrom: "2026-09-01",
        teachers: [{ staffProfileId: teacher.staffProfileId, isPrimary: true }],
      }),
    });
    expect(created.status).toBe(201);
    const entry = (await created.json()) as { entry: { id: string; startsAt: string } };
    expect(entry.entry.startsAt.startsWith("08:45")).toBe(true);

    const classView = await app.request(
      `/api/v1/timetable/entries?classId=${structure.classAId}&academicYearId=${structure.yearId}`,
      { headers: hdrs },
    );
    expect(classView.status).toBe(200);
    expect(((await classView.json()) as { entries: unknown[] }).entries).toHaveLength(1);

    const teacherView = await app.request(
      `/api/v1/timetable/entries?staffProfileId=${teacher.staffProfileId}`,
      { headers: hdrs },
    );
    expect(((await teacherView.json()) as { entries: unknown[] }).entries).toHaveLength(1);

    const roomView = await app.request(`/api/v1/timetable/entries?roomId=${roomBody.room.id}`, { headers: hdrs });
    expect(((await roomView.json()) as { entries: unknown[] }).entries).toHaveLength(1);

    const week = await app.request(
      `/api/v1/timetable/occurrences?from=2026-09-07&to=2026-09-11&classId=${structure.classAId}`,
      { headers: hdrs },
    );
    const occurrences = (await week.json()) as { occurrences: Array<{ date: string; weekday: number }> };
    expect(occurrences.occurrences.map((item) => item.date)).toEqual(["2026-09-07"]);
    expect(occurrences.occurrences[0]?.weekday).toBe(1);

    const outsideTerm = await app.request(
      `/api/v1/timetable/occurrences?from=2026-12-21&to=2026-12-22&classId=${structure.classAId}`,
      { headers: hdrs },
    );
    expect(((await outsideTerm.json()) as { occurrences: unknown[] }).occurrences).toHaveLength(0);
  });

  it("prevents teacher, class and room conflicts and cannot be bypassed via the API", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, suffix(), structure.classAId);
    const other = await inviteTeacher(app, hdrs, suffix(), structure.classBId);
    const room = (await (
      await app.request("/api/v1/timetable/rooms", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ name: "Lab", shortCode: "LAB" }),
      })
    ).json()) as { room: { id: string } };

    const first = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: structure.yearId,
        weekday: 1,
        startsAt: "09:00",
        endsAt: "10:00",
        classId: structure.classAId,
        subjectId: structure.subjectId,
        roomId: room.room.id,
        effectiveFrom: "2026-09-01",
        teachers: [{ staffProfileId: teacher.staffProfileId }],
      }),
    });
    expect(first.status).toBe(201);

    const classClash = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: structure.yearId,
        weekday: 1,
        startsAt: "09:30",
        endsAt: "10:30",
        classId: structure.classAId,
        effectiveFrom: "2026-09-01",
        teachers: [{ staffProfileId: other.staffProfileId }],
      }),
    });
    expect(classClash.status).toBe(409);
    const classBody = (await classClash.json()) as { error: { details?: { conflicts?: Array<{ kind: string }> } } };
    expect(classBody.error.details?.conflicts?.some((item) => item.kind === "class")).toBe(true);

    const teacherClash = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: structure.yearId,
        weekday: 1,
        startsAt: "09:15",
        endsAt: "09:45",
        classId: structure.classBId,
        effectiveFrom: "2026-09-01",
        teachers: [{ staffProfileId: teacher.staffProfileId }],
      }),
    });
    expect(teacherClash.status).toBe(409);

    const roomClash = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: structure.yearId,
        weekday: 1,
        startsAt: "09:00",
        endsAt: "10:00",
        classId: structure.classBId,
        roomId: room.room.id,
        effectiveFrom: "2026-09-01",
        teachers: [{ staffProfileId: other.staffProfileId }],
      }),
    });
    expect(roomClash.status).toBe(409);
  });

  it("records exceptions and cover without rewriting the permanent entry", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, suffix(), structure.classAId);
    const coverTeacher = await inviteTeacher(app, hdrs, suffix(), structure.classBId);
    const room = (await (
      await app.request("/api/v1/timetable/rooms", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ name: "Hall", shortCode: "HALL" }),
      })
    ).json()) as { room: { id: string } };
    const created = (await (
      await app.request("/api/v1/timetable/entries", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: structure.yearId,
          weekday: 1,
          startsAt: "11:00",
          endsAt: "12:00",
          classId: structure.classAId,
          effectiveFrom: "2026-09-01",
          teachers: [{ staffProfileId: teacher.staffProfileId }],
        }),
      })
    ).json()) as { entry: { id: string; roomId: string | null } };

    const cancelled = await app.request("/api/v1/timetable/exceptions", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        timetableEntryId: created.entry.id,
        date: "2026-09-07",
        exceptionType: "cancelled",
        parentVisibleNote: "Swimming gala",
      }),
    });
    expect(cancelled.status).toBe(201);
    const afterCancel = await app.request(
      `/api/v1/timetable/occurrences?from=2026-09-07&to=2026-09-07&classId=${structure.classAId}`,
      { headers: hdrs },
    );
    expect(((await afterCancel.json()) as { occurrences: unknown[] }).occurrences).toHaveLength(0);
    const withCancelled = await app.request(
      `/api/v1/timetable/occurrences?from=2026-09-07&to=2026-09-07&classId=${structure.classAId}&includeCancelled=true`,
      { headers: hdrs },
    );
    expect(((await withCancelled.json()) as { occurrences: Array<{ status: string }> }).occurrences[0]?.status).toBe(
      "cancelled",
    );

    const roomChange = await app.request("/api/v1/timetable/exceptions", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        timetableEntryId: created.entry.id,
        date: "2026-09-14",
        exceptionType: "room_changed",
        replacementRoomId: room.room.id,
        parentVisibleNote: "Moved to the hall",
      }),
    });
    expect(roomChange.status).toBe(201);
    const moved = await app.request(
      `/api/v1/timetable/occurrences?from=2026-09-14&to=2026-09-14&classId=${structure.classAId}`,
      { headers: hdrs },
    );
    const movedBody = (await moved.json()) as { occurrences: Array<{ roomName: string | null; status: string }> };
    expect(movedBody.occurrences[0]?.status).toBe("room_changed");
    expect(movedBody.occurrences[0]?.roomName).toBe("Hall");

    const cover = await app.request("/api/v1/timetable/covers", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        timetableEntryId: created.entry.id,
        date: "2026-09-21",
        coveringStaffProfileId: coverTeacher.staffProfileId,
        reason: "Training",
      }),
    });
    expect(cover.status).toBe(201);
    const covered = await app.request(
      `/api/v1/timetable/occurrences?from=2026-09-21&to=2026-09-21&classId=${structure.classAId}`,
      { headers: hdrs },
    );
    const coveredBody = (await covered.json()) as {
      occurrences: Array<{ covered: boolean; teachers: Array<{ isCover: boolean }> }>;
    };
    expect(coveredBody.occurrences[0]?.covered).toBe(true);
    expect(coveredBody.occurrences[0]?.teachers.some((teacherRow) => teacherRow.isCover)).toBe(true);

    const permanent = await app.request(`/api/v1/timetable/entries/${created.entry.id}`, { headers: hdrs });
    const permanentBody = (await permanent.json()) as { entry: { roomId: string | null } };
    expect(permanentBody.entry.roomId).toBeNull();
  });

  it("enforces tenant isolation, assigned-only access, portals and cover date scope", async () => {
    const gw = await createSchool(pools.owner, suffix());
    const oak = await createSchool(pools.owner, suffix());
    const gwToken = await login(app, gw.adminEmail, "password-12x");
    const oakToken = await login(app, oak.adminEmail, "password-12x");
    const gwH = headers(gwToken, gw.orgId);
    const oakH = headers(oakToken, oak.orgId);
    const gwS = await seedStructure(app, gwH);
    const oakS = await seedStructure(app, oakH);
    const gwTeacher = await inviteTeacher(app, gwH, suffix(), gwS.classAId);
    const otherTeacher = await inviteTeacher(app, gwH, suffix(), gwS.classBId);
    const oakTeacher = await inviteTeacher(app, oakH, suffix(), oakS.classAId);
    const oakRoom = (await (
      await app.request("/api/v1/timetable/rooms", {
        method: "POST",
        headers: oakH,
        body: JSON.stringify({ name: "Oak Room", shortCode: "OAK" }),
      })
    ).json()) as { room: { id: string } };

    const oakEntry = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: oakH,
      body: JSON.stringify({
        academicYearId: oakS.yearId,
        weekday: 2,
        startsAt: "10:00",
        endsAt: "11:00",
        classId: oakS.classAId,
        roomId: oakRoom.room.id,
        effectiveFrom: "2026-09-01",
        teachers: [{ staffProfileId: oakTeacher.staffProfileId }],
      }),
    });
    expect(oakEntry.status).toBe(201);
    const oakEntryBody = (await oakEntry.json()) as { entry: { id: string } };

    const gwFromOak = await app.request(`/api/v1/timetable/entries/${oakEntryBody.entry.id}`, { headers: gwH });
    expect(gwFromOak.status).toBe(404);

    const spoofRoom = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: gwH,
      body: JSON.stringify({
        academicYearId: gwS.yearId,
        weekday: 2,
        startsAt: "10:00",
        endsAt: "11:00",
        classId: gwS.classAId,
        roomId: oakRoom.room.id,
        effectiveFrom: "2026-09-01",
        teachers: [{ staffProfileId: gwTeacher.staffProfileId }],
      }),
    });
    expect(spoofRoom.status).toBe(404);

    const gwEntry = (await (
      await app.request("/api/v1/timetable/entries", {
        method: "POST",
        headers: gwH,
        body: JSON.stringify({
          academicYearId: gwS.yearId,
          weekday: 3,
          startsAt: "13:00",
          endsAt: "14:00",
          classId: gwS.classAId,
          effectiveFrom: "2026-09-01",
          teachers: [{ staffProfileId: gwTeacher.staffProfileId }],
        }),
      })
    ).json()) as { entry: { id: string } };

    const teacherToken = await login(app, gwTeacher.email, "teacher-pass-1");
    const teacherH = headers(teacherToken, gw.orgId);
    const own = await app.request(`/api/v1/timetable/entries/${gwEntry.entry.id}`, { headers: teacherH });
    expect(own.status).toBe(200);
    const otherClass = await app.request(`/api/v1/timetable/entries?classId=${gwS.classBId}`, { headers: teacherH });
    expect(otherClass.status).toBe(404);
    const createDenied = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: teacherH,
      body: JSON.stringify({
        academicYearId: gwS.yearId,
        weekday: 4,
        startsAt: "09:00",
        endsAt: "10:00",
        classId: gwS.classAId,
        effectiveFrom: "2026-09-01",
        teachers: [{ staffProfileId: gwTeacher.staffProfileId }],
      }),
    });
    expect(createDenied.status).toBe(403);

    const oakTeacherToken = await login(app, oakTeacher.email, "teacher-pass-1");
    const oakTeacherSeesGw = await app.request(`/api/v1/timetable/entries/${gwEntry.entry.id}`, {
      headers: headers(oakTeacherToken, oak.orgId),
    });
    expect(oakTeacherSeesGw.status).toBe(404);

    const visibleOak = await withTenantContext(pools.app, gw.adminId, gw.orgId, async (client) => {
      const result = await client.query("select count(*)::int as n from timetable_entries where organisation_id = $1", [
        oak.orgId,
      ]);
      return result.rows[0]?.n;
    });
    expect(visibleOak).toBe(0);

    const ameliaAlias = `amelia-${suffix()}`;
    const amelia = await createStudent(app, gwH, {
      legalName: "Amelia Test",
      academicYearId: gwS.yearId,
      yearGroupId: gwS.year3Id,
      classId: gwS.classAId,
      loginAlias: ameliaAlias,
      password: "student-pass-1",
    });
    const otherPupil = await createStudent(app, gwH, {
      legalName: "Other Pupil",
      academicYearId: gwS.yearId,
      yearGroupId: gwS.year3Id,
      classId: gwS.classBId,
      loginAlias: `other-${suffix()}`,
      password: "student-pass-1",
    });
    const parentId = await insertUser(pools.owner, {
      email: `parent-${suffix()}@example.com`,
      password: "parent-pass-1",
      fullName: "Parent One",
      kind: "parent",
    });
    await addMembership(pools.owner, gw.orgId, parentId, "school.parent");
    await pools.owner.query(
      `insert into guardianships (
         organisation_id, student_profile_id, guardian_user_id, relationship, portal_access
       ) values ($1,$2,$3,'mother', true)`,
      [gw.orgId, amelia.student.id, parentId],
    );
    const otherParentId = await insertUser(pools.owner, {
      email: `parent2-${suffix()}@example.com`,
      password: "parent-pass-1",
      fullName: "Parent Two",
      kind: "parent",
    });
    await addMembership(pools.owner, gw.orgId, otherParentId, "school.parent");
    await pools.owner.query(
      `insert into guardianships (
         organisation_id, student_profile_id, guardian_user_id, relationship, portal_access
       ) values ($1,$2,$3,'father', true)`,
      [gw.orgId, otherPupil.student.id, otherParentId],
    );

    const parentEmail = (
      await pools.owner.query<{ email: string }>("select email::text as email from users where id = $1", [parentId])
    ).rows[0]!.email;
    const parentTok = await login(app, parentEmail, "parent-pass-1");
    const parentH = headers(parentTok, gw.orgId);
    const childOk = await app.request(
      `/api/v1/parent/children/${amelia.student.id}/timetable?from=2026-09-07&to=2026-09-11`,
      { headers: parentH },
    );
    expect(childOk.status).toBe(200);
    const childOther = await app.request(
      `/api/v1/parent/children/${otherPupil.student.id}/timetable?from=2026-09-07&to=2026-09-11`,
      { headers: parentH },
    );
    expect(childOther.status).toBe(404);

    await pools.owner.query(
      "update guardianships set portal_access = false where guardian_user_id = $1 and student_profile_id = $2",
      [parentId, amelia.student.id],
    );
    const revoked = await app.request(
      `/api/v1/parent/children/${amelia.student.id}/timetable?from=2026-09-07&to=2026-09-11`,
      { headers: parentH },
    );
    expect(revoked.status).toBe(404);

    const studentTok = await loginAlias(app, gw.slug, ameliaAlias, "student-pass-1");
    const studentH = headers(studentTok, gw.orgId);
    const selfOk = await app.request("/api/v1/student/timetable?from=2026-09-07&to=2026-09-11", { headers: studentH });
    expect(selfOk.status).toBe(200);
    const selfSpoof = await app.request(
      `/api/v1/student/timetable?studentId=${otherPupil.student.id}&from=2026-09-07&to=2026-09-11`,
      { headers: studentH },
    );
    expect(selfSpoof.status).toBe(404);

    await app.request(`/api/v1/year-groups/${gwS.year3Id}`, {
      method: "PATCH",
      headers: gwH,
      body: JSON.stringify({ studentLoginEnabled: false }),
    });
    const disabled = await app.request("/api/v1/student/timetable?from=2026-09-07&to=2026-09-11", { headers: studentH });
    expect(disabled.status).toBe(403);

    const cover = await app.request("/api/v1/timetable/covers", {
      method: "POST",
      headers: gwH,
      body: JSON.stringify({
        timetableEntryId: gwEntry.entry.id,
        date: "2026-09-09",
        coveringStaffProfileId: otherTeacher.staffProfileId,
      }),
    });
    expect(cover.status).toBe(201);
    const coverTok = await login(app, otherTeacher.email, "teacher-pass-1");
    const coverH = headers(coverTok, gw.orgId);
    const coverDay = await app.request(`/api/v1/timetable/occurrences?from=2026-09-09&to=2026-09-09&mine=true`, {
      headers: coverH,
    });
    expect(((await coverDay.json()) as { occurrences: unknown[] }).occurrences.length).toBeGreaterThan(0);
    const later = await app.request(`/api/v1/timetable/entries?classId=${gwS.classAId}`, { headers: coverH });
    expect(later.status).toBe(404);

    const register = await app.request("/api/v1/timetable/occurrences/attendance-register", {
      method: "POST",
      headers: teacherH,
      body: JSON.stringify({ entryId: gwEntry.entry.id, date: "2026-09-09" }),
    });
    expect(register.status).toBe(200);
    const first = (await register.json()) as { sessionTypeId: string; classId: string };
    const again = await app.request("/api/v1/timetable/occurrences/attendance-register", {
      method: "POST",
      headers: teacherH,
      body: JSON.stringify({ entryId: gwEntry.entry.id, date: "2026-09-09" }),
    });
    const second = (await again.json()) as { sessionTypeId: string };
    expect(second.sessionTypeId).toBe(first.sessionTypeId);

    const events = await app.request("/api/v1/calendar/events", { headers: gwH });
    expect(events.status).toBe(200);
    const eventBody = (await events.json()) as { events: unknown[] };
    expect(Array.isArray(eventBody.events)).toBe(true);

    const spoof = await app.request("/api/v1/timetable/covers", {
      method: "POST",
      headers: gwH,
      body: JSON.stringify({
        timetableEntryId: gwEntry.entry.id,
        date: "2026-09-16",
        coveringStaffProfileId: otherTeacher.staffProfileId,
        assignedBy: oak.adminId,
      }),
    });
    expect(spoof.status).toBe(201);
    const stored = await pools.owner.query<{ assigned_by: string }>(
      "select assigned_by from timetable_covers where timetable_entry_id = $1 and cover_date = '2026-09-16'",
      [gwEntry.entry.id],
    );
    expect(stored.rows[0]?.assigned_by).toBe(gw.adminId);
  });
});
