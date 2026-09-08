import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeEmailProvider } from "@schoolapp/core";
import { closePools, withTenantContext } from "@schoolapp/db";
import {
  addMembership,
  ensureMigrated,
  insertUser,
  login,
  testApiConfig,
  testApp,
  testPools,
} from "./test-helpers";
import { deliverQueuedMail } from "./email-delivery";
import { prepareAdmissionsStatusEmail } from "./admissions-mail";

const suffix = () => randomUUID().slice(0, 8);
const PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF\n");

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string; name: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug, name",
    [`stmail-${id}`, `StatusMail ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id, contact_email) values ($1, $2)", [
    org.rows[0]!.id,
    `office-${id}@school.test`,
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
  return { yearId: yearBody.academicYear.id, yearGroupId: year3.id };
}

async function createApplication(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  structure: { yearId: string; yearGroupId: string },
  input: {
    pupil: string;
    email?: string | null;
    extraContacts?: Array<{ fullName: string; email: string; isPrimary?: boolean }>;
  },
) {
  const contacts = [
    ...(input.email
      ? [{ fullName: "Primary Parent", email: input.email, isPrimary: true, relationship: "mother" }]
      : input.email === null
        ? [{ fullName: "No Email Parent", isPrimary: true, relationship: "mother" }]
        : [{ fullName: "Primary Parent", email: "primary.parent@example.com", isPrimary: true, relationship: "mother" }]),
    ...(input.extraContacts ?? []).map((row) => ({
      fullName: row.fullName,
      email: row.email,
      isPrimary: row.isPrimary ?? false,
      relationship: "father",
    })),
  ];
  const created = await app.request("/api/v1/admissions/applications", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      pupilLegalName: input.pupil,
      pupilPreferredName: input.pupil.split(" ")[0],
      intendedAcademicYearId: structure.yearId,
      intendedYearGroupId: structure.yearGroupId,
      status: "submitted",
      contacts,
    }),
  });
  expect(created.status).toBe(201);
  const body = (await created.json()) as { application: { id: string; reference: string; status: string } };
  return body.application;
}

async function moveTo(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  applicationId: string,
  status: string,
) {
  return app.request(`/api/v1/admissions/applications/${applicationId}/status`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({ status }),
  });
}

async function enableStatusEmail(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  key: string,
  wording?: { subject: string; heading: string; greeting: string; body: string; signoff: string },
) {
  const enabled = await app.request(`/api/v1/onboarding/mail/templates/${key}/presentation`, {
    method: "PUT",
    headers: hdrs,
    body: JSON.stringify({ sendEnabled: true }),
  });
  expect(enabled.status).toBe(200);
  if (!wording) return;
  const saved = await app.request(`/api/v1/onboarding/mail/templates/${key}`, {
    method: "PUT",
    headers: hdrs,
    body: JSON.stringify(wording),
  });
  expect(saved.status).toBe(200);
}

async function listStatusOutbox(owner: ReturnType<typeof testPools>["owner"], orgId: string) {
  return owner.query<{
    id: string;
    status: string;
    to_email: string;
    subject: string;
    body_text: string;
    template_key: string;
    idempotency_key: string | null;
    metadata: Record<string, unknown> | null;
  }>(
    `select id, status, to_email, subject, body_text, template_key, idempotency_key, metadata
       from mail_outbox
      where organisation_id = $1 and purpose = 'admissions_status_update'
      order by created_at`,
    [orgId],
  );
}

describe("B4 configurable admissions status emails", () => {
  const pools = testPools();

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("does not queue while disabled and queues exactly once when enabled", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const application = await createApplication(app, hdrs, structure, {
      pupil: "Maya Cole",
      email: "maya.parent@example.com",
    });
    expect((await moveTo(app, hdrs, application.id, "under_review")).status).toBe(200);
    const waitlisted = await app.request(`/api/v1/admissions/applications/${application.id}/waiting-list`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(waitlisted.status).toBe(201);
    expect((await listStatusOutbox(pools.owner, school.orgId)).rows).toHaveLength(0);

    await enableStatusEmail(app, hdrs, "admissions_status_rejected");
    expect((await moveTo(app, hdrs, application.id, "rejected")).status).toBe(200);
    const queued = await listStatusOutbox(pools.owner, school.orgId);
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0]?.template_key).toBe("admissions_status_rejected");
    expect(queued.rows[0]?.to_email).toBe("maya.parent@example.com");
    expect(queued.rows[0]?.body_text).toMatch(/not been successful/i);

    expect((await moveTo(app, hdrs, application.id, "rejected")).status).toBe(200);
    expect((await listStatusOutbox(pools.owner, school.orgId)).rows).toHaveLength(1);

    const retry = await app.request(`/api/v1/admissions/applications/${application.id}/status`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ status: "rejected" }),
    });
    expect(retry.status).toBe(200);
    expect((await listStatusOutbox(pools.owner, school.orgId)).rows).toHaveLength(1);
  });

  it("does not email for same-status saves, illegal transitions, or failed transitions", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const application = await createApplication(app, hdrs, structure, { pupil: "Noah Cole" });
    await enableStatusEmail(app, hdrs, "admissions_status_offer_made");
    await enableStatusEmail(app, hdrs, "admissions_status_accepted");
    expect((await moveTo(app, hdrs, application.id, "under_review")).status).toBe(200);
    expect((await moveTo(app, hdrs, application.id, "under_review")).status).toBe(200);
    const illegal = await moveTo(app, hdrs, application.id, "accepted");
    expect(illegal.status).toBe(409);
    const notes = await app.request(`/api/v1/admissions/applications/${application.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ pupilLegalName: "Noah Cole", internalNotes: "staff only" }),
    });
    expect(notes.status).toBe(200);
    const enrol = await app.request(`/api/v1/admissions/applications/${application.id}/enrol`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(enrol.status).toBe(409);
    expect((await listStatusOutbox(pools.owner, school.orgId)).rows).toHaveLength(0);
  });

  it("keeps a successful transition when email config lookup or enqueue fails", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const application = await createApplication(app, hdrs, structure, { pupil: "Ivy Cole" });
    expect((await moveTo(app, hdrs, application.id, "under_review")).status).toBe(200);

    const prepared = await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const broken = {
        query: async (sql: string, params?: unknown[]) => {
          if (sql.includes("get_organisation_transactional_email_settings")) {
            throw new Error("config_lookup_failed");
          }
          return client.query(sql, params);
        },
      };
      return prepareAdmissionsStatusEmail(broken, {
        organisationId: school.orgId,
        applicationId: application.id,
        fromStatus: "submitted",
        application: { status: "waiting_list", reference: "APP-1", pupil_legal_name: "Ivy Cole" },
      });
    });
    expect(prepared).toBeNull();

    await pools.owner.query(
      `insert into organisation_transactional_email_settings (
         organisation_id, template_key, show_school_logo, send_enabled
       ) values ($1, 'admissions_status_waiting_list', true, true)`,
      [school.orgId],
    );
    await pools.owner.query(
      `insert into organisation_transactional_email_templates (
         organisation_id, template_key, enabled, subject, heading, greeting, body_text, signoff
       ) values ($1, 'admissions_status_waiting_list', true, 'password: leaked', 'Heading', 'Hello', 'Body password: leaked', 'Bye')`,
      [school.orgId],
    );
    const waitlisted = await app.request(`/api/v1/admissions/applications/${application.id}/waiting-list`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(waitlisted.status).toBe(201);
    const listed = await app.request(`/api/v1/admissions/applications/${application.id}`, { headers: hdrs });
    expect(((await listed.json()) as { application: { status: string } }).application.status).toBe("waiting_list");
    expect((await listStatusOutbox(pools.owner, school.orgId)).rows).toHaveLength(0);
  });

  it("uses the primary parent email and does not invent a recipient", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    await enableStatusEmail(app, hdrs, "admissions_status_withdrawn");
    const withContacts = await createApplication(app, hdrs, structure, {
      pupil: "Priya Cole",
      email: "primary.only@example.com",
      extraContacts: [{ fullName: "Other Guardian", email: "other.guardian@example.com" }],
    });
    expect((await moveTo(app, hdrs, withContacts.id, "withdrawn")).status).toBe(200);
    const queued = await listStatusOutbox(pools.owner, school.orgId);
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0]?.to_email).toBe("primary.only@example.com");

    const missing = await createApplication(app, hdrs, structure, { pupil: "No Email Child", email: null });
    expect((await moveTo(app, hdrs, missing.id, "withdrawn")).status).toBe(200);
    expect((await listStatusOutbox(pools.owner, school.orgId)).rows).toHaveLength(1);
  });

  it("selects the matching template, custom wording, sample preview, and preserves logo/attachments", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    await enableStatusEmail(app, hdrs, "admissions_status_offer_made", {
      subject: "Offer for {{pupil_first_name}} at {{school_name}}",
      heading: "Offer of a place",
      greeting: "Hello {{recipient_first_name}},",
      body: "Offer recorded for {{application_reference}}. Deadline {{offer_deadline}}.",
      signoff: "Admissions",
    });
    const logoOff = await app.request(
      "/api/v1/onboarding/mail/templates/admissions_status_offer_made/presentation",
      { method: "PUT", headers: hdrs, body: JSON.stringify({ showSchoolLogo: false, sendEnabled: true }) },
    );
    expect(logoOff.status).toBe(200);
    const attach = await app.request(
      "/api/v1/onboarding/mail/templates/admissions_status_offer_made/attachments",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "X-Organisation-Id": school.orgId },
        body: (() => {
          const form = new FormData();
          form.append("file", new Blob([PDF], { type: "application/pdf" }), "Offer guide.pdf");
          return form;
        })(),
      },
    );
    expect(attach.status).toBe(201);

    const preview = await app.request(
      "/api/v1/onboarding/mail/templates/admissions_status_offer_made/preview",
      {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({}),
      },
    );
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as {
      fixture: boolean;
      queued: boolean;
      subject: string;
      text: string;
      attachments: Array<{ filename: string }>;
    };
    expect(previewBody.fixture).toBe(true);
    expect(previewBody.queued).toBe(false);
    expect(previewBody.subject).toContain("Maya");
    expect(previewBody.text).toContain("APP-1001");
    expect(previewBody.attachments.map((row) => row.filename)).toEqual(["Offer guide.pdf"]);
    expect((await listStatusOutbox(pools.owner, school.orgId)).rows).toHaveLength(0);

    const application = await createApplication(app, hdrs, structure, { pupil: "Maya Cole" });
    expect((await moveTo(app, hdrs, application.id, "under_review")).status).toBe(200);
    const offer = await app.request(`/api/v1/admissions/applications/${application.id}/offers`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ responseDeadline: "2026-06-01" }),
    });
    expect(offer.status).toBe(201);
    const queued = await listStatusOutbox(pools.owner, school.orgId);
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0]?.template_key).toBe("admissions_status_offer_made");
    expect(queued.rows[0]?.subject).toContain("Maya");
    expect(queued.rows[0]?.body_text).toContain("01/06/2026");

    await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), { id: queued.rows[0]!.id });
    expect(email.sent[0]?.attachments?.map((item) => item.filename)).toEqual(["Offer guide.pdf"]);
    expect(email.sent[0]?.html).not.toContain("<img");

    const reset = await app.request("/api/v1/onboarding/mail/templates/admissions_status_offer_made", {
      method: "DELETE",
      headers: hdrs,
    });
    const resetBody = (await reset.json()) as {
      template: { sendEnabled: boolean; showSchoolLogo: boolean; customised: boolean; attachments: unknown[] };
    };
    expect(resetBody.template.customised).toBe(false);
    expect(resetBody.template.sendEnabled).toBe(true);
    expect(resetBody.template.showSchoolLogo).toBe(false);
    expect(resetBody.template.attachments).toHaveLength(1);
  });

  it("blocks unknown placeholders, HTML, cross-org access, and non-admin configuration", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const other = await createSchool(pools.owner, `${suffix()}b`);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const bad = await app.request("/api/v1/onboarding/mail/templates/admissions_status_enrolled", {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        subject: "Hello",
        heading: "Hello",
        greeting: "Hello",
        body: "Notes {{internal_notes}} and <b>html</b>",
        signoff: "Bye",
      }),
    });
    expect(bad.status).toBe(400);

    const teacherEmail = `t-${suffix()}@example.com`;
    const teacherId = await insertUser(pools.owner, {
      email: teacherEmail,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    const parentEmail = `p-${suffix()}@example.com`;
    const parentId = await insertUser(pools.owner, {
      email: parentEmail,
      password: "password-12x",
      fullName: "Parent",
      kind: "parent",
    });
    await addMembership(pools.owner, school.orgId, parentId, "school.parent");
    const studentEmail = `s-${suffix()}@example.com`;
    const studentId = await insertUser(pools.owner, {
      email: studentEmail,
      password: "password-12x",
      fullName: "Student",
      kind: "student",
    });
    await addMembership(pools.owner, school.orgId, studentId, "school.student");
    for (const account of [teacherEmail, parentEmail]) {
      const roleToken = await login(app, account, "password-12x");
      const roleHdrs = headers(roleToken, school.orgId);
      expect((await app.request("/api/v1/onboarding/mail/templates", { headers: roleHdrs })).status).toBe(403);
      expect(
        (
          await app.request("/api/v1/onboarding/mail/templates/admissions_status_offer_made/presentation", {
            method: "PUT",
            headers: roleHdrs,
            body: JSON.stringify({ sendEnabled: true }),
          })
        ).status,
      ).toBe(403);
    }
    const studentLogin = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: studentEmail, password: "password-12x" }),
    });
    if (studentLogin.status === 200) {
      const studentBody = (await studentLogin.json()) as { token: string };
      expect(
        (
          await app.request("/api/v1/onboarding/mail/templates", {
            headers: headers(studentBody.token, school.orgId),
          })
        ).status,
      ).toBe(403);
    }

    await enableStatusEmail(app, hdrs, "admissions_status_withdrawn");
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const otherList = await app.request("/api/v1/onboarding/mail/templates", {
      headers: headers(otherToken, other.orgId),
    });
    const otherBody = (await otherList.json()) as { templates: Array<{ key: string; sendEnabled?: boolean }> };
    expect(otherBody.templates.find((row) => row.key === "admissions_status_withdrawn")?.sendEnabled).toBe(false);
  });

  it("does not regress enquiry or application acknowledgements", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const created = await app.request("/api/v1/admissions/forms", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ formType: "enquiry", name: "Enquire", slug: "enquire-status" }),
    });
    expect(created.status).toBe(201);
    const form = (await created.json()) as { form: { id: string } };
    expect((await app.request(`/api/v1/admissions/forms/${form.form.id}/publish`, { method: "POST", headers: hdrs })).status).toBe(200);
    const submit = await app.request("/api/v1/public/admissions/forms/enquiry/enquire-status/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `enq-${suffix()}`,
        answers: {
          "child.legal_name": "Maya Cole",
          "child.preferred_name": "Maya",
          "child.date_of_birth": "2018-04-12",
          "guardian.full_name": "Priya Cole",
          "guardian.relationship": "mother",
          "guardian.email": "ack.parent@example.com",
          "guardian.phone": "01234567890",
          "enquiry.notes": "Please send open morning dates",
          "child.intended_academic_year_id": structure.yearId,
          "child.intended_year_group_id": structure.yearGroupId,
        },
      }),
    });
    expect(submit.status).toBe(201);
    const acks = await pools.owner.query(
      `select id from mail_outbox where organisation_id = $1 and purpose = 'admissions_enquiry_received'`,
      [school.orgId],
    );
    expect(acks.rows).toHaveLength(1);

    const ignoreSend = await app.request(
      "/api/v1/onboarding/mail/templates/admissions_enquiry_received/presentation",
      { method: "PUT", headers: hdrs, body: JSON.stringify({ sendEnabled: false }) },
    );
    expect(ignoreSend.status).toBe(200);
    const apply = await app.request("/api/v1/admissions/forms", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ formType: "application", name: "Apply", slug: "apply-status" }),
    });
    const applyForm = (await apply.json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${applyForm.form.id}/publish`, { method: "POST", headers: hdrs });
    const applyPayload = {
      idempotencyKey: `app-${suffix()}`,
      answers: {
        "child.legal_name": "Maya Cole",
        "child.preferred_name": "Maya",
        "child.date_of_birth": "2018-01-01",
        "child.intended_academic_year_id": structure.yearId,
        "child.intended_year_group_id": structure.yearGroupId,
        guardians: [{ fullName: "Sarah Cole", email: "ack.apply@example.com", primaryContact: true }],
        declaration_privacy: true,
      },
    };
    const firstApply = await app.request("/api/v1/public/admissions/forms/application/apply-status/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify(applyPayload),
    });
    const secondApply = await app.request("/api/v1/public/admissions/forms/application/apply-status/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify(applyPayload),
    });
    expect(firstApply.status).toBe(201);
    expect(secondApply.status).toBe(201);
    const appAcks = await pools.owner.query(
      `select id from mail_outbox where organisation_id = $1 and purpose = 'admissions_application_received'`,
      [school.orgId],
    );
    expect(appAcks.rows).toHaveLength(1);
    expect((await listStatusOutbox(pools.owner, school.orgId)).rows).toHaveLength(0);
  });

  it("queues assessment, offer-accepted, enrolled, and a later re-entry as distinct transitions", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    await enableStatusEmail(app, hdrs, "admissions_status_assessment_pending");
    await enableStatusEmail(app, hdrs, "admissions_status_accepted");
    await enableStatusEmail(app, hdrs, "admissions_status_enrolled");
    await enableStatusEmail(app, hdrs, "admissions_status_withdrawn");
    await enableStatusEmail(app, hdrs, "admissions_status_offer_made");

    const assessed = await createApplication(app, hdrs, structure, { pupil: "Alex Cole" });
    const assessment = await app.request(`/api/v1/admissions/applications/${assessed.id}/assessments`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        assessmentType: "admissions_interview",
        scheduledAt: "2026-05-12T10:00:00.000Z",
      }),
    });
    expect(assessment.status).toBe(201);
    const afterAssessment = await listStatusOutbox(pools.owner, school.orgId);
    expect(afterAssessment.rows).toHaveLength(1);
    expect(afterAssessment.rows[0]?.template_key).toBe("admissions_status_assessment_pending");
    expect(afterAssessment.rows[0]?.body_text).toContain("12/05/2026");

    const offerApp = await createApplication(app, hdrs, structure, { pupil: "Sam Cole" });
    expect((await moveTo(app, hdrs, offerApp.id, "under_review")).status).toBe(200);
    const offer = await app.request(`/api/v1/admissions/applications/${offerApp.id}/offers`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ responseDeadline: "2026-06-01" }),
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
      await app.request(`/api/v1/admissions/applications/${offerApp.id}`, { headers: hdrs })
    ).json()) as { contacts: Array<{ id: string }> };
    const enrolled = await app.request(`/api/v1/admissions/applications/${offerApp.id}/enrol`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: structure.yearId,
        yearGroupId: structure.yearGroupId,
        guardianLinks: [{ contactId: detail.contacts[0]!.id, portalAccess: false }],
      }),
    });
    expect(enrolled.status).toBe(200);
    const enrolQueued = await listStatusOutbox(pools.owner, school.orgId);
    expect(enrolQueued.rows.map((row) => row.template_key)).toEqual([
      "admissions_status_assessment_pending",
      "admissions_status_offer_made",
      "admissions_status_accepted",
      "admissions_status_enrolled",
    ]);

    const withdrawn = await createApplication(app, hdrs, structure, { pupil: "Riley Cole" });
    expect((await moveTo(app, hdrs, withdrawn.id, "withdrawn")).status).toBe(200);
    expect((await moveTo(app, hdrs, withdrawn.id, "under_review")).status).toBe(200);
    expect((await moveTo(app, hdrs, withdrawn.id, "withdrawn")).status).toBe(200);
    const withdrawnRows = (await listStatusOutbox(pools.owner, school.orgId)).rows.filter(
      (row) => row.template_key === "admissions_status_withdrawn",
    );
    expect(withdrawnRows).toHaveLength(2);
    expect(withdrawnRows[0]?.idempotency_key).not.toBe(withdrawnRows[1]?.idempotency_key);
  });

  it("delivers queued offer-made and accepted emails through the worker with the matching templates", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    await enableStatusEmail(app, hdrs, "admissions_status_offer_made");
    await enableStatusEmail(app, hdrs, "admissions_status_accepted");

    const application = await createApplication(app, hdrs, structure, { pupil: "Jordan Cole" });
    expect((await moveTo(app, hdrs, application.id, "under_review")).status).toBe(200);
    const offer = await app.request(`/api/v1/admissions/applications/${application.id}/offers`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ responseDeadline: "2026-06-01" }),
    });
    expect(offer.status).toBe(201);
    const offerBody = (await offer.json()) as { offer: { id: string } };
    const queuedOffer = await listStatusOutbox(pools.owner, school.orgId);
    expect(queuedOffer.rows).toHaveLength(1);
    expect(queuedOffer.rows[0]?.template_key).toBe("admissions_status_offer_made");
    expect(queuedOffer.rows[0]?.status).toBe("queued");

    const accepted = await app.request(`/api/v1/admissions/offers/${offerBody.offer.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ status: "accepted" }),
    });
    expect(accepted.status).toBe(200);
    const queuedBoth = await listStatusOutbox(pools.owner, school.orgId);
    expect(queuedBoth.rows.map((row) => row.template_key)).toEqual([
      "admissions_status_offer_made",
      "admissions_status_accepted",
    ]);
    expect(new Set(queuedBoth.rows.map((row) => row.idempotency_key)).size).toBe(2);

    const delivered = await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), { limit: 10 });
    expect(delivered.sent).toBe(2);
    expect(email.sent).toHaveLength(2);
    expect(email.sent[0]?.headers?.["X-LuvLearn-Template"]).toBe("admissions_status_offer_made");
    expect(email.sent[1]?.headers?.["X-LuvLearn-Template"]).toBe("admissions_status_accepted");
    expect(email.sent[0]?.subject).toMatch(/Application update/i);
    expect(email.sent[1]?.subject).toMatch(/Application update/i);
    expect(email.sent[0]?.text).toMatch(/offer has been made/i);
    expect(email.sent[0]?.text).toContain(application.reference);
    expect(email.sent[0]?.text).toContain("01/06/2026");
    expect(email.sent[0]?.text).not.toMatch(/recorded as accepted/i);
    expect(email.sent[1]?.text).toMatch(/recorded as accepted/i);
    expect(email.sent[1]?.text).toContain(application.reference);
    expect(email.sent[1]?.text).not.toMatch(/offer has been made/i);
    expect(email.sent[1]?.text).not.toContain("01/06/2026");
  });
});
