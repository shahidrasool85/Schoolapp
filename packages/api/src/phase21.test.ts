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
    [`p21-${id}`, `Phase21 ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return { adminId, orgId: org.rows[0]!.id, slug: `p21-${id}`, adminEmail: `admin-${id}@example.com` };
}

function jsonHeaders(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    "Content-Type": "application/json",
  };
}

async function seedYear(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof jsonHeaders>) {
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
  const year2 = groups.yearGroups.find((group) => group.code === "2")!;
  const year5 = groups.yearGroups.find((group) => group.code === "5") ?? groups.yearGroups.find((group) => group.code === "3")!;
  return { yearId: year.academicYear.id, year2Id: year2.id, year5Id: year5.id };
}

async function createStudent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
  input: { legalName: string; academicYearId: string; yearGroupId: string; dateOfBirth?: string },
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
  hdrs: ReturnType<typeof jsonHeaders>,
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
  const guardian = (await created.json()) as { invitationToken: string | null };
  if (guardian.invitationToken) {
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: guardian.invitationToken, fullName, password: "parent-pass-1" }),
    });
  }
}

async function enableTuition(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof jsonHeaders>, stacking = "stack") {
  const res = await app.request("/api/v1/finance/settings", {
    method: "PATCH",
    headers: hdrs,
    body: JSON.stringify({
      tuitionEnabled: true,
      discountStackingMode: stacking,
      siblingOrderMode: "oldest_first",
      defaultBillingFrequency: "monthly",
    }),
  });
  expect(res.status).toBe(200);
}

async function siblingRule(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof jsonHeaders>) {
  const res = await app.request("/api/v1/finance/discount-rules", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      kind: "sibling",
      name: "Sibling",
      amountType: "percent",
      percentBps: 0,
      stackingPriority: 20,
      exclusiveGroup: "family",
      tiers: [{ siblingPosition: 2, amountType: "percent", percentBps: 1000 }],
    }),
  });
  expect(res.status).toBe(201);
}

describe("Phase 21 independent school fees", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("keeps other payments working when tuition is disabled", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "State Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year2Id,
    });
    const charge = await app.request("/api/v1/finance/charges", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Trip",
        categoryKey: "trip",
        studentProfileId: pupil.student.id,
        amountMinor: 3000,
      }),
    });
    expect(charge.status).toBe(201);
    const settings = (await (await app.request("/api/v1/finance/settings", { headers: hdrs })).json()) as {
      settings: { tuitionEnabled: boolean };
    };
    expect(settings.settings.tuitionEnabled).toBe(false);
    const preview = await app.request("/api/v1/finance/billing-runs/preview", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: seeded.yearId,
        frequency: "monthly",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
      }),
    });
    expect(preview.status).toBe(409);
  });

  it("calculates sibling and fixed discounts, stacking, payments, void, and snapshots", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs, "stack");
    const older = await createStudent(app, hdrs, {
      legalName: "Older Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year5Id,
      dateOfBirth: "2014-01-01",
    });
    const younger = await createStudent(app, hdrs, {
      legalName: "Younger Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year2Id,
      dateOfBirth: "2018-06-01",
    });
    const sameName = await createStudent(app, hdrs, {
      legalName: "Younger Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year2Id,
      dateOfBirth: "2017-01-01",
    });
    await inviteParent(app, hdrs, older.student.id, `fam-${id}@example.com`);
    await inviteParent(app, hdrs, younger.student.id, `fam-${id}@example.com`);
    await inviteParent(app, hdrs, sameName.student.id, `other-${id}@example.com`);

    await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Standard monthly",
        academicYearId: seeded.yearId,
        amountMinor: 60000,
        billingFrequency: "monthly",
        instalmentCount: 10,
        effectiveFrom: "2026-09-01",
      }),
    });
    await siblingRule(app, hdrs);
    await app.request(`/api/v1/finance/pupils/${younger.student.id}/concessions`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        kind: "individual",
        name: "Hardship",
        amountType: "fixed",
        amountMinor: 5000,
        reason: "Agreed concession",
      }),
    });

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
    const previewBody = (await preview.json()) as {
      run: { id: string };
      items: Array<{ studentProfileId: string; standardAmountMinor: number; netAmountMinor: number; siblingPosition: number | null }>;
    };
    const olderItem = previewBody.items.find((item) => item.studentProfileId === older.student.id)!;
    const youngerItem = previewBody.items.find((item) => item.studentProfileId === younger.student.id)!;
    const stranger = previewBody.items.find((item) => item.studentProfileId === sameName.student.id)!;
    expect(olderItem.standardAmountMinor).toBe(60000);
    expect(olderItem.netAmountMinor).toBe(60000);
    expect(youngerItem.netAmountMinor).toBe(49000);
    expect(stranger.netAmountMinor).toBe(60000);

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
    const invoices = (await (await app.request("/api/v1/finance/invoices", { headers: hdrs })).json()) as {
      invoices: Array<{ id: string; totalMinor: number; outstandingMinor: number; status: string }>;
    };
    expect(invoices.invoices).toHaveLength(2);

    const familyInvoice = invoices.invoices.find((invoice) => invoice.totalMinor === 109000)!;
    expect(familyInvoice.outstandingMinor).toBe(109000);

    await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Edited later",
        academicYearId: seeded.yearId,
        amountMinor: 99999,
        billingFrequency: "monthly",
        effectiveFrom: "2026-09-01",
      }),
    });
    const schedules = (await (await app.request("/api/v1/finance/fee-schedules", { headers: hdrs })).json()) as {
      schedules: Array<{ id: string; name: string }>;
    };
    const firstSchedule = schedules.schedules.find((schedule) => schedule.name === "Standard monthly")!;
    await app.request(`/api/v1/finance/fee-schedules/${firstSchedule.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: 120000 }),
    });
    const still = (await (await app.request(`/api/v1/finance/invoices/${familyInvoice.id}`, { headers: hdrs })).json()) as {
      invoice: { totalMinor: number };
    };
    expect(still.invoice.totalMinor).toBe(109000);

    const partial = await app.request(`/api/v1/finance/invoices/${familyInvoice.id}/payments`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        amountMinor: 30000,
        method: "bank_transfer",
        idempotencyKey: `pay-${id}-1`,
      }),
    });
    expect(partial.status).toBe(201);
    const replay = await app.request(`/api/v1/finance/invoices/${familyInvoice.id}/payments`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        amountMinor: 30000,
        method: "bank_transfer",
        idempotencyKey: `pay-${id}-1`,
      }),
    });
    expect(replay.status).toBe(201);
    const afterPartial = (await (
      await app.request(`/api/v1/finance/invoices/${familyInvoice.id}`, { headers: hdrs })
    ).json()) as { invoice: { status: string; outstandingMinor: number; paidMinor: number } };
    expect(afterPartial.invoice.status).toBe("partially_paid");
    expect(afterPartial.invoice.outstandingMinor).toBe(79000);

    await app.request(`/api/v1/finance/invoices/${familyInvoice.id}/payments`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: 79000, method: "cash" }),
    });
    const paid = (await (await app.request(`/api/v1/finance/invoices/${familyInvoice.id}`, { headers: hdrs })).json()) as {
      invoice: { status: string; outstandingMinor: number };
    };
    expect(paid.invoice.status).toBe("paid");
    expect(paid.invoice.outstandingMinor).toBe(0);

    const otherInvoice = invoices.invoices.find((invoice) => invoice.id !== familyInvoice.id)!;
    const voided = await app.request(`/api/v1/finance/invoices/${otherInvoice.id}/void`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ reason: "Raised in error" }),
    });
    expect(voided.status).toBe(200);
    const afterVoid = (await voided.json()) as { invoice: { status: string } };
    expect(afterVoid.invoice.status).toBe("void");
  });

  it("applies configured stacking and requires an explicit staff-child link", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await enableTuition(app, hdrs, "highest");
    const pupil = await createStudent(app, hdrs, {
      legalName: "Staff Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year2Id,
      dateOfBirth: "2016-01-01",
    });
    const sibling = await createStudent(app, hdrs, {
      legalName: "Second Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year2Id,
      dateOfBirth: "2018-01-01",
    });
    const staffId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher Parent",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, staffId, "school.teacher");
    await inviteParent(app, hdrs, pupil.student.id, `teacher-${id}@example.com`, "Teacher Parent");
    await inviteParent(app, hdrs, sibling.student.id, `teacher-${id}@example.com`, "Teacher Parent");
    await pools.owner.query(
      `insert into guardianships (
         organisation_id, student_profile_id, guardian_user_id, relationship,
         has_parental_responsibility, portal_access
       ) values ($1,$2,$3,'father', true, true)
       on conflict do nothing`,
      [school.orgId, pupil.student.id, staffId],
    );

    await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Monthly",
        academicYearId: seeded.yearId,
        amountMinor: 60000,
        billingFrequency: "monthly",
        effectiveFrom: "2026-09-01",
      }),
    });
    await siblingRule(app, hdrs);
    await app.request("/api/v1/finance/discount-rules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        kind: "staff_child",
        name: "Staff 25%",
        amountType: "percent",
        percentBps: 2500,
        stackingPriority: 10,
        exclusiveGroup: "family",
        staffScope: "all_staff",
      }),
    });

    const beforeLink = await app.request("/api/v1/finance/billing-runs/preview", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: seeded.yearId,
        frequency: "monthly",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
      }),
    });
    const beforeBody = (await beforeLink.json()) as {
      items: Array<{ studentProfileId: string; netAmountMinor: number }>;
    };
    expect(beforeBody.items.find((item) => item.studentProfileId === pupil.student.id)?.netAmountMinor).toBe(60000);

    const link = await app.request("/api/v1/finance/staff-child-links", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ staffUserId: staffId, studentProfileId: pupil.student.id }),
    });
    expect(link.status).toBe(201);

    await enableTuition(app, hdrs, "priority");
    const after = await app.request("/api/v1/finance/billing-runs/preview", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: seeded.yearId,
        frequency: "monthly",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
      }),
    });
    const afterBody = (await after.json()) as {
      items: Array<{ studentProfileId: string; netAmountMinor: number }>;
    };
    expect(afterBody.items.find((item) => item.studentProfileId === pupil.student.id)?.netAmountMinor).toBe(45000);
  });

  it("isolates tenants, parents, and teachers", async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, `${id}a`);
    const schoolB = await createSchool(pools.owner, `${id}b`);
    const tokenA = await login(app, schoolA.adminEmail, "password-12x");
    const tokenB = await login(app, schoolB.adminEmail, "password-12x");
    const hdrsA = jsonHeaders(tokenA, schoolA.orgId);
    const hdrsB = jsonHeaders(tokenB, schoolB.orgId);
    const seededA = await seedYear(app, hdrsA);
    const seededB = await seedYear(app, hdrsB);
    await enableTuition(app, hdrsA);
    await enableTuition(app, hdrsB);
    const pupilA = await createStudent(app, hdrsA, {
      legalName: "Alpha",
      academicYearId: seededA.yearId,
      yearGroupId: seededA.year2Id,
    });
    const pupilB = await createStudent(app, hdrsB, {
      legalName: "Beta",
      academicYearId: seededB.yearId,
      yearGroupId: seededB.year2Id,
    });
    await inviteParent(app, hdrsA, pupilA.student.id, `pa-${id}@example.com`);
    await inviteParent(app, hdrsB, pupilB.student.id, `pb-${id}@example.com`);
    await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({
        name: "A only",
        academicYearId: seededA.yearId,
        amountMinor: 60000,
        billingFrequency: "monthly",
        effectiveFrom: "2026-09-01",
      }),
    });
    const previewA = await app.request("/api/v1/finance/billing-runs/preview", {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({
        academicYearId: seededA.yearId,
        frequency: "monthly",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
      }),
    });
    const runA = (await previewA.json()) as { run: { id: string } };
    await app.request(`/api/v1/finance/billing-runs/${runA.run.id}/confirm`, { method: "POST", headers: hdrsA, body: "{}" });
    const listB = (await (await app.request("/api/v1/finance/invoices", { headers: hdrsB })).json()) as {
      invoices: Array<{ reference: string }>;
    };
    expect(listB.invoices).toEqual([]);
    await withTenantContext(pools.app, schoolB.adminId, schoolB.orgId, async (client) => {
      const leaked = await client.query("select * from school_invoices");
      expect(leaked.rows).toEqual([]);
      const leakedSchedules = await client.query("select * from school_fee_schedules");
      expect(leakedSchedules.rows).toEqual([]);
    });

    const parentA = await login(app, `pa-${id}@example.com`, "parent-pass-1");
    const parentB = await login(app, `pb-${id}@example.com`, "parent-pass-1");
    const invoicesA = (await (await app.request("/api/v1/finance/invoices", { headers: hdrsA })).json()) as {
      invoices: Array<{ id: string }>;
    };
    const parentList = (await (
      await app.request("/api/v1/parent/finance", { headers: jsonHeaders(parentA, schoolA.orgId) })
    ).json()) as { invoices: Array<{ id: string }> };
    expect(parentList.invoices.length).toBeGreaterThan(0);
    const cross = await app.request(`/api/v1/parent/finance/invoices/${invoicesA.invoices[0]!.id}`, {
      headers: jsonHeaders(parentB, schoolB.orgId),
    });
    expect(cross.status).toBe(404);

    const teacherId = await insertUser(pools.owner, {
      email: `teach-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, schoolA.orgId, teacherId, "school.teacher");
    const teacherToken = await login(app, `teach-${id}@example.com`, "password-12x");
    const teacher = await app.request("/api/v1/finance/invoices", {
      headers: jsonHeaders(teacherToken, schoolA.orgId),
    });
    expect(teacher.status).toBe(403);
    const teacherCharges = await app.request("/api/v1/finance/charges", {
      headers: jsonHeaders(teacherToken, schoolA.orgId),
    });
    expect(teacherCharges.status).toBe(403);

    const platformId = await insertUser(pools.owner, {
      email: `plat-${id}@example.com`,
      password: "password-12x",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    const platformToken = await login(app, `plat-${id}@example.com`, "password-12x");
    const platform = await app.request("/api/v1/finance/invoices", {
      headers: jsonHeaders(platformToken, schoolA.orgId),
    });
    expect([401, 403, 404]).toContain(platform.status);
    void platformId;
  });
});
