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
    [`et-${id}`, `EmailTpl ${id}`],
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
    name: `EmailTpl ${id}`,
    adminEmail: `admin-${id}@example.com`,
    contactEmail: `office-${id}@school.test`,
  };
}

function headers(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Organisation-Id": orgId,
  };
}

async function listOutbox(
  owner: ReturnType<typeof testPools>["owner"],
  orgId: string,
  purpose: string,
) {
  return owner.query<{
    id: string;
    status: string;
    to_email: string;
    subject: string;
    body_text: string;
    idempotency_key: string | null;
  }>(
    `select id, status, to_email, subject, body_text, idempotency_key
       from mail_outbox
      where organisation_id = $1 and purpose = $2
      order by created_at desc`,
    [orgId, purpose],
  );
}

async function seedAdmissionsForm(
  app: ReturnType<typeof testApp>,
  hdrs: Record<string, string>,
  formType: "enquiry" | "application",
  slug: string,
) {
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
  const year = (await yearRes.json()) as { academicYear: { id: string } };
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
  return { yearId: year.academicYear.id, year3 };
}

describe("school admin automatic email templates", () => {
  const pools = testPools();

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("lets School Admin list and save enquiry/application templates", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const listed = await app.request("/api/v1/onboarding/mail/templates", { headers: hdrs });
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      templates: Array<{ key: string; source: string; customised: boolean; sendEnabled?: boolean; kind?: string }>;
    };
    expect(listBody.templates.map((row) => row.key)).toEqual([
      "admissions_enquiry_received",
      "admissions_application_received",
      "admissions_status_assessment_pending",
      "admissions_status_waiting_list",
      "admissions_status_offer_made",
      "admissions_status_accepted",
      "admissions_status_enrolled",
      "admissions_status_rejected",
      "admissions_status_withdrawn",
    ]);
    expect(listBody.templates.filter((row) => row.kind !== "admissions_status").every((row) => row.source === "system" && row.customised === false)).toBe(true);
    expect(listBody.templates.filter((row) => row.kind === "admissions_status").every((row) => row.sendEnabled === false)).toBe(true);

    const saved = await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received", {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        enabled: true,
        subject: "Thanks {{school_name}}",
        heading: "Enquiry received",
        greeting: "Dear {{recipient_first_name}},",
        body: "We have enquiry {{enquiry_reference}}.\nEmail {{school_contact_email}}.",
        signoff: "Kind regards,\n{{school_name}}",
      }),
    });
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as { template: { source: string; subject: string } };
    expect(savedBody.template.source).toBe("custom");
    expect(savedBody.template.subject).toBe("Thanks {{school_name}}");
  });

  it("rejects unsupported variables, malformed placeholders, and HTML", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const unsupported = await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received", {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        subject: "Hello",
        heading: "Hello",
        greeting: "Hello",
        body: "Allergy {{medical_notes}}",
        signoff: "Bye",
      }),
    });
    expect(unsupported.status).toBe(400);
    expect(JSON.stringify(await unsupported.json())).toMatch(/unsupported field/i);

    const malformed = await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received", {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        subject: "Hello",
        heading: "Hello",
        greeting: "Hello",
        body: "Hi {{school_name",
        signoff: "Bye",
      }),
    });
    expect(malformed.status).toBe(400);
    expect(JSON.stringify(await malformed.json())).toMatch(/malformed placeholder/i);

    const html = await app.request("/api/v1/onboarding/mail/templates/admissions_application_received", {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        subject: "Hello",
        heading: "Hello",
        greeting: "Hello",
        body: "Hi <script>alert(1)</script>",
        signoff: "Bye",
      }),
    });
    expect(html.status).toBe(400);
    expect(JSON.stringify(await html.json())).toMatch(/HTML or scripts/i);
  });

  it("previews with sample data and does not enqueue mail or use real recipients", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const preview = await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received/preview", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        subject: "Preview {{enquiry_reference}}",
        heading: "Enquiry received",
        greeting: "Dear {{recipient_first_name}},",
        body: "Hello from {{school_name}}.",
        signoff: "Thanks",
      }),
    });
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as {
      fixture: boolean;
      queued?: boolean;
      subject: string;
      html: string;
      text: string;
    };
    expect(body.fixture).toBe(true);
    expect(body.queued).toBe(false);
    expect(body.subject).toContain("ENQ-1001");
    expect(body.text).toContain("Jordan");
    expect(body.text).not.toContain(school.adminEmail);
    expect(body.html).toContain("Powered by LuvLearn");
    expect(email.sent).toHaveLength(0);
    expect((await listOutbox(pools.owner, school.orgId, "admissions_enquiry_received")).rows).toHaveLength(0);
  });

  it("forbids teachers from managing templates", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const teacherEmail = `t-${suffix()}@example.com`;
    const teacherId = await insertUser(pools.owner, {
      email: teacherEmail,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    const teacherToken = await login(app, teacherEmail, "password-12x");
    const hdrs = headers(teacherToken, school.orgId);
    expect((await app.request("/api/v1/onboarding/mail/templates", { headers: hdrs })).status).toBe(403);
    expect(
      (
        await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received", {
          method: "PUT",
          headers: hdrs,
          body: JSON.stringify({
            subject: "Hello",
            heading: "Hello",
            greeting: "Hello",
            body: "Hello",
            signoff: "Bye",
          }),
        })
      ).status,
    ).toBe(403);
  });

  it("uses org A custom enquiry wording only for org A and leaves org B on the default", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const schoolA = await createSchool(pools.owner, suffix());
    const schoolB = await createSchool(pools.owner, `${suffix()}b`);
    const tokenA = await login(app, schoolA.adminEmail, "password-12x");
    const tokenB = await login(app, schoolB.adminEmail, "password-12x");
    const hdrsA = headers(tokenA, schoolA.orgId);
    const hdrsB = headers(tokenB, schoolB.orgId);
    await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received", {
      method: "PUT",
      headers: hdrsA,
      body: JSON.stringify({
        enabled: true,
        subject: "Custom A {{enquiry_reference}}",
        heading: "Custom enquiry",
        greeting: "Dear {{recipient_first_name}},",
        body: "Org A custom body for {{school_name}}.",
        signoff: "Team A",
      }),
    });
    const formA = await seedAdmissionsForm(app, hdrsA, "enquiry", "enquire-custom");
    const formB = await seedAdmissionsForm(app, hdrsB, "enquiry", "enquire-custom");
    const answers = {
      "child.legal_name": "Maya Cole",
      "child.preferred_name": "Maya",
      "child.date_of_birth": "2018-04-12",
      "guardian.full_name": "Priya Cole",
      "guardian.relationship": "mother",
      "guardian.email": "priya.cole@example.com",
      "guardian.phone": "01234567890",
      "enquiry.notes": "Please send open morning dates",
    };
    const submitA = await app.request("/api/v1/public/admissions/forms/enquiry/enquire-custom/submissions", {
      method: "POST",
      headers: { Host: `${schoolA.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `enq-a-${suffix()}`,
        answers: { ...answers, "child.intended_academic_year_id": formA.yearId, "child.intended_year_group_id": formA.year3 },
      }),
    });
    const submitB = await app.request("/api/v1/public/admissions/forms/enquiry/enquire-custom/submissions", {
      method: "POST",
      headers: { Host: `${schoolB.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `enq-b-${suffix()}`,
        answers: {
          ...answers,
          "guardian.email": "other.parent@example.com",
          "child.intended_academic_year_id": formB.yearId,
          "child.intended_year_group_id": formB.year3,
        },
      }),
    });
    expect(submitA.status).toBe(201);
    expect(submitB.status).toBe(201);
    const queuedA = await listOutbox(pools.owner, schoolA.orgId, "admissions_enquiry_received");
    const queuedB = await listOutbox(pools.owner, schoolB.orgId, "admissions_enquiry_received");
    expect(queuedA.rows).toHaveLength(1);
    expect(queuedB.rows).toHaveLength(1);
    expect(queuedA.rows[0]?.subject).toContain("Custom A");
    expect(queuedA.rows[0]?.body_text).toContain("Org A custom body");
    expect(queuedB.rows[0]?.subject).toContain("Thank you for your enquiry");
    expect(queuedB.rows[0]?.body_text).toContain("We have received your enquiry");
    await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), { id: queuedA.rows[0]!.id });
    await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), { id: queuedB.rows[0]!.id });
    const sentA = email.sent.find((row) => row.to.address === "priya.cole@example.com");
    const sentB = email.sent.find((row) => row.to.address === "other.parent@example.com");
    expect(sentA?.subject).toContain("Custom A");
    expect(sentA?.text).toContain("Org A custom body");
    expect(sentB?.subject).toContain("Thank you for your enquiry");
    expect(sentB?.text).toContain("We have received your enquiry");
    expect(sentB?.text).not.toContain("Org A custom body");
  });

  it("renders a custom application template through the worker and keeps idempotency", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    await app.request("/api/v1/onboarding/mail/templates/admissions_application_received", {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        enabled: true,
        subject: "Custom app {{application_reference}}",
        heading: "Application received",
        greeting: "Hello {{recipient_first_name}},",
        body: "Thanks for {{pupil_first_name}} at {{school_name}}.",
        signoff: "Admissions",
      }),
    });
    const form = await seedAdmissionsForm(app, hdrs, "application", "apply-custom");
    const payload = {
      idempotencyKey: `app-${suffix()}`,
      answers: {
        "child.legal_name": "Maya Cole",
        "child.preferred_name": "Maya",
        "child.date_of_birth": "2018-01-01",
        "child.intended_academic_year_id": form.yearId,
        "child.intended_year_group_id": form.year3,
        guardians: [{ fullName: "Sarah Cole", email: "sarah.cole@example.com", primaryContact: true }],
        declaration_privacy: true,
      },
    };
    const first = await app.request("/api/v1/public/admissions/forms/application/apply-custom/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const second = await app.request("/api/v1/public/admissions/forms/application/apply-custom/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const queued = await listOutbox(pools.owner, school.orgId, "admissions_application_received");
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0]?.idempotency_key).toMatch(/^admissions\.application_received:/);
    await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), { id: queued.rows[0]!.id });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.subject).toContain("Custom app");
    expect(email.sent[0]?.text).toContain("Thanks for Maya at");
    expect(email.sent[0]?.text).toContain("Hello Sarah,");
    expect(email.sent[0]?.html).toContain("Powered by LuvLearn");
  });

  it("falls back to the built-in template when a stored override is corrupt", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    await pools.owner.query(
      `insert into organisation_transactional_email_templates (
         organisation_id, template_key, subject, heading, greeting, body_text, signoff
       ) values ($1, 'admissions_enquiry_received', 'Broken {{unknown_field}}', 'Heading', 'Hello', 'Body {{unknown_field}}', 'Bye')`,
      [school.orgId],
    );
    const form = await seedAdmissionsForm(app, hdrs, "enquiry", "enquire-broken");
    const submit = await app.request("/api/v1/public/admissions/forms/enquiry/enquire-broken/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `enq-broken-${suffix()}`,
        answers: {
          "child.legal_name": "Maya Cole",
          "child.preferred_name": "Maya",
          "child.date_of_birth": "2018-04-12",
          "guardian.full_name": "Priya Cole",
          "guardian.relationship": "mother",
          "guardian.email": "broken.parent@example.com",
          "guardian.phone": "01234567890",
          "enquiry.notes": "Please send open morning dates",
          "child.intended_academic_year_id": form.yearId,
          "child.intended_year_group_id": form.year3,
        },
      }),
    });
    expect(submit.status).toBe(201);
    const queued = await listOutbox(pools.owner, school.orgId, "admissions_enquiry_received");
    expect(queued.rows[0]?.subject).toContain("Thank you for your enquiry");
    await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), { id: queued.rows[0]!.id });
    expect(email.sent[0]?.subject).toContain("Thank you for your enquiry");
    expect(email.sent[0]?.text).toContain("We have received your enquiry");
  });

  it("does not leak templates across tenants", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const other = await createSchool(pools.owner, `${suffix()}x`);
    const token = await login(app, school.adminEmail, "password-12x");
    await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received", {
      method: "PUT",
      headers: headers(token, school.orgId),
      body: JSON.stringify({
        subject: "Secret {{school_name}}",
        heading: "Enquiry received",
        greeting: "Dear {{recipient_first_name}},",
        body: "Secret body",
        signoff: "Bye",
      }),
    });
    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const leaked = await client.query(
        "select id from organisation_transactional_email_templates where organisation_id = $1",
        [other.orgId],
      );
      expect(leaked.rows).toEqual([]);
    });
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const otherList = await app.request("/api/v1/onboarding/mail/templates", {
      headers: headers(otherToken, other.orgId),
    });
    const otherBody = (await otherList.json()) as { templates: Array<{ customised: boolean; subject?: string }> };
    expect(otherBody.templates.every((row) => row.customised === false)).toBe(true);
  });
});
