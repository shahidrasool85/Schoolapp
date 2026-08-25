export const LEADERBOARD_DISPLAY_POLICIES = [
  "first_name_initial",
  "first_name",
  "anonymous_alias",
  "rank_only",
] as const;
export type LeaderboardDisplayPolicy = (typeof LEADERBOARD_DISPLAY_POLICIES)[number];

export const COMPETITION_TYPES = ["individual", "class", "house", "year_group", "school"] as const;
export type CompetitionType = (typeof COMPETITION_TYPES)[number];

export const COMPETITION_SCORING_MODELS = [
  "reward_points",
  "xp",
  "completed_learning_activities",
  "teacher_score",
  "quiz_score",
  "attendance",
] as const;
export type CompetitionScoringModel = (typeof COMPETITION_SCORING_MODELS)[number];

export const COMPETITION_STATUSES = [
  "draft",
  "published",
  "active",
  "completed",
  "archived",
  "cancelled",
] as const;
export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

export const PRACTICE_ITEM_TYPES = [
  "single_choice",
  "multiple_choice",
  "ordering",
  "matching",
  "numeric",
  "short_exact_text",
  "picture_choice",
] as const;
export type PracticeItemType = (typeof PRACTICE_ITEM_TYPES)[number];

export const PRACTICE_ACTIVITY_TYPES = [
  "counting",
  "number_recognition",
  "number_ordering",
  "simple_addition",
  "letter_recognition",
  "case_matching",
  "phonics_matching",
  "word_picture_matching",
  "spelling",
  "shape_recognition",
  "colour_matching",
  "sequencing",
  "memory_matching",
  "multiple_choice",
  "picture_choice",
  "challenge",
] as const;
export type PracticeActivityType = (typeof PRACTICE_ACTIVITY_TYPES)[number];

export const ACHIEVEMENT_CRITERIA_TYPES = [
  "manual",
  "assignment_count",
  "assignment_completed_count",
  "reward_points_total",
  "xp_total",
  "attendance_percentage",
  "attendance_streak",
  "learning_activity_count",
  "challenge_completed_count",
] as const;
export type AchievementCriteriaType = (typeof ACHIEVEMENT_CRITERIA_TYPES)[number];

export type EngagementSettings = {
  rewardsEnabled: boolean;
  achievementsEnabled: boolean;
  competitionsEnabled: boolean;
  leaderboardsEnabled: boolean;
  earlyLearningEnabled: boolean;
  xpEnabled: boolean;
  studentVisiblePoints: boolean;
  parentVisiblePoints: boolean;
  allowIndividualLeaderboard: boolean;
  allowClassLeaderboard: boolean;
  allowHouseLeaderboard: boolean;
  anonymisePupilLeaderboard: boolean;
  leaderboardDisplayNamePolicy: LeaderboardDisplayPolicy;
  grantRewardPointsOnLearning: boolean;
};

export type YearGroupEngagementPolicy = {
  rewardsEnabled: boolean | null;
  achievementsEnabled: boolean | null;
  competitionsEnabled: boolean | null;
  leaderboardsEnabled: boolean | null;
  earlyLearningEnabled: boolean | null;
  learningChallengesEnabled: boolean | null;
  parentAssistedMode: boolean | null;
  childFriendlyUi: boolean | null;
  xpEnabled: boolean | null;
  studentVisiblePoints: boolean | null;
  parentVisiblePoints: boolean | null;
};

export type EffectiveEngagementPolicy = {
  rewardsEnabled: boolean;
  achievementsEnabled: boolean;
  competitionsEnabled: boolean;
  leaderboardsEnabled: boolean;
  earlyLearningEnabled: boolean;
  learningChallengesEnabled: boolean;
  parentAssistedMode: boolean;
  childFriendlyUi: boolean;
  xpEnabled: boolean;
  studentVisiblePoints: boolean;
  parentVisiblePoints: boolean;
  allowIndividualLeaderboard: boolean;
  allowClassLeaderboard: boolean;
  allowHouseLeaderboard: boolean;
  anonymisePupilLeaderboard: boolean;
  leaderboardDisplayNamePolicy: LeaderboardDisplayPolicy;
  grantRewardPointsOnLearning: boolean;
};

