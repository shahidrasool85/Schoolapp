import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defaultRecurrenceEffectiveFrom,
  resetFormSafely,
  shouldOfferAcademicYearCreate,
} from "@schoolapp/domain";
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
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status, timezone) values ($1, $2, 'active', 'Europe/London') returning id, slug",
    [`uat-${id}`, `UAT ${id}`],
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

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function seedYear(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  input?: { name?: string; startsOn?: string; endsOn?: string },
) {
  const created = await app.request("/api/v1/academic-years", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      name: input?.name ?? "2026/27",
      startsOn: input?.startsOn ?? "2026-09-03",
      endsOn: input?.endsOn ?? "2027-07-22",
      isCurrent: true,
    }),
  });
  expect(created.status).toBe(201);
  const year = await json<{ academicYear: { id: string; startsOn: string } }>(created);
  await app.request("/api/v1/year-groups/seed", { method: "POST", headers: hdrs, body: "{}" });
  const groups = await json<{ yearGroups: Array<{ id: string; code: string }> }>(
    await app.request("/api/v1/year-groups", { headers: hdrs }),
  );
  const year3 = groups.yearGroups.find((group) => group.code === "3")!;
  const classA = await json<{ class: { id: string } }>(
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
      body: JSON.stringify({ key: `maths-${suffix()}`, name: "Mathematics" }),
    }),
  );
  return {
    yearId: year.academicYear.id,
    startsOn: year.academicYear.startsOn,
    year3Id: year3.id,
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
        fullName: "Terry Teacher",
        roleKeys: ["school.teacher"],
        jobTitle: "Class teacher",
      }),
    }),
  );
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
      body: JSON.stringify({
        staffProfileId: staff.staffProfileId,
        assignmentRole: "form_tutor",
      }),
    });
  }
  return { email: `teacher-${id}@example.com`, staffProfileId: staff.staffProfileId };
}

