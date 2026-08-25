import { PERMISSIONS, type Actor } from "@schoolapp/domain";
import type pg from "pg";
import { assignedStudentIds, assignedClassIds } from "./students-access.js";
import { notFound } from "./permissions.js";
import { AppError } from "./errors.js";
import {
  DEFAULT_ENGAGEMENT_SETTINGS,
  resolveEngagementPolicy,
  type EffectiveEngagementPolicy,
  type EngagementSettings,
  type LeaderboardDisplayPolicy,
  type YearGroupEngagementPolicy,
} from "./engagement.js";

export const ENGAGEMENT_SETTINGS_READ_PERMISSIONS = [
  PERMISSIONS.ENGAGEMENT_SETTINGS_READ,
  PERMISSIONS.ENGAGEMENT_SETTINGS_MANAGE,
] as const;

export const REWARD_SCHOOL_READ_PERMISSIONS = [PERMISSIONS.REWARDS_READ, PERMISSIONS.REWARDS_MANAGE] as const;
export const REWARD_AWARD_PERMISSIONS = [
  PERMISSIONS.REWARDS_AWARD,
  PERMISSIONS.REWARDS_AWARD_ASSIGNED,
  PERMISSIONS.REWARDS_MANAGE,
] as const;

export function canManageEngagementSettings(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ENGAGEMENT_SETTINGS_MANAGE);
}

export function canReadEngagementSettings(actor: Actor): boolean {
  return ENGAGEMENT_SETTINGS_READ_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canReadSchoolRewards(actor: Actor): boolean {
  return REWARD_SCHOOL_READ_PERMISSIONS.some((key) => actor.permissions.has(key));
}

export function canAwardSchoolRewards(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.REWARDS_AWARD) || actor.permissions.has(PERMISSIONS.REWARDS_MANAGE);
}

export function canAwardAssignedRewards(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.REWARDS_AWARD_ASSIGNED);
}

export function canManageRewards(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.REWARDS_MANAGE);
}

export function canReadSchoolAchievements(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ACHIEVEMENTS_READ) || actor.permissions.has(PERMISSIONS.ACHIEVEMENTS_MANAGE);
}

export function canManageAchievements(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.ACHIEVEMENTS_MANAGE);
}

export function canReadSchoolCompetitions(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.COMPETITIONS_READ) ||
    actor.permissions.has(PERMISSIONS.COMPETITIONS_MANAGE_SCHOOL)
  );
}

export function canManageSchoolCompetitions(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.COMPETITIONS_MANAGE_SCHOOL);
}

export function canManageCompetitions(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.COMPETITIONS_MANAGE) ||
    actor.permissions.has(PERMISSIONS.COMPETITIONS_MANAGE_SCHOOL)
  );
}

export function canReadSchoolPractice(actor: Actor): boolean {
  return (
    actor.permissions.has(PERMISSIONS.LEARNING_PRACTICE_READ) ||
    actor.permissions.has(PERMISSIONS.LEARNING_PRACTICE_MANAGE)
  );
}

export function canManageSchoolPractice(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.LEARNING_PRACTICE_MANAGE);
}

export function canManageAssignedPractice(actor: Actor): boolean {
  return actor.permissions.has(PERMISSIONS.LEARNING_PRACTICE_MANAGE_ASSIGNED);
}

export async function loadAuthorisedEngagementStudentIds(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  schoolWide: boolean,
): Promise<Set<string> | null> {
  if (schoolWide) return null;
  const assigned = await assignedStudentIds(client, actor.userId, organisationId);
  return assigned;
}

export async function assertCanAccessEngagementStudent(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  studentProfileId: string,
  schoolWide: boolean,
): Promise<void> {
  if (schoolWide) return;
  const assigned = await assignedStudentIds(client, actor.userId, organisationId);
  if (!assigned.has(studentProfileId)) notFound();
}