export const DEFAULT_ENGAGEMENT_SETTINGS: EngagementSettings = {
  rewardsEnabled: true,
  achievementsEnabled: true,
  competitionsEnabled: true,
  leaderboardsEnabled: false,
  earlyLearningEnabled: true,
  xpEnabled: true,
  studentVisiblePoints: true,
  parentVisiblePoints: true,
  allowIndividualLeaderboard: false,
  allowClassLeaderboard: true,
  allowHouseLeaderboard: true,
  anonymisePupilLeaderboard: true,
  leaderboardDisplayNamePolicy: "first_name_initial",
  grantRewardPointsOnLearning: false,
};

function inherit(flag: boolean | null | undefined, fallback: boolean): boolean {
  return flag == null ? fallback : flag;
}

export function resolveEngagementPolicy(
  settings: EngagementSettings,
  yearGroup: YearGroupEngagementPolicy | null,
): EffectiveEngagementPolicy {
  const earlyLearning = inherit(yearGroup?.earlyLearningEnabled, settings.earlyLearningEnabled);
  return {
    rewardsEnabled: inherit(yearGroup?.rewardsEnabled, settings.rewardsEnabled),
    achievementsEnabled: inherit(yearGroup?.achievementsEnabled, settings.achievementsEnabled),
    competitionsEnabled: inherit(yearGroup?.competitionsEnabled, settings.competitionsEnabled),
    leaderboardsEnabled: inherit(yearGroup?.leaderboardsEnabled, settings.leaderboardsEnabled),
    earlyLearningEnabled: earlyLearning,
    learningChallengesEnabled: inherit(yearGroup?.learningChallengesEnabled, !earlyLearning),
    parentAssistedMode: inherit(yearGroup?.parentAssistedMode, earlyLearning),
    childFriendlyUi: inherit(yearGroup?.childFriendlyUi, earlyLearning),
    xpEnabled: inherit(yearGroup?.xpEnabled, settings.xpEnabled),
    studentVisiblePoints: inherit(yearGroup?.studentVisiblePoints, settings.studentVisiblePoints),
    parentVisiblePoints: inherit(yearGroup?.parentVisiblePoints, settings.parentVisiblePoints),
    allowIndividualLeaderboard: settings.allowIndividualLeaderboard,
    allowClassLeaderboard: settings.allowClassLeaderboard,
    allowHouseLeaderboard: settings.allowHouseLeaderboard,
    anonymisePupilLeaderboard: settings.anonymisePupilLeaderboard,
    leaderboardDisplayNamePolicy: settings.leaderboardDisplayNamePolicy,
    grantRewardPointsOnLearning: settings.grantRewardPointsOnLearning,
  };
}

export type LeaderboardPrivacy =
  | "off"
  | "house_only"
  | "class_team_only"
  | "anonymised_individual"
  | "named_individual";

export function leaderboardPrivacy(policy: EffectiveEngagementPolicy): LeaderboardPrivacy {
  if (!policy.leaderboardsEnabled) return "off";
  if (policy.allowIndividualLeaderboard) {
    return policy.anonymisePupilLeaderboard ||
      policy.leaderboardDisplayNamePolicy === "anonymous_alias" ||
      policy.leaderboardDisplayNamePolicy === "rank_only"
      ? "anonymised_individual"
      : "named_individual";
  }
  if (policy.allowClassLeaderboard && !policy.allowHouseLeaderboard) return "class_team_only";
  if (policy.allowHouseLeaderboard) return "house_only";
  if (policy.allowClassLeaderboard) return "class_team_only";
  return "off";
}

export function effectiveDisplayPolicy(policy: EffectiveEngagementPolicy): LeaderboardDisplayPolicy {
  if (!policy.allowIndividualLeaderboard || policy.anonymisePupilLeaderboard) {
    return policy.leaderboardDisplayNamePolicy === "rank_only" ? "rank_only" : "anonymous_alias";
  }
  return policy.leaderboardDisplayNamePolicy;
}

export function firstGivenName(legalName: string, preferredName: string | null): string {
  const preferred = preferredName?.trim();
  if (preferred) return preferred.split(/\s+/)[0] ?? preferred;
  return legalName.trim().split(/\s+/)[0] ?? "Pupil";
}

export function surnameInitial(legalName: string): string {
  const parts = legalName.trim().split(/\s+/).filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return last ? last.slice(0, 1).toUpperCase() : "";
}

