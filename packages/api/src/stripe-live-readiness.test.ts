import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closePools } from "@schoolapp/db";
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
    [`slr-${id}`, `Stripe Live ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return { adminId, orgId: org.rows[0]!.id, slug: `slr-${id}`, adminEmail: `admin-${id}@example.com` };
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

async function issueInvoice(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof headers>, yearId: string) {
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
      academicYearId: yearId,
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
      academicYearId: yearId,
      frequency: "monthly",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      dueOn: "2026-09-15",
    }),
  });
  expect(preview.status).toBe(201);
  const run = (await preview.json()) as { run: { id: string } };
  expect(
    (await app.request(`/api/v1/finance/billing-runs/${run.run.id}/confirm`, { method: "POST", headers: hdrs, body: "{}" }))
      .status,
  ).toBe(200);
  const invoices = (await (await app.request("/api/v1/finance/invoices", { headers: hdrs })).json()) as {
    invoices: Array<{ id: string; outstandingMinor: number }>;
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
  if (saved.status !== 200) {
    throw new Error(`saveStripe failed ${saved.status}: ${await saved.text()}`);
  }
  return (await saved.json()) as {
    paymentProvider: { webhookPath: string; enabled: boolean; mode: string };
    readiness: { liveReady: boolean; canEnableLive: boolean; checks: Array<{ key: string; ok: boolean }> };
  };
}

function checkoutEvent(input: {
  eventId: string;
  sessionId: string;
  paymentId: string;
  amountMinor: number;
  livemode?: boolean;
}) {
  return {
    id: input.eventId,
    type: "checkout.session.completed",
    livemode: input.livemode ?? false,
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

function refundCreatedEvent(input: {
  eventId: string;
  refundId: string;
  paymentId: string;
  amountMinor: number;
}) {
  return {
    id: input.eventId,
    type: "refund.created",
    livemode: false,
    data: {
      object: {
        id: input.refundId,
        object: "refund",
        amount: input.amountMinor,
        currency: "gbp",
        payment_intent: input.paymentId,
        status: "succeeded",
      },
    },
  };
}

function chargeRefundedEvent(input: {
  eventId: string;
  chargeId: string;
  refundId: string;
  paymentId: string;
  chargeAmountMinor: number;
  refundAmountMinor: number;
}) {
  return {
    id: input.eventId,
    type: "charge.refunded",
    livemode: false,
    data: {
      object: {
        id: input.chargeId,
        object: "charge",
        amount: input.chargeAmountMinor,
        amount_refunded: input.refundAmountMinor,
        currency: "gbp",
        payment_intent: input.paymentId,
        refunds: {
          object: "list",
          data: [{ id: input.refundId, amount: input.refundAmountMinor, status: "succeeded" }],
        },
      },
    },
  };
}

describe("Stripe live readiness and payment integrity", () => {
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
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "acct_live_ready", business_profile: { name: "Example School" } }),
        } as Response;
      }
      if (String(url).includes("/v1/refunds")) {
        return { ok: true, status: 200, json: async () => ({ id: `re_${randomUUID()}`, status: "succeeded" }) } as Response;
      }
      const id = `cs_${randomUUID()}`;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id, url: `https://checkout.stripe.test/${id}` }),
      } as Response;
    }) as typeof fetch,
  });

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  afterEach(() => {
    calls.length = 0;
  });

  it("assesses readiness without Stripe calls on GET and requires confirmed LIVE enablement", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, `live-${id}`);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    expect(
      (
        await app.request("/api/v1/finance/settings", {
          method: "PATCH",
          headers: hdrs,
          body: JSON.stringify({ tuitionEnabled: true, parentsCanViewInvoices: true }),
        })
      ).status,
    ).toBe(200);
    const empty = await app.request("/api/v1/finance/payment-provider", { headers: hdrs });
    expect(empty.status).toBe(200);
    const emptyBody = (await empty.json()) as {
      paymentProvider: { secretKeyHint: string | null };
      readiness: { liveReady: boolean; canEnableLive: boolean };
    };
    expect(emptyBody.readiness.liveReady).toBe(false);
    expect(emptyBody.readiness.canEnableLive).toBe(false);
    expect(JSON.stringify(emptyBody)).not.toContain("sk_live");
    expect(JSON.stringify(emptyBody)).not.toContain("whsec_");
    expect(calls.some((call) => call.url.includes("/v1/"))).toBe(false);

    const liveMismatch = await app.request("/api/v1/finance/payment-provider", {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({ mode: "live", secretKey: "sk_test_not_live_aaaa", webhookSecret: "whsec_live_a" }),
    });
    expect(liveMismatch.status).toBe(400);
    expect(((await liveMismatch.json()) as { error: { code: string } }).error.code).toBe("test_live_mismatch");

    const saved = await saveStripe(app, hdrs, {
      mode: "live",
      secretKey: "sk_live_school_aaaaaaaa",
      webhookSecret: "whsec_live_school",
    });
    expect(saved.paymentProvider.enabled).toBe(false);
    expect(saved.readiness.liveReady).toBe(false);

    const enableNoConfirm = await app.request("/api/v1/finance/payment-provider/enable", {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(enableNoConfirm.status).toBe(400);
    expect(((await enableNoConfirm.json()) as { error: { code: string } }).error.code).toBe("live_enablement_not_confirmed");

    const enableNoTest = await app.request("/api/v1/finance/payment-provider/enable", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ confirmLivePayments: true }),
    });
    expect(enableNoTest.status).toBe(409);
    const enableNoTestBody = (await enableNoTest.json()) as { error: { code: string; message: string } };
    expect(enableNoTestBody.error.code).toBe("live_not_ready");
    expect(enableNoTestBody.error.message).toMatch(/Connection tested/i);
    expect(enableNoTestBody.error.message).not.toBe("LIVE mode processes real payments.");

    const tested = await app.request("/api/v1/finance/payment-provider/test", { method: "POST", headers: hdrs, body: "{}" });
    expect(tested.status).toBe(200);
    expect(((await tested.json()) as { result: string }).result).toBe("connected");
    expect(calls.some((call) => call.url.includes("/v1/account"))).toBe(true);
    expect(calls.some((call) => call.url.includes("/v1/charges") || call.url.includes("/v1/checkout"))).toBe(false);

    const enabled = await app.request("/api/v1/finance/payment-provider/enable", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ confirmLivePayments: true }),
    });
    expect(enabled.status).toBe(200);
    const enabledBody = (await enabled.json()) as { paymentProvider: { enabled: boolean }; readiness: { liveReady: boolean } };
    expect(enabledBody.paymentProvider.enabled).toBe(true);
    expect(enabledBody.readiness.liveReady).toBe(true);

    const disable = await app.request("/api/v1/finance/payment-provider/disable", { method: "POST", headers: hdrs, body: "{}" });
    expect(disable.status).toBe(200);
    const replaced = await saveStripe(app, hdrs, {
      mode: "live",
      secretKey: "sk_live_school_bbbbbbbb",
      webhookSecret: "whsec_live_school",
    });
    expect(replaced.paymentProvider.enabled).toBe(false);
    expect(replaced.readiness.canEnableLive).toBe(false);
    const enableStaleTest = await app.request("/api/v1/finance/payment-provider/enable", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ confirmLivePayments: true }),
    });
    expect(enableStaleTest.status).toBe(409);
    expect(((await enableStaleTest.json()) as { error: { code: string } }).error.code).toBe("live_not_ready");
    expect(
      ((await (await app.request("/api/v1/finance/payment-provider/test", { method: "POST", headers: hdrs, body: "{}" })).json()) as {
        result: string;
      }).result,
    ).toBe("connected");
    const reenabled = await app.request("/api/v1/finance/payment-provider/enable", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ confirmLivePayments: true }),
    });
    expect(reenabled.status).toBe(200);
  });

  it("reconciles a late webhook after checkout session rotation and is idempotent", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, `late-${id}`);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const saved = await saveStripe(app, hdrs, {
      secretKey: "sk_test_late_aaaaaaaa",
      webhookSecret: "whsec_late",
      enabled: true,
    });
    const year = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Late Child",
      academicYearId: year.yearId,
      yearGroupId: year.yearGroupId,
    });
    await inviteParent(app, hdrs, pupil.student.id, `parent-late-${id}@example.com`);
    const invoice = await issueInvoice(app, hdrs, year.yearId);
    const parentToken = await login(app, `parent-late-${id}@example.com`, "parent-pass-1");
    const firstPay = await app.request(`/api/v1/parent/finance/invoices/${invoice.id}/checkout`, {
      method: "POST",
      headers: headers(parentToken, school.orgId),
      body: JSON.stringify({ idempotencyKey: `late-a-${id}` }),
    });
    expect(firstPay.status).toBe(200);
    const firstSession = await pools.owner.query<{
      id: string;
      provider_session_id: string;
      amount_minor: string;
    }>(
      `select id, provider_session_id, amount_minor::text from school_payment_sessions
        where organisation_id = $1 and invoice_id = $2 order by created_at desc limit 1`,
      [school.orgId, invoice.id],
    );
    await pools.owner.query(`update school_payment_sessions set expires_at = now() - interval '1 hour' where id = $1`, [
      firstSession.rows[0]!.id,
    ]);
    const secondPay = await app.request(`/api/v1/parent/finance/invoices/${invoice.id}/checkout`, {
      method: "POST",
      headers: headers(parentToken, school.orgId),
      body: JSON.stringify({ idempotencyKey: `late-b-${id}` }),
    });
    expect(secondPay.status).toBe(200);
    const sessions = await pools.owner.query<{ provider_session_id: string; status: string; amount_minor: string }>(
      `select provider_session_id, status, amount_minor::text from school_payment_sessions
        where organisation_id = $1 and invoice_id = $2 order by created_at`,
      [school.orgId, invoice.id],
    );
    expect(sessions.rowCount).toBe(2);
    expect(sessions.rows[0]!.status).not.toBe("open");
    const oldSessionId = firstSession.rows[0]!.provider_session_id;
    const amount = Number(firstSession.rows[0]!.amount_minor);
    const event = checkoutEvent({
      eventId: `evt_late_${id}`,
      sessionId: oldSessionId,
      paymentId: `pi_late_${id}`,
      amountMinor: amount,
    });
    const body = JSON.stringify(event);
    const webhook = await app.request(saved.paymentProvider.webhookPath, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_late", body) },
      body,
    });
    expect(webhook.status).toBe(200);
    const webhookBody = (await webhook.json()) as { ok: boolean; review?: boolean };
    expect(webhookBody.ok).toBe(true);
    expect(webhookBody.review).toBeFalsy();
    const paid = (await (await app.request(`/api/v1/finance/invoices/${invoice.id}`, { headers: hdrs })).json()) as {
      invoice: { outstandingMinor: number; status: string; paidMinor: number };
    };
    expect(paid.invoice.outstandingMinor).toBe(0);
    expect(paid.invoice.paidMinor).toBe(amount);
    const replay = await app.request(saved.paymentProvider.webhookPath, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_late", body) },
      body,
    });
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { replayed?: boolean }).replayed).toBe(true);
    const samePi = checkoutEvent({
      eventId: `evt_late_dup_${id}`,
      sessionId: oldSessionId,
      paymentId: `pi_late_${id}`,
      amountMinor: amount,
    });
    const samePiBody = JSON.stringify(samePi);
    const secondEvent = await app.request(saved.paymentProvider.webhookPath, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_late", samePiBody) },
      body: samePiBody,
    });
    expect(secondEvent.status).toBe(200);
    const afterDup = (await (await app.request(`/api/v1/finance/invoices/${invoice.id}`, { headers: hdrs })).json()) as {
      invoice: { paidMinor: number };
    };
    expect(afterDup.invoice.paidMinor).toBe(amount);
    const newSession = sessions.rows[1]!;
    const extra = checkoutEvent({
      eventId: `evt_late_extra_${id}`,
      sessionId: newSession.provider_session_id,
      paymentId: `pi_late_extra_${id}`,
      amountMinor: Number(newSession.amount_minor),
    });
    const extraBody = JSON.stringify(extra);
    const extraRes = await app.request(saved.paymentProvider.webhookPath, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_late", extraBody) },
      body: extraBody,
    });
    expect(extraRes.status).toBe(200);
    expect(((await extraRes.json()) as { review?: boolean }).review).toBe(true);
    const eventRow = await pools.owner.query<{ status: string }>(
      `select status from school_payment_provider_events where organisation_id = $1 and event_id = $2`,
      [school.orgId, `evt_late_extra_${id}`],
    );
    expect(eventRow.rows[0]?.status).toBe("manual_review");
  });

  it("treats concurrent deliveries of the same Stripe event as one payment", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, `dup-${id}`);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const saved = await saveStripe(app, hdrs, {
      secretKey: "sk_test_dup_aaaaaaaa",
      webhookSecret: "whsec_dup_school",
      enabled: true,
    });
    const year = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Dup Child",
      academicYearId: year.yearId,
      yearGroupId: year.yearGroupId,
    });
    await inviteParent(app, hdrs, pupil.student.id, `parent-dup-${id}@example.com`);
    const invoice = await issueInvoice(app, hdrs, year.yearId);
    const parentToken = await login(app, `parent-dup-${id}@example.com`, "parent-pass-1");
    expect(
      (
        await app.request(`/api/v1/parent/finance/invoices/${invoice.id}/checkout`, {
          method: "POST",
          headers: headers(parentToken, school.orgId),
          body: JSON.stringify({ idempotencyKey: `dup-${id}` }),
        })
      ).status,
    ).toBe(200);
    const session = await pools.owner.query<{ provider_session_id: string; amount_minor: string }>(
      `select provider_session_id, amount_minor::text from school_payment_sessions
        where organisation_id = $1 and invoice_id = $2 order by created_at desc limit 1`,
      [school.orgId, invoice.id],
    );
    const event = checkoutEvent({
      eventId: `evt_dup_${id}`,
      sessionId: session.rows[0]!.provider_session_id,
      paymentId: `pi_dup_${id}`,
      amountMinor: Number(session.rows[0]!.amount_minor),
    });
    const body = JSON.stringify(event);
    const headersWebhook = { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_dup_school", body) };
    const [first, second] = await Promise.all([
      app.request(saved.paymentProvider.webhookPath, { method: "POST", headers: headersWebhook, body }),
      app.request(saved.paymentProvider.webhookPath, { method: "POST", headers: headersWebhook, body }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]);
    const paid = (await (await app.request(`/api/v1/finance/invoices/${invoice.id}`, { headers: hdrs })).json()) as {
      invoice: { paidMinor: number; outstandingMinor: number };
      payments: Array<{ externalReference: string | null }>;
    };
    expect(paid.invoice.paidMinor).toBe(Number(session.rows[0]!.amount_minor));
    expect(paid.invoice.outstandingMinor).toBe(0);
    expect(paid.payments.filter((payment) => payment.externalReference === `pi_dup_${id}`)).toHaveLength(1);
  });

  it("supports partial then final Stripe payment without exceeding outstanding", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, `part-${id}`);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const saved = await saveStripe(app, hdrs, {
      secretKey: "sk_test_part_aaaaaaaa",
      webhookSecret: "whsec_part",
      enabled: true,
    });
    const year = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Partial Child",
      academicYearId: year.yearId,
      yearGroupId: year.yearGroupId,
    });
    await inviteParent(app, hdrs, pupil.student.id, `parent-part-${id}@example.com`);
    const invoice = await issueInvoice(app, hdrs, year.yearId);
    const parentToken = await login(app, `parent-part-${id}@example.com`, "parent-pass-1");
    const over = await app.request(`/api/v1/parent/finance/invoices/${invoice.id}/checkout`, {
      method: "POST",
      headers: headers(parentToken, school.orgId),
      body: JSON.stringify({ amountMinor: invoice.outstandingMinor + 1 }),
    });
    expect(over.status).toBe(409);
    const firstAmount = 20000;
    const firstPay = await app.request(`/api/v1/parent/finance/invoices/${invoice.id}/checkout`, {
      method: "POST",
      headers: headers(parentToken, school.orgId),
      body: JSON.stringify({ amountMinor: firstAmount, idempotencyKey: `part-a-${id}` }),
    });
    expect(firstPay.status).toBe(200);
    const firstSession = await pools.owner.query<{ provider_session_id: string }>(
      `select provider_session_id from school_payment_sessions
        where organisation_id = $1 and invoice_id = $2 order by created_at desc limit 1`,
      [school.orgId, invoice.id],
    );
    const firstEvent = checkoutEvent({
      eventId: `evt_part1_${id}`,
      sessionId: firstSession.rows[0]!.provider_session_id,
      paymentId: `pi_part1_${id}`,
      amountMinor: firstAmount,
    });
    const firstBody = JSON.stringify(firstEvent);
    expect(
      (
        await app.request(saved.paymentProvider.webhookPath, {
          method: "POST",
          headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_part", firstBody) },
          body: firstBody,
        })
      ).status,
    ).toBe(200);
    const mid = (await (await app.request(`/api/v1/finance/invoices/${invoice.id}`, { headers: hdrs })).json()) as {
      invoice: { outstandingMinor: number; status: string; paidMinor: number };
      payments: Array<{ amountMinor: number }>;
    };
    expect(mid.invoice.paidMinor).toBe(firstAmount);
    expect(mid.invoice.outstandingMinor).toBe(invoice.outstandingMinor - firstAmount);
    expect(mid.invoice.status).toBe("partially_paid");
    expect(mid.payments[0]?.amountMinor).toBe(firstAmount);
    const rest = mid.invoice.outstandingMinor;
    const secondPay = await app.request(`/api/v1/parent/finance/invoices/${invoice.id}/checkout`, {
      method: "POST",
      headers: headers(parentToken, school.orgId),
      body: JSON.stringify({ amountMinor: rest, idempotencyKey: `part-b-${id}` }),
    });
    expect(secondPay.status).toBe(200);
    const secondSession = await pools.owner.query<{ provider_session_id: string }>(
      `select provider_session_id from school_payment_sessions
        where organisation_id = $1 and invoice_id = $2 and status = 'open' order by created_at desc limit 1`,
      [school.orgId, invoice.id],
    );
    const secondEvent = checkoutEvent({
      eventId: `evt_part2_${id}`,
      sessionId: secondSession.rows[0]!.provider_session_id,
      paymentId: `pi_part2_${id}`,
      amountMinor: rest,
    });
    const secondBody = JSON.stringify(secondEvent);
    expect(
      (
        await app.request(saved.paymentProvider.webhookPath, {
          method: "POST",
          headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_part", secondBody) },
          body: secondBody,
        })
      ).status,
    ).toBe(200);
    const done = (await (await app.request(`/api/v1/finance/invoices/${invoice.id}`, { headers: hdrs })).json()) as {
      invoice: { outstandingMinor: number; status: string };
    };
    expect(done.invoice.outstandingMinor).toBe(0);
    expect(done.invoice.status).toBe("paid");
  });

  it("does not record payment from cancelled checkout or live events against a test school", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, `can-${id}`);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const saved = await saveStripe(app, hdrs, {
      secretKey: "sk_test_can_aaaaaaaa",
      webhookSecret: "whsec_can_school",
      enabled: true,
    });
    const year = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Cancel Child",
      academicYearId: year.yearId,
      yearGroupId: year.yearGroupId,
    });
    await inviteParent(app, hdrs, pupil.student.id, `parent-can-${id}@example.com`);
    const invoice = await issueInvoice(app, hdrs, year.yearId);
    const parentToken = await login(app, `parent-can-${id}@example.com`, "parent-pass-1");
    expect(
      (
        await app.request(`/api/v1/parent/finance/invoices/${invoice.id}/checkout`, {
          method: "POST",
          headers: headers(parentToken, school.orgId),
          body: JSON.stringify({ idempotencyKey: `can-${id}` }),
        })
      ).status,
    ).toBe(200);
    const session = await pools.owner.query<{ provider_session_id: string; amount_minor: string }>(
      `select provider_session_id, amount_minor::text from school_payment_sessions
        where organisation_id = $1 and invoice_id = $2 order by created_at desc limit 1`,
      [school.orgId, invoice.id],
    );
    const expired = {
      id: `evt_exp_${id}`,
      type: "checkout.session.expired",
      livemode: false,
      data: { object: { id: session.rows[0]!.provider_session_id, amount_total: Number(session.rows[0]!.amount_minor), currency: "gbp" } },
    };
    const expiredBody = JSON.stringify(expired);
    expect(
      (
        await app.request(saved.paymentProvider.webhookPath, {
          method: "POST",
          headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_can_school", expiredBody) },
          body: expiredBody,
        })
      ).status,
    ).toBe(200);
    const stillDue = (await (await app.request(`/api/v1/finance/invoices/${invoice.id}`, { headers: hdrs })).json()) as {
      invoice: { outstandingMinor: number };
    };
    expect(stillDue.invoice.outstandingMinor).toBe(invoice.outstandingMinor);
    const liveEvent = checkoutEvent({
      eventId: `evt_live_mismatch_${id}`,
      sessionId: session.rows[0]!.provider_session_id,
      paymentId: `pi_live_mismatch_${id}`,
      amountMinor: Number(session.rows[0]!.amount_minor),
      livemode: true,
    });
    const liveBody = JSON.stringify(liveEvent);
    const mismatched = await app.request(saved.paymentProvider.webhookPath, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_can_school", liveBody) },
      body: liveBody,
    });
    expect(mismatched.status).toBe(400);
    expect(((await mismatched.json()) as { error: { code: string } }).error.code).toBe("webhook_mode_mismatch");
  });

  it("blocks local reverse of Stripe invoice payments and production fake checkout", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, `ref-${id}`);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const saved = await saveStripe(app, hdrs, {
      secretKey: "sk_test_ref_aaaaaaaa",
      webhookSecret: "whsec_ref_school",
      enabled: true,
    });
    const year = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Refund Child",
      academicYearId: year.yearId,
      yearGroupId: year.yearGroupId,
    });
    await inviteParent(app, hdrs, pupil.student.id, `parent-ref-${id}@example.com`);
    const invoice = await issueInvoice(app, hdrs, year.yearId);
    const parentToken = await login(app, `parent-ref-${id}@example.com`, "parent-pass-1");
    expect(
      (
        await app.request(`/api/v1/parent/finance/invoices/${invoice.id}/checkout`, {
          method: "POST",
          headers: headers(parentToken, school.orgId),
          body: "{}",
        })
      ).status,
    ).toBe(200);
    const session = await pools.owner.query<{ provider_session_id: string; amount_minor: string }>(
      `select provider_session_id, amount_minor::text from school_payment_sessions
        where organisation_id = $1 and invoice_id = $2 order by created_at desc limit 1`,
      [school.orgId, invoice.id],
    );
    const event = checkoutEvent({
      eventId: `evt_ref_${id}`,
      sessionId: session.rows[0]!.provider_session_id,
      paymentId: `pi_ref_${id}`,
      amountMinor: Number(session.rows[0]!.amount_minor),
    });
    const body = JSON.stringify(event);
    expect(
      (
        await app.request(saved.paymentProvider.webhookPath, {
          method: "POST",
          headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_ref_school", body) },
          body,
        })
      ).status,
    ).toBe(200);
    const loaded = (await (await app.request(`/api/v1/finance/invoices/${invoice.id}`, { headers: hdrs })).json()) as {
      payments: Array<{ id: string }>;
    };
    const reversed = await app.request(`/api/v1/finance/invoice-payments/${loaded.payments[0]!.id}/reverse`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ reason: "local reverse" }),
    });
    expect(reversed.status).toBe(409);
    expect(((await reversed.json()) as { error: { code: string } }).error.code).toBe("stripe_refund_via_dashboard");
    const credit = await app.request(`/api/v1/finance/invoices/${invoice.id}/credits`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ kind: "refund", amountMinor: 100, reason: "pretend refund" }),
    });
    expect(credit.status).toBe(409);
    expect(((await credit.json()) as { error: { code: string } }).error.code).toBe("stripe_refund_via_dashboard");

    const bankPreview = await app.request("/api/v1/finance/billing-runs/preview", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: year.yearId,
        frequency: "monthly",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        dueOn: "2026-10-15",
      }),
    });
    expect(bankPreview.status).toBe(201);
    const bankRun = (await bankPreview.json()) as { run: { id: string } };
    expect(
      (await app.request(`/api/v1/finance/billing-runs/${bankRun.run.id}/confirm`, { method: "POST", headers: hdrs, body: "{}" }))
        .status,
    ).toBe(200);
    const bankInvoices = (await (await app.request("/api/v1/finance/invoices", { headers: hdrs })).json()) as {
      invoices: Array<{ id: string; outstandingMinor: number }>;
    };
    const bankInvoice = bankInvoices.invoices.find((row) => row.id !== invoice.id && row.outstandingMinor > 0)!;
    const bankPay = await app.request(`/api/v1/finance/invoices/${bankInvoice.id}/payments`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: bankInvoice.outstandingMinor, method: "bank_transfer" }),
    });
    expect(bankPay.status).toBe(201);
    const bankRefund = await app.request(`/api/v1/finance/invoices/${bankInvoice.id}/credits`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        kind: "refund",
        amountMinor: bankInvoice.outstandingMinor,
        reason: "Returned bank transfer",
      }),
    });
    expect(bankRefund.status).toBe(201);
    const afterBankRefund = (await (await app.request(`/api/v1/finance/invoices/${bankInvoice.id}`, { headers: hdrs })).json()) as {
      invoice: { outstandingMinor: number; creditTotalMinor: number; paidMinor: number };
    };
    expect(afterBankRefund.invoice.paidMinor).toBe(bankInvoice.outstandingMinor);
    expect(afterBankRefund.invoice.creditTotalMinor).toBe(bankInvoice.outstandingMinor);
    expect(afterBankRefund.invoice.outstandingMinor).toBe(0);

    const mixedBank = 10000;
    const mixedPreview = await app.request("/api/v1/finance/billing-runs/preview", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: year.yearId,
        frequency: "monthly",
        periodStart: "2026-11-01",
        periodEnd: "2026-11-30",
        dueOn: "2026-11-15",
      }),
    });
    expect(mixedPreview.status).toBe(201);
    const mixedRun = (await mixedPreview.json()) as { run: { id: string } };
    expect(
      (await app.request(`/api/v1/finance/billing-runs/${mixedRun.run.id}/confirm`, { method: "POST", headers: hdrs, body: "{}" }))
        .status,
    ).toBe(200);
    const mixedList = (await (await app.request("/api/v1/finance/invoices", { headers: hdrs })).json()) as {
      invoices: Array<{ id: string; outstandingMinor: number }>;
    };
    const mixedInvoice = mixedList.invoices.find(
      (row) => row.id !== invoice.id && row.id !== bankInvoice.id && row.outstandingMinor > 0,
    )!;
    const mixedBankPay = await app.request(`/api/v1/finance/invoices/${mixedInvoice.id}/payments`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: mixedBank, method: "bank_transfer" }),
    });
    expect(mixedBankPay.status).toBe(201);
    const mixedNote = await app.request(`/api/v1/finance/invoices/${mixedInvoice.id}/credits`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ kind: "credit_note", amountMinor: 500, reason: "Concession on mixed invoice" }),
    });
    expect(mixedNote.status).toBe(201);
    expect(
      (
        await app.request(`/api/v1/parent/finance/invoices/${mixedInvoice.id}/checkout`, {
          method: "POST",
          headers: headers(parentToken, school.orgId),
          body: "{}",
        })
      ).status,
    ).toBe(200);
    const mixedSession = await pools.owner.query<{ provider_session_id: string; amount_minor: string }>(
      `select provider_session_id, amount_minor::text from school_payment_sessions
        where organisation_id = $1 and invoice_id = $2 order by created_at desc limit 1`,
      [school.orgId, mixedInvoice.id],
    );
    const mixedPi = `pi_mixed_${id}`;
    const mixedSettle = checkoutEvent({
      eventId: `evt_mixed_${id}`,
      sessionId: mixedSession.rows[0]!.provider_session_id,
      paymentId: mixedPi,
      amountMinor: Number(mixedSession.rows[0]!.amount_minor),
    });
    const mixedSettleBody = JSON.stringify(mixedSettle);
    expect(
      (
        await app.request(saved.paymentProvider.webhookPath, {
          method: "POST",
          headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_ref_school", mixedSettleBody) },
          body: mixedSettleBody,
        })
      ).status,
    ).toBe(200);
    const mixedLoaded = (await (await app.request(`/api/v1/finance/invoices/${mixedInvoice.id}`, { headers: hdrs })).json()) as {
      invoice: { outstandingMinor: number; paidMinor: number };
      payments: Array<{ id: string; method: string }>;
    };
    expect(mixedLoaded.invoice.outstandingMinor).toBe(0);
    expect(mixedLoaded.invoice.paidMinor).toBe(mixedInvoice.outstandingMinor - 500);
    const mixedStripePayment = mixedLoaded.payments.find((row) => row.method === "card")!;
    expect(
      (
        await app.request(`/api/v1/finance/invoice-payments/${mixedStripePayment.id}/reverse`, {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify({ reason: "local reverse" }),
        })
      ).status,
    ).toBe(409);
    const mixedRefundBody = JSON.stringify({ kind: "refund", amountMinor: mixedBank, reason: "Returned mixed bank transfer" });
    const mixedRefunds = await Promise.all([
      app.request(`/api/v1/finance/invoices/${mixedInvoice.id}/credits`, {
        method: "POST",
        headers: hdrs,
        body: mixedRefundBody,
      }),
      app.request(`/api/v1/finance/invoices/${mixedInvoice.id}/credits`, {
        method: "POST",
        headers: hdrs,
        body: mixedRefundBody,
      }),
    ]);
    expect(mixedRefunds.map((row) => row.status).sort()).toEqual([201, 409]);
    const mixedBlocked = mixedRefunds.find((row) => row.status === 409)!;
    expect(((await mixedBlocked.json()) as { error: { code: string } }).error.code).toBe("stripe_refund_via_dashboard");
    const mixedOver = await app.request(`/api/v1/finance/invoices/${mixedInvoice.id}/credits`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ kind: "refund", amountMinor: 1, reason: "pretend Stripe refund" }),
    });
    expect(mixedOver.status).toBe(409);
    expect(((await mixedOver.json()) as { error: { code: string } }).error.code).toBe("stripe_refund_via_dashboard");
    const afterMixed = (await (await app.request(`/api/v1/finance/invoices/${mixedInvoice.id}`, { headers: hdrs })).json()) as {
      invoice: { creditTotalMinor: number };
    };
    expect(afterMixed.invoice.creditTotalMinor).toBe(mixedBank + 500);

    const refundAmount = 12500;
    const refundId = `re_inv_${id}`;
    const firstRefund = refundCreatedEvent({
      eventId: `evt_re_created_${id}`,
      refundId,
      paymentId: `pi_ref_${id}`,
      amountMinor: refundAmount,
    });
    const chargeRefund = chargeRefundedEvent({
      eventId: `evt_ch_refunded_${id}`,
      chargeId: `ch_ref_${id}`,
      refundId,
      paymentId: `pi_ref_${id}`,
      chargeAmountMinor: Number(session.rows[0]!.amount_minor),
      refundAmountMinor: refundAmount,
    });
    const updatedRefund = {
      id: `evt_re_updated_${id}`,
      type: "refund.updated",
      livemode: false,
      data: {
        object: {
          id: refundId,
          object: "refund",
          amount: refundAmount,
          currency: "gbp",
          payment_intent: `pi_ref_${id}`,
          status: "succeeded",
        },
      },
    };
    for (const payload of [firstRefund, chargeRefund, updatedRefund]) {
      const body = JSON.stringify(payload);
      const posted = await app.request(saved.paymentProvider.webhookPath, {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_ref_school", body) },
        body,
      });
      expect(posted.status).toBe(200);
      expect(((await posted.json()) as { review?: boolean }).review).toBeUndefined();
    }
    const afterStripeRefund = (await (await app.request(`/api/v1/finance/invoices/${invoice.id}`, { headers: hdrs })).json()) as {
      invoice: { creditTotalMinor: number; outstandingMinor: number; paidMinor: number };
    };
    expect(afterStripeRefund.invoice.creditTotalMinor).toBe(refundAmount);
    const creditRows = await pools.owner.query<{ n: string }>(
      `select count(*)::text as n from school_invoice_credits
        where organisation_id = $1 and invoice_id = $2 and kind = 'refund'`,
      [school.orgId, invoice.id],
    );
    expect(Number(creditRows.rows[0]!.n)).toBe(1);

    const prod = testApp(pools, { payments: { providerKey: "fake", allowPlatformFakeProvider: false } });
    const demo = await prod.request(`/api/v1/payments/demo/checkout/${randomUUID()}?t=nope`);
    expect(demo.status).toBe(404);
    const fakeHook = await prod.request("/api/v1/webhooks/payments/fake", { method: "POST", body: "{}" });
    expect(fakeHook.status).toBe(404);
    const missingSchool = await createSchool(pools.owner, `prod-${id}`);
    const missingToken = await login(prod, missingSchool.adminEmail, "password-12x");
    const missingHdrs = headers(missingToken, missingSchool.orgId);
    const missingYear = await seedYear(prod, missingHdrs);
    const missingPupil = await createStudent(prod, missingHdrs, {
      legalName: "Closed Child",
      academicYearId: missingYear.yearId,
      yearGroupId: missingYear.yearGroupId,
    });
    await inviteParent(prod, missingHdrs, missingPupil.student.id, `parent-prod-${id}@example.com`);
    const missingInvoice = await issueInvoice(prod, missingHdrs, missingYear.yearId);
    const missingParent = await login(prod, `parent-prod-${id}@example.com`, "parent-pass-1");
    const closed = await prod.request(`/api/v1/parent/finance/invoices/${missingInvoice.id}/checkout`, {
      method: "POST",
      headers: headers(missingParent, missingSchool.orgId),
      body: "{}",
    });
    expect(closed.status).toBe(503);
    expect(((await closed.json()) as { error: { code: string } }).error.code).toBe("payment_provider_not_configured");
  });
});
