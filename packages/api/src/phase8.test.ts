import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`p8-${id}`, `Phase8 ${id}`],
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
  const types = (await (await app.request("/api/v1/assessments/types", { headers: hdrs })).json()) as {
    types: Array<{ id: string; key: string }>;
  };
  const schemes = (await (
    await app.request("/api/v1/assessments/grade-schemes", { headers: hdrs })
  ).json()) as { schemes: Array<{ id: string; key: string; levels: Array<{ id: string; code: string }> }> };
  const period = (await (
    await app.request("/api/v1/assessments/reporting-periods", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: year.academicYear.id,
        name: "Autumn Term",
        startsOn: "2026-09-01",
        endsOn: "2026-12-18",
        status: "open",
      }),
    })
  ).json()) as { reportingPeriod: { id: string } };
  return {
    yearId: year.academicYear.id,
    year3Id: year3.id,
    classAId: classA.class.id,
    classBId: classB.class.id,
    subjectId: subject.subject.id,
    typeId: types.types.find((row) => row.key === "class_test")!.id,
    schemeId: schemes.schemes.find((row) => row.key === "age_related")!.id,
    expectedId: schemes.schemes.find((row) => row.key === "age_related")!.levels.find((row) => row.code === "EX")!.id,
    periodId: period.reportingPeriod.id,
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

describe("Phase 8 assessments results and reports", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("lets a teacher enter a class grid and keeps LMS marks separate from formal results", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, id, seeded.classAId);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Sam Student",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const created = await app.request("/api/v1/assessments", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Year 3 Maths Test",
        academicYearId: seeded.yearId,
        subjectId: seeded.subjectId,
        yearGroupId: seeded.year3Id,
        assessmentTypeId: seeded.typeId,
        assessmentDate: "2026-10-14",
        maximumMarks: 20,
        gradeSchemeId: seeded.schemeId,
        classIds: [seeded.classAId],
        internalNotes: "Do not share this moderation note.",
      }),
    });
    expect(created.status).toBe(201);
    const assessment = (await created.json()) as { assessment: { id: string } };
    expect((await app.request(`/api/v1/assessments/${assessment.assessment.id}/open`, { method: "POST", headers: hdrs, body: "{}" })).status).toBe(200);
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const teacherHdrs = headers(teacherToken, school.orgId);
    const entered = await app.request(`/api/v1/assessments/${assessment.assessment.id}/results`, {
      method: "PUT",
      headers: teacherHdrs,
      body: JSON.stringify({
        results: [
          {
            studentProfileId: pupil.student.id,
            rawScore: 18,
            gradeSchemeLevelId: seeded.expectedId,
            comment: "Secure",
            releasedToStudent: true,
            releasedToParent: true,
            enteredBy: school.adminId,
            enteredAt: "2000-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
    expect(entered.status).toBe(200);
    await app.request(`/api/v1/assessments/${assessment.assessment.id}/complete`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect((await app.request(`/api/v1/assessments/${assessment.assessment.id}/publish`, { method: "POST", headers: hdrs, body: "{}" })).status).toBe(200);
    const detail = (await (
      await app.request(`/api/v1/assessments/${assessment.assessment.id}/results`, { headers: hdrs })
    ).json()) as { pupils: Array<{ result: { enteredBy: string; rawScore: number } | null }> };
    expect(detail.pupils[0]?.result?.rawScore).toBe(18);
    expect(detail.pupils[0]?.result?.enteredBy).not.toBe("2000-01-01T00:00:00.000Z");
    expect(detail.pupils[0]?.result?.enteredBy).not.toBe(school.adminId);

    const marks = await pools.owner.query("select count(*)::text as n from learning_marks where organisation_id = $1", [
      school.orgId,
    ]);
    expect(marks.rows[0]?.n).toBe("0");
    const formal = await pools.owner.query("select count(*)::text as n from academic_results where organisation_id = $1", [
      school.orgId,
    ]);
    expect(formal.rows[0]?.n).toBe("1");
  });

  it("isolates schools, assigned teachers, parents, and students", async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, `${id}a`);
    const schoolB = await createSchool(pools.owner, `${id}b`);
    const tokenA = await login(app, schoolA.adminEmail, "password-12x");
    const tokenB = await login(app, schoolB.adminEmail, "password-12x");
    const hdrsA = headers(tokenA, schoolA.orgId);
    const hdrsB = headers(tokenB, schoolB.orgId);
    const seededA = await seedStructure(app, hdrsA);
    const seededB = await seedStructure(app, hdrsB);
    const teacher = await inviteTeacher(app, hdrsA, `${id}t`, seededA.classAId);
    const otherTeacher = await inviteTeacher(app, hdrsA, `${id}u`, seededA.classBId);
    const pupil = await createStudent(app, hdrsA, {
      legalName: "Amelia Test",
      academicYearId: seededA.yearId,
      yearGroupId: seededA.year3Id,
      classId: seededA.classAId,
      loginAlias: `amelia-${id}`,
      password: "student-pass-1",
    });
    const outsider = await createStudent(app, hdrsA, {
      legalName: "Other Class",
      academicYearId: seededA.yearId,
      yearGroupId: seededA.year3Id,
      classId: seededA.classBId,
    });
    const created = await app.request("/api/v1/assessments", {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({
        title: "Private 3A test",
        academicYearId: seededA.yearId,
        subjectId: seededA.subjectId,
        yearGroupId: seededA.year3Id,
        assessmentTypeId: seededA.typeId,
        assessmentDate: "2026-10-14",
        maximumMarks: 10,
        gradeSchemeId: seededA.schemeId,
        classIds: [seededA.classAId],
        internalNotes: "Teacher-only note",
      }),
    });
    const assessment = (await created.json()) as { assessment: { id: string } };
    await app.request(`/api/v1/assessments/${assessment.assessment.id}/open`, {
      method: "POST",
      headers: hdrsA,
      body: "{}",
    });

    expect(
      (
        await app.request(`/api/v1/assessments/${assessment.assessment.id}`, {
          headers: hdrsB,
        })
      ).status,
    ).toBe(404);

    const otherToken = await login(app, otherTeacher.email, "teacher-pass-1");
    const otherHdrs = headers(otherToken, schoolA.orgId);
    expect(
      (await app.request(`/api/v1/assessments/${assessment.assessment.id}`, { headers: otherHdrs })).status,
    ).toBe(404);
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const teacherHdrs = headers(teacherToken, schoolA.orgId);
    expect(
      (await app.request(`/api/v1/assessments/${assessment.assessment.id}`, { headers: teacherHdrs })).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/assessments/${assessment.assessment.id}/results`, {
          method: "PUT",
          headers: teacherHdrs,
          body: JSON.stringify({
            results: [{ studentProfileId: outsider.student.id, rawScore: 9 }],
          }),
        })
      ).status,
    ).toBe(404);

    await app.request(`/api/v1/assessments/${assessment.assessment.id}/results`, {
      method: "PUT",
      headers: teacherHdrs,
      body: JSON.stringify({
        results: [
          {
            studentProfileId: pupil.student.id,
            rawScore: 8,
            comment: "Well done",
            releasedToStudent: true,
            releasedToParent: false,
          },
        ],
      }),
    });
    await app.request(`/api/v1/assessments/${assessment.assessment.id}/complete`, {
      method: "POST",
      headers: hdrsA,
      body: "{}",
    });
    await app.request(`/api/v1/assessments/${assessment.assessment.id}/publish`, {
      method: "POST",
      headers: hdrsA,
      body: "{}",
    });

    const parentId = await insertUser(pools.owner, {
      email: `parent-${id}@example.com`,
      password: "parent-pass-1",
      fullName: "Pat Parent",
      kind: "parent",
    });
    await addMembership(pools.owner, schoolA.orgId, parentId, "school.parent");
    await pools.owner.query(
      `insert into guardianships (
         organisation_id, student_profile_id, guardian_user_id, relationship, portal_access
       ) values ($1, $2, $3, 'mother', true)`,
      [schoolA.orgId, pupil.student.id, parentId],
    );
    const blockedParent = await insertUser(pools.owner, {
      email: `blocked-${id}@example.com`,
      password: "parent-pass-1",
      fullName: "Blocked Parent",
      kind: "parent",
    });
    await addMembership(pools.owner, schoolA.orgId, blockedParent, "school.parent");
    await pools.owner.query(
      `insert into guardianships (
         organisation_id, student_profile_id, guardian_user_id, relationship, portal_access
       ) values ($1, $2, $3, 'father', false)`,
      [schoolA.orgId, pupil.student.id, blockedParent],
    );
    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    const parentHdrs = headers(parentToken, schoolA.orgId);
    const parentResults = await app.request(`/api/v1/parent/children/${pupil.student.id}/results`, {
      headers: parentHdrs,
    });
    expect(parentResults.status).toBe(200);
    const parentBody = (await parentResults.json()) as { results: unknown[] };
    expect(parentBody.results).toEqual([]);
    assertPortalSafe(parentBody);
    expect(JSON.stringify(parentBody)).not.toContain("Teacher-only note");
    expect(JSON.stringify(parentBody)).not.toContain("internalNotes");

    const blockedToken = await login(app, `blocked-${id}@example.com`, "parent-pass-1");
    expect(
      (
        await app.request(`/api/v1/parent/children/${pupil.student.id}/results`, {
          headers: headers(blockedToken, schoolA.orgId),
        })
      ).status,
    ).toBe(404);

    const studentToken = await loginAlias(app, schoolA.slug, `amelia-${id}`, "student-pass-1");
    const studentHdrs = headers(studentToken, schoolA.orgId);
    const studentResults = await app.request("/api/v1/student/results", { headers: studentHdrs });
    expect(studentResults.status).toBe(200);
    const studentBody = (await studentResults.json()) as { results: Array<{ rawScore: number | null; comment: string | null }> };
    expect(studentBody.results).toHaveLength(1);
    expect(studentBody.results[0]?.rawScore).toBe(8);
    assertPortalSafe(studentBody);
    expect(JSON.stringify(studentBody)).not.toContain("Teacher-only note");
    expect(JSON.stringify(studentBody)).not.toContain("internalReviewNote");

    await withTenantContext(pools.app, schoolA.adminId, schoolA.orgId, async (client) => {
      const leaked = await client.query("select id from academic_assessments where organisation_id = $1", [
        schoolB.orgId,
      ]);
      expect(leaked.rows).toHaveLength(0);
    });
  });

  it("blocks withdrawn pupils and disabled student portal from results", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Withdrawn Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `withdrawn-${id}`,
      password: "student-pass-1",
    });
    const created = await app.request("/api/v1/assessments", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Baseline",
        academicYearId: seeded.yearId,
        subjectId: seeded.subjectId,
        yearGroupId: seeded.year3Id,
        assessmentTypeId: seeded.typeId,
        assessmentDate: "2026-09-10",
        classIds: [seeded.classAId],
      }),
    });
    const assessment = (await created.json()) as { assessment: { id: string } };
    await app.request(`/api/v1/assessments/${assessment.assessment.id}/open`, { method: "POST", headers: hdrs, body: "{}" });
    await app.request(`/api/v1/assessments/${assessment.assessment.id}/results`, {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        results: [{ studentProfileId: pupil.student.id, rawScore: 5, releasedToStudent: true }],
      }),
    });
    await app.request(`/api/v1/assessments/${assessment.assessment.id}/complete`, { method: "POST", headers: hdrs, body: "{}" });
    await app.request(`/api/v1/assessments/${assessment.assessment.id}/publish`, { method: "POST", headers: hdrs, body: "{}" });

    const studentToken = await loginAlias(app, school.slug, `withdrawn-${id}`, "student-pass-1");
    await pools.owner.query(
      `update student_enrolments set status = 'withdrawn', ended_on = current_date
       where student_profile_id = $1`,
      [pupil.student.id],
    );
    expect(
      (await app.request("/api/v1/student/results", { headers: headers(studentToken, school.orgId) })).status,
    ).toBe(404);

    const enabled = await createStudent(app, hdrs, {
      legalName: "Portal Off",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `off-${id}`,
      password: "student-pass-1",
    });
    await app.request("/api/v1/student-portal-policy", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ defaultEnabled: false }),
    });
    const offToken = await loginAlias(app, school.slug, `off-${id}`, "student-pass-1").catch(() => null);
    if (offToken) {
      expect(
        (await app.request("/api/v1/student/results", { headers: headers(offToken, school.orgId) })).status,
      ).toBe(403);
    }
    expect(enabled.student.id).toBeTruthy();
  });

  it("publishes a report snapshot and refuses silent edits", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Report Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const created = await app.request("/api/v1/reports", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        studentProfileId: pupil.student.id,
        academicYearId: seeded.yearId,
        reportingPeriodId: seeded.periodId,
        generalComment: "Original published comment",
      }),
    });
    expect(created.status).toBe(201);
    const report = (await created.json()) as { report: { id: string } };
    await app.request(`/api/v1/reports/${report.report.id}/sections`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        subjectId: seeded.subjectId,
        teacherComment: "Working at expected.",
      }),
    });
    expect(
      (await app.request(`/api/v1/reports/${report.report.id}/publish`, { method: "POST", headers: hdrs, body: "{}" })).status,
    ).toBe(200);
    const locked = await app.request(`/api/v1/reports/${report.report.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ generalComment: "Silent rewrite" }),
    });
    expect(locked.status).toBe(409);

    const parentId = await insertUser(pools.owner, {
      email: `report-parent-${id}@example.com`,
      password: "parent-pass-1",
      fullName: "Report Parent",
      kind: "parent",
    });
    await addMembership(pools.owner, school.orgId, parentId, "school.parent");
    await pools.owner.query(
      `insert into guardianships (
         organisation_id, student_profile_id, guardian_user_id, relationship, portal_access
       ) values ($1, $2, $3, 'mother', true)`,
      [school.orgId, pupil.student.id, parentId],
    );
    const parentToken = await login(app, `report-parent-${id}@example.com`, "parent-pass-1");
    const published = (await (
      await app.request(`/api/v1/parent/children/${pupil.student.id}/reports`, {
        headers: headers(parentToken, school.orgId),
      })
    ).json()) as { reports: Array<{ generalComment: string | null }> };
    expect(published.reports[0]?.generalComment).toBe("Original published comment");
  });

  it("does not let teachers publish reports without reports.publish", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, id, seeded.classAId);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Assign Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const teacherHdrs = headers(teacherToken, school.orgId);
    const created = await app.request("/api/v1/reports", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        studentProfileId: pupil.student.id,
        academicYearId: seeded.yearId,
        reportingPeriodId: seeded.periodId,
      }),
    });
    expect(created.status).toBe(201);
    const report = (await created.json()) as { report: { id: string } };
    expect(
      (await app.request(`/api/v1/reports/${report.report.id}/publish`, { method: "POST", headers: teacherHdrs, body: "{}" })).status,
    ).toBe(403);
  });
});
