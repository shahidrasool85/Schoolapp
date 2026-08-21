import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@schoolapp/domain";
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
    [`p6-${id}`, `Phase6 ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [
    org.rows[0]!.id,
  ]);
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

async function seedYearAndClasses(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
) {
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
  const reception = groups.yearGroups.find((g) => g.code === "R")!;
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
  return {
    yearId: year.academicYear.id,
    year3Id: year3.id,
    receptionId: reception.id,
    classAId: classA.class.id,
    classBId: classB.class.id,
  };
}

async function inviteTeacher(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  id: string,
  classId: string,
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
  await app.request(`/api/v1/classes/${classId}/staff`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      staffProfileId: staff.staffProfileId,
      assignmentRole: "form_tutor",
    }),
  });
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

describe("Phase 6 attendance and student record", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("takes an idempotent register, prevents duplicates, and ignores spoofed audit fields", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYearAndClasses(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Sam Student",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const sessions = (await (
      await app.request("/api/v1/attendance/session-types", { headers: hdrs })
    ).json()) as { sessionTypes: Array<{ id: string; key: string }> };
    const codes = (await (await app.request("/api/v1/attendance/codes", { headers: hdrs })).json()) as {
      codes: Array<{ id: string; code: string }>;
    };
    const am = sessions.sessionTypes.find((row) => row.key === "am")!;
    const present = codes.codes.find((row) => row.code === "present")!;
    const late = codes.codes.find((row) => row.code === "late")!;

    const first = await app.request("/api/v1/attendance/registers", {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        classId: seeded.classAId,
        date: "2026-09-01",
        sessionTypeId: am.id,
        markAllPresent: true,
        recordedBy: randomUUID(),
        lastCorrectedBy: randomUUID(),
      }),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      marks: Array<{ id: string; studentProfileId: string; recordedBy: string; code: string }>;
    };
    expect(firstBody.marks).toHaveLength(1);
    expect(firstBody.marks[0]?.code).toBe("present");
    expect(firstBody.marks[0]?.recordedBy).toBe(school.adminId);

    const second = await app.request("/api/v1/attendance/registers", {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        classId: seeded.classAId,
        date: "2026-09-01",
        sessionTypeId: am.id,
        marks: [
          {
            studentProfileId: pupil.student.id,
            codeId: late.id,
            lateMinutes: 12,
            recordedBy: randomUUID(),
          },
        ],
      }),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      marks: Array<{ id: string; code: string; lateMinutes: number | null; recordedBy: string }>;
    };
    expect(secondBody.marks[0]?.id).toBe(firstBody.marks[0]?.id);
    expect(secondBody.marks[0]?.code).toBe("late");
    expect(secondBody.marks[0]?.lateMinutes).toBe(12);
    expect(secondBody.marks[0]?.recordedBy).toBe(school.adminId);

    const noted = await app.request("/api/v1/attendance/registers", {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        classId: seeded.classAId,
        date: "2026-09-01",
        sessionTypeId: am.id,
        marks: [
          {
            studentProfileId: pupil.student.id,
            codeId: late.id,
            note: "Office follow-up",
            parentVisibleNote: "Arrived after assembly",
            reason: "Traffic",
          },
        ],
      }),
    });
    expect(noted.status).toBe(200);
    const resaved = await app.request("/api/v1/attendance/registers", {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        classId: seeded.classAId,
        date: "2026-09-01",
        sessionTypeId: am.id,
        marks: [{ studentProfileId: pupil.student.id, codeId: late.id, lateMinutes: 12 }],
      }),
    });
    expect(resaved.status).toBe(200);
    const resavedBody = (await resaved.json()) as {
      marks: Array<{
        note: string | null;
        parentNote: string | null;
        reason: string | null;
        lateMinutes: number | null;
      }>;
    };
    expect(resavedBody.marks[0]?.note).toBe("Office follow-up");
    expect(resavedBody.marks[0]?.parentNote).toBe("Arrived after assembly");
    expect(resavedBody.marks[0]?.reason).toBe("Traffic");
    expect(resavedBody.marks[0]?.lateMinutes).toBe(12);

    const unique = await pools.owner.query<{ n: string }>(
      `select count(*)::text as n from attendance_marks
       where organisation_id = $1 and student_profile_id = $2
         and mark_date = '2026-09-01' and session_type_id = $3`,
      [school.orgId, pupil.student.id, am.id],
    );
    expect(unique.rows[0]?.n).toBe("1");

    const revisions = await app.request(
      `/api/v1/attendance/marks/${firstBody.marks[0]!.id}/revisions`,
      { headers: hdrs },
    );
    expect(revisions.status).toBe(200);
    const revisionBody = (await revisions.json()) as { revisions: Array<{ code: string }> };
    expect(revisionBody.revisions.some((row) => row.code === "present")).toBe(true);
    void present;
  });

  it("restricts teachers to assigned registers and denies school-wide attendance", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const seeded = await seedYearAndClasses(app, hdrs);
    await inviteTeacher(app, hdrs, id, seeded.classAId);
    const assigned = await createStudent(app, hdrs, {
      legalName: "Assigned Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const other = await createStudent(app, hdrs, {
      legalName: "Other Class Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classBId,
    });
    const sessions = (await (
      await app.request("/api/v1/attendance/session-types", { headers: hdrs })
    ).json()) as { sessionTypes: Array<{ id: string; key: string }> };
    const am = sessions.sessionTypes.find((row) => row.key === "am")!;
    const teacherToken = await login(app, `teacher-${id}@example.com`, "teacher-pass-1");
    const teacherHdrs = headers(teacherToken, school.orgId);

    const mine = await app.request(
      `/api/v1/attendance/registers?classId=${seeded.classAId}&date=2026-09-01&sessionTypeId=${am.id}`,
      { headers: teacherHdrs },
    );
    expect(mine.status).toBe(200);
    const mineBody = (await mine.json()) as { pupils: Array<{ studentProfileId: string }> };
    expect(mineBody.pupils.map((row) => row.studentProfileId)).toEqual([assigned.student.id]);

    const otherRegister = await app.request(
      `/api/v1/attendance/registers?classId=${seeded.classBId}&date=2026-09-01&sessionTypeId=${am.id}`,
      { headers: teacherHdrs },
    );
    expect(otherRegister.status).toBe(404);

    const schoolWide = await app.request("/api/v1/attendance/marks", { headers: teacherHdrs });
    expect(schoolWide.status).toBe(403);

    const otherHistory = await app.request(`/api/v1/attendance/students/${other.student.id}`, {
      headers: teacherHdrs,
    });
    expect(otherHistory.status).toBe(404);

    await app.request("/api/v1/attendance/registers", {
      method: "PUT",
      headers: teacherHdrs,
      body: JSON.stringify({
        classId: seeded.classAId,
        date: "2026-09-01",
        sessionTypeId: am.id,
        markAllPresent: true,
      }),
    });
    const listed = (await (
      await app.request("/api/v1/attendance/marks?studentId=" + assigned.student.id, {
        headers: hdrs,
      })
    ).json()) as { marks: Array<{ id: string }> };
    const patch = await app.request(`/api/v1/attendance/marks/${listed.marks[0]!.id}`, {
      method: "PATCH",
      headers: teacherHdrs,
      body: JSON.stringify({ code: "authorised", reason: "nope" }),
    });
    expect(patch.status).toBe(403);
  });

  it("lets school admin correct a mark and keeps parent notes off the parent/student payloads", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const seeded = await seedYearAndClasses(app, hdrs);
    await app.request(`/api/v1/year-groups/${seeded.year3Id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ studentLoginEnabled: true }),
    });
    const pupil = await createStudent(app, hdrs, {
      legalName: "Visible Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `child.${id}`,
      password: "student-pass-1",
    });
    const guardian = (await (
      await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
        method: "POST",
        headers: hdrs,
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
        token: guardian.invitationToken,
        fullName: "Pat Parent",
        password: "parent-pass-1",
      }),
    });
    const sessions = (await (
      await app.request("/api/v1/attendance/session-types", { headers: hdrs })
    ).json()) as { sessionTypes: Array<{ id: string; key: string }> };
    const am = sessions.sessionTypes.find((row) => row.key === "am")!;
    const saved = (await (
      await app.request("/api/v1/attendance/registers", {
        method: "PUT",
        headers: hdrs,
        body: JSON.stringify({
          classId: seeded.classAId,
          date: "2026-09-01",
          sessionTypeId: am.id,
          marks: [
            {
              studentProfileId: pupil.student.id,
              code: "authorised",
              reason: "Medical",
              note: "Internal appointment letter",
              parentVisibleNote: "At the dentist",
            },
          ],
        }),
      })
    ).json()) as { marks: Array<{ id: string }> };

    const corrected = await app.request(`/api/v1/attendance/marks/${saved.marks[0]!.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({
        code: "present",
        note: "Corrected after letter arrived",
        recordedBy: randomUUID(),
      }),
    });
    expect(corrected.status).toBe(200);
    const correctedBody = (await corrected.json()) as {
      mark: { code: string; note: string | null; lastCorrectedBy: string };
    };
    expect(correctedBody.mark.code).toBe("present");
    expect(correctedBody.mark.lastCorrectedBy).toBe(school.adminId);

    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    const parentAttendance = await app.request(
      `/api/v1/parent/children/${pupil.student.id}/attendance`,
      { headers: headers(parentToken, school.orgId) },
    );
    expect(parentAttendance.status).toBe(200);
    const parentBody = (await parentAttendance.json()) as {
      marks: Array<Record<string, unknown>>;
    };
    expect(JSON.stringify(parentBody)).not.toContain("Internal appointment");
    expect(JSON.stringify(parentBody)).not.toContain("recordedBy");
    expect(parentBody.marks[0]?.parentNote).toBe("At the dentist");

    const otherChild = await createStudent(app, hdrs, {
      legalName: "Someone Else",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classBId,
    });
    const stolen = await app.request(`/api/v1/parent/children/${otherChild.student.id}/attendance`, {
      headers: headers(parentToken, school.orgId),
    });
    expect(stolen.status).toBe(404);

    const studentToken = await loginAlias(app, school.slug, `child.${id}`, "student-pass-1");
    const self = await app.request("/api/v1/student/attendance", {
      headers: headers(studentToken, school.orgId),
    });
    expect(self.status).toBe(200);
    expect(JSON.stringify(await self.json())).not.toContain("Internal appointment");
  });

  it("enables and disables student portal access by year group, including Reception", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYearAndClasses(app, hdrs);
    await app.request(`/api/v1/year-groups/${seeded.receptionId}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ studentLoginEnabled: true }),
    });
    await createStudent(app, hdrs, {
      legalName: "Reception Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.receptionId,
      loginAlias: `rec.${id}`,
      password: "student-pass-1",
    });
    const enabled = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationSlug: school.slug,
        username: `rec.${id}`,
        password: "student-pass-1",
      }),
    });
    expect(enabled.status).toBe(200);
    const enabledBody = (await enabled.json()) as { accessToken: string };

    await app.request(`/api/v1/year-groups/${seeded.receptionId}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ studentLoginEnabled: false }),
    });
    const disabled = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationSlug: school.slug,
        username: `rec.${id}`,
        password: "student-pass-1",
      }),
    });
    expect(disabled.status).toBe(401);

    const afterDisable = await app.request("/api/v1/student/me", {
      headers: headers(enabledBody.accessToken, school.orgId),
    });
    expect(afterDisable.status).toBe(403);
  });

  it("blocks student notification APIs when the student portal is disabled", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYearAndClasses(app, hdrs);
    await app.request(`/api/v1/year-groups/${seeded.year3Id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ studentLoginEnabled: true }),
    });
    await createStudent(app, hdrs, {
      legalName: "Notify Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      loginAlias: `note.${id}`,
      password: "student-pass-1",
    });
    const studentToken = await loginAlias(app, school.slug, `note.${id}`, "student-pass-1");
    await app.request(`/api/v1/year-groups/${seeded.year3Id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ studentLoginEnabled: false }),
    });
    const inbox = await app.request("/api/v1/notifications", {
      headers: headers(studentToken, school.orgId),
    });
    expect(inbox.status).toBe(403);
  });

  it("rejects alias login for former pupils even with a student-portal override", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYearAndClasses(app, hdrs);
    await app.request(`/api/v1/year-groups/${seeded.year3Id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ studentLoginEnabled: true }),
    });
    const pupil = await createStudent(app, hdrs, {
      legalName: "Former Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      loginAlias: `former.${id}`,
      password: "student-pass-1",
    });
    await pools.owner.query(
      `update student_enrolments
          set ended_on = started_on,
              status = 'withdrawn'
        where student_profile_id = $1
          and academic_year_id = $2
          and is_primary`,
      [pupil.student.id, seeded.yearId],
    );
    await pools.owner.query(
      `insert into student_portal_student_overrides (organisation_id, student_profile_id, enabled)
       values ($1, $2, true)
       on conflict (student_profile_id) do update set enabled = excluded.enabled`,
      [school.orgId, pupil.student.id],
    );
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationSlug: school.slug,
        username: `former.${id}`,
        password: "student-pass-1",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("keeps attendance history after a class move and isolates tenants", async () => {
    const id = suffix();
    const a = await createSchool(pools.owner, `a-${id}`);
    const b = await createSchool(pools.owner, `b-${id}`);
    const tokenA = await login(app, a.adminEmail, "password-12x");
    const tokenB = await login(app, b.adminEmail, "password-12x");
    const hdrsA = headers(tokenA, a.orgId);
    const hdrsB = headers(tokenB, b.orgId);
    const seededA = await seedYearAndClasses(app, hdrsA);
    const seededB = await seedYearAndClasses(app, hdrsB);
    const pupilA = await createStudent(app, hdrsA, {
      legalName: "Green Pupil",
      academicYearId: seededA.yearId,
      yearGroupId: seededA.year3Id,
      classId: seededA.classAId,
    });
    const pupilB = await createStudent(app, hdrsB, {
      legalName: "Oak Pupil",
      academicYearId: seededB.yearId,
      yearGroupId: seededB.year3Id,
      classId: seededB.classAId,
    });
    const sessionsA = (await (
      await app.request("/api/v1/attendance/session-types", { headers: hdrsA })
    ).json()) as { sessionTypes: Array<{ id: string; key: string }> };
    const sessionsB = (await (
      await app.request("/api/v1/attendance/session-types", { headers: hdrsB })
    ).json()) as { sessionTypes: Array<{ id: string; key: string }> };
    const amA = sessionsA.sessionTypes.find((row) => row.key === "am")!;
    const amB = sessionsB.sessionTypes.find((row) => row.key === "am")!;

    await app.request("/api/v1/attendance/registers", {
      method: "PUT",
      headers: hdrsA,
      body: JSON.stringify({
        classId: seededA.classAId,
        date: "2026-09-01",
        sessionTypeId: amA.id,
        markAllPresent: true,
      }),
    });
    await app.request("/api/v1/attendance/registers", {
      method: "PUT",
      headers: hdrsB,
      body: JSON.stringify({
        classId: seededB.classAId,
        date: "2026-09-01",
        sessionTypeId: amB.id,
        markAllPresent: true,
      }),
    });

    const moved = await app.request(`/api/v1/students/${pupilA.student.id}/class-memberships`, {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({ classId: seededA.classBId, startedOn: "2026-09-08" }),
    });
    expect(moved.status).toBe(201);

    const history = await app.request(`/api/v1/attendance/students/${pupilA.student.id}`, {
      headers: hdrsA,
    });
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as {
      marks: Array<{ classId: string | null; date: string }>;
      summary: { sessionsPossible: number };
    };
    expect(historyBody.marks[0]?.classId).toBe(seededA.classAId);
    expect(historyBody.summary.sessionsPossible).toBeGreaterThan(0);

    const spoof = await app.request("/api/v1/attendance/session-types", {
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "X-Organisation-Id": b.orgId,
      },
    });
    expect(spoof.status).toBe(403);

    const crossStudent = await app.request(`/api/v1/attendance/students/${pupilB.student.id}`, {
      headers: hdrsA,
    });
    expect(crossStudent.status).toBe(404);

    const crossClass = await app.request(
      `/api/v1/attendance/registers?classId=${seededB.classAId}&date=2026-09-01&sessionTypeId=${amA.id}`,
      { headers: hdrsA },
    );
    expect(crossClass.status).toBe(404);

    const me = await app.request("/api/v1/me", { headers: hdrsA });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { permissions: string[] };
    expect(meBody.permissions).toContain(PERMISSIONS.ATTENDANCE_RECORD_MANAGE);
    expect(meBody.permissions).toContain(PERMISSIONS.STUDENTS_PORTAL_ACCESS_MANAGE);

    await withTenantContext(pools.app, a.adminId, a.orgId, async (client) => {
      const seen = await client.query<{ n: string }>(
        "select count(*)::text as n from attendance_marks",
      );
      expect(Number(seen.rows[0]?.n)).toBeGreaterThan(0);
      const leaked = await client.query<{ n: string }>(
        "select count(*)::text as n from attendance_marks where organisation_id = $1",
        [b.orgId],
      );
      expect(leaked.rows[0]?.n).toBe("0");
    });
  });

  it("stores student document metadata without binaries and hides staff-only docs from parents", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const pupil = (await (
      await app.request("/api/v1/students", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ legalName: "Doc Pupil" }),
      })
    ).json()) as { student: { id: string } };
    const created = await app.request(`/api/v1/students/${pupil.student.id}/documents`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Internal support note",
        documentType: "support",
        visibility: "staff",
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      document: { storageBackend: string; storageKey: string | null };
      binaryUploadAvailable: boolean;
    };
    expect(createdBody.binaryUploadAvailable).toBe(false);
    expect(createdBody.document.storageBackend).toBe("unconfigured");

    const shared = await app.request(`/api/v1/students/${pupil.student.id}/documents`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Welcome letter",
        documentType: "letter",
        visibility: "staff_and_parents",
      }),
    });
    expect(shared.status).toBe(201);

    const guardian = (await (
      await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          email: `doc-parent-${id}@example.com`,
          fullName: "Doc Parent",
          relationship: "mother",
        }),
      })
    ).json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: guardian.invitationToken,
        fullName: "Doc Parent",
        password: "parent-pass-1",
      }),
    });
    const parentToken = await login(app, `doc-parent-${id}@example.com`, "parent-pass-1");
    const parentDocs = await app.request(
      `/api/v1/parent/children/${pupil.student.id}/documents`,
      { headers: headers(parentToken, school.orgId) },
    );
    expect(parentDocs.status).toBe(200);
    const parentBody = (await parentDocs.json()) as {
      documents: Array<{ title: string; storageKey: string | null }>;
    };
    expect(parentBody.documents.map((row) => row.title)).toEqual(["Welcome letter"]);
    expect(parentBody.documents[0]?.storageKey).toBeNull();
  });
});
