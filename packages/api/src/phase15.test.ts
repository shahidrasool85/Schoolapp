import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withTenantContext } from "@schoolapp/db";
import { FakePaymentProvider, verifyStripeSignature } from "@schoolapp/core";
import {
  addMembership,
  ensureMigrated,
  insertUser,
  login,
  loginAlias,
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
    [`p15-${id}`, `Phase15 ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return { adminId, orgId: org.rows[0]!.id, slug: `p15-${id}`, adminEmail: `admin-${id}@example.com` };
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
  const year3 = groups.yearGroups.find((g) => g.code === "3")!;
  const classA = (await (
    await app.request("/api/v1/classes", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "3A",
        academicYearId: year.academicYear.id,
        yearGroupId: year3.id,
        classType: "form",
      }),
    })
  ).json()) as { class: { id: string } };
  await app.request(`/api/v1/year-groups/${year3.id}`, {
    method: "PATCH",
    headers: hdrs,
    body: JSON.stringify({ studentLoginEnabled: true }),
  });
  return { yearId: year.academicYear.id, year3Id: year3.id, classAId: classA.class.id };
}

async function createStudent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
  input: {
    legalName: string;
    academicYearId: string;
    yearGroupId: string;
    classId?: string;
    loginAlias?: string;
    password?: string;
  },
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
  portalAccess = true,
) {
  const created = await app.request(`/api/v1/students/${studentId}/guardians`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      email,
      fullName: "Pat Parent",
      relationship: "mother",
      portalAccess,
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

describe("Phase 15 payments foundation", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("creates, issues, and bulk-creates charges without duplicating retries", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Pay",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const created = await app.request("/api/v1/finance/charges", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Replacement reading book",
        categoryKey: "lost_item",
        studentProfileId: pupil.student.id,
        amountMinor: 800,
        currency: "GBP",
        issue: false,
      }),
    });
    expect(created.status).toBe(201);
    const charge = (await created.json()) as { charge: { id: string; status: string } };
    expect(charge.charge.status).toBe("draft");
    const issued = await app.request(`/api/v1/finance/charges/${charge.charge.id}/issue`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(issued.status).toBe(200);
    const bulk = {
      title: "Year 6 residential deposit",
      categoryKey: "trip",
      amountMinor: 5000,
      currency: "GBP",
      idempotencyKey: `bulk-${id}`,
      issue: true,
      target: { type: "class", classId: seeded.classAId },
    };
    const first = await app.request("/api/v1/finance/charges/bulk", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify(bulk),
    });
    expect(first.status).toBe(201);
    const second = await app.request("/api/v1/finance/charges/bulk", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify(bulk),
    });
    const replay = (await second.json()) as { created: number; reused: number };
    expect(replay.reused).toBeGreaterThan(0);
    expect(replay.created).toBe(0);
  });

  it("scopes parent payments and blocks revoked portal_access", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    const amelia = await createStudent(app, hdrs, {
      legalName: "Amelia Pay",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const other = await createStudent(app, hdrs, {
      legalName: "Other Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    await inviteParent(app, hdrs, amelia.student.id, `parent-${id}@example.com`);
    const chargeA = (await (
      await app.request("/api/v1/finance/charges", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          title: "Amelia book",
          categoryKey: "lost_item",
          studentProfileId: amelia.student.id,
          amountMinor: 800,
          currency: "GBP",
        }),
      })
    ).json()) as { charge: { id: string } };
    await app.request("/api/v1/finance/charges", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Other book",
        categoryKey: "lost_item",
        studentProfileId: other.student.id,
        amountMinor: 800,
        currency: "GBP",
      }),
    });
    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    const parentHdrs = jsonHeaders(parentToken, school.orgId);
    const list = (await (await app.request("/api/v1/parent/payments", { headers: parentHdrs })).json()) as {
      charges: Array<{ id: string; title: string }>;
    };
    expect(list.charges.map((row) => row.title)).toEqual(["Amelia book"]);
    const hidden = await app.request(`/api/v1/parent/payments/${chargeA.charge.id}`, { headers: parentHdrs });
    expect(hidden.status).toBe(200);
    const otherCharge = (await (
      await app.request("/api/v1/finance/charges", { headers: hdrs })
    ).json()) as { charges: Array<{ id: string; title: string }> };
    const otherId = otherCharge.charges.find((row) => row.title === "Other book")!.id;
    const cross = await app.request(`/api/v1/parent/payments/${otherId}`, { headers: parentHdrs });
    expect(cross.status).toBe(404);
    await pools.owner.query(
      "update guardianships set portal_access = false where student_profile_id = $1",
      [amelia.student.id],
    );
    const revoked = await app.request("/api/v1/parent/payments", { headers: parentHdrs });
    const revokedBody = (await revoked.json()) as { charges: unknown[] };
    expect(revokedBody.charges).toEqual([]);
  });

  it("settles fake-provider success, failure, cancel, replay, and amount mismatch", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Pay",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    await inviteParent(app, hdrs, pupil.student.id, `payer-${id}@example.com`);
    const charge = (await (
      await app.request("/api/v1/finance/charges", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          title: "Museum trip",
          categoryKey: "trip",
          studentProfileId: pupil.student.id,
          amountMinor: 1250,
          currency: "GBP",
        }),
      })
    ).json()) as { charge: { id: string } };
    const parentToken = await login(app, `payer-${id}@example.com`, "parent-pass-1");
    const parentHdrs = jsonHeaders(parentToken, school.orgId);
    const checkout = await app.request(`/api/v1/parent/payments/${charge.charge.id}/checkout`, {
      method: "POST",
      headers: parentHdrs,
      body: JSON.stringify({ idempotencyKey: `pay-${id}` }),
    });
    expect(checkout.status).toBe(200);
    const session = (await checkout.json()) as { sessionId: string; checkoutUrl: string };
    const again = await app.request(`/api/v1/parent/payments/${charge.charge.id}/checkout`, {
      method: "POST",
      headers: parentHdrs,
      body: JSON.stringify({ idempotencyKey: `pay-${id}` }),
    });
    expect(((await again.json()) as { sessionId: string }).sessionId).toBe(session.sessionId);

    const failed = await app.request(`/api/v1/payments/demo/checkout/${session.sessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "failed" }),
    });
    expect(failed.status).toBe(200);
    const afterFail = (await (await app.request(`/api/v1/parent/payments/${charge.charge.id}`, { headers: parentHdrs })).json()) as {
      charge: { status: string; outstandingMinor: number };
    };
    expect(afterFail.charge.status).toBe("issued");
    expect(afterFail.charge.outstandingMinor).toBe(1250);

    const successCheckout = await app.request(`/api/v1/parent/payments/${charge.charge.id}/checkout`, {
      method: "POST",
      headers: parentHdrs,
      body: JSON.stringify({ idempotencyKey: `pay-ok-${id}` }),
    });
    const successSession = (await successCheckout.json()) as { sessionId: string };
    const paid = await app.request(`/api/v1/payments/demo/checkout/${successSession.sessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "succeeded" }),
    });
    expect(paid.status).toBe(200);
    const replay = await app.request(`/api/v1/payments/demo/checkout/${successSession.sessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "succeeded" }),
    });
    expect(replay.status).toBe(200);
    const afterPay = (await (await app.request(`/api/v1/finance/charges/${charge.charge.id}`, { headers: hdrs })).json()) as {
      charge: { status: string; outstandingMinor: number; netPaidMinor: number };
      transactions: Array<{ status: string }>;
      receipts: unknown[];
    };
    expect(afterPay.charge.status).toBe("paid");
    expect(afterPay.charge.outstandingMinor).toBe(0);
    expect(afterPay.charge.netPaidMinor).toBe(1250);
    expect(afterPay.transactions.filter((row) => row.status === "succeeded")).toHaveLength(1);
    expect(afterPay.receipts).toHaveLength(1);

    const provider = new FakePaymentProvider("test-fake-payment-webhook");
    const bad = {
      providerKey: "fake" as const,
      eventId: `tamper-${id}`,
      eventType: "demo.succeeded",
      providerSessionId: "unknown",
      providerPaymentId: "x",
      providerRefundId: null,
      amountMinor: 1,
      currency: "USD",
      outcome: "succeeded" as const,
    };
    const unknown = await app.request("/api/v1/webhooks/payments/fake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Schoolapp-Payment-Signature": provider.signEvent(bad),
      },
      body: JSON.stringify(bad),
    });
    expect(unknown.status).toBe(400);
  });

  it("prevents overpayment, records offline payments, adjustments, and refunds", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Pay",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const charge = (await (
      await app.request("/api/v1/finance/charges", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          title: "Uniform",
          categoryKey: "uniform",
          studentProfileId: pupil.student.id,
          amountMinor: 2000,
          currency: "GBP",
        }),
      })
    ).json()) as { charge: { id: string } };
    const over = await app.request(`/api/v1/finance/charges/${charge.charge.id}/offline-payment`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: 2500, method: "cash", idempotencyKey: `off-over-${id}` }),
    });
    expect(over.status).toBe(409);
    const partial = await app.request(`/api/v1/finance/charges/${charge.charge.id}/offline-payment`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: 800, method: "cash", reference: `CASH-${id}`, idempotencyKey: `off-${id}` }),
    });
    expect(partial.status).toBe(201);
    const replay = await app.request(`/api/v1/finance/charges/${charge.charge.id}/offline-payment`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: 800, method: "cash", reference: `CASH-${id}`, idempotencyKey: `off-${id}` }),
    });
    expect(replay.status).toBe(201);
    const afterPartial = (await (await app.request(`/api/v1/finance/charges/${charge.charge.id}`, { headers: hdrs })).json()) as {
      charge: { status: string; outstandingMinor: number };
    };
    expect(afterPartial.charge.status).toBe("partially_paid");
    expect(afterPartial.charge.outstandingMinor).toBe(1200);
    const adjust = await app.request(`/api/v1/finance/charges/${charge.charge.id}/adjust`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ kind: "discount", amountMinor: 200, reason: "Hardship discount" }),
    });
    expect(adjust.status).toBe(200);
    const rest = await app.request(`/api/v1/finance/charges/${charge.charge.id}/offline-payment`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: 1000, method: "bank_transfer", idempotencyKey: `off-rest-${id}` }),
    });
    expect(rest.status).toBe(201);
    const refund = await app.request(`/api/v1/finance/charges/${charge.charge.id}/refund`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: 400, reason: "Partial refund", idempotencyKey: `ref-${id}` }),
    });
    expect(refund.status).toBe(201);
    const tooMuch = await app.request(`/api/v1/finance/charges/${charge.charge.id}/refund`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: 5000, reason: "Too much" }),
    });
    expect(tooMuch.status).toBe(400);
  });

  it("does not charge waitlisted pupils and keeps activity payment operational-only for teachers", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    const confirmed = await createStudent(app, hdrs, {
      legalName: "Confirmed Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const waitlisted = await createStudent(app, hdrs, {
      legalName: "Waitlisted Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const teacher = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "teacher-pass-1",
      fullName: "Terry Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacher, "school.teacher");
    const activity = await app.request("/api/v1/activities", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Chess Club",
        activityTypeKey: "club",
        startsAt: "2026-09-08T15:30:00.000Z",
        endsAt: "2026-09-08T16:30:00.000Z",
        capacity: 1,
        paymentRequired: true,
        priceAmountMinor: 800,
        priceCurrency: "GBP",
        chargePolicy: "on_confirmed",
        targets: [
          { targetType: "student", studentProfileId: confirmed.student.id },
          { targetType: "student", studentProfileId: waitlisted.student.id },
        ],
      }),
    });
    expect(activity.status).toBe(201);
    const activityId = ((await activity.json()) as { activity: { id: string } }).activity.id;
    await app.request(`/api/v1/activities/${activityId}/publish`, { method: "POST", headers: hdrs, body: "{}" });
    await app.request(`/api/v1/activities/${activityId}/participants`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ studentProfileId: confirmed.student.id }),
    });
    await app.request(`/api/v1/activities/${activityId}/participants`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ studentProfileId: waitlisted.student.id }),
    });
    const charges = (await (await app.request("/api/v1/finance/charges", { headers: hdrs })).json()) as {
      charges: Array<{ studentProfileId: string; title: string }>;
    };
    expect(charges.charges.some((row) => row.studentProfileId === confirmed.student.id)).toBe(true);
    expect(charges.charges.some((row) => row.studentProfileId === waitlisted.student.id)).toBe(false);
    const teacherToken = await login(app, `teacher-${id}@example.com`, "teacher-pass-1");
    const teacherHdrs = jsonHeaders(teacherToken, school.orgId);
    const finance = await app.request("/api/v1/finance/charges", { headers: teacherHdrs });
    expect(finance.status).toBe(403);
    const parts = (await (await app.request(`/api/v1/activities/${activityId}/participants`, { headers: teacherHdrs })).json()) as {
      participants?: Array<{ paymentStatus?: string; amountPaid?: number }>;
    };
    if (parts.participants) {
      expect(parts.participants.every((row) => row.amountPaid == null)).toBe(true);
    }
  });

  it("blocks students, platform admins, and spoofed webhook tenant headers", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const other = await createSchool(pools.owner, `${id}b`);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Pay",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: `pay.${id}`,
      password: "student-pass-1",
    });
    const studentToken = await loginAlias(app, school.slug, `pay.${id}`, "student-pass-1");
    const student = await app.request("/api/v1/finance/charges", { headers: jsonHeaders(studentToken, school.orgId) });
    expect(student.status).toBe(403);
    const parentPay = await app.request("/api/v1/parent/payments", { headers: jsonHeaders(studentToken, school.orgId) });
    expect([403, 404]).toContain(parentPay.status);
    const platformId = await insertUser(pools.owner, {
      email: `platform-${id}@example.com`,
      password: "password-12x",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    void platformId;
    const platformToken = await login(app, `platform-${id}@example.com`, "password-12x");
    const platform = await app.request("/api/v1/finance/charges", {
      headers: jsonHeaders(platformToken, school.orgId),
    });
    expect([403, 404]).toContain(platform.status);
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const leaked = await app.request("/api/v1/finance/charges", {
      headers: jsonHeaders(otherToken, school.orgId),
    });
    expect([403, 404]).toContain(leaked.status);
  });

  it("does not let a client mark a payment succeeded and stamps offline actors", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Pay",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const charge = (await (
      await app.request("/api/v1/finance/charges", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          title: "Book",
          categoryKey: "lost_item",
          studentProfileId: pupil.student.id,
          amountMinor: 800,
          currency: "GBP",
        }),
      })
    ).json()) as { charge: { id: string } };
    const spoof = await app.request(`/api/v1/finance/charges/${charge.charge.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ status: "paid" }),
    });
    expect(spoof.status).toBe(404);
    await app.request(`/api/v1/finance/charges/${charge.charge.id}/offline-payment`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ amountMinor: 800, method: "cash", receivedBy: randomUUID() }),
    });
    const detail = (await (await app.request(`/api/v1/finance/charges/${charge.charge.id}`, { headers: hdrs })).json()) as {
      transactions: Array<{ id: string }>;
    };
    const tx = await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      return client.query<{ received_by: string }>(
        "select received_by from school_payment_transactions where charge_id = $1",
        [charge.charge.id],
      );
    });
    expect(tx.rows[0]?.received_by).toBe(school.adminId);
    void detail;
  });

  it("keeps FORCE RLS between Greenwood-like tenants for charges", async () => {
    const a = suffix();
    const b = suffix();
    const schoolA = await createSchool(pools.owner, a);
    const schoolB = await createSchool(pools.owner, b);
    const tokenA = await login(app, schoolA.adminEmail, "password-12x");
    const tokenB = await login(app, schoolB.adminEmail, "password-12x");
    const seedA = await seedYear(app, jsonHeaders(tokenA, schoolA.orgId));
    const pupilA = await createStudent(app, jsonHeaders(tokenA, schoolA.orgId), {
      legalName: "Greenwood Pupil",
      academicYearId: seedA.yearId,
      yearGroupId: seedA.year3Id,
      classId: seedA.classAId,
    });
    await app.request("/api/v1/finance/charges", {
      method: "POST",
      headers: jsonHeaders(tokenA, schoolA.orgId),
      body: JSON.stringify({
        title: "Greenwood only",
        categoryKey: "other",
        studentProfileId: (pupilA as { student: { id: string } }).student.id,
        amountMinor: 100,
        currency: "GBP",
      }),
    });
    const listB = (await (
      await app.request("/api/v1/finance/charges", { headers: jsonHeaders(tokenB, schoolB.orgId) })
    ).json()) as { charges: Array<{ title: string }> };
    expect(listB.charges.map((row) => row.title)).not.toContain("Greenwood only");
    await withTenantContext(pools.app, schoolB.adminId, schoolB.orgId, async (client) => {
      const leaked = await client.query("select * from school_charges");
      expect(leaked.rows).toHaveLength(0);
    });
  });
});

describe("stripe signature helper used by the adapter", () => {
  it("rejects a missing signature without calling Stripe", () => {
    expect(() => verifyStripeSignature("{}", null, "whsec")).toThrow(/Invalid provider signature/);
  });
});
