import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@schoolapp/domain";
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

type GuardianRow = {
  id: string;
  guardianUserId: string;
  guardianFullName: string | null;
  guardianEmail: string | null;
  guardianPhone: string | null;
  guardianAlternativePhone: string | null;
  relationship: string;
  isPrimaryContact: boolean;
  isEmergencyContact: boolean;
  portalAccess: boolean;
  priority: number;
  restricted?: unknown;
  restrictedContact?: unknown;
};

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
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`pc-${id}`, `Contacts ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return {
    adminId,
    orgId: org.rows[0]!.id,
    slug: org.rows[0]!.slug,
    adminEmail: `admin-${id}@example.com`,
  };
}

async function seedStructure(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof jsonHeaders>) {
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
  const classB = (await (
    await app.request("/api/v1/classes", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "3B",
        academicYearId: year.academicYear.id,
        yearGroupId: year3.id,
        classType: "form",
      }),
    })
  ).json()) as { class: { id: string } };
  return {
    yearId: year.academicYear.id,
    year3Id: year3.id,
    classAId: classA.class.id,
    classBId: classB.class.id,
  };
}

async function createStudent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
  input: { legalName: string; academicYearId: string; yearGroupId: string; classId?: string },
) {
  const created = await app.request("/api/v1/students", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(input),
  });
  expect(created.status).toBe(201);
  return (await created.json()) as { student: { id: string } };
}

async function inviteTeacher(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
  id: string,
  classId?: string,
) {
  const staff = (await (
    await app.request("/api/v1/staff", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `teacher-${id}@example.com`,
        fullName: "Terry Teacher",
        roleKeys: ["school.teacher"],
        jobTitle: "Class teacher",
      }),
    })
  ).json()) as { staffProfileId: string; invitationToken: string };
  await app.request("/api/v1/invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: staff.invitationToken,
      fullName: "Terry Teacher",
      password: "teacher-pass-1",
    }),
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

describe("Phase 1 pupil guardian contacts", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("lets assigned teachers read ordinary contacts, blocks edits, and hides restricted rows", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(adminToken, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const assigned = await createStudent(app, hdrs, {
      legalName: "Assigned Pupil",
      academicYearId: structure.yearId,
      yearGroupId: structure.year3Id,
      classId: structure.classAId,
    });
    const unassigned = await createStudent(app, hdrs, {
      legalName: "Unassigned Pupil",
      academicYearId: structure.yearId,
      yearGroupId: structure.year3Id,
      classId: structure.classBId,
    });
    const teacher = await inviteTeacher(app, hdrs, id, structure.classAId);
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const teacherHdrs = jsonHeaders(teacherToken, school.orgId);

    const ordinary = await app.request(`/api/v1/students/${assigned.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `parent-${id}@example.com`,
        fullName: "Pat Parent",
        relationship: "mother",
        phone: "07123 456789",
        alternativePhone: "01234 567890",
        isPrimary: true,
        isEmergencyContact: true,
        hasParentalResponsibility: true,
        portalAccess: true,
      }),
    });
    expect(ordinary.status).toBe(201);
    const ordinaryBody = (await ordinary.json()) as {
      invitationToken: string;
      guardianshipId: string;
      guardianship: GuardianRow;
    };
    expect(ordinaryBody.invitationToken).toMatch(/^[a-f0-9]{64}$/);
    expect(ordinaryBody.guardianship.guardianPhone).toBe("07123 456789");
    expect(ordinaryBody.guardianship.guardianAlternativePhone).toBe("01234 567890");
    expect(ordinaryBody.guardianship.isPrimaryContact).toBe(true);
    expect(ordinaryBody.guardianship.isEmergencyContact).toBe(true);
    expect(ordinaryBody.guardianship).not.toHaveProperty("restricted");
    expect(ordinaryBody.guardianship).not.toHaveProperty("restrictedContact");

    const accepted = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: ordinaryBody.invitationToken,
        fullName: "Pat Parent",
        password: "parent-pass-1",
      }),
    });
    expect(accepted.status).toBe(200);
    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    expect(parentToken).toBeTruthy();

    const hidden = await app.request(`/api/v1/students/${assigned.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `hidden-${id}@example.com`,
        fullName: "Hidden Contact",
        relationship: "father",
        phone: "07000 111111",
        isPrimary: false,
        isEmergencyContact: false,
        portalAccess: false,
      }),
    });
    expect(hidden.status).toBe(201);
    const hiddenBody = (await hidden.json()) as { guardianshipId: string; guardianship: GuardianRow };
    await pools.owner.query("update guardianships set restricted_contact = true where id = $1", [
      hiddenBody.guardianshipId,
    ]);

    const second = await app.request(`/api/v1/students/${assigned.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `second-${id}@example.com`,
        fullName: "Sam Second",
        relationship: "carer",
        phone: "07999 888777",
        isPrimary: true,
        isEmergencyContact: false,
        portalAccess: false,
      }),
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { guardianshipId: string; guardianship: GuardianRow };
    expect(secondBody.guardianship.isPrimaryContact).toBe(true);

    const adminDetail = (await (
      await app.request(`/api/v1/students/${assigned.student.id}`, { headers: hdrs })
    ).json()) as { guardians: GuardianRow[] };
    expect(adminDetail.guardians).toHaveLength(3);
    const adminPrimary = adminDetail.guardians.filter((row) => row.isPrimaryContact);
    expect(adminPrimary.map((row) => row.guardianEmail)).toEqual([`second-${id}@example.com`]);
    expect(adminDetail.guardians.find((row) => row.guardianEmail === `parent-${id}@example.com`)?.isPrimaryContact).toBe(
      false,
    );

    const teacherDetail = await app.request(`/api/v1/students/${assigned.student.id}`, { headers: teacherHdrs });
    expect(teacherDetail.status).toBe(200);
    const teacherBody = (await teacherDetail.json()) as { guardians: GuardianRow[] };
    expect(teacherBody.guardians).toHaveLength(2);
    expect(teacherBody.guardians.map((row) => row.guardianEmail).sort()).toEqual(
      [`parent-${id}@example.com`, `second-${id}@example.com`].sort(),
    );
    const visible = teacherBody.guardians.find((row) => row.guardianEmail === `parent-${id}@example.com`)!;
    expect(visible.guardianFullName).toBe("Pat Parent");
    expect(visible.relationship).toBe("mother");
    expect(visible.guardianPhone).toBe("07123 456789");
    expect(visible.guardianAlternativePhone).toBe("01234 567890");
    expect(visible.isEmergencyContact).toBe(true);
    expect(visible.isPrimaryContact).toBe(false);
    expect(JSON.stringify(teacherBody)).not.toContain("hidden-");
    expect(JSON.stringify(teacherBody)).not.toContain("Hidden Contact");
    expect(JSON.stringify(teacherBody)).not.toContain("07000 111111");
    expect(JSON.stringify(teacherBody)).not.toMatch(/restricted/i);
    expect(teacherBody.guardians.every((row) => !("restricted" in row) && !("restrictedContact" in row))).toBe(true);

    const teacherPatch = await app.request(`/api/v1/guardianships/${ordinaryBody.guardianshipId}`, {
      method: "PATCH",
      headers: teacherHdrs,
      body: JSON.stringify({ phone: "07000 000000", isPrimary: true }),
    });
    expect(teacherPatch.status).toBe(403);

    const teacherCreate = await app.request(`/api/v1/students/${assigned.student.id}/guardians`, {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        email: `teacher-created-${id}@example.com`,
        fullName: "Should Fail",
        relationship: "other",
      }),
    });
    expect(teacherCreate.status).toBe(403);

    const unassignedGet = await app.request(`/api/v1/students/${unassigned.student.id}`, { headers: teacherHdrs });
    expect(unassignedGet.status).toBe(404);

    const teacherSafeguarding = await app.request(`/api/v1/students/${assigned.student.id}/safeguarding`, {
      headers: teacherHdrs,
    });
    expect(teacherSafeguarding.status).toBe(404);
    const teacherSafeguardingList = await app.request("/api/v1/safeguarding/concerns", { headers: teacherHdrs });
    expect(teacherSafeguardingList.status).toBe(404);

    const myClasses = await app.request("/api/v1/my-classes", { headers: teacherHdrs });
    expect(myClasses.status).toBe(200);
    const myClassesBody = (await myClasses.json()) as { classes: Array<{ id: string; name: string; pupilCount: number }> };
    expect(myClassesBody.classes.map((row) => row.id)).toEqual([structure.classAId]);
    expect(myClassesBody.classes[0]?.pupilCount).toBe(1);

    const assignedClass = await app.request(`/api/v1/my-classes/${structure.classAId}`, { headers: teacherHdrs });
    expect(assignedClass.status).toBe(200);
    const assignedClassBody = (await assignedClass.json()) as {
      class: { name: string };
      pupils: Array<{ studentProfileId: string; legalName: string }>;
    };
    expect(assignedClassBody.class.name).toBe("3A");
    expect(assignedClassBody.pupils.map((row) => row.studentProfileId)).toEqual([assigned.student.id]);

    const unassignedClass = await app.request(`/api/v1/my-classes/${structure.classBId}`, { headers: teacherHdrs });
    expect(unassignedClass.status).toBe(404);

    const teacherGuardiansList = await app.request("/api/v1/guardians", { headers: teacherHdrs });
    expect(teacherGuardiansList.status).toBe(403);

    const teacherUser = await pools.owner.query<{ id: string }>("select id from users where email = $1", [
      teacher.email,
    ]);
    const perms = await pools.app.query<{ permission_key: string }>(
      "select permission_key from list_permissions_for_membership($1, $2)",
      [teacherUser.rows[0]!.id, school.orgId],
    );
    const set = new Set(perms.rows.map((row) => row.permission_key));
    expect(set.has(PERMISSIONS.GUARDIANSHIPS_MANAGE)).toBe(false);
    expect(set.has(PERMISSIONS.STUDENTS_RESTRICTED_CONTACT_READ)).toBe(false);
    expect(set.has(PERMISSIONS.STUDENTS_PROFILES_READ_ASSIGNED)).toBe(true);

    const restrictedGrant = await pools.owner.query<{ ok: boolean }>(
      "select has_column_privilege('schoolapp_app', 'guardianships', 'restricted_contact', 'SELECT') as ok",
    );
    expect(restrictedGrant.rows[0]?.ok).toBe(false);
    await withTenantContext(pools.app, teacherUser.rows[0]!.id, school.orgId, async (client) => {
      const listed = await client.query(
        "select * from list_student_guardians_for_actor($1, $2, $3)",
        [teacherUser.rows[0]!.id, school.orgId, assigned.student.id],
      );
      expect(listed.rows).toHaveLength(2);
      expect(JSON.stringify(listed.rows)).not.toMatch(/restricted/i);
      expect(JSON.stringify(listed.rows)).not.toContain("hidden-");
    });

    const adminPatch = await app.request(`/api/v1/guardianships/${ordinaryBody.guardianshipId}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({
        phone: "07111 222333",
        alternativePhone: "01300 111222",
        isEmergencyContact: false,
        isPrimary: true,
        fullName: "Patricia Parent",
      }),
    });
    expect(adminPatch.status).toBe(200);
    const patched = (await adminPatch.json()) as { guardianship: GuardianRow };
    expect(patched.guardianship.guardianFullName).toBe("Patricia Parent");
    expect(patched.guardianship.guardianPhone).toBe("07111 222333");
    expect(patched.guardianship.guardianAlternativePhone).toBe("01300 111222");
    expect(patched.guardianship.isPrimaryContact).toBe(true);
    expect(patched.guardianship.isEmergencyContact).toBe(false);

    const afterSwitch = (await (
      await app.request(`/api/v1/students/${assigned.student.id}`, { headers: hdrs })
    ).json()) as { guardians: GuardianRow[] };
    expect(afterSwitch.guardians.filter((row) => row.isPrimaryContact)).toHaveLength(1);
    expect(afterSwitch.guardians.find((row) => row.id === ordinaryBody.guardianshipId)?.isPrimaryContact).toBe(true);
    expect(afterSwitch.guardians.find((row) => row.id === secondBody.guardianshipId)?.isPrimaryContact).toBe(false);

    const audit = await pools.owner.query<{ action: string; after_data: Record<string, unknown> | null }>(
      `select action, after_data from audit_events
       where organisation_id = $1 and entity_type in ('guardianship', 'user')
         and action in ('guardianship.created', 'guardianship.updated', 'profile.contact.updated')
       order by occurred_at desc limit 20`,
      [school.orgId],
    );
    expect(audit.rows.some((row) => row.action === "guardianship.created")).toBe(true);
    expect(audit.rows.some((row) => row.action === "guardianship.updated")).toBe(true);
    expect(audit.rows.some((row) => row.action === "profile.contact.updated")).toBe(true);
    expect(JSON.stringify(audit.rows)).not.toContain("07111 222333");
  });

  it("lets a headteacher read ordinary contacts without guardianships.manage", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(adminToken, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Head Pupil",
      academicYearId: structure.yearId,
      yearGroupId: structure.year3Id,
      classId: structure.classAId,
    });
    await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `head-parent-${id}@example.com`,
        fullName: "Head Parent",
        relationship: "father",
        phone: "07123 000111",
        isPrimary: true,
        isEmergencyContact: true,
      }),
    });
    const hidden = await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `head-hidden-${id}@example.com`,
        fullName: "Restricted Parent",
        relationship: "mother",
        phone: "07000 222333",
      }),
    });
    const hiddenBody = (await hidden.json()) as { guardianshipId: string };
    await pools.owner.query("update guardianships set restricted_contact = true where id = $1", [
      hiddenBody.guardianshipId,
    ]);

    const headId = await insertUser(pools.owner, {
      email: `head-${id}@example.com`,
      password: "password-12x",
      fullName: "Head Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, headId, "school.headteacher");
    const perms = await pools.app.query<{ permission_key: string }>(
      "select permission_key from list_permissions_for_membership($1, $2)",
      [headId, school.orgId],
    );
    const set = new Set(perms.rows.map((row) => row.permission_key));
    expect(set.has(PERMISSIONS.STUDENTS_PROFILES_READ)).toBe(true);
    expect(set.has(PERMISSIONS.GUARDIANSHIPS_MANAGE)).toBe(false);
    expect(set.has(PERMISSIONS.STUDENTS_RESTRICTED_CONTACT_READ)).toBe(false);

    const headToken = await login(app, `head-${id}@example.com`, "password-12x");
    const headHdrs = jsonHeaders(headToken, school.orgId);
    const detail = await app.request(`/api/v1/students/${pupil.student.id}`, { headers: headHdrs });
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { guardians: GuardianRow[] };
    expect(body.guardians).toHaveLength(1);
    expect(body.guardians[0]?.guardianEmail).toBe(`head-parent-${id}@example.com`);
    expect(body.guardians[0]?.guardianPhone).toBe("07123 000111");
    expect(body.guardians[0]?.isPrimaryContact).toBe(true);
    expect(JSON.stringify(body)).not.toContain("head-hidden-");

    const patch = await app.request(`/api/v1/guardianships/${hiddenBody.guardianshipId}`, {
      method: "PATCH",
      headers: headHdrs,
      body: JSON.stringify({ phone: "07999 000000" }),
    });
    expect(patch.status).toBe(403);
  });

  it("returns 404 for cross-school pupil and class contact access", async () => {
    const id = suffix();
    const a = await createSchool(pools.owner, `a-${id}`);
    const b = await createSchool(pools.owner, `b-${id}`);
    const tokenA = await login(app, a.adminEmail, "password-12x");
    const tokenB = await login(app, b.adminEmail, "password-12x");
    const hdrsA = jsonHeaders(tokenA, a.orgId);
    const hdrsB = jsonHeaders(tokenB, b.orgId);
    const structureA = await seedStructure(app, hdrsA);
    const structureB = await seedStructure(app, hdrsB);
    const pupilB = await createStudent(app, hdrsB, {
      legalName: "Other School Pupil",
      academicYearId: structureB.yearId,
      yearGroupId: structureB.year3Id,
      classId: structureB.classAId,
    });
    const created = await app.request(`/api/v1/students/${pupilB.student.id}/guardians`, {
      method: "POST",
      headers: hdrsB,
      body: JSON.stringify({
        email: `b-parent-${id}@example.com`,
        fullName: "Other Parent",
        relationship: "mother",
        phone: "07123 999888",
      }),
    });
    expect(created.status).toBe(201);
    const teacherA = await inviteTeacher(app, hdrsA, `a-${id}`, structureA.classAId);
    const teacherToken = await login(app, teacherA.email, "teacher-pass-1");
    const teacherHdrs = jsonHeaders(teacherToken, a.orgId);

    const spoofed = await app.request(`/api/v1/students/${pupilB.student.id}`, {
      headers: { ...teacherHdrs, "X-Organisation-Id": b.orgId },
    });
    expect(spoofed.status).toBeGreaterThanOrEqual(400);

    const crossPupil = await app.request(`/api/v1/students/${pupilB.student.id}`, { headers: teacherHdrs });
    expect(crossPupil.status).toBe(404);
    const crossClass = await app.request(`/api/v1/my-classes/${structureB.classAId}`, { headers: teacherHdrs });
    expect(crossClass.status).toBe(404);
    const crossAdmin = await app.request(`/api/v1/students/${pupilB.student.id}`, { headers: hdrsA });
    expect(crossAdmin.status).toBe(404);
  });

  it("does not let parents inherit other guardian telephone numbers from the pupil record API", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(adminToken, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Family Pupil",
      academicYearId: structure.yearId,
      yearGroupId: structure.year3Id,
      classId: structure.classAId,
    });
    const created = await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `own-${id}@example.com`,
        fullName: "Own Parent",
        relationship: "mother",
        phone: "07123 111222",
        portalAccess: true,
      }),
    });
    const createdBody = (await created.json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: createdBody.invitationToken,
        fullName: "Own Parent",
        password: "parent-pass-1",
      }),
    });
    await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `other-${id}@example.com`,
        fullName: "Other Parent",
        relationship: "father",
        phone: "07999 111222",
      }),
    });
    const parentToken = await login(app, `own-${id}@example.com`, "parent-pass-1");
    const parentHdrs = jsonHeaders(parentToken, school.orgId);
    const pupilGet = await app.request(`/api/v1/students/${pupil.student.id}`, { headers: parentHdrs });
    expect(pupilGet.status).toBe(200);
    const body = (await pupilGet.json()) as { guardians: GuardianRow[] };
    expect(body.guardians).toEqual([]);
  });
});