export function formatLeaderboardDisplayName(input: {
  policy: LeaderboardDisplayPolicy;
  legalName: string;
  preferredName: string | null;
  rank: number;
}): string | null {
  if (input.policy === "rank_only") return null;
  if (input.policy === "anonymous_alias") return `Pupil ${input.rank}`;
  const first = firstGivenName(input.legalName, input.preferredName);
  if (input.policy === "first_name") return first;
  const initial = surnameInitial(input.legalName);
  return initial ? `${first} ${initial}.` : first;
}

export type PracticeChoice = {
  id: string;
  label: string;
  emoji?: string | null;
};

export type PracticeCorrectAnswer = {
  choiceId?: string;
  choiceIds?: string[];
  order?: string[];
  pairs?: Array<[string, string]>;
  value?: number | string;
  text?: string;
  caseInsensitive?: boolean;
};

export type PracticeItem = {
  id: string;
  sortOrder: number;
  promptText: string;
  promptEmoji?: string | null;
  itemType: PracticeItemType;
  choices: PracticeChoice[];
  correctAnswer: PracticeCorrectAnswer;
  hint?: string | null;
  explanation?: string | null;
  points: number;
};

export type PracticeClientItem = Omit<PracticeItem, "correctAnswer" | "explanation"> & {
  explanation?: string | null;
};

export function stripAnswerKey(item: PracticeItem, includeExplanation = false): PracticeClientItem {
  return {
    id: item.id,
    sortOrder: item.sortOrder,
    promptText: item.promptText,
    promptEmoji: item.promptEmoji ?? null,
    itemType: item.itemType,
    choices: item.choices,
    hint: item.hint ?? null,
    explanation: includeExplanation ? (item.explanation ?? null) : null,
    points: item.points,
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry));
}

function normalizeText(value: string, caseInsensitive: boolean): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return caseInsensitive ? trimmed.toLowerCase() : trimmed;
}

export function scorePracticeItem(
  item: PracticeItem,
  submitted: unknown,
): { correct: boolean; pointsAwarded: number } {
  const answer = item.correctAnswer ?? {};
  let correct = false;
  if (item.itemType === "single_choice" || item.itemType === "picture_choice") {
    const submittedId =
      submitted && typeof submitted === "object" && "choiceId" in submitted
        ? String((submitted as { choiceId: unknown }).choiceId)
        : String(submitted ?? "");
    correct = submittedId === String(answer.choiceId ?? answer.value ?? "");
  } else if (item.itemType === "multiple_choice") {
    const expected = new Set((answer.choiceIds ?? []).map(String).sort());
    const got = new Set(asStringArray(
      submitted && typeof submitted === "object" && "choiceIds" in (submitted as object)
        ? (submitted as { choiceIds: unknown }).choiceIds
        : submitted,
    ).sort());
    correct = expected.size > 0 && expected.size === got.size && [...expected].every((id) => got.has(id));
  } else if (item.itemType === "ordering") {
    const expected = (answer.order ?? []).map(String);
    const got = asStringArray(
      submitted && typeof submitted === "object" && "order" in (submitted as object)
        ? (submitted as { order: unknown }).order
        : submitted,
    );
    correct = expected.length > 0 && expected.length === got.length && expected.every((id, index) => id === got[index]);
  } else if (item.itemType === "matching") {
    const expected = new Map((answer.pairs ?? []).map(([left, right]) => [String(left), String(right)]));
    const rawPairs =
      submitted && typeof submitted === "object" && "pairs" in (submitted as object)
        ? (submitted as { pairs: unknown }).pairs
        : submitted;
    const got = new Map<string, string>();
    if (Array.isArray(rawPairs)) {
      for (const pair of rawPairs) {
        if (Array.isArray(pair) && pair.length >= 2) {
          got.set(String(pair[0]), String(pair[1]));
        } else if (pair && typeof pair === "object" && "left" in pair && "right" in pair) {
          got.set(String((pair as { left: unknown }).left), String((pair as { right: unknown }).right));
        }
      }
    }
    correct =
      expected.size > 0 &&
      expected.size === got.size &&
      [...expected.entries()].every(([left, right]) => got.get(left) === right);
  } else if (item.itemType === "numeric") {
    const expected = Number(answer.value);
    const got =
      submitted && typeof submitted === "object" && "value" in submitted
        ? Number((submitted as { value: unknown }).value)
        : Number(submitted);
    correct = Number.isFinite(expected) && Number.isFinite(got) && expected === got;
  } else if (item.itemType === "short_exact_text") {
    const caseInsensitive = answer.caseInsensitive !== false;
    const expected = normalizeText(String(answer.text ?? answer.value ?? ""), caseInsensitive);
    const got = normalizeText(
      String(
        submitted && typeof submitted === "object" && "text" in submitted
          ? (submitted as { text: unknown }).text
          : submitted ?? "",
      ),
      caseInsensitive,
    );
    correct = expected.length > 0 && expected === got;
  }
  return { correct, pointsAwarded: correct ? item.points : 0 };
}