export async function assertCanTargetPractice(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  target: { type: "class" | "year_group" | "student"; classId?: string; yearGroupId?: string; studentId?: string },
): Promise<void> {
  if (canManageSchoolPractice(actor)) return;
  if (!canManageAssignedPractice(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
  if (target.type === "year_group") {
    throw new AppError(403, "forbidden", "Year-group targeting requires school-wide practice manage");
  }
  if (target.type === "class") {
    if (!target.classId) notFound();
    const classes = await assignedClassIds(client, actor.userId, organisationId);
    if (!classes.has(target.classId)) notFound();
    return;
  }
  if (!target.studentId) notFound();
  const students = await assignedStudentIds(client, actor.userId, organisationId);
  if (!students.has(target.studentId)) notFound();
}

function mapSettings(row: Record<string, unknown> | undefined): EngagementSettings {
  if (!row) return { ...DEFAULT_ENGAGEMENT_SETTINGS };
  return {
    rewardsEnabled: Boolean(row.rewards_enabled),
    achievementsEnabled: Boolean(row.achievements_enabled),
    competitionsEnabled: Boolean(row.competitions_enabled),
    leaderboardsEnabled: Boolean(row.leaderboards_enabled),
    earlyLearningEnabled: Boolean(row.early_learning_enabled),
    xpEnabled: Boolean(row.xp_enabled),
    studentVisiblePoints: Boolean(row.student_visible_points),
    parentVisiblePoints: Boolean(row.parent_visible_points),
    allowIndividualLeaderboard: Boolean(row.allow_individual_leaderboard),
    allowClassLeaderboard: Boolean(row.allow_class_leaderboard),
    allowHouseLeaderboard: Boolean(row.allow_house_leaderboard),
    anonymisePupilLeaderboard: Boolean(row.anonymise_pupil_leaderboard),
    leaderboardDisplayNamePolicy: row.leaderboard_display_name_policy as LeaderboardDisplayPolicy,
    grantRewardPointsOnLearning: Boolean(row.grant_reward_points_on_learning),
  };
}

function mapYearPolicy(row: Record<string, unknown> | undefined): YearGroupEngagementPolicy | null {
  if (!row) return null;
  return {
    rewardsEnabled: (row.rewards_enabled as boolean | null) ?? null,
    achievementsEnabled: (row.achievements_enabled as boolean | null) ?? null,
    competitionsEnabled: (row.competitions_enabled as boolean | null) ?? null,
    leaderboardsEnabled: (row.leaderboards_enabled as boolean | null) ?? null,
    earlyLearningEnabled: (row.early_learning_enabled as boolean | null) ?? null,
    learningChallengesEnabled: (row.learning_challenges_enabled as boolean | null) ?? null,
    parentAssistedMode: (row.parent_assisted_mode as boolean | null) ?? null,
    childFriendlyUi: (row.child_friendly_ui as boolean | null) ?? null,
    xpEnabled: (row.xp_enabled as boolean | null) ?? null,
    studentVisiblePoints: (row.student_visible_points as boolean | null) ?? null,
    parentVisiblePoints: (row.parent_visible_points as boolean | null) ?? null,
  };
}

export async function ensureEngagementDefaults(
  client: pg.PoolClient,
  organisationId: string,
): Promise<void> {
  await client.query("select ensure_organisation_phase19_defaults($1)", [organisationId]);
}

export async function loadEngagementSettings(
  client: pg.PoolClient,
  organisationId: string,
): Promise<EngagementSettings> {
  await ensureEngagementDefaults(client, organisationId);
  const result = await client.query(`select * from engagement_settings where organisation_id = $1`, [organisationId]);
  return mapSettings(result.rows[0]);
}

export async function loadYearGroupEngagementPolicy(
  client: pg.PoolClient,
  organisationId: string,
  yearGroupId: string | null,
): Promise<YearGroupEngagementPolicy | null> {
  if (!yearGroupId) return null;
  const result = await client.query(
    `select * from engagement_year_group_policies
     where organisation_id = $1 and year_group_id = $2`,
    [organisationId, yearGroupId],
  );
  return mapYearPolicy(result.rows[0]);
}

export async function loadEffectiveEngagementPolicy(
  client: pg.PoolClient,
  organisationId: string,
  yearGroupId: string | null,
): Promise<EffectiveEngagementPolicy> {
  const settings = await loadEngagementSettings(client, organisationId);
  const year = await loadYearGroupEngagementPolicy(client, organisationId, yearGroupId);
  return resolveEngagementPolicy(settings, year);
}

export async function loadPupilYearGroupId(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
): Promise<string | null> {
  const result = await client.query<{ year_group_id: string | null }>(
    `select se.year_group_id
     from student_enrolments se
     join academic_years ay
       on ay.id = se.academic_year_id
      and ay.organisation_id = se.organisation_id
      and ay.is_current
     where se.organisation_id = $1
       and se.student_profile_id = $2
       and se.is_primary
       and se.ended_on is null`,
    [organisationId, studentProfileId],
  );
  return result.rows[0]?.year_group_id ?? null;
}

export async function loadPupilHouseId(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
): Promise<string | null> {
  const result = await client.query<{ house_id: string | null }>(
    `select se.house_id
     from student_enrolments se
     join academic_years ay
       on ay.id = se.academic_year_id
      and ay.organisation_id = se.organisation_id
      and ay.is_current
     where se.organisation_id = $1
       and se.student_profile_id = $2
       and se.is_primary
       and se.ended_on is null`,
    [organisationId, studentProfileId],
  );
  return result.rows[0]?.house_id ?? null;
}

export async function requireCurrentEnrolment(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
): Promise<void> {
  const result = await client.query(
    `select se.id
     from student_enrolments se
     join academic_years ay
       on ay.id = se.academic_year_id
      and ay.organisation_id = se.organisation_id
      and ay.is_current
     where se.organisation_id = $1
       and se.student_profile_id = $2
       and se.is_primary
       and se.ended_on is null
       and se.status = 'enrolled'`,
    [organisationId, studentProfileId],
  );
  if (!result.rows[0]) notFound();
}
