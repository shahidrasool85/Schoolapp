import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractPdfText } from "@schoolapp/core";
import { closePools } from "@schoolapp/db";
import { addMembership, ensureMigrated, insertUser, login, testApp, testPools } from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);

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
  const app = testApp(pools);

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
    const settings = await json<{ settings: { vatEnabled: boolean; vatRegistrationNumber: string | null } }>(
      await app.request("/api/v1/finance/settings", {
        method: "PATCH",
        headers: hdrs,
        body: JSON.stringify({
          tuitionEnabled: true,
          invoicePrefix: "VAT-INV",
          receiptPrefix: "VAT-RCT",
          ...input.vat,
        }),
      }),
    );
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
    await app.request("/api/v1/students", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        legalName: "Amina Rasool",
        academicYearId: year.academicYear.id,
        yearGroupId: year3.id,
      }),
    });
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
    const preview = await json<{ run: { id: string; expectedTotalMinor: number } }>(
      await app.request("/api/v1/finance/billing-runs/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: year.academicYear.id,
          frequency: "monthly",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          dueOn: "2026-09-15",
        }),
      }),
    );
    const confirmed = await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(confirmed.status).toBe(200);
    const invoices = await json<{
      invoices: Array<{ id: string; reference: string; totalMinor: number; outstandingMinor: number }>;
    }>(await app.request("/api/v1/finance/invoices", { headers: hdrs }));
    return {
      orgId,
      hdrs,
      token,
      settings: settings.settings,
      invoice: invoices.invoices[0]!,
      previewExpectedMinor: preview.run.expectedTotalMinor,
    };
  }

  it("defaults to non-VAT and keeps £500 fees as £500", async () => {
    const issued = await issueMonthlyInvoice({ orgName: "No VAT School", amountMinor: 50_000 });
    expect(issued.settings.vatEnabled).toBe(false);
    expect(issued.invoice.totalMinor).toBe(50_000);
    expect(issued.invoice.outstandingMinor).toBe(50_000);
    expect(issued.previewExpectedMinor).toBe(50_000);
    const text = extractPdfText(
      new Uint8Array(
        await (await app.request(`/api/v1/finance/invoices/${issued.invoice.id}/pdf`, { headers: issued.hdrs })).arrayBuffer(),
      ),
    );
    expect(text).toContain("This is not a VAT invoice.");
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
    expect(issued.previewExpectedMinor).toBe(60_000);
    const snap = await pools.owner.query<{
      vat_enabled: boolean;
      vat_registration_number: string | null;
      vat_rate_bps: number | null;
      vat_net_minor: string;
      vat_amount_minor: string;
      total_minor: string;
    }>(`select vat_enabled, vat_registration_number, vat_rate_bps, vat_net_minor, vat_amount_minor, total_minor
        from school_invoices where id = $1`, [issued.invoice.id]);
    expect(snap.rows[0]!.vat_enabled).toBe(true);
    expect(snap.rows[0]!.vat_registration_number).toBe("GB123456789");
    expect(Number(snap.rows[0]!.vat_rate_bps)).toBe(2000);
    expect(Number(snap.rows[0]!.vat_net_minor)).toBe(50_000);
    expect(Number(snap.rows[0]!.vat_amount_minor)).toBe(10_000);
    expect(Number(snap.rows[0]!.total_minor)).toBe(60_000);
    const text = extractPdfText(
      new Uint8Array(
        await (await app.request(`/api/v1/finance/invoices/${issued.invoice.id}/pdf`, { headers: issued.hdrs })).arrayBuffer(),
      ),
    );
    expect(text).toContain("VAT invoice");
    expect(text).toContain("GB123456789");
    expect(text).toContain("20%");
    expect(text).not.toContain("This is not a VAT invoice.");

    await app.request("/api/v1/finance/settings", {
      method: "PATCH",
      headers: issued.hdrs,
      body: JSON.stringify({
        vatRegistrationNumber: "GB-CHANGED",
        vatRatePercent: 5,
        vatEnabled: false,
      }),
    });
    const reprint = extractPdfText(
      new Uint8Array(
        await (await app.request(`/api/v1/finance/invoices/${issued.invoice.id}/pdf`, { headers: issued.hdrs })).arrayBuffer(),
      ),
    );
    expect(reprint).toContain("GB123456789");
    expect(reprint).not.toContain("GB-CHANGED");
    expect(reprint).toContain("20%");
    expect(reprint).toContain("VAT invoice");
  });

  it("keeps inclusive VAT gross at the entered £600", async () => {
    const issued = await issueMonthlyInvoice({
      orgName: "Inclusive VAT School",
      amountMinor: 60_000,
      vat: {
        vatEnabled: true,
        vatRegistrationNumber: "IE1234567T",
        vatRatePercent: 20,
        vatPricesInclusive: true,
      },
    });
    expect(issued.invoice.totalMinor).toBe(60_000);
    expect(issued.previewExpectedMinor).toBe(60_000);
    const snap = await pools.owner.query<{ vat_net_minor: string; vat_amount_minor: string }>(
      `select vat_net_minor, vat_amount_minor from school_invoices where id = $1`,
      [issued.invoice.id],
    );
    expect(Number(snap.rows[0]!.vat_net_minor)).toBe(50_000);
    expect(Number(snap.rows[0]!.vat_amount_minor)).toBe(10_000);
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
