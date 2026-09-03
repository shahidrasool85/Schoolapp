import { randomUUID } from "node:crypto";
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

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
    [`fuf-${id}`, `Finance follow-up ${id}`],
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

async function seedYear(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof headers>) {
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
  const groups = await json<{ yearGroups: Array<{ id: string; code: string; name: string }> }>(
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
  return {
    yearId: year.academicYear.id,
    year3Id: year3.id,
    year5Id: year5.id,
    classAId: classA.class.id,
  };
}

async function enableTuition(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof headers>) {
  const res = await app.request("/api/v1/finance/settings", {
    method: "PATCH",
    headers: hdrs,
    body: JSON.stringify({ tuitionEnabled: true, defaultBillingFrequency: "monthly" }),
  });
  expect(res.status).toBe(200);
}

type PreviewItem = {
  studentProfileId: string;
  feeScheduleId: string | null;
  feeScheduleName: string | null;
  annualAmountMinor: number | null;
  instalmentNumber: number | null;
  instalmentCount: number | null;
  instalmentLabel?: string;
  annualFeeLabel?: string | null;
  amountPerInstalmentMinor: number | null;
  standardAmountMinor: number;
  discountTotalMinor: number;
  netAmountMinor: number;
  yearGroupName: string | null;
  className: string | null;
  periodStart: string;
  periodEnd: string;
  dueOn: string | null;
  usedLegacyMetadataLabel?: boolean;
  calculation: Record<string, unknown>;
};

describe("Finance UAT follow-up", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("snapshots new preview metadata and derives missing legacy preview context", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs);
    const pupil = await json<{ student: { id: string } }>(
      await app.request("/api/v1/students", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          legalName: "Ava Pupil",
          academicYearId: seeded.yearId,
          yearGroupId: seeded.year3Id,
          classId: seeded.classAId,
        }),
      }),
    );
    const year3 = await json<{ schedule: { id: string; name: string } }>(
      await app.request("/api/v1/finance/fee-schedules", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Year 3 2026/27",
          academicYearId: seeded.yearId,
          yearGroupId: seeded.year3Id,
          annualAmountMinor: 2000000,
          instalmentCount: 10,
          billingFrequency: "monthly",
          effectiveFrom: "2026-09-01",
        }),
      }),
    );
    const unused = await json<{ schedule: { id: string } }>(
      await app.request("/api/v1/finance/fee-schedules", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Year 5 unused duplicate",
          academicYearId: seeded.yearId,
          yearGroupId: seeded.year5Id,
          annualAmountMinor: 1800000,
          instalmentCount: 10,
          billingFrequency: "monthly",
          effectiveFrom: "2026-09-01",
        }),
      }),
    );

    const preview = await json<{
      run: { id: string; status: string; isStale?: boolean; instalmentNumber: number | null };
      items: PreviewItem[];
      confirmSummary: { pupilCount: number; invoiceCount: number; totalMinor: number };
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
        }),
      }),
    );
    expect(preview.run.status).toBe("previewed");
    expect(preview.run.isStale).toBe(false);
    expect(preview.run.instalmentNumber).toBe(1);
    expect(preview.confirmSummary).toEqual({ pupilCount: 1, invoiceCount: 1, totalMinor: 200000 });
    const fresh = preview.items[0]!;
    expect(fresh.feeScheduleId).toBe(year3.schedule.id);
    expect(fresh.feeScheduleName).toBe("Year 3 2026/27");
    expect(fresh.annualAmountMinor).toBe(2000000);
    expect(fresh.instalmentNumber).toBe(1);
    expect(fresh.instalmentCount).toBe(10);
    expect(fresh.instalmentLabel).toBe("1 of 10");
    expect(fresh.amountPerInstalmentMinor).toBe(200000);
    expect(fresh.standardAmountMinor).toBe(200000);
    expect(fresh.netAmountMinor).toBe(200000);
    expect(fresh.yearGroupName).toBeTruthy();
    expect(fresh.className).toBe("3A");
    expect(fresh.periodStart).toBe("2026-09-01");
    expect(fresh.dueOn).toBe("2026-09-15");
    expect(fresh.calculation.feeScheduleId).toBe(year3.schedule.id);
    expect(fresh.calculation.annualAmountMinor).toBe(2000000);
    expect(fresh.calculation.instalmentCount).toBe(10);
    expect(fresh.calculation.billedAmountMinor).toBe(200000);
    expect(fresh.calculation.dueOn).toBe("2026-09-15");

    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      await client.query(
        `update school_billing_run_items
            set calculation = jsonb_build_object(
              'feeScheduleName', calculation->>'feeScheduleName',
              'legalName', calculation->>'legalName',
              'yearGroupName', calculation->>'yearGroupName',
              'className', calculation->>'className',
              'scheduleAmountMinor', calculation->'scheduleAmountMinor'
            )
          where billing_run_id = $1`,
        [preview.run.id],
      );
      await client.query(`update school_billing_runs set instalment_number = null where id = $1`, [preview.run.id]);
    });

    const legacy = await json<{
      run: { status: string; isStale: boolean };
      items: PreviewItem[];
    }>(await app.request(`/api/v1/finance/billing-runs/${preview.run.id}`, { headers: hdrs }));
    expect(legacy.run.status).toBe("previewed");
    expect(legacy.run.isStale).toBe(false);
    expect(legacy.items[0]!.annualAmountMinor).toBe(2000000);
    expect(legacy.items[0]!.instalmentLabel).toBe("1 of 10");
    expect(legacy.items[0]!.standardAmountMinor).toBe(200000);
    expect(legacy.items[0]!.netAmountMinor).toBe(200000);
    expect(legacy.items[0]!.usedLegacyMetadataLabel).toBe(false);

    expect((await app.request(`/api/v1/finance/fee-schedules/${unused.schedule.id}`, { method: "DELETE", headers: hdrs })).status).toBe(200);
    const afterUnusedDelete = await json<{ run: { status: string; isStale: boolean } }>(
      await app.request(`/api/v1/finance/billing-runs/${preview.run.id}`, { headers: hdrs }),
    );
    expect(afterUnusedDelete.run.status).toBe("previewed");
    expect(afterUnusedDelete.run.isStale).toBe(false);

    const confirmed = await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(confirmed.status).toBe(200);
    const again = await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(again.status).toBe(200);
    const invoices = await json<{ invoices: Array<{ id: string; totalMinor: number }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(invoices.invoices).toHaveLength(1);
    expect(invoices.invoices[0]!.totalMinor).toBe(200000);
    expect(pupil.student.id).toBeTruthy();
  });

  it("marks a referenced schedule change stale and refuses confirm until refresh", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs);
    await app.request("/api/v1/students", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        legalName: "Ben Pupil",
        academicYearId: seeded.yearId,
        yearGroupId: seeded.year3Id,
      }),
    });
    const schedule = await json<{ schedule: { id: string } }>(
      await app.request("/api/v1/finance/fee-schedules", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Referenced Year 3",
          academicYearId: seeded.yearId,
          yearGroupId: seeded.year3Id,
          annualAmountMinor: 2000000,
          instalmentCount: 10,
          billingFrequency: "monthly",
          effectiveFrom: "2026-09-01",
        }),
      }),
    );
    const preview = await json<{ run: { id: string; status: string }; items: PreviewItem[] }>(
      await app.request("/api/v1/finance/billing-runs/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: seeded.yearId,
          frequency: "monthly",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          instalmentNumber: 1,
        }),
      }),
    );
    expect(preview.items[0]!.netAmountMinor).toBe(200000);

    await app.request(`/api/v1/finance/fee-schedules/${schedule.schedule.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: 250000, annualAmountMinor: 2500000, instalmentCount: 10 }),
    });
    const stale = await json<{
      run: { status: string; isStale: boolean };
      items: PreviewItem[];
    }>(await app.request(`/api/v1/finance/billing-runs/${preview.run.id}`, { headers: hdrs }));
    expect(stale.run.status).toBe("stale");
    expect(stale.run.isStale).toBe(true);
    expect(stale.items[0]!.standardAmountMinor).toBe(200000);
    expect(stale.items[0]!.instalmentLabel).toMatch(/Legacy preview|1 of 10/);

    const blocked = await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(blocked.status).toBe(409);
    expect((await json<{ error: { message: string } }>(blocked)).error.message).toMatch(/stale/i);

    const listed = await json<{
      runs: Array<{ id: string; status: string; isStale: boolean; previewStatus?: string }>;
    }>(await app.request("/api/v1/finance/billing-runs", { headers: hdrs }));
    const listedRun = listed.runs.find((run) => run.id === preview.run.id);
    expect(listedRun?.isStale).toBe(true);
    expect(listedRun?.status).toBe("stale");
  });

  it("keeps excluded pupils visible on a preview and does not invoice them", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs);
    await app.request("/api/v1/students", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        legalName: "Included Pupil",
        academicYearId: seeded.yearId,
        yearGroupId: seeded.year3Id,
      }),
    });
    await app.request("/api/v1/students", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        legalName: "Excluded Pupil",
        academicYearId: seeded.yearId,
        yearGroupId: seeded.year5Id,
      }),
    });
    await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Year 3 only",
        academicYearId: seeded.yearId,
        yearGroupId: seeded.year3Id,
        annualAmountMinor: 2000000,
        instalmentCount: 10,
        billingFrequency: "monthly",
        effectiveFrom: "2026-09-01",
      }),
    });
    const preview = await json<{
      run: { id: string; status: string };
      items: Array<{
        legalName: string;
        included?: boolean;
        exclusionReason?: string | null;
        netAmountMinor: number;
      }>;
      includedItems?: Array<{ legalName: string }>;
      excludedItems?: Array<{ legalName: string; exclusionReason?: string | null }>;
    }>(
      await app.request("/api/v1/finance/billing-runs/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: seeded.yearId,
          frequency: "monthly",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          instalmentNumber: 1,
        }),
      }),
    );
    expect(preview.run.status).toBe("previewed");
    const included = preview.includedItems ?? preview.items.filter((item) => item.included !== false && item.netAmountMinor > 0);
    const excluded = preview.excludedItems ?? preview.items.filter((item) => item.included === false || item.netAmountMinor <= 0);
    expect(included.some((item) => item.legalName === "Included Pupil")).toBe(true);
    expect(excluded.some((item) => item.legalName === "Excluded Pupil")).toBe(true);
    expect(excluded.find((item) => item.legalName === "Excluded Pupil")?.exclusionReason).toMatch(/fee schedule/i);

    const confirmed = await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(confirmed.status).toBe(200);
    const invoices = await json<{ invoices: Array<{ totalMinor: number }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(invoices.invoices).toHaveLength(1);
    expect(invoices.invoices[0]!.totalMinor).toBe(200000);
  });

  it("shows a legacy label when instalment metadata cannot be derived", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs);
    await app.request("/api/v1/students", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        legalName: "Cara Pupil",
        academicYearId: seeded.yearId,
        yearGroupId: seeded.year3Id,
      }),
    });
    await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Year 3 2026/27",
        academicYearId: seeded.yearId,
        yearGroupId: seeded.year3Id,
        annualAmountMinor: 2000000,
        instalmentCount: 10,
        billingFrequency: "monthly",
        effectiveFrom: "2026-09-01",
      }),
    });
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
    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      await client.query(
        `update school_billing_run_items
            set fee_schedule_id = null,
                calculation = '{}'::jsonb
          where billing_run_id = $1`,
        [preview.run.id],
      );
      await client.query(`update school_billing_runs set instalment_number = null where id = $1`, [preview.run.id]);
    });
    const loaded = await json<{ items: PreviewItem[] }>(
      await app.request(`/api/v1/finance/billing-runs/${preview.run.id}`, { headers: hdrs }),
    );
    expect(loaded.items[0]!.annualFeeLabel).toMatch(/Legacy preview — instalment metadata not stored/);
    expect(loaded.items[0]!.instalmentLabel).toMatch(/Legacy preview — instalment metadata not stored/);
    expect(loaded.items[0]!.usedLegacyMetadataLabel).toBe(true);
  });

  it("redirects successful unused deletes and keeps failed/double deletes from looping", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs);
    await app.request("/api/v1/students", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        legalName: "Dee Pupil",
        academicYearId: seeded.yearId,
        yearGroupId: seeded.year3Id,
      }),
    });
    const unused = await json<{ schedule: { id: string } }>(
      await app.request("/api/v1/finance/fee-schedules", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Unused to delete",
          academicYearId: seeded.yearId,
          yearGroupId: seeded.year3Id,
          annualAmountMinor: 2000000,
          instalmentCount: 10,
          billingFrequency: "monthly",
          effectiveFrom: "2026-09-01",
          effectiveUntil: "2026-09-10",
        }),
      }),
    );
    const deleted = await app.request(`/api/v1/finance/fee-schedules/${unused.schedule.id}`, {
      method: "DELETE",
      headers: hdrs,
    });
    expect(deleted.status).toBe(200);
    expect((await json<{ ok: boolean }>(deleted)).ok).toBe(true);
    expect((await app.request(`/api/v1/finance/fee-schedules/${unused.schedule.id}`, { headers: hdrs })).status).toBe(404);
    expect(
      (await app.request(`/api/v1/finance/fee-schedules/${unused.schedule.id}`, { method: "DELETE", headers: hdrs })).status,
    ).toBe(404);

    const used = await json<{ schedule: { id: string } }>(
      await app.request("/api/v1/finance/fee-schedules", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Used Year 3",
          academicYearId: seeded.yearId,
          yearGroupId: seeded.year3Id,
          annualAmountMinor: 2000000,
          instalmentCount: 10,
          billingFrequency: "monthly",
          effectiveFrom: "2026-09-01",
        }),
      }),
    );
    await app.request("/api/v1/finance/billing-runs/preview", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: seeded.yearId,
        frequency: "monthly",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        instalmentNumber: 1,
      }),
    });
    const failed = await app.request(`/api/v1/finance/fee-schedules/${used.schedule.id}`, {
      method: "DELETE",
      headers: hdrs,
    });
    expect(failed.status).toBe(409);
    expect((await json<{ error: { message: string } }>(failed)).error.message).toMatch(/invoices or billing run/i);
    const stillThere = await app.request(`/api/v1/finance/fee-schedules/${used.schedule.id}`, { headers: hdrs });
    expect(stillThere.status).toBe(200);
  });

  it("keeps generate preview-only so invoices require explicit billing-run confirm", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs);
    await app.request("/api/v1/students", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        legalName: "Generate Pupil",
        academicYearId: seeded.yearId,
        yearGroupId: seeded.year3Id,
        classId: seeded.classAId,
      }),
    });
    const schedule = await json<{ schedule: { id: string } }>(
      await app.request("/api/v1/finance/fee-schedules", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Generate must preview",
          academicYearId: seeded.yearId,
          yearGroupId: seeded.year3Id,
          annualAmountMinor: 2000000,
          instalmentCount: 10,
          billingFrequency: "monthly",
          effectiveFrom: "2026-09-01",
        }),
      }),
    );

    const generated = await app.request(`/api/v1/finance/fee-schedules/${schedule.schedule.id}/generate`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ periodStart: "2026-09-01", periodEnd: "2026-09-30", dueOn: "2026-09-15" }),
    });
    expect(generated.status).toBe(200);
    expect(generated.headers.get("deprecation")).toBe("true");
    const generatedBody = await json<{
      run: { id: string; status: string; isStale?: boolean };
      items: Array<{ netAmountMinor: number; included?: boolean }>;
      confirmSummary: { invoiceCount: number; totalMinor: number };
      deprecated: boolean;
      issuesInvoices: boolean;
    }>(generated);
    expect(generatedBody.deprecated).toBe(true);
    expect(generatedBody.issuesInvoices).toBe(false);
    expect(generatedBody.run.status).toBe("previewed");
    expect(generatedBody.run.isStale).toBe(false);
    expect(generatedBody.items.some((item) => item.netAmountMinor === 200000)).toBe(true);
    expect(generatedBody.confirmSummary.invoiceCount).toBe(1);

    const afterGenerate = await json<{ invoices: Array<{ id: string }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(afterGenerate.invoices).toHaveLength(0);

    const canonicalPreview = await json<{
      run: { id: string; status: string };
      items: Array<{ netAmountMinor: number }>;
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
    expect(canonicalPreview.run.status).toBe("previewed");
    expect(canonicalPreview.items.some((item) => item.netAmountMinor === 200000)).toBe(true);
    const afterPreview = await json<{ invoices: Array<{ id: string }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(afterPreview.invoices).toHaveLength(0);

    const confirmed = await app.request(`/api/v1/finance/billing-runs/${generatedBody.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(confirmed.status).toBe(200);
    const firstInvoices = await json<{ invoices: Array<{ id: string; totalMinor: number }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(firstInvoices.invoices).toHaveLength(1);
    expect(firstInvoices.invoices[0]!.totalMinor).toBe(200000);

    const again = await app.request(`/api/v1/finance/billing-runs/${generatedBody.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(again.status).toBe(200);
    const afterRetry = await json<{ invoices: Array<{ id: string }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(afterRetry.invoices).toHaveLength(1);

    await app.request(`/api/v1/finance/fee-schedules/${schedule.schedule.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: 220000, annualAmountMinor: 2200000, instalmentCount: 10 }),
    });
    const blocked = await app.request(`/api/v1/finance/billing-runs/${canonicalPreview.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(blocked.status).toBe(409);
    expect((await json<{ error: { code: string } }>(blocked)).error.code).toBe("stale_preview");
    const stillOne = await json<{ invoices: Array<{ id: string }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(stillOne.invoices).toHaveLength(1);

    const generateAgain = await app.request(`/api/v1/finance/fee-schedules/${schedule.schedule.id}/generate`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ periodStart: "2026-11-01", periodEnd: "2026-11-30", dueOn: "2026-11-15" }),
    });
    expect(generateAgain.status).toBe(200);
    expect((await json<{ run: { status: string } }>(generateAgain)).run.status).toBe("previewed");
    const afterSecondGenerate = await json<{ invoices: Array<{ id: string }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(afterSecondGenerate.invoices).toHaveLength(1);
  });

  it("keeps teacher and cross-tenant finance isolation unchanged", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const other = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const otherHdrs = headers(otherToken, other.orgId);
    const seeded = await seedYear(app, hdrs);
    await seedYear(app, otherHdrs);
    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "password-12x",
      fullName: "Terry Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    const teacherToken = await login(app, `teacher-${id}@example.com`, "password-12x");
    const teacherHdrs = headers(teacherToken, school.orgId);
    await enableTuition(app, hdrs);
    const created = await json<{ schedule: { id: string } }>(
      await app.request("/api/v1/finance/fee-schedules", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Tenant only",
          academicYearId: seeded.yearId,
          amountMinor: 60000,
          billingFrequency: "monthly",
          effectiveFrom: "2026-09-01",
        }),
      }),
    );
    expect(
      (
        await app.request(`/api/v1/finance/fee-schedules/${created.schedule.id}`, {
          method: "DELETE",
          headers: teacherHdrs,
        })
      ).status,
    ).toBe(403);
    expect((await app.request(`/api/v1/finance/fee-schedules/${created.schedule.id}`, { headers: otherHdrs })).status).toBe(
      404,
    );
    await withTenantContext(pools.app, other.adminId, other.orgId, async (client) => {
      const rows = await client.query("select * from school_fee_schedules");
      expect(rows.rows).toEqual([]);
    });
  });
});
