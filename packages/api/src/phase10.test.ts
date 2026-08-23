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
    [`p10-${id}`, `Phase10 ${id}`],
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

async function inviteParent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  studentId: string,
  email: string,
  portalAccess = true,
) {
  const created = await app.request(`/api/v1/students/${studentId}/guardians`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      email,
      fullName: "Pat Parent",
      relationship: "mother",
      portalAccess,
    }),
  });
  expect(created.status).toBe(201);
  const guardian = (await created.json()) as { invitationToken: string | null; guardianshipId: string };
  if (guardian.invitationToken) {
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: guardian.invitationToken,
        fullName: "Pat Parent",
        password: "parent-pass-1",
      }),
    });
  }
  return { guardianshipId: guardian.guardianshipId };
}

describe("Phase 10 communications and calendar", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("publishes targeted notices, tracks read/ack, and keeps history after a class move", async () => {
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
      loginAlias: `sam.${id}`,
      password: "student-pass-1",
    });
    await inviteParent(app, hdrs, pupil.student.id, `parent-${id}@example.com`);
    const created = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Swimming kit",
        body: "Bring a named kit on Wednesday.",
        createdBy: randomUUID(),
        publishedBy: randomUUID(),
        acknowledgementRequired: true,
        targets: [{ targetType: "class", classId: seeded.classAId }],
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { announcement: { id: string; createdBy: string; status: string } };
    expect(createdBody.announcement.status).toBe("draft");
    expect(createdBody.announcement.createdBy).toBe(school.adminId);

    const published = await app.request(`/api/v1/announcements/${createdBody.announcement.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(published.status).toBe(200);

    await app.request(`/api/v1/students/${pupil.student.id}/class-memberships`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ classId: seeded.classBId, startedOn: "2026-09-08" }),
    });

    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    const parentHdrs = headers(parentToken, school.orgId);
    const parentList = await app.request("/api/v1/parent/announcements", { headers: parentHdrs });
    const parentBody = (await parentList.json()) as { announcements: Array<{ id: string; title: string }> };
    expect(parentBody.announcements.map((row) => row.id)).toContain(createdBody.announcement.id);

    const ack = await app.request(`/api/v1/parent/announcements/${createdBody.announcement.id}/acknowledge`, {
      method: "POST",
      headers: parentHdrs,
      body: "{}",
    });
    expect(ack.status).toBe(200);

    const receipts = await app.request(`/api/v1/announcements/${createdBody.announcement.id}/receipts`, {
      headers: hdrs,
    });
    const receiptBody = (await receipts.json()) as {
      totals: { recipients: number; acknowledged: number };
    };
    expect(receiptBody.totals.recipients).toBeGreaterThanOrEqual(1);
    expect(receiptBody.totals.acknowledged).toBeGreaterThanOrEqual(1);
  });

  it("blocks Greenwood-style cross-school access and cross-tenant target IDs", async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, `a-${id}`);
    const schoolB = await createSchool(pools.owner, `b-${id}`);
    const adminA = await login(app, schoolA.adminEmail, "password-12x");
    const adminB = await login(app, schoolB.adminEmail, "password-12x");
    const hdrsA = headers(adminA, schoolA.orgId);
    const hdrsB = headers(adminB, schoolB.orgId);
    const seededA = await seedStructure(app, hdrsA);
    const seededB = await seedStructure(app, hdrsB);

    const oak = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: hdrsB,
      body: JSON.stringify({
        title: "Oak only",
        body: "Greenwood must never see this.",
        targets: [{ targetType: "whole_school" }],
      }),
    });
    const oakBody = (await oak.json()) as { announcement: { id: string } };
    await app.request(`/api/v1/announcements/${oakBody.announcement.id}/publish`, {
      method: "POST",
      headers: hdrsB,
      body: "{}",
    });

    const leaked = await app.request(`/api/v1/announcements/${oakBody.announcement.id}`, { headers: hdrsA });
    expect(leaked.status).toBe(404);

    const crossTarget = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({
        title: "Cross school target",
        body: "Should fail closed",
        targets: [{ targetType: "class", classId: seededB.classAId }],
      }),
    });
    expect(crossTarget.status).toBe(404);

    const event = await app.request("/api/v1/calendar/events", {
      method: "POST",
      headers: hdrsB,
      body: JSON.stringify({
        title: "Oak INSET",
        eventTypeKey: "inset_day",
        startsAt: "2026-09-02T00:00:00.000Z",
        endsAt: "2026-09-02T23:59:00.000Z",
        targets: [{ targetType: "whole_school" }],
      }),
    });
    const eventBody = (await event.json()) as { event: { id: string } };
    const leakedEvent = await app.request(`/api/v1/calendar/events/${eventBody.event.id}`, { headers: hdrsA });
    expect(leakedEvent.status).toBe(404);

    const visibleA = await withTenantContext(pools.app, schoolA.adminId, schoolA.orgId, async (client) => {
      const rows = await client.query<{ n: string }>(
        "select count(*)::text as n from announcements where organisation_id = $1",
        [schoolB.orgId],
      );
      return rows.rows[0]?.n;
    });
    expect(visibleA).toBe("0");
    void seededA;
  });

  it("stops a teacher broadcasting school-wide or targeting unassigned pupils", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    await inviteTeacher(app, hdrs, id, seeded.classAId);
    const teacherToken = await login(app, `teacher-${id}@example.com`, "teacher-pass-1");
    const teacherHdrs = headers(teacherToken, school.orgId);
    const otherPupil = await createStudent(app, hdrs, {
      legalName: "Other Class",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classBId,
    });

    const broadcast = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        title: "Whole school",
        body: "Teachers cannot broadcast",
        targets: [{ targetType: "whole_school" }],
      }),
    });
    expect(broadcast.status).toBe(403);

    const yearGroup = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        title: "Year group",
        body: "Also broadcast",
        targets: [{ targetType: "year_group", yearGroupId: seeded.year3Id }],
      }),
    });
    expect(yearGroup.status).toBe(403);

    const otherClass = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        title: "Other class",
        body: "Not assigned",
        targets: [{ targetType: "class", classId: seeded.classBId }],
      }),
    });
    expect(otherClass.status).toBe(404);

    const otherStudent = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        title: "Other pupil",
        body: "Not assigned",
        targets: [{ targetType: "student", studentProfileId: otherPupil.student.id }],
      }),
    });
    expect(otherStudent.status).toBe(404);

    const ownClass = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        title: "My class",
        body: "Assigned class notice",
        targets: [{ targetType: "class", classId: seeded.classAId }],
      }),
    });
    expect(ownClass.status).toBe(201);

    const adminDraft = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Unpublished whole school",
        body: "Teachers must not see this draft",
        targets: [{ targetType: "whole_school" }],
      }),
    });
    const adminDraftBody = (await adminDraft.json()) as { announcement: { id: string } };
    const leakedDraft = await app.request(`/api/v1/announcements/${adminDraftBody.announcement.id}`, {
      headers: teacherHdrs,
    });
    expect(leakedDraft.status).toBe(404);
    const teacherList = await app.request("/api/v1/announcements", { headers: teacherHdrs });
    const teacherItems = (await teacherList.json()) as { announcements: Array<{ id: string }> };
    expect(teacherItems.announcements.map((row) => row.id)).not.toContain(adminDraftBody.announcement.id);
  });

  it("keeps parent and student visibility scoped and never leaks staff-only fields", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Visible",
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
      classId: seeded.classBId,
      loginAlias: `oth.${id}`,
      password: "student-pass-1",
    });
    await inviteParent(app, hdrs, pupil.student.id, `parent-${id}@example.com`);
    await inviteParent(app, hdrs, pupil.student.id, `blocked-${id}@example.com`, false);

    const staffOnly = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Staff briefing",
        body: "Internal only",
        targets: [{ targetType: "staff" }],
        resources: [{ title: "Agenda", resourceKind: "url", url: "https://example.com/staff-agenda" }],
      }),
    });
    const staffBody = (await staffOnly.json()) as { announcement: { id: string } };
    await app.request(`/api/v1/announcements/${staffBody.announcement.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });

    const classNotice = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Class notice",
        body: "For 3A families",
        targets: [{ targetType: "class", classId: seeded.classAId }],
      }),
    });
    const classBody = (await classNotice.json()) as { announcement: { id: string } };
    await app.request(`/api/v1/announcements/${classBody.announcement.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });

    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    const parentHdrs = headers(parentToken, school.orgId);
    const parentList = await app.request("/api/v1/parent/announcements", { headers: parentHdrs });
    const parentItems = (await parentList.json()) as { announcements: Array<{ id: string; createdBy?: string; publishedBy?: string }> };
    expect(parentItems.announcements.map((row) => row.id)).toContain(classBody.announcement.id);
    expect(parentItems.announcements.map((row) => row.id)).not.toContain(staffBody.announcement.id);
    expect(parentItems.announcements.some((row) => "createdBy" in row && row.createdBy)).toBe(false);

    const blockedToken = await login(app, `blocked-${id}@example.com`, "parent-pass-1");
    const blocked = await app.request("/api/v1/parent/announcements", {
      headers: headers(blockedToken, school.orgId),
    });
    expect(blocked.status).toBe(200);
    const blockedBody = (await blocked.json()) as { announcements: Array<{ id: string }> };
    expect(blockedBody.announcements.map((row) => row.id)).not.toContain(classBody.announcement.id);

    const studentToken = await loginAlias(app, school.slug, `amy.${id}`, "student-pass-1");
    const studentHdrs = headers(studentToken, school.orgId);
    const studentList = await app.request("/api/v1/student/announcements", { headers: studentHdrs });
    const studentItems = (await studentList.json()) as { announcements: Array<{ id: string; storageKey?: string }> };
    expect(studentItems.announcements.map((row) => row.id)).toContain(classBody.announcement.id);
    expect(studentItems.announcements.map((row) => row.id)).not.toContain(staffBody.announcement.id);

    const otherStudent = await loginAlias(app, school.slug, `oth.${id}`, "student-pass-1");
    const otherList = await app.request("/api/v1/student/announcements", {
      headers: headers(otherStudent, school.orgId),
    });
    const otherItems = (await otherList.json()) as { announcements: Array<{ id: string }> };
    expect(otherItems.announcements.map((row) => row.id)).not.toContain(classBody.announcement.id);
  });

  it("blocks disabled student portal and withdrawn pupils, and prevents ack spoofing", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Portal Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `prt.${id}`,
      password: "student-pass-1",
    });
    await inviteParent(app, hdrs, pupil.student.id, `p1-${id}@example.com`);
    await inviteParent(app, hdrs, pupil.student.id, `p2-${id}@example.com`);

    const notice = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Please acknowledge",
        body: "Policy reminder",
        acknowledgementRequired: true,
        targets: [{ targetType: "whole_school" }],
      }),
    });
    const noticeBody = (await notice.json()) as { announcement: { id: string } };
    await app.request(`/api/v1/announcements/${noticeBody.announcement.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });

    const parent1 = await login(app, `p1-${id}@example.com`, "parent-pass-1");
    const parent2 = await login(app, `p2-${id}@example.com`, "parent-pass-1");
    const ack = await app.request(`/api/v1/parent/announcements/${noticeBody.announcement.id}/acknowledge`, {
      method: "POST",
      headers: headers(parent1, school.orgId),
      body: JSON.stringify({ userId: "other", acknowledgedAt: "2020-01-01T00:00:00.000Z" }),
    });
    expect(ack.status).toBe(200);
    const receipts = await app.request(`/api/v1/announcements/${noticeBody.announcement.id}/receipts`, {
      headers: hdrs,
    });
    const receiptBody = (await receipts.json()) as {
      recipients: Array<{ name: string; acknowledgedAt: string | null }>;
    };
    const acknowledged = receiptBody.recipients.filter((row) => row.acknowledgedAt);
    expect(acknowledged).toHaveLength(1);

    const parent2Ack = await app.request(`/api/v1/parent/announcements/${noticeBody.announcement.id}/acknowledge`, {
      method: "POST",
      headers: headers(parent2, school.orgId),
      body: "{}",
    });
    expect(parent2Ack.status).toBe(200);

    const studentToken = await loginAlias(app, school.slug, `prt.${id}`, "student-pass-1");
    await app.request(`/api/v1/year-groups/${seeded.year3Id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ studentLoginEnabled: false }),
    });
    const disabled = await app.request("/api/v1/student/announcements", {
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
       where student_profile_id = $1`,
      [pupil.student.id],
    );
    const withdrawn = await app.request("/api/v1/student/calendar/events", {
      headers: headers(studentToken, school.orgId),
    });
    expect(withdrawn.status).toBe(404);
  });

  it("activates scheduled announcements on read and hides expired items from portals", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Sched Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `sch.${id}`,
      password: "student-pass-1",
    });
    await inviteParent(app, hdrs, pupil.student.id, `sched-${id}@example.com`);

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const created = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Scheduled notice",
        body: "Should appear after activation",
        publishAt: future,
        targets: [{ targetType: "parents" }],
      }),
    });
    const createdBody = (await created.json()) as { announcement: { id: string } };
    const scheduled = await app.request(`/api/v1/announcements/${createdBody.announcement.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ publishAt: future }),
    });
    expect(scheduled.status).toBe(200);
    await pools.owner.query("update announcements set publish_at = now() - interval '1 minute' where id = $1", [
      createdBody.announcement.id,
    ]);

    const parentToken = await login(app, `sched-${id}@example.com`, "parent-pass-1");
    const parentHdrs = headers(parentToken, school.orgId);
    const activatedList = await app.request("/api/v1/parent/announcements", { headers: parentHdrs });
    expect(activatedList.status).toBe(200);
    const activated = await app.request(`/api/v1/announcements/${createdBody.announcement.id}`, { headers: hdrs });
    const activatedBody = (await activated.json()) as {
      announcement: { status: string; publishedBy: string };
    };
    expect(activatedBody.announcement.status).toBe("published");
    expect(activatedBody.announcement.publishedBy).toBe(school.adminId);

    const laterExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const expired = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Expired notice",
        body: "Should leave active portal lists",
        expiresAt: laterExpiry,
        targets: [{ targetType: "parents" }],
      }),
    });
    const expiredBody = (await expired.json()) as { announcement: { id: string } };
    await app.request(`/api/v1/announcements/${expiredBody.announcement.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    await pools.owner.query(
      `update announcements
       set publish_at = now() - interval '2 minutes',
           expires_at = now() - interval '1 minute'
       where id = $1`,
      [expiredBody.announcement.id],
    );
    await app.request("/api/v1/announcements", { headers: hdrs });

    const parentList = await app.request("/api/v1/parent/announcements", {
      headers: parentHdrs,
    });
    const parentItems = (await parentList.json()) as { announcements: Array<{ id: string }> };
    expect(parentItems.announcements.map((row) => row.id)).toContain(createdBody.announcement.id);
    expect(parentItems.announcements.map((row) => row.id)).not.toContain(expiredBody.announcement.id);

    const staffExpired = await app.request(`/api/v1/announcements/${expiredBody.announcement.id}`, { headers: hdrs });
    expect(staffExpired.status).toBe(200);
  });

  it("re-checks live portal_access so revoked guardians cannot read or acknowledge old snapshots", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const pupilA = await createStudent(app, hdrs, {
      legalName: "Child A",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const pupilB = await createStudent(app, hdrs, {
      legalName: "Child B",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classBId,
    });
    const parentA = await inviteParent(app, hdrs, pupilA.student.id, `revoked-${id}@example.com`);
    await inviteParent(app, hdrs, pupilB.student.id, `revoked-${id}@example.com`);

    const noticeA = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Class A only",
        body: "Should vanish when A is revoked",
        acknowledgementRequired: true,
        targets: [{ targetType: "class", classId: seeded.classAId }],
      }),
    });
    const noticeABody = (await noticeA.json()) as { announcement: { id: string } };
    await app.request(`/api/v1/announcements/${noticeABody.announcement.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });

    const noticeB = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Class B only",
        body: "Should remain while B is authorised",
        targets: [{ targetType: "class", classId: seeded.classBId }],
      }),
    });
    const noticeBBody = (await noticeB.json()) as { announcement: { id: string } };
    await app.request(`/api/v1/announcements/${noticeBBody.announcement.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });

    const eventA = await app.request("/api/v1/calendar/events", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Class A trip",
        eventTypeKey: "trip",
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-01T15:00:00.000Z",
        targets: [{ targetType: "class", classId: seeded.classAId }],
      }),
    });
    const eventABody = (await eventA.json()) as { event: { id: string } };
    await app.request(`/api/v1/calendar/events/${eventABody.event.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });

    const parentToken = await login(app, `revoked-${id}@example.com`, "parent-pass-1");
    const parentHdrs = headers(parentToken, school.orgId);
    const before = await app.request("/api/v1/parent/announcements", { headers: parentHdrs });
    const beforeBody = (await before.json()) as { announcements: Array<{ id: string }> };
    expect(beforeBody.announcements.map((row) => row.id)).toEqual(
      expect.arrayContaining([noticeABody.announcement.id, noticeBBody.announcement.id]),
    );

    await app.request(`/api/v1/guardianships/${parentA.guardianshipId}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ portalAccess: false }),
    });

    const after = await app.request("/api/v1/parent/announcements", { headers: parentHdrs });
    const afterBody = (await after.json()) as { announcements: Array<{ id: string }> };
    expect(afterBody.announcements.map((row) => row.id)).toContain(noticeBBody.announcement.id);
    expect(afterBody.announcements.map((row) => row.id)).not.toContain(noticeABody.announcement.id);

    const hidden = await app.request(`/api/v1/parent/announcements/${noticeABody.announcement.id}`, {
      headers: parentHdrs,
    });
    expect(hidden.status).toBe(404);
    const ack = await app.request(`/api/v1/parent/announcements/${noticeABody.announcement.id}/acknowledge`, {
      method: "POST",
      headers: parentHdrs,
      body: "{}",
    });
    expect(ack.status).toBe(404);

    const events = await app.request("/api/v1/parent/calendar/events", { headers: parentHdrs });
    const eventsBody = (await events.json()) as { events: Array<{ id: string }> };
    expect(eventsBody.events.map((row) => row.id)).not.toContain(eventABody.event.id);
  });

  it("lets a staff guardian still see family notices on the parent portal", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(adminToken, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Staff Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    await inviteTeacher(app, hdrs, id, seeded.classAId);
    const teacher = await pools.owner.query<{ id: string }>("select id from users where email = $1", [
      `teacher-${id}@example.com`,
    ]);
    await pools.owner.query(
      `insert into membership_roles (membership_id, role_id)
       select m.id, r.id
       from organisation_memberships m
       join roles r on r.key = 'school.parent' and r.organisation_id is null
       where m.organisation_id = $1 and m.user_id = $2
       on conflict do nothing`,
      [school.orgId, teacher.rows[0]!.id],
    );
    await inviteParent(app, hdrs, pupil.student.id, `teacher-${id}@example.com`);
    const pupilB = await createStudent(app, hdrs, {
      legalName: "Unassigned Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classBId,
    });
    const parentB = await inviteParent(app, hdrs, pupilB.student.id, `teacher-${id}@example.com`);

    const classBNotice = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Class B family only",
        body: "Assigned-only staff must not see this via a parent snapshot",
        targets: [{ targetType: "class", classId: seeded.classBId }],
      }),
    });
    const classBBody = (await classBNotice.json()) as { announcement: { id: string } };
    await app.request(`/api/v1/announcements/${classBBody.announcement.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });

    const notice = await app.request("/api/v1/announcements", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Whole school family notice",
        body: "Staff who are also parents must still see this",
        targets: [{ targetType: "whole_school" }],
      }),
    });
    const noticeBody = (await notice.json()) as { announcement: { id: string } };
    await app.request(`/api/v1/announcements/${noticeBody.announcement.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });

    const teacherToken = await login(app, `teacher-${id}@example.com`, "teacher-pass-1");
    const parentList = await app.request("/api/v1/parent/announcements", {
      headers: headers(teacherToken, school.orgId),
    });
    expect(parentList.status).toBe(200);
    const parentItems = (await parentList.json()) as { announcements: Array<{ id: string }> };
    expect(parentItems.announcements.map((row) => row.id)).toContain(noticeBody.announcement.id);
    expect(parentItems.announcements.map((row) => row.id)).toContain(classBBody.announcement.id);

    const staffLeak = await app.request(`/api/v1/announcements/${classBBody.announcement.id}`, {
      headers: headers(teacherToken, school.orgId),
    });
    expect(staffLeak.status).toBe(404);

    await app.request(`/api/v1/guardianships/${parentB.guardianshipId}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ portalAccess: false }),
    });
    const afterRevoke = await app.request("/api/v1/parent/announcements", {
      headers: headers(teacherToken, school.orgId),
    });
    const afterBody = (await afterRevoke.json()) as { announcements: Array<{ id: string }> };
    expect(afterBody.announcements.map((row) => row.id)).not.toContain(classBBody.announcement.id);
    const staffAfter = await app.request(`/api/v1/announcements/${classBBody.announcement.id}`, {
      headers: headers(teacherToken, school.orgId),
    });
    expect(staffAfter.status).toBe(404);
  });
});
