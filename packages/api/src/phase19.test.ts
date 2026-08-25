import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    [`p19-${id}`, `Phase19 ${id}`],
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
  const yearR = groups.yearGroups.find((g) => g.code === "R")!;
  const year3 = groups.yearGroups.find((g) => g.code === "3")!;
  const year4 = groups.yearGroups.find((g) => g.code === "4")!;
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
        name: "4A",
        academicYearId: year.academicYear.id,
        yearGroupId: year4.id,
        classType: "form",
      }),
    })
  ).json()) as { class: { id: string } };
  await app.request(`/api/v1/year-groups/${year3.id}`, {
    method: "PATCH",
    headers: hdrs,
    body: JSON.stringify({ studentLoginEnabled: true }),
  });
  await app.request(`/api/v1/year-groups/${yearR.id}`, {
    method: "PATCH",
    headers: hdrs,
    body: JSON.stringify({ studentLoginEnabled: true }),
  });
  const house = (await (
    await app.request("/api/v1/houses", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ name: "Oak", shortCode: "OAK", colour: "#2f6f4e" }),
    })
  ).json()) as { house: { id: string } };
  return {
    yearId: year.academicYear.id,
    yearRId: yearR.id,
    year3Id: year3.id,
    year4Id: year4.id,
    classAId: classA.class.id,
    classBId: classB.class.id,
    houseId: house.house.id,
  };
}

async function inviteTeacher(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
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
  hdrs: ReturnType<typeof jsonHeaders>,
  input: {
    legalName: string;
    academicYearId: string;
    yearGroupId: string;
    classId?: string;
    houseId?: string;
    loginAlias?: string;
    password?: string;
    preferredName?: string;
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
  expect(created.status).toBe(201);
  const guardian = (await created.json()) as { invitationToken: string | null; guardianshipId: string };
  if (guardian.invitationToken) {
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: guardian.invitationToken,
        fullName: "Pat Parent",
        password: "parent-pass-1",
      }),
    });
  }
  return guardian;
}

