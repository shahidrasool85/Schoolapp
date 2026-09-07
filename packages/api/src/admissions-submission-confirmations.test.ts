import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeEmailProvider } from "@schoolapp/core";
import { closePools, withTenantContext } from "@schoolapp/db";
import { presentPublicSubmissionConfirmation } from "./admissions-submission-confirmations";
import {
  addMembership,
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
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`sc-${id}`, `Confirm ${id}`],
  );
  await owner.query(
    "insert into organisation_settings (organisation_id, contact_email) values ($1, $2)",
    [org.rows[0]!.id, `office-${id}@school.test`],
  );
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return {
    adminId,
    orgId: org.rows[0]!.id,
    slug: org.rows[0]!.slug,
    name: `Confirm ${id}`,
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

async function seedAdmissionsForm(
  app: ReturnType<typeof testApp>,
  hdrs: Record<string, string>,
  formType: "enquiry" | "application",
  slug: string,
) {
  const existingYears = (await (await app.request("/api/v1/academic-years", { headers: hdrs })).json()) as {
    academicYears?: Array<{ id: string; isCurrent?: boolean }>;
  };
  let yearId = existingYears.academicYears?.find((row) => row.isCurrent)?.id ?? existingYears.academicYears?.[0]?.id;
  if (!yearId) {
    const yearRes = await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "2026/27",
        startsOn: "2026-09-01",
        endsOn: "2027-07-31",
        isCurrent: true,
      }),
    });
    if (yearRes.status !== 201) {
      throw new Error(`academic year failed ${yearRes.status} ${await yearRes.text()}`);
    }
    yearId = ((await yearRes.json()) as { academicYear: { id: string } }).academicYear.id;
  }
  await app.request("/api/v1/year-groups/seed", { method: "POST", headers: hdrs, body: "{}" });
  const groups = (await (await app.request("/api/v1/year-groups", { headers: hdrs })).json()) as {
    yearGroups: Array<{ id: string; code: string }>;
  };
  const year3 = groups.yearGroups.find((row) => row.code === "3")!.id;
  const created = await app.request("/api/v1/admissions/forms", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({ formType, name: formType === "enquiry" ? "Enquire" : "Apply", slug }),
  });
  if (created.status !== 201) {
    throw new Error(`form create failed ${created.status} ${await created.text()}`);
  }
  const form = (await created.json()) as { form: { id: string } };
  await app.request(`/api/v1/admissions/forms/${form.form.id}/publish`, { method: "POST", headers: hdrs });
  return { yearId, year3, formId: form.form.id };
}

function enquiryAnswers(yearId: string, year3: string, email = "priya.cole@example.com") {
  return {
    "child.legal_name": "Maya Cole",
    "child.preferred_name": "Maya",
    "child.date_of_birth": "2018-04-12",
    "guardian.full_name": "Priya Cole",
    "guardian.relationship": "mother",
    "guardian.email": email,
    "guardian.phone": "01234567890",
    "enquiry.notes": "Please send open morning dates",
    "child.intended_academic_year_id": yearId,
    "child.intended_year_group_id": year3,
  };
}

function applicationAnswers(yearId: string, year3: string, email = "sarah.cole@example.com") {
  return {
    "child.legal_name": "Maya Cole",
    "child.preferred_name": "Maya",
    "child.date_of_birth": "2018-01-01",
    "child.intended_academic_year_id": yearId,
    "child.intended_year_group_id": year3,
    guardians: [{ fullName: "Sarah Cole", email, primaryContact: true }],
    declaration_privacy: true,
  };
}

type Confirmation = {
  heading: string;
  message: string;
  additionalMessage: string | null;
  button: { label: string; url: string } | null;
  referenceLabel: string;
  reference: string;
  showSystemReference: boolean;
  source: "custom" | "system";
};

