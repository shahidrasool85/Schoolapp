import type pg from "pg";
import type { Actor } from "@schoolapp/domain";
import {
  AppError,
  achievementMeetsCriteria,
  assignedStudentIds,
  canAwardSchoolRewards,
  canManageSchoolCompetitions,
  canManageSchoolPractice,
  canReadSchoolAchievements,
  canReadSchoolCompetitions,
  canReadSchoolPractice,
  canReadSchoolRewards,
  effectiveDisplayPolicy,
  formatLeaderboardDisplayName,
  isCompletedByThreshold,
  leaderboardPrivacy,
  loadEffectiveEngagementPolicy,
  loadPupilHouseId,
  loadPupilYearGroupId,
  notFound,
  parsePracticeItems,
  practiceActivityAllowed,
  requireCurrentEnrolment,
  scorePracticeAttempt,
  stripAnswerKey,
  writeAudit,
  type AchievementCriteriaType,
  type AchievementProgress,
  type EffectiveEngagementPolicy,
  type PracticeItem,
} from "@schoolapp/core";
import {
  mapAchievementDefinition,
  mapCompetition,
  mapLearningActivityDefinition,
  mapPupilAchievement,
  mapPupilReward,
  mapRewardCategory,
} from "./serialize";

export type Audience = "staff" | "parent" | "student";

const REWARD_SELECT = `
  select r.*, c.name as category_name, sp.legal_name as student_name,
         u.full_name as awarded_by_name
  from pupil_rewards r
  join reward_categories c on c.id = r.category_id
  join student_profiles sp on sp.id = r.student_profile_id
  left join users u on u.id = r.awarded_by
`;

export async function grantXp(input: {
  client: pg.PoolClient;
  organisationId: string;
  studentProfileId: string;
  amount: number;
  sourceType: "learning_attempt" | "reward" | "achievement" | "manual";
  sourceId: string;
  awardedBy: string | null;
}): Promise<number> {
  if (input.amount <= 0) return 0;
  const inserted = await input.client.query<{ amount: number }>(
    `insert into pupil_xp_events (
       organisation_id, student_profile_id, amount, source_type, source_id, awarded_by
     ) values ($1, $2, $3, $4, $5, $6)
     on conflict (organisation_id, student_profile_id, source_type, source_id)
       where source_id is not null
     do nothing
     returning amount`,
    [
      input.organisationId,
      input.studentProfileId,
      input.amount,
      input.sourceType,
      input.sourceId,
      input.awardedBy,
    ],
  );
  return inserted.rows[0]?.amount ?? 0;
}

export async function reverseXpForSource(input: {
  client: pg.PoolClient;
  organisationId: string;
  studentProfileId: string;
  sourceType: "learning_attempt" | "reward" | "achievement" | "manual";
  sourceId: string;
  awardedBy: string | null;
}): Promise<void> {
  await input.client.query(
    `insert into pupil_xp_events (
       organisation_id, student_profile_id, amount, source_type, source_id, awarded_by
     )
     select organisation_id, student_profile_id, -amount, 'reversal', source_id, $5
     from pupil_xp_events
     where organisation_id = $1
       and student_profile_id = $2
       and source_type = $3
       and source_id = $4
       and amount > 0
     on conflict (organisation_id, student_profile_id, source_type, source_id)
       where source_id is not null
     do nothing`,
    [
      input.organisationId,
      input.studentProfileId,
      input.sourceType,
      input.sourceId,
      input.awardedBy,
    ],
  );
}

