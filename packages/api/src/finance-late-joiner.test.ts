import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withTenantContext } from "@schoolapp/db";
import {
  addMembership,
  ensureMigrated,
  insertUser,
  login,
  testApp,
  testPools,
} from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);

type StripeCall = { url: string; body: string };

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
    [`lj-${id}`, `Late Joiner ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return { adminId, orgId: org.rows[0]!.id, adminEmail: `admin-${id}@example.com` };
}

function headers(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    "Content-Type": "application/json",
  };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

type SeededYear = {
  yearId: string;
  year3Id: string;
  year5Id: string;
  classAId: string;
};

async function seedYear(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof headers>): Promise<SeededYear> {
  const year = await json<{ academicYear: { id: string } }>(
    await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "2026/27",
        startsOn: "2026-09-01",
        endsOn: "2027-07-31",
        isCurrent: true,
      }),
    }),
  );
  await app.request("/api/v1/year-groups/seed", { method: "POST", headers: hdrs, body: "{}" });
  const groups = await json<{ yearGroups: Array<{ id: string; code: string }> }>(
    await app.request("/api/v1/year-groups", { headers: hdrs }),
  );
  const year3 = groups.yearGroups.find((group) => group.code === "3")!;
  const year5 = groups.yearGroups.find((group) => group.code === "5") ?? groups.yearGroups.find((group) => group.code === "4")!;
  const classA = await json<{ class: { id: string; name: string } }>(
    await app.request("/api/v1/classes", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "3A",
        academicYearId: year.academicYear.id,
        yearGroupId: year3.id,
        classType: "form",
      }),
    }),
  );
  return { yearId: year.academicYear.id, year3Id: year3.id, year5Id: year5.id, classAId: classA.class.id };
}

async function enableTuition(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  extra: Record<string, unknown> = {},
) {
  const res = await app.request("/api/v1/finance/settings", {
    method: "PATCH",
    headers: hdrs,
    body: JSON.stringify({ tuitionEnabled: true, defaultBillingFrequency: "monthly", ...extra }),
  });
  expect(res.status).toBe(200);
}

async function createStudent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  pools: ReturnType<typeof testPools>,
  school: { adminId: string; orgId: string },
  input: {
    legalName: string;
    academicYearId: string;
    yearGroupId: string;
    classId?: string;
    startedOn?: string;
  },
) {
  const created = await app.request("/api/v1/students", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      legalName: input.legalName,
      academicYearId: input.academicYearId,
      yearGroupId: input.yearGroupId,
      classId: input.classId,
    }),
  });
  expect(created.status).toBe(201);
  const body = await json<{ student: { id: string } }>(created);
  if (input.startedOn) {
    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      await client.query(
        `update student_enrolments set started_on = $2 where student_profile_id = $1 and is_primary`,
        [body.student.id, input.startedOn],
      );
      await client.query(
        `update class_memberships set started_on = $2 where student_profile_id = $1 and ended_on is null`,
        [body.student.id, input.startedOn],
      );
    });
  }
  return body;
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
  const guardian = await json<{ invitationToken: string | null }>(created);
  if (guardian.invitationToken) {
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: guardian.invitationToken, fullName: "Pat Parent", password: "parent-pass-1" }),
    });
  }
}

async function createYear3Schedule(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  yearId: string,
  year3Id: string,
  name = "Year 3 2026/27",
) {
  const created = await app.request("/api/v1/finance/fee-schedules", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      name,
      academicYearId: yearId,
      yearGroupId: year3Id,
      annualAmountMinor: 2000000,
      instalmentCount: 10,
      billingFrequency: "monthly",
      effectiveFrom: "2026-09-01",
    }),
  });
  expect(created.status).toBe(201);
  return json<{ schedule: { id: string; amountMinor: number } }>(created);
}

type MissingBody = {
  missingEligible: Array<{
    studentProfileId: string;
    legalName: string;
    enrolStart: string;
    netAmountMinor: number;
    grossAmountMinor?: number;
    dueOn: string;
    feeScheduleName: string | null;
  }>;
  alreadyInvoiced: Array<{ studentProfileId: string; legalName: string }>;
  notEligible: Array<{ studentProfileId: string }>;
  catchUpInvoices: Array<{ id: string; reference: string; totalMinor: number; vatEnabled: boolean; vatAmountMinor: number }>;
  allEligibleInvoiced: boolean;
  createdCount?: number;
  skippedCount?: number;
  totalMinor?: number;
  proposedTotalMinor?: number;
};

describe("Finance late-joiner missing invoice catch-up", () => {
  const pools = testPools();
  const stripeCalls: StripeCall[] = [];
  const app = testApp(pools, {
    stripeFetchImpl: (async (url, init) => {
      const requestUrl = String(url);
      const body = String(init?.body ?? "");
      if (requestUrl.includes("/v1/checkout/sessions") || requestUrl.includes("/v1/account")) {
        stripeCalls.push({ url: requestUrl, body });
      }
      if (requestUrl.includes("/v1/account")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "acct_late_joiner", business_profile: { name: "Late Joiner School" } }),
        } as Response;
      }
      const id = `cs_lj_${randomUUID()}`;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id, url: `https://checkout.stripe.test/${id}`, payment_intent: `pi_${id}` }),
      } as Response;
    }) as typeof fetch,
  });

  beforeAll(async () => {
    await ensureMigrated();
  }, 60_000);

  afterAll(async () => {
    await closePools(pools);
  });

  it("detects a late joiner after an issued run, previews without mutating, and creates one catch-up invoice", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs);
    const original = await createStudent(app, hdrs, pools, school, {
      legalName: "Original Year 3",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      startedOn: "2026-09-01",
    });
    await createYear3Schedule(app, hdrs, seeded.yearId, seeded.year3Id);

    const preview = await json<{
      run: { id: string; status: string; itemCount: number; expectedTotalMinor: number };
      includedItems: Array<{ studentProfileId: string; invoiceId: string | null }>;
    }>(
      await app.request("/api/v1/finance/billing-runs/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: seeded.yearId,
          frequency: "monthly",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          dueOn: "2026-09-15",
          instalmentNumber: 1,
        }),
      }),
    );
    expect(preview.includedItems).toHaveLength(1);
    expect(preview.includedItems[0]!.studentProfileId).toBe(original.student.id);

    const confirmed = await json<{
      run: { id: string; status: string; itemCount: number };
      includedItems: Array<{ studentProfileId: string; invoiceId: string | null; netAmountMinor: number }>;
    }>(
      await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/confirm`, {
        method: "POST",
        headers: hdrs,
        body: "{}",
      }),
    );
    expect(confirmed.run.status === "confirmed" || confirmed.run.status === "issued").toBe(true);
    expect(confirmed.includedItems).toHaveLength(1);
    const originalInvoiceId = confirmed.includedItems[0]!.invoiceId;
    expect(originalInvoiceId).toBeTruthy();

    const again = await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(again.status).toBe(200);

    const eshaal = await createStudent(app, hdrs, pools, school, {
      legalName: "Eshaal Fatima",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      startedOn: "2026-09-07",
    });
    const parentEmail = `parent-eshaal-${suffix()}@example.com`;
    await inviteParent(app, hdrs, eshaal.student.id, parentEmail);

    const invoicesBeforePreview = await json<{ invoices: Array<{ id: string; studentProfileId?: string }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    const auditBefore = await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const rows = await client.query<{ n: string }>(
        `select count(*)::text as n from audit_events
          where organisation_id = $1 and action = 'finance.billing_run.catchup_issued'`,
        [school.orgId],
      );
      const invoices = await client.query<{ n: string }>(`select count(*)::text as n from school_invoices where organisation_id = $1`, [
        school.orgId,
      ]);
      const items = await client.query<{ n: string }>(
        `select count(*)::text as n from school_billing_run_items where billing_run_id = $1 and organisation_id = $2`,
        [preview.run.id, school.orgId],
      );
      return { audits: Number(rows.rows[0]!.n), invoices: Number(invoices.rows[0]!.n), items: Number(items.rows[0]!.n) };
    });

    const missingPreviewRes = await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/missing-invoices`, {
      headers: hdrs,
    });
    expect(missingPreviewRes.status).toBe(200);
    const missingPreview = await json<MissingBody>(missingPreviewRes);
    expect(missingPreview.missingEligible.map((item) => item.legalName)).toEqual(["Eshaal Fatima"]);
    expect(missingPreview.missingEligible[0]!.studentProfileId).toBe(eshaal.student.id);
    expect(missingPreview.missingEligible[0]!.enrolStart).toBe("2026-09-07");
    expect(missingPreview.missingEligible[0]!.netAmountMinor).toBe(200000);
    expect(missingPreview.missingEligible[0]!.grossAmountMinor).toBe(200000);
    expect(missingPreview.proposedTotalMinor).toBe(200000);
    expect(missingPreview.missingEligible[0]!.dueOn).toBe("2026-09-15");
    expect(missingPreview.alreadyInvoiced.some((item) => item.studentProfileId === original.student.id)).toBe(true);
    expect(missingPreview.allEligibleInvoiced).toBe(false);

    const afterPreview = await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const invoices = await client.query<{ n: string }>(`select count(*)::text as n from school_invoices where organisation_id = $1`, [
        school.orgId,
      ]);
      const audits = await client.query<{ n: string }>(
        `select count(*)::text as n from audit_events
          where organisation_id = $1 and action = 'finance.billing_run.catchup_issued'`,
        [school.orgId],
      );
      return { invoices: Number(invoices.rows[0]!.n), audits: Number(audits.rows[0]!.n) };
    });
    expect(afterPreview.invoices).toBe(auditBefore.invoices);
    expect(afterPreview.audits).toBe(auditBefore.audits);
    expect(invoicesBeforePreview.invoices).toHaveLength(auditBefore.invoices);

    const created = await json<MissingBody>(
      await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/missing-invoices`, {
        method: "POST",
        headers: hdrs,
        body: "{}",
      }),
    );
    expect(created.createdCount).toBe(1);
    expect(created.missingEligible).toEqual([]);
    expect(created.allEligibleInvoiced).toBe(true);
    expect(created.catchUpInvoices).toHaveLength(1);
    expect(created.totalMinor).toBe(200000);
    expect(created.catchUpInvoices[0]!.totalMinor).toBe(200000);
    expect(created.catchUpInvoices[0]!.vatEnabled).toBe(false);
    expect(created.catchUpInvoices[0]!.vatAmountMinor).toBe(0);

    const repeat = await json<MissingBody>(
      await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/missing-invoices`, {
        method: "POST",
        headers: hdrs,
        body: "{}",
      }),
    );
    expect(repeat.createdCount).toBe(0);
    expect(repeat.catchUpInvoices).toHaveLength(1);

    const concurrent = await Promise.all([
      app.request(`/api/v1/finance/billing-runs/${preview.run.id}/missing-invoices`, {
        method: "POST",
        headers: hdrs,
        body: "{}",
      }),
      app.request(`/api/v1/finance/billing-runs/${preview.run.id}/missing-invoices`, {
        method: "POST",
        headers: hdrs,
        body: "{}",
      }),
    ]);
    expect(concurrent.every((res) => res.status === 200)).toBe(true);
    const concurrentBodies = await Promise.all(concurrent.map((res) => json<MissingBody>(res)));
    expect(concurrentBodies.every((body) => (body.createdCount ?? 0) === 0)).toBe(true);

    const afterCreate = await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const invoices = await client.query<{ id: string; period_key: string; billing_run_id: string | null; total_minor: string }>(
        `select id::text, period_key, billing_run_id::text, total_minor::text
           from school_invoices where organisation_id = $1 and status <> 'void' order by created_at`,
        [school.orgId],
      );
      const items = await client.query<{ student_profile_id: string }>(
        `select student_profile_id::text from school_billing_run_items
          where billing_run_id = $1 and organisation_id = $2`,
        [preview.run.id, school.orgId],
      );
      const tuitionLines = await client.query<{ student_profile_id: string; amount_minor: string }>(
        `select l.student_profile_id::text, l.amount_minor::text
           from school_invoice_lines l
           join school_invoices i on i.id = l.invoice_id
          where l.organisation_id = $1 and l.kind = 'tuition' and i.status <> 'void'`,
        [school.orgId],
      );
      const originalLines = tuitionLines.rows.filter((row) => row.student_profile_id === original.student.id);
      const eshaalLines = tuitionLines.rows.filter((row) => row.student_profile_id === eshaal.student.id);
      const catchupAudit = await client.query<{ after_data: Record<string, unknown> }>(
        `select after_data from audit_events
          where organisation_id = $1
            and action = 'finance.billing_run.catchup_issued'
            and coalesce((after_data->>'invoiceCount')::int, 0) > 0
          order by occurred_at asc
          limit 1`,
        [school.orgId],
      );
      return {
        invoices: invoices.rows,
        itemPupilIds: items.rows.map((row) => row.student_profile_id),
        originalLines,
        eshaalLines,
        catchupAudit: catchupAudit.rows[0]?.after_data ?? {},
      };
    });
    expect(afterCreate.invoices).toHaveLength(2);
    expect(afterCreate.itemPupilIds).toEqual([original.student.id]);
    expect(afterCreate.originalLines).toHaveLength(1);
    expect(afterCreate.eshaalLines).toHaveLength(1);
    expect(Number(afterCreate.eshaalLines[0]!.amount_minor)).toBe(200000);
    expect(afterCreate.catchupAudit.source).toBe("missing_catchup");
    expect(afterCreate.catchupAudit.invoiceCount).toBe(1);
    expect(afterCreate.catchupAudit.totalMinor).toBe(200000);
    expect(JSON.stringify(afterCreate.catchupAudit)).not.toMatch(/medical|allergy|safeguarding/i);

    const accounts = await json<{ accounts: Array<{ outstandingMinor: number; pupilNames: string }> }>(
      await app.request("/api/v1/finance/accounts", { headers: hdrs }),
    );
    const eshaalAccount = accounts.accounts.find((account) => account.pupilNames.includes("Eshaal"));
    expect(eshaalAccount?.outstandingMinor).toBe(200000);

    const parentToken = await login(app, parentEmail, "parent-pass-1");
    const parentFinance = await json<{ invoices: Array<{ id: string; totalMinor: number }>; outstandingMinor: number }>(
      await app.request("/api/v1/parent/finance", { headers: headers(parentToken, school.orgId) }),
    );
    expect(parentFinance.invoices.some((invoice) => invoice.id === created.catchUpInvoices[0]!.id)).toBe(true);
    expect(parentFinance.outstandingMinor).toBe(200000);

    const pdf = await app.request(`/api/v1/finance/invoices/${created.catchUpInvoices[0]!.id}/pdf`, { headers: hdrs });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");

    const savedStripe = await app.request("/api/v1/finance/payment-provider", {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        mode: "test",
        secretKey: "sk_test_late_joiner_aaaaaaaa",
        webhookSecret: "whsec_late_joiner",
        enabled: true,
      }),
    });
    expect(savedStripe.status).toBe(200);
    const stripeConfig = await json<{ paymentProvider: { webhookPath: string } }>(savedStripe);
    stripeCalls.length = 0;
    const catchUpInvoiceId = created.catchUpInvoices[0]!.id;
    const checkout = await app.request(`/api/v1/parent/finance/invoices/${catchUpInvoiceId}/checkout`, {
      method: "POST",
      headers: headers(parentToken, school.orgId),
      body: JSON.stringify({ idempotencyKey: `lj-pay-${suffix()}` }),
    });
    expect(checkout.status).toBe(200);
    const checkoutBody = await json<{ checkoutUrl: string }>(checkout);
    expect(checkoutBody.checkoutUrl).toContain("https://checkout.stripe.test/");
    const firstSession = await pools.owner.query<{ id: string; provider_session_id: string; amount_minor: string }>(
      `select id, provider_session_id, amount_minor::text from school_payment_sessions
        where organisation_id = $1 and invoice_id = $2 order by created_at desc limit 1`,
      [school.orgId, catchUpInvoiceId],
    );
    await pools.owner.query(`update school_payment_sessions set expires_at = now() - interval '1 hour' where id = $1`, [
      firstSession.rows[0]!.id,
    ]);
    const rotated = await app.request(`/api/v1/parent/finance/invoices/${catchUpInvoiceId}/checkout`, {
      method: "POST",
      headers: headers(parentToken, school.orgId),
      body: JSON.stringify({ idempotencyKey: `lj-stale-${suffix()}` }),
    });
    expect(rotated.status).toBe(200);
    const paidEvent = {
      id: `evt_lj_${suffix()}`,
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: firstSession.rows[0]!.provider_session_id,
          payment_status: "paid",
          payment_intent: `pi_lj_${suffix()}`,
          amount_total: Number(firstSession.rows[0]!.amount_minor),
          currency: "gbp",
        },
      },
    };
    const paidBody = JSON.stringify(paidEvent);
    const webhook = await app.request(stripeConfig.paymentProvider.webhookPath, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_late_joiner", paidBody) },
      body: paidBody,
    });
    expect(webhook.status).toBe(200);
    const settled = await json<{
      invoice: { outstandingMinor: number; paidMinor: number; status: string };
      payments: Array<{ amountMinor: number }>;
    }>(await app.request(`/api/v1/finance/invoices/${catchUpInvoiceId}`, { headers: hdrs }));
    expect(settled.invoice.outstandingMinor).toBe(0);
    expect(settled.invoice.paidMinor).toBe(Number(firstSession.rows[0]!.amount_minor));
    expect(settled.invoice.status).toBe("paid");
    expect(settled.payments[0]?.amountMinor).toBe(Number(firstSession.rows[0]!.amount_minor));
    const receipts = await pools.owner.query<{ amount_minor: string }>(
      `select (snapshot->>'amountMinor')::text as amount_minor
         from school_payment_receipts
        where organisation_id = $1 and invoice_id = $2`,
      [school.orgId, catchUpInvoiceId],
    );
    expect(Number(receipts.rows[0]?.amount_minor)).toBe(Number(firstSession.rows[0]!.amount_minor));
    const parentAfterPay = await json<{ outstandingMinor: number }>(
      await app.request("/api/v1/parent/finance", { headers: headers(parentToken, school.orgId) }),
    );
    expect(parentAfterPay.outstandingMinor).toBe(0);
    const replay = await app.request(stripeConfig.paymentProvider.webhookPath, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_late_joiner", paidBody) },
      body: paidBody,
    });
    expect(replay.status).toBe(200);
    expect((await json<{ replayed?: boolean }>(replay)).replayed).toBe(true);
    const newSession = await pools.owner.query<{ provider_session_id: string; amount_minor: string }>(
      `select provider_session_id, amount_minor::text from school_payment_sessions
        where organisation_id = $1 and invoice_id = $2 order by created_at desc limit 1`,
      [school.orgId, catchUpInvoiceId],
    );
    const extraEvent = {
      id: `evt_lj_extra_${suffix()}`,
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: newSession.rows[0]!.provider_session_id,
          payment_status: "paid",
          payment_intent: `pi_lj_extra_${suffix()}`,
          amount_total: Number(newSession.rows[0]!.amount_minor),
          currency: "gbp",
        },
      },
    };
    const extraBody = JSON.stringify(extraEvent);
    const extraRes = await app.request(stripeConfig.paymentProvider.webhookPath, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_late_joiner", extraBody) },
      body: extraBody,
    });
    expect(extraRes.status).toBe(200);
    expect((await json<{ review?: boolean }>(extraRes)).review).toBe(true);
    const afterExtra = await json<{ invoice: { paidMinor: number } }>(
      await app.request(`/api/v1/finance/invoices/${catchUpInvoiceId}`, { headers: hdrs }),
    );
    expect(afterExtra.invoice.paidMinor).toBe(Number(firstSession.rows[0]!.amount_minor));
    const other = await createSchool(pools.owner, `x-${suffix()}`);
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const otherHdrs = headers(otherToken, other.orgId);
    const otherStripe = await app.request("/api/v1/finance/payment-provider", {
      method: "PUT",
      headers: otherHdrs,
      body: JSON.stringify({
        mode: "test",
        secretKey: "sk_test_other_joiner_bbbbbbbb",
        webhookSecret: "whsec_other_joiner",
        enabled: true,
      }),
    });
    expect(otherStripe.status).toBe(200);
    const otherPath = (await json<{ paymentProvider: { webhookPath: string } }>(otherStripe)).paymentProvider.webhookPath;
    const crossed = await app.request(otherPath, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature("whsec_other_joiner", paidBody) },
      body: paidBody,
    });
    expect(crossed.status).toBe(400);
    expect((await json<{ error: { code: string } }>(crossed)).error.code).toBe("organisation_mismatch");

    const october = await json<{
      includedItems: Array<{ studentProfileId: string; legalName: string; netAmountMinor: number }>;
    }>(
      await app.request("/api/v1/finance/billing-runs/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: seeded.yearId,
          frequency: "monthly",
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          dueOn: "2026-10-15",
          instalmentNumber: 2,
        }),
      }),
    );
    const octoberIds = october.includedItems.map((item) => item.studentProfileId).sort();
    expect(octoberIds).toEqual([original.student.id, eshaal.student.id].sort());
    expect(october.includedItems.every((item) => item.netAmountMinor === 200000)).toBe(true);
  }, 60_000);

  it("excludes the wrong year group and an enrolment that starts after the billing period", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs);
    await createStudent(app, hdrs, pools, school, {
      legalName: "Original Year 3",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      startedOn: "2026-09-01",
    });
    await createYear3Schedule(app, hdrs, seeded.yearId, seeded.year3Id);
    const preview = await json<{ run: { id: string } }>(
      await app.request("/api/v1/finance/billing-runs/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: seeded.yearId,
          frequency: "monthly",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          dueOn: "2026-09-15",
        }),
      }),
    );
    expect(
      (await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/confirm`, { method: "POST", headers: hdrs, body: "{}" }))
        .status,
    ).toBe(200);

    const year5 = await createStudent(app, hdrs, pools, school, {
      legalName: "Year 5 Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year5Id,
      startedOn: "2026-09-07",
    });
    const octoberJoin = await createStudent(app, hdrs, pools, school, {
      legalName: "October Joiner",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      startedOn: "2026-10-01",
    });

    const missing = await json<MissingBody>(
      await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/missing-invoices`, { headers: hdrs }),
    );
    expect(missing.missingEligible).toEqual([]);
    expect(missing.missingEligible.some((item) => item.studentProfileId === year5.student.id)).toBe(false);
    expect(missing.missingEligible.some((item) => item.studentProfileId === octoberJoin.student.id)).toBe(false);
    expect(missing.allEligibleInvoiced).toBe(true);
  });

  it("charges the full instalment for a within-period enrolment under the default full policy", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs);
    await createStudent(app, hdrs, pools, school, {
      legalName: "Original Year 3",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      startedOn: "2026-09-01",
    });
    await createYear3Schedule(app, hdrs, seeded.yearId, seeded.year3Id);
    const preview = await json<{ run: { id: string } }>(
      await app.request("/api/v1/finance/billing-runs/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: seeded.yearId,
          frequency: "monthly",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          dueOn: "2026-09-15",
        }),
      }),
    );
    await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/confirm`, { method: "POST", headers: hdrs, body: "{}" });
    await createStudent(app, hdrs, pools, school, {
      legalName: "Mid-month joiner",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      startedOn: "2026-09-07",
    });
    const missing = await json<MissingBody>(
      await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/missing-invoices`, { headers: hdrs }),
    );
    expect(missing.missingEligible).toHaveLength(1);
    expect(missing.missingEligible[0]!.netAmountMinor).toBe(200000);
    expect(missing.missingEligible[0]!.netAmountMinor % 1).toBe(0);
  });

  it("does not use an archived schedule for catch-up generation", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs);
    await createStudent(app, hdrs, pools, school, {
      legalName: "Original Year 3",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      startedOn: "2026-09-01",
    });
    const schedule = await createYear3Schedule(app, hdrs, seeded.yearId, seeded.year3Id);
    const preview = await json<{ run: { id: string } }>(
      await app.request("/api/v1/finance/billing-runs/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: seeded.yearId,
          frequency: "monthly",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          dueOn: "2026-09-15",
        }),
      }),
    );
    await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/confirm`, { method: "POST", headers: hdrs, body: "{}" });
    expect(
      (
        await app.request(`/api/v1/finance/fee-schedules/${schedule.schedule.id}`, {
          method: "PATCH",
          headers: hdrs,
          body: JSON.stringify({ isActive: false, effectiveUntil: "2026-09-30" }),
        })
      ).status,
    ).toBe(200);
    await createStudent(app, hdrs, pools, school, {
      legalName: "Eshaal Fatima",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      startedOn: "2026-09-07",
    });
    const missing = await json<MissingBody>(
      await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/missing-invoices`, { headers: hdrs }),
    );
    expect(missing.missingEligible).toEqual([]);
    const created = await json<MissingBody>(
      await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/missing-invoices`, {
        method: "POST",
        headers: hdrs,
        body: "{}",
      }),
    );
    expect(created.createdCount).toBe(0);
  });

  it("rejects cross-tenant catch-up of another school's run or pupil", async () => {
    const schoolA = await createSchool(pools.owner, `a-${suffix()}`);
    const schoolB = await createSchool(pools.owner, `b-${suffix()}`);
    const tokenA = await login(app, schoolA.adminEmail, "password-12x");
    const tokenB = await login(app, schoolB.adminEmail, "password-12x");
    const hdrsA = headers(tokenA, schoolA.orgId);
    const hdrsB = headers(tokenB, schoolB.orgId);
    const seededA = await seedYear(app, hdrsA);
    const seededB = await seedYear(app, hdrsB);
    await enableTuition(app, hdrsA);
    await enableTuition(app, hdrsB);
    await createStudent(app, hdrsA, pools, schoolA, {
      legalName: "School A pupil",
      academicYearId: seededA.yearId,
      yearGroupId: seededA.year3Id,
      classId: seededA.classAId,
      startedOn: "2026-09-01",
    });
    await createYear3Schedule(app, hdrsA, seededA.yearId, seededA.year3Id, "School A Year 3");
    await createStudent(app, hdrsB, pools, schoolB, {
      legalName: "School B pupil",
      academicYearId: seededB.yearId,
      yearGroupId: seededB.year3Id,
      classId: seededB.classAId,
      startedOn: "2026-09-07",
    });
    await createYear3Schedule(app, hdrsB, seededB.yearId, seededB.year3Id, "School B Year 3");
    const previewA = await json<{ run: { id: string } }>(
      await app.request("/api/v1/finance/billing-runs/preview", {
        method: "POST",
        headers: hdrsA,
        body: JSON.stringify({
          academicYearId: seededA.yearId,
          frequency: "monthly",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          dueOn: "2026-09-15",
        }),
      }),
    );
    await app.request(`/api/v1/finance/billing-runs/${previewA.run.id}/confirm`, { method: "POST", headers: hdrsA, body: "{}" });

    expect((await app.request(`/api/v1/finance/billing-runs/${previewA.run.id}/missing-invoices`, { headers: hdrsB })).status).toBe(
      404,
    );
    expect(
      (
        await app.request(`/api/v1/finance/billing-runs/${previewA.run.id}/missing-invoices`, {
          method: "POST",
          headers: hdrsB,
          body: "{}",
        })
      ).status,
    ).toBe(404);
    expect(
      (await app.request(`/api/v1/finance/billing-runs/${previewA.run.id}/missing-invoices`, { headers: headers(tokenA, schoolB.orgId) }))
        .status,
    ).toBeGreaterThanOrEqual(400);

    await withTenantContext(pools.app, schoolB.adminId, schoolB.orgId, async (client) => {
      const leaked = await client.query("select * from school_invoices");
      expect(leaked.rows).toEqual([]);
    });
  });

  it("keeps VAT snapshots unchanged on catch-up invoices", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs, {
      vatEnabled: true,
      vatRegistrationNumber: "GB123456789",
      vatRatePercent: 20,
      vatPricesInclusive: false,
    });
    await createStudent(app, hdrs, pools, school, {
      legalName: "Original Year 3",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      startedOn: "2026-09-01",
    });
    await createYear3Schedule(app, hdrs, seeded.yearId, seeded.year3Id);
    const preview = await json<{ run: { id: string } }>(
      await app.request("/api/v1/finance/billing-runs/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: seeded.yearId,
          frequency: "monthly",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          dueOn: "2026-09-15",
        }),
      }),
    );
    const confirmed = await json<{
      includedItems: Array<{ invoiceId: string | null }>;
    }>(
      await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/confirm`, { method: "POST", headers: hdrs, body: "{}" }),
    );
    const originalInvoice = await json<{
      invoice: { vatEnabled: boolean; vatRateBps: number | null; vatAmountMinor: number; totalMinor: number; vatPricesInclusive: boolean | null };
    }>(await app.request(`/api/v1/finance/invoices/${confirmed.includedItems[0]!.invoiceId}`, { headers: hdrs }));
    await createStudent(app, hdrs, pools, school, {
      legalName: "Eshaal Fatima",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      startedOn: "2026-09-07",
    });
    const missingPreview = await json<MissingBody>(
      await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/missing-invoices`, { headers: hdrs }),
    );
    expect(missingPreview.missingEligible).toHaveLength(1);
    expect(missingPreview.missingEligible[0]!.netAmountMinor).toBe(200000);
    expect(missingPreview.missingEligible[0]!.grossAmountMinor).toBe(240000);
    expect(missingPreview.proposedTotalMinor).toBe(240000);
    const created = await json<MissingBody>(
      await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/missing-invoices`, {
        method: "POST",
        headers: hdrs,
        body: "{}",
      }),
    );
    expect(created.createdCount).toBe(1);
    expect(created.totalMinor).toBe(240000);
    expect(created.catchUpInvoices[0]!.totalMinor).toBe(240000);
    const catchUp = await json<{
      invoice: { vatEnabled: boolean; vatRateBps: number | null; vatAmountMinor: number; totalMinor: number; vatPricesInclusive: boolean | null };
    }>(await app.request(`/api/v1/finance/invoices/${created.catchUpInvoices[0]!.id}`, { headers: hdrs }));
    expect(catchUp.invoice.vatEnabled).toBe(originalInvoice.invoice.vatEnabled);
    expect(catchUp.invoice.vatRateBps).toBe(originalInvoice.invoice.vatRateBps);
    expect(catchUp.invoice.vatPricesInclusive).toBe(false);
    expect(originalInvoice.invoice.vatPricesInclusive).toBe(false);
    expect(catchUp.invoice.totalMinor).toBe(originalInvoice.invoice.totalMinor);
    expect(catchUp.invoice.totalMinor).toBe(240000);
    expect(catchUp.invoice.vatAmountMinor).toBe(originalInvoice.invoice.vatAmountMinor);
    expect(catchUp.invoice.vatAmountMinor).toBe(40000);
    expect(created.totalMinor).toBe(catchUp.invoice.totalMinor);
    expect(catchUp.invoice.totalMinor % 1).toBe(0);
  });

  it("rejects catch-up on a preview that has not been issued", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs);
    await createStudent(app, hdrs, pools, school, {
      legalName: "Original Year 3",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    await createYear3Schedule(app, hdrs, seeded.yearId, seeded.year3Id);
    const preview = await json<{ run: { id: string } }>(
      await app.request("/api/v1/finance/billing-runs/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: seeded.yearId,
          frequency: "monthly",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
        }),
      }),
    );
    expect((await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/missing-invoices`, { headers: hdrs })).status).toBe(
      409,
    );
    expect(
      (
        await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/missing-invoices`, {
          method: "POST",
          headers: hdrs,
          body: "{}",
        })
      ).status,
    ).toBe(409);
  });
});
