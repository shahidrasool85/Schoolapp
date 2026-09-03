import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakePaymentProvider } from "@schoolapp/core";
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
    "insert into organisations (slug, name, status, timezone) values ($1, $2, 'active', 'Europe/London') returning id",
    [`csf-${id}`, `Calendar Search Finance ${id}`],
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

function demoToken(checkoutUrl: string): string {
  return new URL(checkoutUrl, "http://local.test").searchParams.get("t") ?? "";
}

async function seedYear(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof headers>) {
  const created = await app.request("/api/v1/academic-years", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      name: "2026/27",
      startsOn: "2026-09-07",
      endsOn: "2027-07-09",
      isCurrent: true,
    }),
  });
  expect(created.status).toBe(201);
  const year = await json<{ academicYear: { id: string } }>(created);
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
  const subject = await json<{ subject: { id: string } }>(
    await app.request("/api/v1/subjects", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ key: `eng-${suffix()}`, name: "English" }),
    }),
  );
  return {
    yearId: year.academicYear.id,
    year3Id: year3.id,
    year5Id: year5.id,
    classAId: classA.class.id,
    subjectId: subject.subject.id,
  };
}

async function inviteTeacher(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  id: string,
  classId?: string,
) {
  const staff = await json<{ staffProfileId: string; invitationToken: string }>(
    await app.request("/api/v1/staff", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `teacher-${id}@example.com`,
        fullName: "Arifa Aslam",
        roleKeys: ["school.teacher"],
        jobTitle: "Class teacher",
      }),
    }),
  );
  await app.request("/api/v1/invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: staff.invitationToken, fullName: "Arifa Aslam", password: "teacher-pass-1" }),
  });
  if (classId) {
    await app.request(`/api/v1/classes/${classId}/staff`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ staffProfileId: staff.staffProfileId, assignmentRole: "form_tutor" }),
    });
  }
  return { email: `teacher-${id}@example.com`, staffProfileId: staff.staffProfileId };
}

async function createStudent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  input: { legalName: string; academicYearId: string; yearGroupId: string; classId?: string },
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

