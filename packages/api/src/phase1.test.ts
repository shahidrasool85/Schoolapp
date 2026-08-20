import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@schoolapp/domain";
import { canReadRestrictedContact, canReadStudentProfile } from "@schoolapp/core";
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

describe("Phase 1 foundation", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("provisions a school, accepts an invite, and returns /me with memberships", async () => {
    const id = suffix();
    const platformId = await insertUser(pools.owner, {
      email: `platform-${id}@example.com`,
      password: "platform-pass-1",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    const token = await login(app, `platform-${id}@example.com`, "platform-pass-1");

    const created = await app.request("/api/v1/platform/organisations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `School ${id}`,
        slug: `school-${id}`,
        adminEmail: `admin-${id}@example.com`,
        adminFullName: "Ada Admin",
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      organisationId: string;
      invitationToken: string;
    };

    const accepted = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: createdBody.invitationToken,
        fullName: "Ada Admin",
        password: "admin-pass-12",
      }),
    });
    expect(accepted.status).toBe(200);

    const adminToken = await login(app, `admin-${id}@example.com`, "admin-pass-12");
    const memberships = await app.request("/api/v1/me/memberships", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(memberships.status).toBe(200);
    const membershipBody = (await memberships.json()) as {
      memberships: Array<{ organisationId: string; roleKeys: string[] }>;
    };
    expect(membershipBody.memberships).toHaveLength(1);
    expect(membershipBody.memberships[0]?.organisationId).toBe(createdBody.organisationId);
    expect(membershipBody.memberships[0]?.roleKeys).toContain("school.admin");

    const me = await app.request("/api/v1/me", {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "X-Organisation-Id": createdBody.organisationId,
      },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { permissions: string[]; organisationId: string };
    expect(meBody.organisationId).toBe(createdBody.organisationId);
    expect(meBody.permissions).toContain(PERMISSIONS.ORG_MEMBERS_MANAGE);
    expect(meBody.permissions).not.toContain(PERMISSIONS.PLATFORM_ORGANISATIONS_MANAGE);
    void platformId;
  });

  it("rejects a spoofed organisation header and does not leak the other school's data", async () => {
    const id = suffix();
    const ownerA = await insertUser(pools.owner, {
      email: `a-admin-${id}@example.com`,
      password: "password-12x",
      fullName: "Admin A",
      kind: "staff",
    });
    const ownerB = await insertUser(pools.owner, {
      email: `b-admin-${id}@example.com`,
      password: "password-12x",
      fullName: "Admin B",
      kind: "staff",
    });
    const orgA = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`a-${id}`, "School A"],
    );
    const orgB = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`b-${id}`, "School B"],
    );
    await addMembership(pools.owner, orgA.rows[0]!.id, ownerA, "school.admin");
    await addMembership(pools.owner, orgB.rows[0]!.id, ownerB, "school.admin");
    await pools.owner.query(
      "insert into student_profiles (organisation_id, legal_name) values ($1, $2), ($3, $4)",
      [orgA.rows[0]!.id, "Pupil A", orgB.rows[0]!.id, "Pupil B"],
    );

    const tokenA = await login(app, `a-admin-${id}@example.com`, "password-12x");
    const spoof = await app.request("/api/v1/organisation", {
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "X-Organisation-Id": orgB.rows[0]!.id,
      },
    });
    expect(spoof.status).toBe(403);
    const spoofBody = (await spoof.json()) as { error: { code: string } };
    expect(spoofBody.error.code).toMatch(/org_membership_required|support_grant_required/);

    const missing = await app.request("/api/v1/organisation", {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(missing.status).toBe(400);
    const missingBody = (await missing.json()) as { error: { code: string } };
    expect(missingBody.error.code).toBe("org_context_required");

    await withTenantContext(pools.app, ownerA, orgA.rows[0]!.id, async (client) => {
      const seen = await client.query<{ legal_name: string }>(
        "select legal_name from student_profiles",
      );
      expect(seen.rows.map((r) => r.legal_name)).toEqual(["Pupil A"]);
    });

    const pupilB = await pools.owner.query<{ id: string }>(
      "select id from student_profiles where organisation_id = $1",
      [orgB.rows[0]!.id],
    );
    const foreign = await app.request(`/api/v1/me`, {
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "X-Organisation-Id": pupilB.rows[0]!.id,
      },
    });
    expect(foreign.status).toBe(403);
  });

  it("discards transaction-local tenant context after commit (pool leak)", async () => {
    const id = suffix();
    const userId = await insertUser(pools.owner, {
      email: `leak-${id}@example.com`,
      password: "password-12x",
      fullName: "Leak Test",
      kind: "staff",
    });
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`leak-${id}`, "Leak School"],
    );
    await addMembership(pools.owner, org.rows[0]!.id, userId, "school.teacher");
    await pools.owner.query("insert into student_profiles (organisation_id, legal_name) values ($1, $2)", [
      org.rows[0]!.id,
      "Hidden after commit",
    ]);

    await withTenantContext(pools.app, userId, org.rows[0]!.id, async (client) => {
      const inside = await client.query("select count(*)::int as n from student_profiles");
      expect(inside.rows[0]?.n).toBe(1);
    });

    const client = await pools.app.connect();
    try {
      const after = await client.query("select count(*)::int as n from student_profiles");
      expect(after.rows[0]?.n).toBe(0);
    } finally {
      client.release();
    }
  });

  it("does not grant school-wide pupil read to Teacher, including restricted_contact", async () => {
    const id = suffix();
    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`teach-${id}`, "Teach School"],
    );
    await addMembership(pools.owner, org.rows[0]!.id, teacherId, "school.teacher");
    const student = await pools.owner.query<{ id: string }>(
      "insert into student_profiles (organisation_id, legal_name) values ($1, $2) returning id",
      [org.rows[0]!.id, "Unassigned pupil"],
    );

    const perms = await pools.app.query<{ permission_key: string }>(
      "select permission_key from list_permissions_for_membership($1, $2)",
      [teacherId, org.rows[0]!.id],
    );
    const set = new Set(perms.rows.map((r) => r.permission_key));
    expect(set.has(PERMISSIONS.STUDENTS_PROFILES_READ)).toBe(false);
    expect(set.has(PERMISSIONS.STUDENTS_PROFILES_READ_ASSIGNED)).toBe(true);
    expect(set.has(PERMISSIONS.STUDENTS_RESTRICTED_CONTACT_READ)).toBe(false);
    expect(canReadRestrictedContact(set)).toBe(false);

    await withTenantContext(pools.app, teacherId, org.rows[0]!.id, async (client) => {
      const allowed = await canReadStudentProfile(
        client,
        teacherId,
        org.rows[0]!.id,
        student.rows[0]!.id,
        set,
      );
      expect(allowed).toBe(false);
      await expect(client.query("select restricted_contact from guardianships")).rejects.toThrow();
    });
  });

  it("allows a primary year-group enrolment plus an exceptional placement in the same year", async () => {
    const id = suffix();
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`enr-${id}`, "Enrol School"],
    );
    const year = await pools.owner.query<{ id: string }>(
      `insert into academic_years (organisation_id, name, starts_on, ends_on, is_current)
       values ($1, '2026/27', '2026-09-01', '2027-07-31', true) returning id`,
      [org.rows[0]!.id],
    );
    const yg3 = await pools.owner.query<{ id: string }>(
      "insert into year_groups (organisation_id, code, name, sort_order) values ($1, '3', 'Year 3', 3) returning id",
      [org.rows[0]!.id],
    );
    const yg4 = await pools.owner.query<{ id: string }>(
      "insert into year_groups (organisation_id, code, name, sort_order) values ($1, '4', 'Year 4', 4) returning id",
      [org.rows[0]!.id],
    );
    const student = await pools.owner.query<{ id: string }>(
      "insert into student_profiles (organisation_id, legal_name) values ($1, 'Split') returning id",
      [org.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into student_enrolments (
         organisation_id, student_profile_id, academic_year_id, year_group_id,
         status, is_primary, placement_kind, started_on
       ) values ($1,$2,$3,$4,'enrolled', true, 'primary', '2026-09-01')`,
      [org.rows[0]!.id, student.rows[0]!.id, year.rows[0]!.id, yg3.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into student_enrolments (
         organisation_id, student_profile_id, academic_year_id, year_group_id,
         status, is_primary, placement_kind, started_on
       ) values ($1,$2,$3,$4,'enrolled', false, 'exceptional', '2026-09-01')`,
      [org.rows[0]!.id, student.rows[0]!.id, year.rows[0]!.id, yg4.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        `insert into student_enrolments (
           organisation_id, student_profile_id, academic_year_id, year_group_id,
           status, is_primary, placement_kind, started_on
         ) values ($1,$2,$3,$4,'enrolled', true, 'primary', '2026-09-01')`,
        [org.rows[0]!.id, student.rows[0]!.id, year.rows[0]!.id, yg4.rows[0]!.id],
      ),
    ).rejects.toThrow();
  });

  it("requires break-glass for platform admin tenant access and writes a high-priority audit event", async () => {
    const id = suffix();
    await insertUser(pools.owner, {
      email: `plat-${id}@example.com`,
      password: "platform-pass-1",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`bg-${id}`, "Breakglass School"],
    );
    await pools.owner.query("insert into organisation_settings (organisation_id) values ($1)", [
      org.rows[0]!.id,
    ]);
    const token = await login(app, `plat-${id}@example.com`, "platform-pass-1");

    const denied = await app.request("/api/v1/organisation", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Organisation-Id": org.rows[0]!.id,
      },
    });
    expect(denied.status).toBe(403);

    const grant = await app.request(`/api/v1/platform/organisations/${org.rows[0]!.id}/support-access`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reason: "Investigating a login issue for the school admin",
        scope: "organisation_metadata",
        ttlMinutes: 30,
      }),
    });
    expect(grant.status).toBe(201);

    const allowed = await app.request("/api/v1/organisation", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Organisation-Id": org.rows[0]!.id,
      },
    });
    expect(allowed.status).toBe(200);

    const audit = await pools.owner.query<{ action: string; priority: string }>(
      `select action, priority from audit_events
       where organisation_id = $1 and action = 'platform.support_access.granted'`,
      [org.rows[0]!.id],
    );
    expect(audit.rows[0]?.priority).toBe("high");
  });

  it("prevents the application role from updating or deleting audit events", async () => {
    const id = suffix();
    const userId = await insertUser(pools.owner, {
      email: `audit-${id}@example.com`,
      password: "password-12x",
      fullName: "Auditor",
      kind: "staff",
    });
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`aud-${id}`, "Audit School"],
    );
    await addMembership(pools.owner, org.rows[0]!.id, userId, "school.admin");
    const event = await pools.owner.query<{ id: string }>(
      `insert into audit_events (organisation_id, actor_user_id, action, entity_type, entity_id)
       values ($1, $2, 'test.event', 'organisation', $1) returning id`,
      [org.rows[0]!.id, userId],
    );

    await withTenantContext(pools.app, userId, org.rows[0]!.id, async (client) => {
      await expect(
        client.query("update audit_events set action = 'tamper' where id = $1", [event.rows[0]!.id]),
      ).rejects.toThrow();
      await expect(client.query("delete from audit_events where id = $1", [event.rows[0]!.id])).rejects.toThrow();
    });
  });

  it("keeps Headteacher out of member-management permissions", async () => {
    const id = suffix();
    const headId = await insertUser(pools.owner, {
      email: `head-${id}@example.com`,
      password: "password-12x",
      fullName: "Head",
      kind: "staff",
    });
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`head-${id}`, "Head School"],
    );
    await addMembership(pools.owner, org.rows[0]!.id, headId, "school.headteacher");
    const perms = await pools.app.query<{ permission_key: string }>(
      "select permission_key from list_permissions_for_membership($1, $2)",
      [headId, org.rows[0]!.id],
    );
    const set = new Set(perms.rows.map((r) => r.permission_key));
    expect(set.has(PERMISSIONS.ORG_MEMBERS_MANAGE)).toBe(false);
    expect(set.has(PERMISSIONS.ORG_SETTINGS_MANAGE)).toBe(false);
    expect(set.has(PERMISSIONS.STUDENTS_PROFILES_READ)).toBe(true);
    expect(set.has(PERMISSIONS.ORG_SETTINGS_READ)).toBe(true);
  });
});
