import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePermanentUpn } from "@schoolapp/core";
import { closePools, withTenantContext } from "@schoolapp/db";
import {
  addMembership,
  assertPortalSafe,
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
    [`p18-${id}`, `Phase18 ${id}`],
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
    dateOfBirth?: string;
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

async function patchStatutory(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
  studentId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/v1/students/${studentId}/statutory`, {
    method: "PATCH",
    headers: hdrs,
    body: JSON.stringify(body),
  });
}

describe("Phase 18 statutory data and census readiness", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("validates UPN format and rejects duplicate UPNs", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await seedYear(app, hdrs);
    const a = await createStudent(app, hdrs, {
      legalName: "Amelia Khan",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
      dateOfBirth: "2018-04-12",
    });
    const b = await createStudent(app, hdrs, {
      legalName: "Jack Brennan",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
      dateOfBirth: "2018-08-21",
    });
    const upn = generatePermanentUpn("201990100001");
    const invalid = await patchStatutory(app, hdrs, a.student.id, { upn: "NOT-A-UPN", sex: "F" });
    expect(invalid.status).toBe(400);
    const first = await patchStatutory(app, hdrs, a.student.id, {
      upn,
      sex: "F",
      legalForename: "Amelia",
      legalSurname: "Khan",
      enrolmentStatusCode: "C",
      dateOfAdmission: "2026-09-01",
    });
    expect(first.status).toBe(200);
    const duplicate = await patchStatutory(app, hdrs, b.student.id, { upn, sex: "M" });
    expect(duplicate.status).toBe(409);
  });

  it("creates an immutable versioned census snapshot and exports census-ready CSV", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await seedYear(app, hdrs);
    const profile = await app.request("/api/v1/statutory/profile", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({
        statutoryName: "Greenwood Academy (synthetic)",
        localAuthorityNumber: "201",
        establishmentNumber: "9901",
        urn: "999001",
        schoolPhase: "PS",
      }),
    });
    expect(profile.status).toBe(200);
    const complete = await createStudent(app, hdrs, {
      legalName: "Amelia Khan",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
      dateOfBirth: "2018-04-12",
    });
    const incomplete = await createStudent(app, hdrs, {
      legalName: "Jack Brennan",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
      dateOfBirth: "2018-08-21",
    });
    const injection = await createStudent(app, hdrs, {
      legalName: "Formula Pupil",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
      dateOfBirth: "2018-01-02",
    });
    const upnA = generatePermanentUpn("201990180001");
    const upnB = generatePermanentUpn("201990180002");
    const upnC = generatePermanentUpn("201990180003");
    expect(
      (
        await patchStatutory(app, hdrs, complete.student.id, {
          upn: upnA,
          sex: "F",
          legalForename: "Amelia",
          legalSurname: "Khan",
          ethnicityCode: "APKN",
          languageCode: "ENG",
          enrolmentStatusCode: "C",
          dateOfAdmission: "2026-09-01",
          sendProvisionCode: "E",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await patchStatutory(app, hdrs, incomplete.student.id, {
          sex: "M",
          legalForename: "Jack",
          legalSurname: "Brennan",
          ethnicityCode: "WBRI",
          languageCode: "ENG",
          enrolmentStatusCode: "C",
          dateOfAdmission: "2026-09-01",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await patchStatutory(app, hdrs, injection.student.id, {
          upn: upnC,
          sex: "F",
          legalForename: "Formula",
          legalSurname: "=CMD()",
          ethnicityCode: "WBRI",
          languageCode: "ENG",
          enrolmentStatusCode: "C",
          dateOfAdmission: "2026-09-01",
        })
      ).status,
    ).toBe(200);
    await pools.owner.query(
      `insert into student_additional_needs (organisation_id, student_profile_id, send_notes)
       values ($1, $2, $3)`,
      [school.orgId, complete.student.id, "EHCP for speech (synthetic)"],
    );
    await app.request(`/api/v1/students/${complete.student.id}/statutory/fsm`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ startedOn: "2026-09-01", endedOn: "2026-12-31" }),
    });

    const quality = (await (
      await app.request("/api/v1/statutory/data-quality?asOf=2026-10-01", { headers: hdrs })
    ).json()) as { issues: Array<{ ruleKey: string; entityId: string | null }> };
    expect(quality.issues.some((row) => row.ruleKey === "pupil.upn.missing" && row.entityId === incomplete.student.id)).toBe(
      true,
    );

    const created = await app.request("/api/v1/statutory/census", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: year.yearId,
        censusType: "autumn",
        censusDate: "2026-10-01",
      }),
    });
    expect(created.status).toBe(201);
    const run = (await created.json()) as { censusRun: { id: string } };

    const snap1 = await app.request(`/api/v1/statutory/census/${run.censusRun.id}/snapshot`, {
      method: "POST",
      headers: hdrs,
    });
    expect(snap1.status).toBe(200);
    expect(((await snap1.json()) as { snapshotVersion: number }).snapshotVersion).toBe(1);

    const liveValidate = await app.request("/api/v1/statutory/validate?asOf=2026-10-01", {
      method: "POST",
      headers: hdrs,
    });
    expect(liveValidate.status).toBe(200);

    await patchStatutory(app, hdrs, incomplete.student.id, { upn: upnB });
    const snap2 = await app.request(`/api/v1/statutory/census/${run.censusRun.id}/snapshot`, {
      method: "POST",
      headers: hdrs,
    });
    expect(snap2.status).toBe(200);
    expect(((await snap2.json()) as { snapshotVersion: number }).snapshotVersion).toBe(2);

    const versions = await pools.owner.query<{ snapshot_version: number }>(
      `select distinct snapshot_version from census_snapshot_pupils where census_run_id = $1 order by 1`,
      [run.censusRun.id],
    );
    expect(versions.rows.map((row) => Number(row.snapshot_version))).toEqual([1, 2]);

    const validated = await app.request(`/api/v1/statutory/census/${run.censusRun.id}/validate`, {
      method: "POST",
      headers: hdrs,
    });
    expect(validated.status).toBe(200);
    expect(((await validated.json()) as { counts: { errorCount: number } }).counts.errorCount).toBe(0);

    const changed = generatePermanentUpn("201990180099");
    await patchStatutory(app, hdrs, complete.student.id, { upn: changed });
    const detail = (await (
      await app.request(`/api/v1/statutory/census/${run.censusRun.id}`, { headers: hdrs })
    ).json()) as { pupils: Array<{ upn: string | null; studentProfileId: string }> };
    const snapPupil = detail.pupils.find((row) => row.studentProfileId === complete.student.id);
    expect(snapPupil?.upn).toBe(upnA);
    expect(snapPupil?.upn).not.toBe(changed);

    const finalise = await app.request(`/api/v1/statutory/census/${run.censusRun.id}/finalise`, {
      method: "POST",
      headers: hdrs,
    });
    expect(finalise.status).toBe(200);
    const regenerate = await app.request(`/api/v1/statutory/census/${run.censusRun.id}/snapshot`, {
      method: "POST",
      headers: hdrs,
    });
    expect(regenerate.status).toBe(409);

    const csv = await app.request(`/api/v1/statutory/census/${run.censusRun.id}/export?format=csv`, {
      method: "POST",
      headers: hdrs,
    });
    expect(csv.status).toBe(200);
    const csvBytes = Buffer.from(await csv.arrayBuffer());
    expect(csvBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    const csvBody = csvBytes.toString("utf8");
    expect(csvBody.split("\r\n")[0]?.replace("\uFEFF", "")).toContain("admissionNumber,upn,legalSurname");
    expect(csvBody).toContain(upnA);
    expect(csvBody).not.toContain(changed);
    expect(csvBody).toContain("'=CMD()");
    const xml = await app.request(`/api/v1/statutory/census/${run.censusRun.id}/export?format=xml`, {
      method: "POST",
      headers: hdrs,
    });
    expect(xml.status).toBe(200);
    const xmlBody = await xml.text();
    expect(xmlBody).toContain("census-ready export (preview)");
    expect(xmlBody.toLowerCase()).not.toContain("dfe approved");

    const roll = await app.request("/api/v1/reports/pupils?format=csv", { headers: hdrs });
    expect(roll.status).toBe(200);
    expect(await roll.text()).toContain("'=CMD()");

    const send = await app.request("/api/v1/reports/send?format=csv", { headers: hdrs });
    expect(send.status).toBe(200);
    expect(await send.text()).toContain("Amelia Khan");

    const audits = await pools.owner.query<{ action: string; after_data: Record<string, unknown> }>(
      `select action, after_data from audit_events where organisation_id = $1 and action like 'statutory.%'`,
      [school.orgId],
    );
    expect(audits.rows.some((row) => row.action === "statutory.census.snapshot")).toBe(true);
    expect(JSON.stringify(audits.rows)).not.toContain(upnA);
  });

  it("enforces role isolation and does not leak statutory fields to portals", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await seedYear(app, hdrs);
    await app.request(`/api/v1/year-groups/${year.year3Id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ studentLoginEnabled: true }),
    });
    const pupil = await createStudent(app, hdrs, {
      legalName: "Maya Ellis",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
      dateOfBirth: "2018-01-22",
      loginAlias: `maya-${id}`,
      password: "student-pass-1",
    });
    await patchStatutory(app, hdrs, pupil.student.id, {
      upn: generatePermanentUpn("201990180011"),
      sex: "F",
      legalForename: "Maya",
      legalSurname: "Ellis",
      ethnicityCode: "WBRI",
      languageCode: "ENG",
      enrolmentStatusCode: "C",
      lookedAfterStatus: "looked_after",
      serviceChild: true,
    });

    const operational = await (await app.request(`/api/v1/students/${pupil.student.id}`, { headers: hdrs })).json();
    expect(JSON.stringify(operational)).not.toContain("lookedAfterStatus");
    expect(JSON.stringify(operational)).not.toMatch(/"upn"/);

    const headId = await insertUser(pools.owner, {
      email: `head-${id}@example.com`,
      password: "password-12x",
      fullName: "Head",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, headId, "school.headteacher");
    const headToken = await login(app, `head-${id}@example.com`, "password-12x");
    const headHdrs = jsonHeaders(headToken, school.orgId);
    expect((await app.request("/api/v1/statutory/overview", { headers: headHdrs })).status).toBe(200);
    expect((await app.request("/api/v1/reports/pupils", { headers: headHdrs })).status).toBe(200);
    expect((await app.request("/api/v1/statutory/census", { method: "POST", headers: headHdrs, body: "{}" })).status).toBe(
      403,
    );

    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    const teacherToken = await login(app, `teacher-${id}@example.com`, "password-12x");
    const teacherHdrs = jsonHeaders(teacherToken, school.orgId);
    expect((await app.request("/api/v1/statutory/overview", { headers: teacherHdrs })).status).toBe(403);
    expect((await app.request(`/api/v1/students/${pupil.student.id}/statutory`, { headers: teacherHdrs })).status).toBe(
      403,
    );
    expect((await app.request("/api/v1/reports/send", { headers: teacherHdrs })).status).toBe(403);
    expect((await app.request("/api/v1/reports/pupils?format=csv", { headers: teacherHdrs })).status).toBe(403);

    const parentCreated = await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `parent-${id}@example.com`,
        fullName: "Pat Parent",
        relationship: "mother",
        portalAccess: true,
        hasParentalResponsibility: true,
      }),
    });
    const guardian = (await parentCreated.json()) as { invitationToken: string | null };
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
    expect((await app.request("/api/v1/statutory/overview", { headers: parentHdrs })).status).toBe(403);
    const parentDash = await (await app.request("/api/v1/parent/dashboard", { headers: parentHdrs })).json();
    assertPortalSafe(parentDash);
    const children = await (await app.request("/api/v1/parent/children", { headers: parentHdrs })).json();
    assertPortalSafe(children);

    const studentToken = await loginAlias(app, school.slug, `maya-${id}`, "student-pass-1");
    const studentHdrs = jsonHeaders(studentToken, school.orgId);
    expect((await app.request("/api/v1/statutory/overview", { headers: studentHdrs })).status).toBe(403);
    const studentMe = await (await app.request("/api/v1/student/me", { headers: studentHdrs })).json();
    assertPortalSafe(studentMe);

    const platformId = await insertUser(pools.owner, {
      email: `platform-${id}@example.com`,
      password: "password-12x",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    void platformId;
    const platformToken = await login(app, `platform-${id}@example.com`, "password-12x");
    const platformPeek = await app.request("/api/v1/statutory/overview", {
      headers: jsonHeaders(platformToken, school.orgId),
    });
    expect([403, 404]).toContain(platformPeek.status);
    const pupilPeek = await app.request(`/api/v1/students/${pupil.student.id}/statutory`, {
      headers: jsonHeaders(platformToken, school.orgId),
    });
    expect([403, 404]).toContain(pupilPeek.status);
  });

  it("isolates Greenwood-style statutory data from a second school", async () => {
    const id = suffix();
    const greenwood = await createSchool(pools.owner, `g-${id}`);
    const oak = await createSchool(pools.owner, `o-${id}`);
    const gwToken = await login(app, greenwood.adminEmail, "password-12x");
    const oakToken = await login(app, oak.adminEmail, "password-12x");
    const gwHdrs = jsonHeaders(gwToken, greenwood.orgId);
    const oakHdrs = jsonHeaders(oakToken, oak.orgId);
    const gwYear = await seedYear(app, gwHdrs);
    const oakYear = await seedYear(app, oakHdrs);
    const gwPupil = await createStudent(app, gwHdrs, {
      legalName: "Amelia Khan",
      academicYearId: gwYear.yearId,
      yearGroupId: gwYear.year3Id,
      classId: gwYear.classAId,
      dateOfBirth: "2018-04-12",
    });
    const oakPupil = await createStudent(app, oakHdrs, {
      legalName: "Niamh Okonkwo",
      academicYearId: oakYear.yearId,
      yearGroupId: oakYear.year3Id,
      classId: oakYear.classAId,
      dateOfBirth: "2018-07-19",
    });
    await patchStatutory(app, gwHdrs, gwPupil.student.id, {
      upn: generatePermanentUpn("201990100001"),
      sex: "F",
      legalForename: "Amelia",
      legalSurname: "Khan",
    });
    await patchStatutory(app, oakHdrs, oakPupil.student.id, {
      upn: generatePermanentUpn("202990200001"),
      sex: "F",
      legalForename: "Niamh",
      legalSurname: "Okonkwo",
    });
    const gwRoll = (await (await app.request("/api/v1/reports/pupils", { headers: gwHdrs })).json()) as {
      pupils: Array<{ legalName: string }>;
    };
    expect(gwRoll.pupils.map((row) => row.legalName)).toContain("Amelia Khan");
    expect(gwRoll.pupils.map((row) => row.legalName)).not.toContain("Niamh Okonkwo");
    const oakPeek = await app.request(`/api/v1/students/${oakPupil.student.id}/statutory`, { headers: gwHdrs });
    expect(oakPeek.status).toBe(404);
    const oakCensus = await app.request("/api/v1/statutory/census", {
      method: "POST",
      headers: oakHdrs,
      body: JSON.stringify({
        academicYearId: oakYear.yearId,
        censusType: "autumn",
        censusDate: "2026-10-01",
      }),
    });
    const oakRun = (await oakCensus.json()) as { censusRun: { id: string } };
    const stolen = await app.request(`/api/v1/statutory/census/${oakRun.censusRun.id}`, { headers: gwHdrs });
    expect(stolen.status).toBe(404);
  });

  it("excludes attendance marks outside the on-roll window", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const year = await seedYear(app, hdrs);
    const joiner = await createStudent(app, hdrs, {
      legalName: "Oliver Brooks",
      academicYearId: year.yearId,
      yearGroupId: year.year3Id,
      classId: year.classAId,
      dateOfBirth: "2017-06-18",
    });
    await patchStatutory(app, hdrs, joiner.student.id, {
      upn: generatePermanentUpn("201990180021"),
      sex: "M",
      legalForename: "Oliver",
      legalSurname: "Brooks",
      enrolmentStatusCode: "C",
      dateOfAdmission: "2026-11-03",
    });
    const session = await pools.owner.query<{ id: string }>(
      "select id from attendance_session_types where organisation_id = $1 and key = 'am'",
      [school.orgId],
    );
    const code = await pools.owner.query<{ id: string }>(
      "select id from attendance_codes where organisation_id = $1 and code = 'present'",
      [school.orgId],
    );
    await pools.owner.query(
      `insert into attendance_marks (
         organisation_id, student_profile_id, academic_year_id, session_type_id, mark_date,
         attendance_code_id, recorded_by
       ) values ($1,$2,$3,$4,'2026-09-08',$5,$6), ($1,$2,$3,$4,'2026-11-04',$5,$6)`,
      [school.orgId, joiner.student.id, year.yearId, session.rows[0]!.id, code.rows[0]!.id, school.adminId],
    );
    const report = (await (
      await app.request("/api/v1/reports/attendance?from=2026-09-01&to=2026-11-30", { headers: hdrs })
    ).json()) as { pupils: Array<{ studentProfileId: string; sessionsPossible: number; sessionsPresent: number }> };
    const row = report.pupils.find((item) => item.studentProfileId === joiner.student.id);
    expect(row?.sessionsPossible).toBe(1);
    expect(row?.sessionsPresent).toBe(1);
  });

  it("does not allow teachers to export SEND reports", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const teacherId = await insertUser(pools.owner, {
      email: `teacher-send-${id}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, school.orgId, teacherId, "school.teacher");
    const teacherToken = await login(app, `teacher-send-${id}@example.com`, "password-12x");
    expect(
      (await app.request("/api/v1/reports/send?format=csv", { headers: jsonHeaders(teacherToken, school.orgId) })).status,
    ).toBe(403);
    expect((await app.request("/api/v1/reports/send", { headers: hdrs })).status).toBe(200);
  });
});