describe("academic calendar, search and finance lifecycle", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("manages term dates, rejects overlap, skips half term, and resolves end of term", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);

    const current = await app.request("/api/v1/academic-years/current", { headers: hdrs });
    expect(current.status).toBe(200);
    expect((await json<{ academicYear: { id: string } }>(current)).academicYear.id).toBe(seeded.yearId);

    const autumn = await json<{ term: { id: string; endsOn: string } }>(
      await app.request(`/api/v1/academic-years/${seeded.yearId}/terms`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ name: "Autumn Term 2026", startsOn: "2026-09-07", endsOn: "2026-12-11" }),
      }),
    );
    const overlap = await app.request(`/api/v1/academic-years/${seeded.yearId}/terms`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Clash", startsOn: "2026-11-01", endsOn: "2027-01-15" }),
    });
    expect(overlap.status).toBe(400);

    const outsideHalf = await app.request(`/api/v1/academic-years/${seeded.yearId}/half-terms`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        termId: autumn.term.id,
        name: "Too late",
        startsOn: "2026-12-20",
        endsOn: "2026-12-22",
      }),
    });
    expect(outsideHalf.status).toBe(400);

    const half = await app.request(`/api/v1/academic-years/${seeded.yearId}/half-terms`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        termId: autumn.term.id,
        name: "Autumn half term",
        startsOn: "2026-10-19",
        endsOn: "2026-10-30",
      }),
    });
    expect(half.status).toBe(201);

    const inset = await app.request(`/api/v1/academic-years/${seeded.yearId}/closures`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        kind: "inset_day",
        title: "INSET",
        startsOn: "2026-09-21",
        endsOn: "2026-09-21",
      }),
    });
    expect(inset.status).toBe(201);

    const teacher = await inviteTeacher(app, hdrs, suffix(), seeded.classAId);
    const preview = await json<{ preview: { effectiveUntil: string; dates: string[] } }>(
      await app.request("/api/v1/timetable/entries/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: seeded.yearId,
          weekday: 1,
          startsAt: "09:00",
          endsAt: "10:00",
          classId: seeded.classAId,
          subjectId: seeded.subjectId,
          effectiveFrom: "2026-09-07",
          teachers: [{ staffProfileId: teacher.staffProfileId, isPrimary: true }],
          repeatUntil: { kind: "end_of_term" },
        }),
      }),
    );
    expect(preview.preview.effectiveUntil).toBe("2026-12-11");
    expect(preview.preview.dates).toContain("2026-09-07");
    expect(preview.preview.dates).not.toContain("2026-10-19");
    expect(preview.preview.dates).not.toContain("2026-10-26");
    expect(preview.preview.dates).not.toContain("2026-09-21");

    const outside = await app.request("/api/v1/timetable/entries/preview", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: seeded.yearId,
        weekday: 1,
        startsAt: "09:00",
        endsAt: "10:00",
        classId: seeded.classAId,
        subjectId: seeded.subjectId,
        effectiveFrom: "2026-12-14",
        teachers: [{ staffProfileId: teacher.staffProfileId, isPrimary: true }],
        repeatUntil: { kind: "end_of_term" },
      }),
    });
    expect(outside.status).toBe(400);
    expect((await json<{ error: { message: string } }>(outside)).error.message).toMatch(/term/i);
  });

  it("filters global search by permissions and stays inside the tenant", async () => {
    const school = await createSchool(pools.owner, suffix());
    const other = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await createStudent(app, hdrs, {
      legalName: "John Smith",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const teacher = await inviteTeacher(app, hdrs, suffix(), seeded.classAId);
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const teacherHdrs = headers(teacherToken, school.orgId);

    const termDates = await json<{ groups: Array<{ group: string; results: Array<{ href: string; title: string }> }> }>(
      await app.request("/api/v1/search?q=term%20dates", { headers: hdrs }),
    );
    expect(termDates.groups.flatMap((group) => group.results.map((hit) => hit.href))).toContain("/school/term-dates");

    const invoices = await json<{ groups: Array<{ results: Array<{ title: string; href: string }> }> }>(
      await app.request("/api/v1/search?q=invoices", { headers: hdrs }),
    );
    expect(invoices.groups.flatMap((group) => group.results.map((hit) => hit.href))).toContain("/school/finance/invoices");

    const pupil = await json<{ groups: Array<{ group: string; results: Array<{ title: string }> }> }>(
      await app.request("/api/v1/search?q=John%20Smith", { headers: hdrs }),
    );
    expect(pupil.groups.find((group) => group.group === "pupils")?.results.map((hit) => hit.title)).toContain("John Smith");

    const staff = await json<{ groups: Array<{ group: string; results: Array<{ title: string }> }> }>(
      await app.request("/api/v1/search?q=Arifa", { headers: hdrs }),
    );
    expect(staff.groups.find((group) => group.group === "staff")?.results.map((hit) => hit.title)).toContain("Arifa Aslam");

    const klass = await json<{ groups: Array<{ group: string; results: Array<{ title: string }> }> }>(
      await app.request("/api/v1/search?q=3A", { headers: hdrs }),
    );
    expect(klass.groups.find((group) => group.group === "classes")?.results.map((hit) => hit.title)).toContain("3A");

    const teacherInvoices = await json<{ groups: Array<{ results: Array<{ href: string }> }> }>(
      await app.request("/api/v1/search?q=invoices", { headers: teacherHdrs }),
    );
    expect(teacherInvoices.groups.flatMap((group) => group.results.map((hit) => hit.href))).not.toContain(
      "/school/finance/invoices",
    );
    const teacherSafeguarding = await json<{ groups: Array<{ results: Array<{ href: string }> }> }>(
      await app.request("/api/v1/search?q=safeguarding", { headers: teacherHdrs }),
    );
    expect(teacherSafeguarding.groups.flatMap((group) => group.results.map((hit) => hit.href))).not.toContain(
      "/school/safeguarding",
    );

    const otherToken = await login(app, other.adminEmail, "password-12x");
    const leaked = await json<{ groups: Array<{ group: string; results: Array<{ title: string }> }> }>(
      await app.request("/api/v1/search?q=John%20Smith", { headers: headers(otherToken, other.orgId) }),
    );
    expect(leaked.groups.find((group) => group.group === "pupils")?.results ?? []).toEqual([]);
  });

  it("runs fee schedule lifecycle, family statements, parent isolation, receipts and Stripe-backed checkout", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const other = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    await app.request("/api/v1/finance/settings", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ tuitionEnabled: true, invoicePrefix: "KSW-INV", receiptPrefix: "KSW-RCT" }),
    });

    const unused = await json<{ schedule: { id: string } }>(
      await app.request("/api/v1/finance/fee-schedules", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Unused trip",
          academicYearId: seeded.yearId,
          amountMinor: 45000,
          billingFrequency: "annual",
          effectiveFrom: "2026-09-07",
        }),
      }),
    );
    const unusedLoaded = await json<{ lifecycle: { canDelete: boolean } }>(
      await app.request(`/api/v1/finance/fee-schedules/${unused.schedule.id}`, { headers: hdrs }),
    );
    expect(unusedLoaded.lifecycle.canDelete).toBe(true);
    expect((await app.request(`/api/v1/finance/fee-schedules/${unused.schedule.id}`, { method: "DELETE", headers: hdrs })).status).toBe(200);

    const childA = await createStudent(app, hdrs, {
      legalName: "Child A Rasool",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const childB = await createStudent(app, hdrs, {
      legalName: "Child B Rasool",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year5Id,
    });
    const stranger = await createStudent(app, hdrs, {
      legalName: "Other Family",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
    });
    await inviteParent(app, hdrs, childA.student.id, `rasool-${id}@example.com`);
    await inviteParent(app, hdrs, childB.student.id, `rasool-${id}@example.com`);
    await inviteParent(app, hdrs, stranger.student.id, `other-${id}@example.com`);

    const year3 = await json<{ schedule: { id: string } }>(
      await app.request("/api/v1/finance/fee-schedules", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Year 3 Tuition",
          academicYearId: seeded.yearId,
          yearGroupId: seeded.year3Id,
          amountMinor: 200000,
          billingFrequency: "monthly",
          effectiveFrom: "2026-09-07",
        }),
      }),
    );
    const year5 = await json<{ schedule: { id: string } }>(
      await app.request("/api/v1/finance/fee-schedules", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Year 5 Tuition",
          academicYearId: seeded.yearId,
          yearGroupId: seeded.year5Id,
          amountMinor: 230000,
          billingFrequency: "monthly",
          effectiveFrom: "2026-09-07",
        }),
      }),
    );

    const genSep3 = await app.request(`/api/v1/finance/fee-schedules/${year3.schedule.id}/generate`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ periodStart: "2026-09-01", periodEnd: "2026-09-30", dueOn: "2026-09-15" }),
    });
    expect(genSep3.status).toBe(200);
    const sep3Preview = await json<{
      run: { id: string; status: string };
      deprecated: boolean;
      issuesInvoices: boolean;
    }>(genSep3);
    expect(sep3Preview.run.status).toBe("previewed");
    expect(sep3Preview.deprecated).toBe(true);
    expect(sep3Preview.issuesInvoices).toBe(false);
    const genSep5 = await app.request(`/api/v1/finance/fee-schedules/${year5.schedule.id}/generate`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ periodStart: "2026-09-01", periodEnd: "2026-09-30", dueOn: "2026-09-15" }),
    });
    expect(genSep5.status).toBe(200);
    const sep5Preview = await json<{ run: { id: string; status: string } }>(genSep5);
    expect(sep5Preview.run.status).toBe("previewed");
    const again = await app.request(`/api/v1/finance/fee-schedules/${year3.schedule.id}/generate`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ periodStart: "2026-09-01", periodEnd: "2026-09-30", dueOn: "2026-09-15" }),
    });
    expect(again.status).toBe(200);
    expect((await json<{ run: { id: string; status: string } }>(again)).run.status).toBe("previewed");

    const invoicesBeforeConfirm = await json<{ invoices: Array<{ id: string }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(invoicesBeforeConfirm.invoices).toHaveLength(0);

    expect(
      (
        await app.request(`/api/v1/finance/billing-runs/${sep3Preview.run.id}/confirm`, {
          method: "POST",
          headers: hdrs,
          body: "{}",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/finance/billing-runs/${sep5Preview.run.id}/confirm`, {
          method: "POST",
          headers: hdrs,
          body: "{}",
        })
      ).status,
    ).toBe(200);

    const invoices = await json<{ invoices: Array<{ id: string; reference: string; totalMinor: number; billingAccountName: string | null }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(invoices.invoices).toHaveLength(3);
    const refs = invoices.invoices.map((invoice) => invoice.reference);
    expect(new Set(refs).size).toBe(3);
    expect(refs.every((reference) => reference.startsWith("KSW-INV-"))).toBe(true);
    const childAInvoice = invoices.invoices.find((invoice) => invoice.totalMinor === 200000 && invoice.billingAccountName?.includes("Rasool"))!;
    const childBInvoice = invoices.invoices.find((invoice) => invoice.totalMinor === 230000)!;
    const strangerInvoice = invoices.invoices.find((invoice) => invoice.billingAccountName?.includes("Other"))!;
    expect(childAInvoice).toBeTruthy();
    expect(childBInvoice).toBeTruthy();

    const used = await json<{ lifecycle: { canDelete: boolean; hasInvoices: boolean } }>(
      await app.request(`/api/v1/finance/fee-schedules/${year3.schedule.id}`, { headers: hdrs }),
    );
    expect(used.lifecycle.canDelete).toBe(false);
    expect(used.lifecycle.hasInvoices).toBe(true);
    expect((await app.request(`/api/v1/finance/fee-schedules/${year3.schedule.id}`, { method: "DELETE", headers: hdrs })).status).toBe(409);

    await app.request(`/api/v1/finance/fee-schedules/${year3.schedule.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: 220000 }),
    });
    const genOct = await app.request(`/api/v1/finance/fee-schedules/${year3.schedule.id}/generate`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ periodStart: "2026-10-01", periodEnd: "2026-10-31", dueOn: "2026-10-15" }),
    });
    expect(genOct.status).toBe(200);
    const octPreview = await json<{ run: { id: string; status: string } }>(genOct);
    expect(octPreview.run.status).toBe("previewed");
    const invoicesAfterOctPreview = await json<{ invoices: Array<{ totalMinor: number }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(invoicesAfterOctPreview.invoices).toHaveLength(3);
    expect(invoicesAfterOctPreview.invoices.some((invoice) => invoice.totalMinor === 220000)).toBe(false);
    expect(
      (
        await app.request(`/api/v1/finance/billing-runs/${octPreview.run.id}/confirm`, {
          method: "POST",
          headers: hdrs,
          body: "{}",
        })
      ).status,
    ).toBe(200);
    const afterChange = await json<{ invoice: { totalMinor: number } }>(
      await app.request(`/api/v1/finance/invoices/${childAInvoice.id}`, { headers: hdrs }),
    );
    expect(afterChange.invoice.totalMinor).toBe(200000);
    const later = await json<{ invoices: Array<{ totalMinor: number; billingPeriodStart: string | null }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrs }),
    );
    expect(later.invoices.some((invoice) => invoice.totalMinor === 220000)).toBe(true);

    const parentToken = await login(app, `rasool-${id}@example.com`, "parent-pass-1");
    const parentHdrs = headers(parentToken, school.orgId);
    const otherParentToken = await login(app, `other-${id}@example.com`, "parent-pass-1");
    const otherParentHdrs = headers(otherParentToken, school.orgId);

    const family = await json<{ invoices: Array<{ id: string }>; outstandingMinor: number | null }>(
      await app.request("/api/v1/parent/finance", { headers: parentHdrs }),
    );
    expect(family.invoices.map((invoice) => invoice.id)).toEqual(
      expect.arrayContaining([childAInvoice.id, childBInvoice.id]),
    );
    expect(family.invoices.map((invoice) => invoice.id)).not.toContain(strangerInvoice.id);
    const cross = await app.request(`/api/v1/parent/finance/invoices/${strangerInvoice.id}`, { headers: parentHdrs });
    expect(cross.status).toBe(404);
    const otherSeesOwn = await app.request(`/api/v1/parent/finance/invoices/${strangerInvoice.id}`, {
      headers: otherParentHdrs,
    });
    expect(otherSeesOwn.status).toBe(200);

    const teacher = await inviteTeacher(app, hdrs, suffix());
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    expect((await app.request("/api/v1/finance/invoices", { headers: headers(teacherToken, school.orgId) })).status).toBe(403);

    const checkout = await app.request(`/api/v1/parent/finance/invoices/${childAInvoice.id}/checkout`, {
      method: "POST",
      headers: parentHdrs,
      body: JSON.stringify({ idempotencyKey: `pay-a-${id}` }),
    });
    expect(checkout.status).toBe(200);
    const session = await json<{ sessionId: string; checkoutUrl: string }>(checkout);
    const reuseOpen = await app.request(`/api/v1/parent/finance/invoices/${childAInvoice.id}/checkout`, {
      method: "POST",
      headers: parentHdrs,
      body: JSON.stringify({ idempotencyKey: `pay-a-${id}` }),
    });
    expect(reuseOpen.status).toBe(200);
    expect((await json<{ sessionId: string }>(reuseOpen)).sessionId).toBe(session.sessionId);
    const mismatchProvider = new FakePaymentProvider("test-fake-payment-webhook");
    const mismatchEvent = {
      providerKey: "fake" as const,
      eventId: `currency-mismatch-${session.sessionId}`,
      eventType: "demo.succeeded",
      providerSessionId: `fake_sess_${session.sessionId.replace(/-/g, "")}`,
      providerPaymentId: `fake_pay_${session.sessionId.replace(/-/g, "")}`,
      providerRefundId: null,
      amountMinor: 200000,
      currency: "USD",
      outcome: "succeeded" as const,
    };
    const mismatch = await app.request("/api/v1/webhooks/payments/fake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Schoolapp-Payment-Signature": mismatchProvider.signEvent(mismatchEvent),
      },
      body: JSON.stringify(mismatchEvent),
    });
    expect(mismatch.status).toBe(400);
    expect((await json<{ error: { code?: string; message: string } }>(mismatch)).error.message).toMatch(/currency/i);
    const stillUnpaidAfterMismatch = await json<{ invoice: { outstandingMinor: number } }>(
      await app.request(`/api/v1/parent/finance/invoices/${childAInvoice.id}`, { headers: parentHdrs }),
    );
    expect(stillUnpaidAfterMismatch.invoice.outstandingMinor).toBe(200000);
    const retryAfterMismatch = await app.request(`/api/v1/parent/finance/invoices/${childAInvoice.id}/checkout`, {
      method: "POST",
      headers: parentHdrs,
      body: JSON.stringify({ idempotencyKey: `pay-a-${id}` }),
    });
    expect(retryAfterMismatch.status).toBe(200);
    const retried = await json<{ sessionId: string; checkoutUrl: string }>(retryAfterMismatch);
    expect(retried.sessionId).not.toBe(session.sessionId);
    const cancelled = await app.request(`/api/v1/payments/demo/checkout/${retried.sessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "cancelled", t: demoToken(retried.checkoutUrl) }),
    });
    expect(cancelled.status).toBe(200);
    const stillDue = await json<{ invoice: { outstandingMinor: number; status: string } }>(
      await app.request(`/api/v1/parent/finance/invoices/${childAInvoice.id}`, { headers: parentHdrs }),
    );
    expect(stillDue.invoice.outstandingMinor).toBe(200000);

    const pay = await app.request(`/api/v1/parent/finance/invoices/${childAInvoice.id}/checkout`, {
      method: "POST",
      headers: parentHdrs,
      body: JSON.stringify({ idempotencyKey: `pay-a-ok-${id}` }),
    });
    const paidSession = await json<{ sessionId: string; checkoutUrl: string }>(pay);
    const paid = await app.request(`/api/v1/payments/demo/checkout/${paidSession.sessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "succeeded", t: demoToken(paidSession.checkoutUrl) }),
    });
    expect(paid.status).toBe(200);
    const replay = await app.request(`/api/v1/payments/demo/checkout/${paidSession.sessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "succeeded", t: demoToken(paidSession.checkoutUrl) }),
    });
    expect(replay.status).toBe(200);
    const settled = await json<{ invoice: { outstandingMinor: number; paidMinor: number; status: string }; payments: Array<{ id: string }> }>(
      await app.request(`/api/v1/finance/invoices/${childAInvoice.id}`, { headers: hdrs }),
    );
    expect(settled.invoice.outstandingMinor).toBe(0);
    expect(settled.invoice.paidMinor).toBe(200000);
    expect(settled.payments).toHaveLength(1);

    const receipts = await json<{ receipts: Array<{ id: string; reference: string }> }>(
      await app.request("/api/v1/parent/finance/receipts", { headers: parentHdrs }),
    );
    expect(receipts.receipts.length).toBeGreaterThan(0);
    expect(receipts.receipts[0]!.reference.startsWith("KSW-RCT-")).toBe(true);
    const receiptPdf = await app.request(`/api/v1/parent/finance/receipts/${receipts.receipts[0]!.id}/pdf`, {
      headers: parentHdrs,
    });
    expect(receiptPdf.status).toBe(200);
    expect(receiptPdf.headers.get("content-type")).toContain("application/pdf");
    const otherReceipt = await app.request(`/api/v1/parent/finance/receipts/${receipts.receipts[0]!.id}/pdf`, {
      headers: otherParentHdrs,
    });
    expect(otherReceipt.status).toBe(404);

    const invoicePdf = await app.request(`/api/v1/parent/finance/invoices/${childAInvoice.id}/pdf`, { headers: parentHdrs });
    expect(invoicePdf.status).toBe(200);
    expect(invoicePdf.headers.get("content-type")).toContain("application/pdf");

    const provider = new FakePaymentProvider("test-fake-payment-webhook");
    const refundEvent = {
      providerKey: "fake" as const,
      eventId: `refund-${paidSession.sessionId}`,
      eventType: "demo.refunded",
      providerSessionId: `fake_sess_${paidSession.sessionId.replace(/-/g, "")}`,
      providerPaymentId: `fake_pay_${paidSession.sessionId.replace(/-/g, "")}`,
      providerRefundId: `fake_re_${id}`,
      amountMinor: 200000,
      currency: "GBP",
      outcome: "refunded" as const,
    };
    const refund = await app.request("/api/v1/webhooks/payments/fake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Schoolapp-Payment-Signature": provider.signEvent(refundEvent),
      },
      body: JSON.stringify(refundEvent),
    });
    expect(refund.status).toBe(200);
    const afterRefund = await json<{
      invoice: { paidMinor: number; outstandingMinor: number };
      payments: Array<{ status: string }>;
      credits: Array<{ kind: string; amountMinor: number }>;
    }>(await app.request(`/api/v1/finance/invoices/${childAInvoice.id}`, { headers: hdrs }));
    expect(afterRefund.payments[0]?.status).toBe("succeeded");
    expect(afterRefund.credits.some((credit) => credit.kind === "refund" && credit.amountMinor === 200000)).toBe(true);

    const statement = await json<{
      document: { pupilNames: string[]; from: string; to: string; entries: Array<{ reference: string }> };
    }>(
      await app.request("/api/v1/parent/finance/statement?preset=current_academic_year", { headers: parentHdrs }),
    );
    expect(statement.document.from).toBe("2026-09-07");
    expect(statement.document.pupilNames.join(" ")).toMatch(/Child A/);
    expect(statement.document.pupilNames.join(" ")).toMatch(/Child B/);
    const zip = await app.request("/api/v1/parent/finance/statement?preset=current_academic_year&format=zip", {
      headers: parentHdrs,
    });
    expect(zip.status).toBe(200);
    expect(zip.headers.get("content-type")).toContain("application/zip");

    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const mail = await client.query<{ purpose: string }>(
        "select purpose from mail_outbox where organisation_id = $1 and purpose like 'finance_%'",
        [school.orgId],
      );
      expect(mail.rows.map((row) => row.purpose)).toEqual(
        expect.arrayContaining(["finance_invoice_issued", "finance_payment_received", "finance_refund_issued"]),
      );
      const leaked = await client.query("select id from school_invoices where organisation_id = $1", [other.orgId]);
      expect(leaked.rows).toHaveLength(0);
    });

    const badSig = await app.request("/api/v1/webhooks/payments/fake", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Schoolapp-Payment-Signature": "nope" },
      body: JSON.stringify(refundEvent),
    });
    expect(badSig.status).toBe(401);
  });
});
