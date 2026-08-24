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
  testObjectStorage,
  testPools,
} from "./test-helpers";
import { cleanupStoredObjects } from "./stored-object-cleanup";

const suffix = () => randomUUID().slice(0, 8);
const PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF\n");

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string, prefix = "p14") {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`${prefix}-${id}`, `Phase14 ${id}`],
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

function headers(token: string, orgId: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    ...extra,
  };
}

function jsonHeaders(token: string, orgId: string) {
  return { ...headers(token, orgId), "Content-Type": "application/json" };
}

function pdfForm(fields: Record<string, string>, filename = "letter.pdf") {
  const form = new FormData();
  form.append("file", new Blob([PDF], { type: "application/pdf" }), filename);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

async function seedStructure(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof jsonHeaders>) {
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
  hdrs: ReturnType<typeof jsonHeaders>,
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
  hdrs: ReturnType<typeof jsonHeaders>,
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
  hdrs: ReturnType<typeof jsonHeaders>,
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
      hasParentalResponsibility: true,
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

async function createTrip(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
  input: Record<string, unknown>,
) {
  const created = await app.request("/api/v1/activities", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      title: "Museum trip",
      activityTypeKey: "trip",
      startsAt: "2026-11-12T09:00:00.000Z",
      endsAt: "2026-11-12T15:30:00.000Z",
      consentRequired: true,
      capacity: 20,
      ...input,
    }),
  });
  expect(created.status, await created.text()).toBe(201);
  return (await created.json()) as {
    activity: { id: string; consentVersion: number; staffNotes?: string | null };
    consentClauses: Array<{ wording: string }>;
  };
}

