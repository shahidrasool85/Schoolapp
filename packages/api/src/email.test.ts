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
    [`em-${id}`, `Email ${id}`],
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

describe("transactional email foundation", () => {
  const pools = testPools();

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("queues a school admin invitation once and does not persist the raw token", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const platformEmail = `plat-${suffix()}@example.com`;
    await insertUser(pools.owner, {
      email: platformEmail,
      password: "password-12x",
      fullName: "Platform Admin",
      kind: "platform_admin",
      platformAdmin: true,
    });
    const access = await login(app, platformEmail, "password-12x");
    const adminEmail = `invite-${suffix()}@example.com`;
    const slug = `inv${suffix()}`;
    const provisioned = await app.request("/api/v1/platform/organisations", {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Kingswood Test",
        slug,
        adminEmail,
        adminFullName: "School Admin",
      }),
    });
    expect(provisioned.status).toBe(201);
    const body = (await provisioned.json()) as { organisationId: string; invitationToken: string };
    expect(body.invitationToken).toBeTruthy();
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.text).toContain(body.invitationToken);
    expect(email.sent[0]?.html).toContain("Kingswood Test");
    const rows = await pools.owner.query<{
      purpose: string;
      status: string;
      action_url: string | null;
      body_text: string;
      metadata: Record<string, unknown>;
      idempotency_key: string | null;
    }>(
      "select purpose, status, action_url, body_text, metadata, idempotency_key from mail_outbox where organisation_id = $1",
      [body.organisationId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.purpose).toBe("staff_invite");
    expect(rows.rows[0]?.status).toBe("sent");
    expect(rows.rows[0]?.action_url).toBeNull();
    expect(rows.rows[0]?.body_text).not.toContain(body.invitationToken);
    expect(JSON.stringify(rows.rows[0]?.metadata)).not.toContain(body.invitationToken);
  });

  it("queues a password reset once without revealing whether the account exists", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const unknown = await app.request("/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "missing@example.com" }),
    });
    expect(unknown.status).toBe(200);
    const unknownBody = (await unknown.json()) as { message: string };
    const known = await app.request("/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: school.adminEmail }),
    });
    expect(known.status).toBe(200);
    const knownBody = (await known.json()) as { message: string };
    expect(knownBody.message).toBe(unknownBody.message);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.to.address.toLowerCase()).toBe(school.adminEmail);
    expect(email.sent[0]?.subject.toLowerCase()).toContain("password reset");
    const stored = await pools.owner.query<{ body_text: string; action_url: string | null }>(
      "select body_text, action_url from mail_outbox where organisation_id = $1 and purpose = 'password_reset'",
      [school.orgId],
    );
    expect(stored.rows[0]?.action_url).toBeNull();
    expect(stored.rows[0]?.body_text).not.toMatch(/token=[A-Za-z0-9_-]{10,}/);
  });

  it("queues one admissions acknowledgement and ignores duplicate submits and provider failure", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
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
    const year3 = groups.yearGroups.find((row) => row.code === "3")!.id;
    const created = await app.request("/api/v1/admissions/forms", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ formType: "application", name: "Apply", slug: "apply-mail" }),
    });
    const form = (await created.json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${form.form.id}/publish`, { method: "POST", headers: hdrs });
    const published = await app.request("/api/v1/public/admissions/forms/application/apply-mail", {
      headers: { Host: `${school.slug}.localhost` },
    });
    expect(published.status).toBe(200);
    const publishedBody = (await published.json()) as { organisation: { id?: string; name: string; countryCode?: string } };
    expect(publishedBody.organisation.id).toBeUndefined();
    expect(JSON.stringify(publishedBody)).not.toContain(school.orgId);
    expect(publishedBody.organisation.countryCode).toBeTruthy();

    const payload = {
      idempotencyKey: `dup-${suffix()}`,
      answers: {
        "child.legal_name": "Maya Cole",
        "child.preferred_name": "Maya",
        "child.date_of_birth": "2018-01-01",
        "child.intended_academic_year_id": year.academicYear.id,
        "child.intended_year_group_id": year3,
        guardians: [{ fullName: "Sarah Cole", email: "sarah.cole@example.com", primaryContact: true }],
        declaration_privacy: true,
      },
    };
    const first = await app.request("/api/v1/public/admissions/forms/application/apply-mail/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { submission: { applicationReference: string } };
    expect(firstBody.submission.applicationReference).toMatch(/^APP-/);
    const second = await app.request("/api/v1/public/admissions/forms/application/apply-mail/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(201);
    const acks = email.sent.filter((row) => row.subject.includes("Application received"));
    expect(acks).toHaveLength(1);
    expect(acks[0]?.text).toContain(firstBody.submission.applicationReference);
    expect(acks[0]?.text.toLowerCase()).not.toContain("allerg");
    expect(acks[0]?.html).not.toContain(school.orgId);

    email.failNext = new EmailDeliveryError("retryable", "provider_timeout", "timeout");
    const failing = await app.request("/api/v1/public/admissions/forms/application/apply-mail/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `fail-${suffix()}`,
        answers: {
          ...payload.answers,
          "child.legal_name": "Owen Hart",
          guardians: [{ fullName: "Helen Hart", email: "helen.hart@example.com", primaryContact: true }],
        },
      }),
    });
    expect(failing.status).toBe(201);
    const queued = await pools.owner.query<{
      id: string;
      status: string;
      last_error_code: string | null;
      action_url: string | null;
    }>(
      `select id, status, last_error_code, action_url
       from mail_outbox
       where organisation_id = $1 and purpose = 'admissions_application_received'
       order by created_at desc`,
      [school.orgId],
    );
    const retryable = queued.rows.find((row) => row.status === "queued" && row.last_error_code === "provider_timeout");
    expect(retryable).toBeTruthy();

    const retried = await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), {
      id: retryable!.id,
    });
    expect(retried.sent).toBe(1);
    email.failNext = new EmailDeliveryError("permanent", "invalid_recipient", "user unknown");
    const permanentSubmit = await app.request("/api/v1/public/admissions/forms/application/apply-mail/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `perm-${suffix()}`,
        answers: {
          ...payload.answers,
          "child.legal_name": "Ivy West",
          guardians: [{ fullName: "Tom West", email: "tom.west@example.com", primaryContact: true }],
        },
      }),
    });
    expect(permanentSubmit.status).toBe(201);
    const failed = await pools.owner.query<{ status: string; last_error_code: string | null }>(
      `select status, last_error_code from mail_outbox
       where organisation_id = $1 and purpose = 'admissions_application_received'
       order by created_at desc`,
      [school.orgId],
    );
    expect(failed.rows.some((row) => row.status === "failed" && row.last_error_code === "invalid_recipient")).toBe(
      true,
    );
  });

  it("keeps mail_outbox tenant-isolated and forbids teachers from the preview", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const other = await createSchool(pools.owner, `${suffix()}x`);
    const teacherEmail = `t-${suffix()}@example.com`;
    const teacherId = await insertUser(pools.owner, {
      email: teacherEmail,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const teacherToken = await login(app, teacherEmail, "password-12x");
    const preview = await app.request("/api/v1/onboarding/mail/preview?template=account_invitation", {
      headers: headers(adminToken, school.orgId),
    });
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { html: string; text: string; fixture: boolean };
    expect(previewBody.fixture).toBe(true);
    expect(previewBody.html).toContain("Kingswood School");
    expect(previewBody.text).not.toMatch(/token=[A-Za-z0-9_-]{16,}/);

    const teacherPreview = await app.request("/api/v1/onboarding/mail/preview?template=password_reset", {
      headers: headers(teacherToken, school.orgId),
    });
    expect(teacherPreview.status).toBe(403);

    const openRelay = await app.request("/api/v1/onboarding/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "anyone@example.com", subject: "hi", html: "<p>x</p>" }),
    });
    expect([404, 401, 405]).toContain(openRelay.status);

    const internal = await app.request("/api/v1/internal/mail/deliver", { method: "POST" });
    expect(internal.status).toBe(404);

    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const leaked = await client.query("select id from mail_outbox where organisation_id = $1", [other.orgId]);
      expect(leaked.rows).toEqual([]);
      await expect(client.query("select action_url from mail_outbox")).rejects.toThrow();
    });
  });

  it("does not leak branding or recipients across tenants", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const platformEmail = `plat-${suffix()}@example.com`;
    await insertUser(pools.owner, {
      email: platformEmail,
      password: "password-12x",
      fullName: "Platform Admin",
      kind: "platform_admin",
      platformAdmin: true,
    });
    const access = await login(app, platformEmail, "password-12x");
    const firstSlug = `kw${suffix()}`;
    const secondSlug = `rv${suffix()}`;
    const first = await app.request("/api/v1/platform/organisations", {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Kingswood School",
        slug: firstSlug,
        adminEmail: `kw-admin-${suffix()}@example.com`,
        adminFullName: "Kingswood Admin",
      }),
    });
    const second = await app.request("/api/v1/platform/organisations", {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Riverside School",
        slug: secondSlug,
        adminEmail: `rv-admin-${suffix()}@example.com`,
        adminFullName: "Riverside Admin",
      }),
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const kingswood = email.sent.find((row) => row.html.includes("Kingswood School"));
    const riverside = email.sent.find((row) => row.html.includes("Riverside School"));
    expect(kingswood).toBeTruthy();
    expect(riverside).toBeTruthy();
    expect(kingswood?.html).not.toContain("Riverside School");
    expect(riverside?.html).not.toContain("Kingswood School");
    expect(kingswood?.to.address).not.toBe(riverside?.to.address);
  });
});
