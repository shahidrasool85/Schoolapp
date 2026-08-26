import { describe, expect, it } from "vitest";
import {
  achievementMeetsCriteria,
  effectiveDisplayPolicy,
  formatLeaderboardDisplayName,
  isCompletedByThreshold,
  isCompetitionStatusTransitionAllowed,
  leaderboardPrivacy,
  practiceActivityAllowed,
  resolveEngagementPolicy,
  scorePracticeAttempt,
  scorePracticeItem,
  stripAnswerKey,
  DEFAULT_ENGAGEMENT_SETTINGS,
  type PracticeItem,
} from "./engagement.js";

const countingItem: PracticeItem = {
  id: "q1",
  sortOrder: 0,
  promptText: "How many apples?",
  promptEmoji: "🍎🍎🍎🍎",
  itemType: "single_choice",
  choices: [
    { id: "3", label: "3" },
    { id: "4", label: "4" },
    { id: "5", label: "5" },
  ],
  correctAnswer: { choiceId: "4" },
  points: 1,
};

describe("engagement policy", () => {
  it("inherits school defaults and treats early learning as parent-assisted by default", () => {
    const policy = resolveEngagementPolicy(DEFAULT_ENGAGEMENT_SETTINGS, {
      rewardsEnabled: null,
      achievementsEnabled: null,
      competitionsEnabled: null,
      leaderboardsEnabled: false,
      earlyLearningEnabled: true,
      learningChallengesEnabled: null,
      parentAssistedMode: null,
      childFriendlyUi: null,
      xpEnabled: null,
      studentVisiblePoints: null,
      parentVisiblePoints: null,
    });
    expect(policy.rewardsEnabled).toBe(true);
    expect(policy.leaderboardsEnabled).toBe(false);
    expect(policy.earlyLearningEnabled).toBe(true);
    expect(policy.parentAssistedMode).toBe(true);
    expect(policy.childFriendlyUi).toBe(true);
    expect(policy.learningChallengesEnabled).toBe(false);
    expect(leaderboardPrivacy(policy)).toBe("off");
  });

  it("hides early-learning types when only challenges are enabled", () => {
    const challengesOnly = resolveEngagementPolicy(DEFAULT_ENGAGEMENT_SETTINGS, {
      rewardsEnabled: null,
      achievementsEnabled: null,
      competitionsEnabled: null,
      leaderboardsEnabled: null,
      earlyLearningEnabled: false,
      learningChallengesEnabled: true,
      parentAssistedMode: false,
      childFriendlyUi: false,
      xpEnabled: null,
      studentVisiblePoints: null,
      parentVisiblePoints: null,
    });
    expect(practiceActivityAllowed("counting", challengesOnly)).toBe(false);
    expect(practiceActivityAllowed("challenge", challengesOnly)).toBe(true);
    expect(practiceActivityAllowed("counting", resolveEngagementPolicy(DEFAULT_ENGAGEMENT_SETTINGS, null))).toBe(
      true,
    );
  });

  it("does not expose named individual leaderboards when anonymised", () => {
    const policy = resolveEngagementPolicy(
      {
        ...DEFAULT_ENGAGEMENT_SETTINGS,
        leaderboardsEnabled: true,
        allowIndividualLeaderboard: true,
        anonymisePupilLeaderboard: true,
      },
      null,
    );
    expect(leaderboardPrivacy(policy)).toBe("anonymised_individual");
    expect(effectiveDisplayPolicy(policy)).toBe("anonymous_alias");
  });
});

