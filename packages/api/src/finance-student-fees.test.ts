import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withTenantContext } from "@schoolapp/db";
import { financeInvoiceIssuedMail } from "@schoolapp/core";
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
    [`sfees-${id}`, `Student Fees ${id}`],
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
  const groups = await json<{ yearGroups: Array<{ id: string; code: string }> }>(
    await app.request("/api/v1/year-groups", { headers: hdrs }),
  );
  const year3 = groups.yearGroups.find((group) => group.code === "3")!;
  const year5 = groups.yearGroups.find((group) => group.code === "5") ?? groups.yearGroups.find((group) => group.code === "4")!;
  const classA = await json<{ class: { id: string } }>(
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

async function createStudent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  input: { legalName: string; academicYearId: string; yearGroupId: string; classId?: string; dateOfBirth?: string },
) {
  const created = await app.request("/api/v1/students", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(input),
  });
  expect(created.status).toBe(201);
  return json<{ student: { id: string } }>(created);
}

async function inviteParent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  studentId: string,
  email: string,
  fullName = "Pat Parent",
) {
  const created = await app.request(`/api/v1/students/${studentId}/guardians`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      email,
      fullName,
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
      body: JSON.stringify({ token: guardian.invitationToken, fullName, password: "parent-pass-1" }),
    });
  }
}

type FeesBody = {
  summary: {
    expectedAnnualFeesMinor: number;
    invoicedMinor: number;
    receivedMinor: number;
    outstandingMinor: number;
    overdueMinor: number;
    currency: string;
  };
  pupils: Array<{
    studentProfileId: string;
    legalName: string;
    yearGroupName: string | null;
    className: string | null;
    annualFeeMinor: number | null;
    discountMinor: number;
    netAnnualFeeMinor: number | null;
    currentInstalmentMinor: number | null;
    invoicedMinor: number;
    paidMinor: number;
    outstandingMinor: number;
    overdueMinor: number;
    status: string;
    parentPaymentAvailability: string;
    billingAccountId: string | null;
  }>;
  missingInvoices: { count: number; href: string | null; billingRunId: string | null };
};

