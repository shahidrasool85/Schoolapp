import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools } from "@schoolapp/db";
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

const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = Uint8Array.from(PNG_1X1);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const VALID_PNG = pngHeader(64, 64);

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin User",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`prof-${id}`, `Profile ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  await owner.query(
    "insert into staff_profiles (organisation_id, user_id, job_title, employee_number) values ($1, $2, 'School Admin', 'ADM-1')",
    [org.rows[0]!.id, adminId],
  );
  return {
    adminId,
    orgId: org.rows[0]!.id,
    slug: org.rows[0]!.slug,
    adminEmail: `admin-${id}@example.com`,
  };
}

function jsonHeaders(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    "Content-Type": "application/json",
  };
}

function authHeaders(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
  };
}

function imageForm(bytes: Uint8Array, filename = "photo.png", type = "image/png") {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), filename);
  return form;
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("user profiles and photos", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("keeps existing staff readable and blocks self-escalation", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const adminHdrs = jsonHeaders(adminToken, school.orgId);

    const created = await json<{ staffProfileId: string; invitationToken: string; userId: string }>(
      await app.request("/api/v1/staff", {
        method: "POST",
        headers: adminHdrs,
        body: JSON.stringify({
          email: `teacher-${id}@example.com`,
          fullName: "Terry Teacher",
          jobTitle: "Class teacher",
          employeeNumber: "EMP-9",
          roleKeys: ["school.teacher"],
        }),
      }),
    );
    expect(created.staffProfileId).toBeTruthy();

    const accepted = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: created.invitationToken,
        fullName: "Terry Teacher",
        password: "teacher-pass-1",
      }),
    });
    expect(accepted.status).toBe(200);
    const teacherToken = await login(app, `teacher-${id}@example.com`, "teacher-pass-1");
    const teacherHdrs = jsonHeaders(teacherToken, school.orgId);

    const listed = await json<{ staff: Array<{ fullName: string; jobTitle: string; employeeNumber: string; photoUrl: string | null }> }>(
      await app.request("/api/v1/staff", { headers: adminHdrs }),
    );
    const row = listed.staff.find((item) => item.fullName === "Terry Teacher");
    expect(row?.jobTitle).toBe("Class teacher");
    expect(row?.employeeNumber).toBe("EMP-9");
    expect(row?.photoUrl).toBeNull();

    const own = await json<{
      profile: { editableFields: string[]; jobTitle: string | null; employeeNumber: string | null };
    }>(await app.request("/api/v1/me/profile", { headers: teacherHdrs }));
    expect(own.profile.editableFields).toContain("phone");
    expect(own.profile.editableFields).not.toContain("jobTitle");
    expect(own.profile.jobTitle).toBe("Class teacher");
    expect(own.profile.employeeNumber).toBe("EMP-9");

    const escalate = await app.request("/api/v1/me/profile", {
      method: "PATCH",
      headers: teacherHdrs,
      body: JSON.stringify({ roleKeys: ["school.admin"] }),
    });
    expect(escalate.status).toBe(403);

    const job = await app.request("/api/v1/me/profile", {
      method: "PATCH",
      headers: teacherHdrs,
      body: JSON.stringify({ jobTitle: "Headteacher", employeeNumber: "HACK" }),
    });
    expect(job.status).toBe(403);

    const phone = await app.request("/api/v1/me/profile", {
      method: "PATCH",
      headers: teacherHdrs,
      body: JSON.stringify({ phone: "01234 567890", preferredName: "Tel" }),
    });
    expect(phone.status).toBe(200);

    const adminUpdate = await app.request(`/api/v1/staff/${created.staffProfileId}`, {
      method: "PATCH",
      headers: adminHdrs,
      body: JSON.stringify({
        title: "Mr",
        addressTown: "Kingswood",
        addressPostcode: "KT20 1AA",
        jobTitle: "Form tutor",
      }),
    });
    expect(adminUpdate.status).toBe(200);

    const detail = await json<{ staff: { title: string; addressTown: string; jobTitle: string } }>(
      await app.request(`/api/v1/staff/${created.staffProfileId}`, { headers: adminHdrs }),
    );
    expect(detail.staff.title).toBe("Mr");
    expect(detail.staff.addressTown).toBe("Kingswood");
    expect(detail.staff.jobTitle).toBe("Form tutor");
  });

  it("validates profile photos and isolates them by tenant", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const other = await createSchool(pools.owner, `${id}b`);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const hdrs = authHeaders(adminToken, school.orgId);
    const jsonHdrs = jsonHeaders(adminToken, school.orgId);

    const staff = await json<{ staffProfileId: string; invitationToken: string }>(
      await app.request("/api/v1/staff", {
        method: "POST",
        headers: jsonHdrs,
        body: JSON.stringify({
          email: `photo-${id}@example.com`,
          fullName: "Peta Photo",
          roleKeys: ["school.teacher"],
        }),
      }),
    );
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: staff.invitationToken, fullName: "Peta Photo", password: "teacher-pass-1" }),
    });
    const teacherToken = await login(app, `photo-${id}@example.com`, "teacher-pass-1");

    const mime = await app.request("/api/v1/me/profile/photo", {
      method: "POST",
      headers: authHeaders(teacherToken, school.orgId),
      body: imageForm(Buffer.from("%PDF-1.1"), "virus.pdf", "application/pdf"),
    });
    expect(mime.status).toBe(400);

    const huge = new Uint8Array(2 * 1024 * 1024 + 64);
    huge.set(VALID_PNG, 0);
    const oversized = await app.request("/api/v1/me/profile/photo", {
      method: "POST",
      headers: authHeaders(teacherToken, school.orgId),
      body: imageForm(huge, "huge.png"),
    });
    expect(oversized.status).toBe(400);

    const uploaded = await json<{ profile: { photoUrl: string } }>(
      await app.request("/api/v1/me/profile/photo", {
        method: "POST",
        headers: authHeaders(teacherToken, school.orgId),
        body: imageForm(VALID_PNG),
      }),
    );
    expect(uploaded.profile.photoUrl).toMatch(/^\/api\/v1\/files\//);
    const objectId = uploaded.profile.photoUrl.split("/").pop()!;

    const replaced = await app.request("/api/v1/me/profile/photo", {
      method: "POST",
      headers: authHeaders(teacherToken, school.orgId),
      body: imageForm(pngHeader(80, 80), "next.png"),
    });
    expect(replaced.status).toBe(201);

    const old = await app.request(`/api/v1/files/${objectId}`, { headers: authHeaders(teacherToken, school.orgId) });
    expect(old.status).toBe(404);

    const current = await json<{ profile: { photoUrl: string } }>(
      await app.request("/api/v1/me/profile", { headers: jsonHeaders(teacherToken, school.orgId) }),
    );
    const currentId = current.profile.photoUrl!.split("/").pop()!;
    const fetchOk = await app.request(`/api/v1/files/${currentId}`, {
      headers: authHeaders(teacherToken, school.orgId),
    });
    expect(fetchOk.status).toBe(200);

    const otherFetch = await app.request(`/api/v1/files/${currentId}`, {
      headers: authHeaders(otherToken, other.orgId),
    });
    expect(otherFetch.status).toBe(404);

    const anon = await app.request(`/api/v1/files/${currentId}`);
    expect([401, 403, 404]).toContain(anon.status);

    const removed = await app.request("/api/v1/me/profile/photo", {
      method: "DELETE",
      headers: authHeaders(teacherToken, school.orgId),
    });
    expect(removed.status).toBe(200);
    const after = await json<{ profile: { photoUrl: string | null } }>(
      await app.request("/api/v1/me/profile", { headers: jsonHeaders(teacherToken, school.orgId) }),
    );
    expect(after.profile.photoUrl).toBeNull();
  });

  it("keeps student photos school-admin-only and parent relationship fields locked", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(adminToken, school.orgId);

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
    const year3 = groups.yearGroups.find((item) => item.code === "3")!;
    await pools.owner.query("update year_groups set student_login_enabled = true where organisation_id = $1", [
      school.orgId,
    ]);
    const student = await json<{ student: { id: string; photoUrl: string | null } }>(
      await app.request("/api/v1/students", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          legalName: "Sam Student",
          academicYearId: year.academicYear.id,
          yearGroupId: year3.id,
          loginAlias: `sam${id}`,
          password: "student-pass-1",
        }),
      }),
    );
    expect(student.student.photoUrl).toBeNull();

    const photo = await app.request(`/api/v1/students/${student.student.id}/photo`, {
      method: "POST",
      headers: authHeaders(adminToken, school.orgId),
      body: imageForm(VALID_PNG),
    });
    expect(photo.status).toBe(201);

    const guardian = await json<{ invitationToken: string | null; guardianUserId: string }>(
      await app.request(`/api/v1/students/${student.student.id}/guardians`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          email: `parent-${id}@example.com`,
          fullName: "Pat Parent",
          relationship: "mother",
          portalAccess: true,
        }),
      }),
    );
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: guardian.invitationToken,
        fullName: "Pat Parent",
        password: "parent-pass-1",
      }),
    });
    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    const parentHdrs = jsonHeaders(parentToken, school.orgId);

    const parentPhoto = await app.request(`/api/v1/students/${student.student.id}/photo`, {
      method: "POST",
      headers: authHeaders(parentToken, school.orgId),
      body: imageForm(VALID_PNG),
    });
    expect(parentPhoto.status).toBe(403);

    const relationship = await app.request("/api/v1/parent/profile", {
      method: "PATCH",
      headers: parentHdrs,
      body: JSON.stringify({ portalAccess: true, relationship: "father" }),
    });
    expect([400, 403]).toContain(relationship.status);

    const parentOk = await app.request("/api/v1/parent/profile", {
      method: "PATCH",
      headers: parentHdrs,
      body: JSON.stringify({ phone: "07700 900123" }),
    });
    expect(parentOk.status).toBe(200);

    const studentToken = await loginAlias(app, school.slug, `sam${id}`, "student-pass-1");
    const studentHdrs = jsonHeaders(studentToken, school.orgId);
    const studentEdit = await app.request("/api/v1/me/profile", {
      method: "PATCH",
      headers: studentHdrs,
      body: JSON.stringify({ preferredName: "Sammy" }),
    });
    expect(studentEdit.status).toBe(403);
    const studentPhoto = await app.request("/api/v1/me/profile/photo", {
      method: "POST",
      headers: authHeaders(studentToken, school.orgId),
      body: imageForm(VALID_PNG),
    });
    expect(studentPhoto.status).toBe(403);
  });
});