export async function loadXpTotal(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
): Promise<number> {
  const result = await client.query<{ total: string }>(
    `select coalesce(sum(amount), 0)::text as total
     from pupil_xp_events
     where organisation_id = $1 and student_profile_id = $2`,
    [organisationId, studentProfileId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function loadRewardPointsTotal(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
): Promise<number> {
  const result = await client.query<{ total: string }>(
    `select coalesce(sum(points), 0)::text as total
     from pupil_rewards
     where organisation_id = $1
       and student_profile_id = $2
       and status = 'active'`,
    [organisationId, studentProfileId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

async function loadAchievementProgress(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
): Promise<AchievementProgress> {
  const [assignments, completed, activities, challenges, xp, points] = await Promise.all([
    client.query<{ n: string }>(
      `select count(*)::text as n from learning_assignment_recipients
       where organisation_id = $1 and student_profile_id = $2`,
      [organisationId, studentProfileId],
    ),
    client.query<{ n: string }>(
      `select count(*)::text as n
       from learning_submissions s
       where s.organisation_id = $1 and s.student_profile_id = $2
         and s.status in ('submitted', 'returned', 'resubmission_requested')`,
      [organisationId, studentProfileId],
    ),
    client.query<{ n: string }>(
      `select count(distinct activity_id)::text as n
       from learning_activity_attempts
       where organisation_id = $1 and student_profile_id = $2 and completion_state = 'completed'`,
      [organisationId, studentProfileId],
    ),
    client.query<{ n: string }>(
      `select count(distinct a.activity_id)::text as n
       from learning_activity_attempts a
       join learning_activity_definitions d on d.id = a.activity_id
       where a.organisation_id = $1 and a.student_profile_id = $2
         and a.completion_state = 'completed'
         and d.activity_type = 'challenge'`,
      [organisationId, studentProfileId],
    ),
    loadXpTotal(client, organisationId, studentProfileId),
    loadRewardPointsTotal(client, organisationId, studentProfileId),
  ]);
  return {
    assignmentCount: Number(assignments.rows[0]?.n ?? 0),
    assignmentCompletedCount: Number(completed.rows[0]?.n ?? 0),
    rewardPointsTotal: points,
    xpTotal: xp,
    attendancePercentage: null,
    attendanceStreak: 0,
    learningActivityCount: Number(activities.rows[0]?.n ?? 0),
    challengeCompletedCount: Number(challenges.rows[0]?.n ?? 0),
  };
}

export async function evaluateAchievements(input: {
  client: pg.PoolClient;
  organisationId: string;
  studentProfileId: string;
  actorUserId: string | null;
}): Promise<void> {
  const policy = await loadEffectiveEngagementPolicy(
    input.client,
    input.organisationId,
    await loadPupilYearGroupId(input.client, input.organisationId, input.studentProfileId),
  );
  if (!policy.achievementsEnabled) return;
  const progress = await loadAchievementProgress(
    input.client,
    input.organisationId,
    input.studentProfileId,
  );
  const defs = await input.client.query<{
    id: string;
    criteria_type: AchievementCriteriaType;
    threshold: number | null;
  }>(
    `select id, criteria_type, threshold
     from achievement_definitions
     where organisation_id = $1 and active = true and criteria_type <> 'manual'`,
    [input.organisationId],
  );
  for (const def of defs.rows) {
    if (!achievementMeetsCriteria(def.criteria_type, def.threshold, progress)) continue;
    await input.client.query(
      `insert into pupil_achievements (
         organisation_id, student_profile_id, definition_id, awarded_by, source
       ) values ($1, $2, $3, $4, 'automatic')
       on conflict (organisation_id, student_profile_id, definition_id) do nothing`,
      [input.organisationId, input.studentProfileId, def.id, input.actorUserId],
    );
  }
}

export async function listRewardsForStudent(input: {
  client: pg.PoolClient;
  organisationId: string;
  studentProfileId: string;
  audience: Audience;
  policy: EffectiveEngagementPolicy;
}): Promise<unknown[]> {
  if (!input.policy.rewardsEnabled) return [];
  const visibility =
    input.audience === "student"
      ? "and r.student_visible = true"
      : input.audience === "parent"
        ? "and r.parent_visible = true"
        : "";
  const result = await input.client.query(
    `${REWARD_SELECT}
     where r.organisation_id = $1
       and r.student_profile_id = $2
       and r.status = 'active'
       ${visibility}
     order by r.awarded_at desc
     limit 100`,
    [input.organisationId, input.studentProfileId],
  );
  return result.rows.map((row) =>
    mapPupilReward(
      {
        ...row,
        student_visible_points: input.policy.studentVisiblePoints,
        parent_visible_points: input.policy.parentVisiblePoints,
      },
      input.audience,
    ),
  );
}

export async function awardReward(input: {
  client: pg.PoolClient;
  actor: Actor;
  organisationId: string;
  studentProfileId: string;
  categoryId: string;
  title?: string;
  pupilMessage?: string | null;
  internalNote?: string | null;
  points?: number | null;
  subjectId?: string | null;
  classId?: string | null;
  sourceType?: string;
  studentVisible?: boolean;
  parentVisible?: boolean;
}): Promise<Record<string, unknown>> {
  await requireCurrentEnrolment(input.client, input.organisationId, input.studentProfileId);
  const category = await input.client.query(
    `select * from reward_categories
     where id = $1 and organisation_id = $2 and active = true`,
    [input.categoryId, input.organisationId],
  );
  if (!category.rows[0]) notFound();
  const points = input.points == null ? Number(category.rows[0].default_points) : input.points;
  if (!Number.isInteger(points) || points < 0) {
    throw new AppError(400, "validation_failed", "Reward points must be a non-negative integer");
  }
  const houseId = await loadPupilHouseId(input.client, input.organisationId, input.studentProfileId);
  const policy = await loadEffectiveEngagementPolicy(
    input.client,
    input.organisationId,
    await loadPupilYearGroupId(input.client, input.organisationId, input.studentProfileId),
  );
  if (!policy.rewardsEnabled) {
    throw new AppError(403, "forbidden", "Rewards are disabled for this year group");
  }
  const xpAmount =
    category.rows[0].grants_xp && policy.xpEnabled ? Number(category.rows[0].default_xp) : 0;
  const inserted = await input.client.query(
    `insert into pupil_rewards (
       organisation_id, student_profile_id, category_id, points, xp_awarded, title,
       pupil_message, internal_note, awarded_by, subject_id, class_id, house_id,
       source_type, student_visible, parent_visible
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     returning *`,
    [
      input.organisationId,
      input.studentProfileId,
      input.categoryId,
      points,
      xpAmount,
      input.title?.trim() || String(category.rows[0].name),
      input.pupilMessage ?? null,
      input.internalNote ?? null,
      input.actor.userId,
      input.subjectId ?? null,
      input.classId ?? null,
      houseId,
      input.sourceType ?? "manual",
      input.studentVisible ?? Boolean(category.rows[0].student_visible),
      input.parentVisible ?? Boolean(category.rows[0].parent_visible),
    ],
  );
  const row = inserted.rows[0]!;
  if (xpAmount > 0) {
    await grantXp({
      client: input.client,
      organisationId: input.organisationId,
      studentProfileId: input.studentProfileId,
      amount: xpAmount,
      sourceType: "reward",
      sourceId: row.id,
      awardedBy: input.actor.userId,
    });
  }
  await evaluateAchievements({
    client: input.client,
    organisationId: input.organisationId,
    studentProfileId: input.studentProfileId,
    actorUserId: input.actor.userId,
  });
  await writeAudit(input.client, {
    organisationId: input.organisationId,
    actorUserId: input.actor.userId,
    action: "engagement.reward.award",
    entityType: "pupil_reward",
    entityId: row.id,
    after: {
      studentProfileId: input.studentProfileId,
      categoryId: input.categoryId,
      points,
      xpAwarded: xpAmount,
    },
  });
  const named = await input.client.query(`${REWARD_SELECT} where r.id = $1`, [row.id]);
  return mapPupilReward(named.rows[0]!, "staff") as Record<string, unknown>;
}

export async function revokeReward(input: {
  client: pg.PoolClient;
  actor: Actor;
  organisationId: string;
  rewardId: string;
  reason: string;
}): Promise<void> {
  const existing = await input.client.query(
    `select * from pupil_rewards where id = $1 and organisation_id = $2`,
    [input.rewardId, input.organisationId],
  );
  if (!existing.rows[0]) notFound();
  if (!canAwardSchoolRewards(input.actor) && !canReadSchoolRewards(input.actor)) {
    const assigned = await assignedStudentIds(input.client, input.actor.userId, input.organisationId);
    if (!assigned.has(existing.rows[0].student_profile_id)) notFound();
  }
  await input.client.query(
    `update pupil_rewards
     set status = 'revoked', revoked_by = $3, revoked_at = now(), revoke_reason = $4
     where id = $1 and organisation_id = $2 and status = 'active'`,
    [input.rewardId, input.organisationId, input.actor.userId, input.reason],
  );
  await reverseXpForSource({
    client: input.client,
    organisationId: input.organisationId,
    studentProfileId: existing.rows[0].student_profile_id,
    sourceType: "reward",
    sourceId: input.rewardId,
    awardedBy: input.actor.userId,
  });
  await writeAudit(input.client, {
    organisationId: input.organisationId,
    actorUserId: input.actor.userId,
    action: "engagement.reward.revoke",
    entityType: "pupil_reward",
    entityId: input.rewardId,
    after: { reason: input.reason },
  });
}

export async function snapshotPracticeRecipients(
  client: pg.PoolClient,
  organisationId: string,
  assignmentId: string,
): Promise<void> {
  await client.query(`delete from learning_activity_recipients where assignment_id = $1`, [assignmentId]);
  await client.query(
    `insert into learning_activity_recipients (organisation_id, assignment_id, student_profile_id)
     select distinct $1::uuid, $2::uuid, src.student_profile_id
     from (
       select cm.student_profile_id
       from learning_activity_targets t
       join class_memberships cm on cm.class_id = t.class_id
       join academic_years ay on ay.id = cm.academic_year_id and ay.is_current
       where t.assignment_id = $2 and t.target_type = 'class'
         and cm.organisation_id = $1 and (cm.ended_on is null or cm.ended_on >= current_date)
       union
       select se.student_profile_id
       from learning_activity_targets t
       join student_enrolments se on se.year_group_id = t.year_group_id
       join academic_years ay on ay.id = se.academic_year_id and ay.is_current
       where t.assignment_id = $2 and t.target_type = 'year_group'
         and se.organisation_id = $1 and se.is_primary and se.ended_on is null and se.status = 'enrolled'
       union
       select t.student_profile_id
       from learning_activity_targets t
       where t.assignment_id = $2 and t.target_type = 'student' and t.student_profile_id is not null
     ) src
     on conflict (assignment_id, student_profile_id) do nothing`,
    [organisationId, assignmentId],
  );
}

export async function listPracticeForPupil(input: {
  client: pg.PoolClient;
  organisationId: string;
  studentProfileId: string;
  policy: EffectiveEngagementPolicy;
}): Promise<unknown[]> {
  if (!input.policy.earlyLearningEnabled && !input.policy.learningChallengesEnabled) return [];
  const result = await input.client.query(
    `select a.id, a.title as assignment_title, a.due_at, a.status as assignment_status,
            d.id as activity_id, d.title, d.activity_type, d.instructions, d.difficulty,
            d.xp_reward, d.attempts_allowed, d.status as activity_status,
            att.completion_state, att.score, att.max_score, att.xp_awarded, att.id as attempt_id
     from learning_activity_recipients r
     join learning_activity_assignments a on a.id = r.assignment_id
     join learning_activity_definitions d on d.id = a.activity_id
     left join lateral (
       select * from learning_activity_attempts x
       where x.assignment_id = a.id and x.student_profile_id = r.student_profile_id
       order by x.attempt_number desc
       limit 1
     ) att on true
     where r.organisation_id = $1
       and r.student_profile_id = $2
       and a.status = 'published'
       and d.status = 'published'
       and (
         (d.activity_type = 'challenge' and $3::boolean)
         or (d.activity_type <> 'challenge' and $4::boolean)
       )
     order by a.due_at nulls last, d.title`,
    [
      input.organisationId,
      input.studentProfileId,
      input.policy.learningChallengesEnabled,
      input.policy.earlyLearningEnabled,
    ],
  );
  return result.rows.map((row) => ({
    assignmentId: row.id,
    activityId: row.activity_id,
    title: row.assignment_title || row.title,
    activityType: row.activity_type,
    instructions: row.instructions,
    difficulty: row.difficulty,
    dueAt: row.due_at,
    xpReward: Number(row.xp_reward ?? 0),
    attemptsAllowed: row.attempts_allowed,
    latestAttempt: row.attempt_id
      ? {
          id: row.attempt_id,
          completionState: row.completion_state,
          score: row.score,
          maxScore: row.max_score,
          xpAwarded: Number(row.xp_awarded ?? 0),
        }
      : null,
  }));
}

export async function loadPlayableActivity(input: {
  client: pg.PoolClient;
  organisationId: string;
  assignmentId: string;
  studentProfileId: string;
  includeAnswers: boolean;
}): Promise<{
  assignment: Record<string, unknown>;
  activity: ReturnType<typeof mapLearningActivityDefinition>;
  items: unknown[];
}> {
  const row = await input.client.query(
    `select a.*, d.id as activity_id, d.title as activity_title, d.activity_type, d.instructions,
            d.difficulty, d.recommended_year_group_id, d.subject_id, d.attempts_allowed,
            d.xp_reward, d.completion_threshold, d.status as activity_status, d.assignment_link_id,
            d.content_payload, d.created_at as activity_created_at
     from learning_activity_assignments a
     join learning_activity_definitions d on d.id = a.activity_id
     join learning_activity_recipients r
       on r.assignment_id = a.id and r.student_profile_id = $3
     where a.id = $1 and a.organisation_id = $2
       and a.status = 'published' and d.status = 'published'`,
    [input.assignmentId, input.organisationId, input.studentProfileId],
  );
  if (!row.rows[0]) notFound();
  const policy = await loadEffectiveEngagementPolicy(
    input.client,
    input.organisationId,
    await loadPupilYearGroupId(input.client, input.organisationId, input.studentProfileId),
  );
  if (!practiceActivityAllowed(String(row.rows[0].activity_type), policy)) notFound();
  const items = await input.client.query(
    `select * from learning_activity_items
     where activity_id = $1 and organisation_id = $2
     order by sort_order, created_at`,
    [row.rows[0].activity_id, input.organisationId],
  );
  const parsed = parsePracticeItems(items.rows);
  return {
    assignment: {
      id: row.rows[0].id,
      title: row.rows[0].title || row.rows[0].activity_title,
      dueAt: row.rows[0].due_at,
    },
    activity: mapLearningActivityDefinition({
      id: row.rows[0].activity_id,
      title: row.rows[0].activity_title,
      activity_type: row.rows[0].activity_type,
      instructions: row.rows[0].instructions,
      difficulty: row.rows[0].difficulty,
      recommended_year_group_id: row.rows[0].recommended_year_group_id,
      subject_id: row.rows[0].subject_id,
      attempts_allowed: row.rows[0].attempts_allowed,
      xp_reward: row.rows[0].xp_reward,
      completion_threshold: row.rows[0].completion_threshold,
      status: row.rows[0].activity_status,
      assignment_link_id: row.rows[0].assignment_link_id,
      created_at: row.rows[0].activity_created_at,
    }),
    items: input.includeAnswers ? parsed : parsed.map((item) => stripAnswerKey(item)),
  };
}

export async function startPracticeAttempt(input: {
  client: pg.PoolClient;
  organisationId: string;
  assignmentId: string;
  studentProfileId: string;
  actorUserId: string;
  channel: "student" | "parent_assisted";
}): Promise<{ attemptId: string; resumed: boolean; items: unknown[] }> {
  await requireCurrentEnrolment(input.client, input.organisationId, input.studentProfileId);
  const playable = await loadPlayableActivity({
    client: input.client,
    organisationId: input.organisationId,
    assignmentId: input.assignmentId,
    studentProfileId: input.studentProfileId,
    includeAnswers: false,
  });
  const activity = await input.client.query<{
    id: string;
    attempts_allowed: number | null;
  }>(
    `select d.id, d.attempts_allowed
     from learning_activity_assignments a
     join learning_activity_definitions d on d.id = a.activity_id
     where a.id = $1`,
    [input.assignmentId],
  );
  const open = await input.client.query<{ id: string }>(
    `select id from learning_activity_attempts
     where organisation_id = $1 and assignment_id = $2 and student_profile_id = $3
       and completion_state = 'in_progress'
       and channel = $4
     order by attempt_number desc
     limit 1`,
    [input.organisationId, input.assignmentId, input.studentProfileId, input.channel],
  );
  if (open.rows[0]) {
    return { attemptId: open.rows[0].id, resumed: true, items: playable.items };
  }
  const count = await input.client.query<{ n: string }>(
    `select count(*)::text as n from learning_activity_attempts
     where organisation_id = $1 and assignment_id = $2 and student_profile_id = $3`,
    [input.organisationId, input.assignmentId, input.studentProfileId],
  );
  const used = Number(count.rows[0]?.n ?? 0);
  const allowed = activity.rows[0]?.attempts_allowed;
  if (allowed != null && used >= allowed) {
    throw new AppError(409, "conflict", "No attempts remaining");
  }
  const inserted = await input.client.query<{ id: string }>(
    `insert into learning_activity_attempts (
       organisation_id, student_profile_id, activity_id, assignment_id, attempt_number,
       channel, launched_by_user_id
     ) values ($1,$2,$3,$4,$5,$6,$7)
     returning id`,
    [
      input.organisationId,
      input.studentProfileId,
      activity.rows[0]!.id,
      input.assignmentId,
      used + 1,
      input.channel,
      input.actorUserId,
    ],
  );
  return { attemptId: inserted.rows[0]!.id, resumed: false, items: playable.items };
}

export async function submitPracticeAttempt(input: {
  client: pg.PoolClient;
  organisationId: string;
  attemptId: string;
  studentProfileId: string;
  answers: Record<string, unknown>;
  actorUserId: string;
  expectedChannel: "student" | "parent_assisted";
}): Promise<{
  score: number;
  maxScore: number;
  completed: boolean;
  xpAwarded: number;
  results: Array<{ itemId: string; correct: boolean; pointsAwarded: number; explanation?: string | null }>;
}> {
  if ("xpAwarded" in input.answers || "rewardPoints" in input.answers || "score" in input.answers) {
    // Client-computed values are ignored; answers object may coincidentally have keys — still ignored below.
  }
  const attempt = await input.client.query<{
    id: string;
    student_profile_id: string;
    activity_id: string;
    assignment_id: string | null;
    completion_state: string;
    channel: string;
    xp_awarded: number;
    score: number | null;
    max_score: number | null;
  }>(
    `select * from learning_activity_attempts
     where id = $1 and organisation_id = $2`,
    [input.attemptId, input.organisationId],
  );
  const row = attempt.rows[0];
  if (!row || row.student_profile_id !== input.studentProfileId) notFound();
  if (row.channel !== input.expectedChannel) notFound();
  await requireCurrentEnrolment(input.client, input.organisationId, input.studentProfileId);
  if (row.completion_state === "completed") {
    return {
      score: Number(row.score ?? 0),
      maxScore: Number(row.max_score ?? 0),
      completed: true,
      xpAwarded: Number(row.xp_awarded ?? 0),
      results: [],
    };
  }
  const items = await input.client.query(
    `select * from learning_activity_items
     where activity_id = $1 and organisation_id = $2
     order by sort_order`,
    [row.activity_id, input.organisationId],
  );
  const parsed: PracticeItem[] = parsePracticeItems(items.rows);
  const scored = scorePracticeAttempt(parsed, input.answers);
  const definition = await input.client.query<{
    xp_reward: number;
    completion_threshold: string;
    activity_type: string;
  }>(
    `select xp_reward, completion_threshold::text, activity_type
     from learning_activity_definitions where id = $1`,
    [row.activity_id],
  );
  const completed = isCompletedByThreshold(
    scored.score,
    scored.maxScore,
    Number(definition.rows[0]?.completion_threshold ?? 1),
  );
  for (const result of scored.results) {
    await input.client.query(
      `insert into learning_activity_answers (
         organisation_id, attempt_id, item_id, answer_payload, is_correct, points_awarded
       ) values ($1,$2,$3,$4::jsonb,$5,$6)
       on conflict (attempt_id, item_id) do update
         set answer_payload = excluded.answer_payload,
             is_correct = excluded.is_correct,
             points_awarded = excluded.points_awarded`,
      [
        input.organisationId,
        input.attemptId,
        result.itemId,
        JSON.stringify(input.answers[result.itemId] ?? null),
        result.correct,
        result.pointsAwarded,
      ],
    );
  }
  let xpAwarded = 0;
  const policy = await loadEffectiveEngagementPolicy(
    input.client,
    input.organisationId,
    await loadPupilYearGroupId(input.client, input.organisationId, input.studentProfileId),
  );
  if (completed && policy.xpEnabled && Number(definition.rows[0]?.xp_reward ?? 0) > 0) {
    xpAwarded = await grantXp({
      client: input.client,
      organisationId: input.organisationId,
      studentProfileId: input.studentProfileId,
      amount: Number(definition.rows[0]?.xp_reward ?? 0),
      sourceType: "learning_attempt",
      sourceId: row.activity_id,
      awardedBy: input.actorUserId,
    });
  }
  if (completed && policy.grantRewardPointsOnLearning && policy.rewardsEnabled) {
    const category = await input.client.query<{ id: string; name: string; default_points: number }>(
      `select id, name, default_points from reward_categories
       where organisation_id = $1 and active = true
       order by (key = 'excellent_work') desc, sort_order, name
       limit 1`,
      [input.organisationId],
    );
    if (category.rows[0]) {
      await input.client.query(
        `insert into pupil_rewards (
           organisation_id, student_profile_id, category_id, points, title, pupil_message,
           awarded_by, house_id, source_type, source_id
         )
         select $1,$2,$3,$4,$5,$6,$7,$8,'learning_activity',$9
         where not exists (
           select 1 from pupil_rewards
           where organisation_id = $1
             and student_profile_id = $2
             and source_type = 'learning_activity'
             and source_id = $9
             and status = 'active'
         )`,
        [
          input.organisationId,
          input.studentProfileId,
          category.rows[0].id,
          Math.max(0, Number(category.rows[0].default_points)),
          category.rows[0].name,
          "Well done for completing practice.",
          input.actorUserId,
          await loadPupilHouseId(input.client, input.organisationId, input.studentProfileId),
          row.activity_id,
        ],
      );
    }
  }
  await input.client.query(
    `update learning_activity_attempts
     set completion_state = 'completed',
         completed_at = now(),
         score = $3,
         max_score = $4,
         xp_awarded = $5
     where id = $1 and organisation_id = $2`,
    [input.attemptId, input.organisationId, scored.score, scored.maxScore, xpAwarded],
  );
  await evaluateAchievements({
    client: input.client,
    organisationId: input.organisationId,
    studentProfileId: input.studentProfileId,
    actorUserId: input.actorUserId,
  });
  const itemById = new Map(parsed.map((item) => [item.id, item]));
  return {
    score: scored.score,
    maxScore: scored.maxScore,
    completed,
    xpAwarded,
    results: scored.results.map((result) => ({
      ...result,
      explanation: itemById.get(result.itemId)?.explanation ?? null,
    })),
  };
}

export async function pupilProgressSummary(input: {
  client: pg.PoolClient;
  organisationId: string;
  studentProfileId: string;
  audience: Audience;
  policy: EffectiveEngagementPolicy;
}) {
  const [xp, points, activities, achievements] = await Promise.all([
    loadXpTotal(input.client, input.organisationId, input.studentProfileId),
    loadRewardPointsTotal(input.client, input.organisationId, input.studentProfileId),
    input.client.query<{ n: string }>(
      `select count(distinct activity_id)::text as n
       from learning_activity_attempts
       where organisation_id = $1 and student_profile_id = $2 and completion_state = 'completed'`,
      [input.organisationId, input.studentProfileId],
    ),
    input.client.query(
      `select pa.*, d.key as definition_key, d.title, d.description, d.icon_key, d.student_visible, d.parent_visible
       from pupil_achievements pa
       join achievement_definitions d on d.id = pa.definition_id
       where pa.organisation_id = $1 and pa.student_profile_id = $2
       order by pa.awarded_at desc`,
      [input.organisationId, input.studentProfileId],
    ),
  ]);
  const visibleAchievements =
    !input.policy.achievementsEnabled && input.audience !== "staff"
      ? []
      : achievements.rows.filter((row) =>
          input.audience === "staff"
            ? true
            : input.audience === "student"
              ? row.student_visible
              : row.parent_visible,
        );
  return {
    xp: input.policy.xpEnabled ? xp : null,
    rewardPoints:
      input.audience === "staff"
        ? points
        : input.policy.rewardsEnabled &&
            ((input.audience === "student" && input.policy.studentVisiblePoints) ||
              (input.audience === "parent" && input.policy.parentVisiblePoints))
          ? points
          : null,
    activitiesCompleted: Number(activities.rows[0]?.n ?? 0),
    achievements: visibleAchievements.map((row) => mapPupilAchievement(row, input.audience)),
    childFriendlyUi: input.policy.childFriendlyUi,
    parentAssistedMode: input.policy.parentAssistedMode,
    earlyLearningEnabled: input.policy.earlyLearningEnabled,
    learningChallengesEnabled: input.policy.learningChallengesEnabled,
    rewardsEnabled: input.policy.rewardsEnabled,
    competitionsEnabled: input.policy.competitionsEnabled,
    leaderboardsEnabled: input.policy.leaderboardsEnabled,
  };
}

type ScoreEntry = {
  entryType: "student" | "class" | "house" | "year_group" | "school";
  studentProfileId?: string | null;
  classId?: string | null;
  houseId?: string | null;
  yearGroupId?: string | null;
  legalName?: string | null;
  preferredName?: string | null;
  displayFallback: string;
  score: number;
};

async function competitionTargetStudentIds(
  client: pg.PoolClient,
  organisationId: string,
  competitionId: string,
): Promise<Set<string> | null> {
  const targets = await client.query<{
    target_type: string;
    year_group_id: string | null;
    class_id: string | null;
    student_profile_id: string | null;
    house_id: string | null;
  }>(`select * from competition_targets where competition_id = $1`, [competitionId]);
  if (targets.rows.some((row) => row.target_type === "whole_school") || targets.rows.length === 0) {
    return null;
  }
  const ids = new Set<string>();
  for (const target of targets.rows) {
    if (target.target_type === "student" && target.student_profile_id) {
      ids.add(target.student_profile_id);
    } else if (target.target_type === "class" && target.class_id) {
      const pupils = await client.query<{ student_profile_id: string }>(
        `select cm.student_profile_id from class_memberships cm
         join academic_years ay on ay.id = cm.academic_year_id and ay.is_current
         where cm.class_id = $1 and cm.organisation_id = $2
           and (cm.ended_on is null or cm.ended_on >= current_date)`,
        [target.class_id, organisationId],
      );
      pupils.rows.forEach((row) => ids.add(row.student_profile_id));
    } else if (target.target_type === "year_group" && target.year_group_id) {
      const pupils = await client.query<{ student_profile_id: string }>(
        `select se.student_profile_id from student_enrolments se
         join academic_years ay on ay.id = se.academic_year_id and ay.is_current
         where se.year_group_id = $1 and se.organisation_id = $2
           and se.is_primary and se.ended_on is null and se.status = 'enrolled'`,
        [target.year_group_id, organisationId],
      );
      pupils.rows.forEach((row) => ids.add(row.student_profile_id));
    } else if (target.target_type === "house" && target.house_id) {
      const pupils = await client.query<{ student_profile_id: string }>(
        `select se.student_profile_id from student_enrolments se
         join academic_years ay on ay.id = se.academic_year_id and ay.is_current
         where se.house_id = $1 and se.organisation_id = $2
           and se.is_primary and se.ended_on is null and se.status = 'enrolled'`,
        [target.house_id, organisationId],
      );
      pupils.rows.forEach((row) => ids.add(row.student_profile_id));
    }
  }
  return ids;
}

async function liveCompetitionScores(input: {
  client: pg.PoolClient;
  organisationId: string;
  competition: {
    id: string;
    competition_type: string;
    scoring_model: string;
    starts_at: string | null;
    ends_at: string | null;
  };
}): Promise<ScoreEntry[]> {
  const pupilFilter = await competitionTargetStudentIds(
    input.client,
    input.organisationId,
    input.competition.id,
  );
  const starts = input.competition.starts_at;
  const ends = input.competition.ends_at;
  const pupils = await input.client.query<{
    student_profile_id: string;
    legal_name: string;
    preferred_name: string | null;
    class_id: string | null;
    class_name: string | null;
    house_id: string | null;
    house_name: string | null;
    year_group_id: string | null;
    year_group_name: string | null;
  }>(
    `select se.student_profile_id, sp.legal_name, u.preferred_name,
            form.id as class_id, form.name as class_name,
            se.house_id, h.name as house_name,
            se.year_group_id, yg.name as year_group_name
     from student_enrolments se
     join academic_years ay on ay.id = se.academic_year_id and ay.is_current
     join student_profiles sp on sp.id = se.student_profile_id
     left join users u on u.id = sp.user_id
     left join houses h on h.id = se.house_id
     left join year_groups yg on yg.id = se.year_group_id
     left join lateral (
       select c.id, c.name from class_memberships cm
       join classes c on c.id = cm.class_id
       where cm.student_profile_id = se.student_profile_id
         and cm.ended_on is null and c.class_type = 'form'
         and cm.academic_year_id = ay.id
       limit 1
     ) form on true
     where se.organisation_id = $1 and se.is_primary and se.ended_on is null and se.status = 'enrolled'`,
    [input.organisationId],
  );
  const eligible = pupils.rows.filter(
    (row) => !pupilFilter || pupilFilter.has(row.student_profile_id),
  );
  const scores = new Map<string, number>();
  const add = (key: string, amount: number) => scores.set(key, (scores.get(key) ?? 0) + amount);

  if (input.competition.scoring_model === "reward_points") {
    const rows = await input.client.query<{ student_profile_id: string; total: string }>(
      `select student_profile_id, coalesce(sum(points),0)::text as total
       from pupil_rewards
       where organisation_id = $1 and status = 'active'
         and ($2::timestamptz is null or awarded_at >= $2)
         and ($3::timestamptz is null or awarded_at <= $3)
       group by student_profile_id`,
      [input.organisationId, starts, ends],
    );
    rows.rows.forEach((row) => add(row.student_profile_id, Number(row.total)));
  } else if (input.competition.scoring_model === "xp") {
    const rows = await input.client.query<{ student_profile_id: string; total: string }>(
      `select student_profile_id, coalesce(sum(amount),0)::text as total
       from pupil_xp_events
       where organisation_id = $1
         and ($2::timestamptz is null or awarded_at >= $2)
         and ($3::timestamptz is null or awarded_at <= $3)
       group by student_profile_id`,
      [input.organisationId, starts, ends],
    );
    rows.rows.forEach((row) => add(row.student_profile_id, Number(row.total)));
  } else if (
    input.competition.scoring_model === "completed_learning_activities" ||
    input.competition.scoring_model === "quiz_score"
  ) {
    const rows = await input.client.query<{ student_profile_id: string; total: string }>(
      input.competition.scoring_model === "quiz_score"
        ? `select student_profile_id, coalesce(sum(score),0)::text as total
           from learning_activity_attempts
           where organisation_id = $1 and completion_state = 'completed'
             and ($2::timestamptz is null or completed_at >= $2)
             and ($3::timestamptz is null or completed_at <= $3)
           group by student_profile_id`
        : `select student_profile_id, count(distinct activity_id)::text as total
           from learning_activity_attempts
           where organisation_id = $1 and completion_state = 'completed'
             and ($2::timestamptz is null or completed_at >= $2)
             and ($3::timestamptz is null or completed_at <= $3)
           group by student_profile_id`,
      [input.organisationId, starts, ends],
    );
    rows.rows.forEach((row) => add(row.student_profile_id, Number(row.total)));
  } else if (input.competition.scoring_model === "teacher_score") {
    const rows = await input.client.query<{
      student_profile_id: string | null;
      class_id: string | null;
      house_id: string | null;
      year_group_id: string | null;
      score: number;
    }>(
      `select student_profile_id, class_id, house_id, year_group_id, score
       from competition_manual_scores where competition_id = $1`,
      [input.competition.id],
    );
    return rows.rows.map((row) => ({
      entryType: row.student_profile_id
        ? "student"
        : row.class_id
          ? "class"
          : row.house_id
            ? "house"
            : "year_group",
      studentProfileId: row.student_profile_id,
      classId: row.class_id,
      houseId: row.house_id,
      yearGroupId: row.year_group_id,
      displayFallback: "Entry",
      score: row.score,
    }));
  }

  const type = input.competition.competition_type;
  if (type === "individual") {
    return eligible.map((row) => ({
      entryType: "student" as const,
      studentProfileId: row.student_profile_id,
      legalName: row.legal_name,
      preferredName: row.preferred_name,
      displayFallback: row.legal_name,
      score: scores.get(row.student_profile_id) ?? 0,
    }));
  }
  const grouped = new Map<string, ScoreEntry>();
  for (const row of eligible) {
    const key =
      type === "class"
        ? row.class_id
        : type === "house"
          ? row.house_id
          : type === "year_group"
            ? row.year_group_id
            : "school";
    if (!key && type !== "school") continue;
    const id = key ?? input.organisationId;
    const current = grouped.get(id) ?? {
      entryType: type === "school" ? "school" : (type as ScoreEntry["entryType"]),
      classId: type === "class" ? row.class_id : null,
      houseId: type === "house" ? row.house_id : null,
      yearGroupId: type === "year_group" ? row.year_group_id : null,
      displayFallback:
        type === "class"
          ? row.class_name ?? "Class"
          : type === "house"
            ? row.house_name ?? "House"
            : type === "year_group"
              ? row.year_group_name ?? "Year group"
              : "School",
      score: 0,
    };
    current.score += scores.get(row.student_profile_id) ?? 0;
    grouped.set(id, current);
  }
  return [...grouped.values()];
}

function rankEntries(entries: ScoreEntry[]) {
  const sorted = [...entries].sort((a, b) => b.score - a.score || a.displayFallback.localeCompare(b.displayFallback));
  return sorted.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export async function buildLeaderboard(input: {
  client: pg.PoolClient;
  organisationId: string;
  competitionId: string;
  audience: Audience;
  policy: EffectiveEngagementPolicy;
  requestedScope?: string | null;
}): Promise<{
  enabled: boolean;
  reason?: string;
  competition: ReturnType<typeof mapCompetition> | null;
  entries: unknown[];
}> {
  const competition = await input.client.query(`select * from competitions where id = $1 and organisation_id = $2`, [
    input.competitionId,
    input.organisationId,
  ]);
  if (!competition.rows[0]) notFound();
  const row = competition.rows[0];
  if (input.audience === "student" && (!row.student_visible || row.staff_only)) notFound();
  if (input.audience === "parent" && (!row.parent_visible || row.staff_only)) notFound();
  if (!input.policy.competitionsEnabled) {
    return { enabled: false, reason: "competitions_disabled", competition: mapCompetition(row), entries: [] };
  }
  const privacy = leaderboardPrivacy(input.policy);
  if (privacy === "off") {
    return { enabled: false, reason: "leaderboard_disabled", competition: mapCompetition(row), entries: [] };
  }
  if (row.competition_type === "individual" && !input.policy.allowIndividualLeaderboard) {
    return { enabled: false, reason: "individual_disabled", competition: mapCompetition(row), entries: [] };
  }
  if (row.competition_type === "class" && !input.policy.allowClassLeaderboard) {
    return { enabled: false, reason: "class_disabled", competition: mapCompetition(row), entries: [] };
  }
  if (row.competition_type === "house" && !input.policy.allowHouseLeaderboard) {
    return { enabled: false, reason: "house_disabled", competition: mapCompetition(row), entries: [] };
  }
  if (input.requestedScope && input.requestedScope !== row.competition_type) {
    return { enabled: false, reason: "scope_not_permitted", competition: mapCompetition(row), entries: [] };
  }

  if (row.result_frozen) {
    const frozen = await input.client.query(
      `select * from competition_results where competition_id = $1 order by rank`,
      [input.competitionId],
    );
    return {
      enabled: true,
      competition: mapCompetition(row),
      entries: frozen.rows.map((entry) => ({
        rank: entry.rank,
        entryType: entry.entry_type,
        displayName: entry.display_name,
        score: Number(entry.score),
        houseId: entry.house_id,
        classId: entry.class_id,
      })),
    };
  }

  const live = rankEntries(
    await liveCompetitionScores({
      client: input.client,
      organisationId: input.organisationId,
      competition: row,
    }),
  );
  const displayPolicy = effectiveDisplayPolicy(input.policy);
  return {
    enabled: true,
    competition: mapCompetition(row),
    entries: live.map((entry) => {
      const displayName =
        entry.entryType === "student"
          ? formatLeaderboardDisplayName({
              policy: displayPolicy,
              legalName: entry.legalName ?? entry.displayFallback,
              preferredName: entry.preferredName ?? null,
              rank: entry.rank,
            })
          : entry.displayFallback;
      return {
        rank: entry.rank,
        entryType: entry.entryType,
        displayName,
        score: entry.score,
        houseId: entry.houseId ?? null,
        classId: entry.classId ?? null,
      };
    }),
  };
}

export async function freezeCompetitionResults(input: {
  client: pg.PoolClient;
  organisationId: string;
  competitionId: string;
  actorUserId: string;
}): Promise<void> {
  const competition = await input.client.query(`select * from competitions where id = $1 and organisation_id = $2`, [
    input.competitionId,
    input.organisationId,
  ]);
  if (!competition.rows[0]) notFound();
  if (competition.rows[0].result_frozen) return;
  const settings = await loadEffectiveEngagementPolicy(input.client, input.organisationId, null);
  const board = await buildLeaderboard({
    client: input.client,
    organisationId: input.organisationId,
    competitionId: input.competitionId,
    audience: "staff",
    policy: {
      ...settings,
      leaderboardsEnabled: true,
      allowIndividualLeaderboard: true,
      anonymisePupilLeaderboard: settings.anonymisePupilLeaderboard || !settings.allowIndividualLeaderboard,
    },
  });
  for (const entry of board.entries as Array<{
    rank: number;
    entryType: string;
    displayName: string | null;
    score: number;
    houseId: string | null;
    classId: string | null;
  }>) {
    await input.client.query(
      `insert into competition_results (
         organisation_id, competition_id, rank, entry_type, house_id, class_id, display_name, score
       ) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.organisationId,
        input.competitionId,
        entry.rank,
        entry.entryType,
        entry.houseId,
        entry.classId,
        entry.displayName ?? `Rank ${entry.rank}`,
        entry.score,
      ],
    );
  }
  await input.client.query(
    `update competitions
     set status = 'completed', result_frozen = true, completed_by = $3, completed_at = now()
     where id = $1 and organisation_id = $2`,
    [input.competitionId, input.organisationId, input.actorUserId],
  );
  await writeAudit(input.client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "engagement.competition.complete",
    entityType: "competition",
    entityId: input.competitionId,
    after: { frozen: true, entries: board.entries.length },
  });
}

export { mapRewardCategory, mapAchievementDefinition, mapCompetition, mapLearningActivityDefinition };

export function assertStaffCompetitionAccess(actor: Actor, schoolWideNeeded: boolean): void {
  if (schoolWideNeeded && !canManageSchoolCompetitions(actor) && !canReadSchoolCompetitions(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export function assertStaffPracticeRead(actor: Actor): void {
  if (
    !canReadSchoolPractice(actor) &&
    !canManageSchoolPractice(actor) &&
    !actor.permissions.has("learning.practice.read_assigned") &&
    !actor.permissions.has("learning.practice.manage_assigned")
  ) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export function assertStaffAchievementRead(actor: Actor): void {
  if (
    !canReadSchoolAchievements(actor) &&
    !actor.permissions.has("achievements.read_assigned") &&
    !actor.permissions.has("achievements.manage") &&
    !actor.permissions.has("achievements.award_assigned")
  ) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}