describe("student fees UX and invoice notifications", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  }, 60_000);

  afterAll(async () => {
    await closePools(pools);
  });

  it("builds a parent invoice pay path and one idempotency key per invoice", () => {
    const message = financeInvoiceIssuedMail({
      organisationId: "org",
      organisationName: "Kingswood School",
      toEmail: "pat@example.com",
      toName: "Pat Parent",
      invoiceId: "inv-99",
      invoiceReference: "INV-1",
      amountDueLabel: "£2,000.00",
      dueDate: "2026-09-15",
      pupilFirstName: "Eshaal",
    });
    expect(message.idempotencyKey).toBe("finance.invoice_issued:inv-99");
    expect(message.actionUrl).toBe("/parent/finance/invoices/inv-99");
    expect(message.subject).toBe("Fee payment due – Kingswood School");
    expect(message.textBody).toContain("Eshaal");
    expect(message.textBody).not.toMatch(/date of birth|allerg|safeguard/i);
  });

  it("lists pupil fees, statuses, filters, parent scope, catch-up, and opt-in invoice email", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const other = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const otherHdrs = headers(otherToken, other.orgId);
    const seeded = await seedYear(app, hdrs);

    const settingsOff = await json<{ settings: { automaticInvoiceEmailEnabled: boolean } }>(
      await app.request("/api/v1/finance/settings", { headers: hdrs }),
    );
    expect(settingsOff.settings.automaticInvoiceEmailEnabled).toBe(false);

    await app.request("/api/v1/finance/settings", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({
        tuitionEnabled: true,
        defaultBillingFrequency: "monthly",
        discountStackingMode: "stack",
        siblingOrderMode: "oldest_first",
      }),
    });

    const eshaal = await createStudent(app, hdrs, {
      legalName: "Eshaal Fatima",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      dateOfBirth: "2018-01-15",
    });
    const sibling = await createStudent(app, hdrs, {
      legalName: "Ayaan Fatima",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      dateOfBirth: "2016-01-15",
    });
    const unassigned = await createStudent(app, hdrs, {
      legalName: "No Fee Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year5Id,
    });
    await inviteParent(app, hdrs, eshaal.student.id, `pat-${id}@example.com`, "Pat Parent");
    await inviteParent(app, hdrs, sibling.student.id, `pat-${id}@example.com`, "Pat Parent");

    const schedule = await app.request("/api/v1/finance/fee-schedules", {
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
    expect(schedule.status).toBe(201);

    const discountRule = await app.request("/api/v1/finance/discount-rules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        kind: "sibling",
        name: "Sibling 10%",
        amountType: "percent",
        percentBps: 1000,
        stackingPriority: 20,
        exclusiveGroup: "family",
        tiers: [{ siblingPosition: 2, amountType: "percent", percentBps: 1000 }],
      }),
    });
    expect(discountRule.status).toBe(201);

    const listed = await json<FeesBody>(
      await app.request("/api/v1/finance/student-fees?asOf=2026-09-10&sort=name", { headers: hdrs }),
    );
    const eshaalRow = listed.pupils.find((row) => row.studentProfileId === eshaal.student.id);
    const siblingRow = listed.pupils.find((row) => row.studentProfileId === sibling.student.id);
    const noneRow = listed.pupils.find((row) => row.studentProfileId === unassigned.student.id);
    expect(eshaalRow?.annualFeeMinor).toBe(2000000);
    expect(eshaalRow?.className).toBe("3A");
    expect(eshaalRow?.invoicedMinor).toBe(0);
    expect(eshaalRow?.paidMinor).toBe(0);
    expect(eshaalRow?.outstandingMinor).toBe(0);
    expect(eshaalRow?.overdueMinor).toBe(0);
    expect(eshaalRow?.status).toBe("not_yet_due");
    expect(noneRow?.status).toBe("no_fee_assigned");
    expect(noneRow?.annualFeeMinor).toBeNull();
    // oldest_first: Ayaan (2016) is child 1; Eshaal (2018) is child 2 and receives the sibling tier.
    expect(siblingRow?.discountMinor).toBe(0);
    expect(eshaalRow?.discountMinor).toBe(200000);
    expect(eshaalRow?.netAnnualFeeMinor).toBe(1800000);
    expect(eshaalRow?.billingAccountId).toBe(siblingRow?.billingAccountId);
    expect(listed.summary.expectedAnnualFeesMinor).toBeGreaterThan(0);
    expect(Number.isInteger(listed.summary.expectedAnnualFeesMinor)).toBe(true);

    const yearFilter = await json<FeesBody>(
      await app.request(`/api/v1/finance/student-fees?asOf=2026-09-10&yearGroupId=${seeded.year3Id}`, {
        headers: hdrs,
      }),
    );
    expect(yearFilter.pupils.some((row) => row.studentProfileId === unassigned.student.id)).toBe(false);
    expect(yearFilter.pupils.some((row) => row.studentProfileId === eshaal.student.id)).toBe(true);

    const classFilter = await json<FeesBody>(
      await app.request(`/api/v1/finance/student-fees?asOf=2026-09-10&classId=${seeded.classAId}`, {
        headers: hdrs,
      }),
    );
    expect(classFilter.pupils.every((row) => row.className === "3A")).toBe(true);

    const searchFilter = await json<FeesBody>(
      await app.request(`/api/v1/finance/student-fees?asOf=2026-09-10&search=Eshaal`, { headers: hdrs }),
    );
    expect(searchFilter.pupils.map((row) => row.legalName)).toEqual(["Eshaal Fatima"]);

    const noFeeFilter = await json<FeesBody>(
      await app.request("/api/v1/finance/student-fees?asOf=2026-09-10&noFeeAssigned=true", { headers: hdrs }),
    );
    expect(noFeeFilter.pupils.some((row) => row.studentProfileId === unassigned.student.id)).toBe(true);

    const detail = await json<{
      legalName: string;
      fees: { invoicedMinor: number; status: string; annualFeeMinor: number | null };
      invoices: Array<{ id: string }>;
    }>(await app.request(`/api/v1/finance/pupils/${eshaal.student.id}?asOf=2026-09-10`, { headers: hdrs }));
    expect(detail.legalName).toBe("Eshaal Fatima");
    expect(detail.fees.annualFeeMinor).toBe(2000000);

    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    const teacherToken = await login(app, `teacher-${id}@example.com`, "password-12x");
    const teacherHdrs = headers(teacherToken, school.orgId);
    expect((await app.request("/api/v1/finance/student-fees", { headers: teacherHdrs })).status).toBe(403);
    expect((await app.request("/api/v1/finance/settings", { headers: teacherHdrs })).status).toBe(403);

    const headId = await insertUser(pools.owner, {
      email: `head-${id}@example.com`,
      password: "password-12x",
      fullName: "Head",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, headId, "school.headteacher");
    const headToken = await login(app, `head-${id}@example.com`, "password-12x");
    expect((await app.request("/api/v1/finance/settings", { headers: headers(headToken, school.orgId) })).status).toBe(403);

    const prepared = await json<{ run: { id: string; status: string } }>(
      await app.request("/api/v1/finance/student-fees/prepare-period", { method: "POST", headers: hdrs, body: "{}" }),
    );
    expect(prepared.run.id).toBeTruthy();
    const confirmed = await app.request(`/api/v1/finance/billing-runs/${prepared.run.id}/confirm`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(confirmed.status).toBe(200);

    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const mail = await client.query("select id from mail_outbox where organisation_id = $1 and purpose = 'finance_invoice_issued'", [
        school.orgId,
      ]);
      expect(mail.rows).toHaveLength(0);
    });

    const afterIssue = await json<FeesBody>(
      await app.request("/api/v1/finance/student-fees?asOf=2026-09-10", { headers: hdrs }),
    );
    const billed = afterIssue.pupils.find((row) => row.studentProfileId === eshaal.student.id)!;
    expect(billed.invoicedMinor).toBeGreaterThan(0);
    expect(billed.paidMinor).toBe(0);
    expect(billed.outstandingMinor).toBe(billed.invoicedMinor);
    expect(["unpaid", "due_soon", "not_yet_due", "overdue"]).toContain(billed.status);

    const invoices = await json<{ invoices: Array<{ id: string; outstandingMinor: number; status: string }> }>(
      await app.request(`/api/v1/finance/invoices?studentId=${eshaal.student.id}`, { headers: hdrs }),
    );
    const invoiceId = invoices.invoices[0]!.id;
    const firstPay = Math.floor(invoices.invoices[0]!.outstandingMinor / 2);
    expect(firstPay).toBeGreaterThan(0);
    const partPayRes = await app.request(`/api/v1/finance/invoices/${invoiceId}/payments`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        amountMinor: firstPay,
        method: "bank_transfer",
        receivedOn: "2026-09-10",
        idempotencyKey: `off-${id}-1`,
      }),
    });
    expect(partPayRes.status).toBe(201);
    const partPaid = await json<FeesBody>(
      await app.request("/api/v1/finance/student-fees?asOf=2026-09-10", { headers: hdrs }),
    );
    const partRow = partPaid.pupils.find((row) => row.studentProfileId === eshaal.student.id)!;
    expect(partRow.paidMinor).toBeGreaterThan(0);
    expect(partRow.outstandingMinor).toBeGreaterThan(0);
    expect(partRow.status).toBe("part_paid");
    expect(Number.isInteger(partRow.paidMinor)).toBe(true);
    expect(Number.isInteger(partRow.outstandingMinor)).toBe(true);

    const remaining = await json<{ invoice: { outstandingMinor: number } }>(
      await app.request(`/api/v1/finance/invoices/${invoiceId}`, { headers: hdrs }),
    );
    const settleRes = await app.request(`/api/v1/finance/invoices/${invoiceId}/payments`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        amountMinor: remaining.invoice.outstandingMinor,
        method: "bank_transfer",
        receivedOn: "2026-09-10",
        idempotencyKey: `off-${id}-2`,
      }),
    });
    expect(settleRes.status).toBe(201);
    const paid = await json<FeesBody>(
      await app.request("/api/v1/finance/student-fees?asOf=2026-09-10", { headers: hdrs }),
    );
    expect(paid.pupils.find((row) => row.studentProfileId === eshaal.student.id)?.status).toBe("paid");

    await app.request("/api/v1/finance/settings", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ automaticInvoiceEmailEnabled: true }),
    });
    const notify = await json<{ enqueued: boolean; alreadyQueued: boolean }>(
      await app.request(`/api/v1/finance/invoices/${invoiceId}/notify`, { method: "POST", headers: hdrs, body: "{}" }),
    );
    expect(notify.enqueued).toBe(true);
    const notifyAgain = await json<{ enqueued: boolean; alreadyQueued: boolean }>(
      await app.request(`/api/v1/finance/invoices/${invoiceId}/notify`, { method: "POST", headers: hdrs, body: "{}" }),
    );
    expect(notifyAgain.alreadyQueued).toBe(true);

    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const mail = await client.query<{ action_url: string; idempotency_key: string; to_email: string }>(
        `select action_url, idempotency_key, to_email from mail_outbox
          where organisation_id = $1 and purpose = 'finance_invoice_issued'`,
        [school.orgId],
      );
      expect(mail.rows).toHaveLength(1);
      expect(mail.rows[0]?.action_url).toBe(`/parent/finance/invoices/${invoiceId}`);
      expect(mail.rows[0]?.idempotency_key).toBe(`finance.invoice_issued:${invoiceId}`);
      expect(mail.rows[0]?.to_email).toBe(`pat-${id}@example.com`);
      const leaked = await client.query("select id from mail_outbox where organisation_id = $1", [other.orgId]);
      expect(leaked.rows).toHaveLength(0);
    });

    expect((await app.request("/api/v1/finance/student-fees", { headers: otherHdrs })).status).toBe(200);
    const otherFees = await json<FeesBody>(await app.request("/api/v1/finance/student-fees", { headers: otherHdrs }));
    expect(otherFees.pupils.some((row) => row.studentProfileId === eshaal.student.id)).toBe(false);
    expect((await app.request(`/api/v1/finance/pupils/${eshaal.student.id}`, { headers: otherHdrs })).status).toBe(404);

    const parentToken = await login(app, `pat-${id}@example.com`, "parent-pass-1");
    const parentHdrs = headers(parentToken, school.orgId);
    const parentFinance = await json<{
      outstandingMinor: number | null;
      invoicedMinor: number | null;
      paidMinor: number | null;
      pupils: Array<{ legalName: string; annualAmountMinor: number | null }>;
    }>(await app.request("/api/v1/parent/finance", { headers: parentHdrs }));
    expect(parentFinance.pupils.map((pupil) => pupil.legalName).sort()).toEqual(["Ayaan Fatima", "Eshaal Fatima"]);
    expect(parentFinance.invoicedMinor).toBeGreaterThan(0);

    const late = await createStudent(app, hdrs, {
      legalName: "Late Joiner",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const withMissing = await json<FeesBody>(
      await app.request("/api/v1/finance/student-fees?asOf=2026-09-10", { headers: hdrs }),
    );
    expect(withMissing.missingInvoices.count).toBeGreaterThan(0);
    expect(withMissing.missingInvoices.href).toContain("/school/finance/billing-runs/");
    expect(withMissing.pupils.some((row) => row.studentProfileId === late.student.id)).toBe(true);

    const teacherNotify = await app.request(`/api/v1/finance/invoices/${invoiceId}/notify`, {
      method: "POST",
      headers: teacherHdrs,
      body: "{}",
    });
    expect(teacherNotify.status).toBe(403);
  }, 120_000);
});
