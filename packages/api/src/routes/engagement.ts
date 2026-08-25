import { z } from "zod";
import { PERMISSIONS } from "@schoolapp/domain";
import {
  AppError,
  assignedStudentIds,
  assignedClassIds,
  canAwardAssignedRewards,
  canAwardSchoolRewards,
  canManageAchievements,
  canManageAssignedPractice,
  canManageCompetitions,
  canManageEngagementSettings,
  canManageRewards,
  canManageSchoolCompetitions,
  canManageSchoolPractice,
  canReadEngagementSettings,
  canReadSchoolCompetitions,
  canReadSchoolPractice,
  canReadSchoolRewards,
  DEFAULT_ENGAGEMENT_SETTINGS,
  ensureEngagementDefaults,
  isCompetitionStatusTransitionAllowed,
  loadEffectiveEngagementPolicy,
  loadEngagementSettings,
  loadPupilYearGroupId,
  notFound,
  parsePracticeItems,
  writeAudit,
  type CompetitionStatus,
  type LeaderboardDisplayPolicy,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import {
  awardReward,
  assertStaffAchievementRead,
  assertStaffPracticeRead,
  buildLeaderboard,
  competitionTargetStudentIds,
  freezeCompetitionResults,
  listRewardsForStudent,
  mapAchievementDefinition,
  mapCompetition,
  mapLearningActivityDefinition,
  mapRewardCategory,
  pupilProgressSummary,
  revokeReward,
  snapshotPracticeRecipients,
} from "../engagement-service";
import { mapPupilAchievement, mapPupilReward } from "../serialize";

const settingsSchema = z.object({
  rewardsEnabled: z.boolean().optional(),
  achievementsEnabled: z.boolean().optional(),
  competitionsEnabled: z.boolean().optional(),
  leaderboardsEnabled: z.boolean().optional(),
  earlyLearningEnabled: z.boolean().optional(),
  xpEnabled: z.boolean().optional(),
  studentVisiblePoints: z.boolean().optional(),
  parentVisiblePoints: z.boolean().optional(),
  allowIndividualLeaderboard: z.boolean().optional(),
  allowClassLeaderboard: z.boolean().optional(),
  allowHouseLeaderboard: z.boolean().optional(),
  anonymisePupilLeaderboard: z.boolean().optional(),
  leaderboardDisplayNamePolicy: z
    .enum(["first_name_initial", "first_name", "anonymous_alias", "rank_only"])
    .optional(),
  grantRewardPointsOnLearning: z.boolean().optional(),
});

const yearPolicySchema = z.object({
  rewardsEnabled: z.boolean().nullable().optional(),
  achievementsEnabled: z.boolean().nullable().optional(),
  competitionsEnabled: z.boolean().nullable().optional(),
  leaderboardsEnabled: z.boolean().nullable().optional(),
  earlyLearningEnabled: z.boolean().nullable().optional(),
  learningChallengesEnabled: z.boolean().nullable().optional(),
  parentAssistedMode: z.boolean().nullable().optional(),
  childFriendlyUi: z.boolean().nullable().optional(),
  xpEnabled: z.boolean().nullable().optional(),
  studentVisiblePoints: z.boolean().nullable().optional(),
  parentVisiblePoints: z.boolean().nullable().optional(),
});

const awardSchema = z.object({
  studentProfileId: z.string().uuid(),
  categoryId: z.string().uuid(),
  title: z.string().max(120).optional(),
  pupilMessage: z.string().max(500).nullable().optional(),
  internalNote: z.string().max(2000).nullable().optional(),
  points: z.number().int().min(0).nullable().optional(),
  subjectId: z.string().uuid().nullable().optional(),
  classId: z.string().uuid().nullable().optional(),
  studentVisible: z.boolean().optional(),
  parentVisible: z.boolean().optional(),
  xpAwarded: z.unknown().optional(),
  achievementIds: z.unknown().optional(),
});

const bulkAwardSchema = z.object({
  studentProfileIds: z.array(z.string().uuid()).min(1).max(40),
  categoryId: z.string().uuid(),
  title: z.string().max(120).optional(),
  pupilMessage: z.string().max(500).nullable().optional(),
  internalNote: z.string().max(2000).nullable().optional(),
  points: z.number().int().min(0).nullable().optional(),
});

function serializeSettings(settings: Awaited<ReturnType<typeof loadEngagementSettings>>) {
  return {
    ...settings,
    futureAi: {
      generationEnabled: false,
      workflow: "Teacher drafts remain draft until reviewed and published. AI generation is not implemented.",
    },
  };
}

export function registerEngagementRoutes(app: SchoolappApi) {
  app.get("/engagement/settings", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadEngagementSettings(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const settings = await loadEngagementSettings(client, orgId);
      const yearGroups = await client.query(
        `select yg.id, yg.code, yg.name, p.*
         from year_groups yg
         left join engagement_year_group_policies p
           on p.year_group_id = yg.id and p.organisation_id = yg.organisation_id
         where yg.organisation_id = $1
         order by yg.sort_order, yg.code`,
        [orgId],
      );
      return c.json({
        settings: serializeSettings(settings),
        yearGroups: yearGroups.rows.map((row) => ({
          yearGroupId: row.id,
          code: row.code,
          name: row.name,
          policy: {
            rewardsEnabled: row.rewards_enabled ?? null,
            achievementsEnabled: row.achievements_enabled ?? null,
            competitionsEnabled: row.competitions_enabled ?? null,
            leaderboardsEnabled: row.leaderboards_enabled ?? null,
            earlyLearningEnabled: row.early_learning_enabled ?? null,
            learningChallengesEnabled: row.learning_challenges_enabled ?? null,
            parentAssistedMode: row.parent_assisted_mode ?? null,
            childFriendlyUi: row.child_friendly_ui ?? null,
            xpEnabled: row.xp_enabled ?? null,
            studentVisiblePoints: row.student_visible_points ?? null,
            parentVisiblePoints: row.parent_visible_points ?? null,
          },
        })),
      });
    }),
  );

  app.patch("/engagement/settings", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageEngagementSettings(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = settingsSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid settings");
      await ensureEngagementDefaults(client, orgId);
      const before = await loadEngagementSettings(client, orgId);
      const next = { ...before, ...parsed.data };
      await client.query(
        `update engagement_settings set
           rewards_enabled = $2, achievements_enabled = $3, competitions_enabled = $4,
           leaderboards_enabled = $5, early_learning_enabled = $6, xp_enabled = $7,
           student_visible_points = $8, parent_visible_points = $9,
           allow_individual_leaderboard = $10, allow_class_leaderboard = $11,
           allow_house_leaderboard = $12, anonymise_pupil_leaderboard = $13,
           leaderboard_display_name_policy = $14, grant_reward_points_on_learning = $15,
           updated_by = $16
         where organisation_id = $1`,
        [
          orgId,
          next.rewardsEnabled,
          next.achievementsEnabled,
          next.competitionsEnabled,
          next.leaderboardsEnabled,
          next.earlyLearningEnabled,
          next.xpEnabled,
          next.studentVisiblePoints,
          next.parentVisiblePoints,
          next.allowIndividualLeaderboard,
          next.allowClassLeaderboard,
          next.allowHouseLeaderboard,
          next.anonymisePupilLeaderboard,
          next.leaderboardDisplayNamePolicy,
          next.grantRewardPointsOnLearning,
          userId,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "engagement.settings.update",
        entityType: "engagement_settings",
        entityId: orgId,
        before,
        after: next,
      });
      return c.json({ settings: serializeSettings(next) });
    }),
  );

  app.put("/engagement/year-groups/:yearGroupId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageEngagementSettings(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const yearGroupId = uuidRouteParam(c, "yearGroupId");
      const parsed = yearPolicySchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid year-group policy");
      const yg = await client.query(`select id from year_groups where id = $1 and organisation_id = $2`, [
        yearGroupId,
        orgId,
      ]);
      if (!yg.rows[0]) notFound();
      await client.query(
        `insert into engagement_year_group_policies (
           organisation_id, year_group_id, rewards_enabled, achievements_enabled, competitions_enabled,
           leaderboards_enabled, early_learning_enabled, learning_challenges_enabled, parent_assisted_mode,
           child_friendly_ui, xp_enabled, student_visible_points, parent_visible_points, updated_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (year_group_id) do update set
           rewards_enabled = excluded.rewards_enabled,
           achievements_enabled = excluded.achievements_enabled,
           competitions_enabled = excluded.competitions_enabled,
           leaderboards_enabled = excluded.leaderboards_enabled,
           early_learning_enabled = excluded.early_learning_enabled,
           learning_challenges_enabled = excluded.learning_challenges_enabled,
           parent_assisted_mode = excluded.parent_assisted_mode,
           child_friendly_ui = excluded.child_friendly_ui,
           xp_enabled = excluded.xp_enabled,
           student_visible_points = excluded.student_visible_points,
           parent_visible_points = excluded.parent_visible_points,
           updated_by = excluded.updated_by,
           updated_at = now()`,
        [
          orgId,
          yearGroupId,
          parsed.data.rewardsEnabled ?? null,
          parsed.data.achievementsEnabled ?? null,
          parsed.data.competitionsEnabled ?? null,
          parsed.data.leaderboardsEnabled ?? null,
          parsed.data.earlyLearningEnabled ?? null,
          parsed.data.learningChallengesEnabled ?? null,
          parsed.data.parentAssistedMode ?? null,
          parsed.data.childFriendlyUi ?? null,
          parsed.data.xpEnabled ?? null,
          parsed.data.studentVisiblePoints ?? null,
          parsed.data.parentVisiblePoints ?? null,
          userId,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "engagement.year_group_policy.update",
        entityType: "engagement_year_group_policy",
        entityId: yearGroupId,
        after: parsed.data,
      });
      return c.json({ yearGroupId, policy: parsed.data });
    }),
  );

  app.get("/engagement/overview", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadEngagementSettings(actor) && !canAwardAssignedRewards(actor) && !canReadSchoolRewards(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const settings = await loadEngagementSettings(client, orgId);
      const schoolWide = canReadSchoolRewards(actor) || canAwardSchoolRewards(actor);
      const assigned = schoolWide ? null : await assignedStudentIds(client, actor.userId, orgId);
      const recent = await client.query(
        `select r.*, c.name as category_name, sp.legal_name as student_name, u.full_name as awarded_by_name
         from pupil_rewards r
         join reward_categories c on c.id = r.category_id
         join student_profiles sp on sp.id = r.student_profile_id
         left join users u on u.id = r.awarded_by
         where r.organisation_id = $1 and r.status = 'active'
         order by r.awarded_at desc
         limit 20`,
        [orgId],
      );
      const rows = assigned
        ? recent.rows.filter((row) => assigned.has(row.student_profile_id))
        : recent.rows;
      return c.json({
        settings: serializeSettings(settings),
        recentRewards: rows.map((row) => mapPupilReward(row, "staff")),
        defaults: DEFAULT_ENGAGEMENT_SETTINGS,
      });
    }),
  );

  app.get("/reward-categories", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadSchoolRewards(actor) && !canAwardAssignedRewards(actor) && !canAwardSchoolRewards(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      await ensureEngagementDefaults(client, orgId);
      const rows = await client.query(
        `select * from reward_categories where organisation_id = $1 order by sort_order, name`,
        [orgId],
      );
      return c.json({ categories: rows.rows.map(mapRewardCategory) });
    }),
  );

  app.post("/reward-categories", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canManageRewards(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          key: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/),
          name: z.string().min(1).max(80),
          defaultPoints: z.number().int().min(0).optional(),
          grantsXp: z.boolean().optional(),
          defaultXp: z.number().int().min(0).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid category");
      const inserted = await client.query(
        `insert into reward_categories (
           organisation_id, key, name, default_points, grants_xp, default_xp, is_system
         ) values ($1,$2,$3,$4,$5,$6,false)
         returning *`,
        [
          orgId,
          parsed.data.key,
          parsed.data.name,
          parsed.data.defaultPoints ?? 0,
          parsed.data.grantsXp ?? false,
          parsed.data.defaultXp ?? 0,
        ],
      );
      return c.json({ category: mapRewardCategory(inserted.rows[0]!) }, 201);
    }),
  );

  app.get("/rewards", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadSchoolRewards(actor) && !canAwardAssignedRewards(actor) && !canAwardSchoolRewards(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const studentId = c.req.query("studentId");
      const schoolWide = canReadSchoolRewards(actor) || canAwardSchoolRewards(actor);
      const assigned = schoolWide ? null : await assignedStudentIds(client, actor.userId, orgId);
      if (studentId) {
        if (assigned && !assigned.has(studentId)) notFound();
        const yearGroupId = await loadPupilYearGroupId(client, orgId, studentId);
        const policy = await loadEffectiveEngagementPolicy(client, orgId, yearGroupId);
        const rewards = await listRewardsForStudent({
          client,
          organisationId: orgId,
          studentProfileId: studentId,
          audience: "staff",
          policy,
        });
        return c.json({ rewards });
      }
      const rows = await client.query(
        `select r.*, c.name as category_name, sp.legal_name as student_name, u.full_name as awarded_by_name
         from pupil_rewards r
         join reward_categories c on c.id = r.category_id
         join student_profiles sp on sp.id = r.student_profile_id
         left join users u on u.id = r.awarded_by
         where r.organisation_id = $1
         order by r.awarded_at desc
         limit 100`,
        [orgId],
      );
      const filtered = assigned ? rows.rows.filter((row) => assigned.has(row.student_profile_id)) : rows.rows;
      return c.json({ rewards: filtered.map((row) => mapPupilReward(row, "staff")) });
    }),
  );

  app.post("/rewards", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canAwardSchoolRewards(actor) && !canAwardAssignedRewards(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const parsed = awardSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid reward");
      if (!canAwardSchoolRewards(actor)) {
        const assigned = await assignedStudentIds(client, actor.userId, orgId);
        if (!assigned.has(parsed.data.studentProfileId)) notFound();
      }
      const reward = await awardReward({
        client,
        actor,
        organisationId: orgId,
        studentProfileId: parsed.data.studentProfileId,
        categoryId: parsed.data.categoryId,
        title: parsed.data.title,
        pupilMessage: parsed.data.pupilMessage,
        internalNote: parsed.data.internalNote,
        points: parsed.data.points,
        subjectId: parsed.data.subjectId,
        classId: parsed.data.classId,
        studentVisible: parsed.data.studentVisible,
        parentVisible: parsed.data.parentVisible,
      });
      return c.json({ reward }, 201);
    }),
  );

  app.post("/rewards/bulk", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canAwardSchoolRewards(actor) && !canAwardAssignedRewards(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const parsed = bulkAwardSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid bulk reward");
      const assigned = canAwardSchoolRewards(actor)
        ? null
        : await assignedStudentIds(client, actor.userId, orgId);
      const rewards = [];
      for (const studentProfileId of parsed.data.studentProfileIds) {
        if (assigned && !assigned.has(studentProfileId)) notFound();
        rewards.push(
          await awardReward({
            client,
            actor,
            organisationId: orgId,
            studentProfileId,
            categoryId: parsed.data.categoryId,
            title: parsed.data.title,
            pupilMessage: parsed.data.pupilMessage,
            internalNote: parsed.data.internalNote,
            points: parsed.data.points,
            sourceType: "bulk",
          }),
        );
      }
      return c.json({ rewards }, 201);
    }),
  );

  app.post("/rewards/:id/revoke", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canManageRewards(actor) && !canAwardSchoolRewards(actor) && !canAwardAssignedRewards(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const parsed = z.object({ reason: z.string().min(3).max(500) }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "A reason is required");
      await revokeReward({
        client,
        actor,
        organisationId: orgId,
        rewardId: uuidRouteParam(c, "id"),
        reason: parsed.data.reason,
      });
      return c.json({ ok: true });
    }),
  );

  app.get("/achievements/definitions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertStaffAchievementRead(actor);
      await ensureEngagementDefaults(client, orgId);
      const rows = await client.query(
        `select * from achievement_definitions where organisation_id = $1 order by sort_order, title`,
        [orgId],
      );
      return c.json({ definitions: rows.rows.map(mapAchievementDefinition) });
    }),
  );

  app.post("/achievements/definitions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageAchievements(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          key: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/),
          title: z.string().min(1).max(80),
          description: z.string().max(400).optional(),
          iconKey: z.string().max(40).optional(),
          criteriaType: z.enum([
            "manual",
            "assignment_count",
            "assignment_completed_count",
            "reward_points_total",
            "xp_total",
            "attendance_percentage",
            "attendance_streak",
            "learning_activity_count",
            "challenge_completed_count",
          ]),
          threshold: z.number().int().min(0).nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid achievement");
      const inserted = await client.query(
        `insert into achievement_definitions (
           organisation_id, key, title, description, icon_key, criteria_type, threshold
         ) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [
          orgId,
          parsed.data.key,
          parsed.data.title,
          parsed.data.description ?? null,
          parsed.data.iconKey ?? null,
          parsed.data.criteriaType,
          parsed.data.threshold ?? null,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "engagement.achievement.define",
        entityType: "achievement_definition",
        entityId: inserted.rows[0]!.id,
        after: parsed.data,
      });
      return c.json({ definition: mapAchievementDefinition(inserted.rows[0]!) }, 201);
    }),
  );

  app.post("/achievements/award", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageAchievements(actor) && !actor.permissions.has(PERMISSIONS.ACHIEVEMENTS_AWARD_ASSIGNED)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const parsed = z
        .object({
          studentProfileId: z.string().uuid(),
          definitionId: z.string().uuid(),
          note: z.string().max(500).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid award");
      if (!canManageAchievements(actor)) {
        const assigned = await assignedStudentIds(client, actor.userId, orgId);
        if (!assigned.has(parsed.data.studentProfileId)) notFound();
      }
      const def = await client.query(
        `select * from achievement_definitions where id = $1 and organisation_id = $2`,
        [parsed.data.definitionId, orgId],
      );
      if (!def.rows[0]) notFound();
      const yearGroupId = await loadPupilYearGroupId(client, orgId, parsed.data.studentProfileId);
      const policy = await loadEffectiveEngagementPolicy(client, orgId, yearGroupId);
      if (!policy.achievementsEnabled) {
        throw new AppError(403, "forbidden", "Achievements are disabled for this year group");
      }
      const inserted = await client.query(
        `insert into pupil_achievements (
           organisation_id, student_profile_id, definition_id, awarded_by, source, note
         ) values ($1,$2,$3,$4,'manual',$5)
         on conflict (organisation_id, student_profile_id, definition_id) do nothing
         returning *`,
        [orgId, parsed.data.studentProfileId, parsed.data.definitionId, userId, parsed.data.note ?? null],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "engagement.achievement.award",
        entityType: "pupil_achievement",
        entityId: inserted.rows[0]?.id ?? parsed.data.definitionId,
        after: { studentProfileId: parsed.data.studentProfileId, definitionId: parsed.data.definitionId },
      });
      return c.json({ achievement: inserted.rows[0] ? mapPupilAchievement(inserted.rows[0], "staff") : null }, 201);
    }),
  );

  app.get("/achievements", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertStaffAchievementRead(actor);
      const studentId = c.req.query("studentId");
      if (!studentId) throw new AppError(400, "validation_failed", "studentId is required");
      if (!canManageAchievements(actor) && !actor.permissions.has(PERMISSIONS.ACHIEVEMENTS_READ)) {
        const assigned = await assignedStudentIds(client, actor.userId, orgId);
        if (!assigned.has(studentId)) notFound();
      }
      const rows = await client.query(
        `select pa.*, d.key as definition_key, d.title, d.description, d.icon_key, sp.legal_name as student_name
         from pupil_achievements pa
         join achievement_definitions d on d.id = pa.definition_id
         join student_profiles sp on sp.id = pa.student_profile_id
         where pa.organisation_id = $1 and pa.student_profile_id = $2
         order by pa.awarded_at desc`,
        [orgId, studentId],
      );
      return c.json({ achievements: rows.rows.map((row) => mapPupilAchievement(row, "staff")) });
    }),
  );

  app.get("/competitions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canManageCompetitions(actor) && !canReadSchoolCompetitions(actor) && !actor.permissions.has(PERMISSIONS.COMPETITIONS_READ_ASSIGNED)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const rows = await client.query(
        `select * from competitions where organisation_id = $1 order by created_at desc`,
        [orgId],
      );
      return c.json({ competitions: rows.rows.map(mapCompetition) });
    }),
  );

  app.post("/competitions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageCompetitions(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          title: z.string().min(1).max(120),
          description: z.string().max(2000).optional(),
          competitionType: z.enum(["individual", "class", "house", "year_group", "school"]),
          scoringModel: z.enum([
            "reward_points",
            "xp",
            "completed_learning_activities",
            "teacher_score",
            "quiz_score",
            "attendance",
          ]),
          startsAt: z.string().datetime().optional(),
          endsAt: z.string().datetime().optional(),
          studentVisible: z.boolean().optional(),
          parentVisible: z.boolean().optional(),
          staffOnly: z.boolean().optional(),
          academicYearId: z.string().uuid().optional(),
          targets: z
            .array(
              z.object({
                type: z.enum(["whole_school", "year_group", "class", "student", "house"]),
                yearGroupId: z.string().uuid().optional(),
                classId: z.string().uuid().optional(),
                studentId: z.string().uuid().optional(),
                houseId: z.string().uuid().optional(),
              }),
            )
            .optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid competition");
      const targets = [...(parsed.data.targets ?? [])];
      if (targets.length === 0) {
        if (!canManageSchoolCompetitions(actor)) {
          throw new AppError(400, "validation_failed", "Assigned staff must set class, house, or pupil targets");
        }
        targets.push({ type: "whole_school" });
      }
      if (
        (parsed.data.competitionType === "school" ||
          targets.some((t) => t.type === "whole_school" || t.type === "year_group")) &&
        !canManageSchoolCompetitions(actor)
      ) {
        throw new AppError(403, "forbidden", "School-wide competitions require school manage");
      }
      if (!canManageSchoolCompetitions(actor)) {
        const assignedPupils = await assignedStudentIds(client, actor.userId, orgId);
        const assignedClasses = await assignedClassIds(client, actor.userId, orgId);
        for (const target of targets) {
          if (target.type === "class") {
            if (!target.classId || !assignedClasses.has(target.classId)) notFound();
          }
          if (target.type === "student") {
            if (!target.studentId || !assignedPupils.has(target.studentId)) notFound();
          }
        }
      }
      const inserted = await client.query(
        `insert into competitions (
           organisation_id, academic_year_id, title, description, competition_type, scoring_model,
           starts_at, ends_at, student_visible, parent_visible, staff_only, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         returning *`,
        [
          orgId,
          parsed.data.academicYearId ?? null,
          parsed.data.title,
          parsed.data.description ?? null,
          parsed.data.competitionType,
          parsed.data.scoringModel,
          parsed.data.startsAt ?? null,
          parsed.data.endsAt ?? null,
          parsed.data.studentVisible ?? true,
          parsed.data.parentVisible ?? true,
          parsed.data.staffOnly ?? false,
          userId,
        ],
      );
      for (const target of targets) {
        await client.query(
          `insert into competition_targets (
             organisation_id, competition_id, target_type, year_group_id, class_id, student_profile_id, house_id
           ) values ($1,$2,$3,$4,$5,$6,$7)`,
          [
            orgId,
            inserted.rows[0]!.id,
            target.type,
            target.yearGroupId ?? null,
            target.classId ?? null,
            target.studentId ?? null,
            target.houseId ?? null,
          ],
        );
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "engagement.competition.create",
        entityType: "competition",
        entityId: inserted.rows[0]!.id,
        after: { title: parsed.data.title, type: parsed.data.competitionType },
      });
      return c.json({ competition: mapCompetition(inserted.rows[0]!) }, 201);
    }),
  );

  app.get("/competitions/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canManageCompetitions(actor) && !canReadSchoolCompetitions(actor) && !actor.permissions.has(PERMISSIONS.COMPETITIONS_READ_ASSIGNED)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const id = uuidRouteParam(c, "id");
      const row = await client.query(`select * from competitions where id = $1 and organisation_id = $2`, [id, orgId]);
      if (!row.rows[0]) notFound();
      const targets = await client.query(`select * from competition_targets where competition_id = $1`, [id]);
      const policy = await loadEffectiveEngagementPolicy(client, orgId, null);
      const leaderboard = await buildLeaderboard({
        client,
        organisationId: orgId,
        competitionId: id,
        audience: "staff",
        policy,
      });
      if (
        leaderboard.competition?.competitionType === "individual" &&
        !canReadSchoolCompetitions(actor) &&
        !canManageSchoolCompetitions(actor)
      ) {
        return c.json({
          competition: mapCompetition(row.rows[0]),
          targets: targets.rows,
          leaderboard: { enabled: false, reason: "assigned_scope", entries: [] },
        });
      }
      return c.json({ competition: mapCompetition(row.rows[0]), targets: targets.rows, leaderboard });
    }),
  );

  app.post("/competitions/:id/publish", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageCompetitions(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      const existing = await client.query<{ status: CompetitionStatus; created_by: string }>(
        `select status, created_by from competitions where id = $1 and organisation_id = $2`,
        [id, orgId],
      );
      if (!existing.rows[0]) notFound();
      if (!canManageSchoolCompetitions(actor) && existing.rows[0].created_by !== actor.userId) notFound();
      if (!isCompetitionStatusTransitionAllowed(existing.rows[0].status, "published")) {
        throw new AppError(409, "conflict", "This competition cannot be published");
      }
      await client.query(
        `update competitions set status = 'published' where id = $1 and organisation_id = $2`,
        [id, orgId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "engagement.competition.publish",
        entityType: "competition",
        entityId: id,
      });
      return c.json({ ok: true });
    }),
  );

  app.post("/competitions/:id/complete", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageSchoolCompetitions(actor)) {
        throw new AppError(403, "forbidden", "Completing a competition requires school-wide manage");
      }
      await freezeCompetitionResults({
        client,
        organisationId: orgId,
        competitionId: uuidRouteParam(c, "id"),
        actorUserId: userId,
      });
      return c.json({ ok: true });
    }),
  );

  app.post("/competitions/:id/scores", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageCompetitions(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          studentProfileId: z.string().uuid().optional(),
          classId: z.string().uuid().optional(),
          houseId: z.string().uuid().optional(),
          yearGroupId: z.string().uuid().optional(),
          score: z.number().int().min(0),
          source: z.unknown().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid score");
      const id = uuidRouteParam(c, "id");
      const competition = await client.query(`select * from competitions where id = $1 and organisation_id = $2`, [
        id,
        orgId,
      ]);
      if (!competition.rows[0]) notFound();
      if (competition.rows[0].result_frozen) {
        throw new AppError(409, "conflict", "Completed competition results are frozen");
      }
      if (!canManageSchoolCompetitions(actor) && parsed.data.studentProfileId) {
        const assigned = await assignedStudentIds(client, actor.userId, orgId);
        if (!assigned.has(parsed.data.studentProfileId)) notFound();
      }
      if (parsed.data.studentProfileId) {
        const targetIds = await competitionTargetStudentIds(client, orgId, id);
        if (targetIds && !targetIds.has(parsed.data.studentProfileId)) notFound();
      }
      await client.query(
        `insert into competition_manual_scores (
           organisation_id, competition_id, student_profile_id, class_id, house_id, year_group_id, score, recorded_by, source
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,'teacher')
         on conflict (competition_id, student_profile_id) where student_profile_id is not null
         do update set score = excluded.score, updated_at = now()`,
        [
          orgId,
          id,
          parsed.data.studentProfileId ?? null,
          parsed.data.classId ?? null,
          parsed.data.houseId ?? null,
          parsed.data.yearGroupId ?? null,
          parsed.data.score,
          userId,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "engagement.competition.score",
        entityType: "competition",
        entityId: id,
        after: { score: parsed.data.score, studentProfileId: parsed.data.studentProfileId ?? null },
      });
      return c.json({ ok: true });
    }),
  );

  app.get("/competitions/:id/leaderboard", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canManageCompetitions(actor) && !canReadSchoolCompetitions(actor) && !actor.permissions.has(PERMISSIONS.COMPETITIONS_READ_ASSIGNED)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const policy = await loadEffectiveEngagementPolicy(client, orgId, null);
      const board = await buildLeaderboard({
        client,
        organisationId: orgId,
        competitionId: uuidRouteParam(c, "id"),
        audience: "staff",
        policy,
        requestedScope: c.req.query("scope"),
      });
      if (
        board.competition?.competitionType === "individual" &&
        !canReadSchoolCompetitions(actor) &&
        !canManageSchoolCompetitions(actor)
      ) {
        return c.json({ enabled: false, reason: "assigned_scope", competition: board.competition, entries: [] });
      }
      return c.json(board);
    }),
  );

  app.get("/learning-activities", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertStaffPracticeRead(actor);
      const rows = await client.query(
        `select d.*, s.name as subject_name
         from learning_activity_definitions d
         left join subjects s on s.id = d.subject_id
         where d.organisation_id = $1
         order by d.created_at desc`,
        [orgId],
      );
      const schoolWide = canReadSchoolPractice(actor) || canManageSchoolPractice(actor);
      const filtered = schoolWide
        ? rows.rows
        : rows.rows.filter((row) => row.created_by === actor.userId || row.status === "published");
      return c.json({ activities: filtered.map((row) => mapLearningActivityDefinition(row)) });
    }),
  );

  app.post("/learning-activities", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageSchoolPractice(actor) && !canManageAssignedPractice(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const parsed = z
        .object({
          title: z.string().min(1).max(120),
          activityType: z.string().min(1),
          instructions: z.string().max(2000).optional(),
          difficulty: z.enum(["easy", "medium", "challenge"]).optional(),
          recommendedYearGroupId: z.string().uuid().nullable().optional(),
          subjectId: z.string().uuid().nullable().optional(),
          attemptsAllowed: z.number().int().min(1).nullable().optional(),
          xpReward: z.number().int().min(0).optional(),
          completionThreshold: z.number().min(0).max(1).optional(),
          items: z
            .array(
              z.object({
                promptText: z.string().min(1).max(500),
                promptEmoji: z.string().max(80).optional(),
                itemType: z.enum([
                  "single_choice",
                  "multiple_choice",
                  "ordering",
                  "matching",
                  "numeric",
                  "short_exact_text",
                  "picture_choice",
                ]),
                choices: z.array(z.object({ id: z.string(), label: z.string(), emoji: z.string().optional() })).optional(),
                correctAnswer: z.record(z.unknown()),
                hint: z.string().max(200).optional(),
                explanation: z.string().max(400).optional(),
                points: z.number().int().min(0).optional(),
              }),
            )
            .optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid activity");
      const inserted = await client.query(
        `insert into learning_activity_definitions (
           organisation_id, title, activity_type, instructions, difficulty, recommended_year_group_id,
           subject_id, attempts_allowed, xp_reward, completion_threshold, content_payload, created_by, status
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,'draft')
         returning *`,
        [
          orgId,
          parsed.data.title,
          parsed.data.activityType,
          parsed.data.instructions ?? null,
          parsed.data.difficulty ?? "easy",
          parsed.data.recommendedYearGroupId ?? null,
          parsed.data.subjectId ?? null,
          parsed.data.attemptsAllowed ?? null,
          parsed.data.xpReward ?? 0,
          parsed.data.completionThreshold ?? 1,
          JSON.stringify({ schemaVersion: 1 }),
          userId,
        ],
      );
      for (const [index, item] of (parsed.data.items ?? []).entries()) {
        await client.query(
          `insert into learning_activity_items (
             organisation_id, activity_id, sort_order, prompt_text, prompt_emoji, item_type, choices,
             correct_answer, hint, explanation, points
           ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`,
          [
            orgId,
            inserted.rows[0]!.id,
            index,
            item.promptText,
            item.promptEmoji ?? null,
            item.itemType,
            JSON.stringify(item.choices ?? []),
            JSON.stringify(item.correctAnswer),
            item.hint ?? null,
            item.explanation ?? null,
            item.points ?? 1,
          ],
        );
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "engagement.learning_activity.create",
        entityType: "learning_activity_definition",
        entityId: inserted.rows[0]!.id,
        after: { title: parsed.data.title, status: "draft" },
      });
      return c.json({ activity: mapLearningActivityDefinition(inserted.rows[0]!) }, 201);
    }),
  );

  app.get("/learning-activities/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertStaffPracticeRead(actor);
      const id = uuidRouteParam(c, "id");
      const row = await client.query(
        `select d.*, s.name as subject_name from learning_activity_definitions d
         left join subjects s on s.id = d.subject_id
         where d.id = $1 and d.organisation_id = $2`,
        [id, orgId],
      );
      if (!row.rows[0]) notFound();
      if (
        !canReadSchoolPractice(actor) &&
        !canManageSchoolPractice(actor) &&
        row.rows[0].created_by !== actor.userId &&
        row.rows[0].status !== "published"
      ) {
        notFound();
      }
      const items = await client.query(
        `select * from learning_activity_items where activity_id = $1 order by sort_order`,
        [id],
      );
      return c.json({
        activity: mapLearningActivityDefinition(row.rows[0], { includeContent: true }),
        items: parsePracticeItems(items.rows),
      });
    }),
  );

  app.post("/learning-activities/:id/publish", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageSchoolPractice(actor) && !canManageAssignedPractice(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const id = uuidRouteParam(c, "id");
      const existing = await client.query(
        `select created_by from learning_activity_definitions where id = $1 and organisation_id = $2`,
        [id, orgId],
      );
      if (!existing.rows[0]) notFound();
      if (!canManageSchoolPractice(actor) && existing.rows[0].created_by !== actor.userId) notFound();
      await client.query(
        `update learning_activity_definitions set status = 'published' where id = $1 and organisation_id = $2`,
        [id, orgId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "engagement.learning_activity.publish",
        entityType: "learning_activity_definition",
        entityId: id,
      });
      return c.json({ ok: true });
    }),
  );

  app.post("/learning-practice/assignments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageSchoolPractice(actor) && !canManageAssignedPractice(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const parsed = z
        .object({
          activityId: z.string().uuid(),
          title: z.string().max(120).optional(),
          dueAt: z.string().datetime().optional(),
          targets: z
            .array(
              z.object({
                type: z.enum(["year_group", "class", "student"]),
                yearGroupId: z.string().uuid().optional(),
                classId: z.string().uuid().optional(),
                studentId: z.string().uuid().optional(),
              }),
            )
            .min(1),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid assignment");
      const activity = await client.query(
        `select * from learning_activity_definitions where id = $1 and organisation_id = $2`,
        [parsed.data.activityId, orgId],
      );
      if (!activity.rows[0]) notFound();
      for (const target of parsed.data.targets) {
        if (target.type === "year_group" && !canManageSchoolPractice(actor)) {
          throw new AppError(403, "forbidden", "Year-group targeting requires school-wide manage");
        }
        if (target.type === "class" && target.classId && !canManageSchoolPractice(actor)) {
          const { assertCanTargetPractice } = await import("@schoolapp/core");
          await assertCanTargetPractice(client, actor, orgId, { type: "class", classId: target.classId });
        }
        if (target.type === "student" && target.studentId && !canManageSchoolPractice(actor)) {
          const assigned = await assignedStudentIds(client, actor.userId, orgId);
          if (!assigned.has(target.studentId)) notFound();
        }
      }
      const inserted = await client.query(
        `insert into learning_activity_assignments (
           organisation_id, activity_id, title, due_at, created_by, status
         ) values ($1,$2,$3,$4,$5,'draft')
         returning *`,
        [orgId, parsed.data.activityId, parsed.data.title ?? null, parsed.data.dueAt ?? null, userId],
      );
      for (const target of parsed.data.targets) {
        await client.query(
          `insert into learning_activity_targets (
             organisation_id, assignment_id, target_type, year_group_id, class_id, student_profile_id
           ) values ($1,$2,$3,$4,$5,$6)`,
          [
            orgId,
            inserted.rows[0]!.id,
            target.type,
            target.yearGroupId ?? null,
            target.classId ?? null,
            target.studentId ?? null,
          ],
        );
      }
      return c.json({ assignment: inserted.rows[0] }, 201);
    }),
  );

  app.post("/learning-practice/assignments/:id/publish", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageSchoolPractice(actor) && !canManageAssignedPractice(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const id = uuidRouteParam(c, "id");
      const existing = await client.query(
        `select a.created_by, d.status as activity_status
         from learning_activity_assignments a
         join learning_activity_definitions d on d.id = a.activity_id
         where a.id = $1 and a.organisation_id = $2`,
        [id, orgId],
      );
      if (!existing.rows[0]) notFound();
      if (existing.rows[0].activity_status !== "published") {
        throw new AppError(409, "conflict", "Publish the activity before assigning it to pupils");
      }
      if (!canManageSchoolPractice(actor) && existing.rows[0].created_by !== actor.userId) notFound();
      await snapshotPracticeRecipients(client, orgId, id);
      await client.query(
        `update learning_activity_assignments
         set status = 'published', published_at = now()
         where id = $1 and organisation_id = $2`,
        [id, orgId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "engagement.learning_assignment.publish",
        entityType: "learning_activity_assignment",
        entityId: id,
      });
      return c.json({ ok: true });
    }),
  );

  app.get("/learning-practice/progress", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertStaffPracticeRead(actor);
      const studentId = c.req.query("studentId");
      if (!studentId) throw new AppError(400, "validation_failed", "studentId is required");
      if (!canReadSchoolPractice(actor) && !canManageSchoolPractice(actor)) {
        const assigned = await assignedStudentIds(client, actor.userId, orgId);
        if (!assigned.has(studentId)) notFound();
      }
      const yearGroupId = await loadPupilYearGroupId(client, orgId, studentId);
      const policy = await loadEffectiveEngagementPolicy(client, orgId, yearGroupId);
      const summary = await pupilProgressSummary({
        client,
        organisationId: orgId,
        studentProfileId: studentId,
        audience: "staff",
        policy,
      });
      return c.json({ progress: summary });
    }),
  );
}
