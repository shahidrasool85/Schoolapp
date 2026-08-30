import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

async function createSchool(
  owner: ReturnType<typeof testPools>["owner"],
  id: string,
  name = `Campus ${id}`,
) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "School Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status, timezone) values ($1, $2, 'active', 'Europe/London') returning id, slug",
    [`life-${id}`, name],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return {
    adminId,
    orgId: org.rows[0]!.id,
    slug: org.rows[0]!.slug,
    adminEmail: `admin-${id}@example.com`,
    name,
  };
}

describe("academic structure edit, archive and delete", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("edits, archives, restores and safely deletes subjects", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);

    const unused = await app.request("/api/v1/subjects", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Mathematic", key: "mathematic" }),
    });
    expect(unused.status).toBe(201);
    const unusedBody = (await unused.json()) as { subject: { id: string; key: string; name: string } };

    const renamed = await app.request(`/api/v1/subjects/${unusedBody.subject.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ name: "Mathematics", key: "mathematics" }),
    });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { subject: { name: string; key: string } }).subject).toMatchObject({
      name: "Mathematics",
      key: "mathematics",
    });

    const deleted = await app.request(`/api/v1/subjects/${unusedBody.subject.id}`, {
      method: "DELETE",
      headers: hdrs,
    });
    expect(deleted.status).toBe(200);

    const year = await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "2026/27", startsOn: "2026-09-01", endsOn: "2027-08-31", isCurrent: true }),
    });
    const yearId = ((await year.json()) as { academicYear: { id: string } }).academicYear.id;
    const group = await app.request("/api/v1/year-groups", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ code: "3", name: "Year 3" }),
    });
    const groupId = ((await group.json()) as { yearGroup: { id: string } }).yearGroup.id;
    const subject = await app.request("/api/v1/subjects", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "French", key: "french" }),
    });
    const subjectId = ((await subject.json()) as { subject: { id: string } }).subject.id;
    const cls = await app.request("/api/v1/classes", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "3A", academicYearId: yearId, yearGroupId: groupId, classType: "form" }),
    });
    const classId = ((await cls.json()) as { class: { id: string } }).class.id;
    expect(
      (
        await app.request(`/api/v1/classes/${classId}/subjects`, {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify({ subjectId }),
        })
      ).status,
    ).toBe(201);

    const blocked = await app.request(`/api/v1/subjects/${subjectId}`, { method: "DELETE", headers: hdrs });
    expect(blocked.status).toBe(409);
    const blockedBody = (await blocked.json()) as {
      error: { code: string; message: string; details?: { canArchive?: boolean } };
    };
    expect(blockedBody.error.code).toBe("cannot_delete");
    expect(blockedBody.error.details?.canArchive).toBe(true);
    expect(blockedBody.error.message).toMatch(/cannot be deleted because it has/i);
    expect(blockedBody.error.message).not.toMatch(/pupil name|email|@/i);

    const archived = await app.request(`/api/v1/subjects/${subjectId}/archive`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(archived.status).toBe(200);

    const activeList = (await (await app.request("/api/v1/subjects", { headers: hdrs })).json()) as {
      subjects: Array<{ id: string }>;
    };
    expect(activeList.subjects.some((row) => row.id === subjectId)).toBe(false);

    const archivedList = (await (
      await app.request("/api/v1/subjects?includeArchived=true", { headers: hdrs })
    ).json()) as { subjects: Array<{ id: string; status: string }> };
    expect(archivedList.subjects.some((row) => row.id === subjectId && row.status === "archived")).toBe(true);

    const archivedReady = (await (await app.request("/api/v1/onboarding", { headers: hdrs })).json()) as {
      readiness: { items: Array<{ key: string; complete: boolean }> };
    };
    expect(archivedReady.readiness.items.find((item) => item.key === "subjects")?.complete).toBe(false);

    const restored = await app.request(`/api/v1/subjects/${subjectId}/restore`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(restored.status).toBe(200);

    const after = (await (await app.request("/api/v1/onboarding", { headers: hdrs })).json()) as {
      readiness: { items: Array<{ key: string; complete: boolean }> };
    };
    expect(after.readiness.items.find((item) => item.key === "subjects")?.complete).toBe(true);

    await app.request(`/api/v1/subjects/${subjectId}/archive`, { method: "POST", headers: hdrs, body: "{}" });
    await pools.owner.query("delete from class_subjects where subject_id = $1", [subjectId]);
    await app.request(`/api/v1/subjects/${subjectId}`, { method: "DELETE", headers: hdrs });
    const onlyArchivedGone = await app.request("/api/v1/subjects", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Temp", key: "temp-ready" }),
    });
    expect(onlyArchivedGone.status).toBe(201);
  });

  it("lets School Admin correct a class created with no year group", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "2026/27", startsOn: "2026-09-01", endsOn: "2027-08-31", isCurrent: true }),
    });
    const yearId = ((await year.json()) as { academicYear: { id: string } }).academicYear.id;
    const group = await app.request("/api/v1/year-groups", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ code: "3", name: "Year 3" }),
    });
    const groupId = ((await group.json()) as { yearGroup: { id: string } }).yearGroup.id;

    const created = await app.request("/api/v1/classes", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "3A", academicYearId: yearId, yearGroupId: null, classType: "form" }),
    });
    expect(created.status).toBe(201);
    const classId = ((await created.json()) as { class: { id: string; yearGroupId: string | null } }).class.id;

    const patched = await app.request(`/api/v1/classes/${classId}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ yearGroupId: groupId }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as { class: { yearGroupId: string; yearGroupName: string } };
    expect(patchedBody.class.yearGroupId).toBe(groupId);
    expect(patchedBody.class.yearGroupName).toBe("Year 3");

    const list = (await (await app.request("/api/v1/classes", { headers: hdrs })).json()) as {
      classes: Array<{ id: string; yearGroupName: string | null }>;
    };
    expect(list.classes.find((row) => row.id === classId)?.yearGroupName).toBe("Year 3");
  });

  it("deletes unused classes and archives referenced ones without cascade loss", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "2026/27", startsOn: "2026-09-01", endsOn: "2027-08-31", isCurrent: true }),
    });
    const yearId = ((await year.json()) as { academicYear: { id: string } }).academicYear.id;
    const unused = await app.request("/api/v1/classes", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Spare", academicYearId: yearId, classType: "form" }),
    });
    const unusedId = ((await unused.json()) as { class: { id: string } }).class.id;
    expect((await app.request(`/api/v1/classes/${unusedId}`, { method: "DELETE", headers: hdrs })).status).toBe(200);

    const subject = await app.request("/api/v1/subjects", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Art", key: "art" }),
    });
    const subjectId = ((await subject.json()) as { subject: { id: string } }).subject.id;
    const referenced = await app.request("/api/v1/classes", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "3B", academicYearId: yearId, classType: "form" }),
    });
    const referencedId = ((await referenced.json()) as { class: { id: string } }).class.id;
    await app.request(`/api/v1/classes/${referencedId}/subjects`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ subjectId }),
    });
    const blocked = await app.request(`/api/v1/classes/${referencedId}`, { method: "DELETE", headers: hdrs });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: { message: string } }).error.message).toMatch(
      /cannot be deleted because it has/i,
    );
    expect(
      (await app.request(`/api/v1/classes/${referencedId}/archive`, { method: "POST", headers: hdrs, body: "{}" }))
        .status,
    ).toBe(200);
    const stillLinked = await pools.owner.query<{ n: string }>(
      "select count(*)::text as n from class_subjects where class_id = $1",
      [referencedId],
    );
    expect(stillLinked.rows[0]?.n).toBe("1");
    const active = (await (await app.request("/api/v1/classes", { headers: hdrs })).json()) as {
      classes: Array<{ id: string }>;
    };
    expect(active.classes.some((row) => row.id === referencedId)).toBe(false);
  });

  it("blocks year-group and academic-year hard delete when records exist", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);

    const emptyYear = await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Accidental", startsOn: "2025-09-01", endsOn: "2026-08-31" }),
    });
    const emptyYearId = ((await emptyYear.json()) as { academicYear: { id: string } }).academicYear.id;
    expect((await app.request(`/api/v1/academic-years/${emptyYearId}`, { method: "DELETE", headers: hdrs })).status).toBe(
      200,
    );

    const current = await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "2026/27", startsOn: "2026-09-01", endsOn: "2027-08-31", isCurrent: true }),
    });
    const currentId = ((await current.json()) as { academicYear: { id: string } }).academicYear.id;
    const currentDelete = await app.request(`/api/v1/academic-years/${currentId}`, { method: "DELETE", headers: hdrs });
    expect(currentDelete.status).toBe(409);
    expect(((await currentDelete.json()) as { error: { message: string } }).error.message).toMatch(
      /current academic year cannot be removed/i,
    );
    expect(
      (
        await app.request(`/api/v1/academic-years/${currentId}/archive`, {
          method: "POST",
          headers: hdrs,
          body: "{}",
        })
      ).status,
    ).toBe(409);

    const custom = await app.request("/api/v1/year-groups", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ code: "7", name: "Custom 7" }),
    });
    const customBody = (await custom.json()) as { yearGroup: { id: string; origin: string } };
    expect(customBody.yearGroup.origin).toBe("custom");
    expect((await app.request(`/api/v1/year-groups/${customBody.yearGroup.id}`, { method: "DELETE", headers: hdrs })).status).toBe(200);

    const usedGroup = await app.request("/api/v1/year-groups", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ code: "3", name: "Year 3" }),
    });
    const usedGroupId = ((await usedGroup.json()) as { yearGroup: { id: string } }).yearGroup.id;
    await app.request("/api/v1/classes", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "3A",
        academicYearId: currentId,
        yearGroupId: usedGroupId,
        classType: "form",
      }),
    });
    const usedDelete = await app.request(`/api/v1/year-groups/${usedGroupId}`, { method: "DELETE", headers: hdrs });
    expect(usedDelete.status).toBe(409);
    expect(((await usedDelete.json()) as { error: { message: string } }).error.message).toMatch(
      /cannot be deleted because it has 1 class/i,
    );
    const referencedYearDelete = await app.request(`/api/v1/academic-years/${currentId}`, {
      method: "DELETE",
      headers: hdrs,
    });
    expect(referencedYearDelete.status).toBe(409);
    expect(((await referencedYearDelete.json()) as { error: { message: string } }).error.message).toMatch(
      /cannot be deleted because it has/i,
    );
    const leftover = await pools.owner.query<{ n: string }>(
      "select count(*)::text as n from classes where academic_year_id = $1",
      [currentId],
    );
    expect(leftover.rows[0]?.n).toBe("1");
  });

  it("protects seeded system year groups and keeps custom unused groups deletable", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);

    const seeded = await app.request("/api/v1/year-groups/seed", {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(seeded.status).toBe(200);
    const seededBody = (await seeded.json()) as {
      yearGroups: Array<{ id: string; code: string; name: string; origin: string }>;
    };
    const year3 = seededBody.yearGroups.find((row) => row.code === "3");
    expect(year3?.origin).toBe("system");
    expect(year3?.name).toBe("Year 3");

    const blocked = await app.request(`/api/v1/year-groups/${year3!.id}`, { method: "DELETE", headers: hdrs });
    expect(blocked.status).toBe(409);
    const blockedBody = (await blocked.json()) as { error: { message: string; details?: { canArchive?: boolean } } };
    expect(blockedBody.error.message).toMatch(/standard UK year group/i);
    expect(blockedBody.error.details?.canArchive).toBe(true);

    expect(
      (await app.request(`/api/v1/year-groups/${year3!.id}/archive`, { method: "POST", headers: hdrs, body: "{}" }))
        .status,
    ).toBe(200);
    expect(
      (await app.request(`/api/v1/year-groups/${year3!.id}/restore`, { method: "POST", headers: hdrs, body: "{}" }))
        .status,
    ).toBe(200);

    expect(
      (
        await app.request("/api/v1/organisation/settings", {
          method: "PATCH",
          headers: hdrs,
          body: JSON.stringify({ maxYearGroupCode: "13" }),
        })
      ).status,
    ).toBe(200);
    const custom = await app.request("/api/v1/year-groups", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ code: "13", name: "Pathway 13" }),
    });
    expect(custom.status).toBe(201);
    const customBody = (await custom.json()) as { yearGroup: { id: string; origin: string } };
    expect(customBody.yearGroup.origin).toBe("custom");
    expect((await app.request(`/api/v1/year-groups/${customBody.yearGroup.id}`, { method: "DELETE", headers: hdrs })).status).toBe(
      200,
    );

    const forged = await app.request("/api/v1/year-groups", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ code: "12", name: "Lower Prep", origin: "system" }),
    });
    expect(forged.status).toBe(201);
    const forgedBody = (await forged.json()) as { yearGroup: { id: string; origin: string } };
    expect(forgedBody.yearGroup.origin).toBe("custom");
    const patched = await app.request(`/api/v1/year-groups/${forgedBody.yearGroup.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ name: "Form X", origin: "system" }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { yearGroup: { origin: string; name: string } }).yearGroup).toMatchObject({
      origin: "custom",
      name: "Form X",
    });
    expect((await app.request(`/api/v1/year-groups/${forgedBody.yearGroup.id}`, { method: "DELETE", headers: hdrs })).status).toBe(
      200,
    );
  });

  it("switches the current academic year atomically so only one year is current", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const first = await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "2025/26", startsOn: "2025-09-01", endsOn: "2026-08-31", isCurrent: true }),
    });
    const firstId = ((await first.json()) as { academicYear: { id: string } }).academicYear.id;
    const second = await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "2026/27", startsOn: "2026-09-01", endsOn: "2027-08-31", isCurrent: true }),
    });
    const secondId = ((await second.json()) as { academicYear: { id: string } }).academicYear.id;
    const list = (await (await app.request("/api/v1/academic-years", { headers: hdrs })).json()) as {
      academicYears: Array<{ id: string; isCurrent: boolean }>;
    };
    expect(list.academicYears.filter((row) => row.isCurrent)).toHaveLength(1);
    expect(list.academicYears.find((row) => row.id === secondId)?.isCurrent).toBe(true);
    expect(list.academicYears.find((row) => row.id === firstId)?.isCurrent).toBe(false);
    const currentCount = await pools.owner.query<{ n: string }>(
      "select count(*)::text as n from academic_years where organisation_id = $1 and is_current",
      [school.orgId],
    );
    expect(currentCount.rows[0]?.n).toBe("1");
  });

  it("keeps destructive academic actions with School Admin and denies teachers and other tenants", async () => {
    const id = suffix();
    const schoolA = await createSchool(pools.owner, `${id}a`, `School A ${id}`);
    const schoolB = await createSchool(pools.owner, `${id}b`, `School B ${id}`);
    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, schoolA.orgId, teacherId, "school.teacher");
    const adminA = await login(app, schoolA.adminEmail, "password-12x");
    const adminB = await login(app, schoolB.adminEmail, "password-12x");
    const teacher = await login(app, `teacher-${id}@example.com`, "password-12x");
    const hdrsA = jsonHeaders(adminA, schoolA.orgId);
    const hdrsB = jsonHeaders(adminB, schoolB.orgId);
    const hdrsTeacher = jsonHeaders(teacher, schoolA.orgId);

    const created = await app.request("/api/v1/subjects", {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({ name: "Drama", key: "drama" }),
    });
    const subjectId = ((await created.json()) as { subject: { id: string } }).subject.id;

    expect(
      (
        await app.request(`/api/v1/subjects/${subjectId}`, {
          method: "DELETE",
          headers: hdrsTeacher,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`/api/v1/subjects/${subjectId}`, {
          method: "DELETE",
          headers: hdrsB,
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await app.request(`/api/v1/subjects/${subjectId}`, { method: "DELETE", headers: hdrsA })).status).toBe(200);
  });
});
