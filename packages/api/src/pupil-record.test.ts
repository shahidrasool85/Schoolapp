import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePermanentUpn } from "@schoolapp/core";
import { closePools } from "@schoolapp/db";
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

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string, slugPrefix = "pr") {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`${slugPrefix}-${id}`, `Pupil record ${id}`],
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
  ).json()) as { academicYear: { id: string; name: string } };
  await app.request("/api/v1/year-groups/seed", { method: "POST", headers: hdrs, body: "{}" });
  const groups = (await (await app.request("/api/v1/year-groups", { headers: hdrs })).json()) as {
    yearGroups: Array<{ id: string; code: string; name: string }>;
  };
  const year3 = groups.yearGroups.find((g) => g.code === "3")!;
  const nursery = groups.yearGroups.find((g) => g.code === "N")!;
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
  return {
    yearId: year.academicYear.id,
    yearName: year.academicYear.name,
    year3Id: year3.id,
    nurseryId: nursery?.id ?? null,
    classAId: classA.class.id,
    yearGroups: groups.yearGroups,
  };
}

async function createStudent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
  input: Record<string, unknown>,
) {
  const created = await app.request("/api/v1/students", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(input),
  });
  expect(created.status).toBe(201);
  return (await created.json()) as { student: { id: string; dateOfBirth: string | null } };
}

async function acceptAndEnrol(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
  applicationId: string,
  structure: { yearId: string; year3Id: string; classAId: string },
) {
  for (const status of ["submitted", "under_review"] as const) {
    const res = await app.request(`/api/v1/admissions/applications/${applicationId}/status`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ status, reason: `move to ${status}` }),
    });
    expect(res.status).toBe(200);
  }
  const offer = await app.request(`/api/v1/admissions/applications/${applicationId}/offers`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      offeredAcademicYearId: structure.yearId,
      offeredYearGroupId: structure.year3Id,
    }),
  });
  expect(offer.status).toBe(201);
  const offerBody = (await offer.json()) as { offer: { id: string } };
  const accepted = await app.request(`/api/v1/admissions/offers/${offerBody.offer.id}`, {
    method: "PATCH",
    headers: hdrs,
    body: JSON.stringify({ status: "accepted" }),
  });
  expect(accepted.status).toBe(200);
  const enrolled = await app.request(`/api/v1/admissions/applications/${applicationId}/enrol`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      academicYearId: structure.yearId,
      yearGroupId: structure.year3Id,
      classId: structure.classAId,
    }),
  });
  expect(enrolled.status).toBe(200);
  return (await enrolled.json()) as { studentProfileId: string };
}

