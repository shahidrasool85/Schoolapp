import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools } from "@schoolapp/db";
import { addMembership, ensureMigrated, insertUser, login, testApp, testPools } from "./test-helpers";

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
    [`p115-${id}`, `Phase115 ${id}`],
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

function schoolHeaders(slug: string) {
  return {
    Host: `${slug}.localhost`,
    "Content-Type": "application/json",
  };
}

async function seedYear(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof headers>) {
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
  const cls = await app.request("/api/v1/classes", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      name: "3A",
      academicYearId: year.academicYear.id,
      yearGroupId: year3.id,
      classType: "form",
    }),
  });
  const classBody = (await cls.json()) as { class: { id: string } };
  return { yearId: year.academicYear.id, year3Id: year3.id, classId: classBody.class.id };
}

function browserAnswers(yearId: string, year3Id: string, name: string) {
  return {
    "child.legal_name": name,
    "child.preferred_name": "",
    "child.date_of_birth": "2017-05-05",
    "child.gender": "",
    "child.address": { line1: "12 Oak Lane", line2: "", town: "Leeds", postcode: "LS1 1AA" },
    "child.intended_academic_year_id": yearId,
    "child.intended_year_group_id": year3Id,
    "child.proposed_start_date": "",
    "child.current_school": "",
    "child.previous_school": "Park Primary",
    guardians: [
      {
        fullName: "Anita Patel",
        email: `anita.${name.replaceAll(" ", ".").toLowerCase()}@example.com`,
        phone: "01234567890",
        relationship: "mother",
        parentalResponsibility: true,
        primaryContact: true,
      },
      {
        fullName: "",
        email: "",
        phone: "",
        relationship: "",
        parentalResponsibility: false,
        primaryContact: false,
      },
    ],
    "previous_education.school_name": "Park Primary",
    "previous_education.start_date": "",
    "previous_education.end_date": "",
    "previous_education.report_details": "",
    "medical.allergies": "Nuts",
    "medical.conditions": "",
    "medical.medication": "",
    "medical.dietary": "Vegetarian",
    "medical.send_notes": "",
    "emergency.full_name": "Ravi Patel",
    "emergency.relationship": "father",
    "emergency.telephone": "01234567891",
    "emergency.authorised_collection": true,
    "application.notes": "Please consider for 3A",
    declaration_privacy: true,
  };
}

