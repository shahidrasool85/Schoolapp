import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInTimeZone } from "@schoolapp/domain";
import { closePools } from "@schoolapp/db";
import { startOfIsoWeek } from "@schoolapp/core";
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
    "insert into organisations (slug, name, status, timezone) values ($1, $2, 'active', 'Europe/London') returning id, slug",
    [`rux-${id}`, `Recurrence UX ${id}`],
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

async function seedYear(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof headers>, endsOn = "2027-07-23") {
  const created = await app.request("/api/v1/academic-years", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      name: "2026/27",
      startsOn: "2026-09-03",
      endsOn,
      isCurrent: true,
    }),
  });
  expect(created.status).toBe(201);
  const year = await json<{ academicYear: { id: string; name: string; endsOn: string } }>(created);
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
      body: JSON.stringify({ key: `eng-${suffix()}`, name: "English" }),
    }),
  );
  return {
    yearId: year.academicYear.id,
    yearName: year.academicYear.name,
    yearEndsOn: year.academicYear.endsOn,
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
        fullName: "Arifa Aslam",
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
      fullName: "Arifa Aslam",
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

async function addTerms(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof headers>, yearId: string) {
  const autumn = await json<{ term: { id: string; name: string; endsOn: string } }>(
    await app.request(`/api/v1/academic-years/${yearId}/terms`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Autumn Term", startsOn: "2026-09-03", endsOn: "2026-12-18" }),
    }),
  );
  await app.request(`/api/v1/academic-years/${yearId}/terms`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({ name: "Spring Term", startsOn: "2027-01-04", endsOn: "2027-03-31" }),
  });
  await app.request(`/api/v1/academic-years/${yearId}/terms`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({ name: "Summer Term", startsOn: "2027-04-19", endsOn: "2027-07-23" }),
  });
  return autumn.term;
}

function lessonBody(
  structure: { yearId: string; classAId: string; subjectId: string },
  teacherId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    academicYearId: structure.yearId,
    weekday: 1,
    startsAt: "09:00",
    endsAt: "11:00",
    classId: structure.classAId,
    subjectId: structure.subjectId,
    effectiveFrom: "2026-09-03",
    teachers: [{ staffProfileId: teacherId, isPrimary: true }],
    ...extra,
  };
}