describe("pupil record statutory and identity stabilisation", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("updates canonical DOB on the user record and clears statutory validation", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Freya Walsh",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
    });
    expect(pupil.student.dateOfBirth).toBeNull();

    const before = (await (
      await app.request(`/api/v1/students/${pupil.student.id}/statutory`, { headers: hdrs })
    ).json()) as { issues: Array<{ ruleKey: string; fixLabel?: string | null; fixPath?: string | null }> };
    expect(before.issues.some((issue) => issue.ruleKey === "pupil.dob.missing")).toBe(true);
    const dobIssue = before.issues.find((issue) => issue.ruleKey === "pupil.dob.missing");
    expect(dobIssue?.fixLabel).toBe("Fix pupil details");
    expect(dobIssue?.fixPath).toContain("#overview");

    const patched = await app.request(`/api/v1/students/${pupil.student.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({
        dateOfBirth: "2018-04-12",
        preferredName: "Freya",
        gender: "female",
        addressLine1: "1 High Street",
        addressTown: "Leeds",
        addressPostcode: "LS1 1AA",
      }),
    });
    expect(patched.status).toBe(200);
    const body = (await patched.json()) as {
      student: { dateOfBirth: string | null; preferredName: string | null; gender: string | null; addressLine1: string | null };
    };
    expect(body.student.dateOfBirth).toBe("2018-04-12");
    expect(body.student.preferredName).toBe("Freya");
    expect(body.student.gender).toBe("female");
    expect(body.student.addressLine1).toBe("1 High Street");

    const stored = await pools.owner.query<{ date_of_birth: string | null }>(
      `select u.date_of_birth::text
       from student_profiles sp
       join users u on u.id = sp.user_id
       where sp.id = $1`,
      [pupil.student.id],
    );
    expect(stored.rows[0]?.date_of_birth).toBe("2018-04-12");

    const after = (await (
      await app.request(`/api/v1/students/${pupil.student.id}/statutory`, { headers: hdrs })
    ).json()) as { issues: Array<{ ruleKey: string }> };
    expect(after.issues.some((issue) => issue.ruleKey === "pupil.dob.missing")).toBe(false);
  });

  it("copies application DOB, previous school and valid gender, and never fabricates missing DOB", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "pr-conv");
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await seedYear(app, hdrs);

    const withDob = await app.request("/api/v1/admissions/applications", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        pupilLegalName: "Noah Patel",
        pupilPreferredName: "Noah",
        dateOfBirth: "2018-03-04",
        previousSchool: "Local primary",
        intendedAcademicYearId: year.yearId,
        intendedYearGroupId: year.year3Id,
        contacts: [{ fullName: "Anita Patel", email: `anita-${id}@example.test`, relationship: "mother" }],
      }),
    });
    expect(withDob.status).toBe(201);
    const withDobBody = (await withDob.json()) as { application: { id: string } };
    await pools.owner.query(`update admissions_applications set gender = 'male' where id = $1`, [
      withDobBody.application.id,
    ]);
    const enrolledWith = await acceptAndEnrol(app, hdrs, withDobBody.application.id, year);
    const copied = (await (
      await app.request(`/api/v1/students/${enrolledWith.studentProfileId}`, { headers: hdrs })
    ).json()) as { student: { dateOfBirth: string | null; preferredName: string | null; gender: string | null } };
    expect(copied.student.dateOfBirth).toBe("2018-03-04");
    expect(copied.student.preferredName).toBe("Noah");
    expect(copied.student.gender).toBe("male");
    const statutory = (await (
      await app.request(`/api/v1/students/${enrolledWith.studentProfileId}/statutory`, { headers: hdrs })
    ).json()) as { statutory: { sex: string | null; previousSchoolName: string | null; lookedAfterStatus: string | null } };
    expect(statutory.statutory.sex).toBe("M");
    expect(statutory.statutory.previousSchoolName).toBe("Local primary");
    expect(statutory.statutory.lookedAfterStatus === "none" || statutory.statutory.lookedAfterStatus == null).toBe(true);
    expect(statutory.statutory.lookedAfterStatus).not.toBe("looked_after");

    const missing = await app.request("/api/v1/admissions/applications", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        pupilLegalName: "Freya Walsh",
        previousSchool: "Local primary",
        intendedAcademicYearId: year.yearId,
        intendedYearGroupId: year.year3Id,
      }),
    });
    const missingBody = (await missing.json()) as { application: { id: string } };
    await pools.owner.query(`update admissions_applications set gender = 'prefer_not_to_say' where id = $1`, [
      missingBody.application.id,
    ]);
    const enrolledMissing = await acceptAndEnrol(app, hdrs, missingBody.application.id, year);
    const blank = (await (
      await app.request(`/api/v1/students/${enrolledMissing.studentProfileId}`, { headers: hdrs })
    ).json()) as { student: { dateOfBirth: string | null; gender: string | null } };
    expect(blank.student.dateOfBirth).toBeNull();
    expect(blank.student.gender).toBe("prefer_not_to_say");
    const blankStatutory = (await (
      await app.request(`/api/v1/students/${enrolledMissing.studentProfileId}/statutory`, { headers: hdrs })
    ).json()) as { statutory: { sex: string | null; lookedAfterStatus: string | null }; issues: Array<{ ruleKey: string }> };
    expect(blankStatutory.statutory.sex).toBeNull();
    expect(blankStatutory.issues.some((issue) => issue.ruleKey === "pupil.dob.missing")).toBe(true);
    expect(blankStatutory.statutory.lookedAfterStatus).not.toBe("looked_after");
  });

  it("rejects invalid and duplicate UPNs without treating empty as invalid", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "pr-upn");
    const oak = await createSchool(pools.owner, `${id}oak`, "pr-oak");
    const token = await login(app, school.adminEmail, "password-12x");
    const oakToken = await login(app, oak.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const oakHdrs = jsonHeaders(oakToken, oak.orgId);
    const year = await seedYear(app, hdrs);
    const oakYear = await seedYear(app, oakHdrs);
    const a = await createStudent(app, hdrs, {
      legalName: "Amelia Khan",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
      dateOfBirth: "2018-04-12",
    });
    const b = await createStudent(app, hdrs, {
      legalName: "Jack Brennan",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      dateOfBirth: "2018-08-21",
    });
    const oakPupil = await createStudent(app, oakHdrs, {
      legalName: "Oak Child",
      academicYearId: oakYear.yearId,
      yearGroupId: oakYear.year3Id,
      dateOfBirth: "2018-01-01",
    });
    const upn = generatePermanentUpn("201990190001");
    const invalid = await app.request(`/api/v1/students/${a.student.id}/statutory`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ upn: "NOT-A-UPN", sex: "F" }),
    });
    expect(invalid.status).toBe(400);
    const invalidBody = (await invalid.json()) as { error: { message: string; details?: { fieldKey?: string } } };
    expect(invalidBody.error.message).toBe("UPN format is invalid");
    expect(invalidBody.error.details?.fieldKey).toBe("upn");

    const empty = await app.request(`/api/v1/students/${a.student.id}/statutory`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ upn: null, sex: "F", lookedAfterStatus: "none" }),
    });
    expect(empty.status).toBe(200);
    const savedEmpty = (await empty.json()) as { statutory: { upn: string | null; lookedAfterStatus: string | null; sex: string | null } };
    expect(savedEmpty.statutory.upn).toBeNull();
    expect(savedEmpty.statutory.lookedAfterStatus).toBe("none");
    expect(savedEmpty.statutory.sex).toBe("F");

    const first = await app.request(`/api/v1/students/${a.student.id}/statutory`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ upn, sex: "F" }),
    });
    expect(first.status).toBe(200);
    const duplicate = await app.request(`/api/v1/students/${b.student.id}/statutory`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ upn, sex: "M" }),
    });
    expect(duplicate.status).toBe(409);
    const duplicateBody = (await duplicate.json()) as { error: { message: string } };
    expect(duplicateBody.error.message).toMatch(/UPN is already in use/i);

    const isolated = await app.request(`/api/v1/students/${oakPupil.student.id}/statutory`, {
      method: "PATCH",
      headers: oakHdrs,
      body: JSON.stringify({ upn, sex: "F" }),
    });
    expect(isolated.status).toBe(200);
  });

  it("does not persist looked-after from an omitted sensitive default and rejects overlapping placement", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "pr-enr");
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Freya Walsh",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
      dateOfBirth: "2018-04-12",
    });
    const created = await app.request(`/api/v1/students/${pupil.student.id}/statutory`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ sex: "F" }),
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { statutory: { lookedAfterStatus: string; serviceChild: boolean | null; sendProvisionCode: string | null } };
    expect(createdBody.statutory.lookedAfterStatus).toBe("none");
    expect(createdBody.statutory.serviceChild).toBeNull();
    expect(createdBody.statutory.sendProvisionCode).toBeNull();

    const same = await app.request(`/api/v1/students/${pupil.student.id}/enrolments`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: year.yearId,
        yearGroupId: year.year3Id,
        classId: year.classAId,
        placementKind: "primary",
      }),
    });
    expect(same.status).toBe(409);

    const classes = (await (await app.request("/api/v1/classes", { headers: hdrs })).json()) as {
      classes: Array<{ id: string; yearGroupId: string | null; academicYearId: string; classType: string }>;
    };
    expect(classes.classes.some((row) => row.id === year.classAId && row.yearGroupId === year.year3Id)).toBe(true);
  });

  it("invites a parent once, links an existing same-org parent, and keeps portal access explicit", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "pr-inv");
    const oak = await createSchool(pools.owner, `${id}b`, "pr-inv-oak");
    const token = await login(app, school.adminEmail, "password-12x");
    const oakToken = await login(app, oak.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const oakHdrs = jsonHeaders(oakToken, oak.orgId);
    const year = await seedYear(app, hdrs);
    const oakYear = await seedYear(app, oakHdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Freya Walsh",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
    });
    const oakPupil = await createStudent(app, oakHdrs, {
      legalName: "Oak Child",
      academicYearId: oakYear.yearId,
      yearGroupId: oakYear.year3Id,
    });

    const invited = await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `siobhan-${id}@example.test`,
        fullName: "Siobhan Walsh",
        relationship: "mother",
        portalAccess: false,
      }),
    });
    expect(invited.status).toBe(201);
    const invitedBody = (await invited.json()) as {
      invitationToken: string | null;
      alreadyLinked: boolean;
      guardianship: { membershipStatus: string | null; portalAccess: boolean; guardianEmail: string | null };
    };
    expect(invitedBody.alreadyLinked).toBe(false);
    expect(invitedBody.invitationToken).toMatch(/^[a-f0-9]{64}$/);
    expect(invitedBody.guardianship.membershipStatus).toBe("invited");
    expect(invitedBody.guardianship.portalAccess).toBe(false);

    const again = await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `siobhan-${id}@example.test`,
        fullName: "Siobhan Walsh",
        relationship: "mother",
      }),
    });
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { invitationToken: string | null; alreadyLinked: boolean };
    expect(againBody.alreadyLinked).toBe(true);
    expect(againBody.invitationToken).toBeNull();

    const hashed = await pools.owner.query<{ token_hash: string | null }>(
      `select token_hash from invitations where organisation_id = $1 and email = $2`,
      [school.orgId, `siobhan-${id}@example.test`],
    );
    expect(hashed.rows[0]?.token_hash).toBeTruthy();
    expect(hashed.rows[0]?.token_hash).not.toBe(invitedBody.invitationToken);

    const existingParent = await insertUser(pools.owner, {
      email: `linked-${id}@example.test`,
      password: "parent-pass-1",
      fullName: "Existing Parent",
      kind: "parent",
    });
    await addMembership(pools.owner, school.orgId, existingParent, "school.parent");
    const linked = await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `linked-${id}@example.test`,
        fullName: "Existing Parent",
        relationship: "father",
        portalAccess: true,
      }),
    });
    expect(linked.status).toBe(201);
    const linkedBody = (await linked.json()) as {
      invitationToken: string | null;
      guardianUserId: string;
      guardianship: { portalAccess: boolean };
    };
    expect(linkedBody.invitationToken).toBeNull();
    expect(linkedBody.guardianUserId).toBe(existingParent);
    expect(linkedBody.guardianship.portalAccess).toBe(true);

    const oakInvite = await app.request(`/api/v1/students/${oakPupil.student.id}/guardians`, {
      method: "POST",
      headers: oakHdrs,
      body: JSON.stringify({
        email: `siobhan-${id}@example.test`,
        fullName: "Siobhan Walsh",
        portalAccess: true,
      }),
    });
    expect(oakInvite.status).toBe(201);
    const greenwood = (await (
      await app.request(`/api/v1/students/${pupil.student.id}`, { headers: hdrs })
    ).json()) as { guardians: Array<{ guardianEmail: string | null; portalAccess: boolean }> };
    expect(greenwood.guardians.some((row) => row.guardianEmail === `siobhan-${id}@example.test` && row.portalAccess === false)).toBe(
      true,
    );
    const oakDetail = (await (
      await app.request(`/api/v1/students/${oakPupil.student.id}`, { headers: oakHdrs })
    ).json()) as { guardians: Array<{ portalAccess: boolean }> };
    expect(oakDetail.guardians.some((row) => row.portalAccess)).toBe(true);
  });

  it("keeps identity edits and statutory data off teacher, parent and student mutation paths", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id, "pr-acl");
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await seedYear(app, hdrs);
    await app.request(`/api/v1/year-groups/${year.year3Id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ studentLoginEnabled: true }),
    });
    const pupil = await createStudent(app, hdrs, {
      legalName: "Freya Walsh",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
      dateOfBirth: "2018-04-12",
      loginAlias: `freya-${id}`,
      password: "student-pass-1",
    });
    await app.request(`/api/v1/students/${pupil.student.id}/statutory`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ upn: generatePermanentUpn("201990190011"), sex: "F", lookedAfterStatus: "none" }),
    });

    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    const teacherToken = await login(app, `teacher-${id}@example.com`, "password-12x");
    const teacherHdrs = jsonHeaders(teacherToken, school.orgId);
    expect(
      (
        await app.request(`/api/v1/students/${pupil.student.id}`, {
          method: "PATCH",
          headers: teacherHdrs,
          body: JSON.stringify({ dateOfBirth: "2010-01-01" }),
        })
      ).status,
    ).toBe(403);
    expect((await app.request(`/api/v1/students/${pupil.student.id}/statutory`, { headers: teacherHdrs })).status).toBe(
      403,
    );

    const parent = await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `parent-${id}@example.test`,
        fullName: "Siobhan Walsh",
        portalAccess: true,
      }),
    });
    const parentBody = (await parent.json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: parentBody.invitationToken,
        fullName: "Siobhan Walsh",
        password: "parent-pass-1",
      }),
    });
    const parentToken = await login(app, `parent-${id}@example.test`, "parent-pass-1");
    const parentHdrs = jsonHeaders(parentToken, school.orgId);
    const children = await app.request("/api/v1/parent/children", { headers: parentHdrs });
    expect(children.status).toBe(200);
    assertPortalSafe(await children.json());
    expect(
      (
        await app.request(`/api/v1/students/${pupil.student.id}`, {
          method: "PATCH",
          headers: parentHdrs,
          body: JSON.stringify({ dateOfBirth: "2010-01-01" }),
        })
      ).status,
    ).toBe(403);

    const studentToken = await loginAlias(app, school.slug, `freya-${id}`, "student-pass-1");
    const studentHdrs = jsonHeaders(studentToken, school.orgId);
    const me = await app.request("/api/v1/student/me", { headers: studentHdrs });
    if (me.status === 200) assertPortalSafe(await me.json());
    expect(
      (
        await app.request(`/api/v1/students/${pupil.student.id}`, {
          method: "PATCH",
          headers: studentHdrs,
          body: JSON.stringify({ dateOfBirth: "2010-01-01" }),
        })
      ).status,
    ).toBe(403);
  });
});
