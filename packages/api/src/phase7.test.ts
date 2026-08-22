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
    [`p7-${id}`, `Phase7 ${id}`],
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

async function seedStructure(
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

describe("Phase 7 teaching and learning", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("publishes targeted work, snapshots recipients, and keeps work after a class move", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Sam Student",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const created = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Year 3 Fractions",
        description: "Complete the worksheet",
        workTypeKey: "homework",
        subjectId: seeded.subjectId,
        teacherNotes: "Private support note",
        maximumMarks: 20,
        dueAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        targets: [{ targetType: "class", classId: seeded.classAId }],
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { assignment: { id: string; status: string } };
    expect(createdBody.assignment.status).toBe("draft");

    const published = await app.request(`/api/v1/learning/assignments/${createdBody.assignment.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(published.status).toBe(200);
    const progress = (await published.json()) as { assignment: { progress: { assigned: number } } };
    expect(progress.assignment.progress.assigned).toBe(1);

    const moved = await app.request(`/api/v1/students/${pupil.student.id}/class-memberships`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ classId: seeded.classBId, startedOn: "2026-09-08" }),
    });
    expect(moved.status).toBe(201);
    const still = await app.request(`/api/v1/learning/assignments/${createdBody.assignment.id}/progress`, {
      headers: hdrs,
    });
    const stillBody = (await still.json()) as { assigned: number };
    expect(stillBody.assigned).toBe(1);
    const afterMove = await app.request(`/api/v1/learning/assignments/${createdBody.assignment.id}/submissions`, {
      headers: hdrs,
    });
    const afterMoveBody = (await afterMove.json()) as {
      submissions: Array<{ studentProfileId: string }>;
    };
    expect(afterMoveBody.submissions.map((row) => row.studentProfileId)).toContain(pupil.student.id);
  });

  it("stops a teacher assigning or reading work outside assigned classes and other schools", async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, `a-${id}`);
    const schoolB = await createSchool(pools.owner, `b-${id}`);
    const adminA = await login(app, schoolA.adminEmail, "password-12x");
    const adminB = await login(app, schoolB.adminEmail, "password-12x");
    const hdrsA = headers(adminA, schoolA.orgId);
    const hdrsB = headers(adminB, schoolB.orgId);
    const seededA = await seedStructure(app, hdrsA);
    const seededB = await seedStructure(app, hdrsB);
    await inviteTeacher(app, hdrsA, id, seededA.classAId);
    const teacherToken = await login(app, `teacher-${id}@example.com`, "teacher-pass-1");
    const teacherHdrs = headers(teacherToken, schoolA.orgId);
    const pupilBclass = await createStudent(app, hdrsA, {
      legalName: "Other Class",
      academicYearId: seededA.yearId,
      yearGroupId: seededA.year3Id,
      classId: seededA.classBId,
    });
    const foreign = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        title: "Should fail",
        workTypeKey: "homework",
        targets: [{ targetType: "class", classId: seededA.classBId }],
      }),
    });
    expect(foreign.status).toBe(404);

    const yearGroup = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        title: "Year group",
        workTypeKey: "homework",
        targets: [{ targetType: "year_group", yearGroupId: seededA.year3Id }],
      }),
    });
    expect(yearGroup.status).toBe(403);

    const otherSchool = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        title: "Cross school",
        workTypeKey: "homework",
        targets: [{ targetType: "class", classId: seededB.classAId }],
      }),
    });
    expect(otherSchool.status).toBe(404);

    const foreignYear = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({
        title: "Foreign year group",
        workTypeKey: "homework",
        targets: [{ targetType: "year_group", yearGroupId: seededB.year3Id }],
      }),
    });
    expect(foreignYear.status).toBe(404);

    const created = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: hdrsB,
      body: JSON.stringify({
        title: "Oak work",
        workTypeKey: "homework",
        targets: [{ targetType: "class", classId: seededB.classAId }],
      }),
    });
    const oak = (await created.json()) as { assignment: { id: string } };
    const leak = await app.request(`/api/v1/learning/assignments/${oak.assignment.id}`, {
      headers: hdrsA,
    });
    expect(leak.status).toBe(404);

    const studentTarget = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        title: "Pupil target",
        workTypeKey: "homework",
        targets: [{ targetType: "student", studentProfileId: pupilBclass.student.id }],
      }),
    });
    expect(studentTarget.status).toBe(404);
  });

  it("lets a teacher see original class recipients after a move, but not another class on shared work", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    await inviteTeacher(app, hdrs, id, seeded.classAId);
    const teacherToken = await login(app, `teacher-${id}@example.com`, "teacher-pass-1");
    const teacherHdrs = headers(teacherToken, school.orgId);
    const pupilA = await createStudent(app, hdrs, {
      legalName: "Class A Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const pupilB = await createStudent(app, hdrs, {
      legalName: "Class B Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classBId,
    });
    const created = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Year 3 shared",
        workTypeKey: "homework",
        targets: [
          { targetType: "class", classId: seeded.classAId },
          { targetType: "class", classId: seeded.classBId },
        ],
      }),
    });
    const assignment = (await created.json()) as { assignment: { id: string } };
    await app.request(`/api/v1/learning/assignments/${assignment.assignment.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    await app.request(`/api/v1/students/${pupilA.student.id}/class-memberships`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ classId: seeded.classBId, startedOn: "2026-09-08" }),
    });
    const listed = await app.request(
      `/api/v1/learning/assignments/${assignment.assignment.id}/submissions`,
      { headers: teacherHdrs },
    );
    const body = (await listed.json()) as {
      submissions: Array<{ studentProfileId: string }>;
    };
    const ids = body.submissions.map((row) => row.studentProfileId);
    expect(ids).toContain(pupilA.student.id);
    expect(ids).not.toContain(pupilB.student.id);
    const close = await app.request(`/api/v1/learning/assignments/${assignment.assignment.id}/close`, {
      method: "POST",
      headers: teacherHdrs,
      body: "{}",
    });
    expect(close.status).toBe(404);
  });

  it("lets a teacher create, publish, and close work they created for an assigned class", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    await inviteTeacher(app, hdrs, id, seeded.classAId);
    const teacherToken = await login(app, `teacher-${id}@example.com`, "teacher-pass-1");
    const teacherHdrs = headers(teacherToken, school.orgId);
    const created = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        title: "My class practice",
        workTypeKey: "practice",
        targets: [{ targetType: "class", classId: seeded.classAId }],
      }),
    });
    expect(created.status).toBe(201);
    const assignment = (await created.json()) as { assignment: { id: string } };
    const published = await app.request(
      `/api/v1/learning/assignments/${assignment.assignment.id}/publish`,
      { method: "POST", headers: teacherHdrs, body: "{}" },
    );
    expect(published.status).toBe(200);
    const closed = await app.request(`/api/v1/learning/assignments/${assignment.assignment.id}/close`, {
      method: "POST",
      headers: teacherHdrs,
      body: "{}",
    });
    expect(closed.status).toBe(200);
  });

  it("persists student draft text before submit", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    await createStudent(app, hdrs, {
      legalName: "Draft Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `dft.${id}`,
      password: "student-pass-1",
    });
    const created = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Draftable",
        workTypeKey: "practice",
        targets: [{ targetType: "class", classId: seeded.classAId }],
      }),
    });
    const assignment = (await created.json()) as { assignment: { id: string } };
    await app.request(`/api/v1/learning/assignments/${assignment.assignment.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    const studentToken = await loginAlias(app, school.slug, `dft.${id}`, "student-pass-1");
    const studentHdrs = headers(studentToken, school.orgId);
    const draft = await app.request(
      `/api/v1/student/assignments/${assignment.assignment.id}/submissions`,
      {
        method: "POST",
        headers: studentHdrs,
        body: JSON.stringify({ textResponse: "Working it out", submit: false }),
      },
    );
    expect(draft.status).toBe(200);
    const saved = (await draft.json()) as {
      assignment: { submission: { status: string; textResponse: string } };
    };
    expect(saved.assignment.submission.status).toBe("in_progress");
    expect(saved.assignment.submission.textResponse).toBe("Working it out");
  });

  it("hides teacher notes and unreleased marks from pupil and parent APIs", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Test",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `amy.${id}`,
      password: "student-pass-1",
    });
    const other = await createStudent(app, hdrs, {
      legalName: "Other Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `oth.${id}`,
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
    const blockedGuardian = await app.request(`/api/v1/students/${other.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `blocked-${id}@example.com`,
        fullName: "Blocked Parent",
        relationship: "father",
        portalAccess: false,
      }),
    });
    expect(blockedGuardian.status).toBe(201);
    const blockedInvite = (await blockedGuardian.json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: blockedInvite.invitationToken,
        fullName: "Blocked Parent",
        password: "parent-pass-1",
      }),
    });

    const created = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Reading journal",
        description: "Write three sentences",
        workTypeKey: "reading",
        teacherNotes: "Do not show this note",
        maximumMarks: 10,
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        targets: [{ targetType: "class", classId: seeded.classAId }],
      }),
    });
    const assignment = (await created.json()) as { assignment: { id: string } };
    await app.request(`/api/v1/learning/assignments/${assignment.assignment.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });

    const studentToken = await loginAlias(app, school.slug, `amy.${id}`, "student-pass-1");
    const studentHdrs = headers(studentToken, school.orgId);
    const listed = await app.request("/api/v1/student/assignments", { headers: studentHdrs });
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as { assignments: Array<{ id: string; teacherNotes?: string }> };
    expect(listedBody.assignments.map((row) => row.id)).toContain(assignment.assignment.id);
    assertPortalSafe(listedBody);
    expect(JSON.stringify(listedBody)).not.toContain("Do not show this note");
    expect(JSON.stringify(listedBody)).not.toContain("teacherNotes");

    const otherToken = await loginAlias(app, school.slug, `oth.${id}`, "student-pass-1");
    const otherSubmit = await app.request(
      `/api/v1/student/assignments/${assignment.assignment.id}/submissions`,
      {
        method: "POST",
        headers: headers(otherToken, school.orgId),
        body: JSON.stringify({ textResponse: "Other pupil work", submit: true }),
      },
    );
    expect(otherSubmit.status).toBe(201);

    const spoof = await app.request(`/api/v1/student/assignments/${randomUUID()}`, {
      headers: studentHdrs,
    });
    expect(spoof.status).toBe(404);

    const submitted = await app.request(
      `/api/v1/student/assignments/${assignment.assignment.id}/submissions`,
      {
        method: "POST",
        headers: studentHdrs,
        body: JSON.stringify({ textResponse: "My sentences", submit: true }),
      },
    );
    expect(submitted.status).toBe(201);

    const staffSubs = await app.request(
      `/api/v1/learning/assignments/${assignment.assignment.id}/submissions`,
      { headers: hdrs },
    );
    const staffBody = (await staffSubs.json()) as {
      submissions: Array<{ submissionId: string | null; studentProfileId: string }>;
    };
    const mine = staffBody.submissions.find((row) => row.studentProfileId === pupil.student.id);
    expect(mine?.submissionId).toBeTruthy();

    const spoofMark = await app.request(`/api/v1/learning/submissions/${mine!.submissionId}/marks`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        score: 9,
        feedback: "Well done",
        releasedToStudent: false,
        releasedToParent: false,
        markedBy: randomUUID(),
        markedAt: "1999-01-01T00:00:00.000Z",
      }),
    });
    expect(spoofMark.status).toBe(200);
    const markBody = (await spoofMark.json()) as { mark: { markedBy: string } };
    expect(markBody.mark.markedBy).toBe(school.adminId);

    const studentDetail = await app.request(`/api/v1/student/assignments/${assignment.assignment.id}`, {
      headers: studentHdrs,
    });
    const studentDetailBody = (await studentDetail.json()) as {
      assignment: { mark: unknown; teacherNotes?: string; submission: { status: string } };
    };
    expect(studentDetailBody.assignment.mark).toBeNull();
    expect(studentDetailBody.assignment.submission.status).toBe("submitted");
    expect(JSON.stringify(studentDetailBody)).not.toContain("Do not show this note");

    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    const parentHdrs = headers(parentToken, school.orgId);
    const parentList = await app.request(`/api/v1/parent/children/${pupil.student.id}/assignments`, {
      headers: parentHdrs,
    });
    expect(parentList.status).toBe(200);
    const parentBody = (await parentList.json()) as {
      assignments: Array<{ mark: unknown; submission: { status: string } }>;
    };
    assertPortalSafe(parentBody);
    expect(parentBody.assignments[0]?.mark).toBeNull();
    expect(parentBody.assignments[0]?.submission.status).not.toBe("returned");
    expect(parentBody.assignments[0]?.submission.status).not.toBe("completed");
    expect(JSON.stringify(parentBody)).not.toContain("Do not show this note");

    const otherChild = await app.request(`/api/v1/parent/children/${other.student.id}/assignments`, {
      headers: parentHdrs,
    });
    expect(otherChild.status).toBe(404);

    const blockedToken = await login(app, `blocked-${id}@example.com`, "parent-pass-1");
    const blockedList = await app.request(`/api/v1/parent/children/${other.student.id}/assignments`, {
      headers: headers(blockedToken, school.orgId),
    });
    expect(blockedList.status).toBe(404);

    await app.request(`/api/v1/learning/submissions/${mine!.submissionId}/marks`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        score: 9,
        feedback: "Well done",
        releasedToStudent: true,
        releasedToParent: true,
        status: "returned",
      }),
    });
    const released = await app.request(`/api/v1/student/assignments/${assignment.assignment.id}`, {
      headers: studentHdrs,
    });
    const releasedBody = (await released.json()) as { assignment: { mark: { score: number; feedback: string } | null } };
    expect(releasedBody.assignment.mark?.score).toBe(9);
    expect(releasedBody.assignment.mark?.feedback).toBe("Well done");
  });

  it("blocks disabled student portal and withdrawn pupils from My Learning", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Portal Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `port.${id}`,
      password: "student-pass-1",
    });
    const created = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Practice",
        workTypeKey: "practice",
        targets: [{ targetType: "class", classId: seeded.classAId }],
      }),
    });
    const assignment = (await created.json()) as { assignment: { id: string } };
    await app.request(`/api/v1/learning/assignments/${assignment.assignment.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    const studentToken = await loginAlias(app, school.slug, `port.${id}`, "student-pass-1");
    const before = await app.request("/api/v1/student/assignments", {
      headers: headers(studentToken, school.orgId),
    });
    expect(before.status).toBe(200);

    await app.request(`/api/v1/year-groups/${seeded.year3Id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ studentLoginEnabled: false }),
    });
    const disabled = await app.request("/api/v1/student/assignments", {
      headers: headers(studentToken, school.orgId),
    });
    expect(disabled.status).toBe(403);

    await app.request(`/api/v1/year-groups/${seeded.year3Id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ studentLoginEnabled: true }),
    });
    await pools.owner.query(
      `update student_enrolments
          set ended_on = started_on, status = 'withdrawn'
        where student_profile_id = $1 and academic_year_id = $2 and is_primary`,
      [pupil.student.id, seeded.yearId],
    );
    const withdrawn = await app.request("/api/v1/student/assignments", {
      headers: headers(studentToken, school.orgId),
    });
    expect(withdrawn.status).toBe(404);
  });

  it("rejects submitting to an assignment the pupil was never assigned and spoofed mark actors", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    await createStudent(app, hdrs, {
      legalName: "Assigned Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `asg.${id}`,
      password: "student-pass-1",
    });
    const outsider = await createStudent(app, hdrs, {
      legalName: "Outsider",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classBId,
      loginAlias: `out.${id}`,
      password: "student-pass-1",
    });
    const created = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Class A only",
        workTypeKey: "homework",
        targets: [{ targetType: "class", classId: seeded.classAId }],
      }),
    });
    const assignment = (await created.json()) as { assignment: { id: string } };
    await app.request(`/api/v1/learning/assignments/${assignment.assignment.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    const outsiderToken = await loginAlias(app, school.slug, `out.${id}`, "student-pass-1");
    const submit = await app.request(
      `/api/v1/student/assignments/${assignment.assignment.id}/submissions`,
      {
        method: "POST",
        headers: headers(outsiderToken, school.orgId),
        body: JSON.stringify({ textResponse: "Nope", submit: true }),
      },
    );
    expect(submit.status).toBe(404);

    const resource = await app.request(
      `/api/v1/learning/assignments/${assignment.assignment.id}/resources`,
      {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          title: "Notes",
          resourceKind: "url",
          url: "javascript:alert(1)",
        }),
      },
    );
    expect(resource.status).toBe(400);

    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const leaked = await client.query(
        "select 1 from learning_assignments where organisation_id <> $1",
        [school.orgId],
      );
      expect(leaked.rows.length).toBe(0);
    });
    expect(outsider.student.id).toBeTruthy();
  });
});
