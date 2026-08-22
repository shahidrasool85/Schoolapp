import { describe, expect, it } from "vitest";
import {
  isAllowedLearningUrl,
  isAssignmentStatusTransitionAllowed,
  isScoreInRange,
  isSubmissionStatusTransitionAllowed,
  learningNotificationBody,
  parentLearningStatus,
  pupilCanSubmitFrom,
  studentLearningBuckets,
  summariseLearningProgress,
} from "./learning.js";

describe("learning assignment lifecycle", () => {
  it("allows draft to published and published to closed, not published to draft", () => {
    expect(isAssignmentStatusTransitionAllowed("draft", "published")).toBe(true);
    expect(isAssignmentStatusTransitionAllowed("published", "closed")).toBe(true);
    expect(isAssignmentStatusTransitionAllowed("published", "draft")).toBe(false);
    expect(isAssignmentStatusTransitionAllowed("archived", "draft")).toBe(false);
  });
});

describe("learning submission lifecycle", () => {
  it("lets a pupil submit from not_started or resubmission_requested, not from completed", () => {
    expect(pupilCanSubmitFrom("not_started")).toBe(true);
    expect(pupilCanSubmitFrom("resubmission_requested")).toBe(true);
    expect(pupilCanSubmitFrom("completed")).toBe(false);
    expect(isSubmissionStatusTransitionAllowed("submitted", "resubmission_requested")).toBe(true);
    expect(isSubmissionStatusTransitionAllowed("completed", "submitted")).toBe(false);
  });
});

describe("learning visibility buckets", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");

  it("hides draft work from pupils", () => {
    expect(
      studentLearningBuckets({
        assignmentStatus: "draft",
        availableFrom: null,
        dueAt: "2026-09-12T12:00:00.000Z",
        submissionStatus: null,
        releasedToStudent: false,
        now,
      }),
    ).toEqual([]);
  });

  it("classifies assigned, due soon, overdue, returned and completed", () => {
    expect(
      studentLearningBuckets({
        assignmentStatus: "published",
        availableFrom: null,
        dueAt: "2026-09-11T12:00:00.000Z",
        submissionStatus: "not_started",
        releasedToStudent: false,
        now,
      }),
    ).toEqual(["assigned", "due_soon"]);
    expect(
      studentLearningBuckets({
        assignmentStatus: "published",
        availableFrom: null,
        dueAt: "2026-09-01T12:00:00.000Z",
        submissionStatus: null,
        releasedToStudent: false,
        now,
      }),
    ).toEqual(["assigned", "overdue"]);
    expect(
      studentLearningBuckets({
        assignmentStatus: "published",
        availableFrom: null,
        dueAt: "2026-09-01T12:00:00.000Z",
        submissionStatus: "returned",
        releasedToStudent: true,
        now,
      }),
    ).toEqual(["submitted", "returned"]);
    expect(
      studentLearningBuckets({
        assignmentStatus: "published",
        availableFrom: null,
        dueAt: "2026-09-01T12:00:00.000Z",
        submissionStatus: "resubmission_requested",
        releasedToStudent: true,
        now,
      }),
    ).toEqual(["submitted", "returned"]);
    expect(
      studentLearningBuckets({
        assignmentStatus: "closed",
        availableFrom: null,
        dueAt: "2026-09-01T12:00:00.000Z",
        submissionStatus: "completed",
        releasedToStudent: true,
        now,
      }),
    ).toEqual(["submitted", "returned", "completed"]);
  });

  it("keeps unreleased feedback out of the returned bucket", () => {
    expect(
      studentLearningBuckets({
        assignmentStatus: "published",
        availableFrom: null,
        dueAt: null,
        submissionStatus: "returned",
        releasedToStudent: false,
        now,
      }),
    ).toEqual(["submitted"]);
  });
});

describe("learning helpers", () => {
  it("summarises teacher progress counts", () => {
    expect(summariseLearningProgress({ assigned: 28, submitted: 22, marked: 15 })).toEqual({
      assigned: 28,
      submitted: 22,
      notSubmitted: 6,
      marked: 15,
      awaitingMarking: 7,
    });
  });

  it("rejects private and non-http URLs", () => {
    expect(isAllowedLearningUrl("https://example.com/worksheet.pdf")).toBe(true);
    expect(isAllowedLearningUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedLearningUrl("https://localhost/secret")).toBe(false);
    expect(isAllowedLearningUrl("https://192.168.0.5/file")).toBe(false);
  });

  it("enforces score ranges", () => {
    expect(isScoreInRange(18, 20)).toBe(true);
    expect(isScoreInRange(21, 20)).toBe(false);
    expect(isScoreInRange(-1, 20)).toBe(false);
    expect(isScoreInRange(null, 20)).toBe(true);
  });

  it("maps parent status without exposing marks", () => {
    expect(
      parentLearningStatus({
        dueAt: "2026-09-01T00:00:00.000Z",
        submissionStatus: "not_started",
        now: new Date("2026-09-10T00:00:00.000Z"),
      }),
    ).toBe("overdue");
    expect(
      parentLearningStatus({
        dueAt: "2026-09-20T00:00:00.000Z",
        submissionStatus: "submitted",
        now: new Date("2026-09-10T00:00:00.000Z"),
      }),
    ).toBe("submitted");
  });

  it("keeps notification bodies free of private notes", () => {
    expect(learningNotificationBody("assigned", "Year 5 Fractions")).toBe(
      "New learning work: Year 5 Fractions",
    );
    expect(learningNotificationBody("feedback", "Year 5 Fractions")).not.toMatch(/mark|score|note/i);
  });
});
