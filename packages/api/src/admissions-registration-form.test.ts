import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withTenantContext } from "@schoolapp/db";
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
    [`reg-${id}`, `Registration ${id}`],
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
  return { Host: `${slug}.localhost`, "Content-Type": "application/json" };
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
  const year3 = groups.yearGroups.find((group) => group.code === "3")!;
  const termRes = await app.request(`/api/v1/academic-years/${year.academicYear.id}/terms`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({ name: "Autumn", startsOn: "2026-09-01", endsOn: "2026-12-18" }),
  });
  expect(termRes.status).toBe(201);
  const term = (await termRes.json()) as { term: { id: string; name: string } };
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
  return { yearId: year.academicYear.id, year3Id: year3.id, termId: term.term.id, classId: classBody.class.id };
}

type Section = {
  sectionKey: string;
  title: string;
  helperText: string | null;
  enabled: boolean;
  fields: Array<{
    fieldKey: string;
    fieldKind: "canonical" | "custom";
    canonicalKey: string | null;
    questionType: string;
    label: string;
    helperText: string | null;
    required: boolean;
    enabled: boolean;
    options: Array<{ value: string; label: string }>;
    documentPurpose: string | null;
  }>;
};

describe("admissions registration form", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("persists separate legal names, extended guardians, and custom answers without touching users", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const other = await createSchool(pools.owner, `${id}b`);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const otherStructure = await seedStructure(app, headers(otherToken, other.orgId));

    const existingEmail = `kept-${id}@example.com`;
    const existingUserId = await insertUser(pools.owner, {
      email: existingEmail,
      password: "password-12x",
      fullName: "Existing Parent",
      kind: "parent",
    });
    await pools.owner.query(
      `update users
       set title = 'Mr', phone = '01000000001', address_line1 = 'Keep me', alternative_phone = null
       where id = $1`,
      [existingUserId],
    );

    const created = await app.request("/api/v1/admissions/forms", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        formType: "application",
        template: "registration",
        name: "Registration",
        slug: "registration",
      }),
    });
    expect(created.status).toBe(201);
    const formBody = (await created.json()) as { form: { id: string; privacyNoticeText: string | null }; sections: Section[] };
    expect(formBody.form.privacyNoticeText).toMatch(/registration/i);
    expect(formBody.sections.some((section) => section.fields.some((field) => field.fieldKey.startsWith("medical.")))).toBe(
      false,
    );
    expect(formBody.sections.some((section) => section.fields.some((field) => field.fieldKey === "child.legal_forename"))).toBe(
      true,
    );
    await app.request(`/api/v1/admissions/forms/${formBody.form.id}/publish`, { method: "POST", headers: hdrs });

    const published = await app.request("/api/v1/public/admissions/forms/application/registration", {
      headers: schoolHeaders(school.slug),
    });
    expect(published.status).toBe(200);
    const payload = (await published.json()) as {
      terms: Array<{ id: string; name: string; academicYearName: string }>;
      sections: Section[];
    };
    expect(payload.terms.some((term) => term.id === structure.termId && term.name === "Autumn")).toBe(true);
    expect(payload.sections.some((section) => section.fields.some((field) => field.fieldKey === "faith_or_religion"))).toBe(
      true,
    );

    const rejected = await app.request("/api/v1/public/admissions/forms/application/registration/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({
        answers: registrationAnswers(structure, existingEmail, { "child.intended_term_id": otherStructure.termId }),
      }),
    });
    expect(rejected.status).toBe(400);

    const submitted = await app.request("/api/v1/public/admissions/forms/application/registration/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({ answers: registrationAnswers(structure, existingEmail) }),
    });
    expect(submitted.status).toBe(201);
    const submission = (await submitted.json()) as { submission: { applicationReference: string } };
    const applicationId = await applicationIdForReference(
      pools.owner,
      school.orgId,
      submission.submission.applicationReference,
    );
    const detailRes = await app.request(`/api/v1/admissions/applications/${applicationId}`, {
      headers: hdrs,
    });
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      application: {
        pupilLegalName: string;
        pupilLegalForename: string | null;
        pupilLegalSurname: string | null;
        nationality: string | null;
        intendedTermId: string | null;
        intendedTermName: string | null;
      };
      contacts: Array<{
        fullName: string;
        title: string | null;
        occupation: string | null;
        alternativeTelephone: string | null;
        addressLine1: string | null;
        email: string | null;
      }>;
      formSubmission: { answers: Record<string, unknown> };
    };
    expect(detail.application.pupilLegalForename).toBe("Amelia");
    expect(detail.application.pupilLegalSurname).toBe("Cole");
    expect(detail.application.pupilLegalName).toBe("Amelia Cole");
    expect(detail.application.nationality).toBe("British");
    expect(detail.application.intendedTermId).toBe(structure.termId);
    expect(detail.application.intendedTermName).toBe("Autumn");
    const parent = detail.contacts.find((contact) => contact.email === existingEmail);
    expect(parent).toMatchObject({
      title: "Ms",
      occupation: "Teacher",
      alternativeTelephone: "07700000001",
      addressLine1: "1 School Lane",
    });
    expect(detail.formSubmission.answers.how_heard).toBe("recommendation");
    expect(detail.formSubmission.answers.skills_and_talents).toBe("Piano");

    const unchanged = await pools.owner.query<{ title: string; phone: string; address_line1: string; full_name: string }>(
      "select title, phone, address_line1, full_name from users where id = $1",
      [existingUserId],
    );
    expect(unchanged.rows[0]).toMatchObject({
      title: "Mr",
      phone: "01000000001",
      address_line1: "Keep me",
      full_name: "Existing Parent",
    });

    const hidden = await withTenantContext(pools.app, other.adminId, other.orgId, async (client) => {
      const rows = await client.query("select id from admissions_applications where id = $1", [applicationId]);
      return rows.rowCount;
    });
    expect(hidden).toBe(0);
    const visible = await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const rows = await client.query("select pupil_legal_forename from admissions_applications where id = $1", [
        applicationId,
      ]);
      return rows.rows[0]?.pupil_legal_forename;
    });
    expect(visible).toBe("Amelia");
  });

  it("lets a school change required choices and disable fields through the form definition", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const created = (await (
      await app.request("/api/v1/admissions/forms", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ formType: "application", template: "registration", name: "Editable", slug: "editable" }),
      })
    ).json()) as { form: { id: string }; sections: Section[] };

    const unsafe = structuredClone(created.sections);
    unsafe[0]!.fields.push({
      fieldKey: "child.secret_key",
      fieldKind: "canonical",
      canonicalKey: "child.secret_key",
      questionType: "short_text",
      label: "Secret",
      helperText: null,
      required: false,
      enabled: true,
      options: [],
      documentPurpose: null,
    });
    const rejectedDefinition = await app.request(`/api/v1/admissions/forms/${created.form.id}/definition`, {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({ sections: unsafe }),
    });
    expect(rejectedDefinition.status).toBe(400);

    const sections = created.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (field.fieldKey === "child.nationality") return { ...field, enabled: false, required: true };
        if (field.fieldKey === "how_heard") {
          return {
            ...field,
            required: true,
            options: [{ value: "open_morning", label: "Open morning" }],
          };
        }
        return field;
      }),
    }));
    const saved = await app.request(`/api/v1/admissions/forms/${created.form.id}/definition`, {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({ sections }),
    });
    expect(saved.status).toBe(200);
    await app.request(`/api/v1/admissions/forms/${created.form.id}/publish`, { method: "POST", headers: hdrs });

    const missing = await app.request("/api/v1/public/admissions/forms/application/editable/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({
        answers: registrationAnswers(structure, `parent-${id}@example.com`, { how_heard: undefined }),
      }),
    });
    expect(missing.status).toBe(400);

    const ok = await app.request("/api/v1/public/admissions/forms/application/editable/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({
        answers: registrationAnswers(structure, `parent-${id}@example.com`, {
          "child.nationality": undefined,
          how_heard: "open_morning",
        }),
      }),
    });
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as { submission: { applicationReference: string } };
    const stored = await pools.owner.query<{ nationality: string | null }>(
      "select nationality from admissions_applications where organisation_id = $1 and reference = $2",
      [school.orgId, body.submission.applicationReference],
    );
    expect(stored.rows[0]?.nationality).toBeNull();
  });

  it("maps name parts and nationality at enrolment and only fills empty guardian profile fields", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const existingEmail = `profile-${id}@example.com`;
    const newEmail = `new-parent-${id}@example.com`;
    const existingUserId = await insertUser(pools.owner, {
      email: existingEmail,
      password: "password-12x",
      fullName: "Existing Parent",
      kind: "parent",
    });
    await pools.owner.query(
      `update users
       set title = 'Mr', phone = '01000000001', address_line1 = 'Keep me', alternative_phone = null
       where id = $1`,
      [existingUserId],
    );

    const created = (await (
      await app.request("/api/v1/admissions/forms", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ formType: "application", template: "registration", name: "Enrol", slug: "enrol-reg" }),
      })
    ).json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${created.form.id}/publish`, { method: "POST", headers: hdrs });
    const answers = registrationAnswers(structure, existingEmail);
    (answers.guardians as Array<Record<string, unknown>>).push({
      fullName: "Jordan Cole",
      title: "Dr",
      email: newEmail,
      phone: "01234000002",
      phoneAlternative: "07700000002",
      relationship: "father",
      occupation: "Surgeon",
      parentalResponsibility: true,
      primaryContact: false,
      address: { line1: "2 School Lane", line2: "", town: "Bath", postcode: "BA1 1AB" },
    });
    const submitted = await app.request("/api/v1/public/admissions/forms/application/enrol-reg/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({ answers }),
    });
    expect(submitted.status).toBe(201);
    const submission = (await submitted.json()) as { submission: { applicationReference: string } };
    const applicationId = await applicationIdForReference(
      pools.owner,
      school.orgId,
      submission.submission.applicationReference,
    );

    await app.request(`/api/v1/admissions/applications/${applicationId}/status`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ status: "under_review" }),
    });
    const offer = await app.request(`/api/v1/admissions/applications/${applicationId}/offers`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ offeredAcademicYearId: structure.yearId, offeredYearGroupId: structure.year3Id }),
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
        classId: structure.classId,
      }),
    });
    expect(enrolled.status).toBe(200);
    const enrolBody = (await enrolled.json()) as { studentProfileId: string };

    const statutory = await pools.owner.query<{ legal_forename: string | null; legal_surname: string | null }>(
      "select legal_forename, legal_surname from student_statutory_profiles where student_profile_id = $1",
      [enrolBody.studentProfileId],
    );
    expect(statutory.rows[0]).toMatchObject({ legal_forename: "Amelia", legal_surname: "Cole" });
    const profile = await pools.owner.query<{ nationality: string | null; legal_name: string }>(
      "select nationality, legal_name from student_profiles where id = $1",
      [enrolBody.studentProfileId],
    );
    expect(profile.rows[0]).toMatchObject({ nationality: "British", legal_name: "Amelia Cole" });

    const kept = await pools.owner.query<{
      title: string;
      phone: string;
      alternative_phone: string | null;
      address_line1: string;
      full_name: string;
    }>(
      "select title, phone, alternative_phone, address_line1, full_name from users where id = $1",
      [existingUserId],
    );
    expect(kept.rows[0]).toMatchObject({
      title: "Mr",
      phone: "01000000001",
      alternative_phone: "07700000001",
      address_line1: "Keep me",
      full_name: "Existing Parent",
    });
    const createdParent = await pools.owner.query<{
      title: string | null;
      phone: string | null;
      alternative_phone: string | null;
      address_line1: string | null;
      full_name: string;
    }>(
      "select title, phone, alternative_phone, address_line1, full_name from users where email = $1",
      [newEmail],
    );
    expect(createdParent.rows[0]).toMatchObject({
      title: "Dr",
      phone: "01234000002",
      alternative_phone: "07700000002",
      address_line1: "2 School Lane",
      full_name: "Jordan Cole",
    });
    const occupation = await pools.owner.query<{ occupation: string }>(
      "select occupation from admissions_application_contacts where application_id = $1 and email = $2",
      [applicationId, newEmail],
    );
    expect(occupation.rows[0]?.occupation).toBe("Surgeon");

    const mapped = await pools.owner.query<{ after_data: { mapped: string[]; guardianLinkFailures: number } }>(
      `select after_data from audit_events
       where organisation_id = $1 and action = 'admissions.form.submission_mapped'
       order by occurred_at desc limit 1`,
      [school.orgId],
    );
    expect(mapped.rows[0]?.after_data.guardianLinkFailures).toBe(0);
    expect(mapped.rows[0]?.after_data.mapped).toEqual(
      expect.arrayContaining(["guardians", "legal_name_parts", "nationality"]),
    );

    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    const lateEmail = `late-${id}@example.com`;
    await pools.owner.query(
      `insert into admissions_application_contacts (
         organisation_id, application_id, full_name, email, relationship, is_primary, has_parental_responsibility
       ) values ($1, $2, 'Late Guardian', $3, 'other', false, false)`,
      [school.orgId, applicationId, lateEmail],
    );
    await pools.owner.query("update admissions_applications set converted_by = $2 where id = $1", [
      applicationId,
      teacherId,
    ]);
    await pools.owner.query("select apply_admissions_canonical_conversion($1, $2, $3)", [
      school.orgId,
      applicationId,
      enrolBody.studentProfileId,
    ]);
    const failed = await pools.owner.query<{ after_data: { mapped: string[]; guardianLinkFailures: number } }>(
      `select after_data from audit_events
       where organisation_id = $1 and action = 'admissions.form.submission_mapped'
       order by occurred_at desc limit 1`,
      [school.orgId],
    );
    expect(failed.rows[0]?.after_data.guardianLinkFailures).toBeGreaterThan(0);
    expect(failed.rows[0]?.after_data.mapped).not.toContain("guardians");
    const lateUser = await pools.owner.query("select id from users where email = $1", [lateEmail]);
    expect(lateUser.rowCount).toBe(0);
  });

  it("does not split a legacy legal name into forename and surname", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const created = (await (
      await app.request("/api/v1/admissions/forms", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ formType: "application", name: "Standard", slug: "standard-app" }),
      })
    ).json()) as { form: { id: string }; sections: Section[] };
    expect(created.sections.some((section) => section.fields.some((field) => field.fieldKey === "child.legal_name"))).toBe(
      true,
    );
    expect(created.sections.some((section) => section.fields.some((field) => field.fieldKey === "medical.allergies"))).toBe(
      true,
    );
    await app.request(`/api/v1/admissions/forms/${created.form.id}/publish`, { method: "POST", headers: hdrs });
    const submitted = await app.request("/api/v1/public/admissions/forms/application/standard-app/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({
        answers: {
          "child.legal_name": "Ibrahim Khan",
          "child.date_of_birth": "2017-05-05",
          "child.intended_academic_year_id": structure.yearId,
          "child.intended_year_group_id": structure.year3Id,
          "child.previous_school": "Park Primary",
          guardians: [
            {
              fullName: "Anita Khan",
              email: `anita-${id}@example.com`,
              relationship: "mother",
              parentalResponsibility: true,
              primaryContact: true,
            },
          ],
          declaration_privacy: true,
        },
      }),
    });
    expect(submitted.status).toBe(201);
    const submission = (await submitted.json()) as { submission: { applicationReference: string } };
    const applicationId = await applicationIdForReference(
      pools.owner,
      school.orgId,
      submission.submission.applicationReference,
    );
    const stored = await pools.owner.query<{
      pupil_legal_name: string;
      pupil_legal_forename: string | null;
      pupil_legal_surname: string | null;
    }>("select pupil_legal_name, pupil_legal_forename, pupil_legal_surname from admissions_applications where id = $1", [
      applicationId,
    ]);
    expect(stored.rows[0]).toMatchObject({
      pupil_legal_name: "Ibrahim Khan",
      pupil_legal_forename: null,
      pupil_legal_surname: null,
    });

    await app.request(`/api/v1/admissions/applications/${applicationId}/status`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ status: "under_review" }),
    });
    const offer = await app.request(`/api/v1/admissions/applications/${applicationId}/offers`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ offeredAcademicYearId: structure.yearId, offeredYearGroupId: structure.year3Id }),
    });
    const offerBody = (await offer.json()) as { offer: { id: string } };
    await app.request(`/api/v1/admissions/offers/${offerBody.offer.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ status: "accepted" }),
    });
    const enrolled = await app.request(`/api/v1/admissions/applications/${applicationId}/enrol`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: structure.yearId,
        yearGroupId: structure.year3Id,
        classId: structure.classId,
      }),
    });
    expect(enrolled.status).toBe(200);
    const enrolBody = (await enrolled.json()) as { studentProfileId: string };
    const statutory = await pools.owner.query<{ legal_forename: string | null; legal_surname: string | null }>(
      "select legal_forename, legal_surname from student_statutory_profiles where student_profile_id = $1",
      [enrolBody.studentProfileId],
    );
    expect(statutory.rows[0]?.legal_forename ?? null).toBeNull();
    expect(statutory.rows[0]?.legal_surname ?? null).toBeNull();
  });
});

