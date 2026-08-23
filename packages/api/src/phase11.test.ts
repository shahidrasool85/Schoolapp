import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withTenantContext } from "@schoolapp/db";
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
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`p11-${id}`, `Phase11 ${id}`],
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

function headers(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Organisation-Id": orgId,
  };
}

async function seedStructure(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof headers>) {
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
  await app.request(`/api/v1/year-groups/${year3.id}`, {
    method: "PATCH",
    headers: hdrs,
    body: JSON.stringify({ studentLoginEnabled: true }),
  });
  return {
    yearId: year.academicYear.id,
    year3Id: year3.id,
    classAId: classA.class.id,
    classBId: classB.class.id,
  };
}

async function inviteTeacher(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  id: string,
  classId: string,
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
  await app.request(`/api/v1/classes/${classId}/staff`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      staffProfileId: staff.staffProfileId,
      assignmentRole: "form_tutor",
    }),
  });
  return { email: `teacher-${id}@example.com`, staffProfileId: staff.staffProfileId };
}

async function createStudent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
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

async function categoryId(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  kind: "incident" | "positive" | "action" | "pastoral" | "safeguarding",
  key: string,
) {
  if (kind === "incident" || kind === "positive" || kind === "action") {
    const body = (await (await app.request("/api/v1/behaviour/categories", { headers: hdrs })).json()) as {
      incidentCategories: Array<{ id: string; key: string }>;
      positiveCategories: Array<{ id: string; key: string }>;
      actionCategories: Array<{ id: string; key: string }>;
    };
    const list =
      kind === "incident" ? body.incidentCategories : kind === "positive" ? body.positiveCategories : body.actionCategories;
    return list.find((item) => item.key === key)!.id;
  }
  const path = kind === "pastoral" ? "/api/v1/pastoral/categories" : "/api/v1/safeguarding/categories";
  const body = (await (await app.request(path, { headers: hdrs })).json()) as {
    categories: Array<{ id: string; key: string }>;
  };
  return body.categories.find((item) => item.key === key)!.id;
}

