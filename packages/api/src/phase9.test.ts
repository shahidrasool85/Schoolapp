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
    [`p9-${id}`, `Phase9 ${id}`],
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

function schoolHeaders(slug: string, extra: Record<string, string> = {}) {
  return {
    Host: `${slug}.localhost`,
    "Content-Type": "application/json",
    ...extra,
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
  return { yearId: year.academicYear.id, year3Id: groups.yearGroups.find((g) => g.code === "3")!.id };
}

describe("phase 9 public admissions forms", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("creates, publishes, and shares a form with QR and embed code", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);

    const created = (await (
      await app.request("/api/v1/admissions/forms", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          formType: "enquiry",
          name: "Year 3 enquiry",
          slug: "year-3-enquiry",
          successText: "Thanks",
        }),
      })
    ).json()) as { form: { id: string; status: string; slug: string }; sections: unknown[] };
    expect(created.form.status).toBe("draft");
    expect(created.sections.length).toBeGreaterThan(1);

    const published = await app.request(`/api/v1/admissions/forms/${created.form.id}/publish`, {
      method: "POST",
      headers: hdrs,
    });
    expect(published.status).toBe(200);

    const share = (await (
      await app.request(`/api/v1/admissions/forms/${created.form.id}/share`, { headers: hdrs })
    ).json()) as { publicUrl: string; embedCode: string; qrSvg: string };
    expect(share.publicUrl).toContain(`/admissions/enquiry/year-3-enquiry`);
    expect(share.embedCode).toContain("<iframe");
    expect(share.qrSvg).toContain("<svg");

    const copy = await app.request(`/api/v1/admissions/forms/${created.form.id}/duplicate`, {
      method: "POST",
      headers: hdrs,
    });
    expect(copy.status).toBe(201);
  });

  it("accepts public enquiry and application submissions into the existing workflow", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);

    await app.request("/api/v1/admissions/campaigns", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ publicCode: "facebook", label: "Facebook" }),
    });

    const enquiryForm = (await (
      await app.request("/api/v1/admissions/forms", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ formType: "enquiry", name: "Enquiry", slug: "enquire" }),
      })
    ).json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${enquiryForm.form.id}/publish`, { method: "POST", headers: hdrs });

    const applyCreated = await app.request("/api/v1/admissions/forms", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ formType: "application", name: "Apply", slug: "apply" }),
    });
    expect(applyCreated.status).toBe(201);
    const applyForm = (await applyCreated.json()) as {
      form: { id: string };
      sections: Array<{ fields: Array<{ fieldKey: string }> }>;
    };
    await app.request(`/api/v1/admissions/forms/${applyForm.form.id}/definition`, {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        sections: [
          {
            sectionKey: "child",
            title: "Child",
            fields: [
              { fieldKind: "canonical", canonicalKey: "child.legal_name", questionType: "short_text", label: "Name", required: true },
              { fieldKind: "canonical", canonicalKey: "child.date_of_birth", questionType: "date", label: "DOB", required: true },
              { fieldKind: "canonical", canonicalKey: "child.intended_academic_year_id", questionType: "single_choice", label: "Year", required: true },
              { fieldKind: "canonical", canonicalKey: "child.intended_year_group_id", questionType: "single_choice", label: "Group", required: true },
            ],
          },
          {
            sectionKey: "guardians",
            title: "Guardians",
            fields: [
              { fieldKind: "canonical", canonicalKey: "guardians", questionType: "guardian_group", label: "Guardians", required: true },
            ],
          },
          {
            sectionKey: "extra",
            title: "Extra",
            fields: [
              { fieldKind: "custom", fieldKey: "favourite_colour", questionType: "short_text", label: "Favourite colour" },
              { fieldKind: "custom", fieldKey: "declaration_ok", questionType: "declaration", label: "I agree", required: true },
            ],
          },
        ],
      }),
    });
    await app.request(`/api/v1/admissions/forms/${applyForm.form.id}/publish`, { method: "POST", headers: hdrs });

    const publicForm = await app.request("/api/v1/public/admissions/forms/enquiry/enquire", {
      headers: schoolHeaders(school.slug),
    });
    expect(publicForm.status).toBe(200);

    const enquiryRes = await app.request("/api/v1/public/admissions/forms/enquiry/enquire/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug, { "X-Organisation-Id": randomUUID() }),
      body: JSON.stringify({
        source: "facebook",
        answers: {
          "child.legal_name": "Maya Cole",
          "child.date_of_birth": "2018-04-12",
          "child.intended_academic_year_id": structure.yearId,
          "child.intended_year_group_id": structure.year3Id,
          "guardian.full_name": "Priya Cole",
          "guardian.email": "priya.cole@example.com",
          "enquiry.notes": "Please send dates",
        },
      }),
    });
    expect(enquiryRes.status).toBe(403);

    const enquiryOk = await app.request("/api/v1/public/admissions/forms/enquiry/enquire/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({
        source: "facebook",
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
    const enquiryBody = (await enquiryOk.json()) as { submission: { enquiryReference: string } };
    expect(enquiryBody.submission.enquiryReference).toMatch(/^ENQ-/);

    const listed = (await (await app.request("/api/v1/admissions/enquiries", { headers: hdrs })).json()) as {
      enquiries: Array<{ pupilLegalName: string; source: string; id: string }>;
    };
    expect(listed.enquiries.some((row) => row.pupilLegalName === "Maya Cole" && row.source === "Facebook")).toBe(true);
    const enquiryDetail = (await (
      await app.request(`/api/v1/admissions/enquiries/${listed.enquiries.find((row) => row.pupilLegalName === "Maya Cole")!.id}`, {
        headers: hdrs,
      })
    ).json()) as { formSubmission: { answers: Record<string, string>; declarationSnapshot: unknown } };
    expect(enquiryDetail.formSubmission.answers["child.legal_name"]).toBe("Maya Cole");

    const applyOk = await app.request("/api/v1/public/admissions/forms/application/apply/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({
        source: "facebook",
        answers: {
          "child.legal_name": "Noah Patel",
          "child.date_of_birth": "2017-05-05",
          "child.intended_academic_year_id": structure.yearId,
          "child.intended_year_group_id": structure.year3Id,
          guardians: [
            { fullName: "Anita Patel", email: "anita@example.com", primaryContact: true, parentalResponsibility: true },
            { fullName: "Ravi Patel", email: "ravi@example.com", relationship: "father" },
          ],
          favourite_colour: "green",
          declaration_ok: true,
        },
      }),
    });
    expect(applyOk.status).toBe(201);
    const applyBody = (await applyOk.json()) as { submission: { applicationReference: string; publicId: string } };
    expect(applyBody.submission.applicationReference).toMatch(/^APP-/);

    const applications = (await (await app.request("/api/v1/admissions/applications", { headers: hdrs })).json()) as {
      applications: Array<{ id: string; pupilLegalName: string; status: string }>;
    };
    const noah = applications.applications.find((row) => row.pupilLegalName === "Noah Patel");
    expect(noah?.status).toBe("submitted");
    const detail = (await (
      await app.request(`/api/v1/admissions/applications/${noah!.id}`, { headers: hdrs })
    ).json()) as {
      contacts: Array<{ fullName: string }>;
      formSubmission: { answers: Record<string, unknown>; declarationSnapshot: { declarations: unknown[] } };
      application: { completenessStatus: string };
    };
    expect(detail.contacts.map((row) => row.fullName).sort()).toEqual(["Anita Patel", "Ravi Patel"]);
    expect(detail.formSubmission.answers.favourite_colour).toBe("green");
    expect(detail.formSubmission.declarationSnapshot.declarations.length).toBe(1);
    expect(detail.application.completenessStatus).toBe("complete");

    const sources = (await (await app.request("/api/v1/admissions/sources", { headers: hdrs })).json()) as {
      sources: Array<{ code: string; submissions: number }>;
    };
    expect(sources.sources.some((row) => row.code === "facebook" && row.submissions >= 2)).toBe(true);
  });

  it("rejects unpublished, expired, invalid, oversized, and cross-tenant public access", async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, `${id}a`);
    const schoolB = await createSchool(pools.owner, `${id}b`);
    const tokenA = await login(app, schoolA.adminEmail, "password-12x");
    const tokenB = await login(app, schoolB.adminEmail, "password-12x");
    const hdrsA = headers(tokenA, schoolA.orgId);
    const hdrsB = headers(tokenB, schoolB.orgId);
    const yearA = await seedYear(app, hdrsA);

    const draft = (await (
      await app.request("/api/v1/admissions/forms", {
        method: "POST",
        headers: hdrsA,
        body: JSON.stringify({ formType: "enquiry", name: "Hidden", slug: "hidden" }),
      })
    ).json()) as { form: { id: string } };
    const unpublished = await app.request("/api/v1/public/admissions/forms/enquiry/hidden", {
      headers: schoolHeaders(schoolA.slug),
    });
    expect(unpublished.status).toBe(404);

    await app.request(`/api/v1/admissions/forms/${draft.form.id}`, {
      method: "PATCH",
      headers: hdrsA,
      body: JSON.stringify({ closesAt: "2020-01-01T00:00:00.000Z" }),
    });
    await app.request(`/api/v1/admissions/forms/${draft.form.id}/publish`, { method: "POST", headers: hdrsA });
    const expired = await app.request("/api/v1/public/admissions/forms/enquiry/hidden", {
      headers: schoolHeaders(schoolA.slug),
    });
    expect(expired.status).toBe(404);

    const live = (await (
      await app.request("/api/v1/admissions/forms", {
        method: "POST",
        headers: hdrsA,
        body: JSON.stringify({ formType: "enquiry", name: "Live", slug: "live" }),
      })
    ).json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${live.form.id}/publish`, { method: "POST", headers: hdrsA });

    const xss = await app.request("/api/v1/public/admissions/forms/enquiry/live/submissions", {
      method: "POST",
      headers: schoolHeaders(schoolA.slug),
      body: JSON.stringify({
        answers: {
          "child.legal_name": "<script>alert(1)</script>Maya",
          "child.date_of_birth": "2018-01-01",
          "child.intended_academic_year_id": yearA.yearId,
          "child.intended_year_group_id": yearA.year3Id,
          "guardian.full_name": "Parent",
          "guardian.email": "parent@example.com",
          "enquiry.notes": "Hello",
        },
      }),
    });
    expect(xss.status).toBe(201);
    const listed = (await (await app.request("/api/v1/admissions/enquiries", { headers: hdrsA })).json()) as {
      enquiries: Array<{ pupilLegalName: string }>;
    };
    expect(listed.enquiries[0]?.pupilLegalName).not.toContain("<script>");

    const oversized = await app.request("/api/v1/public/admissions/forms/enquiry/live/submissions", {
      method: "POST",
      headers: { ...schoolHeaders(schoolA.slug), "Content-Length": "999999" },
      body: JSON.stringify({ answers: {} }),
    });
    expect(oversized.status).toBe(413);

    const missing = await app.request("/api/v1/public/admissions/forms/enquiry/live/submissions", {
      method: "POST",
      headers: schoolHeaders(schoolA.slug),
      body: JSON.stringify({ answers: { "child.legal_name": "Only name" } }),
    });
    expect(missing.status).toBe(400);

    const bForm = (await (
      await app.request("/api/v1/admissions/forms", {
        method: "POST",
        headers: hdrsB,
        body: JSON.stringify({ formType: "enquiry", name: "Oak", slug: "live" }),
      })
    ).json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${bForm.form.id}/publish`, { method: "POST", headers: hdrsB });

    const cross = await app.request("/api/v1/public/admissions/forms/enquiry/live/submissions", {
      method: "POST",
      headers: schoolHeaders(schoolA.slug),
      body: JSON.stringify({
        answers: {
          "child.legal_name": "Cross Tenant",
          "child.date_of_birth": "2018-01-01",
          "child.intended_academic_year_id": yearA.yearId,
          "child.intended_year_group_id": yearA.year3Id,
          "guardian.full_name": "Parent",
          "guardian.email": "cross@example.com",
          "enquiry.notes": "Should stay in A",
        },
      }),
    });
    expect(cross.status).toBe(201);
    const bList = (await (await app.request("/api/v1/admissions/enquiries", { headers: hdrsB })).json()) as {
      enquiries: Array<{ pupilLegalName: string }>;
    };
    expect(bList.enquiries.some((row) => row.pupilLegalName === "Cross Tenant")).toBe(false);

    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, schoolA.orgId, teacherId, "school.teacher");
    const teacherToken = await login(app, `teacher-${id}@example.com`, "password-12x");
    const teacherDenied = await app.request("/api/v1/admissions/forms", {
      headers: headers(teacherToken, schoolA.orgId),
    });
    expect(teacherDenied.status).toBe(403);
  });
});
