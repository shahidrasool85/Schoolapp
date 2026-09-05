import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractPdfText } from "@schoolapp/core";
import { closePools } from "@schoolapp/db";
import { addMembership, ensureMigrated, insertUser, login, testApp, testPools } from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);

type StripeCall = { url: string; body: string };

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function headers(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    "Content-Type": "application/json",
  };
}

describe("School VAT invoices", () => {
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
          json: async () => ({ id: "acct_vat", business_profile: { name: "VAT School" } }),
        } as Response;
      }
      const id = `cs_vat_${randomUUID()}`;
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

  async function issueMonthlyInvoice(input: {
    orgName: string;
    amountMinor: number;
    vat?: {
      vatEnabled: boolean;
      vatRegistrationNumber?: string | null;
      vatRatePercent?: number;
      vatPricesInclusive?: boolean;
    };
  }) {
    const id = suffix();
    const adminId = await insertUser(pools.owner, {
      email: `admin-${id}@example.com`,
      password: "password-12x",
      fullName: "Admin",
      kind: "staff",
    });
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, legal_name, status) values ($1, $2, $3, 'active') returning id",
      [`vat-${id}`, input.orgName, `${input.orgName} Ltd`],
    );
    const orgId = org.rows[0]!.id;
    await pools.owner.query(
      `insert into organisation_settings (organisation_id, address_line_1, city, postcode)
       values ($1,$2,$3,$4)`,
      [orgId, "1 School Road", "Solihull", "B90 1AA"],
    );
    await addMembership(pools.owner, orgId, adminId, "school.admin");
    const token = await login(app, `admin-${id}@example.com`, "password-12x");
    const hdrs = headers(token, orgId);
    const settingsRes = await app.request("/api/v1/finance/settings", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({
        tuitionEnabled: true,
        invoicePrefix: "VAT-INV",
        receiptPrefix: "VAT-RCT",
        defaultBillingFrequency: "monthly",
        ...input.vat,
      }),
    });
    expect(settingsRes.status).toBe(200);
    const settings = await json<{
      settings: {
        vatEnabled: boolean;
        vatRegistrationNumber: string | null;
        vatPricesInclusive: boolean;
        vatRatePercent: number;
      };
    }>(settingsRes);
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
    const student = await json<{ student: { id: string } }>(
      await app.request("/api/v1/students", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          legalName: "Amina Rasool",
          academicYearId: year.academicYear.id,
          yearGroupId: year3.id,
        }),
      }),
    );
    const schedule = await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Year 3 tuition",
        academicYearId: year.academicYear.id,
        amountMinor: input.amountMinor,
        billingFrequency: "monthly",
        effectiveFrom: "2026-01-01",
      }),
    });
    expect(schedule.status).toBe(201);
    const previewRes = await app.request("/api/v1/finance/billing-runs/preview", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: year.academicYear.id,
        frequency: "monthly",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        dueOn: "2026-09-15",
      }),
    });
    expect(previewRes.status).toBe(201);
    const preview = await json<{ run: { id: string; expectedTotalMinor: number } }>(previewRes);
    const confirmed = await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(confirmed.status).toBe(200);
    const invoices = await json<{
      invoices: Array<{
        id: string;
        reference: string;
        totalMinor: number;
        outstandingMinor: number;
        vatEnabled: boolean;
        vatNetMinor: number;
        vatAmountMinor: number;
      }>;
    }>(await app.request("/api/v1/finance/invoices", { headers: hdrs }));
    expect(invoices.invoices).toHaveLength(1);
    return {
      orgId,
      hdrs,
      token,
      id,
      studentId: student.student.id,
      settings: settings.settings,
      invoice: invoices.invoices[0]!,
      previewExpectedMinor: preview.run.expectedTotalMinor,
    };
  }

  async function storedVat(invoiceId: string) {
    const invoice = await pools.owner.query<{
      vat_enabled: boolean;
      vat_registration_number: string | null;
      vat_rate_bps: number | null;
      vat_prices_inclusive: boolean | null;
      vat_net_minor: string;
      vat_amount_minor: string;
      total_minor: string;
      outstanding_minor: string;
      display_snapshot: Record<string, unknown> | null;
    }>(
      `select vat_enabled, vat_registration_number, vat_rate_bps, vat_prices_inclusive,
              vat_net_minor, vat_amount_minor, total_minor, outstanding_minor, display_snapshot
         from school_invoices where id = $1`,
      [invoiceId],
    );
    const line = await pools.owner.query<{
      amount_minor: string;
      vat_treatment: string;
      vat_rate_bps: number | null;
      vat_net_minor: string;
      vat_amount_minor: string;
      vat_gross_minor: string;
    }>(
      `select amount_minor, vat_treatment, vat_rate_bps, vat_net_minor, vat_amount_minor, vat_gross_minor
         from school_invoice_lines where invoice_id = $1 order by sort_order limit 1`,
      [invoiceId],
    );
    return { invoice: invoice.rows[0]!, line: line.rows[0]! };
  }

  async function pdfText(invoiceId: string, hdrs: ReturnType<typeof headers>) {
    const res = await app.request(`/api/v1/finance/invoices/${invoiceId}/pdf`, { headers: hdrs });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    return extractPdfText(new Uint8Array(await res.arrayBuffer()));
  }

  function expectVatPdf(text: string, input: { vatNumber: string }) {
    const lines = text.split("\n");
    expect(lines).toContain("VAT invoice");
    expect(text).toContain("VAT NUMBER");
    expect(text).toContain(input.vatNumber);
    expect(text).toContain("NET");
    expect(text).toContain("VAT %");
    expect(text).toContain("GROSS");
    expect(text).toContain("20%");
    expect(text).toContain("VAT at 20%");
    expect(text).toContain("Invoice total");
    expect(text).toMatch(/£500\.00/);
    expect(text).toMatch(/£100\.00/);
    expect(text).toMatch(/£600\.00/);
    expect(lines).not.toContain("This is not a VAT invoice.");
  }

  it("defaults to non-VAT and keeps £500 fees as £500", async () => {
    const issued = await issueMonthlyInvoice({ orgName: "No VAT School", amountMinor: 50_000 });
    expect(issued.settings.vatEnabled).toBe(false);
    expect(issued.invoice.totalMinor).toBe(50_000);
    expect(issued.invoice.outstandingMinor).toBe(50_000);
    expect(issued.invoice.vatEnabled).toBe(false);
    expect(issued.previewExpectedMinor).toBe(50_000);
    const stored = await storedVat(issued.invoice.id);
    expect(stored.invoice.vat_enabled).toBe(false);
    expect(Number(stored.invoice.vat_amount_minor)).toBe(0);
    expect(Number(stored.invoice.total_minor)).toBe(50_000);
    const text = await pdfText(issued.invoice.id, issued.hdrs);
    expect(text.split("\n")).toContain("This is not a VAT invoice.");
    expect(text.split("\n")).not.toContain("VAT invoice");
  });

  it("adds exclusive VAT so £500 at 20% becomes £600 gross", async () => {
    const issued = await issueMonthlyInvoice({
      orgName: "Exclusive VAT School",
      amountMinor: 50_000,
      vat: {
        vatEnabled: true,
        vatRegistrationNumber: "GB123456789",
        vatRatePercent: 20,
        vatPricesInclusive: false,
      },
    });
    expect(issued.invoice.totalMinor).toBe(60_000);
    expect(issued.invoice.outstandingMinor).toBe(60_000);
    expect(issued.invoice.vatEnabled).toBe(true);
    expect(issued.invoice.vatNetMinor).toBe(50_000);
    expect(issued.invoice.vatAmountMinor).toBe(10_000);
    expect(issued.previewExpectedMinor).toBe(60_000);
    const stored = await storedVat(issued.invoice.id);
    expect(stored.invoice.vat_enabled).toBe(true);
    expect(stored.invoice.vat_registration_number).toBe("GB123456789");
    expect(Number(stored.invoice.vat_rate_bps)).toBe(2000);
    expect(stored.invoice.vat_prices_inclusive).toBe(false);
    expect(Number(stored.invoice.vat_net_minor)).toBe(50_000);
    expect(Number(stored.invoice.vat_amount_minor)).toBe(10_000);
    expect(Number(stored.invoice.total_minor)).toBe(60_000);
    expect(Number(stored.line.amount_minor)).toBe(50_000);
    expect(Number(stored.line.vat_net_minor)).toBe(50_000);
    expect(Number(stored.line.vat_amount_minor)).toBe(10_000);
    expect(Number(stored.line.vat_gross_minor)).toBe(60_000);
    const text = await pdfText(issued.invoice.id, issued.hdrs);
    expectVatPdf(text, { vatNumber: "GB123456789" });

    await app.request("/api/v1/finance/settings", {
      method: "PATCH",
      headers: issued.hdrs,
      body: JSON.stringify({
        vatRegistrationNumber: "GB-CHANGED",
        vatRatePercent: 5,
        vatEnabled: false,
      }),
    });
    const reprint = await pdfText(issued.invoice.id, issued.hdrs);
    expectVatPdf(reprint, { vatNumber: "GB123456789" });
    expect(reprint).not.toContain("GB-CHANGED");
  });

  it("issues an inclusive £600 VAT invoice, stores net/VAT/gross, and Stripe collects £600", async () => {
    const issued = await issueMonthlyInvoice({
      orgName: "Inclusive VAT School",
      amountMinor: 60_000,
      vat: {
        vatEnabled: true,
        vatRegistrationNumber: "GB888888888",
        vatRatePercent: 20,
        vatPricesInclusive: true,
      },
    });
    expect(issued.settings.vatEnabled).toBe(true);
    expect(issued.settings.vatPricesInclusive).toBe(true);
    expect(issued.settings.vatRatePercent).toBe(20);
    expect(issued.invoice.totalMinor).toBe(60_000);
    expect(issued.invoice.outstandingMinor).toBe(60_000);
    expect(issued.invoice.vatEnabled).toBe(true);
    expect(issued.invoice.vatNetMinor).toBe(50_000);
    expect(issued.invoice.vatAmountMinor).toBe(10_000);
    expect(issued.previewExpectedMinor).toBe(60_000);

    const detail = await json<{
      invoice: {
        vatEnabled: boolean;
        vatRegistrationNumber: string | null;
        vatRateBps: number | null;
        vatPricesInclusive: boolean | null;
        vatNetMinor: number;
        vatAmountMinor: number;
        totalMinor: number;
        outstandingMinor: number;
      };
      lines: Array<{
        amountMinor: number;
        vatNetMinor: number;
        vatAmountMinor: number;
        vatGrossMinor: number;
      }>;
    }>(await app.request(`/api/v1/finance/invoices/${issued.invoice.id}`, { headers: issued.hdrs }));
    expect(detail.invoice.vatEnabled).toBe(true);
    expect(detail.invoice.vatRegistrationNumber).toBe("GB888888888");
    expect(detail.invoice.vatRateBps).toBe(2000);
    expect(detail.invoice.vatPricesInclusive).toBe(true);
    expect(detail.invoice.vatNetMinor).toBe(50_000);
    expect(detail.invoice.vatAmountMinor).toBe(10_000);
    expect(detail.invoice.totalMinor).toBe(60_000);
    expect(detail.invoice.outstandingMinor).toBe(60_000);
    expect(detail.lines[0]).toMatchObject({
      amountMinor: 60_000,
      vatNetMinor: 50_000,
      vatAmountMinor: 10_000,
      vatGrossMinor: 60_000,
    });

    const stored = await storedVat(issued.invoice.id);
    expect(stored.invoice.vat_enabled).toBe(true);
    expect(stored.invoice.vat_registration_number).toBe("GB888888888");
    expect(Number(stored.invoice.vat_rate_bps)).toBe(2000);
    expect(stored.invoice.vat_prices_inclusive).toBe(true);
    expect(Number(stored.invoice.vat_net_minor)).toBe(50_000);
    expect(Number(stored.invoice.vat_amount_minor)).toBe(10_000);
    expect(Number(stored.invoice.total_minor)).toBe(60_000);
    expect(Number(stored.invoice.outstanding_minor)).toBe(60_000);
    expect(Number(stored.line.amount_minor)).toBe(60_000);
    expect(Number(stored.line.vat_net_minor)).toBe(50_000);
    expect(Number(stored.line.vat_amount_minor)).toBe(10_000);
    expect(Number(stored.line.vat_gross_minor)).toBe(60_000);
    expect(stored.invoice.display_snapshot?.vatInvoice).toBe(true);
    expect(stored.invoice.display_snapshot?.vatRegistrationNumber).toBe("GB888888888");
    expect(stored.invoice.display_snapshot?.vatNetMinor).toBe(50_000);
    expect(stored.invoice.display_snapshot?.vatAmountMinor).toBe(10_000);
    expect(stored.invoice.display_snapshot?.amountMinor).toBe(60_000);

    const text = await pdfText(issued.invoice.id, issued.hdrs);
    expectVatPdf(text, { vatNumber: "GB888888888" });

    const parentEmail = `parent-${issued.id}@example.com`;
    const guardian = await json<{ invitationToken: string | null }>(
      await app.request(`/api/v1/students/${issued.studentId}/guardians`, {
        method: "POST",
        headers: issued.hdrs,
        body: JSON.stringify({
          email: parentEmail,
          fullName: "Pat Parent",
          relationship: "mother",
          portalAccess: true,
          hasParentalResponsibility: true,
        }),
      }),
    );
    if (guardian.invitationToken) {
      await app.request("/api/v1/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: guardian.invitationToken, fullName: "Pat Parent", password: "parent-pass-1" }),
      });
    }
    const savedStripe = await app.request("/api/v1/finance/payment-provider", {
      method: "PUT",
      headers: issued.hdrs,
      body: JSON.stringify({
        mode: "test",
        secretKey: "sk_test_vat_inclusive_aaaaaaaa",
        webhookSecret: "whsec_vat_inclusive",
        enabled: true,
      }),
    });
    expect(savedStripe.status).toBe(200);
    const parentToken = await login(app, parentEmail, "parent-pass-1");
    stripeCalls.length = 0;
    const checkout = await app.request(`/api/v1/parent/finance/invoices/${issued.invoice.id}/checkout`, {
      method: "POST",
      headers: headers(parentToken, issued.orgId),
      body: JSON.stringify({ idempotencyKey: `vat-inc-${issued.id}` }),
    });
    expect(checkout.status).toBe(200);
    const session = await json<{ checkoutUrl: string; sessionId: string }>(checkout);
    expect(session.checkoutUrl).toContain("https://checkout.stripe.test/");
    const posted = stripeCalls.find((call) => call.url.includes("/v1/checkout/sessions"));
    expect(posted).toBeTruthy();
    const params = new URLSearchParams(posted!.body);
    expect(params.get("line_items[0][price_data][unit_amount]")).toBe("60000");
    expect(params.get("managed_payments[enabled]")).toBe("false");
    expect(params.has("payment_method_types[0]")).toBe(false);
    expect(posted!.body).not.toMatch(/payment_method_types/);
    expect(params.has("automatic_tax[enabled]")).toBe(false);
    expect(posted!.body).not.toMatch(/automatic_tax/);
    expect(params.has("line_items[0][price_data][product_data][tax_code]")).toBe(false);
    expect(params.has("line_items[0][price_data][tax_behavior]")).toBe(false);
    expect(posted!.body).not.toMatch(/tax_code|tax_behavior/);
  });

  it("does not convert a pre-VAT invoice after VAT is enabled later", async () => {
    const issued = await issueMonthlyInvoice({ orgName: "Legacy then VAT School", amountMinor: 60_000 });
    expect(issued.invoice.vatEnabled).toBe(false);
    expect(issued.invoice.totalMinor).toBe(60_000);
    await app.request("/api/v1/finance/settings", {
      method: "PATCH",
      headers: issued.hdrs,
      body: JSON.stringify({
        vatEnabled: true,
        vatRegistrationNumber: "GB111111111",
        vatRatePercent: 20,
        vatPricesInclusive: true,
      }),
    });
    const later = await json<{
      invoice: { vatEnabled: boolean; totalMinor: number; vatAmountMinor: number; outstandingMinor: number };
    }>(await app.request(`/api/v1/finance/invoices/${issued.invoice.id}`, { headers: issued.hdrs }));
    expect(later.invoice.vatEnabled).toBe(false);
    expect(later.invoice.totalMinor).toBe(60_000);
    expect(later.invoice.vatAmountMinor).toBe(0);
    expect(later.invoice.outstandingMinor).toBe(60_000);
    const text = await pdfText(issued.invoice.id, issued.hdrs);
    expect(text.split("\n")).toContain("This is not a VAT invoice.");
    expect(text.split("\n")).not.toContain("VAT invoice");
    expect(text).not.toContain("GB111111111");
    expect(text).not.toContain("VAT NUMBER");
    expect(text).not.toContain("VAT at 20%");
  });

  it("rejects enabling VAT without a registration number", async () => {
    const id = suffix();
    const adminId = await insertUser(pools.owner, {
      email: `admin-${id}@example.com`,
      password: "password-12x",
      fullName: "Admin",
      kind: "staff",
    });
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, legal_name, status) values ($1, $2, $3, 'active') returning id",
      [`vat-bad-${id}`, "Incomplete VAT School", "Incomplete VAT School Ltd"],
    );
    await addMembership(pools.owner, org.rows[0]!.id, adminId, "school.admin");
    const token = await login(app, `admin-${id}@example.com`, "password-12x");
    const res = await app.request("/api/v1/finance/settings", {
      method: "PATCH",
      headers: headers(token, org.rows[0]!.id),
      body: JSON.stringify({ vatEnabled: true, vatRatePercent: 20 }),
    });
    expect(res.status).toBe(400);
  });
});