describe("phase 11.5 workflow integration", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("accepts the browser first-submit payload that previously failed as Invalid submission payload", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);

    const created = (await (
      await app.request("/api/v1/admissions/forms", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ formType: "application", name: "Year 3 application", slug: "year-3-application" }),
      })
    ).json()) as { form: { id: string; slug: string } };
    await app.request(`/api/v1/admissions/forms/${created.form.id}/publish`, { method: "POST", headers: hdrs });

    const rejected = await app.request("/api/v1/public/admissions/forms/application/year-3-application/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({ answers: { "child.legal_name": "Only name" } }),
    });
    expect(rejected.status).toBe(400);
    const rejectedBody = (await rejected.json()) as {
      error: { message: string; details?: { fieldKey?: string; sectionKey?: string } };
    };
    expect(rejectedBody.error.message).not.toBe("Invalid submission payload");
    expect(rejectedBody.error.message).toMatch(/required|date|email|guardian|year/i);
    expect(rejectedBody.error.details?.fieldKey).toBeTruthy();

    const submit = await app.request("/api/v1/public/admissions/forms/application/year-3-application/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({
        answers: browserAnswers(structure.yearId, structure.year3Id, "Noah Patel"),
        draft: false,
        continuationToken: null,
        publicId: null,
        idempotencyKey: randomUUID(),
      }),
    });
    expect(submit.status).toBe(201);
    const submitBody = (await submit.json()) as {
      submission: { applicationReference?: string; applicationId?: string };
    };
    expect(submitBody.submission.applicationReference).toMatch(/^APP-/);

    const listed = (await (await app.request("/api/v1/admissions/applications", { headers: hdrs })).json()) as {
      applications: Array<{ id: string; pupilLegalName: string; status: string }>;
    };
    const noah = listed.applications.find((row) => row.pupilLegalName === "Noah Patel");
    expect(noah?.status).toBe("submitted");

    const detail = (await (
      await app.request(`/api/v1/admissions/applications/${noah!.id}`, { headers: hdrs })
    ).json()) as {
      application: {
        pupilLegalName: string;
        previousSchool: string | null;
        publicFormName: string | null;
        extraFields: { canonical?: { medical?: { allergies?: string } } } | null;
      };
      contacts: Array<{ fullName: string; isEmergency?: boolean; authorisedCollection?: boolean }>;
      formSubmission: { canonicalSnapshot: { medical?: { dietary?: string } } };
    };
    expect(detail.application.publicFormName).toBe("Year 3 application");
    expect(detail.application.previousSchool).toBe("Park Primary");
    expect(detail.application.extraFields?.canonical?.medical?.allergies).toBe("Nuts");
    expect(detail.formSubmission.canonicalSnapshot.medical?.dietary).toBe("Vegetarian");
    expect(detail.contacts.some((row) => row.fullName === "Anita Patel")).toBe(true);
    expect(detail.contacts.some((row) => row.fullName === "Ravi Patel" && row.isEmergency)).toBe(true);
  });

  it("lets staff create the same application model and convert enquiry → application → enrolment", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);

    const enquiryForm = (await (
      await app.request("/api/v1/admissions/forms", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ formType: "enquiry", name: "Year 3 enquiry", slug: "year-3-enquiry" }),
      })
    ).json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${enquiryForm.form.id}/publish`, { method: "POST", headers: hdrs });

    const enquiryOk = await app.request("/api/v1/public/admissions/forms/enquiry/year-3-enquiry/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({
        answers: {
          "child.legal_name": "Maya Cole",
          "child.preferred_name": "Maya",
          "child.date_of_birth": "2018-04-12",
          "child.intended_academic_year_id": structure.yearId,
          "child.intended_year_group_id": structure.year3Id,
          "guardian.full_name": "Priya Cole",
          "guardian.relationship": "mother",
          "guardian.email": "priya.cole@example.com",
          "guardian.phone": "01234567890",
          "enquiry.notes": "Please send dates",
        },
      }),
    });
    expect(enquiryOk.status).toBe(201);
    const enquiries = (await (await app.request("/api/v1/admissions/enquiries", { headers: hdrs })).json()) as {
      enquiries: Array<{ id: string; pupilLegalName: string }>;
    };
    const enquiry = enquiries.enquiries.find((row) => row.pupilLegalName === "Maya Cole");
    expect(enquiry).toBeTruthy();

    const converted = await app.request(`/api/v1/admissions/enquiries/${enquiry!.id}/convert`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(converted.status).toBe(201);
    const convertedBody = (await converted.json()) as { application: { id: string; pupilLegalName: string } };
    expect(convertedBody.application.pupilLegalName).toBe("Maya Cole");

    const applyForm = (await (
      await app.request("/api/v1/admissions/forms", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ formType: "application", name: "Staff apply", slug: "staff-apply" }),
      })
    ).json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${applyForm.form.id}/publish`, { method: "POST", headers: hdrs });

    const staffSubmit = await app.request(`/api/v1/admissions/forms/${applyForm.form.id}/staff-submissions`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        answers: browserAnswers(structure.yearId, structure.year3Id, "Ibrahim Khan"),
        continuationToken: null,
        publicId: null,
        idempotencyKey: randomUUID(),
      }),
    });
    expect(staffSubmit.status).toBe(201);
    const staffBody = (await staffSubmit.json()) as { submission: { applicationId: string } };

    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    const teacherToken = await login(app, `teacher-${id}@example.com`, "password-12x");
    const teacherDenied = await app.request(`/api/v1/admissions/forms/${applyForm.form.id}/staff-submissions`, {
      method: "POST",
      headers: headers(teacherToken, school.orgId),
      body: JSON.stringify({ answers: browserAnswers(structure.yearId, structure.year3Id, "Should Fail") }),
    });
    expect(teacherDenied.status).toBe(403);

    await app.request(`/api/v1/admissions/applications/${staffBody.submission.applicationId}/status`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ status: "under_review" }),
    });
    const offer = await app.request(`/api/v1/admissions/applications/${staffBody.submission.applicationId}/offers`, {
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

    const detail = (await (
      await app.request(`/api/v1/admissions/applications/${staffBody.submission.applicationId}`, { headers: hdrs })
    ).json()) as { contacts: Array<{ id: string; email: string | null; isEmergency?: boolean }> };
    const parent = detail.contacts.find((row) => row.email);
    const enrolled = await app.request(
      `/api/v1/admissions/applications/${staffBody.submission.applicationId}/enrol`,
      {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: structure.yearId,
          yearGroupId: structure.year3Id,
          classId: structure.classId,
          guardianLinks: parent ? [{ contactId: parent.id, portalAccess: true }] : [],
        }),
      },
    );
    expect(enrolled.status).toBe(200);
    const enrolBody = (await enrolled.json()) as { studentProfileId: string; application: { status: string } };
    expect(enrolBody.application.status).toBe("enrolled");

    const pupil = (await (
      await app.request(`/api/v1/students/${enrolBody.studentProfileId}`, { headers: hdrs })
    ).json()) as {
      student: { legalName: string };
      guardians: Array<{ guardianEmail: string | null; portalAccess: boolean }>;
    };
    expect(pupil.student.legalName).toBe("Ibrahim Khan");
    expect(pupil.guardians.some((row) => row.guardianEmail?.includes("ibrahim") && row.portalAccess)).toBe(true);

    const stillApplication = await app.request(
      `/api/v1/admissions/applications/${staffBody.submission.applicationId}`,
      { headers: hdrs },
    );
    expect(stillApplication.status).toBe(200);
  });
});
