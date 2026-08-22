import { describe, expect, it } from "vitest";
import {
  canEnterResultsOnAssessment,
  computePercentage,
  isAssessmentStatusTransitionAllowed,
  isFormalResultVisibleToAudience,
  isReportStatusTransitionAllowed,
  isScoreWithinMaximum,
  summariseAssessmentResults,
  summariseSubjectProgress,
} from "./assessments.js";

describe("formal assessment lifecycle", () => {
  it("allows draft to open, completed to published without review, and not published to draft", () => {
    expect(isAssessmentStatusTransitionAllowed("draft", "open")).toBe(true);
    expect(isAssessmentStatusTransitionAllowed("open", "completed")).toBe(true);
    expect(isAssessmentStatusTransitionAllowed("completed", "published")).toBe(true);
    expect(isAssessmentStatusTransitionAllowed("completed", "reviewed")).toBe(true);
    expect(isAssessmentStatusTransitionAllowed("reviewed", "published")).toBe(true);
    expect(isAssessmentStatusTransitionAllowed("published", "archived")).toBe(true);
    expect(isAssessmentStatusTransitionAllowed("published", "draft")).toBe(false);
    expect(isAssessmentStatusTransitionAllowed("open", "published")).toBe(false);
    expect(canEnterResultsOnAssessment("open")).toBe(true);
    expect(canEnterResultsOnAssessment("draft")).toBe(false);
    expect(canEnterResultsOnAssessment("published")).toBe(false);
  });
});

describe("report lifecycle", () => {
  it("lets schools skip formal approval and publish from draft", () => {
    expect(isReportStatusTransitionAllowed("draft", "published")).toBe(true);
    expect(isReportStatusTransitionAllowed("draft", "submitted_for_review")).toBe(true);
    expect(isReportStatusTransitionAllowed("submitted_for_review", "approved")).toBe(true);
    expect(isReportStatusTransitionAllowed("approved", "published")).toBe(true);
    expect(isReportStatusTransitionAllowed("published", "draft")).toBe(false);
  });
});

describe("result visibility and scores", () => {
  it("keeps parent and student release independent and requires publish", () => {
    expect(
      isFormalResultVisibleToAudience(
        { assessmentPublishedAt: "2026-10-01", releasedToStudent: true, releasedToParent: false },
        "student",
      ),
    ).toBe(true);
    expect(
      isFormalResultVisibleToAudience(
        { assessmentPublishedAt: "2026-10-01", releasedToStudent: true, releasedToParent: false },
        "parent",
      ),
    ).toBe(false);
    expect(
      isFormalResultVisibleToAudience(
        { assessmentPublishedAt: null, releasedToStudent: true, releasedToParent: true },
        "student",
      ),
    ).toBe(false);
    expect(isScoreWithinMaximum(18, 20)).toBe(true);
    expect(isScoreWithinMaximum(21, 20)).toBe(false);
    expect(computePercentage(18, 20)).toBe(90);
  });
});

describe("progress and summaries", () => {
  it("computes a simple latest-vs-previous percentage trend", () => {
    const summary = summariseSubjectProgress([
      {
        assessmentId: "a1",
        assessmentDate: "2026-10-01",
        subjectId: "maths",
        percentage: 60,
        numericValue: null,
        gradeLabel: null,
        teacherJudgement: null,
      },
      {
        assessmentId: "a2",
        assessmentDate: "2026-12-01",
        subjectId: "maths",
        percentage: 75,
        numericValue: null,
        gradeLabel: null,
        teacherJudgement: null,
      },
    ]);
    expect(summary?.latest?.assessmentId).toBe("a2");
    expect(summary?.previous?.assessmentId).toBe("a1");
    expect(summary?.trend).toEqual({ kind: "percentage", delta: 15, direction: "up" });
  });

  it("does not invent an average for non-numeric schemes", () => {
    const summary = summariseAssessmentResults({
      isNumeric: false,
      percentages: [null, null],
      gradeLabels: ["Expected", "Greater Depth"],
      reviewStatuses: ["entered", "reviewed"],
      includedCount: 3,
    });
    expect(summary.averagePercentage).toBeNull();
    expect(summary.missingResults).toBe(1);
    expect(summary.reviewedCount).toBe(1);
    expect(summary.gradeDistribution).toEqual([
      { label: "Expected", count: 1 },
      { label: "Greater Depth", count: 1 },
    ]);
  });
});
