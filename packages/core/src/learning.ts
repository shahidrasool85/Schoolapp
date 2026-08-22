import {
  LEARNING_ASSIGNMENT_STATUSES,
  LEARNING_RESOURCE_KINDS,
  LEARNING_STUDENT_BUCKETS,
  LEARNING_SUBMISSION_STATUSES,
  LEARNING_TARGET_TYPES,
  LEARNING_WORK_TYPE_KEYS,
  type LearningAssignmentStatus,
  type LearningResourceKind,
  type LearningStudentBucket,
  type LearningSubmissionStatus,
  type LearningTargetType,
} from "@schoolapp/domain";

const ASSIGNMENT_TRANSITIONS: Record<LearningAssignmentStatus, readonly LearningAssignmentStatus[]> = {
  draft: ["published", "archived"],
  published: ["closed", "archived"],
  closed: ["published", "archived"],
  archived: ["closed"],
};

const SUBMISSION_TRANSITIONS: Record<LearningSubmissionStatus, readonly LearningSubmissionStatus[]> = {
  not_started: ["in_progress", "submitted"],
  in_progress: ["submitted"],
  submitted: ["returned", "completed", "resubmission_requested"],
  returned: ["completed", "resubmission_requested"],
  resubmission_requested: ["in_progress", "submitted", "returned", "completed"],
  completed: ["resubmission_requested"],
};

export function isLearningAssignmentStatus(value: string): value is LearningAssignmentStatus {
  return (LEARNING_ASSIGNMENT_STATUSES as readonly string[]).includes(value);
}

export function isLearningSubmissionStatus(value: string): value is LearningSubmissionStatus {
  return (LEARNING_SUBMISSION_STATUSES as readonly string[]).includes(value);
}

export function isLearningTargetType(value: string): value is LearningTargetType {
  return (LEARNING_TARGET_TYPES as readonly string[]).includes(value);
}

export function isLearningResourceKind(value: string): value is LearningResourceKind {
  return (LEARNING_RESOURCE_KINDS as readonly string[]).includes(value);
}

export function isLearningWorkTypeKey(value: string): value is (typeof LEARNING_WORK_TYPE_KEYS)[number] {
  return (LEARNING_WORK_TYPE_KEYS as readonly string[]).includes(value);
}

export function isLearningStudentBucket(value: string): value is LearningStudentBucket {
  return (LEARNING_STUDENT_BUCKETS as readonly string[]).includes(value);
}

export function isAssignmentStatusTransitionAllowed(
  from: LearningAssignmentStatus,
  to: LearningAssignmentStatus,
): boolean {
  if (from === to) return true;
  return ASSIGNMENT_TRANSITIONS[from].includes(to);
}

export function isSubmissionStatusTransitionAllowed(
  from: LearningSubmissionStatus,
  to: LearningSubmissionStatus,
): boolean {
  if (from === to) return true;
  return SUBMISSION_TRANSITIONS[from].includes(to);
}

export function pupilCanSubmitFrom(status: LearningSubmissionStatus): boolean {
  return status === "not_started" || status === "in_progress" || status === "resubmission_requested";
}

export function pupilCanSaveDraftFrom(status: LearningSubmissionStatus): boolean {
  return status === "not_started" || status === "in_progress" || status === "resubmission_requested";
}

export function pupilCanWriteOnAssignment(
  assignmentStatus: string,
  submissionStatus: LearningSubmissionStatus,
  mode: "save" | "submit",
): boolean {
  const allowedFrom = mode === "submit" ? pupilCanSubmitFrom(submissionStatus) : pupilCanSaveDraftFrom(submissionStatus);
  if (!allowedFrom) return false;
  if (assignmentStatus === "published") return true;
  return (
    assignmentStatus === "closed" &&
    (submissionStatus === "resubmission_requested" || submissionStatus === "in_progress")
  );
}

const BLOCKED_URL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