async function applicationIdForReference(
  owner: ReturnType<typeof testPools>["owner"],
  orgId: string,
  reference: string,
) {
  const rows = await owner.query<{ id: string }>(
    "select id from admissions_applications where organisation_id = $1 and reference = $2",
    [orgId, reference],
  );
  if (!rows.rows[0]) throw new Error(`No application for ${reference}`);
  return rows.rows[0].id;
}

function registrationAnswers(
  structure: { yearId: string; year3Id: string; termId: string },
  email: string,
  overrides: Record<string, unknown> = {},
) {
  const answers: Record<string, unknown> = {
    "child.legal_forename": "Amelia",
    "child.legal_surname": "Cole",
    "child.preferred_name": "Amy",
    "child.date_of_birth": "2016-03-03",
    "child.nationality": "British",
    "child.address": { line1: "1 School Lane", line2: "", town: "Bath", postcode: "BA1 1AA" },
    "child.intended_academic_year_id": structure.yearId,
    "child.intended_year_group_id": structure.year3Id,
    "child.intended_term_id": structure.termId,
    "child.proposed_start_date": "2026-09-07",
    "child.current_school": "Park Primary",
    guardians: [
      {
        fullName: "Priya Cole",
        title: "Ms",
        email,
        phone: "01234000099",
        phoneAlternative: "07700000001",
        relationship: "mother",
        occupation: "Teacher",
        parentalResponsibility: true,
        primaryContact: true,
        address: { line1: "1 School Lane", line2: "", town: "Bath", postcode: "BA1 1AA" },
      },
    ],
    skills_and_talents: "Piano",
    hobbies_and_interests: "Chess",
    "application.notes": "Sibling at the school",
    how_heard: "recommendation",
    faith_or_religion: "None",
    declaration_privacy: true,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete answers[key];
    else answers[key] = value;
  }
  return answers;
}
