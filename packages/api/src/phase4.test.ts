import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools } from "@schoolapp/db";
import {
  addMembership,
  assertPortalSafe,
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
  const org = await owner.query<{ id: string; slug: string; name: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug, name",
    [`p4-${id}`, `Phase4 ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [
    org.rows[0]!.id,
  ]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return {
    adminId,
    orgId: org.rows[0]!.id,
    slug: org.rows[0]!.slug,
    name: org.rows[0]!.name,
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

async function seedYear(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof headers>) {
  const year = await app.request("/api/v1/academic-years", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      name: "2026/27",
      startsOn: "2026-09-01",
      endsOn: "2027-07-31",
      isCurrent: true,
    }),
  });
  const yearBody = (await year.json()) as { academicYear: { id: string } };
  await app.request("/api/v1/year-groups/seed", { method: "POST", headers: hdrs, body: "{}" });
  const groups = (await (await app.request("/api/v1/year-groups", { headers: hdrs })).json()) as {
    yearGroups: Array<{ id: string; code: string }>;
  };
  const year3 = groups.yearGroups.find((g) => g.code === "3")!;
  const cls = await app.request("/api/v1/classes", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      name: "3A",
      academicYearId: yearBody.academicYear.id,
      yearGroupId: year3.id,
      classType: "form",
    }),
  });
  const classBody = (await cls.json()) as { class: { id: string } };
  return { yearId: yearBody.academicYear.id, yearGroupId: year3.id, classId: classBody.class.id };
}

describe("Phase 4 admissions", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("runs enquiry through application, offer, conversion, and preserves history", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);

    const parentId = await insertUser(pools.owner, {
      email: `parent-${id}@example.com`,
      password: "keep-this-password",
      fullName: "Existing Parent",
      kind: "parent",
    });
    const existingChild = await app.request("/api/v1/students", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        legalName: "Older Sibling",
        academicYearId: structure.yearId,
        yearGroupId: structure.yearGroupId,
        classId: structure.classId,
      }),
    });
    const sibling = (await existingChild.json()) as { student: { id: string } };
    await app.request(`/api/v1/students/${sibling.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `parent-${id}@example.com`,
        fullName: "Existing Parent",
        portalAccess: true,
      }),
    });

    const enquiry = await app.request("/api/v1/admissions/enquiries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        pupilLegalName: "Younger Applicant",
        dateOfBirth: "2018-04-02",
        intendedAcademicYearId: structure.yearId,
        intendedYearGroupId: structure.yearGroupId,
        guardianFullName: "Existing Parent",
        guardianEmail: `parent-${id}@example.com`,
        source: "sibling",
      }),
    });
    expect(enquiry.status).toBe(201);
    const enquiryBody = (await enquiry.json()) as { enquiry: { id: string; reference: string } };

    const converted = await app.request(`/api/v1/admissions/enquiries/${enquiryBody.enquiry.id}/convert`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(converted.status).toBe(201);
    const application = (await converted.json()) as { application: { id: string; status: string } };
    expect(application.application.status).toBe("draft");

    const again = await app.request(`/api/v1/admissions/enquiries/${enquiryBody.enquiry.id}/convert`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { application: { id: string } }).application.id).toBe(
      application.application.id,
    );

    for (const status of ["submitted", "under_review"] as const) {
      const res = await app.request(`/api/v1/admissions/applications/${application.application.id}/status`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ status, reason: `move to ${status}` }),
      });
      expect(res.status).toBe(200);
    }

    const invalid = await app.request(`/api/v1/admissions/applications/${application.application.id}/status`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ status: "enrolled" }),
    });
    expect(invalid.status).toBe(400);

    const skip = await app.request(`/api/v1/admissions/applications/${application.application.id}/status`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ status: "accepted" }),
    });
    expect(skip.status).toBe(409);

    const assessment = await app.request(
      `/api/v1/admissions/applications/${application.application.id}/assessments`,
      {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          assessmentType: "admissions_interview",
          scheduledAt: "2026-05-01T10:00:00.000Z",
        }),
      },
    );
    expect(assessment.status).toBe(201);
    const assessmentBody = (await assessment.json()) as { assessment: { id: string } };
    const completed = await app.request(`/api/v1/admissions/assessments/${assessmentBody.assessment.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ status: "completed", recommendation: "waitlist" }),
    });
    expect(completed.status).toBe(200);

    const wait = await app.request(
      `/api/v1/admissions/applications/${application.application.id}/waiting-list`,
      {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ notes: "Year 3 full" }),
      },
    );
    expect(wait.status).toBe(201);

    const offer = await app.request(`/api/v1/admissions/applications/${application.application.id}/offers`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        offeredAcademicYearId: structure.yearId,
        offeredYearGroupId: structure.yearGroupId,
        responseDeadline: "2026-06-01",
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

    const detail = (await (
      await app.request(`/api/v1/admissions/applications/${application.application.id}`, { headers: hdrs })
    ).json()) as {
      application: { status: string };
      contacts: Array<{ id: string; email: string | null }>;
    };
    expect(detail.application.status).toBe("accepted");
    const contact = detail.contacts[0]!;

    const enrolled = await app.request(`/api/v1/admissions/applications/${application.application.id}/enrol`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: structure.yearId,
        yearGroupId: structure.yearGroupId,
        classId: structure.classId,
        guardianLinks: [{ contactId: contact.id, portalAccess: false }],
      }),
    });
    expect(enrolled.status).toBe(200);
    const enrolBody = (await enrolled.json()) as {
      studentProfileId: string;
      application: { status: string; id: string };
    };
    expect(enrolBody.application.status).toBe("enrolled");

    const retry = await app.request(`/api/v1/admissions/applications/${application.application.id}/enrol`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ guardianLinks: [] }),
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as { studentProfileId: string };
    expect(retryBody.studentProfileId).toBe(enrolBody.studentProfileId);

    const stillThere = await app.request(`/api/v1/admissions/applications/${application.application.id}`, {
      headers: hdrs,
    });
    expect(stillThere.status).toBe(200);
    const history = (await stillThere.json()) as {
      application: { status: string; convertedStudentProfileId: string };
      history: Array<{ newStatus: string }>;
    };
    expect(history.application.status).toBe("enrolled");
    expect(history.application.convertedStudentProfileId).toBe(enrolBody.studentProfileId);
    expect(history.history.map((row) => row.newStatus)).toContain("enrolled");

    const users = await pools.owner.query("select id from users where email = $1", [
      `parent-${id}@example.com`,
    ]);
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0]!.id).toBe(parentId);

    const relogin = await login(app, `parent-${id}@example.com`, "keep-this-password");
    const parentHdrs = headers(relogin, school.orgId);
    const children = await app.request("/api/v1/parent/children", { headers: parentHdrs });
    expect(children.status).toBe(200);
    const childBody = (await children.json()) as { children: Array<{ id: string }> };
    expect(childBody.children.map((row) => row.id)).toEqual([sibling.student.id]);
    assertPortalSafe(childBody);
    const blocked = await app.request(`/api/v1/parent/children/${enrolBody.studentProfileId}`, {
      headers: parentHdrs,
    });
    expect(blocked.status).toBe(404);

    const dashboard = await app.request("/api/v1/admissions/dashboard", { headers: hdrs });
    expect(dashboard.status).toBe(200);
  });

  it("isolates admissions across schools and rejects spoofed organisation headers", async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, `a-${id}`);
    const schoolB = await createSchool(pools.owner, `b-${id}`);
    const tokenA = await login(app, schoolA.adminEmail, "password-12x");
    const tokenB = await login(app, schoolB.adminEmail, "password-12x");
    const hdrsA = headers(tokenA, schoolA.orgId);
    const hdrsB = headers(tokenB, schoolB.orgId);
    await seedYear(app, hdrsA);
    const structureB = await seedYear(app, hdrsB);

    const createdB = await app.request("/api/v1/admissions/applications", {
      method: "POST",
      headers: hdrsB,
      body: JSON.stringify({
        pupilLegalName: "School B Pupil",
        intendedAcademicYearId: structureB.yearId,
        intendedYearGroupId: structureB.yearGroupId,
      }),
    });
    const appB = (await createdB.json()) as { application: { id: string } };

    const enquiryB = await app.request("/api/v1/admissions/enquiries", {
      method: "POST",
      headers: hdrsB,
      body: JSON.stringify({
        pupilLegalName: "School B Enquiry",
        guardianFullName: "Parent B",
      }),
    });
    const enqB = (await enquiryB.json()) as { enquiry: { id: string } };

    const missingApp = await app.request(`/api/v1/admissions/applications/${appB.application.id}`, {
      headers: hdrsA,
    });
    expect(missingApp.status).toBe(404);

    const missingEnq = await app.request(`/api/v1/admissions/enquiries/${enqB.enquiry.id}`, {
      headers: hdrsA,
    });
    expect(missingEnq.status).toBe(404);

    const spoof = await app.request(`/api/v1/admissions/applications/${appB.application.id}`, {
      headers: headers(tokenA, schoolB.orgId),
    });
    expect(spoof.status).toBe(403);

    const attachAssessment = await app.request(
      `/api/v1/admissions/applications/${appB.application.id}/assessments`,
      {
        method: "POST",
        headers: hdrsA,
        body: JSON.stringify({ assessmentType: "school_visit" }),
      },
    );
    expect(attachAssessment.status).toBe(404);

    const attachOffer = await app.request(`/api/v1/admissions/applications/${appB.application.id}/offers`, {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({}),
    });
    expect(attachOffer.status).toBe(404);

    const attachWait = await app.request(
      `/api/v1/admissions/applications/${appB.application.id}/waiting-list`,
      {
        method: "POST",
        headers: hdrsA,
        body: "{}",
      },
    );
    expect(attachWait.status).toBe(404);

    await app.request(`/api/v1/admissions/applications/${appB.application.id}/status`, {
      method: "POST",
      headers: hdrsB,
      body: JSON.stringify({ status: "submitted" }),
    });
    await app.request(`/api/v1/admissions/applications/${appB.application.id}/status`, {
      method: "POST",
      headers: hdrsB,
      body: JSON.stringify({ status: "under_review" }),
    });
    const offerB = await app.request(`/api/v1/admissions/applications/${appB.application.id}/offers`, {
      method: "POST",
      headers: hdrsB,
      body: JSON.stringify({}),
    });
    const offerBody = (await offerB.json()) as { offer: { id: string } };
    await app.request(`/api/v1/admissions/offers/${offerBody.offer.id}`, {
      method: "PATCH",
      headers: hdrsB,
      body: JSON.stringify({ status: "accepted" }),
    });

    const structureA = await (await app.request("/api/v1/academic-years", { headers: hdrsA })).json() as {
      academicYears: Array<{ id: string }>;
    };
    const steal = await app.request(`/api/v1/admissions/applications/${appB.application.id}/enrol`, {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({ academicYearId: structureA.academicYears[0]?.id }),
    });
    expect(steal.status).toBe(404);

    const crossYear = await app.request(`/api/v1/admissions/applications/${appB.application.id}/enrol`, {
      method: "POST",
      headers: hdrsB,
      body: JSON.stringify({ academicYearId: structureA.academicYears[0]?.id }),
    });
    expect(crossYear.status).toBe(400);
  });

  it("denies teachers, parents, and students admissions admin APIs", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const adminHdrs = headers(adminToken, school.orgId);
    const structure = await seedYear(app, adminHdrs);

    const staff = await app.request("/api/v1/staff", {
      method: "POST",
      headers: adminHdrs,
      body: JSON.stringify({
        email: `teacher-${id}@example.com`,
        fullName: "Terry Teacher",
        roleKeys: ["school.teacher"],
      }),
    });
    const staffBody = (await staff.json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: staffBody.invitationToken,
        fullName: "Terry Teacher",
        password: "teacher-pass-1",
      }),
    });
    const teacherToken = await login(app, `teacher-${id}@example.com`, "teacher-pass-1");
    const teacherDash = await app.request("/api/v1/admissions/dashboard", {
      headers: headers(teacherToken, school.orgId),
    });
    expect(teacherDash.status).toBe(403);

    const student = await app.request("/api/v1/students", {
      method: "POST",
      headers: adminHdrs,
      body: JSON.stringify({ legalName: "Sam Student" }),
    });
    const studentBody = (await student.json()) as { student: { id: string } };
    const guardian = await app.request(`/api/v1/students/${studentBody.student.id}/guardians`, {
      method: "POST",
      headers: adminHdrs,
      body: JSON.stringify({
        email: `parent-adm-${id}@example.com`,
        fullName: "Pat Parent",
        portalAccess: true,
      }),
    });
    const guardianBody = (await guardian.json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: guardianBody.invitationToken,
        fullName: "Pat Parent",
        password: "parent-pass-1",
      }),
    });
    const parentToken = await login(app, `parent-adm-${id}@example.com`, "parent-pass-1");
    const parentDash = await app.request("/api/v1/admissions/dashboard", {
      headers: headers(parentToken, school.orgId),
    });
    expect(parentDash.status).toBe(403);
    const parentApps = await app.request("/api/v1/admissions/applications", {
      headers: headers(parentToken, school.orgId),
    });
    expect(parentApps.status).toBe(403);

    const pupilUser = await insertUser(pools.owner, {
      email: `pupil-${id}@example.com`,
      password: "student-pass-1",
      fullName: "Sam Student",
      kind: "student",
    });
    await addMembership(pools.owner, school.orgId, pupilUser, "school.student");
    const studentToken = await login(app, `pupil-${id}@example.com`, "student-pass-1");
    const studentDash = await app.request("/api/v1/admissions/dashboard", {
      headers: headers(studentToken, school.orgId),
    });
    expect(studentDash.status).toBe(403);

    const created = await app.request("/api/v1/admissions/applications", {
      method: "POST",
      headers: adminHdrs,
      body: JSON.stringify({ pupilLegalName: "Hidden Applicant" }),
    });
    const createdBody = (await created.json()) as { application: { id: string; internalNotes?: string } };
    const parentChild = await app.request("/api/v1/parent/children", {
      headers: headers(parentToken, school.orgId),
    });
    const parentPayload = await parentChild.json();
    assertPortalSafe(parentPayload);
    expect(JSON.stringify(parentPayload)).not.toContain(createdBody.application.id);
    expect(JSON.stringify(parentPayload)).not.toContain("internalNotes");
    void structure;
  });
});
