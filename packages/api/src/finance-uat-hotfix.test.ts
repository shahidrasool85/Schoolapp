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
    [`fua-${id}`, `Finance UAT ${id}`],
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
    year3Name: year3.name,
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

describe("Finance UAT hotfix", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("rejects duplicate active schedules and accepts a non-overlapping future replacement", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);

    const first = await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Year 3 2026/27",
        academicYearId: seeded.yearId,
        yearGroupId: seeded.year3Id,
        annualAmountMinor: 600000,
        instalmentCount: 10,
        billingFrequency: "monthly",
        effectiveFrom: "2026-09-01",
        effectiveUntil: "2026-12-31",
      }),
    });
    expect(first.status).toBe(201);
    const created = await json<{ schedule: { amountMinor: number; annualAmountMinor: number } }>(first);
    expect(created.schedule.amountMinor).toBe(60000);
    expect(created.schedule.annualAmountMinor).toBe(600000);

    const duplicate = await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Year 3 duplicate",
        academicYearId: seeded.yearId,
        yearGroupId: seeded.year3Id,
        amountMinor: 200000,
        billingFrequency: "monthly",
        instalmentCount: 10,
        effectiveFrom: "2026-09-01",
      }),
    });
    expect(duplicate.status).toBe(409);
    expect((await json<{ error: { message: string } }>(duplicate)).error.message).toMatch(
      /active fee schedule already exists for this year group and period/i,
    );

    const replacement = await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Year 3 replacement",
        academicYearId: seeded.yearId,
        yearGroupId: seeded.year3Id,
        annualAmountMinor: 600000,
        instalmentCount: 10,
        billingFrequency: "monthly",
        effectiveFrom: "2027-01-01",
      }),
    });
    expect(replacement.status).toBe(201);

    const listed = await json<{
      schedules: Array<{ name: string; overlapWarning: string | null; usage: { unused: boolean } }>;
    }>(await app.request("/api/v1/finance/fee-schedules", { headers: hdrs }));
    expect(listed.schedules).toHaveLength(2);
    expect(listed.schedules.every((schedule) => schedule.overlapWarning == null)).toBe(true);
    expect(listed.schedules.every((schedule) => schedule.usage.unused)).toBe(true);

    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      await client.query(
        `insert into school_fee_schedules (
           organisation_id, name, academic_year_id, year_group_id, amount_minor, currency,
           billing_frequency, instalment_count, effective_from, created_by
         )
         select organisation_id, 'Legacy duplicate', academic_year_id, year_group_id, amount_minor, currency,
                billing_frequency, instalment_count, effective_from, created_by
           from school_fee_schedules
          where name = 'Year 3 2026/27'
          limit 1`,
      );
    });
    const withLegacy = await json<{
      schedules: Array<{ name: string; overlapWarning: string | null; usage: { unused: boolean } }>;
    }>(await app.request("/api/v1/finance/fee-schedules", { headers: hdrs }));
    const overlapping = withLegacy.schedules.filter((schedule) => schedule.overlapWarning);
    expect(overlapping.length).toBeGreaterThanOrEqual(2);
    expect(overlapping[0]?.overlapWarning).toMatch(/Multiple active schedules overlap/i);
  });

  it("rejects inconsistent annual totals and keeps minor-unit rounding safe", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);

    const inconsistent = await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Broken",
        academicYearId: seeded.yearId,
        yearGroupId: seeded.year3Id,
        amountMinor: 200000,
        annualAmountMinor: 600000,
        instalmentCount: 10,
        billingFrequency: "monthly",
        effectiveFrom: "2026-09-01",
      }),
    });
    expect(inconsistent.status).toBe(400);
    expect((await json<{ error: { message: string } }>(inconsistent)).error.message).toMatch(/annual total/i);

    const remainder = await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Uneven pence",
        academicYearId: seeded.yearId,
        yearGroupId: seeded.year5Id,
        annualAmountMinor: 1000,
        instalmentCount: 3,
        billingFrequency: "termly",
        effectiveFrom: "2026-09-01",
      }),
    });
    expect(remainder.status).toBe(201);
    expect((await json<{ schedule: { amountMinor: number } }>(remainder)).schedule.amountMinor).toBe(333);
  });

  it("lets School Admin delete an unused duplicate and blocks hard-delete after billing use", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs);
    await createStudent(app, hdrs, pools, school, {
      legalName: "Shahid Rasool",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      startedOn: "2026-09-03",
    });

    const unused = await json<{ schedule: { id: string } }>(
      await app.request("/api/v1/finance/fee-schedules", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Unused Year 3",
          academicYearId: seeded.yearId,
          yearGroupId: seeded.year3Id,
          annualAmountMinor: 600000,
          instalmentCount: 10,
          billingFrequency: "monthly",
          effectiveFrom: "2026-09-01",
          effectiveUntil: "2026-09-15",
        }),
      }),
    );
    const unusedLoaded = await json<{ lifecycle: { canDelete: boolean; unused: boolean } }>(
      await app.request(`/api/v1/finance/fee-schedules/${unused.schedule.id}`, { headers: hdrs }),
    );
    expect(unusedLoaded.lifecycle.canDelete).toBe(true);
    expect(unusedLoaded.lifecycle.unused).toBe(true);
    expect((await app.request(`/api/v1/finance/fee-schedules/${unused.schedule.id}`, { method: "DELETE", headers: hdrs })).status).toBe(200);

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
    const preview = await app.request("/api/v1/finance/billing-runs/preview", {
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
    expect(preview.status).toBe(201);
    const previewBody = await json<{
      run: { id: string; status: string };
      items: Array<{
        legalName: string;
        yearGroupName: string | null;
        className: string | null;
        feeScheduleName: string | null;
        annualAmountMinor: number | null;
        instalmentNumber: number | null;
        instalmentCount: number | null;
        standardAmountMinor: number;
        netAmountMinor: number;
        periodStart: string;
        dueOn: string | null;
      }>;
    }>(preview);
    const shahid = previewBody.items.find((item) => item.legalName === "Shahid Rasool");
    expect(shahid).toBeTruthy();
    expect(shahid?.yearGroupName).toMatch(/Year 3|3/);
    expect(shahid?.className).toBe("3A");
    expect(shahid?.feeScheduleName).toBe("Used Year 3");
    expect(shahid?.annualAmountMinor).toBe(2000000);
    expect(shahid?.instalmentNumber).toBe(1);
    expect(shahid?.instalmentCount).toBe(10);
    expect(shahid?.standardAmountMinor).toBe(200000);
    expect(shahid?.periodStart).toBe("2026-09-01");

    const invoicesBeforeConfirm = await json<{ invoices: Array<{ id: string }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(invoicesBeforeConfirm.invoices).toHaveLength(0);

    const confirmed = await app.request(`/api/v1/finance/billing-runs/${previewBody.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(confirmed.status).toBe(200);
    const again = await app.request(`/api/v1/finance/billing-runs/${previewBody.run.id}/confirm`, {
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

    const usedLoaded = await json<{ lifecycle: { canDelete: boolean; hasInvoices: boolean } }>(
      await app.request(`/api/v1/finance/fee-schedules/${used.schedule.id}`, { headers: hdrs }),
    );
    expect(usedLoaded.lifecycle.canDelete).toBe(false);
    expect(usedLoaded.lifecycle.hasInvoices).toBe(true);
    expect((await app.request(`/api/v1/finance/fee-schedules/${used.schedule.id}`, { method: "DELETE", headers: hdrs })).status).toBe(409);

    await app.request(`/api/v1/finance/fee-schedules/${used.schedule.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: 250000, annualAmountMinor: 2500000, instalmentCount: 10 }),
    });
    const historic = await json<{ invoice: { totalMinor: number } }>(
      await app.request(`/api/v1/finance/invoices/${invoices.invoices[0]!.id}`, { headers: hdrs }),
    );
    expect(historic.invoice.totalMinor).toBe(200000);
  });

  it("uses the same canonical overlap rule for billing preview and pupil finance", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs);
    const pupil = await createStudent(app, hdrs, pools, school, {
      legalName: "Shahid Rasool",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      startedOn: "2026-09-03",
    });
    await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Year 3 Tuition 2026/27",
        academicYearId: seeded.yearId,
        yearGroupId: seeded.year3Id,
        annualAmountMinor: 600000,
        instalmentCount: 10,
        billingFrequency: "monthly",
        effectiveFrom: "2026-09-01",
      }),
    });

    const preview = await json<{
      items: Array<{ studentProfileId: string; feeScheduleName: string | null; netAmountMinor: number }>;
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
    const previewItem = preview.items.find((item) => item.studentProfileId === pupil.student.id);
    expect(previewItem?.feeScheduleName).toBe("Year 3 Tuition 2026/27");
    expect(previewItem?.netAmountMinor).toBe(60000);

    const today = await json<{
      appliesToday: boolean;
      appliesInEvaluatedPeriod: boolean;
      upcoming: { feeScheduleName: string | null; amountPerInstalmentMinor: number; effectiveFrom: string } | null;
      quote: { feeScheduleName: string | null; netAmountMinor: number; periodStart: string } | null;
      todayQuote: { feeScheduleName: string | null } | null;
      evaluatedPeriod: { periodStart: string; periodEnd: string } | null;
    }>(await app.request(`/api/v1/finance/pupils/${pupil.student.id}?asOf=2026-09-02`, { headers: hdrs }));
    expect(today.appliesToday).toBe(false);
    expect(today.todayQuote?.feeScheduleName ?? null).toBeNull();
    expect(today.appliesInEvaluatedPeriod).toBe(true);
    expect(today.quote?.feeScheduleName).toBe(previewItem?.feeScheduleName);
    expect(today.quote?.netAmountMinor).toBe(previewItem?.netAmountMinor);
    expect(today.quote?.periodStart).toBe("2026-09-01");
    expect(today.upcoming?.feeScheduleName).toBe("Year 3 Tuition 2026/27");
    expect(today.upcoming?.amountPerInstalmentMinor).toBe(60000);
    expect(today.upcoming?.effectiveFrom).toBe("2026-09-03");

    const onEnrolmentDay = await json<{ appliesToday: boolean; quote: { netAmountMinor: number } | null }>(
      await app.request(`/api/v1/finance/pupils/${pupil.student.id}?asOf=2026-09-03`, { headers: hdrs }),
    );
    expect(onEnrolmentDay.appliesToday).toBe(true);
    expect(onEnrolmentDay.quote?.netAmountMinor).toBe(previewItem?.netAmountMinor);

    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      await client.query(
        `update student_enrolments set ended_on = $2 where student_profile_id = $1 and is_primary`,
        [pupil.student.id, "2026-09-15"],
      );
    });
    const afterLeave = await json<{
      items: Array<{ studentProfileId: string; netAmountMinor: number }>;
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
    expect(afterLeave.items.find((item) => item.studentProfileId === pupil.student.id)?.netAmountMinor).toBe(60000);

    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      await client.query(
        `update student_enrolments set ended_on = $2 where student_profile_id = $1 and is_primary`,
        [pupil.student.id, "2026-08-31"],
      );
    });
    const leftBefore = await json<{
      items: Array<{ studentProfileId: string }>;
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
    expect(leftBefore.items.find((item) => item.studentProfileId === pupil.student.id)).toBeUndefined();
  });

  it("marks a changed schedule preview stale and keeps confirm idempotent", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs);
    await createStudent(app, hdrs, pools, school, {
      legalName: "Ava Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
    });
    const schedule = await json<{ schedule: { id: string } }>(
      await app.request("/api/v1/finance/fee-schedules", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Stale check",
          academicYearId: seeded.yearId,
          yearGroupId: seeded.year3Id,
          annualAmountMinor: 600000,
          instalmentCount: 10,
          billingFrequency: "monthly",
          effectiveFrom: "2026-09-01",
        }),
      }),
    );
    const preview = await json<{ run: { id: string; status: string; isStale?: boolean }; items: Array<{ netAmountMinor: number }> }>(
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
    expect(preview.items[0]?.netAmountMinor).toBe(60000);
    const invoicesAfterPreview = await json<{ invoices: Array<{ id: string }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(invoicesAfterPreview.invoices).toHaveLength(0);

    await app.request(`/api/v1/finance/fee-schedules/${schedule.schedule.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: 70000, annualAmountMinor: 700000, instalmentCount: 10 }),
    });
    const stale = await json<{ run: { status: string; isStale: boolean } }>(
      await app.request(`/api/v1/finance/billing-runs/${preview.run.id}`, { headers: hdrs }),
    );
    expect(stale.run.status).toBe("stale");
    expect(stale.run.isStale).toBe(true);
    const blocked = await app.request(`/api/v1/finance/billing-runs/${preview.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(blocked.status).toBe(409);
    expect((await json<{ error: { message: string } }>(blocked)).error.message).toMatch(/stale/i);

    const refreshed = await json<{ run: { id: string; status: string }; items: Array<{ netAmountMinor: number }> }>(
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
    expect(refreshed.run.id).toBe(preview.run.id);
    expect(refreshed.run.status).toBe("previewed");
    expect(refreshed.items[0]?.netAmountMinor).toBe(70000);
    const confirmed = await app.request(`/api/v1/finance/billing-runs/${refreshed.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(confirmed.status).toBe(200);
    const again = await app.request(`/api/v1/finance/billing-runs/${refreshed.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(again.status).toBe(200);
    const invoices = await json<{ invoices: Array<{ id: string; totalMinor: number }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(invoices.invoices).toHaveLength(1);
    expect(invoices.invoices[0]!.totalMinor).toBe(70000);
  });

  it("keeps parent and teacher finance restrictions unchanged", async () => {
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

    const forbidden = await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        name: "Hidden",
        academicYearId: seeded.yearId,
        amountMinor: 60000,
        billingFrequency: "monthly",
        effectiveFrom: "2026-09-01",
      }),
    });
    expect(forbidden.status).toBe(403);

    await enableTuition(app, hdrs);
    const created = await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Tenant only",
        academicYearId: seeded.yearId,
        amountMinor: 60000,
        billingFrequency: "monthly",
        effectiveFrom: "2026-09-01",
      }),
    });
    expect(created.status).toBe(201);
    const leaked = await json<{ schedules: Array<{ name: string }> }>(
      await app.request("/api/v1/finance/fee-schedules", { headers: otherHdrs }),
    );
    expect(leaked.schedules).toEqual([]);
    await withTenantContext(pools.app, other.adminId, other.orgId, async (client) => {
      const rows = await client.query("select * from school_fee_schedules");
      expect(rows.rows).toEqual([]);
    });
  });
});