describe("Timetable calendar finance UAT hotfix", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("defaults effective-from to the academic-year start, not 1 September, and rejects dates before the year", async () => {
    expect(
      defaultRecurrenceEffectiveFrom({
        today: "2026-08-31",
        academicYearStartsOn: "2026-09-03",
        academicYearEndsOn: "2027-07-22",
      }),
    ).toBe("2026-09-03");
    expect(
      defaultRecurrenceEffectiveFrom({
        today: "2026-09-20",
        academicYearStartsOn: "2026-09-03",
        academicYearEndsOn: "2027-07-22",
      }),
    ).toBe("2026-09-20");
    expect(
      defaultRecurrenceEffectiveFrom({
        today: "2026-08-31",
        academicYearStartsOn: "2025-09-01",
        academicYearEndsOn: "2026-07-21",
      }),
    ).toBe("2026-07-21");

    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, suffix(), structure.classAId);
    const outside = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: structure.yearId,
        weekday: 1,
        startsAt: "09:00",
        endsAt: "10:00",
        classId: structure.classAId,
        subjectId: structure.subjectId,
        effectiveFrom: "2026-09-01",
        teachers: [{ staffProfileId: teacher.staffProfileId, isPrimary: true }],
      }),
    });
    expect(outside.status).toBe(400);
    expect((await json<{ error: { message: string } }>(outside)).error.message).toMatch(
      /inside the academic year/i,
    );
  });

  it("saves a recurring lesson, refreshes definitions, and supports future delete without a reset crash path", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, suffix(), structure.classAId);
    expect(() => resetFormSafely(null)).not.toThrow();

    const created = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: structure.yearId,
        weekday: 1,
        startsAt: "09:00",
        endsAt: "10:00",
        classId: structure.classAId,
        subjectId: structure.subjectId,
        effectiveFrom: "2026-09-03",
        teachers: [{ staffProfileId: teacher.staffProfileId, isPrimary: true }],
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = await json<{
      entry: { id: string };
      firstOccurrence: { date: string } | null;
      message: string;
    }>(created);
    expect(createdBody.message).toMatch(/Recurring lesson saved/i);
    expect(createdBody.firstOccurrence?.date).toBe("2026-09-07");

    const listed = await json<{ entries: Array<{ id: string; lifecycleStatus: string }> }>(
      await app.request("/api/v1/timetable/entries", { headers: hdrs }),
    );
    expect(listed.entries.some((entry) => entry.id === createdBody.entry.id)).toBe(true);
    expect(listed.entries[0]?.lifecycleStatus).toBe("future");

    const week = await json<{ occurrences: Array<{ date: string; entryId: string }> }>(
      await app.request(
        `/api/v1/timetable/occurrences?from=2026-09-07&to=2026-09-11&classId=${structure.classAId}`,
        { headers: hdrs },
      ),
    );
    expect(week.occurrences.map((item) => item.date)).toEqual(["2026-09-07"]);

    const deleted = await app.request(`/api/v1/timetable/entries/${createdBody.entry.id}`, {
      method: "DELETE",
      headers: hdrs,
    });
    expect(deleted.status).toBe(200);
    const afterDelete = await json<{ entries: unknown[] }>(
      await app.request("/api/v1/timetable/entries", { headers: hdrs }),
    );
    expect(afterDelete.entries).toHaveLength(0);
  });

  it("ends an active recurrence without destroying history, and blocks hard delete", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs, {
      startsOn: "2026-08-01",
      endsOn: "2027-07-22",
    });
    const teacher = await inviteTeacher(app, hdrs, suffix(), structure.classAId);
    const coverTeacher = await inviteTeacher(app, hdrs, suffix(), structure.classAId);
    const created = await json<{ entry: { id: string } }>(
      await app.request("/api/v1/timetable/entries", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: structure.yearId,
          weekday: 1,
          startsAt: "09:00",
          endsAt: "10:00",
          classId: structure.classAId,
          subjectId: structure.subjectId,
          effectiveFrom: "2026-08-01",
          teachers: [{ staffProfileId: teacher.staffProfileId, isPrimary: true }],
        }),
      }),
    );

    const cover = await app.request("/api/v1/timetable/covers", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        timetableEntryId: created.entry.id,
        date: "2026-08-24",
        coveringStaffProfileId: coverTeacher.staffProfileId,
        reason: "Training",
      }),
    });
    expect(cover.status).toBe(201);

    const lifecycle = await json<{ entry: { lifecycle: { canDelete: boolean; canEnd: boolean; status: string } } }>(
      await app.request(`/api/v1/timetable/entries/${created.entry.id}/lifecycle`, { headers: hdrs }),
    );
    expect(lifecycle.entry.lifecycle.status).toBe("active");
    expect(lifecycle.entry.lifecycle.canDelete).toBe(false);
    expect(lifecycle.entry.lifecycle.canEnd).toBe(true);

    const hardDelete = await app.request(`/api/v1/timetable/entries/${created.entry.id}`, {
      method: "DELETE",
      headers: hdrs,
    });
    expect(hardDelete.status).toBe(409);

    const structural = await app.request(`/api/v1/timetable/entries/${created.entry.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ weekday: 2 }),
    });
    expect(structural.status).toBe(409);

    const ended = await app.request(`/api/v1/timetable/entries/${created.entry.id}/end`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ stopFrom: "2026-09-01" }),
    });
    expect(ended.status).toBe(200);

    const past = await json<{ occurrences: Array<{ date: string; covered: boolean }> }>(
      await app.request(
        `/api/v1/timetable/occurrences?from=2026-08-24&to=2026-08-24&classId=${structure.classAId}`,
        { headers: hdrs },
      ),
    );
    expect(past.occurrences).toHaveLength(1);
    expect(past.occurrences[0]?.covered).toBe(true);

    const future = await json<{ occurrences: unknown[] }>(
      await app.request(
        `/api/v1/timetable/occurrences?from=2026-09-07&to=2026-09-07&classId=${structure.classAId}`,
        { headers: hdrs },
      ),
    );
    expect(future.occurrences).toHaveLength(0);

    const afterEnd = await json<{ entry: { lifecycleStatus: string; effectiveUntil: string } }>(
      await app.request(`/api/v1/timetable/entries/${created.entry.id}`, { headers: hdrs }),
    );
    expect(afterEnd.entry.lifecycleStatus).toBe("ended");
    expect(afterEnd.entry.effectiveUntil).toBe("2026-08-31");
  });

  it("forbids teachers from mutating recurrences, terms, and fee schedules", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, suffix(), structure.classAId);
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const teacherH = headers(teacherToken, school.orgId);

    const createEntry = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: teacherH,
      body: JSON.stringify({
        academicYearId: structure.yearId,
        weekday: 1,
        startsAt: "09:00",
        endsAt: "10:00",
        classId: structure.classAId,
        effectiveFrom: "2026-09-03",
        teachers: [{ staffProfileId: teacher.staffProfileId, isPrimary: true }],
      }),
    });
    expect(createEntry.status).toBe(403);

    const adminEntry = await json<{ entry: { id: string } }>(
      await app.request("/api/v1/timetable/entries", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: structure.yearId,
          weekday: 1,
          startsAt: "09:00",
          endsAt: "10:00",
          classId: structure.classAId,
          effectiveFrom: "2026-09-03",
          teachers: [{ staffProfileId: teacher.staffProfileId, isPrimary: true }],
        }),
      }),
    );
    expect(
      (
        await app.request(`/api/v1/timetable/entries/${adminEntry.entry.id}/end`, {
          method: "POST",
          headers: teacherH,
          body: JSON.stringify({ stopFrom: "2026-09-10" }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await app.request(`/api/v1/timetable/entries/${adminEntry.entry.id}`, { method: "DELETE", headers: teacherH }))
        .status,
    ).toBe(403);

    expect(
      (
        await app.request(`/api/v1/academic-years/${structure.yearId}/terms`, {
          method: "POST",
          headers: teacherH,
          body: JSON.stringify({ name: "Autumn", startsOn: "2026-09-03", endsOn: "2026-12-18" }),
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await app.request("/api/v1/finance/fee-schedules", {
          method: "POST",
          headers: teacherH,
          body: JSON.stringify({
            name: "Hidden",
            academicYearId: structure.yearId,
            amountMinor: 60000,
            billingFrequency: "monthly",
            effectiveFrom: "2026-09-03",
          }),
        })
      ).status,
    ).toBe(403);
  });

  it("creates a fee schedule, surfaces invalid input, and lists the new row immediately", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);

    const invalid = await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Broken",
        academicYearId: structure.yearId,
        amountMinor: 60000,
        annualAmountMinor: 500000,
        billingFrequency: "monthly",
        instalmentCount: 10,
        effectiveFrom: "2026-09-03",
      }),
    });
    expect(invalid.status).toBe(400);
    expect((await json<{ error: { message: string } }>(invalid)).error.message).toMatch(/Annual total/i);

    const missingYear = await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Broken",
        amountMinor: 60000,
        billingFrequency: "monthly",
        effectiveFrom: "2026-09-03",
      }),
    });
    expect(missingYear.status).toBe(400);
    expect((await json<{ error: { message: string } }>(missingYear)).error.message).toMatch(/academic year/i);

    const created = await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "Year 3 monthly",
        academicYearId: structure.yearId,
        yearGroupId: structure.year3Id,
        amountMinor: 60000,
        annualAmountMinor: 600000,
        billingFrequency: "monthly",
        instalmentCount: 10,
        effectiveFrom: "2026-09-03",
      }),
    });
    expect(created.status).toBe(201);
    const listed = await json<{ schedules: Array<{ name: string }> }>(
      await app.request("/api/v1/finance/fee-schedules", { headers: hdrs }),
    );
    expect(listed.schedules.some((schedule) => schedule.name === "Year 3 monthly")).toBe(true);
  });

  it("does not recreate an existing academic year in setup, still creates the first year, and manages terms", async () => {
    expect(shouldOfferAcademicYearCreate(0)).toBe(true);
    expect(shouldOfferAcademicYearCreate(1)).toBe(false);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const first = await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "2026/27",
        startsOn: "2026-09-03",
        endsOn: "2027-07-22",
        isCurrent: true,
      }),
    });
    expect(first.status).toBe(201);
    const year = await json<{ academicYear: { id: string } }>(first);
    const duplicate = await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "2026/27",
        startsOn: "2026-09-03",
        endsOn: "2027-07-22",
        isCurrent: true,
      }),
    });
    expect(duplicate.status).toBe(409);
    expect((await json<{ error: { message: string } }>(duplicate)).error.message).toMatch(/already exists/i);

    const outside = await app.request(`/api/v1/academic-years/${year.academicYear.id}/terms`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Autumn", startsOn: "2026-08-01", endsOn: "2026-12-18" }),
    });
    expect(outside.status).toBe(400);

    const autumn = await app.request(`/api/v1/academic-years/${year.academicYear.id}/terms`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Autumn", startsOn: "2026-09-03", endsOn: "2026-12-18" }),
    });
    expect(autumn.status).toBe(201);
    const autumnBody = await json<{ term: { id: string; key: string } }>(autumn);
    expect(autumnBody.term.key).toBe("autumn");

    const overlap = await app.request(`/api/v1/academic-years/${year.academicYear.id}/terms`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Spring", startsOn: "2026-12-01", endsOn: "2027-03-26" }),
    });
    expect(overlap.status).toBe(400);

    const spring = await app.request(`/api/v1/academic-years/${year.academicYear.id}/terms`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Spring", startsOn: "2027-01-05", endsOn: "2027-03-26" }),
    });
    expect(spring.status).toBe(201);

    const patched = await app.request(`/api/v1/terms/${autumnBody.term.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ endsOn: "2026-12-17" }),
    });
    expect(patched.status).toBe(200);

    const listed = await json<{ terms: Array<{ name: string }> }>(
      await app.request(`/api/v1/academic-years/${year.academicYear.id}/terms`, { headers: hdrs }),
    );
    expect(listed.terms.map((term) => term.name)).toEqual(["Autumn", "Spring"]);
  });

  it("keeps no-terms timetable fallback and uses term windows once terms exist", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, suffix(), structure.classAId);
    await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        academicYearId: structure.yearId,
        weekday: 1,
        startsAt: "09:00",
        endsAt: "10:00",
        classId: structure.classAId,
        effectiveFrom: "2026-09-03",
        teachers: [{ staffProfileId: teacher.staffProfileId, isPrimary: true }],
      }),
    });
    const withoutTerms = await json<{ occurrences: Array<{ date: string }> }>(
      await app.request(
        `/api/v1/timetable/occurrences?from=2026-12-21&to=2026-12-21&classId=${structure.classAId}`,
        { headers: hdrs },
      ),
    );
    expect(withoutTerms.occurrences).toHaveLength(1);

    const autumn = await json<{ term: { id: string } }>(
      await app.request(`/api/v1/academic-years/${structure.yearId}/terms`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ name: "Autumn", startsOn: "2026-09-03", endsOn: "2026-12-18" }),
      }),
    );
    await app.request(`/api/v1/academic-years/${structure.yearId}/terms`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Spring", startsOn: "2027-01-05", endsOn: "2027-03-26" }),
    });
    const holiday = await json<{ occurrences: unknown[] }>(
      await app.request(
        `/api/v1/timetable/occurrences?from=2026-12-21&to=2026-12-21&classId=${structure.classAId}`,
        { headers: hdrs },
      ),
    );
    expect(holiday.occurrences).toHaveLength(0);
    const inTerm = await json<{ occurrences: Array<{ date: string }> }>(
      await app.request(
        `/api/v1/timetable/occurrences?from=2026-09-07&to=2026-09-07&classId=${structure.classAId}`,
        { headers: hdrs },
      ),
    );
    expect(inTerm.occurrences).toHaveLength(1);
    expect(autumn.term.id).toBeTruthy();
  });

  it("isolates terms, recurrences and fee schedules by tenant", async () => {
    const a = await createSchool(pools.owner, suffix());
    const b = await createSchool(pools.owner, suffix());
    const aToken = await login(app, a.adminEmail, "password-12x");
    const bToken = await login(app, b.adminEmail, "password-12x");
    const aH = headers(aToken, a.orgId);
    const bH = headers(bToken, b.orgId);
    const aS = await seedYear(app, aH);
    const bS = await seedYear(app, bH);
    const aTeacher = await inviteTeacher(app, aH, suffix(), aS.classAId);
    const term = await json<{ term: { id: string } }>(
      await app.request(`/api/v1/academic-years/${aS.yearId}/terms`, {
        method: "POST",
        headers: aH,
        body: JSON.stringify({ name: "Autumn", startsOn: "2026-09-03", endsOn: "2026-12-18" }),
      }),
    );
    const entry = await json<{ entry: { id: string } }>(
      await app.request("/api/v1/timetable/entries", {
        method: "POST",
        headers: aH,
        body: JSON.stringify({
          academicYearId: aS.yearId,
          weekday: 1,
          startsAt: "09:00",
          endsAt: "10:00",
          classId: aS.classAId,
          effectiveFrom: "2026-09-03",
          teachers: [{ staffProfileId: aTeacher.staffProfileId, isPrimary: true }],
        }),
      }),
    );
    const schedule = await json<{ schedule: { id: string } }>(
      await app.request("/api/v1/finance/fee-schedules", {
        method: "POST",
        headers: aH,
        body: JSON.stringify({
          name: "Secret schedule",
          academicYearId: aS.yearId,
          amountMinor: 1000,
          billingFrequency: "annual",
          effectiveFrom: "2026-09-03",
        }),
      }),
    );
    expect((await app.request(`/api/v1/terms/${term.term.id}`, { method: "PATCH", headers: bH, body: "{}" })).status).toBe(
      404,
    );
    expect((await app.request(`/api/v1/timetable/entries/${entry.entry.id}`, { headers: bH })).status).toBe(404);
    const leaked = await json<{ schedules: Array<{ id: string }> }>(
      await app.request("/api/v1/finance/fee-schedules", { headers: bH }),
    );
    expect(leaked.schedules.some((item) => item.id === schedule.schedule.id)).toBe(false);
    const visibleB = await withTenantContext(pools.app, a.adminId, a.orgId, async (client) => {
      const result = await client.query("select count(*)::int as n from school_fee_schedules where organisation_id = $1", [
        b.orgId,
      ]);
      return result.rows[0]?.n;
    });
    expect(visibleB).toBe(0);
    expect(bS.yearId).toBeTruthy();
  });
});
