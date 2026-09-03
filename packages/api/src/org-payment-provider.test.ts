import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withTenantContext } from "@schoolapp/db";
import { payloadContainsSecret } from "@schoolapp/core";
import {
  addMembership,
  ensureMigrated,
  insertUser,
  login,
  testApp,
  testPools,
} from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);

type StripeCall = { url: string; auth: string | null; body: string };

function stripeSignature(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
    [`opp-${id}`, `OrgPay ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return { adminId, orgId: org.rows[0]!.id, slug: `opp-${id}`, adminEmail: `admin-${id}@example.com` };
}

function headers(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    "Content-Type": "application/json",
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
  return { yearId: year.academicYear.id, yearGroupId: groups.yearGroups.find((group) => group.code === "2")!.id };
}

async function createStudent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  input: { legalName: string; academicYearId: string; yearGroupId: string },
) {
  const created = await app.request("/api/v1/students", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(input),
  });
  expect(created.status).toBe(201);
  return (await created.json()) as { student: { id: string } };
}

async function inviteParent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  studentId: string,
  email: string,
) {
  const created = await app.request(`/api/v1/students/${studentId}/guardians`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      email,
      fullName: "Pat Parent",
      relationship: "mother",
      portalAccess: true,
      hasParentalResponsibility: true,
    }),
  });
  const guardian = (await created.json()) as { invitationToken: string | null };
  if (guardian.invitationToken) {
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: guardian.invitationToken, fullName: "Pat Parent", password: "parent-pass-1" }),
    });
  }
}

async function issueInvoice(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  input: { yearId: string },
) {
  expect(
    (
      await app.request("/api/v1/finance/settings", {
        method: "PATCH",
        headers: hdrs,
        body: JSON.stringify({ tuitionEnabled: true, defaultBillingFrequency: "monthly" }),
      })
    ).status,
  ).toBe(200);
  const schedule = await app.request("/api/v1/finance/fee-schedules", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      name: "Monthly £600",
      academicYearId: input.yearId,
      amountMinor: 60000,
      billingFrequency: "monthly",
      effectiveFrom: "2026-01-01",
    }),
  });
  expect(schedule.status).toBe(201);
  const preview = await app.request("/api/v1/finance/billing-runs/preview", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      academicYearId: input.yearId,
      frequency: "monthly",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      dueOn: "2026-09-15",
    }),
  });
  expect(preview.status).toBe(201);
  const run = (await preview.json()) as { run: { id: string } };
  expect((await app.request(`/api/v1/finance/billing-runs/${run.run.id}/confirm`, { method: "POST", headers: hdrs, body: "{}" })).status).toBe(200);
  const invoices = (await (await app.request("/api/v1/finance/invoices", { headers: hdrs })).json()) as {
    invoices: Array<{ id: string }>;
  };
  return invoices.invoices[0]!;
}

async function saveStripe(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  input: { secretKey: string; webhookSecret: string; mode?: "test" | "live"; enabled?: boolean },
) {
  const saved = await app.request("/api/v1/finance/payment-provider", {
    method: "PUT",
    headers: hdrs,
    body: JSON.stringify({
      mode: input.mode ?? "test",
      secretKey: input.secretKey,
      webhookSecret: input.webhookSecret,
      enabled: input.enabled,
    }),
  });
  expect(saved.status).toBe(200);
  return (await saved.json()) as {
    paymentProvider: {
      webhookEndpointId: string;
      webhookPath: string;
      secretKeyHint: string | null;
      enabled: boolean;
      connectionStatus: string;
    };
  };
}

function checkoutEvent(input: { eventId: string; sessionId: string; paymentId: string; amountMinor: number }) {
  return {
    id: input.eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: input.sessionId,
        payment_status: "paid",
        payment_intent: input.paymentId,
        amount_total: input.amountMinor,
        currency: "gbp",
      },
    },
  };
}

describe("per-school Stripe configuration", () => {
  const pools = testPools();
  const calls: StripeCall[] = [];
  const app = testApp(pools, {
    stripeFetchImpl: (async (url, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({
        url: String(url),
        auth: headers?.Authorization ?? null,
        body: String(init?.body ?? ""),
      });
      if (String(url).includes("/v1/account")) {
        const auth = headers?.Authorization ?? "";
        if (auth.includes("sk_test_bad")) {
          return { ok: false, status: 401, json: async () => ({ error: { message: "invalid" } }) } as Response;
        }
        const school = auth.includes("sk_test_school_b") ? "School B" : "School A";
        const accountId = auth.includes("sk_test_school_b") ? "acct_b" : "acct_a";
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: accountId, business_profile: { name: school } }),
        } as Response;
      }
      if (String(url).includes("/v1/refunds")) {
        return { ok: true, status: 200, json: async () => ({ id: "re_test_1", status: "succeeded" }) } as Response;
      }
      const auth = headers?.Authorization ?? "";
      const id = auth.includes("sk_test_school_b") ? "cs_b" : "cs_a";
      return {
        ok: true,
        status: 200,
        json: async () => ({ id, url: `https://checkout.stripe.test/${id}`, payment_intent: `pi_${id}` }),
      } as Response;
    }) as typeof fetch,
  });

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("isolates Stripe config, checkout, webhooks, refunds and audit between schools", async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, `a-${id}`);
    const schoolB = await createSchool(pools.owner, `b-${id}`);
    const tokenA = await login(app, schoolA.adminEmail, "password-12x");
    const tokenB = await login(app, schoolB.adminEmail, "password-12x");
    const hdrsA = headers(tokenA, schoolA.orgId);
    const hdrsB = headers(tokenB, schoolB.orgId);

    const empty = (await (await app.request("/api/v1/finance/payment-provider", { headers: hdrsA })).json()) as {
      paymentProvider: { connectionStatus: string; secretKeyConfigured: boolean };
    };
    expect(empty.paymentProvider.connectionStatus).toBe("not_configured");
    expect(empty.paymentProvider.secretKeyConfigured).toBe(false);

    const mismatch = await app.request("/api/v1/finance/payment-provider", {
      method: "PUT",
      headers: hdrsA,
      body: JSON.stringify({ mode: "live", secretKey: "sk_test_school_a_aaaaaaaa", webhookSecret: "whsec_school_a" }),
    });
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as { error: { code: string } }).error.code).toBe("test_live_mismatch");

    const savedA = await saveStripe(app, hdrsA, {
      secretKey: "sk_test_school_a_aaaaaaaa",
      webhookSecret: "whsec_school_a",
      enabled: true,
    });
    const savedB = await saveStripe(app, hdrsB, {
      secretKey: "sk_test_school_b_bbbbbbbb",
      webhookSecret: "whsec_school_b",
      enabled: true,
    });
    expect(savedA.paymentProvider.secretKeyHint).toBe("sk_test_••••aaaa");
    expect(savedA.paymentProvider.webhookEndpointId).not.toBe(savedB.paymentProvider.webhookEndpointId);

    const gotA = await app.request("/api/v1/finance/payment-provider", { headers: hdrsA });
    const bodyA = await gotA.json();
    expect(JSON.stringify(bodyA)).not.toContain("sk_test_school_a");
    expect(JSON.stringify(bodyA)).not.toContain("whsec_school_a");
    expect(JSON.stringify(bodyA)).not.toContain("encrypted_secret");

    const crossGet = await app.request("/api/v1/finance/payment-provider", {
      headers: headers(tokenA, schoolB.orgId),
    });
    expect(crossGet.status).toBe(403);
    const crossUpdate = await app.request("/api/v1/finance/payment-provider", {
      method: "PUT",
      headers: headers(tokenA, schoolB.orgId),
      body: JSON.stringify({ secretKey: "sk_test_stolen_key_xxxx", webhookSecret: "whsec_stolen" }),
    });
    expect(crossUpdate.status).toBe(403);

    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, schoolA.orgId, teacherId, "school.teacher");
    const teacherToken = await login(app, `teacher-${id}@example.com`, "password-12x");
    expect((await app.request("/api/v1/finance/payment-provider", { headers: headers(teacherToken, schoolA.orgId) })).status).toBe(403);
    expect(
      (
        await app.request("/api/v1/finance/payment-provider", {
          method: "PUT",
          headers: headers(teacherToken, schoolA.orgId),
          body: JSON.stringify({ secretKey: "sk_test_teacher", webhookSecret: "whsec_teacher" }),
        })
      ).status,
    ).toBe(403);

    const yearA = await seedYear(app, hdrsA);
    const yearB = await seedYear(app, hdrsB);
    const pupilA = await createStudent(app, hdrsA, { legalName: "Child A", academicYearId: yearA.yearId, yearGroupId: yearA.yearGroupId });
    const pupilB = await createStudent(app, hdrsB, { legalName: "Child B", academicYearId: yearB.yearId, yearGroupId: yearB.yearGroupId });
    await inviteParent(app, hdrsA, pupilA.student.id, `parent-a-${id}@example.com`);
    await inviteParent(app, hdrsB, pupilB.student.id, `parent-b-${id}@example.com`);
    const invoiceA = await issueInvoice(app, hdrsA, { yearId: yearA.yearId });
    const invoiceB = await issueInvoice(app, hdrsB, { yearId: yearB.yearId });
    const parentA = await login(app, `parent-a-${id}@example.com`, "parent-pass-1");
    const parentB = await login(app, `parent-b-${id}@example.com`, "parent-pass-1");

    calls.length = 0;
    const payA = await app.request(`/api/v1/parent/finance/invoices/${invoiceA.id}/checkout`, {
      method: "POST",
      headers: headers(parentA, schoolA.orgId),
      body: JSON.stringify({ idempotencyKey: `pay-a-${id}` }),
    });
    expect(payA.status).toBe(200);
    const payB = await app.request(`/api/v1/parent/finance/invoices/${invoiceB.id}/checkout`, {
      method: "POST",
      headers: headers(parentB, schoolB.orgId),
      body: JSON.stringify({ idempotencyKey: `pay-b-${id}` }),
    });
    expect(payB.status).toBe(200);
    expect(calls.some((call) => call.auth === "Bearer sk_test_school_a_aaaaaaaa" && call.url.includes("/v1/checkout/sessions"))).toBe(true);
    expect(calls.some((call) => call.auth === "Bearer sk_test_school_b_bbbbbbbb" && call.url.includes("/v1/checkout/sessions"))).toBe(true);

    const sessionA = await pools.owner.query<{ provider_session_id: string; amount_minor: string }>(
      `select provider_session_id, amount_minor::text from school_payment_sessions
        where organisation_id = $1 and invoice_id = $2 order by created_at desc limit 1`,
      [schoolA.orgId, invoiceA.id],
    );
    const sessionB = await pools.owner.query<{ provider_session_id: string; amount_minor: string }>(
      `select provider_session_id, amount_minor::text from school_payment_sessions
        where organisation_id = $1 and invoice_id = $2 order by created_at desc limit 1`,
      [schoolB.orgId, invoiceB.id],
    );

    const eventA = checkoutEvent({
      eventId: `evt_a_${id}`,
      sessionId: sessionA.rows[0]!.provider_session_id,
      paymentId: "pi_a",
      amountMinor: Number(sessionA.rows[0]!.amount_minor),
    });
    const eventB = checkoutEvent({
      eventId: `evt_b_${id}`,
      sessionId: sessionB.rows[0]!.provider_session_id,
      paymentId: "pi_b",
      amountMinor: Number(sessionB.rows[0]!.amount_minor),
    });
    const bodyAevt = JSON.stringify(eventA);
    const bodyBevt = JSON.stringify(eventB);
    const pathA = savedA.paymentProvider.webhookPath;
    const pathB = savedB.paymentProvider.webhookPath;

    expect(
      (
        await app.request(pathA, {
          method: "POST",
          headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_school_b", bodyAevt) },
          body: bodyAevt,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(pathB, {
          method: "POST",
          headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_school_a", bodyBevt) },
          body: bodyBevt,
        })
      ).status,
    ).toBe(401);

    const okA = await app.request(pathA, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_school_a", bodyAevt) },
      body: bodyAevt,
    });
    expect(okA.status).toBe(200);
    const replayA = await app.request(pathA, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_school_a", bodyAevt) },
      body: bodyAevt,
    });
    expect(replayA.status).toBe(200);
    expect((await replayA.json() as { replayed?: boolean }).replayed).toBe(true);

    const crossSettle = checkoutEvent({
      eventId: `evt_cross_${id}`,
      sessionId: sessionB.rows[0]!.provider_session_id,
      paymentId: "pi_cross",
      amountMinor: Number(sessionB.rows[0]!.amount_minor),
    });
    const crossBody = JSON.stringify(crossSettle);
    const crossed = await app.request(pathA, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_school_a", crossBody) },
      body: crossBody,
    });
    expect(crossed.status).toBe(400);
    expect(((await crossed.json()) as { error: { code: string } }).error.code).toBe("organisation_mismatch");

    const invoiceBafter = (await (await app.request(`/api/v1/finance/invoices/${invoiceB.id}`, { headers: hdrsB })).json()) as {
      invoice: { outstandingMinor: number };
    };
    expect(invoiceBafter.invoice.outstandingMinor).toBeGreaterThan(0);

    const okB = await app.request(pathB, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_school_b", bodyBevt) },
      body: bodyBevt,
    });
    expect(okB.status).toBe(200);

    const chargeA = await app.request("/api/v1/finance/charges", {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({
        title: "Trip",
        studentProfileId: pupilA.student.id,
        amountMinor: 1500,
        categoryKey: "trip",
      }),
    });
    expect(chargeA.status).toBe(201);
    const charge = (await chargeA.json()) as { charge: { id: string } };
    const parentPay = await app.request(`/api/v1/parent/payments/${charge.charge.id}/checkout`, {
      method: "POST",
      headers: headers(parentA, schoolA.orgId),
      body: JSON.stringify({ idempotencyKey: `chg-a-${id}` }),
    });
    expect(parentPay.status).toBe(200);
    const chargeSession = await pools.owner.query<{ provider_session_id: string; transaction_id: string; amount_minor: string }>(
      `select provider_session_id, transaction_id, amount_minor::text
         from school_payment_sessions
        where organisation_id = $1 and charge_id = $2
        order by created_at desc limit 1`,
      [schoolA.orgId, charge.charge.id],
    );
    const chargeEvent = checkoutEvent({
      eventId: `evt_charge_${id}`,
      sessionId: chargeSession.rows[0]!.provider_session_id,
      paymentId: "pi_charge_a",
      amountMinor: Number(chargeSession.rows[0]!.amount_minor),
    });
    const chargeBody = JSON.stringify(chargeEvent);
    expect(
      (
        await app.request(pathA, {
          method: "POST",
          headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_school_a", chargeBody) },
          body: chargeBody,
        })
      ).status,
    ).toBe(200);

    calls.length = 0;
    const refund = await app.request(`/api/v1/finance/charges/${charge.charge.id}/refund`, {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({ amountMinor: 500, reason: "Partial" }),
    });
    expect(refund.status).toBe(201);
    expect(calls.some((call) => call.auth === "Bearer sk_test_school_a_aaaaaaaa" && call.url.includes("/v1/refunds"))).toBe(true);
    expect(calls.some((call) => call.auth === "Bearer sk_test_school_b_bbbbbbbb")).toBe(false);

    await withTenantContext(pools.app, schoolA.adminId, schoolA.orgId, async (client) => {
      const audit = await client.query<{ action: string; after_data: Record<string, unknown> | null }>(
        `select action, after_data from audit_events
          where organisation_id = $1 and action like 'payment_provider.%'`,
        [schoolA.orgId],
      );
      expect(audit.rows.map((row) => row.action)).toEqual(
        expect.arrayContaining(["payment_provider.configured"]),
      );
      for (const row of audit.rows) {
        expect(payloadContainsSecret(row.after_data)).toBe(false);
        expect(JSON.stringify(row.after_data)).not.toContain("sk_test_");
        expect(JSON.stringify(row.after_data)).not.toContain("whsec_");
      }
    });

    expect((await app.request("/api/v1/webhooks/payments/stripe", { method: "POST", body: "{}" })).status).toBe(400);
  });

  it("fails closed when Stripe is missing or disabled and rejects a disabled school from using another account", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, `c-${id}`);
    const other = await createSchool(pools.owner, `d-${id}`);
    const stripeApp = testApp(pools, { payments: { providerKey: "stripe" } });
    const token = await login(stripeApp, school.adminEmail, "password-12x");
    const otherToken = await login(stripeApp, other.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const otherHdrs = headers(otherToken, other.orgId);
    const year = await seedYear(stripeApp, hdrs);
    const pupil = await createStudent(stripeApp, hdrs, {
      legalName: "Closed Child",
      academicYearId: year.yearId,
      yearGroupId: year.yearGroupId,
    });
    await inviteParent(stripeApp, hdrs, pupil.student.id, `parent-c-${id}@example.com`);
    const invoice = await issueInvoice(stripeApp, hdrs, { yearId: year.yearId });
    const parentToken = await login(stripeApp, `parent-c-${id}@example.com`, "parent-pass-1");
    const missing = await stripeApp.request(`/api/v1/parent/finance/invoices/${invoice.id}/checkout`, {
      method: "POST",
      headers: headers(parentToken, school.orgId),
      body: "{}",
    });
    expect(missing.status).toBe(503);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("payment_provider_not_configured");

    await saveStripe(stripeApp, hdrs, {
      secretKey: "sk_test_school_c_cccccccc",
      webhookSecret: "whsec_school_c",
      enabled: false,
    });
    const disabled = await stripeApp.request(`/api/v1/parent/finance/invoices/${invoice.id}/checkout`, {
      method: "POST",
      headers: headers(parentToken, school.orgId),
      body: "{}",
    });
    expect(disabled.status).toBe(503);
    expect(((await disabled.json()) as { error: { code: string } }).error.code).toBe("payment_provider_disabled");

    const otherEmpty = (await (await stripeApp.request("/api/v1/finance/payment-provider", { headers: otherHdrs })).json()) as {
      paymentProvider: { connectionStatus: string };
    };
    expect(otherEmpty.paymentProvider.connectionStatus).toBe("not_configured");
  });

  it("tests the stored Stripe connection without creating charges", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, `e-${id}`);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const incomplete = await app.request("/api/v1/finance/payment-provider/test", { method: "POST", headers: hdrs, body: "{}" });
    expect(incomplete.status).toBe(200);
    expect(((await incomplete.json()) as { result: string }).result).toBe("configuration_incomplete");

    await saveStripe(app, hdrs, { secretKey: "sk_test_bad_dddddddd", webhookSecret: "whsec_school_e" });
    const failed = await app.request("/api/v1/finance/payment-provider/test", { method: "POST", headers: hdrs, body: "{}" });
    expect(((await failed.json()) as { result: string }).result).toBe("authentication_failed");

    await saveStripe(app, hdrs, { secretKey: "sk_test_school_a_aaaaaaaa", webhookSecret: "whsec_school_e" });
    calls.length = 0;
    const ok = await app.request("/api/v1/finance/payment-provider/test", { method: "POST", headers: hdrs, body: "{}" });
    const body = (await ok.json()) as { result: string; paymentProvider: { displayName: string | null } };
    expect(body.result).toBe("connected");
    expect(body.paymentProvider.displayName).toBe("School A");
    expect(calls.some((call) => call.url.includes("/v1/account"))).toBe(true);
    expect(calls.some((call) => call.url.includes("/v1/charges") || call.url.includes("/v1/checkout"))).toBe(false);
  });
});
