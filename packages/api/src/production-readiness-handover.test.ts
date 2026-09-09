import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS, canAccessFinanceSettingsAdmin } from "@schoolapp/domain";
import { closePools } from "@schoolapp/db";
import { addMembership, ensureMigrated, insertUser, login, testApp, testPools } from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);

function jsonHeaders(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    "Content-Type": "application/json",
  };
}

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "School Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string }>(
    "insert into organisations (slug, name, status, timezone) values ($1, $2, 'active', 'Europe/London') returning id",
    [`pr71-${id}`, `Handover ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return { adminId, orgId: org.rows[0]!.id, adminEmail: `admin-${id}@example.com` };
}

describe("production readiness handover", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("keeps finance settings and Stripe config off Headteachers and teachers", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const headId = await insertUser(pools.owner, {
      email: `head-${id}@example.com`,
      password: "password-12x",
      fullName: "Headteacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, headId, "school.headteacher");
    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");

    const adminToken = await login(app, school.adminEmail, "password-12x");
    const headToken = await login(app, `head-${id}@example.com`, "password-12x");
    const teacherToken = await login(app, `teacher-${id}@example.com`, "password-12x");
    const adminHdrs = jsonHeaders(adminToken, school.orgId);
    const headHdrs = jsonHeaders(headToken, school.orgId);
    const teacherHdrs = jsonHeaders(teacherToken, school.orgId);

    await app.request("/api/v1/finance/settings", {
      method: "PATCH",
      headers: adminHdrs,
      body: JSON.stringify({ bankAccountNumber: "12345678", bankSortCode: "00-00-00" }),
    });

    const adminGet = await app.request("/api/v1/finance/settings", { headers: adminHdrs });
    expect(adminGet.status).toBe(200);
    const adminBody = (await adminGet.json()) as { settings: { bankAccountNumber: string | null } };
    expect(adminBody.settings.bankAccountNumber).toBe("12345678");

    const headGet = await app.request("/api/v1/finance/settings", { headers: headHdrs });
    expect(headGet.status).toBe(403);
    expect(JSON.stringify(await headGet.json())).not.toContain("12345678");

    expect((await app.request("/api/v1/finance/payment-provider", { headers: headHdrs })).status).toBe(403);
    expect((await app.request("/api/v1/finance/settings", { headers: teacherHdrs })).status).toBe(403);
    expect((await app.request("/api/v1/finance/payment-provider", { headers: teacherHdrs })).status).toBe(403);

    const headMe = (await (await app.request("/api/v1/me", { headers: headHdrs })).json()) as { permissions: string[] };
    expect(headMe.permissions).toContain(PERMISSIONS.FINANCE_INVOICES_READ);
    expect(headMe.permissions).not.toContain(PERMISSIONS.FINANCE_SETTINGS_MANAGE);
    expect(canAccessFinanceSettingsAdmin(headMe.permissions)).toBe(false);
  });

  it("defaults attendance and admissions reports to the current academic year, not a hard-coded 2026 window", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const created = await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "2025/26",
        startsOn: "2025-09-03",
        endsOn: "2026-07-22",
        isCurrent: true,
      }),
    });
    expect(created.status).toBe(201);

    const attendance = (await (await app.request("/api/v1/reports/attendance", { headers: hdrs })).json()) as {
      from: string;
      to: string;
    };
    expect(attendance.from).toBe("2025-09-03");
    expect(attendance.from).not.toBe("2026-09-01");
    expect(attendance.to).toBe("2026-07-22");

    const admissions = (await (await app.request("/api/v1/reports/admissions", { headers: hdrs })).json()) as {
      from: string;
      to: string;
      pupils: Array<{ admittedInPeriod: boolean; leftInPeriod: boolean }>;
    };
    expect(admissions.from).toBe("2025-09-03");
    expect(admissions.to).toBe("2026-07-22");
    expect(admissions.to).not.toBe("2027-07-31");
    expect(Array.isArray(admissions.pupils)).toBe(true);
  });
});
