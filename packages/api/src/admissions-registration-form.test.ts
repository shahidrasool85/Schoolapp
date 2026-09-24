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
    expect(payload.sections.some((section) => section.fields.some((field) => field.fieldKey.startsWith("medical.")))).toBe(
      false,
    );

    const rejected = await app.request("/api/v1/public/admissions/forms/application/registration/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({
        answers: registrationAnswers(structure, existingEmail, { "child.intended_term_id": otherStructure.termId }),
      }),
    });
    expect(rejected.status).toBe(400);

    const secondEmail = `second-${id}@example.com`;
    const submitted = await app.request("/api/v1/public/admissions/forms/application/registration/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({
        answers: registrationAnswers(structure, existingEmail, {
          "child.previous_school": "Riverside Infants",
          guardians: [
            {
              fullName: "Priya Cole",
              title: "Ms",
              email: existingEmail,
              phone: "01234000099",
              phoneAlternative: "07700000001",
              relationship: "mother",
              occupation: "Teacher",
              parentalResponsibility: true,
              primaryContact: true,
              address: { line1: "1 School Lane", line2: "Flat 2", town: "Bath", postcode: "BA1 1AA" },
            },
            {
              fullName: "Owen Cole",
              title: "Mr",
              email: secondEmail,
              phone: "01234999999",
              phoneAlternative: "07700999999",
              relationship: "father",
              occupation: "Architect",
              parentalResponsibility: true,
              primaryContact: false,
              address: { line1: "9 Other Road", line2: "Annexe", town: "Bristol", postcode: "BS1 4ST" },
            },
          ],
        }),
      }),
    });
    expect(submitted.status).toBe(201);
    const submission = (await submitted.json()) as {
      submission: { applicationReference: string; completeness: string; formType: string; confirmation?: { title?: string } };
    };
    expect(submission.submission.applicationReference).toMatch(/^APP-/);
    expect(submission.submission.completeness).toBe("complete");
    expect(submission.submission.formType).toBe("application");
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
        pupilPreferredName: string | null;
        dateOfBirth: string | null;
        nationality: string | null;
        addressLine1: string | null;
        intendedAcademicYearId: string | null;
        intendedYearGroupId: string | null;
        intendedTermId: string | null;
        intendedTermName: string | null;
        intendedEntryDate: string | null;
        currentSchool: string | null;
        previousSchool: string | null;
      };
      contacts: Array<{
        fullName: string;
        title: string | null;
        relationship: string;
        occupation: string | null;
        telephone: string | null;
        alternativeTelephone: string | null;
        addressLine1: string | null;
        addressTown: string | null;
        addressPostcode: string | null;
        email: string | null;
        isPrimary: boolean;
        hasParentalResponsibility: boolean;
        userId: string | null;
      }>;
      formSubmission: {
        answers: Record<string, unknown>;
        declarationSnapshot?: {
          privacyNoticeText?: string | null;
          capturedAt?: string;
          declarations?: Array<{ fieldKey: string; label: string; accepted: boolean }>;
        } | null;
      };
    };
    expect(detail.application).toMatchObject({
      pupilLegalForename: "Amelia",
      pupilLegalSurname: "Cole",
      pupilLegalName: "Amelia Cole",
      pupilPreferredName: "Amy",
      nationality: "British",
      addressLine1: "1 School Lane",
      intendedAcademicYearId: structure.yearId,
      intendedYearGroupId: structure.year3Id,
      intendedTermId: structure.termId,
      intendedTermName: "Autumn",
      currentSchool: "Park Primary",
      previousSchool: "Riverside Infants",
    });
    expect(String(detail.application.dateOfBirth)).toContain("2016-03-03");
    expect(String(detail.application.intendedEntryDate)).toContain("2026-09-07");
    const parent = detail.contacts.find((contact) => contact.email === existingEmail);
    const second = detail.contacts.find((contact) => contact.email === secondEmail);
    expect(parent).toMatchObject({
      title: "Ms",
      fullName: "Priya Cole",
      relationship: "mother",
      occupation: "Teacher",
      telephone: "01234000099",
      alternativeTelephone: "07700000001",
      addressLine1: "1 School Lane",
      addressTown: "Bath",
      addressPostcode: "BA1 1AA",
      isPrimary: true,
      hasParentalResponsibility: true,
      userId: null,
    });
    expect(second).toMatchObject({
      title: "Mr",
      fullName: "Owen Cole",
      relationship: "father",
      occupation: "Architect",
      telephone: "01234999999",
      alternativeTelephone: "07700999999",
      addressLine1: "9 Other Road",
      addressTown: "Bristol",
      addressPostcode: "BS1 4ST",
      isPrimary: false,
      hasParentalResponsibility: true,
      userId: null,
    });
    expect(parent?.addressLine1).not.toBe(second?.addressLine1);
    expect(detail.formSubmission.answers.how_heard).toBe("recommendation");
    expect(detail.formSubmission.answers.skills_and_talents).toBe("Piano");
    expect(detail.formSubmission.answers.hobbies_and_interests).toBe("Chess");
    expect(detail.formSubmission.answers.faith_or_religion).toBe("None");
    expect(detail.formSubmission.answers["medical.allergies"]).toBeUndefined();
    expect(detail.formSubmission.declarationSnapshot?.privacyNoticeText).toMatch(/registration/i);
    expect(detail.formSubmission.declarationSnapshot?.capturedAt).toBeTruthy();
    expect(detail.formSubmission.declarationSnapshot?.declarations).toEqual([
      expect.objectContaining({ fieldKey: "declaration_privacy", accepted: true }),
    ]);

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
    const secondUser = await pools.owner.query("select id from users where email = $1", [secondEmail]);
    expect(secondUser.rowCount).toBe(0);

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

    const duplicate = structuredClone(created.sections);
    const forename = duplicate[0]!.fields.find((field) => field.fieldKey === "child.legal_forename")!;
    duplicate[0]!.fields.push({ ...forename });
    const duplicateSave = await app.request(`/api/v1/admissions/forms/${created.form.id}/definition`, {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({ sections: duplicate }),
    });
    expect(duplicateSave.status).toBe(400);

    const emptied = created.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) =>
        field.fieldKey === "how_heard" ? { ...field, required: true, options: [] } : field,
      ),
    }));
    const emptyOptions = await app.request(`/api/v1/admissions/forms/${created.form.id}/definition`, {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({ sections: emptied }),
    });
    expect(emptyOptions.status).toBe(400);
    const stillPublished = (await (
      await app.request("/api/v1/public/admissions/forms/application/editable", { headers: schoolHeaders(school.slug) })
    ).json()) as { sections: Section[] };
    const heard = stillPublished.sections.flatMap((section) => section.fields).find((field) => field.fieldKey === "how_heard");
    expect(heard?.options.map((option) => option.value)).toEqual(["open_morning"]);

    const other = await createSchool(pools.owner, `${id}z`);
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const otherHeaders = headers(otherToken, other.orgId);
    const foreignGet = await app.request(`/api/v1/admissions/forms/${created.form.id}`, { headers: otherHeaders });
    expect(foreignGet.status).toBe(404);
    const foreignPut = await app.request(`/api/v1/admissions/forms/${created.form.id}/definition`, {
      method: "PUT",
      headers: otherHeaders,
      body: JSON.stringify({ sections }),
    });
    expect(foreignPut.status).toBe(404);

    const historicalId = await applicationIdForReference(pools.owner, school.orgId, body.submission.applicationReference);
    const before = (await (
      await app.request(`/api/v1/admissions/applications/${historicalId}`, { headers: hdrs })
    ).json()) as {
      formSubmission: {
        answers: Record<string, unknown>;
        declarationSnapshot: { privacyNoticeText: string; declarations: Array<{ label: string }> };
      };
    };
    const relabelled = sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (field.fieldKey === "how_heard") {
          return { ...field, label: "Changed question", options: [{ value: "open_morning", label: "Changed option" }] };
        }
        if (field.fieldKey === "declaration_privacy") return { ...field, label: "Changed declaration" };
        if (field.fieldKey === "skills_and_talents") return { ...field, label: "Changed skills label" };
        return field;
      }),
    }));
    const relabel = await app.request(`/api/v1/admissions/forms/${created.form.id}/definition`, {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({ sections: relabelled }),
    });
    expect(relabel.status).toBe(200);
    const relabelBody = (await relabel.json()) as { sections: Section[] };
    expect(relabelBody.sections.flatMap((section) => section.fields).some((field) => field.fieldKey === "how_heard")).toBe(
      true,
    );
    expect(
      relabelBody.sections.flatMap((section) => section.fields).some((field) => field.fieldKey === "skills_and_talents"),
    ).toBe(true);
    await app.request(`/api/v1/admissions/forms/${created.form.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ privacyNoticeText: "Replacement privacy wording" }),
    });
    const after = (await (
      await app.request(`/api/v1/admissions/applications/${historicalId}`, { headers: hdrs })
    ).json()) as {
      formSubmission: {
        answers: Record<string, unknown>;
        declarationSnapshot: { privacyNoticeText: string; declarations: Array<{ label: string; fieldKey: string }> };
      };
    };
    expect(after.formSubmission.answers).toEqual(before.formSubmission.answers);
    expect(after.formSubmission.declarationSnapshot).toEqual(before.formSubmission.declarationSnapshot);
    expect(after.formSubmission.answers.how_heard).toBe("open_morning");
    expect(after.formSubmission.declarationSnapshot.privacyNoticeText).not.toBe("Replacement privacy wording");

    const disabledRequired = sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) =>
        field.fieldKey === "declaration_privacy" ? { ...field, enabled: false, required: true } : field,
      ),
    }));
    expect(
      (
        await app.request(`/api/v1/admissions/forms/${created.form.id}/definition`, {
          method: "PUT",
          headers: hdrs,
          body: JSON.stringify({ sections: disabledRequired }),
        })
      ).status,
    ).toBe(200);
    const withoutDeclaration = await app.request("/api/v1/public/admissions/forms/application/editable/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({
        answers: registrationAnswers(structure, `later-${id}@example.com`, {
          "child.nationality": undefined,
          how_heard: "open_morning",
          declaration_privacy: undefined,
        }),
      }),
    });
    expect(withoutDeclaration.status).toBe(201);
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
    const enrolBody = (await enrolled.json()) as {
      studentProfileId: string;
      guardianMapping: { status: string; unlinkedCount: number; message: string | null };
    };
    expect(enrolBody.guardianMapping).toEqual({ status: "complete", unlinkedCount: 0, message: null });

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
    const attention = (await (
      await app.request(`/api/v1/admissions/applications/${applicationId}`, { headers: hdrs })
    ).json()) as {
      application: { convertedStudentProfileId: string };
      guardianMapping: { status: string; unlinkedCount: number; message: string | null };
    };
    expect(attention.application.convertedStudentProfileId).toBe(enrolBody.studentProfileId);
    expect(attention.guardianMapping.status).toBe("attention_required");
    expect(attention.guardianMapping.unlinkedCount).toBeGreaterThan(0);
    expect(attention.guardianMapping.message).toMatch(/parent or guardian links need attention/);
    expect(JSON.stringify(attention.guardianMapping)).not.toMatch(/forbidden|SQL|index row|42501|late-/i);
  });

  it("reports incomplete guardian mapping when the pupil is enrolled and one guardian link fails", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const goodEmail = `linked-${id}@example.com`;
    const badEmail = `fail-link-${id}@example.com`;
    const created = (await (
      await app.request("/api/v1/admissions/forms", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ formType: "application", template: "registration", name: "Partial", slug: "partial" }),
      })
    ).json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${created.form.id}/publish`, { method: "POST", headers: hdrs });
    const submitted = await app.request("/api/v1/public/admissions/forms/application/partial/submissions", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: JSON.stringify({
        answers: registrationAnswers(structure, goodEmail, {
          guardians: [
            {
              fullName: "Linked Parent",
              title: "Ms",
              email: goodEmail,
              phone: "01234000001",
              relationship: "mother",
              occupation: "Teacher",
              parentalResponsibility: true,
              primaryContact: true,
              address: { line1: "1 School Lane", town: "Bath", postcode: "BA1 1AA" },
            },
            {
              fullName: "Unlinked Parent",
              title: "Dr",
              email: badEmail,
              phone: "01234000002",
              relationship: "father",
              occupation: "Doctor",
              parentalResponsibility: false,
              primaryContact: false,
              address: { line1: "9 Other Road", town: "Bristol", postcode: "BS1 4ST" },
            },
          ],
        }),
      }),
    });
    expect(submitted.status).toBe(201);
    const submission = (await submitted.json()) as { submission: { applicationReference: string } };
    const applicationId = await applicationIdForReference(
      pools.owner,
      school.orgId,
      submission.submission.applicationReference,
    );
    await pools.owner.query(`
      create or replace function public.test_block_admissions_guardian_link()
      returns trigger
      language plpgsql
      as $fn$
      begin
        if exists (
          select 1 from users u
          where u.id = new.guardian_user_id
            and u.email::text like 'fail-link-%@example.com'
        ) then
          raise exception 'guardian_link_blocked' using errcode = '23514';
        end if;
        return new;
      end;
      $fn$
    `);
    await pools.owner.query(`
      drop trigger if exists test_block_admissions_guardian_link on guardianships;
      create trigger test_block_admissions_guardian_link
      before insert on guardianships
      for each row execute function public.test_block_admissions_guardian_link()
    `);
    try {
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
    expect(
      (
        await app.request(`/api/v1/admissions/offers/${offerBody.offer.id}`, {
          method: "PATCH",
          headers: hdrs,
          body: JSON.stringify({ status: "accepted" }),
        })
      ).status,
    ).toBe(200);
    const enrolled = await app.request(`/api/v1/admissions/applications/${applicationId}/enrol`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ academicYearId: structure.yearId, yearGroupId: structure.year3Id, classId: structure.classId }),
    });
    expect(enrolled.status).toBe(200);
    const enrolBody = (await enrolled.json()) as {
      studentProfileId: string;
      guardianMapping: { status: string; unlinkedCount: number; message: string | null };
    };
    expect(enrolBody.studentProfileId).toBeTruthy();
    expect(enrolBody.guardianMapping.status).toBe("attention_required");
    expect(enrolBody.guardianMapping.unlinkedCount).toBe(1);
    expect(enrolBody.guardianMapping.message).toMatch(/parent or guardian links need attention/);
    expect(JSON.stringify(enrolBody.guardianMapping)).not.toMatch(/index row|SQL|forbidden|guardian_link_blocked|23514/i);
    const links = await pools.owner.query(
      `select u.email::text as email
       from guardianships g
       join users u on u.id = g.guardian_user_id
       where g.student_profile_id = $1 and g.ended_on is null`,
      [enrolBody.studentProfileId],
    );
    expect(links.rows.map((row) => row.email)).toEqual([goodEmail]);
    const opened = (await (
      await app.request(`/api/v1/admissions/applications/${applicationId}`, { headers: hdrs })
    ).json()) as { guardianMapping: { status: string; message: string | null } };
    expect(opened.guardianMapping.status).toBe("attention_required");
    expect(opened.guardianMapping.message).toBe(enrolBody.guardianMapping.message);
    } finally {
      await pools.owner.query("drop trigger if exists test_block_admissions_guardian_link on guardianships");
      await pools.owner.query("drop function if exists public.test_block_admissions_guardian_link()");
    }
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

  it("keeps builder edits for labels, help, required, enabled, choices, additions, and order", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const created = (await (
      await app.request("/api/v1/admissions/forms", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          formType: "application",
          template: "registration",
          name: "Builder",
          slug: `builder-${id}`,
        }),
      })
    ).json()) as { form: { id: string }; sections: Section[] };

    const sections = created.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (field.fieldKey === "child.legal_forename") {
          return {
            ...field,
            label: "Child's legal name",
            helperText: "Birth certificate name",
            required: true,
            enabled: true,
            options: field.options ?? [],
          };
        }
        if (field.fieldKey === "child.preferred_name") {
          return { ...field, enabled: false, required: true, options: field.options ?? [] };
        }
        if (field.fieldKey === "how_heard") {
          return { ...field, options: [{ value: "open_morning", label: "Open morning" }] };
        }
        return { ...field, options: field.options ?? [] };
      }),
    }));
    sections
      .find((section) => section.sectionKey === "additional")
      ?.fields.push({
        fieldKey: "school_bus",
        fieldKind: "custom",
        canonicalKey: null,
        questionType: "short_text",
        label: "School bus",
        helperText: "Optional",
        required: false,
        enabled: true,
        options: [],
        documentPurpose: null,
      });
    sections
      .find((section) => section.sectionKey === "child")
      ?.fields.push({
        fieldKey: "medical.allergies",
        fieldKind: "canonical",
        canonicalKey: "medical.allergies",
        questionType: "long_text",
        label: "Allergies",
        helperText: null,
        required: false,
        enabled: true,
        options: [],
        documentPurpose: null,
      });
    const ordered = [...sections].reverse().map((section, sectionIndex) => ({
      ...section,
      sortOrder: sectionIndex,
      fields: [...section.fields].reverse().map((field, fieldIndex) => ({ ...field, sortOrder: fieldIndex })),
    }));

    const saved = await app.request(`/api/v1/admissions/forms/${created.form.id}/definition`, {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({ sections: ordered }),
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as { sections: Section[] };
    expect(body.sections.map((section) => section.sectionKey)).toEqual(ordered.map((section) => section.sectionKey));
    const savedChild = body.sections.find((section) => section.sectionKey === "child");
    const orderedChild = ordered.find((section) => section.sectionKey === "child");
    expect(savedChild?.fields.map((field) => field.fieldKey)).toEqual(orderedChild?.fields.map((field) => field.fieldKey));
    expect(savedChild?.fields.find((field) => field.fieldKey === "child.legal_forename")).toMatchObject({
      label: "Child's legal name",
      helperText: "Birth certificate name",
      required: true,
      enabled: true,
      canonicalKey: "child.legal_forename",
    });
    expect(savedChild?.fields.find((field) => field.fieldKey === "child.preferred_name")).toMatchObject({
      enabled: false,
      required: true,
    });
    expect(body.sections.flatMap((section) => section.fields).find((field) => field.fieldKey === "how_heard")?.options).toEqual([
      { value: "open_morning", label: "Open morning" },
    ]);
    expect(body.sections.flatMap((section) => section.fields).some((field) => field.fieldKey === "school_bus")).toBe(true);
    expect(savedChild?.fields.some((field) => field.canonicalKey === "medical.allergies" && field.questionType === "long_text")).toBe(
      true,
    );

    expect((await app.request(`/api/v1/admissions/forms/${created.form.id}/publish`, { method: "POST", headers: hdrs })).status).toBe(
      200,
    );
    const published = (await (
      await app.request(`/api/v1/public/admissions/forms/application/builder-${id}`, { headers: schoolHeaders(school.slug) })
    ).json()) as { sections: Array<{ sectionKey: string; fields: Array<{ fieldKey: string }> }> };
    const publicKeys = published.sections.flatMap((section) => section.fields).map((field) => field.fieldKey);
    expect(publicKeys).not.toContain("child.preferred_name");
    expect(publicKeys).toContain("school_bus");
    expect(publicKeys).toContain("medical.allergies");
    expect(published.sections.map((section) => section.sectionKey)).toEqual(ordered.map((section) => section.sectionKey));
    expect(published.sections.find((section) => section.sectionKey === "child")?.fields.map((field) => field.fieldKey)).toEqual(
      orderedChild?.fields.filter((field) => field.enabled).map((field) => field.fieldKey),
    );

    const duplicate = structuredClone(ordered);
    const forename = duplicate.flatMap((section) => section.fields).find((field) => field.fieldKey === "child.legal_forename");
    duplicate[0]?.fields.push({ ...forename! });
    expect(
      (
        await app.request(`/api/v1/admissions/forms/${created.form.id}/definition`, {
          method: "PUT",
          headers: hdrs,
          body: JSON.stringify({ sections: duplicate }),
        })
      ).status,
    ).toBe(400);

    const unknown = structuredClone(ordered);
    unknown[0]?.fields.push({
      fieldKey: "child.secret_key",
      fieldKind: "canonical",
      canonicalKey: "child.secret_key",
      questionType: "short_text",
      label: "Secret",
      helperText: null,
      required: false,
      enabled: true,
      sortOrder: 99,
      options: [],
      documentPurpose: null,
    });
    expect(
      (
        await app.request(`/api/v1/admissions/forms/${created.form.id}/definition`, {
          method: "PUT",
          headers: hdrs,
          body: JSON.stringify({ sections: unknown }),
        })
      ).status,
    ).toBe(400);

    const emptied = ordered.map((section) => ({
      ...section,
      fields: section.fields.map((field) => (field.fieldKey === "how_heard" ? { ...field, options: [] } : field)),
    }));
    expect(
      (
        await app.request(`/api/v1/admissions/forms/${created.form.id}/definition`, {
          method: "PUT",
          headers: hdrs,
          body: JSON.stringify({ sections: emptied }),
        })
      ).status,
    ).toBe(400);
    const still = (await (
      await app.request(`/api/v1/public/admissions/forms/application/builder-${id}`, { headers: schoolHeaders(school.slug) })
    ).json()) as { sections: Section[] };
    expect(still.sections.flatMap((section) => section.fields).find((field) => field.fieldKey === "how_heard")?.options).toEqual([
      { value: "open_morning", label: "Open morning" },
    ]);

    const other = await createSchool(pools.owner, `${id}q`);
    const otherToken = await login(app, other.adminEmail, "password-12x");
    expect(
      (await app.request(`/api/v1/admissions/forms/${created.form.id}`, { headers: headers(otherToken, other.orgId) })).status,
    ).toBe(404);
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
