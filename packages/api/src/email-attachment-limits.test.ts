import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeEmailProvider } from "@schoolapp/core";
import { closePools } from "@schoolapp/db";
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
const PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF\n");
const DEFAULTS = {
  maxBytes: 7 * 1024 * 1024,
  maxTotal: 7 * 1024 * 1024,
  maxCount: 5,
};

describe("B3.1 platform automatic email attachment limits", () => {
  const pools = testPools();

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterEach(async () => {
    await restoreDefaults();
  });

  afterAll(async () => {
    await restoreDefaults();
    await closePools(pools);
  });

  async function restoreDefaults() {
    await pools.owner.query(
      `update platform_settings
          set transactional_email_attachment_max_bytes = $1,
              transactional_email_attachments_max_total_bytes = $2,
              transactional_email_attachments_max_count = $3,
              updated_by_user_id = null
        where id = 1`,
      [DEFAULTS.maxBytes, DEFAULTS.maxTotal, DEFAULTS.maxCount],
    );
  }

  async function createSchool(id: string) {
    const adminId = await insertUser(pools.owner, {
      email: `admin-${id}@example.com`,
      password: "password-12x",
      fullName: "Admin",
      kind: "staff",
    });
    const org = await pools.owner.query<{ id: string; slug: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
      [`lim-${id}`, `Limits ${id}`],
    );
    await pools.owner.query(
      "insert into organisation_settings (organisation_id, contact_email) values ($1, $2)",
      [org.rows[0]!.id, `office-${id}@school.test`],
    );
    await addMembership(pools.owner, org.rows[0]!.id, adminId, "school.admin");
    return {
      orgId: org.rows[0]!.id,
      slug: org.rows[0]!.slug,
      adminEmail: `admin-${id}@example.com`,
    };
  }

  async function platformSession() {
    const id = suffix();
    const email = `platform-lim-${id}@example.com`;
    await insertUser(pools.owner, {
      email,
      password: "platform-pass-1",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    const app = testApp(pools);
    const token = await login(app, email, "platform-pass-1");
    return { app, token, email };
  }

  it("exposes default Postmark-safe 7 MB / 7 MB / 5 limits to School Admin and Platform Admin", async () => {
    const { app, token } = await platformSession();
    const settings = await app.request("/api/v1/platform/settings", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(settings.status).toBe(200);
    const body = (await settings.json()) as {
      automaticEmailAttachments: {
        maxBytesPerFile: number;
        maxTotalBytes: number;
        maxCount: number;
        hardCapMegabytesPerFile: number;
        applicationCapMegabytesPerFile: number;
        providerLimitSummary: string;
        provider: { key: string; recommendedMaxRawAttachmentMegabytes: number };
      };
    };
    expect(body.automaticEmailAttachments.maxBytesPerFile).toBe(7 * 1024 * 1024);
    expect(body.automaticEmailAttachments.maxTotalBytes).toBe(7 * 1024 * 1024);
    expect(body.automaticEmailAttachments.maxCount).toBe(5);
    expect(body.automaticEmailAttachments.hardCapMegabytesPerFile).toBe(7);
    expect(body.automaticEmailAttachments.applicationCapMegabytesPerFile).toBe(25);
    expect(body.automaticEmailAttachments.provider.key).toBe("postmark");
    expect(body.automaticEmailAttachments.providerLimitSummary).toMatch(/7 MB total attachments/);

    const school = await createSchool(suffix());
    const schoolApp = testApp(pools);
    const schoolToken = await login(schoolApp, school.adminEmail, "password-12x");
    const template = await schoolApp.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received", {
      headers: {
        Authorization: `Bearer ${schoolToken}`,
        "X-Organisation-Id": school.orgId,
      },
    });
    const templateBody = (await template.json()) as {
      template: { attachmentLimits: { maxBytesPerFile: number; maxCount: number } };
    };
    expect(templateBody.template.attachmentLimits.maxBytesPerFile).toBe(7 * 1024 * 1024);
    expect(templateBody.template.attachmentLimits.maxCount).toBe(5);
  });

  it("lets Platform Admin change valid limits and rejects School Admin, hard caps, zero, and total below per-file", async () => {
    const { app, token } = await platformSession();
    const saved = await app.request("/api/v1/platform/settings/email-attachments", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ maxMegabytesPerFile: 5, maxTotalMegabytes: 7, maxCount: 8 }),
    });
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as {
      automaticEmailAttachments: { maxMegabytesPerFile: number; maxCount: number };
    };
    expect(savedBody.automaticEmailAttachments.maxMegabytesPerFile).toBe(5);
    expect(savedBody.automaticEmailAttachments.maxCount).toBe(8);

    const overCap = await app.request("/api/v1/platform/settings/email-attachments", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ maxMegabytesPerFile: 15, maxTotalMegabytes: 20, maxCount: 5 }),
    });
    expect(overCap.status).toBe(400);
    expect(JSON.stringify(await overCap.json())).toMatch(/cannot exceed 7 MB/i);

    const zero = await app.request("/api/v1/platform/settings/email-attachments", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ maxMegabytesPerFile: 0, maxTotalMegabytes: 7, maxCount: 5 }),
    });
    expect(zero.status).toBe(400);

    const negative = await app.request("/api/v1/platform/settings/email-attachments", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ maxMegabytesPerFile: -2, maxTotalMegabytes: 7, maxCount: 5 }),
    });
    expect(negative.status).toBe(400);

    const inverted = await app.request("/api/v1/platform/settings/email-attachments", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ maxMegabytesPerFile: 7, maxTotalMegabytes: 5, maxCount: 5 }),
    });
    expect(inverted.status).toBe(400);
    expect(JSON.stringify(await inverted.json())).toMatch(/at least the per-file/i);

    const school = await createSchool(suffix());
    const schoolApp = testApp(pools);
    const schoolToken = await login(schoolApp, school.adminEmail, "password-12x");
    const schoolPut = await schoolApp.request("/api/v1/platform/settings/email-attachments", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${schoolToken}`,
        "Content-Type": "application/json",
        "X-Organisation-Id": school.orgId,
        Host: `${school.slug}.localhost`,
      },
      body: JSON.stringify({ maxMegabytesPerFile: 7, maxTotalMegabytes: 7, maxCount: 5 }),
    });
    expect(schoolPut.status).toBe(404);

    const schoolOnPlatform = await schoolApp.request("/api/v1/platform/settings/email-attachments", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${schoolToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maxMegabytesPerFile: 7, maxTotalMegabytes: 7, maxCount: 5 }),
    });
    expect(schoolOnPlatform.status).toBe(403);
  });

  it("uploads just under the live limit and rejects over-limit files with a filename message", async () => {
    const { app, token } = await platformSession();
    await app.request("/api/v1/platform/settings/email-attachments", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ maxMegabytesPerFile: 1, maxTotalMegabytes: 1, maxCount: 5 }),
    });
    const school = await createSchool(suffix());
    const schoolApp = testApp(pools);
    const schoolToken = await login(schoolApp, school.adminEmail, "password-12x");
    const hdrs = {
      Authorization: `Bearer ${schoolToken}`,
      "X-Organisation-Id": school.orgId,
    };
    const under = new Uint8Array(1024 * 1024 - 10);
    under.set(PDF, 0);
    const form = new FormData();
    form.append("file", new Blob([under], { type: "application/pdf" }), "Guide.pdf");
    const ok = await schoolApp.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received/attachments", {
      method: "POST",
      headers: hdrs,
      body: form,
    });
    expect(ok.status).toBe(201);

    const over = new Uint8Array(Math.round(1.5 * 1024 * 1024));
    over.set(PDF, 0);
    const overForm = new FormData();
    overForm.append("file", new Blob([over], { type: "application/pdf" }), "Brochure.pdf");
    const rejected = await schoolApp.request(
      "/api/v1/onboarding/mail/templates/admissions_enquiry_received/attachments",
      { method: "POST", headers: hdrs, body: overForm },
    );
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(await rejected.json())).toMatch(/Brochure\.pdf is 1\.5 MB\. The maximum attachment size is 1 MB\./);

    const second = new Uint8Array(PDF);
    const secondForm = new FormData();
    secondForm.append("file", new Blob([second], { type: "application/pdf" }), "Fees.pdf");
    const totalRejected = await schoolApp.request(
      "/api/v1/onboarding/mail/templates/admissions_enquiry_received/attachments",
      { method: "POST", headers: hdrs, body: secondForm },
    );
    expect(totalRejected.status).toBe(400);
    expect(JSON.stringify(await totalRejected.json())).toMatch(/too large in total|maximum total/i);
  });

  it("keeps existing attachments when the platform limit is lowered, marks them over-limit, and does not send", async () => {
    const email = new FakeEmailProvider();
    const schoolApp = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(suffix());
    const schoolToken = await login(schoolApp, school.adminEmail, "password-12x");
    const hdrs = {
      Authorization: `Bearer ${schoolToken}`,
      "X-Organisation-Id": school.orgId,
    };
    const form = new FormData();
    form.append("file", new Blob([PDF], { type: "application/pdf" }), "Prospectus.pdf");
    const attached = await schoolApp.request(
      "/api/v1/onboarding/mail/templates/admissions_enquiry_received/attachments",
      { method: "POST", headers: hdrs, body: form },
    );
    expect(attached.status).toBe(201);

    await pools.owner.query(
      `update platform_settings
          set transactional_email_attachment_max_bytes = 10,
              transactional_email_attachments_max_total_bytes = 10
        where id = 1`,
    );
    const listed = await schoolApp.request("/api/v1/onboarding/mail/templates/admissions_enquiry_received", {
      headers: hdrs,
    });
    const listedBody = (await listed.json()) as {
      template: { attachments: Array<{ filename: string; overLimit: boolean; overLimitReason: string | null }> };
    };
    expect(listedBody.template.attachments).toHaveLength(1);
    expect(listedBody.template.attachments[0]?.filename).toBe("Prospectus.pdf");
    expect(listedBody.template.attachments[0]?.overLimit).toBe(true);
    expect(listedBody.template.attachments[0]?.overLimitReason).toMatch(/over the current maximum/i);

    const remaining = await pools.owner.query(
      `select count(*)::int as n from organisation_transactional_email_template_attachments
        where organisation_id = $1`,
      [school.orgId],
    );
    expect(Number(remaining.rows[0]?.n)).toBe(1);

    await pools.owner.query(
      `insert into mail_outbox (
         organisation_id, purpose, template_key, to_email, to_name, subject, body_text, status
       ) values ($1, 'admissions_enquiry_received', 'admissions_enquiry_received', 'parent@example.com', 'Parent', 'Thanks', 'Hello', 'queued')`,
      [school.orgId],
    );
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
    expect(after.rows[0]?.last_error_code).toBe("attachment_too_large");
    expect(email.sent).toHaveLength(0);
  });

  it("does not let Platform Admin save SES-sized limits while Postmark capability is active", async () => {
    const { app, token } = await platformSession();
    const settings = await app.request("/api/v1/platform/settings", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(((await settings.json()) as { automaticEmailAttachments: { hardCapMegabytesPerFile: number } })
      .automaticEmailAttachments.hardCapMegabytesPerFile).toBe(7);
  });

  it("allows a larger configured value only when the SMTP host is SES-capable", async () => {
    const id = suffix();
    const email = `platform-ses-${id}@example.com`;
    await insertUser(pools.owner, {
      email,
      password: "platform-pass-1",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    const app = testApp(pools, {
      email: { smtp: { host: "email-smtp.eu-west-1.amazonaws.com" } },
    });
    const token = await login(app, email, "platform-pass-1");
    const saved = await app.request("/api/v1/platform/settings/email-attachments", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ maxMegabytesPerFile: 15, maxTotalMegabytes: 20, maxCount: 5 }),
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as {
      automaticEmailAttachments: {
        maxMegabytesPerFile: number;
        maxTotalMegabytes: number;
        hardCapMegabytesPerFile: number;
        provider: { key: string };
      };
    };
    expect(body.automaticEmailAttachments.maxMegabytesPerFile).toBe(15);
    expect(body.automaticEmailAttachments.maxTotalMegabytes).toBe(20);
    expect(body.automaticEmailAttachments.hardCapMegabytesPerFile).toBe(25);
    expect(body.automaticEmailAttachments.provider.key).toBe("ses");
    const overApp = await app.request("/api/v1/platform/settings/email-attachments", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ maxMegabytesPerFile: 26, maxTotalMegabytes: 26, maxCount: 5 }),
    });
    expect(overApp.status).toBe(400);
  });
});
