import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EmailDeliveryError, FakeEmailProvider } from "@schoolapp/core";
import { closePools, withTenantContext } from "@schoolapp/db";
import {
  addMembership,
  ensureMigrated,
  insertUser,
  login,
  testApiConfig,
  testApp,
  testObjectStorage,
  testPools,
} from "./test-helpers";
import { deliverQueuedMail } from "./email-delivery";

const suffix = () => randomUUID().slice(0, 8);

const PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF\n");
const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);
const JPEG_TINY = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb004300100b0c0e0c0a100e0d0e1211101318281a181616183123251d283a333d3c3933383740485c4e404457453738506d51575f626768673e4d71797064785c656763ffd9",
  "hex",
);
const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("word/document.xml extra bytes for office zip sniff"),
]);

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = Uint8Array.from(PNG_1X1);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`ea-${id}`, `EmailAtt ${id}`],
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
    name: `EmailAtt ${id}`,
    adminEmail: `admin-${id}@example.com`,
  };
}

function jsonHeaders(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Organisation-Id": orgId,
  };
}

function authHeaders(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
  };
}

function fileForm(bytes: Uint8Array | Buffer, filename: string, type: string) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), filename);
  return form;
}

type TemplateBody = {
  template: {
    showSchoolLogo: boolean;
    attachments: Array<{
      id: string;
      filename: string;
      contentType: string;
      byteSize: number;
      kindLabel: string;
      sizeLabel: string;
    }>;
    subject: string;
    customised: boolean;
  };
};

async function getTemplate(
  app: ReturnType<typeof testApp>,
  hdrs: Record<string, string>,
  key = "admissions_enquiry_received",
) {
  const res = await app.request(`/api/v1/onboarding/mail/templates/${key}`, { headers: hdrs });
  expect(res.status).toBe(200);
  return (await res.json()) as TemplateBody;
}

async function attachFile(
  app: ReturnType<typeof testApp>,
  hdrs: Record<string, string>,
  key: string,
  bytes: Uint8Array | Buffer,
  filename: string,
  type: string,
) {
  return app.request(`/api/v1/onboarding/mail/templates/${key}/attachments`, {
    method: "POST",
    headers: hdrs,
    body: fileForm(bytes, filename, type),
  });
}

async function seedEnquiryForm(
  app: ReturnType<typeof testApp>,
  hdrs: Record<string, string>,
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
    body: JSON.stringify({ formType: "enquiry", name: "Enquire", slug }),
  });
  if (created.status !== 201) {
    throw new Error(`form create failed ${created.status} ${await created.text()}`);
  }
  const form = (await created.json()) as { form: { id: string } };
  await app.request(`/api/v1/admissions/forms/${form.form.id}/publish`, { method: "POST", headers: hdrs });
  return { yearId: year.academicYear.id, year3 };
}

async function submitEnquiry(
  app: ReturnType<typeof testApp>,
  school: { slug: string },
  slug: string,
  form: { yearId: string; year3: string },
  email: string,
) {
  const submit = await app.request(`/api/v1/public/admissions/forms/enquiry/${slug}/submissions`, {
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
        "guardian.email": email,
        "guardian.phone": "01234567890",
        "enquiry.notes": "Please send a prospectus",
        "child.intended_academic_year_id": form.yearId,
        "child.intended_year_group_id": form.year3,
      },
    }),
  });
  if (submit.status !== 201) {
    throw new Error(`enquiry submit failed ${submit.status} ${await submit.text()}`);
  }
  return submit;
}

