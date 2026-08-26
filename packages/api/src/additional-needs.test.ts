import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditSafeDietaryAfter,
  auditSafeMedicationAfter,
  mapDietaryRecord,
  mapMedicationRecord,
  summariseActiveDietary,
  summariseActiveMedications,
} from "@schoolapp/core";
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

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string, prefix = "med") {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`${prefix}-${id}`, `${prefix} ${id}`],
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

function jsonHeaders(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    "Content-Type": "application/json",
  };
}

async function seedYear(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof jsonHeaders>) {
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
  return { yearId: year.academicYear.id, year3Id: year3.id, classAId: classA.class.id, classBId: classB.class.id };
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
    body: JSON.stringify({ staffProfileId: staff.staffProfileId, assignmentRole: "form_tutor" }),
  });
  return { email: `teacher-${id}@example.com` };
}

async function inviteParent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
  studentId: string,
  email: string,
  portalAccess: boolean,
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
  return guardian;
}

describe("Pupil medication and dietary requirements", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("lets authorised staff create, edit, and stop multiple medications while preserving history", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "greenwood");
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Khan",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
    });

    const first = await app.request(`/api/v1/students/${pupil.student.id}/medications`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        medicationName: "Cetirizine",
        dosage: "5mg",
        route: "oral",
        scheduleText: "Once daily",
        isPrn: false,
        startedOn: "2026-04-01",
        instructions: "Give after lunch",
        administrationResponsibility: "school_staff",
        parentConsentStatus: "granted",
        parentConsentOn: "2026-04-01",
        reviewOn: "2027-04-01",
        internalNotes: "INTERNAL-MED-NOTE-SECRET",
        parentVisible: true,
      }),
    });
    expect(first.status, await first.clone().text()).toBe(201);
    const firstBody = (await first.json()) as { medication: { id: string; medicationName: string } };
    expect(firstBody.medication.medicationName).toBe("Cetirizine");

    const second = await app.request(`/api/v1/students/${pupil.student.id}/medications`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        medicationName: "Salbutamol inhaler",
        dosage: "2 puffs",
        route: "inhaled",
        isPrn: true,
        administrationResponsibility: "school_staff",
        parentConsentStatus: "granted",
        internalNotes: "Spare in medical bag",
      }),
    });
    expect(second.status).toBe(201);

    const edited = await app.request(
      `/api/v1/students/${pupil.student.id}/medications/${firstBody.medication.id}`,
      {
        method: "PATCH",
        headers: hdrs,
        body: JSON.stringify({ dosage: "10mg", scheduleText: "Morning and evening" }),
      },
    );
    expect(edited.status, await edited.clone().text()).toBe(200);
    const editedBody = (await edited.json()) as {
      medication: { dosage: string; revisions: Array<{ changeKind: string; previousData: Record<string, unknown> }> };
    };
    expect(editedBody.medication.dosage).toBe("10mg");
    expect(editedBody.medication.revisions.some((row) => row.previousData.dosage === "5mg")).toBe(true);

    const stopped = await app.request(
      `/api/v1/students/${pupil.student.id}/medications/${firstBody.medication.id}/stop`,
      { method: "POST", headers: hdrs, body: JSON.stringify({ stoppedReason: "Season ended" }) },
    );
    expect(stopped.status).toBe(200);
    const stoppedBody = (await stopped.json()) as {
      medication: { status: string; endedOn: string | null; revisions: Array<{ changeKind: string }> };
    };
    expect(stoppedBody.medication.status).toBe("stopped");
    expect(stoppedBody.medication.endedOn).toBeTruthy();
    expect(stoppedBody.medication.revisions.some((row) => row.changeKind === "stopped")).toBe(true);

    const listed = (await (
      await app.request(`/api/v1/students/${pupil.student.id}/medications`, { headers: hdrs })
    ).json()) as { view: string; medications: Array<{ medicationName: string; status: string; internalNotes?: string }> };
    expect(listed.view).toBe("full");
    expect(listed.medications).toHaveLength(2);
    expect(listed.medications.map((row) => row.medicationName).sort()).toEqual(["Cetirizine", "Salbutamol inhaler"]);
    expect(listed.medications.find((row) => row.medicationName === "Cetirizine")?.status).toBe("stopped");
    expect(listed.medications.some((row) => row.internalNotes === "INTERNAL-MED-NOTE-SECRET")).toBe(true);

    const audits = await pools.owner.query<{ action: string; after_data: Record<string, unknown> }>(
      `select action, after_data from audit_events
       where organisation_id = $1 and entity_type = 'student_medication'
       order by occurred_at`,
      [school.orgId],
    );
    expect(audits.rows.map((row) => row.action)).toEqual([
      "medication.created",
      "medication.created",
      "medication.updated",
      "medication.stopped",
    ]);
    const auditText = JSON.stringify(audits.rows);
    expect(auditText).not.toContain("Cetirizine");
    expect(auditText).not.toContain("Salbutamol");
    expect(auditText).not.toContain("INTERNAL-MED-NOTE-SECRET");
    expect(auditText).not.toContain("10mg");

    const notes = await pools.owner.query<{ body: string }>(
      "select body from notifications where organisation_id = $1",
      [school.orgId],
    );
    expect(JSON.stringify(notes.rows)).not.toContain("Cetirizine");
    expect(JSON.stringify(notes.rows)).not.toContain("INTERNAL-MED-NOTE-SECRET");
  });

  it("creates a dietary requirement and keeps inactive history", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Khan",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
    });
    const created = await app.request(`/api/v1/students/${pupil.student.id}/dietary-requirements`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        requirementType: "allergy",
        requirement: "Nut-free diet",
        foodsToAvoid: "Peanuts, mixed nuts",
        safeAlternatives: "School nut-free packed lunch",
        relatedAllergy: "Peanut allergy",
        parentConfirmedOn: "2026-09-01",
        internalNotes: "INTERNAL-DIET-NOTE-SECRET",
      }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const body = (await created.json()) as { dietaryRequirement: { id: string } };
    const edited = await app.request(
      `/api/v1/students/${pupil.student.id}/dietary-requirements/${body.dietaryRequirement.id}`,
      {
        method: "PATCH",
        headers: hdrs,
        body: JSON.stringify({ foodsToAvoid: "Peanuts, mixed nuts, nut oils" }),
      },
    );
    expect(edited.status, await edited.clone().text()).toBe(200);
    const stopped = await app.request(
      `/api/v1/students/${pupil.student.id}/dietary-requirements/${body.dietaryRequirement.id}/stop`,
      { method: "POST", headers: hdrs, body: "{}" },
    );
    expect(stopped.status, await stopped.clone().text()).toBe(200);
    const listed = (await (
      await app.request(`/api/v1/students/${pupil.student.id}/dietary-requirements`, { headers: hdrs })
    ).json()) as {
      dietaryRequirements: Array<{
        status: string;
        foodsToAvoid: string;
        revisions: Array<{ previousData: Record<string, unknown> }>;
      }>;
    };
    expect(listed.dietaryRequirements[0]?.status).toBe("inactive");
    expect(listed.dietaryRequirements[0]?.foodsToAvoid).toContain("nut oils");
    expect(listed.dietaryRequirements[0]?.revisions.some((row) => row.previousData.foodsToAvoid === "Peanuts, mixed nuts")).toBe(
      true,
    );
    const audits = await pools.owner.query<{ after_data: Record<string, unknown> }>(
      `select after_data from audit_events
       where organisation_id = $1 and entity_type = 'student_dietary_requirement'`,
      [school.orgId],
    );
    expect(JSON.stringify(audits.rows)).not.toContain("Nut-free");
    expect(JSON.stringify(audits.rows)).not.toContain("INTERNAL-DIET-NOTE-SECRET");
    expect(JSON.stringify(audits.rows)).not.toContain("Peanuts");
  });

  it("limits teachers to operational fields for assigned pupils only", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await seedYear(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, id, year.classAId);
    const assigned = await createStudent(app, hdrs, {
      legalName: "Assigned Pupil",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
    });
    const other = await createStudent(app, hdrs, {
      legalName: "Other Class Pupil",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classBId,
    });
    await app.request(`/api/v1/students/${assigned.student.id}/medications`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        medicationName: "Salbutamol inhaler",
        dosage: "2 puffs",
        route: "inhaled",
        isPrn: true,
        internalNotes: "INTERNAL-TEACHER-MUST-NOT-SEE",
      }),
    });
    await app.request(`/api/v1/students/${assigned.student.id}/dietary-requirements`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        requirementType: "allergy",
        requirement: "Nut-free diet",
        foodsToAvoid: "Peanuts",
        internalNotes: "INTERNAL-DIET-TEACHER-MUST-NOT-SEE",
      }),
    });
    const teacherHdrs = jsonHeaders(await login(app, teacher.email, "teacher-pass-1"), school.orgId);
    const assignedMeds = await app.request(`/api/v1/students/${assigned.student.id}/medications`, {
      headers: teacherHdrs,
    });
    expect(assignedMeds.status).toBe(200);
    const assignedBody = (await assignedMeds.json()) as {
      view: string;
      medications: Array<Record<string, unknown>>;
    };
    expect(assignedBody.view).toBe("operational");
    expect(assignedBody.medications[0]?.medicationName).toBe("Salbutamol inhaler");
    expect(assignedBody.medications[0]?.dosage).toBe("2 puffs");
    expect(JSON.stringify(assignedBody)).not.toContain("INTERNAL-TEACHER-MUST-NOT-SEE");
    expect(assignedBody.medications[0]?.internalNotes).toBeUndefined();
    expect(assignedBody.medications[0]?.parentVisible).toBeUndefined();

    const otherMeds = await app.request(`/api/v1/students/${other.student.id}/medications`, { headers: teacherHdrs });
    expect(otherMeds.status).toBe(404);

    const createAsTeacher = await app.request(`/api/v1/students/${assigned.student.id}/medications`, {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({ medicationName: "Ibuprofen", route: "oral" }),
    });
    expect(createAsTeacher.status).toBe(403);

    const diet = (await (
      await app.request(`/api/v1/students/${assigned.student.id}/dietary-requirements`, { headers: teacherHdrs })
    ).json()) as { view: string; dietaryRequirements: Array<Record<string, unknown>> };
    expect(diet.view).toBe("operational");
    expect(diet.dietaryRequirements[0]?.requirement).toBe("Nut-free diet");
    expect(JSON.stringify(diet)).not.toContain("INTERNAL-DIET-TEACHER-MUST-NOT-SEE");
  });

  it("shows parent-visible records only after guardianship and portal_access are rechecked", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await seedYear(app, hdrs);
    const child = await createStudent(app, hdrs, {
      legalName: "Amelia Khan",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
    });
    const other = await createStudent(app, hdrs, {
      legalName: "Yusuf Khan",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
    });
    const parent = await inviteParent(app, hdrs, child.student.id, `parent-${id}@example.com`, true);
    await inviteParent(app, hdrs, other.student.id, `blocked-${id}@example.com`, false);
    await app.request(`/api/v1/students/${child.student.id}/medications`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        medicationName: "Cetirizine",
        dosage: "5mg",
        route: "oral",
        parentVisible: true,
        internalNotes: "INTERNAL-PARENT-MUST-NOT-SEE",
      }),
    });
    await app.request(`/api/v1/students/${child.student.id}/medications`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        medicationName: "Hidden staff-only cream",
        route: "topical",
        parentVisible: false,
      }),
    });
    await app.request(`/api/v1/students/${child.student.id}/dietary-requirements`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        requirementType: "religious",
        requirement: "Halal meat only",
        parentVisible: true,
        internalNotes: "INTERNAL-DIET-PARENT-MUST-NOT-SEE",
      }),
    });

    const parentHdrs = jsonHeaders(await login(app, `parent-${id}@example.com`, "parent-pass-1"), school.orgId);
    const visible = await app.request(`/api/v1/parent/children/${child.student.id}/medications`, {
      headers: parentHdrs,
    });
    expect(visible.status).toBe(200);
    const visibleBody = (await visible.json()) as { view: string; medications: Array<Record<string, unknown>> };
    expect(visibleBody.view).toBe("parent");
    expect(visibleBody.medications.map((row) => row.medicationName)).toEqual(["Cetirizine"]);
    expect(JSON.stringify(visibleBody)).not.toContain("Hidden staff-only");
    expect(JSON.stringify(visibleBody)).not.toContain("INTERNAL-PARENT-MUST-NOT-SEE");

    const diet = (await (
      await app.request(`/api/v1/parent/children/${child.student.id}/dietary-requirements`, { headers: parentHdrs })
    ).json()) as { dietaryRequirements: Array<Record<string, unknown>> };
    expect(diet.dietaryRequirements[0]?.requirement).toBe("Halal meat only");
    expect(JSON.stringify(diet)).not.toContain("INTERNAL-DIET-PARENT-MUST-NOT-SEE");

    const stolen = await app.request(`/api/v1/parent/children/${other.student.id}/medications`, {
      headers: parentHdrs,
    });
    expect(stolen.status).toBe(404);

    const blockedHdrs = jsonHeaders(await login(app, `blocked-${id}@example.com`, "parent-pass-1"), school.orgId);
    const noPortal = await app.request(`/api/v1/parent/children/${other.student.id}/medications`, {
      headers: blockedHdrs,
    });
    expect(noPortal.status).toBe(404);

    await app.request(`/api/v1/guardianships/${parent.guardianshipId}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ portalAccess: false }),
    });
    const revoked = await app.request(`/api/v1/parent/children/${child.student.id}/medications`, {
      headers: parentHdrs,
    });
    expect(revoked.status).toBe(404);

    await app.request(`/api/v1/guardianships/${parent.guardianshipId}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ portalAccess: true, endedOn: "2026-01-01" }),
    });
    const ended = await app.request(`/api/v1/parent/children/${child.student.id}/medications`, {
      headers: parentHdrs,
    });
    expect(ended.status).toBe(404);
  });

  it("does not expose medication administration on the student portal", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Khan",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
      loginAlias: `amelia.${id}`,
      password: "student-pass-1",
    });
    await app.request(`/api/v1/students/${pupil.student.id}/medications`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        medicationName: "Salbutamol inhaler",
        dosage: "2 puffs",
        route: "inhaled",
        isPrn: true,
        parentVisible: true,
      }),
    });
    const studentToken = await loginAlias(app, school.slug, `amelia.${id}`, "student-pass-1");
    const studentHdrs = jsonHeaders(studentToken, school.orgId);
    const me = await app.request("/api/v1/student/me", { headers: studentHdrs });
    expect(me.status).toBe(200);
    const meBody = await me.json();
    expect(JSON.stringify(meBody)).not.toContain("Salbutamol");
    expect(JSON.stringify(meBody)).not.toContain("medication");
    const staffPath = await app.request(`/api/v1/students/${pupil.student.id}/medications`, { headers: studentHdrs });
    expect(staffPath.status).toBe(404);
    const studentPath = await app.request("/api/v1/student/medications", { headers: studentHdrs });
    expect(studentPath.status).toBe(404);
    const dash = (await (await app.request("/api/v1/student/dashboard", { headers: studentHdrs })).json()) as {
      sections: Record<string, { available?: boolean }>;
    };
    expect(dash.sections.medication).toBeUndefined();
  });

  it("keeps Greenwood and Oak medication records isolated", async () => {
    const id = suffix();
    const greenwood = await createSchool(pools.owner, id, "greenwood");
    const oak = await createSchool(pools.owner, `${id}oak`, "oak");
    const gToken = await login(app, greenwood.adminEmail, "password-12x");
    const oToken = await login(app, oak.adminEmail, "password-12x");
    const gHdrs = jsonHeaders(gToken, greenwood.orgId);
    const oHdrs = jsonHeaders(oToken, oak.orgId);
    const gYear = await seedYear(app, gHdrs);
    const oYear = await seedYear(app, oHdrs);
    const amelia = await createStudent(app, gHdrs, {
      legalName: "Amelia Khan",
      academicYearId: gYear.yearId,
      yearGroupId: gYear.year3Id,
      classId: gYear.classAId,
    });
    const niamh = await createStudent(app, oHdrs, {
      legalName: "Niamh Okonkwo",
      academicYearId: oYear.yearId,
      yearGroupId: oYear.year3Id,
      classId: oYear.classAId,
    });
    const created = await app.request(`/api/v1/students/${amelia.student.id}/medications`, {
      method: "POST",
      headers: gHdrs,
      body: JSON.stringify({ medicationName: "GreenwoodOnlyInhaler", route: "inhaled" }),
    });
    expect(created.status).toBe(201);
    const oakRead = await app.request(`/api/v1/students/${amelia.student.id}/medications`, { headers: oHdrs });
    expect(oakRead.status).toBe(404);
    const swapped = await app.request(`/api/v1/students/${amelia.student.id}/medications`, {
      headers: jsonHeaders(gToken, oak.orgId),
    });
    expect(swapped.status).toBe(403);
    const oakList = (await (
      await app.request(`/api/v1/students/${niamh.student.id}/medications`, { headers: oHdrs })
    ).json()) as { medications: Array<{ medicationName: string }> };
    expect(oakList.medications).toEqual([]);
    expect(JSON.stringify(oakList)).not.toContain("GreenwoodOnlyInhaler");
  });

  it("reuses canonical medication and dietary records in activity medical summaries", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await seedYear(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, id, year.classAId);
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const teacherHdrs = jsonHeaders(teacherToken, school.orgId);
    const teacherMe = (await (await app.request("/api/v1/me", { headers: teacherHdrs })).json()) as {
      user: { id: string };
    };
    const pupil = await createStudent(app, hdrs, {
      legalName: "Trip Pupil",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
    });
    const createdMed = await app.request(`/api/v1/students/${pupil.student.id}/medications`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        medicationName: "CanonicalInhaler",
        dosage: "2 puffs",
        route: "inhaled",
        isPrn: true,
      }),
    });
    expect(createdMed.status).toBe(201);
    const medBody = (await createdMed.json()) as { medication: { id: string } };
    const createdDiet = await app.request(`/api/v1/students/${pupil.student.id}/dietary-requirements`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        requirementType: "allergy",
        requirement: "Canonical nut-free",
        foodsToAvoid: "Peanuts",
      }),
    });
    expect(createdDiet.status).toBe(201);
    const dietBody = (await createdDiet.json()) as { dietaryRequirement: { id: string } };
    await pools.owner.query(
      `insert into student_additional_needs (
         organisation_id, student_profile_id, allergies, send_notes
       ) values ($1,$2,$3,$4)`,
      [school.orgId, pupil.student.id, "Peanuts", "Safeguarding narrative must never appear"],
    );
    const trip = await app.request("/api/v1/activities", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Museum trip",
        activityTypeKey: "trip",
        startsAt: "2026-11-12T09:00:00.000Z",
        endsAt: "2026-11-12T15:30:00.000Z",
        consentRequired: false,
        targets: [{ targetType: "student", studentProfileId: pupil.student.id }],
        staff: [{ staffUserId: teacherMe.user.id, staffRole: "lead" }],
      }),
    });
    expect(trip.status, await trip.clone().text()).toBe(201);
    const tripBody = (await trip.json()) as { activity: { id: string } };
    await app.request(`/api/v1/activities/${tripBody.activity.id}/publish`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    const added = await app.request(`/api/v1/activities/${tripBody.activity.id}/participants`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ studentProfileId: pupil.student.id }),
    });
    expect(added.status, await added.clone().text()).toBe(201);
    expect(((await added.json()) as { registrationStatus: string }).registrationStatus).toBe("confirmed");
    const summary = await app.request(`/api/v1/activities/${tripBody.activity.id}/safety-summary`, { headers: hdrs });
    expect(summary.status).toBe(200);
    const summaryBody = await summary.json();
    expect(JSON.stringify(summaryBody)).toContain("CanonicalInhaler");
    expect(JSON.stringify(summaryBody)).toContain("Canonical nut-free");
    expect(JSON.stringify(summaryBody)).not.toContain("Safeguarding");
    const teacherSummary = await app.request(`/api/v1/activities/${tripBody.activity.id}/safety-summary`, {
      headers: teacherHdrs,
    });
    expect(teacherSummary.status).toBe(200);
    expect(JSON.stringify(await teacherSummary.json())).not.toContain("CanonicalInhaler");

    await app.request(`/api/v1/students/${pupil.student.id}/medications/${medBody.medication.id}/stop`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    await app.request(
      `/api/v1/students/${pupil.student.id}/dietary-requirements/${dietBody.dietaryRequirement.id}/stop`,
      { method: "POST", headers: hdrs, body: "{}" },
    );
    await pools.owner.query(
      `update student_additional_needs
         set medication = 'LegacyInhalerText', dietary_requirements = 'LegacyDietText'
       where organisation_id = $1 and student_profile_id = $2`,
      [school.orgId, pupil.student.id],
    );
    const afterStop = await app.request(`/api/v1/activities/${tripBody.activity.id}/safety-summary`, {
      headers: hdrs,
    });
    expect(afterStop.status).toBe(200);
    const afterStopText = JSON.stringify(await afterStop.json());
    expect(afterStopText).not.toContain("CanonicalInhaler");
    expect(afterStopText).not.toContain("Canonical nut-free");
    expect(afterStopText).not.toContain("LegacyInhalerText");
    expect(afterStopText).not.toContain("LegacyDietText");
  });
});