describe("school admin admissions submission confirmations", () => {
  const pools = testPools();

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("lets School Admin list, save, preview, and reset confirmations without touching mail", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);

    const listed = await app.request("/api/v1/onboarding/admissions/submission-confirmations", { headers: hdrs });
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      templates: Array<{ key: string; source: string; customised: boolean }>;
    };
    expect(listBody.templates.map((row) => row.key)).toEqual([
      "admissions_enquiry_submission_confirmation",
      "admissions_application_submission_confirmation",
    ]);
    expect(listBody.templates.every((row) => row.source === "system" && row.customised === false)).toBe(true);

    const saved = await app.request(
      "/api/v1/onboarding/admissions/submission-confirmations/admissions_enquiry_submission_confirmation",
      {
        method: "PUT",
        headers: hdrs,
        body: JSON.stringify({
          heading: "Thank you for your enquiry",
          message: "We have received your enquiry and a member of our admissions team will contact you shortly.",
          additionalMessage: "You can download our latest prospectus while you wait.",
          buttonLabel: "View school brochure",
          buttonUrl: "https://kingswoodschool.co.uk/school-brochure/",
        }),
      },
    );
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as { template: { source: string; heading: string } };
    expect(savedBody.template.source).toBe("custom");
    expect(savedBody.template.heading).toBe("Thank you for your enquiry");

    const preview = await app.request(
      "/api/v1/onboarding/admissions/submission-confirmations/admissions_enquiry_submission_confirmation/preview",
      {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          heading: "Thanks {{school_name}}",
          message: "Reference {{enquiry_reference}}",
        }),
      },
    );
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as {
      fixture: boolean;
      queued: boolean;
      confirmation: Confirmation;
      branding: { schoolName: string };
    };
    expect(previewBody.fixture).toBe(true);
    expect(previewBody.queued).toBe(false);
    expect(previewBody.confirmation.reference).toBe("ENQ-2026-0001");
    expect(previewBody.confirmation.message).toContain("ENQ-2026-0001");
    expect(previewBody.confirmation.heading).toContain(school.name);
    expect(previewBody.branding.schoolName).toBe(school.name);

    expect(email.sent).toHaveLength(0);
    const outbox = await pools.owner.query("select id from mail_outbox where organisation_id = $1", [school.orgId]);
    expect(outbox.rows).toHaveLength(0);
    const enquiries = await pools.owner.query("select id from admissions_enquiries where organisation_id = $1", [
      school.orgId,
    ]);
    expect(enquiries.rows).toHaveLength(0);
    const applications = await pools.owner.query(
      "select id from admissions_applications where organisation_id = $1",
      [school.orgId],
    );
    expect(applications.rows).toHaveLength(0);

    const reset = await app.request(
      "/api/v1/onboarding/admissions/submission-confirmations/admissions_enquiry_submission_confirmation",
      { method: "DELETE", headers: hdrs },
    );
    expect(reset.status).toBe(200);
    const resetBody = (await reset.json()) as { template: { source: string; heading: string; customised: boolean } };
    expect(resetBody.template.source).toBe("system");
    expect(resetBody.template.heading).toBe("Thank you");
    expect(resetBody.template.customised).toBe(false);

    const audit = await pools.owner.query<{ action: string; after_data: Record<string, unknown> }>(
      `select action, after_data from audit_events
        where organisation_id = $1 and action like 'org.admissions_submission_confirmation.%'
        order by occurred_at`,
      [school.orgId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "org.admissions_submission_confirmation.updated",
      "org.admissions_submission_confirmation.reset",
    ]);
    expect(JSON.stringify(audit.rows)).not.toMatch(/Maya|Priya|medical|password/i);
    expect(audit.rows[0]?.after_data).toMatchObject({
      templateKey: "admissions_enquiry_submission_confirmation",
      source: "custom",
    });
    expect(audit.rows[1]?.after_data).toMatchObject({ source: "system" });
  });

  it("rejects unknown placeholders, HTML, and unsafe URLs", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const unsupported = await app.request(
      "/api/v1/onboarding/admissions/submission-confirmations/admissions_enquiry_submission_confirmation",
      {
        method: "PUT",
        headers: hdrs,
        body: JSON.stringify({ heading: "Thanks", message: "Allergy {{medical_notes}}" }),
      },
    );
    expect(unsupported.status).toBe(400);
    expect(JSON.stringify(await unsupported.json())).toMatch(/unsupported field/i);

    const html = await app.request(
      "/api/v1/onboarding/admissions/submission-confirmations/admissions_enquiry_submission_confirmation",
      {
        method: "PUT",
        headers: hdrs,
        body: JSON.stringify({ heading: "Thanks", message: "Hi <script>alert(1)</script>" }),
      },
    );
    expect(html.status).toBe(400);
    expect(JSON.stringify(await html.json())).toMatch(/HTML or scripts/i);

    const unsafe = await app.request(
      "/api/v1/onboarding/admissions/submission-confirmations/admissions_enquiry_submission_confirmation",
      {
        method: "PUT",
        headers: hdrs,
        body: JSON.stringify({
          heading: "Thanks",
          message: "Hello",
          buttonLabel: "Open",
          buttonUrl: "javascript:alert(1)",
        }),
      },
    );
    expect(unsafe.status).toBe(400);
    expect(JSON.stringify(await unsafe.json())).toMatch(/http or https/i);

    const dataUrl = await app.request(
      "/api/v1/onboarding/admissions/submission-confirmations/admissions_application_submission_confirmation",
      {
        method: "PUT",
        headers: hdrs,
        body: JSON.stringify({
          heading: "Thanks",
          message: "Hello {{pupil_first_name}}",
          buttonLabel: "Open",
          buttonUrl: "data:text/html,hi",
        }),
      },
    );
    expect(dataUrl.status).toBe(400);
  });

  it("renders custom enquiry and application confirmations with the real reference after submit", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);

    await app.request(
      "/api/v1/onboarding/admissions/submission-confirmations/admissions_enquiry_submission_confirmation",
      {
        method: "PUT",
        headers: hdrs,
        body: JSON.stringify({
          heading: "Thank you for your enquiry",
          message: "Hello from {{school_name}}.",
          additionalMessage: "We will be in touch.",
          buttonLabel: "Visit school website",
          buttonUrl: "https://kingswoodschool.co.uk/",
        }),
      },
    );
    await app.request(
      "/api/v1/onboarding/admissions/submission-confirmations/admissions_application_submission_confirmation",
      {
        method: "PUT",
        headers: hdrs,
        body: JSON.stringify({
          heading: "Thank you for your application",
          message: "We have received {{pupil_first_name}}'s application at {{school_name}}.",
          additionalMessage: "We will contact you if we need any further information.",
        }),
      },
    );

    const enquiryForm = await seedAdmissionsForm(app, hdrs, "enquiry", "enquire-confirm");
    const applyForm = await seedAdmissionsForm(app, hdrs, "application", "apply-confirm");
    const enquiryPayload = {
      idempotencyKey: `enq-${suffix()}`,
      answers: enquiryAnswers(enquiryForm.yearId, enquiryForm.year3),
    };
    const first = await app.request("/api/v1/public/admissions/forms/enquiry/enquire-confirm/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify(enquiryPayload),
    });
    const refresh = await app.request("/api/v1/public/admissions/forms/enquiry/enquire-confirm/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify(enquiryPayload),
    });
    expect(first.status).toBe(201);
    expect(refresh.status).toBe(201);
    const enquiryBody = (await first.json()) as { submission: { enquiryReference: string; confirmation: Confirmation } };
    expect(enquiryBody.submission.confirmation.heading).toBe("Thank you for your enquiry");
    expect(enquiryBody.submission.confirmation.message).toBe(`Hello from ${school.name}.`);
    expect(enquiryBody.submission.confirmation.button?.url).toBe("https://kingswoodschool.co.uk/");
    expect(enquiryBody.submission.confirmation.reference).toBe(enquiryBody.submission.enquiryReference);
    expect(enquiryBody.submission.confirmation.reference).toMatch(/^ENQ-/);
    expect(enquiryBody.submission.confirmation.showSystemReference).toBe(true);
    expect(enquiryBody.submission.confirmation.source).toBe("custom");

    const apply = await app.request("/api/v1/public/admissions/forms/application/apply-confirm/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `app-${suffix()}`,
        answers: applicationAnswers(applyForm.yearId, applyForm.year3),
      }),
    });
    expect(apply.status).toBe(201);
    const applyBody = (await apply.json()) as {
      submission: { applicationReference: string; confirmation: Confirmation };
    };
    expect(applyBody.submission.confirmation.heading).toBe("Thank you for your application");
    expect(applyBody.submission.confirmation.message).toContain("Maya");
    expect(applyBody.submission.confirmation.message).toContain(school.name);
    expect(applyBody.submission.confirmation.reference).toBe(applyBody.submission.applicationReference);
    expect(applyBody.submission.confirmation.reference).toMatch(/^APP-/);
    expect(applyBody.submission.confirmation.showSystemReference).toBe(true);

    const enquiryCount = await pools.owner.query<{ n: string }>(
      "select count(*)::text as n from admissions_enquiries where organisation_id = $1",
      [school.orgId],
    );
    const applicationCount = await pools.owner.query<{ n: string }>(
      "select count(*)::text as n from admissions_applications where organisation_id = $1",
      [school.orgId],
    );
    expect(enquiryCount.rows[0]?.n).toBe("1");
    expect(applicationCount.rows[0]?.n).toBe("1");

    const enquiryMail = await pools.owner.query(
      `select id from mail_outbox where organisation_id = $1 and purpose = 'admissions_enquiry_received'`,
      [school.orgId],
    );
    const applicationMail = await pools.owner.query(
      `select id from mail_outbox where organisation_id = $1 and purpose = 'admissions_application_received'`,
      [school.orgId],
    );
    expect(enquiryMail.rows).toHaveLength(1);
    expect(applicationMail.rows).toHaveLength(1);
  });

  it("keeps the system default when no override exists and still shows the real reference", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const form = await seedAdmissionsForm(app, hdrs, "enquiry", "enquire-default");
    const submit = await app.request("/api/v1/public/admissions/forms/enquiry/enquire-default/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `enq-def-${suffix()}`,
        answers: enquiryAnswers(form.yearId, form.year3),
      }),
    });
    expect(submit.status).toBe(201);
    const body = (await submit.json()) as { submission: { enquiryReference: string; confirmation: Confirmation } };
    expect(body.submission.confirmation.heading).toBe("Thank you");
    expect(body.submission.confirmation.message).toBe("We have received your submission.");
    expect(body.submission.confirmation.source).toBe("system");
    expect(body.submission.confirmation.showSystemReference).toBe(true);
    expect(body.submission.confirmation.reference).toBe(body.submission.enquiryReference);
    expect(
      (
        await pools.owner.query(
          `select id from mail_outbox where organisation_id = $1 and purpose = 'admissions_enquiry_received'`,
          [school.orgId],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("falls back to the system default when custom template lookup fails or the stored override is corrupt", async () => {
    const failed = await presentPublicSubmissionConfirmation({
      pool: {
        query: async () => {
          throw new Error("lookup failed");
        },
      },
      organisationId: randomUUID(),
      organisationName: "Kingswood School",
      formType: "enquiry",
      result: { enquiryReference: "ENQ-2026-0004" },
    });
    expect(failed.source).toBe("system");
    expect(failed.heading).toBe("Thank you");
    expect(failed.reference).toBe("ENQ-2026-0004");

    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    await pools.owner.query(
      `insert into organisation_admissions_submission_confirmations (
         organisation_id, template_key, heading, message_text
       ) values ($1, 'admissions_enquiry_submission_confirmation', 'Broken {{unknown_field}}', 'Broken body')`,
      [school.orgId],
    );
    const form = await seedAdmissionsForm(app, hdrs, "enquiry", "enquire-broken-confirm");
    const submit = await app.request("/api/v1/public/admissions/forms/enquiry/enquire-broken-confirm/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `enq-broken-${suffix()}`,
        answers: enquiryAnswers(form.yearId, form.year3, "broken.confirm@example.com"),
      }),
    });
    expect(submit.status).toBe(201);
    const body = (await submit.json()) as { submission: { enquiryReference: string; confirmation: Confirmation } };
    expect(body.submission.confirmation.source).toBe("system");
    expect(body.submission.confirmation.heading).toBe("Thank you");
    expect(body.submission.confirmation.reference).toBe(body.submission.enquiryReference);
    expect(
      (
        await pools.owner.query(
          `select id from mail_outbox where organisation_id = $1 and purpose = 'admissions_enquiry_received'`,
          [school.orgId],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("forbids teachers, parents, and students from managing confirmation pages", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const id = suffix();
    const teacherEmail = `t-${id}@example.com`;
    const teacherId = await insertUser(pools.owner, {
      email: teacherEmail,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    const parentEmail = `p-${id}@example.com`;
    const parentId = await insertUser(pools.owner, {
      email: parentEmail,
      password: "password-12x",
      fullName: "Parent",
      kind: "parent",
    });
    await addMembership(pools.owner, school.orgId, parentId, "school.parent");
    const studentEmail = `s-${id}@example.com`;
    const studentId = await insertUser(pools.owner, {
      email: studentEmail,
      password: "password-12x",
      fullName: "Student",
      kind: "student",
    });
    await addMembership(pools.owner, school.orgId, studentId, "school.student");

    const studentLogin = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: studentEmail, password: "password-12x" }),
    });
    expect(studentLogin.status).toBe(401);

    for (const account of [{ email: teacherEmail }, { email: parentEmail }]) {
      const token = await login(app, account.email, "password-12x");
      const hdrs = headers(token, school.orgId);
      expect(
        (await app.request("/api/v1/onboarding/admissions/submission-confirmations", { headers: hdrs })).status,
      ).toBe(403);
      expect(
        (
          await app.request(
            "/api/v1/onboarding/admissions/submission-confirmations/admissions_enquiry_submission_confirmation",
            {
              method: "PUT",
              headers: hdrs,
              body: JSON.stringify({ heading: "Hello", message: "Hello" }),
            },
          )
        ).status,
      ).toBe(403);
    }
  });

  it("does not leak confirmation pages across organisations and leaves email templates unchanged", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const other = await createSchool(pools.owner, `${suffix()}x`);
    const token = await login(app, school.adminEmail, "password-12x");
    await app.request(
      "/api/v1/onboarding/admissions/submission-confirmations/admissions_enquiry_submission_confirmation",
      {
        method: "PUT",
        headers: headers(token, school.orgId),
        body: JSON.stringify({ heading: "Secret heading", message: "Secret body" }),
      },
    );
    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const leaked = await client.query(
        "select id from organisation_admissions_submission_confirmations where organisation_id = $1",
        [other.orgId],
      );
      expect(leaked.rows).toEqual([]);
    });
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const otherList = await app.request("/api/v1/onboarding/admissions/submission-confirmations", {
      headers: headers(otherToken, other.orgId),
    });
    const otherBody = (await otherList.json()) as { templates: Array<{ customised: boolean }> };
    expect(otherBody.templates.every((row) => row.customised === false)).toBe(true);

    const emailTemplates = await pools.owner.query(
      "select id from organisation_transactional_email_templates where organisation_id = $1",
      [school.orgId],
    );
    expect(emailTemplates.rows).toHaveLength(0);
    const attachments = await pools.owner.query(
      "select id from organisation_transactional_email_template_attachments where organisation_id = $1",
      [school.orgId],
    );
    expect(attachments.rows).toHaveLength(0);
  });
});