describe("leaderboard display names", () => {
  it("uses preferred first name plus surname initial", () => {
    expect(
      formatLeaderboardDisplayName({
        policy: "first_name_initial",
        legalName: "Amelia Khan",
        preferredName: "Amelia",
        rank: 1,
      }),
    ).toBe("Amelia K.");
  });

  it("never returns a legal surname for anonymous or rank-only policies", () => {
    expect(
      formatLeaderboardDisplayName({
        policy: "anonymous_alias",
        legalName: "Amelia Khan",
        preferredName: "Amelia",
        rank: 2,
      }),
    ).toBe("Pupil 2");
    expect(
      formatLeaderboardDisplayName({
        policy: "rank_only",
        legalName: "Amelia Khan",
        preferredName: "Amelia",
        rank: 1,
      }),
    ).toBeNull();
  });
});

describe("practice scoring", () => {
  it("scores a counting choice server-side and strips the answer key", () => {
    expect(scorePracticeItem(countingItem, { choiceId: "4" })).toEqual({ correct: true, pointsAwarded: 1 });
    expect(scorePracticeItem(countingItem, { choiceId: "3" })).toEqual({ correct: false, pointsAwarded: 0 });
    const client = stripAnswerKey(countingItem);
    expect(client).not.toHaveProperty("correctAnswer");
    expect(JSON.stringify(client)).not.toContain("choiceId");
  });

  it("scores numeric, ordering, matching, and exact text items", () => {
    const numeric: PracticeItem = {
      ...countingItem,
      id: "n",
      itemType: "numeric",
      choices: [],
      correctAnswer: { value: 20 },
    };
    const order: PracticeItem = {
      ...countingItem,
      id: "o",
      itemType: "ordering",
      choices: [
        { id: "1", label: "1" },
        { id: "2", label: "2" },
      ],
      correctAnswer: { order: ["1", "2"] },
    };
    const match: PracticeItem = {
      ...countingItem,
      id: "m",
      itemType: "matching",
      choices: [],
      correctAnswer: { pairs: [["A", "a"]] },
    };
    const text: PracticeItem = {
      ...countingItem,
      id: "t",
      itemType: "short_exact_text",
      choices: [],
      correctAnswer: { text: "Cat", caseInsensitive: true },
    };
    expect(scorePracticeItem(numeric, { value: 20 }).correct).toBe(true);
    expect(scorePracticeItem(numeric, { value: "" }).correct).toBe(false);
    expect(scorePracticeItem(numeric, { value: 0 }).correct).toBe(false);
    expect(scorePracticeItem(order, { order: ["1", "2"] }).correct).toBe(true);
    expect(scorePracticeItem(match, { pairs: [["A", "a"]] }).correct).toBe(true);
    expect(scorePracticeItem(text, { text: "cat" }).correct).toBe(true);
    expect(scorePracticeAttempt([numeric], { n: { value: 19 } }).score).toBe(0);
  });

  it("uses a completion threshold without trusting a client score", () => {
    expect(isCompletedByThreshold(4, 5, 0.8)).toBe(true);
    expect(isCompletedByThreshold(3, 5, 0.8)).toBe(false);
  });
});

describe("achievements and competitions", () => {
  it("awards controlled criteria idempotently at the threshold", () => {
    expect(
      achievementMeetsCriteria("xp_total", 100, {
        assignmentCount: 0,
        assignmentCompletedCount: 0,
        rewardPointsTotal: 0,
        xpTotal: 100,
        attendancePercentage: null,
        attendanceStreak: 0,
        learningActivityCount: 0,
        challengeCompletedCount: 0,
      }),
    ).toBe(true);
    expect(
      achievementMeetsCriteria("manual", 1, {
        assignmentCount: 9,
        assignmentCompletedCount: 9,
        rewardPointsTotal: 9,
        xpTotal: 9,
        attendancePercentage: 100,
        attendanceStreak: 9,
        learningActivityCount: 9,
        challengeCompletedCount: 9,
      }),
    ).toBe(false);
  });

  it("freezes completed competitions against reopen", () => {
    expect(isCompetitionStatusTransitionAllowed("completed", "active")).toBe(false);
    expect(isCompetitionStatusTransitionAllowed("active", "completed")).toBe(true);
  });
});
