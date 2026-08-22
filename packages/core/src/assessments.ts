import {
  ACADEMIC_REPORT_STATUSES,
  FORMAL_ASSESSMENT_STATUSES,
  FORMAL_ASSESSMENT_TYPE_KEYS,
  GRADE_SCHEME_KINDS,
  REPORTING_PERIOD_STATUSES,
  RESULT_REVIEW_STATUSES,
  type AcademicReportStatus,
  type FormalAssessmentStatus,
  type FormalAssessmentTypeKey,
  type GradeSchemeKind,
  type ReportingPeriodStatus,
  type ResultReviewStatus,
} from "@schoolapp/domain";

const ASSESSMENT_TRANSITIONS: Record<FormalAssessmentStatus, readonly FormalAssessmentStatus[]> = {
  draft: ["open", "archived"],
  open: ["completed", "archived"],
  completed: ["reviewed", "published", "open"],
  reviewed: ["published", "completed"],
  published: ["archived"],
  archived: ["published"],
};

const REPORT_TRANSITIONS: Record<AcademicReportStatus, readonly AcademicReportStatus[]> = {
  draft: ["submitted_for_review", "published", "archived"],
  submitted_for_review: ["approved", "draft"],
  approved: ["published", "draft"],
  published: ["archived"],
  archived: ["published"],
};

export function isFormalAssessmentStatus(value: string): value is FormalAssessmentStatus {
  return (FORMAL_ASSESSMENT_STATUSES as readonly string[]).includes(value);
}

export function isFormalAssessmentTypeKey(value: string): value is FormalAssessmentTypeKey {
  return (FORMAL_ASSESSMENT_TYPE_KEYS as readonly string[]).includes(value);
}

export function isGradeSchemeKind(value: string): value is GradeSchemeKind {
  return (GRADE_SCHEME_KINDS as readonly string[]).includes(value);
}

export function isResultReviewStatus(value: string): value is ResultReviewStatus {
  return (RESULT_REVIEW_STATUSES as readonly string[]).includes(value);
}

export function isReportingPeriodStatus(value: string): value is ReportingPeriodStatus {
  return (REPORTING_PERIOD_STATUSES as readonly string[]).includes(value);
}

export function isAcademicReportStatus(value: string): value is AcademicReportStatus {
  return (ACADEMIC_REPORT_STATUSES as readonly string[]).includes(value);
}

export function isAssessmentStatusTransitionAllowed(
  from: FormalAssessmentStatus,
  to: FormalAssessmentStatus,
): boolean {
  if (from === to) return true;
  return ASSESSMENT_TRANSITIONS[from].includes(to);
}

export function isReportStatusTransitionAllowed(
  from: AcademicReportStatus,
  to: AcademicReportStatus,
): boolean {
  if (from === to) return true;
  return REPORT_TRANSITIONS[from].includes(to);
}

export function canEnterResultsOnAssessment(status: string): boolean {
  return status === "open" || status === "completed" || status === "reviewed";
}

export function isFormalResultVisibleToAudience(
  input: {
    assessmentPublishedAt: string | Date | null;
    releasedToStudent: boolean;
    releasedToParent: boolean;
  },
  audience: "student" | "parent",
): boolean {
  if (!input.assessmentPublishedAt) return false;
  return audience === "student" ? input.releasedToStudent : input.releasedToParent;
}

export function isScoreWithinMaximum(
  rawScore: number | null | undefined,
  maximumScore: number | null | undefined,
): boolean {
  if (rawScore == null) return true;
  if (rawScore < 0) return false;
  if (maximumScore == null) return true;
  return rawScore <= maximumScore;
}

export function computePercentage(
  rawScore: number | null | undefined,
  maximumScore: number | null | undefined,
): number | null {
  if (rawScore == null || maximumScore == null || maximumScore <= 0) return null;
  return Math.round((rawScore / maximumScore) * 10000) / 100;
}

export type ProgressPoint = {
  assessmentId: string;
  assessmentDate: string;
  subjectId: string;
  percentage: number | null;
  numericValue: number | null;
  gradeLabel: string | null;
  teacherJudgement: string | null;
};

export type SubjectProgressSummary = {
  subjectId: string;
  latest: ProgressPoint | null;
  previous: ProgressPoint | null;
  trend: {
    kind: "percentage" | "numeric_value" | "unavailable";
    delta: number | null;
    direction: "up" | "down" | "flat" | null;
  };
};

/**
 * Simple progress: latest vs previous result on the same subject.
 * Uses percentage when both results have one; otherwise numeric_value from
 * the grade-scheme level. No opaque composite score. Mixed schemes without
 * comparable numbers yield trend.kind = unavailable.
 */
export function summariseSubjectProgress(points: ProgressPoint[]): SubjectProgressSummary | null {
  if (points.length === 0) return null;
  const ordered = [...points].sort((a, b) => a.assessmentDate.localeCompare(b.assessmentDate));
  const latest = ordered[ordered.length - 1] ?? null;
  const previous = ordered.length > 1 ? ordered[ordered.length - 2]! : null;
  if (!latest) return null;

  let kind: SubjectProgressSummary["trend"]["kind"] = "unavailable";
  let delta: number | null = null;
  if (previous && latest.percentage != null && previous.percentage != null) {
    kind = "percentage";
    delta = Math.round((latest.percentage - previous.percentage) * 100) / 100;
  } else if (previous && latest.numericValue != null && previous.numericValue != null) {
    kind = "numeric_value";
    delta = Math.round((latest.numericValue - previous.numericValue) * 100) / 100;
  }

  let direction: SubjectProgressSummary["trend"]["direction"] = null;
  if (delta != null) {
    direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  }

  return {
    subjectId: latest.subjectId,
    latest,
    previous,
    trend: { kind, delta, direction },
  };
}

export function summariseAssessmentResults(input: {
  isNumeric: boolean;
  percentages: Array<number | null | undefined>;
  gradeLabels: Array<string | null | undefined>;
  reviewStatuses: string[];
  includedCount: number;
}): {
  numberAssessed: number;
  missingResults: number;
  averagePercentage: number | null;
  gradeDistribution: Array<{ label: string; count: number }>;
  reviewedCount: number;
  unreviewedCount: number;
} {
  const assessed = input.percentages.length;
  const numeric = input.percentages.filter((value): value is number => value != null);
  const averagePercentage =
    input.isNumeric && numeric.length > 0
      ? Math.round((numeric.reduce((sum, value) => sum + value, 0) / numeric.length) * 100) / 100
      : null;
  const distribution = new Map<string, number>();
  for (const label of input.gradeLabels) {
    if (!label) continue;
    distribution.set(label, (distribution.get(label) ?? 0) + 1);
  }
  const reviewedCount = input.reviewStatuses.filter(
    (status) => status === "reviewed" || status === "approved",
  ).length;
  return {
    numberAssessed: assessed,
    missingResults: Math.max(0, input.includedCount - assessed),
    averagePercentage,
    gradeDistribution: [...distribution.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    reviewedCount,
    unreviewedCount: assessed - reviewedCount,
  };
}

export function academicNotificationBody(kind: "result_published" | "report_available", title: string): string {
  if (kind === "result_published") {
    return `A formal assessment result is available: ${title}`;
  }
  return `A progress report is available: ${title}`;
}