export function isAllowedLearningUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 2000) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_URL_HOSTS.has(host) || host.endsWith(".localhost")) return false;
  if (/^(10\.|192\.168\.|169\.254\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
  return true;
}

export function isScoreInRange(score: number | null | undefined, maximumMarks: number | null | undefined): boolean {
  if (score == null) return true;
  if (score < 0) return false;
  if (maximumMarks != null && score > maximumMarks) return false;
  return true;
}

export type LearningProgressCounts = {
  assigned: number;
  submitted: number;
  notSubmitted: number;
  marked: number;
  awaitingMarking: number;
};

export function summariseLearningProgress(input: {
  assigned: number;
  submitted: number;
  marked: number;
}): LearningProgressCounts {
  const assigned = Math.max(0, input.assigned);
  const submitted = Math.max(0, Math.min(input.submitted, assigned));
  const marked = Math.max(0, Math.min(input.marked, submitted));
  return {
    assigned,
    submitted,
    notSubmitted: assigned - submitted,
    marked,
    awaitingMarking: submitted - marked,
  };
}

export type StudentLearningVisibilityInput = {
  assignmentStatus: string;
  availableFrom: Date | string | null;
  dueAt: Date | string | null;
  submissionStatus: string | null;
  releasedToStudent: boolean;
  now?: Date;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isLearningVisibleToPupil(input: StudentLearningVisibilityInput): boolean {
  if (input.assignmentStatus === "draft") return false;
  if (!["published", "closed", "archived"].includes(input.assignmentStatus)) return false;
  const now = input.now ?? new Date();
  const availableFrom = asDate(input.availableFrom);
  if (availableFrom && availableFrom.getTime() > now.getTime()) return false;
  return true;
}

export function studentLearningBuckets(
  input: StudentLearningVisibilityInput,
): LearningStudentBucket[] {
  if (!isLearningVisibleToPupil(input)) return [];
  const now = input.now ?? new Date();
  const dueAt = asDate(input.dueAt);
  const status = input.submissionStatus ?? "not_started";
  const submitted =
    status === "submitted" ||
    status === "returned" ||
    status === "resubmission_requested" ||
    status === "completed";
  const buckets: LearningStudentBucket[] = [];
  const overdue = Boolean(dueAt && dueAt.getTime() < now.getTime() && !submitted);
  const dueSoon = Boolean(
    dueAt &&
      dueAt.getTime() >= now.getTime() &&
      dueAt.getTime() <= now.getTime() + 72 * 60 * 60 * 1000 &&
      !submitted,
  );

  if (!submitted) buckets.push("assigned");
  if (dueSoon) buckets.push("due_soon");
  if (overdue) buckets.push("overdue");
  if (submitted) buckets.push("submitted");
  if (
    input.releasedToStudent &&
    (status === "returned" || status === "completed" || status === "resubmission_requested")
  ) {
    buckets.push("returned");
  }
  if (input.releasedToStudent && status === "completed") buckets.push("completed");
  return buckets;
}

export function parentLearningStatus(input: {
  dueAt: Date | string | null;
  submissionStatus: string | null;
  releasedToParent?: boolean;
  now?: Date;
}): "submitted" | "not_submitted" | "overdue" | "completed" {
  const status = input.submissionStatus ?? "not_started";
  if (status === "completed" && input.releasedToParent) return "completed";
  if (
    status === "submitted" ||
    status === "returned" ||
    status === "resubmission_requested" ||
    status === "completed"
  ) {
    return "submitted";
  }
  const now = input.now ?? new Date();
  const dueAt = asDate(input.dueAt);
  if (dueAt && dueAt.getTime() < now.getTime()) return "overdue";
  return "not_submitted";
}

export function learningNotificationBody(kind: "assigned" | "due" | "feedback" | "resubmission", title: string): string {
  const safeTitle = title.trim().slice(0, 80) || "Learning work";
  switch (kind) {
    case "assigned":
      return `New learning work: ${safeTitle}`;
    case "due":
      return `Due soon: ${safeTitle}`;
    case "feedback":
      return `Feedback is available for ${safeTitle}`;
    case "resubmission":
      return `Please resubmit: ${safeTitle}`;
  }
}