describe("medication and dietary projections", () => {
  it("omits sensitive text from audit payloads and operational maps", () => {
    expect(
      JSON.stringify(
        auditSafeMedicationAfter({
          action: "created",
          id: "m1",
          studentProfileId: "s1",
          status: "active",
          isPrn: true,
          parentVisible: true,
        }),
      ),
    ).not.toMatch(/inhaler|dosage|note/i);
    expect(
      JSON.stringify(
        auditSafeDietaryAfter({
          action: "created",
          id: "d1",
          studentProfileId: "s1",
          status: "active",
          requirementType: "allergy",
        }),
      ),
    ).not.toMatch(/peanut|nut/i);
    const mapped = mapMedicationRecord(
      {
        id: "m1",
        student_profile_id: "s1",
        medication_name: "Salbutamol",
        dosage: "2 puffs",
        route: "inhaled",
        schedule_text: null,
        is_prn: true,
        started_on: null,
        ended_on: null,
        instructions: "Supervise",
        administration_responsibility: "school_staff",
        parent_consent_status: "granted",
        parent_consent_on: null,
        review_on: null,
        status: "active",
        stopped_reason: null,
        parent_visible: true,
        internal_notes: "SECRET",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        created_by: "u1",
        updated_by: "u1",
      },
      "operational",
    );
    expect(mapped.medicationName).toBe("Salbutamol");
    expect(mapped.internalNotes).toBeUndefined();
    expect(mapped.parentVisible).toBeUndefined();
    const diet = mapDietaryRecord(
      {
        id: "d1",
        student_profile_id: "s1",
        requirement_type: "allergy",
        requirement: "Nut-free",
        foods_to_avoid: "Peanuts",
        safe_alternatives: null,
        is_religious_or_cultural: false,
        related_allergy: null,
        texture_feeding_notes: null,
        parent_confirmed_on: null,
        review_on: null,
        status: "active",
        ended_on: null,
        parent_visible: true,
        internal_notes: "SECRET-DIET",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        created_by: "u1",
        updated_by: "u1",
      },
      "parent",
    );
    expect(diet.requirement).toBe("Nut-free");
    expect(diet.internalNotes).toBeUndefined();
    expect(summariseActiveMedications([{ medicationName: "Salbutamol", dosage: "2 puffs", isPrn: true, scheduleText: null }])).toContain(
      "Salbutamol",
    );
    expect(summariseActiveDietary([{ requirement: "Nut-free", foodsToAvoid: "Peanuts" }])).toContain("Peanuts");
  });
});