export function scorePracticeAttempt(
  items: PracticeItem[],
  answers: Record<string, unknown>,
): { score: number; maxScore: number; results: Array<{ itemId: string; correct: boolean; pointsAwarded: number }> } {
  const results = items.map((item) => {
    const scored = scorePracticeItem(item, answers[item.id]);
    return { itemId: item.id, ...scored };
  });
  const score = results.reduce((sum, row) => sum + row.pointsAwarded, 0);
  const maxScore = items.reduce((sum, item) => sum + item.points, 0);
  return { score, maxScore, results };
}

export function isCompletedByThreshold(score: number, maxScore: number, threshold: number): boolean {
  if (maxScore <= 0) return threshold <= 0;
  return score / maxScore >= threshold;
}

export type AchievementProgress = {
  assignmentCount: number;
  assignmentCompletedCount: number;
  rewardPointsTotal: number;
  xpTotal: number;
  attendancePercentage: number | null;
  attendanceStreak: number;
  learningActivityCount: number;
  challengeCompletedCount: number;
};

export function achievementMeetsCriteria(
  criteriaType: AchievementCriteriaType,
  threshold: number | null,
  progress: AchievementProgress,
): boolean {
  if (criteriaType === "manual") return false;
  const needed = threshold ?? 0;
  switch (criteriaType) {
    case "assignment_count":
      return progress.assignmentCount >= needed;
    case "assignment_completed_count":
      return progress.assignmentCompletedCount >= needed;
    case "reward_points_total":
      return progress.rewardPointsTotal >= needed;
    case "xp_total":
      return progress.xpTotal >= needed;
    case "attendance_percentage":
      return progress.attendancePercentage != null && progress.attendancePercentage >= needed;
    case "attendance_streak":
      return progress.attendanceStreak >= needed;
    case "learning_activity_count":
      return progress.learningActivityCount >= needed;
    case "challenge_completed_count":
      return progress.challengeCompletedCount >= needed;
    default:
      return false;
  }
}

export function isCompetitionStatusTransitionAllowed(from: CompetitionStatus, to: CompetitionStatus): boolean {
  if (from === to) return true;
  const allowed: Record<CompetitionStatus, CompetitionStatus[]> = {
    draft: ["published", "cancelled"],
    published: ["active", "cancelled", "draft"],
    active: ["completed", "cancelled"],
    completed: ["archived"],
    archived: [],
    cancelled: ["archived"],
  };
  return allowed[from].includes(to);
}

export function parsePracticeItems(rows: Array<Record<string, unknown>>): PracticeItem[] {
  return rows.map((row) => ({
    id: String(row.id),
    sortOrder: Number(row.sort_order ?? 0),
    promptText: String(row.prompt_text ?? ""),
    promptEmoji: (row.prompt_emoji as string | null) ?? null,
    itemType: row.item_type as PracticeItemType,
    choices: Array.isArray(row.choices) ? (row.choices as PracticeChoice[]) : [],
    correctAnswer: (row.correct_answer as PracticeCorrectAnswer) ?? {},
    hint: (row.hint as string | null) ?? null,
    explanation: (row.explanation as string | null) ?? null,
    points: Number(row.points ?? 1),
  }));
}

export const FUTURE_AI_ACTIVITY_WORKFLOW = {
  schemaVersion: 1,
  statusMustBeginAs: "draft",
  teacherReviewRequired: true,
  generationNotImplemented: true,
  notes:
    "Future AI may draft learning_activity_definitions + items into this schema. Generated content always starts as draft; a teacher must review and publish. No LLM calls in Phase 19.",
} as const;