describe("Phase 11 behaviour, pastoral and safeguarding", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("enforces tenant, assigned-only, spoofing and portal isolation", async () => {
    const gw = await createSchool(pools.owner, suffix());
    const oak = await createSchool(pools.owner, suffix());
    const gwAdmin = await login(app, gw.adminEmail, "password-12x");
    const oakAdmin = await login(app, oak.adminEmail, "password-12x");
    const gwH = headers(gwAdmin, gw.orgId);
    const oakH = headers(oakAdmin, oak.orgId);
    const gwStruct = await seedStructure(app, gwH);
    const oakStruct = await seedStructure(app, oakH);
    const teacher = await inviteTeacher(app, gwH, suffix(), gwStruct.classAId);
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const teacherH = headers(teacherToken, gw.orgId);

    const assignedAlias = `apupil${suffix()}`;
    const assigned = await createStudent(app, gwH, {
      legalName: "Assigned Pupil",
      academicYearId: gwStruct.yearId,
      yearGroupId: gwStruct.year3Id,
      classId: gwStruct.classAId,
      loginAlias: assignedAlias,
      password: "student-pass-1",
    });
    const other = await createStudent(app, gwH, {
      legalName: "Other Pupil",
      academicYearId: gwStruct.yearId,
      yearGroupId: gwStruct.year3Id,
      classId: gwStruct.classBId,
    });
    const oakPupil = await createStudent(app, oakH, {
      legalName: "Oak Pupil",
      academicYearId: oakStruct.yearId,
      yearGroupId: oakStruct.year3Id,
      classId: oakStruct.classAId,
    });

    const parentEmail = `parent-${suffix()}@example.com`;
    const parentInvite = (await (
      await app.request(`/api/v1/students/${assigned.student.id}/guardians`, {
        method: "POST",
        headers: gwH,
        body: JSON.stringify({
          email: parentEmail,
          fullName: "Pat Parent",
          relationship: "mother",
          portalAccess: true,
        }),
      })
    ).json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: parentInvite.invitationToken,
        fullName: "Pat Parent",
        password: "parent-pass-1",
      }),
    });
    const parentToken = await login(app, parentEmail, "parent-pass-1");
    const parentH = headers(parentToken, gw.orgId);
    const studentToken = await loginAlias(app, gw.slug, assignedAlias, "student-pass-1");
    const studentH = headers(studentToken, gw.orgId);

    const incidentCategory = await categoryId(app, gwH, "incident", "disruption");
    const oakIncidentCategory = await categoryId(app, oakH, "incident", "disruption");
    const positiveCategory = await categoryId(app, gwH, "positive", "praise");
    const actionCategory = await categoryId(app, gwH, "action", "verbal_warning");
    const pastoralCategory = await categoryId(app, gwH, "pastoral", "wellbeing");
    const safeguardingCategory = await categoryId(app, gwH, "safeguarding", "general_concern");
    const oakSafeguardingCategory = await categoryId(app, oakH, "safeguarding", "general_concern");

    const spoofId = randomUUID();
    const incidentRes = await app.request("/api/v1/behaviour/incidents", {
      method: "POST",
      headers: teacherH,
      body: JSON.stringify({
        studentProfileId: assigned.student.id,
        occurredAt: "2026-09-15T10:00:00Z",
        categoryId: incidentCategory,
        description: "Low-level calling out.",
        severity: "low",
        recordedBy: spoofId,
        recordedAt: "2010-01-01T00:00:00Z",
      }),
    });
    expect(incidentRes.status).toBe(201);
    const incident = (await incidentRes.json()) as { incident: { id: string; recordedBy: string } };
    expect(incident.incident.recordedBy).not.toBe(spoofId);

    const foreignPupil = await app.request("/api/v1/behaviour/incidents", {
      method: "POST",
      headers: teacherH,
      body: JSON.stringify({
        studentProfileId: other.student.id,
        occurredAt: "2026-09-15T10:00:00Z",
        categoryId: incidentCategory,
        description: "Should fail closed.",
      }),
    });
    expect(foreignPupil.status).toBe(404);

    const oakAsTeacher = await app.request("/api/v1/behaviour/incidents", {
      method: "POST",
      headers: teacherH,
      body: JSON.stringify({
        studentProfileId: oakPupil.student.id,
        occurredAt: "2026-09-15T10:00:00Z",
        categoryId: incidentCategory,
        description: "Cross-tenant pupil.",
      }),
    });
    expect(oakAsTeacher.status).toBe(404);

    const oakCategoryOnGw = await app.request("/api/v1/behaviour/incidents", {
      method: "POST",
      headers: gwH,
      body: JSON.stringify({
        studentProfileId: assigned.student.id,
        occurredAt: "2026-09-15T10:00:00Z",
        categoryId: oakIncidentCategory,
        description: "Cross-tenant category.",
      }),
    });
    expect(oakCategoryOnGw.status).toBe(404);

    const teacherOther = await app.request(`/api/v1/behaviour/incidents/${incident.incident.id}`, {
      headers: headers(teacherToken, gw.orgId),
    });
    expect(teacherOther.status).toBe(200);

    const teacherList = (await (
      await app.request("/api/v1/behaviour/incidents", { headers: teacherH })
    ).json()) as { incidents: Array<{ studentProfileId: string }> };
    expect(teacherList.incidents.every((row) => row.studentProfileId === assigned.student.id)).toBe(true);

    await app.request("/api/v1/behaviour/positives", {
      method: "POST",
      headers: teacherH,
      body: JSON.stringify({
        studentProfileId: assigned.student.id,
        occurredOn: "2026-09-12",
        categoryId: positiveCategory,
        description: "Kindness in the line.",
      }),
    });

    await app.request("/api/v1/behaviour/actions", {
      method: "POST",
      headers: teacherH,
      body: JSON.stringify({
        studentProfileId: assigned.student.id,
        incidentId: incident.incident.id,
        categoryId: actionCategory,
        actionOn: "2026-09-15",
        notes: "Verbal warning.",
      }),
    });

    const pastoral = await app.request("/api/v1/pastoral/concerns", {
      method: "POST",
      headers: gwH,
      body: JSON.stringify({
        studentProfileId: assigned.student.id,
        categoryId: pastoralCategory,
        concernOn: "2026-09-16",
        summary: "Friendship check-in",
        detailedNotes: "Confidential pastoral note. Not for student record leaks.",
        priority: "medium",
      }),
    });
    expect(pastoral.status).toBe(201);
    const pastoralBody = (await pastoral.json()) as { concern: { id: string } };

    const teacherPastoral = await app.request(`/api/v1/pastoral/concerns/${pastoralBody.concern.id}`, {
      headers: teacherH,
    });
    expect(teacherPastoral.status).toBe(404);

    const safeguarding = await app.request("/api/v1/safeguarding/concerns", {
      method: "POST",
      headers: gwH,
      body: JSON.stringify({
        studentProfileId: assigned.student.id,
        aroseAt: "2026-09-17T15:00:00Z",
        categoryId: safeguardingCategory,
        factualDescription: "Neutral factual note for DSL review.",
        recordedBy: spoofId,
      }),
    });
    expect(safeguarding.status).toBe(201);
    const sg = (await safeguarding.json()) as { concern: { id: string; recordedBy: string; factualDescription: string } };
    expect(sg.concern.recordedBy).not.toBe(spoofId);

    const oakSg = await app.request("/api/v1/safeguarding/concerns", {
      method: "POST",
      headers: oakH,
      body: JSON.stringify({
        studentProfileId: oakPupil.student.id,
        aroseAt: "2026-09-17T15:00:00Z",
        categoryId: oakSafeguardingCategory,
        factualDescription: "Oak-only safeguarding narrative.",
      }),
    });
    expect(oakSg.status).toBe(201);
    const oakSgBody = (await oakSg.json()) as { concern: { id: string } };

    const gwReadsOak = await app.request(`/api/v1/safeguarding/concerns/${oakSgBody.concern.id}`, { headers: gwH });
    expect(gwReadsOak.status).toBe(404);
    const gwReadsOakBehaviour = await app.request("/api/v1/behaviour/incidents", { headers: gwH });
    const gwIncidents = (await gwReadsOakBehaviour.json()) as { incidents: Array<{ id: string }> };
    expect(gwIncidents.incidents.some((row) => row.id === oakSgBody.concern.id)).toBe(false);

    const teacherSg = await app.request(`/api/v1/safeguarding/concerns/${sg.concern.id}`, { headers: teacherH });
    expect(teacherSg.status).toBe(404);
    const teacherSgList = await app.request("/api/v1/safeguarding/concerns", { headers: teacherH });
    expect(teacherSgList.status).toBe(404);

    const opsId = await insertUser(pools.owner, {
      email: `ops-${suffix()}@example.com`,
      password: "password-12x",
      fullName: "Ops Staff",
      kind: "staff",
    });
    const role = await pools.owner.query<{ id: string }>(
      `insert into roles (organisation_id, key, name) values ($1, 'school.ops', 'Ops') returning id`,
      [gw.orgId],
    );
    await pools.owner.query(
      `insert into role_permissions (role_id, permission_key)
       values ($1, 'students.profiles.read'), ($1, 'behaviour.read'), ($1, 'pastoral.read')`,
      [role.rows[0]!.id],
    );
    const membership = await pools.owner.query<{ id: string }>(
      `insert into organisation_memberships (organisation_id, user_id, status)
       values ($1, $2, 'active') returning id`,
      [gw.orgId, opsId],
    );
    await pools.owner.query("insert into membership_roles (membership_id, role_id) values ($1, $2)", [
      membership.rows[0]!.id,
      role.rows[0]!.id,
    ]);
    const opsEmail = await pools.owner.query<{ email: string }>("select email::text as email from users where id = $1", [
      opsId,
    ]);
    const opsToken = await login(app, opsEmail.rows[0]!.email, "password-12x");
    const opsH = headers(opsToken, gw.orgId);
    const opsSg = await app.request(`/api/v1/safeguarding/concerns/${sg.concern.id}`, { headers: opsH });
    expect(opsSg.status).toBe(404);
    expect(await opsSg.text()).not.toContain("Neutral factual note");

    const parentSg = await app.request(`/api/v1/safeguarding/concerns/${sg.concern.id}`, { headers: parentH });
    expect(parentSg.status).toBe(404);
    const parentSgList = await app.request("/api/v1/safeguarding/concerns", { headers: parentH });
    expect(parentSgList.status).toBe(404);
    const parentPortalSg = await app.request(`/api/v1/parent/children/${assigned.student.id}/safeguarding`, {
      headers: parentH,
    });
    expect(parentPortalSg.status).toBe(404);

    const studentSg = await app.request(`/api/v1/safeguarding/concerns/${sg.concern.id}`, { headers: studentH });
    expect(studentSg.status).toBe(404);
    const studentPortalSg = await app.request("/api/v1/student/safeguarding", { headers: studentH });
    expect(studentPortalSg.status).toBe(404);

    const studentRecord = await app.request(`/api/v1/students/${assigned.student.id}`, { headers: teacherH });
    expect(studentRecord.status).toBe(200);
    const recordJson = (await studentRecord.json()) as Record<string, unknown>;
    const recordText = JSON.stringify(recordJson);
    expect(recordText).not.toContain("Confidential pastoral note");
    expect(recordText).not.toContain("Neutral factual note");
    expect(recordText).not.toContain("factualDescription");
    expect(recordText).not.toContain("detailedNotes");
    expect(recordJson).not.toHaveProperty("safeguarding");
    expect(recordJson).not.toHaveProperty("safeguardingSummary");

    const teacherStudentSg = await app.request(`/api/v1/students/${assigned.student.id}/safeguarding`, {
      headers: teacherH,
    });
    expect(teacherStudentSg.status).toBe(404);

    const withdrawn = await pools.owner.query(
      `update student_enrolments set ended_on = '2026-09-01', status = 'withdrawn'
       where student_profile_id = $1 and organisation_id = $2`,
      [assigned.student.id, gw.orgId],
    );
    expect(withdrawn.rowCount).toBeGreaterThan(0);
    const staffStillReads = await app.request(`/api/v1/behaviour/incidents/${incident.incident.id}`, {
      headers: gwH,
    });
    expect(staffStillReads.status).toBe(200);

    const teacherUser = await pools.owner.query<{ id: string }>("select id from users where email = $1", [
      teacher.email,
    ]);
    await withTenantContext(pools.app, teacherUser.rows[0]!.id, gw.orgId, async (client) => {
      const leaked = await client.query("select count(*)::int as n from safeguarding_concerns");
      expect(leaked.rows[0]?.n).toBe(0);
    });

    const audit = await pools.owner.query<{ after_data: Record<string, unknown> | null }>(
      `select after_data from audit_events
       where organisation_id = $1 and entity_type = 'safeguarding_concern'
       order by created_at desc limit 1`,
      [gw.orgId],
    );
    expect(JSON.stringify(audit.rows[0]?.after_data ?? {})).not.toContain("Neutral factual note");
  });
});