describe("Phase 19 engagement", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("enforces assigned-only rewards, parent/student visibility, and internal note redaction", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(adminToken, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, id, structure.classAId);
    const pupilA = await createStudent(app, hdrs, {
      legalName: "Amelia Khan",
      preferredName: "Amelia",
      academicYearId: structure.yearId,
      yearGroupId: structure.year3Id,
      classId: structure.classAId,
      houseId: structure.houseId,
      loginAlias: `amelia-${id}`,
      password: "student-pass-1",
    });
    const pupilB = await createStudent(app, hdrs, {
      legalName: "Oliver Brooks",
      academicYearId: structure.yearId,
      yearGroupId: structure.year4Id,
      classId: structure.classBId,
    });
    await inviteParent(app, hdrs, pupilA.student.id, `parent-${id}@example.com`, true);

    const cats = (await (await app.request("/api/v1/reward-categories", { headers: hdrs })).json()) as {
      categories: Array<{ id: string; key: string }>;
    };
    const kindness = cats.categories.find((row) => row.key === "kindness")!;
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const teacherH = jsonHeaders(teacherToken, school.orgId);

    const awarded = await app.request("/api/v1/rewards", {
      method: "POST",
      headers: teacherH,
      body: JSON.stringify({
        studentProfileId: pupilA.student.id,
        categoryId: kindness.id,
        pupilMessage: "Well done Amelia",
        internalNote: "Pastoral follow-up after playground unkindness",
        points: 5,
      }),
    });
    expect(awarded.status).toBe(201);
    const awardBody = (await awarded.json()) as { reward: { id: string; internalNote: string } };
    expect(awardBody.reward.internalNote).toContain("Pastoral");

    const forbidden = await app.request("/api/v1/rewards", {
      method: "POST",
      headers: teacherH,
      body: JSON.stringify({ studentProfileId: pupilB.student.id, categoryId: kindness.id }),
    });
    expect(forbidden.status).toBe(404);

    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    const parentH = jsonHeaders(parentToken, school.orgId);
    const parentRewards = await app.request(`/api/v1/parent/children/${pupilA.student.id}/rewards`, {
      headers: parentH,
    });
    expect(parentRewards.status).toBe(200);
    const parentBody = await parentRewards.json();
    assertPortalSafe(parentBody);
    expect(JSON.stringify(parentBody)).not.toContain("Pastoral");
    expect(JSON.stringify(parentBody)).not.toContain("internalNote");

    const otherChild = await app.request(`/api/v1/parent/children/${pupilB.student.id}/rewards`, {
      headers: parentH,
    });
    expect(otherChild.status).toBe(404);

    const studentToken = await loginAlias(app, school.slug, `amelia-${id}`, "student-pass-1");
    const studentH = jsonHeaders(studentToken, school.orgId);
    const selfRewards = await app.request("/api/v1/student/rewards", { headers: studentH });
    expect(selfRewards.status).toBe(200);
    const selfBody = await selfRewards.json();
    assertPortalSafe(selfBody);
    expect(JSON.stringify(selfBody)).not.toContain("Pastoral");
    expect(JSON.stringify(selfBody)).toContain("Well done Amelia");
  });

  it("excludes revoked points, awards XP/achievements idempotently, and ignores client spoofing", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(adminToken, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Khan",
      academicYearId: structure.yearId,
      yearGroupId: structure.year3Id,
      classId: structure.classAId,
      loginAlias: `amelia-${id}`,
      password: "student-pass-1",
    });
    await app.request("/api/v1/engagement/settings", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ xpEnabled: true, rewardsEnabled: true }),
    });
    const xpCat = await app.request("/api/v1/reward-categories", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        key: "xp_praise",
        name: "XP Praise",
        defaultPoints: 7,
        grantsXp: true,
        defaultXp: 12,
      }),
    });
    expect(xpCat.status).toBe(201);
    const xpCategory = (await xpCat.json()) as { category: { id: string } };
    const first = await app.request("/api/v1/rewards", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ studentProfileId: pupil.student.id, categoryId: xpCategory.category.id, points: 7 }),
    });
    expect(first.status).toBe(201);
    const reward = (await first.json()) as { reward: { id: string } };
    const progress = (await (
      await app.request(`/api/v1/learning-practice/progress?studentId=${pupil.student.id}`, { headers: hdrs })
    ).json()) as { progress: { rewardPoints: number; xp: number | null } };
    expect(progress.progress.rewardPoints).toBe(7);
    expect(progress.progress.xp).toBe(12);
    const revoked = await app.request(`/api/v1/rewards/${reward.reward.id}/revoke`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ reason: "Entered on the wrong pupil" }),
    });
    expect(revoked.status).toBe(200);
    const after = (await (
      await app.request(`/api/v1/learning-practice/progress?studentId=${pupil.student.id}`, { headers: hdrs })
    ).json()) as { progress: { rewardPoints: number; xp: number | null } };
    expect(after.progress.rewardPoints).toBe(0);
    expect(after.progress.xp).toBe(0);

    const activity = await app.request("/api/v1/learning-activities", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Count the apples",
        activityType: "counting",
        xpReward: 10,
        items: [
          {
            promptText: "How many apples?",
            promptEmoji: "🍎🍎🍎🍎",
            itemType: "single_choice",
            choices: [
              { id: "3", label: "3" },
              { id: "4", label: "4" },
              { id: "5", label: "5" },
            ],
            correctAnswer: { choiceId: "4" },
          },
        ],
      }),
    });
    expect(activity.status).toBe(201);
    const created = (await activity.json()) as { activity: { id: string } };
    await app.request(`/api/v1/learning-activities/${created.activity.id}/publish`, {
      method: "POST",
      headers: hdrs,
    });
    const assignment = await app.request("/api/v1/learning-practice/assignments", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        activityId: created.activity.id,
        targets: [{ type: "student", studentId: pupil.student.id }],
      }),
    });
    const assigned = (await assignment.json()) as { assignment: { id: string } };
    await app.request(`/api/v1/learning-practice/assignments/${assigned.assignment.id}/publish`, {
      method: "POST",
      headers: hdrs,
    });

    const studentToken = await loginAlias(app, school.slug, `amelia-${id}`, "student-pass-1");
    const studentH = jsonHeaders(studentToken, school.orgId);
    const playable = await app.request(`/api/v1/student/practice/${assigned.assignment.id}`, { headers: studentH });
    expect(playable.status).toBe(200);
    const playBody = await playable.json();
    expect(JSON.stringify(playBody)).not.toContain("correctAnswer");
    expect(JSON.stringify(playBody)).not.toContain('"choiceId":"4"');

    const started = await app.request(`/api/v1/student/practice/${assigned.assignment.id}/start`, {
      method: "POST",
      headers: studentH,
      body: "{}",
    });
    expect(started.status).toBe(201);
    const attempt = (await started.json()) as { attemptId: string };
    const submit = await app.request(`/api/v1/student/practice/attempts/${attempt.attemptId}/submit`, {
      method: "POST",
      headers: studentH,
      body: JSON.stringify({
        answers: { [(playBody as { items: Array<{ id: string }> }).items[0]!.id]: { choiceId: "4" } },
        xpAwarded: 999,
        rewardPoints: 999,
        score: 99,
        achievementIds: ["spoof"],
      }),
    });
    expect(submit.status).toBe(200);
    const scored = (await submit.json()) as { score: number; maxScore: number; xpAwarded: number };
    expect(scored.score).toBe(1);
    expect(scored.maxScore).toBe(1);
    expect(scored.xpAwarded).toBe(10);

    const again = await app.request(`/api/v1/student/practice/attempts/${attempt.attemptId}/submit`, {
      method: "POST",
      headers: studentH,
      body: JSON.stringify({
        answers: { [(playBody as { items: Array<{ id: string }> }).items[0]!.id]: { choiceId: "4" } },
      }),
    });
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { xpAwarded: number };
    expect(againBody.xpAwarded).toBe(10);
    const summary = (await (await app.request("/api/v1/student/engagement", { headers: studentH })).json()) as {
      progress: { xp: number };
    };
    expect(summary.progress.xp).toBe(10);

    const selfAward = await app.request("/api/v1/rewards", {
      method: "POST",
      headers: studentH,
      body: JSON.stringify({ studentProfileId: pupil.student.id, categoryId: xpCategory.category.id }),
    });
    expect(selfAward.status).toBe(403);
  });

  it("blocks unpublished practice, withdrawn pupils, portal_access revocation, and foreign IDs", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const other = await createSchool(pools.owner, `${id}b`);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const hdrs = jsonHeaders(adminToken, school.orgId);
    const otherH = jsonHeaders(otherToken, other.orgId);
    const structure = await seedStructure(app, hdrs);
    const otherStructure = await seedStructure(app, otherH);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Khan",
      academicYearId: structure.yearId,
      yearGroupId: structure.year3Id,
      classId: structure.classAId,
      loginAlias: `amelia-${id}`,
      password: "student-pass-1",
    });
    const otherPupil = await createStudent(app, otherH, {
      legalName: "Oak Pupil",
      academicYearId: otherStructure.yearId,
      yearGroupId: otherStructure.year3Id,
      classId: otherStructure.classAId,
    });
    const parent = await inviteParent(app, hdrs, pupil.student.id, `parent-${id}@example.com`, true);
    const cats = (await (await app.request("/api/v1/reward-categories", { headers: hdrs })).json()) as {
      categories: Array<{ id: string }>;
    };
    const foreignReward = await app.request("/api/v1/rewards", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ studentProfileId: otherPupil.student.id, categoryId: cats.categories[0]!.id }),
    });
    expect(foreignReward.status).toBe(404);

    const draft = await app.request("/api/v1/learning-activities", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Draft only",
        activityType: "counting",
        items: [
          {
            promptText: "Hidden",
            itemType: "numeric",
            correctAnswer: { value: 1 },
          },
        ],
      }),
    });
    const draftBody = (await draft.json()) as { activity: { id: string } };
    const assignment = await app.request("/api/v1/learning-practice/assignments", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        activityId: draftBody.activity.id,
        targets: [{ type: "student", studentId: pupil.student.id }],
      }),
    });
    const assigned = (await assignment.json()) as { assignment: { id: string } };
    const publishAssign = await app.request(
      `/api/v1/learning-practice/assignments/${assigned.assignment.id}/publish`,
      { method: "POST", headers: hdrs },
    );
    expect(publishAssign.status).toBe(409);

    const studentToken = await loginAlias(app, school.slug, `amelia-${id}`, "student-pass-1");
    const studentH = jsonHeaders(studentToken, school.orgId);
    const unseen = await app.request(`/api/v1/student/practice/${assigned.assignment.id}`, { headers: studentH });
    expect(unseen.status).toBe(404);

    await pools.owner.query(
      `update student_enrolments set ended_on = started_on, status = 'withdrawn'
       where student_profile_id = $1`,
      [pupil.student.id],
    );
    const stale = await app.request("/api/v1/student/rewards", { headers: studentH });
    expect([403, 404]).toContain(stale.status);

    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    const parentH = jsonHeaders(parentToken, school.orgId);
    await pools.owner.query(`update guardianships set portal_access = false where id = $1`, [
      parent.guardianshipId,
    ]);
    const revoked = await app.request(`/api/v1/parent/children/${pupil.student.id}/rewards`, { headers: parentH });
    expect(revoked.status).toBe(404);
  });

  it("keeps leaderboards private, freezes completed results, and isolates competition targets", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(adminToken, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Khan",
      preferredName: "Amelia",
      academicYearId: structure.yearId,
      yearGroupId: structure.year3Id,
      classId: structure.classAId,
      houseId: structure.houseId,
      loginAlias: `amelia-${id}`,
      password: "student-pass-1",
    });
    const cats = (await (await app.request("/api/v1/reward-categories", { headers: hdrs })).json()) as {
      categories: Array<{ id: string }>;
    };
    await app.request("/api/v1/rewards", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ studentProfileId: pupil.student.id, categoryId: cats.categories[0]!.id, points: 8 }),
    });
    const competition = await app.request("/api/v1/competitions", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "House reading",
        competitionType: "house",
        scoringModel: "reward_points",
        targets: [{ type: "house", houseId: structure.houseId }],
      }),
    });
    expect(competition.status).toBe(201);
    const created = (await competition.json()) as { competition: { id: string } };
    await app.request(`/api/v1/competitions/${created.competition.id}/publish`, { method: "POST", headers: hdrs });

    const studentToken = await loginAlias(app, school.slug, `amelia-${id}`, "student-pass-1");
    const studentH = jsonHeaders(studentToken, school.orgId);
    const disabled = await app.request(`/api/v1/student/competitions/${created.competition.id}/leaderboard`, {
      headers: studentH,
    });
    expect(disabled.status).toBe(200);
    const disabledBody = (await disabled.json()) as { enabled: boolean; reason?: string };
    expect(disabledBody.enabled).toBe(false);

    await app.request("/api/v1/engagement/settings", {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({
        leaderboardsEnabled: true,
        allowHouseLeaderboard: true,
        allowIndividualLeaderboard: false,
        anonymisePupilLeaderboard: true,
      }),
    });
    const houseBoard = await app.request(`/api/v1/student/competitions/${created.competition.id}/leaderboard`, {
      headers: studentH,
    });
    const houseBody = (await houseBoard.json()) as {
      enabled: boolean;
      entries: Array<{ displayName: string; entryType: string }>;
    };
    expect(houseBody.enabled).toBe(true);
    expect(houseBody.entries[0]?.entryType).toBe("house");
    expect(JSON.stringify(houseBody)).not.toContain("Khan");

    const named = await app.request("/api/v1/competitions", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Named race",
        competitionType: "individual",
        scoringModel: "reward_points",
        targets: [{ type: "whole_school" }],
      }),
    });
    const namedComp = (await named.json()) as { competition: { id: string } };
    const stillOff = await app.request(`/api/v1/student/competitions/${namedComp.competition.id}/leaderboard?scope=individual`, {
      headers: studentH,
    });
    const stillOffBody = (await stillOff.json()) as { enabled: boolean };
    expect(stillOffBody.enabled).toBe(false);

    await app.request(`/api/v1/competitions/${created.competition.id}/complete`, { method: "POST", headers: hdrs });
    await app.request("/api/v1/rewards", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ studentProfileId: pupil.student.id, categoryId: cats.categories[0]!.id, points: 50 }),
    });
    const frozen = await app.request(`/api/v1/competitions/${created.competition.id}/leaderboard`, { headers: hdrs });
    const frozenBody = (await frozen.json()) as { entries: Array<{ score: number }> };
    expect(frozenBody.entries[0]?.score).toBe(8);

    const other = await createSchool(pools.owner, `${id}x`);
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const otherH = jsonHeaders(otherToken, other.orgId);
    const otherStructure = await seedStructure(app, otherH);
    const cross = await app.request("/api/v1/competitions", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Cross school",
        competitionType: "class",
        scoringModel: "reward_points",
        targets: [{ type: "class", classId: otherStructure.classAId }],
      }),
    });
    expect(cross.status).toBe(400);

    const platform = await insertUser(pools.owner, {
      email: `plat-${id}@example.com`,
      password: "password-12x",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    const platformToken = await login(app, `plat-${id}@example.com`, "password-12x");
    const platformBrowse = await app.request("/api/v1/rewards", {
      headers: jsonHeaders(platformToken, school.orgId),
    });
    expect([401, 403]).toContain(platformBrowse.status);
    expect(platform).toBeTruthy();
  });

  it("records parent-assisted attempts and year-group policy without hard-coded age bans", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(adminToken, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const recClass = (await (
      await app.request("/api/v1/classes", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          name: "Reception",
          academicYearId: structure.yearId,
          yearGroupId: structure.yearRId,
          classType: "form",
        }),
      })
    ).json()) as { class: { id: string } };
    const child = await createStudent(app, hdrs, {
      legalName: "Leo Patel",
      academicYearId: structure.yearId,
      yearGroupId: structure.yearRId,
      classId: recClass.class.id,
      loginAlias: `leo-${id}`,
      password: "student-pass-1",
    });
    await inviteParent(app, hdrs, child.student.id, `parent-r-${id}@example.com`, true);
    await app.request(`/api/v1/engagement/year-groups/${structure.yearRId}`, {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        earlyLearningEnabled: true,
        parentAssistedMode: true,
        rewardsEnabled: true,
        leaderboardsEnabled: false,
        childFriendlyUi: true,
      }),
    });
    const activity = await app.request("/api/v1/learning-activities", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Count the apples",
        activityType: "counting",
        xpReward: 5,
        items: [
          {
            promptText: "How many apples?",
            itemType: "single_choice",
            choices: [
              { id: "3", label: "3" },
              { id: "4", label: "4" },
            ],
            correctAnswer: { choiceId: "4" },
          },
        ],
      }),
    });
    const created = (await activity.json()) as { activity: { id: string } };
    await app.request(`/api/v1/learning-activities/${created.activity.id}/publish`, { method: "POST", headers: hdrs });
    const assignment = await app.request("/api/v1/learning-practice/assignments", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        activityId: created.activity.id,
        targets: [{ type: "class", classId: recClass.class.id }],
      }),
    });
    const assigned = (await assignment.json()) as { assignment: { id: string } };
    await app.request(`/api/v1/learning-practice/assignments/${assigned.assignment.id}/publish`, {
      method: "POST",
      headers: hdrs,
    });
    const parentToken = await login(app, `parent-r-${id}@example.com`, "parent-pass-1");
    const parentH = jsonHeaders(parentToken, school.orgId);
    const started = await app.request(
      `/api/v1/parent/children/${child.student.id}/practice/${assigned.assignment.id}/start`,
      { method: "POST", headers: parentH, body: "{}" },
    );
    expect(started.status).toBe(201);
    const attempt = (await started.json()) as { attemptId: string };
    const studentToken = await loginAlias(app, school.slug, `leo-${id}`, "student-pass-1");
    const studentH = jsonHeaders(studentToken, school.orgId);
    const studentStart = await app.request(`/api/v1/student/practice/${assigned.assignment.id}/start`, {
      method: "POST",
      headers: studentH,
      body: "{}",
    });
    expect(studentStart.status).toBe(201);
    const studentAttempt = (await studentStart.json()) as { attemptId: string; resumed: boolean };
    expect(studentAttempt.attemptId).not.toBe(attempt.attemptId);
    expect(studentAttempt.resumed).toBe(false);
    const hijack = await app.request(
      `/api/v1/parent/children/${child.student.id}/practice/attempts/${studentAttempt.attemptId}/submit`,
      { method: "POST", headers: parentH, body: JSON.stringify({ answers: {} }) },
    );
    expect(hijack.status).toBe(404);
    const item = (await (
      await app.request(`/api/v1/parent/children/${child.student.id}/practice/${assigned.assignment.id}`, {
        headers: parentH,
      })
    ).json()) as { items: Array<{ id: string }> };
    const submitted = await app.request(
      `/api/v1/parent/children/${child.student.id}/practice/attempts/${attempt.attemptId}/submit`,
      {
        method: "POST",
        headers: parentH,
        body: JSON.stringify({ answers: { [item.items[0]!.id]: { choiceId: "4" } } }),
      },
    );
    expect(submitted.status).toBe(200);
    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const row = await client.query<{ channel: string }>(
        `select channel from learning_activity_attempts where id = $1`,
        [attempt.attemptId],
      );
      expect(row.rows[0]?.channel).toBe("parent_assisted");
      const studentRow = await client.query<{ channel: string }>(
        `select channel from learning_activity_attempts where id = $1`,
        [studentAttempt.attemptId],
      );
      expect(studentRow.rows[0]?.channel).toBe("student");
    });
  });

  it("hides early-learning practice when year-group policy is challenges-only and blocks unaided parent play", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const adminToken = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(adminToken, school.orgId);
    const structure = await seedStructure(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Year Three",
      academicYearId: structure.yearId,
      yearGroupId: structure.year3Id,
      classId: structure.classAId,
      loginAlias: `y3-${id}`,
      password: "student-pass-1",
    });
    await inviteParent(app, hdrs, pupil.student.id, `parent-y3-${id}@example.com`, true);
    await app.request(`/api/v1/engagement/year-groups/${structure.year3Id}`, {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        earlyLearningEnabled: false,
        learningChallengesEnabled: true,
        parentAssistedMode: false,
        childFriendlyUi: false,
      }),
    });
    const counting = await app.request("/api/v1/learning-activities", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Count the apples",
        activityType: "counting",
        items: [
          {
            promptText: "How many?",
            itemType: "single_choice",
            choices: [
              { id: "3", label: "3" },
              { id: "4", label: "4" },
            ],
            correctAnswer: { choiceId: "4" },
          },
        ],
      }),
    });
    const countingCreated = (await counting.json()) as { activity: { id: string } };
    await app.request(`/api/v1/learning-activities/${countingCreated.activity.id}/publish`, {
      method: "POST",
      headers: hdrs,
    });
    const countingAssignment = await app.request("/api/v1/learning-practice/assignments", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        activityId: countingCreated.activity.id,
        targets: [{ type: "class", classId: structure.classAId }],
      }),
    });
    const countingAssigned = (await countingAssignment.json()) as { assignment: { id: string } };
    await app.request(`/api/v1/learning-practice/assignments/${countingAssigned.assignment.id}/publish`, {
      method: "POST",
      headers: hdrs,
    });
    const challenge = await app.request("/api/v1/learning-activities", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        title: "Times tables",
        activityType: "challenge",
        items: [
          {
            promptText: "2 x 3",
            itemType: "single_choice",
            choices: [
              { id: "5", label: "5" },
              { id: "6", label: "6" },
            ],
            correctAnswer: { choiceId: "6" },
          },
        ],
      }),
    });
    const challengeCreated = (await challenge.json()) as { activity: { id: string } };
    await app.request(`/api/v1/learning-activities/${challengeCreated.activity.id}/publish`, {
      method: "POST",
      headers: hdrs,
    });
    const challengeAssignment = await app.request("/api/v1/learning-practice/assignments", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        activityId: challengeCreated.activity.id,
        targets: [{ type: "class", classId: structure.classAId }],
      }),
    });
    const challengeAssigned = (await challengeAssignment.json()) as { assignment: { id: string } };
    await app.request(`/api/v1/learning-practice/assignments/${challengeAssigned.assignment.id}/publish`, {
      method: "POST",
      headers: hdrs,
    });

    const studentToken = await loginAlias(app, school.slug, `y3-${id}`, "student-pass-1");
    const studentH = jsonHeaders(studentToken, school.orgId);
    const listed = (await (await app.request("/api/v1/student/practice", { headers: studentH })).json()) as {
      practice: Array<{ assignmentId: string; activityType: string }>;
    };
    expect(listed.practice.map((row) => row.activityType)).toEqual(["challenge"]);
    const hidden = await app.request(`/api/v1/student/practice/${countingAssigned.assignment.id}`, {
      headers: studentH,
    });
    expect(hidden.status).toBe(404);
    const visible = await app.request(`/api/v1/student/practice/${challengeAssigned.assignment.id}`, {
      headers: studentH,
    });
    expect(visible.status).toBe(200);

    const parentToken = await login(app, `parent-y3-${id}@example.com`, "parent-pass-1");
    const parentH = jsonHeaders(parentToken, school.orgId);
    const parentPlay = await app.request(
      `/api/v1/parent/children/${pupil.student.id}/practice/${challengeAssigned.assignment.id}`,
      { headers: parentH },
    );
    expect(parentPlay.status).toBe(403);
    const parentList = (await (
      await app.request(`/api/v1/parent/children/${pupil.student.id}/practice`, { headers: parentH })
    ).json()) as { practice: unknown[]; parentAssistedMode: boolean };
    expect(parentList.practice).toEqual([]);
    expect(parentList.parentAssistedMode).toBe(false);
  });
});