describe("Phase 14 activities, consents, and parent responses", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await cleanupStoredObjects({ owner: pools.owner, storage: testObjectStorage });
    await closePools(pools);
  });

  it("creates, targets, publishes, and records explicit parent consent with a wording snapshot", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Test",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const other = await createStudent(app, hdrs, {
      legalName: "Unrelated Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classBId,
    });
    await inviteParent(app, hdrs, pupil.student.id, `parent-${id}@example.com`);
    await inviteParent(app, hdrs, other.student.id, `other-parent-${id}@example.com`);
    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    const otherParentToken = await login(app, `other-parent-${id}@example.com`, "parent-pass-1");
    const parentHdrs = jsonHeaders(parentToken, school.orgId);

    const created = await createTrip(app, hdrs, {
      academicYearId: seeded.yearId,
      staffNotes: "Internal coach plan",
      parentNotes: "Packed lunch",
      targets: [{ targetType: "class", classId: seeded.classAId }],
      consentClauses: [
        {
          clauseKey: "permission_to_attend",
          title: "Permission",
          wording: "Original museum wording for snapshot tests.",
          required: true,
          sortOrder: 0,
        },
      ],
    });
    const publish = await app.request(`/api/v1/activities/${created.activity.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(publish.status).toBe(200);

    const parentList = (await (
      await app.request("/api/v1/parent/activities", { headers: parentHdrs })
    ).json()) as {
      activities: Array<{ id: string; staffNotes?: string; children: Array<{ actionRequired: boolean }> }>;
    };
    expect(parentList.activities.map((row) => row.id)).toContain(created.activity.id);
    expect(parentList.activities[0]?.staffNotes).toBeUndefined();
    expect(parentList.activities.find((row) => row.id === created.activity.id)?.children[0]?.actionRequired).toBe(
      true,
    );

    const unrelated = await app.request("/api/v1/parent/activities", {
      headers: jsonHeaders(otherParentToken, school.orgId),
    });
    const unrelatedBody = (await unrelated.json()) as { activities: Array<{ id: string }> };
    expect(unrelatedBody.activities.map((row) => row.id)).not.toContain(created.activity.id);

    const spoof = await app.request(
      `/api/v1/parent/children/${other.student.id}/activities/${created.activity.id}/respond`,
      {
        method: "POST",
        headers: parentHdrs,
        body: JSON.stringify({
          response: "consented",
          confirm: true,
          guardianUserId: school.adminId,
        }),
      },
    );
    expect(spoof.status).toBe(404);

    const missingConfirm = await app.request(
      `/api/v1/parent/children/${pupil.student.id}/activities/${created.activity.id}/respond`,
      {
        method: "POST",
        headers: parentHdrs,
        body: JSON.stringify({ response: "consented" }),
      },
    );
    expect(missingConfirm.status).toBe(400);

    const consent = await app.request(
      `/api/v1/parent/children/${pupil.student.id}/activities/${created.activity.id}/respond`,
      {
        method: "POST",
        headers: parentHdrs,
        body: JSON.stringify({ response: "consented", confirm: true, emergencyMedicalAcknowledged: true }),
      },
    );
    expect(consent.status).toBe(200);
    const consentBody = (await consent.json()) as { registrationStatus: string };
    expect(consentBody.registrationStatus).toBe("confirmed");

    await app.request(`/api/v1/activities/${created.activity.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({
        consentClauses: [
          {
            clauseKey: "permission_to_attend",
            title: "Permission",
            wording: "Edited wording that must not replace the snapshot.",
            required: true,
            sortOrder: 0,
          },
        ],
      }),
    });
    const responses = (await (
      await app.request(`/api/v1/activities/${created.activity.id}/responses`, { headers: hdrs })
    ).json()) as {
      responses: Array<{
        response: string;
        channel: string;
        guardianUserId: string | null;
        wordingSnapshot: { clauses: Array<{ wording: string }> };
      }>;
    };
    expect(responses.responses[0]?.response).toBe("consented");
    expect(responses.responses[0]?.channel).toBe("parent_portal");
    expect(responses.responses[0]?.guardianUserId).not.toBe(school.adminId);
    expect(JSON.stringify(responses.responses[0]?.wordingSnapshot)).toContain("Original museum wording");
    expect(JSON.stringify(responses.responses[0]?.wordingSnapshot)).not.toContain("Edited wording");

    const decline = await app.request(
      `/api/v1/parent/children/${pupil.student.id}/activities/${created.activity.id}/respond`,
      {
        method: "POST",
        headers: parentHdrs,
        body: JSON.stringify({ response: "declined", confirm: true }),
      },
    );
    expect(decline.status).toBe(200);
    const withdraw = await app.request(
      `/api/v1/parent/children/${pupil.student.id}/activities/${created.activity.id}/respond`,
      {
        method: "POST",
        headers: parentHdrs,
        body: JSON.stringify({ response: "withdrawn", confirm: true }),
      },
    );
    expect(withdraw.status).toBe(200);

    const inbox = (await (await app.request("/api/v1/notifications", { headers: parentHdrs })).json()) as {
      notifications: Array<{ type: string; body: string }>;
    };
    expect(inbox.notifications.some((row) => row.type === "activity_consent_required")).toBe(true);
    expect(inbox.notifications.every((row) => !row.body.toLowerCase().includes("allergy"))).toBe(true);
    await app.request(`/api/v1/activities/${created.activity.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    const inbox2 = (await (await app.request("/api/v1/notifications", { headers: parentHdrs })).json()) as {
      notifications: Array<{ type: string }>;
    };
    expect(inbox2.notifications.filter((row) => row.type === "activity_consent_required")).toHaveLength(1);
  });

  it("enforces capacity with a waiting list, promotion, and concurrent final-place requests", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "cap");
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const first = await createStudent(app, hdrs, {
      legalName: "First Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const second = await createStudent(app, hdrs, {
      legalName: "Second Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    await inviteParent(app, hdrs, first.student.id, `first-${id}@example.com`);
    await inviteParent(app, hdrs, second.student.id, `second-${id}@example.com`);
    const firstHdrs = jsonHeaders(await login(app, `first-${id}@example.com`, "parent-pass-1"), school.orgId);
    const secondHdrs = jsonHeaders(await login(app, `second-${id}@example.com`, "parent-pass-1"), school.orgId);
    const created = await createTrip(app, hdrs, {
      title: "Tiny club",
      activityTypeKey: "club",
      capacity: 1,
      targets: [{ targetType: "class", classId: seeded.classAId }],
    });
    await app.request(`/api/v1/activities/${created.activity.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });

    const [one, two] = await Promise.all([
      app.request(`/api/v1/parent/children/${first.student.id}/activities/${created.activity.id}/respond`, {
        method: "POST",
        headers: firstHdrs,
        body: JSON.stringify({ response: "consented", confirm: true }),
      }),
      app.request(`/api/v1/parent/children/${second.student.id}/activities/${created.activity.id}/respond`, {
        method: "POST",
        headers: secondHdrs,
        body: JSON.stringify({ response: "consented", confirm: true }),
      }),
    ]);
    expect([one.status, two.status].every((status) => status === 200)).toBe(true);
    const results = [(await one.json()) as { registrationStatus: string }, (await two.json()) as { registrationStatus: string }];
    expect(results.filter((row) => row.registrationStatus === "confirmed")).toHaveLength(1);
    expect(results.filter((row) => row.registrationStatus === "waitlisted")).toHaveLength(1);

    const participants = (await (
      await app.request(`/api/v1/activities/${created.activity.id}/participants`, { headers: hdrs })
    ).json()) as { participants: Array<{ registrationStatus: string; studentProfileId: string }> };
    expect(participants.participants.filter((row) => row.registrationStatus === "confirmed")).toHaveLength(1);

    const waitlisted = participants.participants.find((row) => row.registrationStatus === "waitlisted")!;
    const confirmed = participants.participants.find((row) => row.registrationStatus === "confirmed")!;
    await app.request(`/api/v1/activities/${created.activity.id}/participants/${confirmed.studentProfileId}/withdraw`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    await app.request(`/api/v1/activities/${created.activity.id}/participants/${waitlisted.studentProfileId}/promote`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    const after = (await (
      await app.request(`/api/v1/activities/${created.activity.id}/participants`, { headers: hdrs })
    ).json()) as { participants: Array<{ registrationStatus: string; studentProfileId: string }> };
    expect(
      after.participants.find((row) => row.studentProfileId === waitlisted.studentProfileId)?.registrationStatus,
    ).toBe("confirmed");
    expect(after.participants.filter((row) => row.registrationStatus === "confirmed")).toHaveLength(1);
  });

  it("keeps offline consent staff-attributed, assigned-only teacher access, and live medical summaries permissioned", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "off");
    const oak = await createSchool(pools.owner, `${id}oak`, "oak");
    const token = await login(app, school.adminEmail, "password-12x");
    const oakToken = await login(app, oak.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const oakHdrs = jsonHeaders(oakToken, oak.orgId);
    const seeded = await seedStructure(app, hdrs);
    const oakSeeded = await seedStructure(app, oakHdrs);
    const teacher = await inviteTeacher(app, hdrs, id, seeded.classAId);
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const teacherHdrs = jsonHeaders(teacherToken, school.orgId);
    const teacherMe = (await (await app.request("/api/v1/me", { headers: teacherHdrs })).json()) as {
      user: { id: string };
    };
    const pupil = await createStudent(app, hdrs, {
      legalName: "Trip Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `pupil.${id}`,
      password: "student-pass-1",
    });
    const otherClass = await createStudent(app, hdrs, {
      legalName: "Other Class Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classBId,
    });
    const oakPupil = await createStudent(app, oakHdrs, {
      legalName: "Oak Pupil",
      academicYearId: oakSeeded.yearId,
      yearGroupId: oakSeeded.year3Id,
      classId: oakSeeded.classAId,
    });
    await inviteParent(app, hdrs, pupil.student.id, `p-${id}@example.com`);
    await pools.owner.query(
      `insert into student_additional_needs (
         organisation_id, student_profile_id, allergies, medication, dietary_requirements, send_notes
       ) values ($1,$2,$3,$4,$5,$6)`,
      [school.orgId, pupil.student.id, "Peanuts", "Inhaler", "No nuts", "Safeguarding narrative must never appear"],
    );

    const assigned = await createTrip(app, hdrs, {
      title: "Assigned fixture",
      activityTypeKey: "sports_fixture",
      consentRequired: false,
      targets: [{ targetType: "student", studentProfileId: pupil.student.id }],
      staff: [{ staffUserId: teacherMe.user.id, staffRole: "lead" }],
    });
    const unrelated = await createTrip(app, hdrs, {
      title: "Unrelated trip",
      targets: [{ targetType: "student", studentProfileId: otherClass.student.id }],
    });
    const oakTrip = await createTrip(app, oakHdrs, {
      title: "Oak harbour",
      targets: [{ targetType: "student", studentProfileId: oakPupil.student.id }],
    });
    await app.request(`/api/v1/activities/${assigned.activity.id}/publish`, { method: "POST", headers: hdrs, body: "{}" });
    await app.request(`/api/v1/activities/${unrelated.activity.id}/publish`, { method: "POST", headers: hdrs, body: "{}" });
    await app.request(`/api/v1/activities/${oakTrip.activity.id}/publish`, { method: "POST", headers: oakHdrs, body: "{}" });

    const teacherList = (await (await app.request("/api/v1/activities", { headers: teacherHdrs })).json()) as {
      activities: Array<{ id: string }>;
    };
    expect(teacherList.activities.map((row) => row.id)).toContain(assigned.activity.id);
    expect(teacherList.activities.map((row) => row.id)).not.toContain(unrelated.activity.id);

    const teacherUnrelated = await app.request(`/api/v1/activities/${unrelated.activity.id}`, { headers: teacherHdrs });
    expect(teacherUnrelated.status).toBe(404);
    const teacherPublish = await app.request(`/api/v1/activities/${assigned.activity.id}/publish`, {
      method: "POST",
      headers: teacherHdrs,
      body: "{}",
    });
    expect(teacherPublish.status).toBe(403);

    await app.request(`/api/v1/activities/${assigned.activity.id}/participants`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ studentProfileId: pupil.student.id }),
    });
    const offline = await app.request(
      `/api/v1/activities/${assigned.activity.id}/participants/${pupil.student.id}/offline-response`,
      {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          response: "consented",
          staffNote: "Paper consent taken at the office",
          guardianUserId: pupil.student.id,
        }),
      },
    );
    expect(offline.status).toBe(200);
    const history = (await (
      await app.request(`/api/v1/activities/${assigned.activity.id}/responses`, { headers: hdrs })
    ).json()) as { responses: Array<{ channel: string; guardianUserId: string | null; staffNote?: string }> };
    expect(history.responses[0]?.channel).toBe("staff_offline");
    expect(history.responses[0]?.guardianUserId).toBeNull();
    expect(history.responses[0]?.staffNote).toContain("Paper consent");

    const medical = await app.request(`/api/v1/activities/${assigned.activity.id}/safety-summary`, { headers: hdrs });
    expect(medical.status).toBe(200);
    const medicalBody = (await medical.json()) as {
      liveMedical: boolean;
      snapshot: boolean;
      participants: Array<Record<string, unknown>>;
    };
    expect(medicalBody.liveMedical).toBe(true);
    expect(medicalBody.snapshot).toBe(false);
    expect(JSON.stringify(medicalBody)).toContain("Peanuts");
    expect(JSON.stringify(medicalBody)).not.toContain("Safeguarding");
    expect(JSON.stringify(medicalBody)).not.toContain("narrative");

    const teacherMedical = await app.request(`/api/v1/activities/${assigned.activity.id}/safety-summary`, {
      headers: teacherHdrs,
    });
    expect(teacherMedical.status).toBe(200);
    const teacherMedicalBody = (await teacherMedical.json()) as { participants: Array<Record<string, unknown>> };
    expect(JSON.stringify(teacherMedicalBody)).not.toContain("Peanuts");
    expect(JSON.stringify(teacherMedicalBody)).not.toContain("Safeguarding");
    expect(teacherMedicalBody.participants[0]?.emergencyContacts).toBeDefined();

    const oakLeak = await app.request(`/api/v1/activities/${oakTrip.activity.id}`, { headers: hdrs });
    expect(oakLeak.status).toBe(404);
    const fakePupil = await app.request(`/api/v1/activities/${assigned.activity.id}/eligible`, {
      headers: jsonHeaders(token, oak.orgId),
    });
    expect(fakePupil.status).toBe(404);

    const cancel = await app.request(`/api/v1/activities/${assigned.activity.id}/cancel`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ reason: "Weather" }),
    });
    expect(cancel.status).toBe(200);
    const stillThere = await app.request(`/api/v1/activities/${assigned.activity.id}`, { headers: hdrs });
    expect(stillThere.status).toBe(200);
    expect(((await stillThere.json()) as { activity: { status: string } }).activity.status).toBe("cancelled");
  });

  it("stores Phase 13 files with explicit visibility and calendar source=activity", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "file");
    const oak = await createSchool(pools.owner, `${id}b`, "fileoak");
    const token = await login(app, school.adminEmail, "password-12x");
    const oakToken = await login(app, oak.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const oakHdrs = jsonHeaders(oakToken, oak.orgId);
    const seeded = await seedStructure(app, hdrs);
    await seedStructure(app, oakHdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "File Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `file.${id}`,
      password: "student-pass-1",
    });
    await inviteParent(app, hdrs, pupil.student.id, `file-parent-${id}@example.com`);
    const parentHdrs = jsonHeaders(await login(app, `file-parent-${id}@example.com`, "parent-pass-1"), school.orgId);
    const studentHdrs = jsonHeaders(await loginAlias(app, school.slug, `file.${id}`, "student-pass-1"), school.orgId);

    const created = await createTrip(app, hdrs, {
      studentSignupEnabled: false,
      studentVisible: true,
      targets: [{ targetType: "class", classId: seeded.classAId }],
    });
    await app.request(`/api/v1/activities/${created.activity.id}/publish`, { method: "POST", headers: hdrs, body: "{}" });

    const parentDoc = await app.request(`/api/v1/activities/${created.activity.id}/documents`, {
      method: "POST",
      headers: headers(token, school.orgId),
      body: pdfForm({ title: "Trip letter", visibility: "staff_and_parents" }),
    });
    expect(parentDoc.status).toBe(201);
    const parentDocBody = (await parentDoc.json()) as { document: { downloadPath: string } };
    const staffDoc = await app.request(`/api/v1/activities/${created.activity.id}/documents`, {
      method: "POST",
      headers: headers(token, school.orgId),
      body: pdfForm({ title: "Risk assessment", visibility: "staff" }, "risk.pdf"),
    });
    expect(staffDoc.status).toBe(201);
    const staffDocBody = (await staffDoc.json()) as { document: { downloadPath: string } };
    const studentDoc = await app.request(`/api/v1/activities/${created.activity.id}/documents`, {
      method: "POST",
      headers: headers(token, school.orgId),
      body: pdfForm({ title: "Kit list", visibility: "staff_parents_and_student" }, "kit.pdf"),
    });
    const studentDocBody = (await studentDoc.json()) as { document: { downloadPath: string } };

    expect((await app.request(parentDocBody.document.downloadPath, { headers: parentHdrs })).status).toBe(200);
    expect((await app.request(staffDocBody.document.downloadPath, { headers: parentHdrs })).status).toBe(404);
    expect((await app.request(staffDocBody.document.downloadPath, { headers: studentHdrs })).status).toBe(404);
    expect((await app.request(studentDocBody.document.downloadPath, { headers: studentHdrs })).status).toBe(200);
    expect(
      (await app.request(parentDocBody.document.downloadPath, { headers: jsonHeaders(oakToken, oak.orgId) })).status,
    ).toBe(404);

    const parentDetail = (await (
      await app.request(`/api/v1/parent/children/${pupil.student.id}/activities/${created.activity.id}`, {
        headers: parentHdrs,
      })
    ).json()) as { documents: Array<{ title: string }>; activity: { staffNotes?: string } };
    expect(parentDetail.documents.map((row) => row.title).sort()).toEqual(["Kit list", "Trip letter"]);
    expect(parentDetail.activity.staffNotes).toBeUndefined();

    const calendar = (await (await app.request("/api/v1/calendar/events", { headers: hdrs })).json()) as {
      events: Array<{ id: string }>;
      activities: Array<{ id: string; source: string }>;
    };
    expect(calendar.activities.filter((row) => row.id === created.activity.id)).toHaveLength(1);
    expect(calendar.activities.find((row) => row.id === created.activity.id)?.source).toBe("activity");
    expect(calendar.events.filter((row) => row.id === created.activity.id)).toHaveLength(0);

    const parentCal = (await (await app.request("/api/v1/parent/calendar/events", { headers: parentHdrs })).json()) as {
      activities: Array<{ id: string }>;
    };
    expect(parentCal.activities.map((row) => row.id)).toContain(created.activity.id);

    const studentList = await app.request("/api/v1/student/activities", { headers: studentHdrs });
    expect(studentList.status).toBe(200);
    await app.request(`/api/v1/year-groups/${seeded.year3Id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ studentLoginEnabled: false }),
    });
    const disabled = await app.request("/api/v1/student/activities", { headers: studentHdrs });
    expect(disabled.status).toBe(403);

    const parentInvite = await inviteParent(app, hdrs, pupil.student.id, `revoked-act-${id}@example.com`);
    await app.request(`/api/v1/guardianships/${parentInvite.guardianshipId}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ portalAccess: false }),
    });
    const revokedToken = await login(app, `revoked-act-${id}@example.com`, "parent-pass-1");
    const revoked = await app.request("/api/v1/parent/activities", {
      headers: jsonHeaders(revokedToken, school.orgId),
    });
    expect(((await revoked.json()) as { activities: unknown[] }).activities).toEqual([]);
  });

  it("lets students self-sign-up only when configured and blocks another pupil's registration", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "stu");
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Self Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `self.${id}`,
      password: "student-pass-1",
    });
    const other = await createStudent(app, hdrs, {
      legalName: "Other Self",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `other.${id}`,
      password: "student-pass-1",
    });
    const studentHdrs = jsonHeaders(await loginAlias(app, school.slug, `self.${id}`, "student-pass-1"), school.orgId);
    const otherHdrs = jsonHeaders(await loginAlias(app, school.slug, `other.${id}`, "student-pass-1"), school.orgId);
    const club = await createTrip(app, hdrs, {
      title: "Coding taster",
      activityTypeKey: "workshop",
      consentRequired: false,
      studentSignupEnabled: true,
      studentVisible: true,
      targets: [{ targetType: "class", classId: seeded.classAId }],
    });
    await app.request(`/api/v1/activities/${club.activity.id}/publish`, { method: "POST", headers: hdrs, body: "{}" });
    const signup = await app.request(`/api/v1/student/activities/${club.activity.id}/signup`, {
      method: "POST",
      headers: studentHdrs,
      body: "{}",
    });
    expect(signup.status).toBe(201);
    const detail = (await (
      await app.request(`/api/v1/student/activities/${club.activity.id}`, { headers: otherHdrs })
    ).json()) as { child: { registrationStatus: string | null }; consentClauses: unknown[] };
    expect(detail.child.registrationStatus).toBeNull();
    expect(detail.consentClauses).toEqual([]);

    await pools.owner.query(
      `update student_enrolments
          set ended_on = started_on, status = 'withdrawn'
        where student_profile_id = $1 and is_primary`,
      [pupil.student.id],
    );
    const withdrawn = await app.request("/api/v1/student/activities", { headers: studentHdrs });
    expect([401, 403, 404]).toContain(withdrawn.status);
  });

  it("keeps FORCE RLS on activity tables across tenants", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "rls");
    const other = await createSchool(pools.owner, `${id}x`, "rlsx");
    const adminId = school.adminId;
    await withTenantContext(pools.app, adminId, school.orgId, async (client) => {
      const leaked = await client.query("select id from school_activities where organisation_id = $1", [other.orgId]);
      expect(leaked.rows).toEqual([]);
    });
  });
});
