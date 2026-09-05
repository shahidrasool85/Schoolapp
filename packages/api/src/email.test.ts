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
    name: `Email ${id}`,
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

async function listOutbox(
  owner: ReturnType<typeof testPools>["owner"],
  orgId: string,
  purpose: string,
) {
  return owner.query<{
    id: string;
    status: string;
    to_email: string;
    to_name: string | null;
    subject: string;
    body_text: string;
    metadata: Record<string, unknown> | null;
    idempotency_key: string | null;
    last_error_code: string | null;
  }>(
    `select id, status, to_email, to_name, subject, body_text, metadata, idempotency_key, last_error_code
       from mail_outbox
      where organisation_id = $1 and purpose = $2
      order by created_at desc`,
    [orgId, purpose],
  );
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
    expect(email.sent.filter((row) => row.subject.includes("Application received"))).toHaveLength(0);
    const queuedAcks = await listOutbox(pools.owner, school.orgId, "admissions_application_received");
    expect(queuedAcks.rows).toHaveLength(1);
    expect(queuedAcks.rows[0]?.status).toBe("queued");
    expect(queuedAcks.rows[0]?.last_error_code).toBeNull();
    expect(queuedAcks.rows[0]?.to_email.toLowerCase()).toBe("sarah.cole@example.com");
    expect(queuedAcks.rows[0]?.body_text).toContain(firstBody.submission.applicationReference);
    expect(queuedAcks.rows[0]?.body_text.toLowerCase()).not.toContain("allerg");
    expect(queuedAcks.rows[0]?.idempotency_key).toMatch(/^admissions\.application_received:/);
    const delivered = await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), {
      id: queuedAcks.rows[0]!.id,
    });
    expect(delivered.sent).toBe(1);
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
    const afterFailSubmit = await listOutbox(pools.owner, school.orgId, "admissions_application_received");
    const timeoutTarget = afterFailSubmit.rows.find((row) => row.to_email.toLowerCase() === "helen.hart@example.com");
    expect(timeoutTarget?.status).toBe("queued");
    expect(timeoutTarget?.last_error_code).toBeNull();
    expect(email.sent.filter((row) => row.to.address.toLowerCase() === "helen.hart@example.com")).toHaveLength(0);

    email.failNext = new EmailDeliveryError("retryable", "provider_timeout", "timeout");
    const retryableAttempt = await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), {
      id: timeoutTarget!.id,
    });
    expect(retryableAttempt.sent).toBe(0);
    expect(retryableAttempt.failed).toBe(1);
    const retryable = (await listOutbox(pools.owner, school.orgId, "admissions_application_received")).rows.find(
      (row) => row.id === timeoutTarget!.id,
    );
    expect(retryable?.status).toBe("queued");
    expect(retryable?.last_error_code).toBe("provider_timeout");

    const retried = await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), {
      id: timeoutTarget!.id,
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
    const permanentQueued = (await listOutbox(pools.owner, school.orgId, "admissions_application_received")).rows.find(
      (row) => row.to_email.toLowerCase() === "tom.west@example.com",
    );
    expect(permanentQueued?.status).toBe("queued");
    expect(permanentQueued?.last_error_code).toBeNull();
    email.failNext = new EmailDeliveryError("permanent", "invalid_recipient", "user unknown");
    await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), {
      id: permanentQueued!.id,
    });
    const failed = await listOutbox(pools.owner, school.orgId, "admissions_application_received");
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

    const worker = new FakeEmailProvider();
    const workerApp = testApp(pools, {
      emailDeliveryProvider: worker,
      emailWorkerSecret: "worker-secret-worker-secret",
    });
    const unauthorized = await workerApp.request("/api/v1/internal/mail/deliver", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret-wrong-secret" },
      body: JSON.stringify({ to: "attacker@example.com", html: "<p>hi</p>" }),
    });
    expect(unauthorized.status).toBe(401);
    const delivered = await workerApp.request("/api/v1/internal/mail/deliver?limit=5", {
      method: "POST",
      headers: { Authorization: "Bearer worker-secret-worker-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ to: "attacker@example.com", subject: "spoof", html: "<p>hi</p>" }),
    });
    expect(delivered.status).toBe(200);
    const deliveredBody = (await delivered.json()) as Record<string, unknown>;
    expect(Object.keys(deliveredBody).sort()).toEqual(["failed", "processed", "sent"]);
    expect(JSON.stringify(deliveredBody)).not.toContain("action_url");
    expect(JSON.stringify(deliveredBody)).not.toContain("token=");
    expect(worker.sent.some((row) => row.to.address === "attacker@example.com")).toBe(false);

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

  it("never exposes action_url on the admin outbox list and forbids teachers", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const teacherEmail = `t2-${suffix()}@example.com`;
    const teacherId = await insertUser(pools.owner, {
      email: teacherEmail,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    await app.request("/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: school.adminEmail }),
    });
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const listed = await app.request("/api/v1/onboarding/mail", {
      headers: headers(adminToken, school.orgId),
    });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { messages: Array<Record<string, unknown>> };
    expect(JSON.stringify(body)).not.toContain("action_url");
    expect(JSON.stringify(body)).not.toContain("actionUrl");
    expect(body.messages.some((row) => "action_url" in row || "actionUrl" in row)).toBe(false);
    expect(body.messages[0]?.bodyText).not.toMatch(/token=[A-Za-z0-9_-]{10,}/);
    expect(body.messages.every((row) => typeof row.canRetry === "boolean")).toBe(true);
    const teacherToken = await login(app, teacherEmail, "password-12x");
    const teacherList = await app.request("/api/v1/onboarding/mail", {
      headers: headers(teacherToken, school.orgId),
    });
    expect(teacherList.status).toBe(403);
  });

  it("keeps action_url for retryable failures and wipes it on permanent failure", async () => {
    const email = new FakeEmailProvider();
    email.failNext = new EmailDeliveryError("retryable", "provider_timeout", "timeout token=secret-link");
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    await app.request("/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: school.adminEmail }),
    });
    const retryable = await pools.owner.query<{
      id: string;
      status: string;
      action_url: string | null;
      last_error_redacted: string | null;
    }>(
      `select id, status, action_url, last_error_redacted
       from mail_outbox
       where organisation_id = $1 and purpose = 'password_reset'
       order by created_at desc`,
      [school.orgId],
    );
    expect(retryable.rows[0]?.status).toBe("queued");
    expect(retryable.rows[0]?.action_url).toMatch(/token=/);
    expect(retryable.rows[0]?.last_error_redacted).not.toContain("secret-link");

    email.failNext = new EmailDeliveryError("permanent", "invalid_recipient", "user unknown");
    const retried = await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), {
      id: retryable.rows[0]!.id,
    });
    expect(retried.failed).toBe(1);
    const failed = await pools.owner.query<{ status: string; action_url: string | null }>(
      "select status, action_url from mail_outbox where id = $1",
      [retryable.rows[0]!.id],
    );
    expect(failed.rows[0]?.status).toBe("failed");
    expect(failed.rows[0]?.action_url).toBeNull();
  });

  it("does not send the same queued message twice when two workers run together", async () => {
    const email = new FakeEmailProvider();
    email.failNext = new EmailDeliveryError("retryable", "provider_timeout", "timeout");
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    await app.request("/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: school.adminEmail }),
    });
    const queued = await pools.owner.query<{ id: string }>(
      `select id from mail_outbox
       where organisation_id = $1 and purpose = 'password_reset' and status = 'queued'`,
      [school.orgId],
    );
    const cfg = testApiConfig(pools, { emailDeliveryProvider: email });
    const [first, second] = await Promise.all([
      deliverQueuedMail(cfg, { id: queued.rows[0]!.id }),
      deliverQueuedMail(cfg, { id: queued.rows[0]!.id }),
    ]);
    expect(first.sent + second.sent).toBe(1);
    expect(first.processed + second.processed).toBe(1);
    expect(email.sent).toHaveLength(1);
    const row = await pools.owner.query<{ status: string; action_url: string | null }>(
      "select status, action_url from mail_outbox where id = $1",
      [queued.rows[0]!.id],
    );
    expect(row.rows[0]?.status).toBe("sent");
    expect(row.rows[0]?.action_url).toBeNull();
  });

  it("invalidates a previous invitation token even if the old email is still queued", async () => {
    const email = new FakeEmailProvider();
    email.failNext = new EmailDeliveryError("retryable", "provider_timeout", "timeout");
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
    const slug = `re${suffix()}`;
    const provisioned = await app.request("/api/v1/platform/organisations", {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Reissue School",
        slug,
        adminEmail,
        adminFullName: "School Admin",
      }),
    });
    expect(provisioned.status).toBe(201);
    const first = (await provisioned.json()) as { organisationId: string; invitationToken: string };
    const oldRow = await pools.owner.query<{ id: string; status: string; action_url: string | null }>(
      `select id, status, action_url from mail_outbox
       where organisation_id = $1 and purpose = 'staff_invite'
       order by created_at`,
      [first.organisationId],
    );
    expect(oldRow.rows[0]?.status).toBe("queued");
    expect(oldRow.rows[0]?.action_url).toContain(first.invitationToken);

    const reissued = await app.request(
      `/api/v1/platform/organisations/${first.organisationId}/school-admin-invitation/reissue`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      },
    );
    expect(reissued.status).toBe(201);
    const issued = (await reissued.json()) as { invitationToken: string };
    expect(issued.invitationToken).not.toBe(first.invitationToken);

    const after = await pools.owner.query<{ status: string; action_url: string | null }>(
      "select status, action_url from mail_outbox where id = $1",
      [oldRow.rows[0]!.id],
    );
    expect(after.rows[0]?.status).toBe("cancelled");
    expect(after.rows[0]?.action_url).toBeNull();

    const lateDeliver = await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), {
      id: oldRow.rows[0]!.id,
    });
    expect(lateDeliver.processed).toBe(0);

    const oldAccept = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: first.invitationToken,
        fullName: "School Admin",
        password: "admin-pass-12",
      }),
    });
    expect([400, 404]).toContain(oldAccept.status);

    const accepted = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: issued.invitationToken,
        fullName: "School Admin",
        password: "admin-pass-12",
      }),
    });
    expect(accepted.status).toBe(200);
  });

  it("still enforces reset-token expiry if delivery is delayed", async () => {
    const email = new FakeEmailProvider();
    email.failNext = new EmailDeliveryError("retryable", "provider_timeout", "timeout");
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    await app.request("/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: school.adminEmail }),
    });
    const queued = await pools.owner.query<{ id: string; action_url: string | null }>(
      `select id, action_url from mail_outbox
       where organisation_id = $1 and purpose = 'password_reset'
       order by created_at desc`,
      [school.orgId],
    );
    const token = queued.rows[0]?.action_url?.match(/token=([^&]+)/)?.[1];
    expect(token).toBeTruthy();
    await pools.owner.query(
      `update account_tokens
          set expires_at = now() - interval '1 minute'
        where token_hash = hash_invite_token($1)`,
      [token],
    );
    const delivered = await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), {
      id: queued.rows[0]!.id,
    });
    expect(delivered.sent).toBe(1);
    const reset = await app.request("/api/v1/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "password-11x" }),
    });
    expect([400, 404]).toContain(reset.status);
  });

  it("queues admissions acknowledgement only after a successful canonical final submit", async () => {
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
      body: JSON.stringify({ formType: "application", name: "Apply", slug: "apply-ack" }),
    });
    const form = (await created.json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${form.form.id}/publish`, { method: "POST", headers: hdrs });
    const answers = {
      "child.legal_name": "Maya Cole",
      "child.preferred_name": "Maya",
      "child.date_of_birth": "2018-01-01",
      "child.intended_academic_year_id": year.academicYear.id,
      "child.intended_year_group_id": year3,
      guardians: [{ fullName: "Sarah Cole", email: "sarah.ack@example.com", primaryContact: true }],
      declaration_privacy: true,
    };
    const draft = await app.request("/api/v1/public/admissions/forms/application/apply-ack/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({ draft: true, answers }),
    });
    expect(draft.status).toBe(200);
    expect(email.sent).toHaveLength(0);
    expect((await listOutbox(pools.owner, school.orgId, "admissions_application_received")).rows).toHaveLength(0);

    const failed = await app.request("/api/v1/public/admissions/forms/application/apply-ack/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({ answers: { "child.legal_name": "Nope" } }),
    });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(email.sent).toHaveLength(0);
    expect((await listOutbox(pools.owner, school.orgId, "admissions_application_received")).rows).toHaveLength(0);

    const payload = { idempotencyKey: `ack-${suffix()}`, answers };
    const first = await app.request("/api/v1/public/admissions/forms/application/apply-ack/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const second = await app.request("/api/v1/public/admissions/forms/application/apply-ack/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(201);
    expect(email.sent.filter((row) => row.subject.includes("Application received"))).toHaveLength(0);
    const queued = await listOutbox(pools.owner, school.orgId, "admissions_application_received");
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0]?.status).toBe("queued");
    const delivered = await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), {
      id: queued.rows[0]!.id,
    });
    expect(delivered.sent).toBe(1);
    expect(email.sent.filter((row) => row.subject.includes("Application received"))).toHaveLength(1);
  });

  it("enqueues exactly one enquiry acknowledgement without waiting on SMTP", async () => {
    const email = new FakeEmailProvider();
    const app = testApp(pools, { emailDeliveryProvider: email });
    const school = await createSchool(pools.owner, suffix());
    const other = await createSchool(pools.owner, `${suffix()}x`);
    const token = await login(app, school.adminEmail, "password-12x");
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const otherHdrs = headers(otherToken, other.orgId);
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
      body: JSON.stringify({ formType: "enquiry", name: "Enquire", slug: "enquire-mail" }),
    });
    const form = (await created.json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${form.form.id}/publish`, { method: "POST", headers: hdrs });

    const otherYear = (await (
      await app.request("/api/v1/academic-years", {
        method: "POST",
        headers: otherHdrs,
        body: JSON.stringify({
          name: "2026/27",
          startsOn: "2026-09-01",
          endsOn: "2027-07-31",
          isCurrent: true,
        }),
      })
    ).json()) as { academicYear: { id: string } };
    await app.request("/api/v1/year-groups/seed", { method: "POST", headers: otherHdrs, body: "{}" });
    const otherGroups = (await (await app.request("/api/v1/year-groups", { headers: otherHdrs })).json()) as {
      yearGroups: Array<{ id: string; code: string }>;
    };
    const otherYear3 = otherGroups.yearGroups.find((row) => row.code === "3")!.id;
    const otherForm = await app.request("/api/v1/admissions/forms", {
      method: "POST",
      headers: otherHdrs,
      body: JSON.stringify({ formType: "enquiry", name: "Enquire", slug: "enquire-mail" }),
    });
    const otherFormBody = (await otherForm.json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${otherFormBody.form.id}/publish`, {
      method: "POST",
      headers: otherHdrs,
    });

    const notes = "Please send dates and mention peanut allergy";
    const answers = {
      "child.legal_name": "Maya Cole",
      "child.preferred_name": "Maya",
      "child.date_of_birth": "2018-04-12",
      "child.intended_academic_year_id": year.academicYear.id,
      "child.intended_year_group_id": year3,
      "guardian.full_name": "Priya Cole",
      "guardian.relationship": "mother",
      "guardian.email": "priya.cole@example.com",
      "guardian.phone": "01234567890",
      "enquiry.notes": notes,
    };
    const missingEmail = await app.request("/api/v1/public/admissions/forms/enquiry/enquire-mail/submissions", {
      method: "POST",
      headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: { ...answers, "guardian.email": "" },
      }),
    });
    expect(missingEmail.status).toBeGreaterThanOrEqual(400);
    expect((await listOutbox(pools.owner, school.orgId, "admissions_enquiry_received")).rows).toHaveLength(0);
    const missingEnquiry = await pools.owner.query(
      `select id from admissions_enquiries where organisation_id = $1 and guardian_email = 'priya.cole@example.com'`,
      [school.orgId],
    );
    expect(missingEnquiry.rows).toHaveLength(0);

    const staffCreate = await app.request("/api/v1/admissions/enquiries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        pupilLegalName: "Staff Child",
        guardianFullName: "Staff Parent",
        guardianEmail: "staff.parent@example.com",
        notes: "Internal staff note",
      }),
    });
    expect(staffCreate.status).toBe(201);
    expect((await listOutbox(pools.owner, school.orgId, "admissions_enquiry_received")).rows).toHaveLength(0);

    const logs: string[] = [];
    const originalError = console.error;
    const originalInfo = console.info;
    console.error = (...args: unknown[]) => {
      logs.push(JSON.stringify(args));
    };
    console.info = (...args: unknown[]) => {
      logs.push(JSON.stringify(args));
    };
    const payload = { idempotencyKey: `enq-${suffix()}`, answers };
    let first: Response;
    let second: Response;
    try {
      email.failNext = new EmailDeliveryError("retryable", "provider_timeout", "smtp down");
      first = await app.request("/api/v1/public/admissions/forms/enquiry/enquire-mail/submissions", {
        method: "POST",
        headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      second = await app.request("/api/v1/public/admissions/forms/enquiry/enquire-mail/submissions", {
        method: "POST",
        headers: { Host: `${school.slug}.localhost`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } finally {
      console.error = originalError;
      console.info = originalInfo;
    }
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = (await first.json()) as { submission: { enquiryReference: string } };
    expect(firstBody.submission.enquiryReference).toMatch(/^ENQ-/);
    const enquiryRows = await pools.owner.query<{ id: string }>(
      `select id from admissions_enquiries
        where organisation_id = $1 and guardian_email = 'priya.cole@example.com'`,
      [school.orgId],
    );
    expect(enquiryRows.rows).toHaveLength(1);
    expect(email.sent).toHaveLength(0);
    const queued = await listOutbox(pools.owner, school.orgId, "admissions_enquiry_received");
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0]?.status).toBe("queued");
    expect(queued.rows[0]?.last_error_code).toBeNull();
    expect(queued.rows[0]?.to_email.toLowerCase()).toBe("priya.cole@example.com");
    expect(queued.rows[0]?.to_name).toContain("Priya Cole");
    expect(queued.rows[0]?.subject).toContain(school.name);
    expect(queued.rows[0]?.subject).toContain("Thank you for your enquiry");
    expect(queued.rows[0]?.body_text).toContain("Dear Priya Cole,");
    expect(queued.rows[0]?.body_text).toContain(`Thank you for contacting ${school.name}.`);
    expect(queued.rows[0]?.idempotency_key).toBe(`admissions.enquiry_received:${enquiryRows.rows[0]!.id}`);
    expect(JSON.stringify(queued.rows[0]?.metadata)).toContain(enquiryRows.rows[0]!.id);
    expect(JSON.stringify(queued.rows[0]?.metadata)).toContain(firstBody.submission.enquiryReference);
    expect(JSON.stringify(queued.rows[0])).not.toContain(notes);
    expect(queued.rows[0]?.body_text.toLowerCase()).not.toContain("allerg");
    expect(queued.rows[0]?.body_text.toLowerCase()).not.toContain("2018-04-12");
    expect(queued.rows[0]?.body_text.toLowerCase()).not.toContain("please send dates");
    const joinedLogs = logs.join("\n");
    expect(joinedLogs).not.toContain(notes);
    expect(joinedLogs).not.toContain("2018-04-12");
    expect(joinedLogs).not.toContain("peanut");

    const otherSubmit = await app.request("/api/v1/public/admissions/forms/enquiry/enquire-mail/submissions", {
      method: "POST",
      headers: { Host: `${other.slug}.localhost`, "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `enq-other-${suffix()}`,
        answers: {
          ...answers,
          "child.intended_academic_year_id": otherYear.academicYear.id,
          "child.intended_year_group_id": otherYear3,
          "guardian.email": "other.parent@example.com",
          "guardian.full_name": "Other Parent",
        },
      }),
    });
    expect(otherSubmit.status).toBe(201);
    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const leaked = await client.query("select id from mail_outbox where organisation_id = $1", [other.orgId]);
      expect(leaked.rows).toEqual([]);
    });
    const otherQueued = await listOutbox(pools.owner, other.orgId, "admissions_enquiry_received");
    expect(otherQueued.rows).toHaveLength(1);
    expect(otherQueued.rows[0]?.to_email.toLowerCase()).toBe("other.parent@example.com");
    expect(otherQueued.rows[0]?.subject).toContain(other.name);
    expect(otherQueued.rows[0]?.subject).not.toContain(school.name);

    email.failNext = null;
    const sent = await deliverQueuedMail(testApiConfig(pools, { emailDeliveryProvider: email }), {
      id: queued.rows[0]!.id,
    });
    expect(sent.sent).toBe(1);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.to.address.toLowerCase()).toBe("priya.cole@example.com");
    expect(email.sent[0]?.html).toContain(school.name);
    expect(email.sent[0]?.html).toContain("Priya Cole");
    expect(email.sent[0]?.html).not.toContain(other.name);
    expect(email.sent[0]?.text.toLowerCase()).not.toContain("allerg");
    expect(email.sent[0]?.html).not.toContain(notes);
  });

  it("log-delivers without EMAIL_FROM_ADDRESS instead of burning action_url", async () => {
    const school = await createSchool(pools.owner, suffix());
    const inserted = await pools.owner.query<{ id: string }>(
      `insert into mail_outbox (
         organisation_id, purpose, template_key, to_email, subject, body_text, status, action_url
       ) values ($1, 'staff_invite', 'account_invitation', 'log@example.com', 'Invite', 'Activate', 'queued', $2)
       returning id`,
      [school.orgId, "https://school.test/invite?token=log-secret"],
    );
    const cfg = testApiConfig(pools);
    cfg.emailDeliveryProvider = undefined;
    cfg.email = {
      providerKey: "none",
      deliveryMode: "log",
      fromAddress: null,
      fromName: "LuvLearn",
      replyToFallback: null,
      smtp: { host: null, port: 587, secure: false, username: null, password: null },
    };
    const result = await deliverQueuedMail(cfg, { id: inserted.rows[0]!.id });
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    const row = await pools.owner.query<{ status: string; action_url: string | null }>(
      "select status, action_url from mail_outbox where id = $1",
      [inserted.rows[0]!.id],
    );
    expect(row.rows[0]?.status).toBe("sent");
    expect(row.rows[0]?.action_url).toBeNull();
  });
});