describe("Timetable recurrence UX hotfix", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("resolves end of term, term boundaries, missing terms, and year fallback", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, suffix(), structure.classAId);

    const noTermsPreview = await app.request("/api/v1/timetable/entries/preview", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        ...lessonBody(structure, teacher.staffProfileId),
        repeatUntil: { kind: "end_of_term" },
      }),
    });
    expect(noTermsPreview.status).toBe(400);
    expect((await json<{ error: { message: string } }>(noTermsPreview)).error.message).toMatch(/no terms yet/i);

    const yearFallback = await json<{ preview: { effectiveUntil: string; occurrenceCount: number; dates: string[] } }>(
      await app.request("/api/v1/timetable/entries/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          ...lessonBody(structure, teacher.staffProfileId),
          repeatUntil: { kind: "end_of_academic_year" },
        }),
      }),
    );
    expect(yearFallback.preview.effectiveUntil).toBe("2027-07-23");
    expect(yearFallback.preview.dates).toContain("2026-12-21");

    const createdOpen = await json<{ entry: { id: string; effectiveUntil: string | null } }>(
      await app.request("/api/v1/timetable/entries", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify(lessonBody(structure, teacher.staffProfileId)),
      }),
    );
    expect(createdOpen.entry.effectiveUntil).toBeNull();

    const autumn = await addTerms(app, hdrs, structure.yearId);

    const startPreview = await json<{ preview: { effectiveUntil: string; repeatUntilLabel: string; dates: string[] } }>(
      await app.request("/api/v1/timetable/entries/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          ...lessonBody(structure, teacher.staffProfileId),
          repeatUntil: { kind: "end_of_term" },
        }),
      }),
    );
    expect(startPreview.preview.effectiveUntil).toBe("2026-12-18");
    expect(startPreview.preview.repeatUntilLabel).toMatch(/Autumn Term ends/);
    expect(startPreview.preview.dates.at(-1)).toBe("2026-12-14");

    const boundary = await json<{ preview: { effectiveUntil: string } }>(
      await app.request("/api/v1/timetable/entries/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          ...lessonBody(structure, teacher.staffProfileId, { effectiveFrom: "2026-12-18" }),
          repeatUntil: { kind: "end_of_term" },
        }),
      }),
    );
    expect(boundary.preview.effectiveUntil).toBe(autumn.endsOn);

    const outside = await app.request("/api/v1/timetable/entries/preview", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        ...lessonBody(structure, teacher.staffProfileId, { effectiveFrom: "2026-12-21" }),
        repeatUntil: { kind: "end_of_term" },
      }),
    });
    expect(outside.status).toBe(400);
    expect((await json<{ error: { message: string } }>(outside)).error.message).toMatch(
      /No academic term contains this start date/,
    );

    const createdTerm = await json<{ entry: { effectiveUntil: string } }>(
      await app.request("/api/v1/timetable/entries", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          ...lessonBody(structure, teacher.staffProfileId, {
            weekday: 2,
            startsAt: "11:00",
            endsAt: "13:00",
          }),
          repeatUntil: { kind: "end_of_term" },
        }),
      }),
    );
    expect(createdTerm.entry.effectiveUntil).toBe("2026-12-18");
  });

  it("validates custom dates and keeps preview aligned with generated occurrences", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, suffix(), structure.classAId);
    await addTerms(app, hdrs, structure.yearId);

    const beforeStart = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        ...lessonBody(structure, teacher.staffProfileId),
        repeatUntil: { kind: "custom_date", date: "2026-09-02" },
      }),
    });
    expect(beforeStart.status).toBe(400);
    expect((await json<{ error: { message: string } }>(beforeStart)).error.message).toMatch(/before the start date/i);

    const beyondYear = await app.request("/api/v1/timetable/entries/preview", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        ...lessonBody(structure, teacher.staffProfileId),
        repeatUntil: { kind: "custom_date", date: "2027-07-24" },
      }),
    });
    expect(beyondYear.status).toBe(400);
    expect((await json<{ error: { message: string } }>(beyondYear)).error.message).toMatch(/inside the selected academic year/i);

    const preview = await json<{ preview: { dates: string[]; occurrenceCount: number; effectiveUntil: string } }>(
      await app.request("/api/v1/timetable/entries/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          ...lessonBody(structure, teacher.staffProfileId),
          repeatUntil: { kind: "end_of_academic_year" },
        }),
      }),
    );
    expect(preview.preview.dates).toContain("2026-09-07");
    expect(preview.preview.dates).toContain("2027-01-04");
    expect(preview.preview.dates).toContain("2027-04-19");
    expect(preview.preview.dates).not.toContain("2026-12-21");
    expect(preview.preview.dates).not.toContain("2027-04-05");

    const created = await json<{ entry: { id: string; effectiveUntil: string } }>(
      await app.request("/api/v1/timetable/entries", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          ...lessonBody(structure, teacher.staffProfileId),
          repeatUntil: { kind: "end_of_academic_year" },
        }),
      }),
    );
    expect(created.entry.effectiveUntil).toBe("2027-07-23");
    const generated = await json<{ occurrences: Array<{ date: string }> }>(
      await app.request(
        `/api/v1/timetable/occurrences?from=2026-09-03&to=2027-07-23&classId=${structure.classAId}`,
        { headers: hdrs },
      ),
    );
    expect(generated.occurrences.map((item) => item.date)).toEqual(preview.preview.dates);
    expect(generated.occurrences).toHaveLength(preview.preview.occurrenceCount);
  });

  it("counts six valid teaching occurrences and skips closures and holidays", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, suffix(), structure.classAId);
    await addTerms(app, hdrs, structure.yearId);
    const closure = await app.request("/api/v1/timetable/exceptions", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        date: "2026-09-14",
        exceptionType: "school_closure",
      }),
    });
    expect(closure.status).toBe(201);

    const six = await json<{ preview: { dates: string[]; effectiveUntil: string; occurrenceCount: number } }>(
      await app.request("/api/v1/timetable/entries/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          ...lessonBody(structure, teacher.staffProfileId),
          repeatUntil: { kind: "occurrence_count", count: 6 },
        }),
      }),
    );
    expect(six.preview.occurrenceCount).toBe(6);
    expect(six.preview.dates).toEqual([
      "2026-09-07",
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
    ]);
    expect(six.preview.dates).not.toContain("2026-09-14");
    expect(six.preview.effectiveUntil).toBe("2026-10-19");

    const created = await json<{ entry: { id: string; effectiveUntil: string } }>(
      await app.request("/api/v1/timetable/entries", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          ...lessonBody(structure, teacher.staffProfileId),
          repeatUntil: { kind: "occurrence_count", count: 6 },
        }),
      }),
    );
    expect(created.entry.effectiveUntil).toBe("2026-10-19");
    const generated = await json<{ occurrences: Array<{ date: string }> }>(
      await app.request(
        `/api/v1/timetable/occurrences?from=2026-09-03&to=2026-11-30&classId=${structure.classAId}`,
        { headers: hdrs },
      ),
    );
    expect(generated.occurrences.map((item) => item.date)).toEqual(six.preview.dates);

    const holidayCount = await json<{ preview: { dates: string[] } }>(
      await app.request("/api/v1/timetable/entries/preview", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          ...lessonBody(structure, teacher.staffProfileId, { effectiveFrom: "2026-12-07" }),
          repeatUntil: { kind: "occurrence_count", count: 6 },
        }),
      }),
    );
    expect(holidayCount.preview.dates).toEqual([
      "2026-12-07",
      "2026-12-14",
      "2027-01-04",
      "2027-01-11",
      "2027-01-18",
      "2027-01-25",
    ]);
    expect(holidayCount.preview.dates).not.toContain("2026-12-21");
  });

  it("keeps teacher/student views, permissions, end/delete, replacement, and current-week defaults", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const liveYear = await json<{ academicYear: { id: string } }>(
      await app.request("/api/v1/academic-years", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "2026/27 live",
          startsOn: "2026-08-01",
          endsOn: "2027-07-23",
          isCurrent: true,
        }),
      }),
    );
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
          academicYearId: liveYear.academicYear.id,
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
    const structure = {
      yearId: liveYear.academicYear.id,
      year3Id: year3.id,
      classAId: classA.class.id,
      subjectId: subject.subject.id,
    };
    const teacher = await inviteTeacher(app, hdrs, suffix(), structure.classAId);
    const replacementTeacher = await inviteTeacher(app, hdrs, suffix(), structure.classAId);

    const future = await json<{ entry: { id: string } }>(
      await app.request("/api/v1/timetable/entries", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          ...lessonBody(structure, teacher.staffProfileId, { effectiveFrom: "2026-10-05" }),
          repeatUntil: { kind: "end_of_academic_year" },
        }),
      }),
    );
    expect(
      (await app.request(`/api/v1/timetable/entries/${future.entry.id}`, { method: "DELETE", headers: hdrs })).status,
    ).toBe(200);

    const started = await json<{ entry: { id: string; academicYearId: string } }>(
      await app.request("/api/v1/timetable/entries", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify(lessonBody(structure, teacher.staffProfileId, { effectiveFrom: "2026-08-03" })),
      }),
    );

    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const teacherH = headers(teacherToken, school.orgId);
    expect(
      (
        await app.request("/api/v1/timetable/entries", {
          method: "POST",
          headers: teacherH,
          body: JSON.stringify(lessonBody(structure, teacher.staffProfileId)),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`/api/v1/timetable/entries/${started.entry.id}/end`, {
          method: "POST",
          headers: teacherH,
          body: JSON.stringify({ stopFrom: "2026-09-11" }),
        })
      ).status,
    ).toBe(403);

    const teacherWeek = await json<{ occurrences: Array<{ date: string; entryId: string }> }>(
      await app.request("/api/v1/timetable/occurrences?from=2026-09-07&to=2026-09-07&mine=true", {
        headers: teacherH,
      }),
    );
    expect(teacherWeek.occurrences.some((item) => item.entryId === started.entry.id && item.date === "2026-09-07")).toBe(
      true,
    );

    const blockedDelete = await app.request(`/api/v1/timetable/entries/${started.entry.id}`, {
      method: "DELETE",
      headers: hdrs,
    });
    expect(blockedDelete.status).toBe(409);
    expect((await json<{ error: { message: string } }>(blockedDelete)).error.message).toMatch(
      /already has timetable history|already started/i,
    );

    const ended = await app.request(`/api/v1/timetable/entries/${started.entry.id}/end`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ stopFrom: "2026-09-11" }),
    });
    expect(ended.status).toBe(200);
    const history = await json<{ occurrences: Array<{ date: string; entryId: string }> }>(
      await app.request(
        `/api/v1/timetable/occurrences?from=2026-09-07&to=2026-09-07&classId=${structure.classAId}`,
        { headers: hdrs },
      ),
    );
    expect(history.occurrences).toEqual([
      expect.objectContaining({ date: "2026-09-07", entryId: started.entry.id }),
    ]);

    const overlap = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify(
        lessonBody(structure, replacementTeacher.staffProfileId, { effectiveFrom: "2026-09-10" }),
      ),
    });
    expect(overlap.status).toBe(409);

    const replacement = await app.request("/api/v1/timetable/entries", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify(
        lessonBody(structure, replacementTeacher.staffProfileId, { effectiveFrom: "2026-09-11" }),
      ),
    });
    expect(replacement.status).toBe(201);

    await app.request(`/api/v1/year-groups/${structure.year3Id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ studentLoginEnabled: true }),
    });
    const alias = `pupil-${suffix()}`;
    const studentCreated = await app.request("/api/v1/students", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        legalName: "Pat Pupil",
        academicYearId: structure.yearId,
        yearGroupId: structure.year3Id,
        classId: structure.classAId,
        loginAlias: alias,
        password: "student-pass-1",
      }),
    });
    expect(studentCreated.status).toBe(201);
    const studentToken = await loginAlias(app, school.slug, alias, "student-pass-1");
    const studentH = headers(studentToken, school.orgId);
    const studentWeek = await json<{ occurrences: Array<{ date: string }> }>(
      await app.request("/api/v1/student/timetable?from=2026-09-07", { headers: studentH }),
    );
    expect(studentWeek.occurrences.some((item) => item.date === "2026-09-07")).toBe(true);
    expect(
      (
        await app.request("/api/v1/timetable/entries", {
          method: "POST",
          headers: studentH,
          body: JSON.stringify(lessonBody(structure, teacher.staffProfileId)),
        })
      ).status,
    ).toBe(403);

    const overview = await json<{ today: string; week: { from: string } }>(
      await app.request("/api/v1/timetable/overview", { headers: hdrs }),
    );
    const current = await json<{ weekCommencing: string }>(
      await app.request("/api/v1/timetable/occurrences", { headers: hdrs }),
    );
    const expectedToday = todayInTimeZone("Europe/London");
    expect(overview.today).toBe(expectedToday);
    expect(overview.week.from).toBe(startOfIsoWeek(expectedToday));
    expect(current.weekCommencing).toBe(startOfIsoWeek(expectedToday));
  });

  it("isolates preview and recurrence writes by tenant", async () => {
    const a = await createSchool(pools.owner, suffix());
    const b = await createSchool(pools.owner, suffix());
    const aToken = await login(app, a.adminEmail, "password-12x");
    const bToken = await login(app, b.adminEmail, "password-12x");
    const aH = headers(aToken, a.orgId);
    const bH = headers(bToken, b.orgId);
    const aS = await seedYear(app, aH);
    const bS = await seedYear(app, bH);
    const aTeacher = await inviteTeacher(app, aH, suffix(), aS.classAId);
    const created = await json<{ entry: { id: string } }>(
      await app.request("/api/v1/timetable/entries", {
        method: "POST",
        headers: aH,
        body: JSON.stringify({
          ...lessonBody(aS, aTeacher.staffProfileId),
          repeatUntil: { kind: "end_of_academic_year" },
        }),
      }),
    );
    expect((await app.request(`/api/v1/timetable/entries/${created.entry.id}`, { headers: bH })).status).toBe(404);
    expect(
      (
        await app.request("/api/v1/timetable/entries/preview", {
          method: "POST",
          headers: bH,
          body: JSON.stringify({
            ...lessonBody(aS, aTeacher.staffProfileId),
            repeatUntil: { kind: "end_of_academic_year" },
          }),
        })
      ).status,
    ).toBe(400);
    expect(bS.yearId).toBeTruthy();
  });

  it("replaces an active recurrence from a date without rewriting history", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const early = await seedYear(app, hdrs, "2027-07-22");
    const year = await json<{ academicYear: { id: string } }>(
      await app.request("/api/v1/academic-years", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Live 26/27",
          startsOn: "2026-08-01",
          endsOn: "2027-07-22",
          isCurrent: true,
        }),
      }),
    );
    const classA = await json<{ class: { id: string } }>(
      await app.request("/api/v1/classes", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "3B",
          academicYearId: year.academicYear.id,
          yearGroupId: early.year3Id,
          classType: "form",
        }),
      }),
    );
    const teacher = await inviteTeacher(app, hdrs, suffix(), classA.class.id);
    const nextTeacher = await inviteTeacher(app, hdrs, suffix(), classA.class.id);
    const created = await json<{ entry: { id: string } }>(
      await app.request("/api/v1/timetable/entries", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          academicYearId: year.academicYear.id,
          weekday: 1,
          startsAt: "09:00",
          endsAt: "11:00",
          classId: classA.class.id,
          subjectId: early.subjectId,
          effectiveFrom: "2026-08-03",
          teachers: [{ staffProfileId: teacher.staffProfileId, isPrimary: true }],
        }),
      }),
    );
    const replaced = await json<{ endedEntry: { id: string; effectiveUntil: string }; entry: { id: string } }>(
      await app.request(`/api/v1/timetable/entries/${created.entry.id}/replace`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          applyFrom: "2026-09-14",
          teachers: [{ staffProfileId: nextTeacher.staffProfileId, isPrimary: true }],
          repeatUntil: { kind: "end_of_academic_year" },
        }),
      }),
    );
    expect(replaced.endedEntry.effectiveUntil).toBe("2026-09-13");
    expect(replaced.entry.id).not.toBe(created.entry.id);
    const past = await json<{ occurrences: Array<{ entryId: string; teachers: Array<{ staffProfileId: string }> }> }>(
      await app.request(
        `/api/v1/timetable/occurrences?from=2026-09-07&to=2026-09-07&classId=${classA.class.id}`,
        { headers: hdrs },
      ),
    );
    expect(past.occurrences[0]?.entryId).toBe(created.entry.id);
    expect(past.occurrences[0]?.teachers.some((item) => item.staffProfileId === teacher.staffProfileId)).toBe(true);
    const future = await json<{ occurrences: Array<{ entryId: string; teachers: Array<{ staffProfileId: string }> }> }>(
      await app.request(
        `/api/v1/timetable/occurrences?from=2026-09-14&to=2026-09-14&classId=${classA.class.id}`,
        { headers: hdrs },
      ),
    );
    expect(future.occurrences[0]?.entryId).toBe(replaced.entry.id);
    expect(future.occurrences[0]?.teachers.some((item) => item.staffProfileId === nextTeacher.staffProfileId)).toBe(
      true,
    );
  });
});