describe("automatic email attachments and logo visibility", () => {
  const pools = testPools();

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("defaults logo ON with no attachments and keeps that after a wording reset", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const initial = await getTemplate(app, hdrs);
    expect(initial.template.showSchoolLogo).toBe(true);
    expect(initial.template.attachments).toEqual([]);

    const logo = await app.request("/api/v1/onboarding/branding/logo", {
      method: "POST",
      headers: authHeaders(token, school.orgId),
      body: fileForm(pngHeader(64, 64), "logo.png", "image/png"),
    });
    expect(logo.status).toBe(201);

    const hidden = await app.request(
      "/api/v1/onboarding/mail/templates/admissions_enquiry_received/presentation",
      { method: "PUT", headers: hdrs, body: JSON.stringify({ showSchoolLogo: false }) },
    );
    expect(hidden.status).toBe(200);
    expect(((await hidden.json()) as TemplateBody).template.showSchoolLogo).toBe(false);

    const attached = await attachFile(
      app,
      authHeaders(token, school.orgId),
      "admissions_enquiry_received",
      PDF,
      "Prospectus 2026.pdf",
      "application/pdf",
    );
    expect(attached.status).toBe(201);

    await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received", {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        enabled: true,
        subject: "Custom {{school_name}}",
        heading: "Enquiry received",
        greeting: "Dear {{recipient_first_name}},",
        body: "Custom body",
        signoff: "Team",
      }),
    });
    const reset = await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received", {
      method: "DELETE",
      headers: hdrs,
    });
    expect(reset.status).toBe(200);
    const after = (await reset.json()) as TemplateBody;
    expect(after.template.customised).toBe(false);
    expect(after.template.subject).toContain("Thank you for your enquiry");
    expect(after.template.showSchoolLogo).toBe(false);
    expect(after.template.attachments).toHaveLength(1);
    expect(after.template.attachments[0]?.filename).toBe("Prospectus 2026.pdf");
  });

  it("renders logo ON/OFF in preview without enqueueing mail", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    await app.request("/api/v1/onboarding/branding/logo", {
      method: "POST",
      headers: authHeaders(token, school.orgId),
      body: fileForm(pngHeader(64, 64), "logo.png", "image/png"),
    });
    await attachFile(
      app,
      authHeaders(token, school.orgId),
      "admissions_enquiry_received",
      PDF,
      "Fee Information.pdf",
      "application/pdf",
    );
    const on = await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received/preview", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ showSchoolLogo: true }),
    });
    expect(on.status).toBe(200);
    const onBody = (await on.json()) as {
      html: string;
      queued: boolean;
      attachments: Array<{ filename: string; sizeLabel: string }>;
    };
    expect(onBody.queued).toBe(false);
    expect(onBody.html).toContain("<img");
    expect(onBody.html).toContain("/api/v1/public/branding/logo");
    expect(onBody.attachments[0]?.filename).toBe("Fee Information.pdf");
    expect(onBody.attachments[0]?.sizeLabel).toMatch(/B|KB|MB/);

    const off = await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received/preview", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ showSchoolLogo: false }),
    });
    const offBody = (await off.json()) as { html: string };
    expect(offBody.html).not.toContain("<img");
    expect(offBody.html).toContain(school.name);
    expect(email.sent).toHaveLength(0);
    const queued = await pools.owner.query(
      "select id from mail_outbox where organisation_id = $1",
      [school.orgId],
    );
    expect(queued.rows).toHaveLength(0);
  });

  it("accepts PDF/DOCX/JPEG/PNG and rejects HTML, executables, and traversal filenames", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = authHeaders(token, school.orgId);
    const pdf = await attachFile(
      app,
      hdrs,
      "admissions_enquiry_received",
      PDF,
      "../../etc/passwd.pdf",
      "application/pdf",
    );
    expect(pdf.status).toBe(201);
    const pdfBody = (await pdf.json()) as TemplateBody;
    expect(pdfBody.template.attachments[0]?.filename).toBe("passwd.pdf");
    expect(pdfBody.template.attachments[0]?.kindLabel).toBe("PDF");

    expect(
      (
        await attachFile(
          app,
          hdrs,
          "admissions_enquiry_received",
          DOCX,
          "guide.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
      ).status,
    ).toBe(201);
    expect((await attachFile(app, hdrs, "admissions_enquiry_received", JPEG_TINY, "photo.jpg", "image/jpeg")).status).toBe(
      201,
    );
    expect((await attachFile(app, hdrs, "admissions_enquiry_received", PNG_1X1, "photo.png", "image/png")).status).toBe(
      201,
    );

    const html = await attachFile(
      app,
      hdrs,
      "admissions_enquiry_received",
      Buffer.from("<html><script>alert(1)</script>"),
      "note.html",
      "text/html",
    );
    expect(html.status).toBe(400);
    const exe = await attachFile(app, hdrs, "admissions_enquiry_received", Buffer.from("MZ"), "payload.exe", "application/pdf");
    expect(exe.status).toBe(400);
  });

  it("enforces per-file, total, and count limits before send", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = authHeaders(token, school.orgId);
    const huge = new Uint8Array(5 * 1024 * 1024 + 64);
    huge.set(PDF, 0);
    const oversized = await attachFile(app, hdrs, "admissions_enquiry_received", huge, "huge.pdf", "application/pdf");
    expect(oversized.status).toBe(400);

    const chunk = new Uint8Array(4.2 * 1024 * 1024);
    chunk.set(PDF, 0);
    expect((await attachFile(app, hdrs, "admissions_enquiry_received", chunk, "a.pdf", "application/pdf")).status).toBe(
      201,
    );
    const second = await attachFile(app, hdrs, "admissions_enquiry_received", chunk, "b.pdf", "application/pdf");
    expect(second.status).toBe(400);
    expect(JSON.stringify(await second.json())).toMatch(/too large in total/i);

    const school2 = await createSchool(pools.owner, suffix());
    const token2 = await login(app, school2.adminEmail, "password-12x");
    const hdrs2 = authHeaders(token2, school2.orgId);
    for (let i = 0; i < 5; i += 1) {
      const res = await attachFile(
        app,
        hdrs2,
        "admissions_application_received",
        PDF,
        `doc-${i}.pdf`,
        "application/pdf",
      );
      expect(res.status).toBe(201);
    }
    const sixth = await attachFile(
      app,
      hdrs2,
      "admissions_application_received",
      PDF,
      "doc-5.pdf",
      "application/pdf",
    );
    expect(sixth.status).toBe(400);
  });

  it("isolates attachments and logo settings between organisations and template keys", async () => {
    const app = testApp(pools);
    const schoolA = await createSchool(pools.owner, suffix());
    const schoolB = await createSchool(pools.owner, `${suffix()}b`);
    const tokenA = await login(app, schoolA.adminEmail, "password-12x");
    const tokenB = await login(app, schoolB.adminEmail, "password-12x");
    await attachFile(
      app,
      authHeaders(tokenA, schoolA.orgId),
      "admissions_enquiry_received",
      PDF,
      "OrgA-Prospectus.pdf",
      "application/pdf",
    );
    await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received/presentation", {
      method: "PUT",
      headers: jsonHeaders(tokenA, schoolA.orgId),
      body: JSON.stringify({ showSchoolLogo: false }),
    });
    const b = await getTemplate(app, jsonHeaders(tokenB, schoolB.orgId));
    expect(b.template.showSchoolLogo).toBe(true);
    expect(b.template.attachments).toEqual([]);

    const aApp = await getTemplate(app, jsonHeaders(tokenA, schoolA.orgId), "admissions_application_received");
    expect(aApp.template.attachments).toEqual([]);
    expect(aApp.template.showSchoolLogo).toBe(true);

    const stolen = await app.request(
      `/api/v1/onboarding/mail/templates/admissions_enquiry_received/attachments/${randomUUID()}`,
      { method: "DELETE", headers: authHeaders(tokenB, schoolB.orgId) },
    );
    expect(stolen.status).toBe(404);

    await withTenantContext(pools.app, schoolA.adminId, schoolA.orgId, async (client) => {
      const objectB = await pools.owner.query<{ id: string }>(
        `insert into stored_objects (
           organisation_id, domain, owner_record_id, storage_backend, storage_key,
           original_filename, content_type, byte_size, status
         ) values ($1, 'transactional_email', $1, 'filesystem', $2, 'Guide.pdf', 'application/pdf', 100, 'active')
         returning id`,
        [schoolB.orgId, `org/${schoolB.orgId}/email/attachments/${schoolB.orgId}/${randomUUID()}`],
      );
      await expect(
        client.query(
          `insert into organisation_transactional_email_template_attachments (
             organisation_id, template_key, stored_object_id, display_filename, sort_order
           ) values ($1, 'admissions_enquiry_received', $2, 'Guide.pdf', 1)`,
          [schoolA.orgId, objectB.rows[0]!.id],
        ),
      ).rejects.toThrow();
    });
  });

  it("forbids teachers, parents, and students from configuring attachments", async () => {
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
      const hdrs = authHeaders(token, school.orgId);
      expect((await app.request("/api/v1/onboarding/mail/templates", { headers: jsonHeaders(token, school.orgId) })).status).toBe(
        403,
      );
      expect(
        (
          await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received/attachments", {
            method: "POST",
            headers: hdrs,
            body: fileForm(PDF, "x.pdf", "application/pdf"),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received/presentation", {
            method: "PUT",
            headers: jsonHeaders(token, school.orgId),
            body: JSON.stringify({ showSchoolLogo: false }),
          })
        ).status,
      ).toBe(403);
    }
  });

  it("keeps a shared stored object when only one template association is removed", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const created = await attachFile(
      app,
      authHeaders(token, school.orgId),
      "admissions_enquiry_received",
      PDF,
      "Shared.pdf",
      "application/pdf",
    );
    const enquiry = ((await created.json()) as TemplateBody).template.attachments[0]!;
    const object = await pools.owner.query<{ stored_object_id: string; storage_key: string }>(
      `select a.stored_object_id, so.storage_key
         from organisation_transactional_email_template_attachments a
         join stored_objects so on so.id = a.stored_object_id
        where a.id = $1`,
      [enquiry.id],
    );
    await pools.owner.query(
      `insert into organisation_transactional_email_template_attachments (
         organisation_id, template_key, stored_object_id, display_filename, sort_order
       ) values ($1, 'admissions_application_received', $2, 'Shared.pdf', 0)`,
      [school.orgId, object.rows[0]!.stored_object_id],
    );
    const removed = await app.request(
      `/api/v1/onboarding/mail/templates/admissions_enquiry_received/attachments/${enquiry.id}`,
      { method: "DELETE", headers: authHeaders(token, school.orgId) },
    );
    expect(removed.status).toBe(200);
    const remaining = await getTemplate(app, jsonHeaders(token, school.orgId), "admissions_application_received");
    expect(remaining.template.attachments).toHaveLength(1);
    const stored = await pools.owner.query<{ status: string }>(
      "select status from stored_objects where id = $1",
      [object.rows[0]!.stored_object_id],
    );
    expect(stored.rows[0]?.status).toBe("active");
    expect(await testObjectStorage.objectExists(object.rows[0]!.storage_key)).toBe(true);
  });

  it("sends configured attachments for enquiry emails only and preserves order", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    await attachFile(
      app,
      authHeaders(token, school.orgId),
      "admissions_enquiry_received",
      PDF,
      "Prospectus 2026.pdf",
      "application/pdf",
    );
    await attachFile(
      app,
      authHeaders(token, school.orgId),
      "admissions_enquiry_received",
      PNG_1X1,
      "map.png",
      "image/png",
    );
    await attachFile(
      app,
      authHeaders(token, school.orgId),
      "admissions_application_received",
      PDF,
      "Admissions Guide.pdf",
      "application/pdf",
    );
    const form = await seedEnquiryForm(app, hdrs, "enquire-att");
    await submitEnquiry(app, school, "enquire-att", form, "priya.att@example.com");
    const queued = await pools.owner.query<{ id: string }>(
      `select id from mail_outbox
        where organisation_id = $1 and purpose = 'admissions_enquiry_received'
        order by created_at desc`,
      [school.orgId],
    );
    await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), { id: queued.rows[0]!.id });
    const sent = email.sent.find((row) => row.to.address === "priya.att@example.com");
    expect(sent?.attachments?.map((item) => item.filename)).toEqual(["Prospectus 2026.pdf", "map.png"]);
    expect(sent?.attachments?.[0]?.contentType).toBe("application/pdf");
    expect(Buffer.from(sent?.attachments?.[0]?.content ?? []).subarray(0, 4).toString()).toBe("%PDF");
    expect(sent?.attachments?.some((item) => item.filename === "Admissions Guide.pdf")).toBe(false);
  });

  it("sends application-template attachments without leaking enquiry files", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    await attachFile(
      app,
      authHeaders(token, school.orgId),
      "admissions_enquiry_received",
      PDF,
      "Enquiry Only.pdf",
      "application/pdf",
    );
    await attachFile(
      app,
      authHeaders(token, school.orgId),
      "admissions_application_received",
      PDF,
      "Admissions Guide.pdf",
      "application/pdf",
    );
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
    const year = (await yearRes.json()) as { academicYear: { id: string } };
    await app.request("/api/v1/year-groups/seed", { method: "POST", headers: hdrs, body: "{}" });
    const groups = (await (await app.request("/api/v1/year-groups", { headers: hdrs })).json()) as {
      yearGroups: Array<{ id: string; code: string }>;
    };
    const year3 = groups.yearGroups.find((row) => row.code === "3")!.id;
    const created = await app.request("/api/v1/admissions/forms", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ formType: "application", name: "Apply", slug: "apply-att" }),
    });
    const form = (await created.json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${form.form.id}/publish`, { method: "POST", headers: hdrs });
    const submit = await app.request("/api/v1/public/admissions/forms/application/apply-att/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `app-${suffix()}`,
        answers: {
          "child.legal_name": "Maya Cole",
          "child.preferred_name": "Maya",
          "child.date_of_birth": "2018-01-01",
          "child.intended_academic_year_id": year.academicYear.id,
          "child.intended_year_group_id": year3,
          guardians: [{ fullName: "Sarah Cole", email: "sarah.att@example.com", primaryContact: true }],
          declaration_privacy: true,
        },
      }),
    });
    expect(submit.status).toBe(201);
    const queued = await pools.owner.query<{ id: string }>(
      `select id from mail_outbox where organisation_id = $1 and purpose = 'admissions_application_received'`,
      [school.orgId],
    );
    await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), { id: queued.rows[0]!.id });
    const sent = email.sent.find((row) => row.to.address === "sarah.att@example.com");
    expect(sent?.attachments?.map((item) => item.filename)).toEqual(["Admissions Guide.pdf"]);
    expect(sent?.attachments?.some((item) => item.filename === "Enquiry Only.pdf")).toBe(false);
  });

  it("omits the logo at send time when the template setting is off", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    await app.request("/api/v1/onboarding/branding/logo", {
      method: "POST",
      headers: authHeaders(token, school.orgId),
      body: fileForm(pngHeader(64, 64), "logo.png", "image/png"),
    });
    await app.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received/presentation", {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({ showSchoolLogo: false }),
    });
    const form = await seedEnquiryForm(app, hdrs, "enquire-logo");
    await submitEnquiry(app, school, "enquire-logo", form, "logo.off@example.com");
    const queued = await pools.owner.query<{ id: string }>(
      `select id from mail_outbox where organisation_id = $1 and purpose = 'admissions_enquiry_received'`,
      [school.orgId],
    );
    await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), { id: queued.rows[0]!.id });
    const sent = email.sent.find((row) => row.to.address === "logo.off@example.com");
    expect(sent?.html).not.toContain("<img");
    expect(sent?.html).toContain(school.name);
  });

  it("retries a missing attachment without marking the email sent", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const created = await attachFile(
      app,
      authHeaders(token, school.orgId),
      "admissions_enquiry_received",
      PDF,
      "Missing.pdf",
      "application/pdf",
    );
    const attachment = ((await created.json()) as TemplateBody).template.attachments[0]!;
    const object = await pools.owner.query<{ storage_key: string }>(
      `select so.storage_key
         from organisation_transactional_email_template_attachments a
         join stored_objects so on so.id = a.stored_object_id
        where a.id = $1`,
      [attachment.id],
    );
    await testObjectStorage.deleteObject(object.rows[0]!.storage_key);
    const form = await seedEnquiryForm(app, jsonHeaders(token, school.orgId), "enquire-missing");
    await submitEnquiry(app, school, "enquire-missing", form, "missing.att@example.com");
    const queued = await pools.owner.query<{ id: string; status: string; last_error_code: string | null }>(
      `select id, status, last_error_code from mail_outbox
        where organisation_id = $1 and purpose = 'admissions_enquiry_received'`,
      [school.orgId],
    );
    await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), { id: queued.rows[0]!.id });
    const after = await pools.owner.query<{ status: string; last_error_code: string | null; last_error_redacted: string | null }>(
      "select status, last_error_code, last_error_redacted from mail_outbox where id = $1",
      [queued.rows[0]!.id],
    );
    expect(after.rows[0]?.status).toBe("queued");
    expect(after.rows[0]?.last_error_code).toBe("attachment_unavailable");
    expect(after.rows[0]?.last_error_redacted).not.toContain(object.rows[0]!.storage_key);
    expect(email.sent).toHaveLength(0);
  });

  it("retries an invalid stored object and keeps provider failures on the existing retry path", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const created = await attachFile(
      app,
      authHeaders(token, school.orgId),
      "admissions_enquiry_received",
      PDF,
      "Corrupt.pdf",
      "application/pdf",
    );
    const attachment = ((await created.json()) as TemplateBody).template.attachments[0]!;
    const object = await pools.owner.query<{ storage_key: string }>(
      `select so.storage_key
         from organisation_transactional_email_template_attachments a
         join stored_objects so on so.id = a.stored_object_id
        where a.id = $1`,
      [attachment.id],
    );
    await testObjectStorage.putObject({
      key: object.rows[0]!.storage_key,
      body: Buffer.from("not-a-pdf"),
      contentType: "application/pdf",
    });
    const form = await seedEnquiryForm(app, jsonHeaders(token, school.orgId), "enquire-corrupt");
    await submitEnquiry(app, school, "enquire-corrupt", form, "corrupt.att@example.com");
    const queued = await pools.owner.query<{ id: string }>(
      `select id from mail_outbox where organisation_id = $1 and purpose = 'admissions_enquiry_received'`,
      [school.orgId],
    );
    await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), { id: queued.rows[0]!.id });
    const after = await pools.owner.query<{ status: string; last_error_code: string | null }>(
      "select status, last_error_code from mail_outbox where id = $1",
      [queued.rows[0]!.id],
    );
    expect(after.rows[0]?.status).toBe("queued");
    expect(after.rows[0]?.last_error_code).toBe("attachment_invalid");

    email.failNext = new EmailDeliveryError("retryable", "provider_timeout", "timeout");
    const school2 = await createSchool(pools.owner, suffix());
    const token2 = await login(app, school2.adminEmail, "password-12x");
    const form2 = await seedEnquiryForm(app, jsonHeaders(token2, school2.orgId), "enquire-provider");
    await submitEnquiry(app, school2, "enquire-provider", form2, "provider.fail@example.com");
    const queued2 = await pools.owner.query<{ id: string }>(
      `select id from mail_outbox where organisation_id = $1 and purpose = 'admissions_enquiry_received'`,
      [school2.orgId],
    );
    await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), { id: queued2.rows[0]!.id });
    const after2 = await pools.owner.query<{ status: string; last_error_code: string | null }>(
      "select status, last_error_code from mail_outbox where id = $1",
      [queued2.rows[0]!.id],
    );
    expect(after2.rows[0]?.status).toBe("queued");
    expect(after2.rows[0]?.last_error_code).toBe("provider_timeout");
  });

  it("does not attach automatic-email files to finance or invitation messages", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    await attachFile(
      app,
      authHeaders(token, school.orgId),
      "admissions_enquiry_received",
      PDF,
      "Prospectus.pdf",
      "application/pdf",
    );
    await pools.owner.query(
      `insert into mail_outbox (
         organisation_id, purpose, template_key, to_email, to_name, subject, body_text, status
       ) values ($1, 'finance_invoice_issued', 'finance_invoice_issued', 'payer@example.com', 'Payer', 'Invoice', 'Pay', 'queued')`,
      [school.orgId],
    );
    const queued = await pools.owner.query<{ id: string }>(
      `select id from mail_outbox where organisation_id = $1 and purpose = 'finance_invoice_issued'`,
      [school.orgId],
    );
    await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), { id: queued.rows[0]!.id });
    const sent = email.sent.find((row) => row.to.address === "payer@example.com");
    expect(sent?.attachments).toBeUndefined();
    expect(sent?.html).toContain("invoice");
  });
});
