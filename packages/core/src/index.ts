export {
  canReadStudentProfile,
  canReadRestrictedContact,
  assignedStudentIds,
  isAssignedToClass,
  assignedClassIds,
  classStudentIdsAsOf,
  guardianChildIds,
  canListAllStudents,
  canManageStudents,
  canManageAcademicStructure,
  canReadAcademicStructure,
} from "./students-access.js";

export { assertPermission, assertAnyPermission, notFound } from "./permissions.js";

export {
  ADMISSIONS_READ_PERMISSIONS,
  canReadAdmissions,
  canManageEnquiries,
  canManageApplications,
  canManageOffers,
  canDecideAdmissions,
  canConvertAdmissions,
  allowedApplicationTransitions,
  isApplicationStatusTransitionAllowed,
  transitionRequiresDecide,
  assertApplicationStatusTransition,
  createInboxNotification,
  auditAdmissions,
} from "./admissions.js";

export { AppError, pgErrorToAppError } from "./errors.js";

export {
  normalizePlatformDomain,
  parseHostHeader,
  selectRequestHost,
  firstForwardedHost,
  classifyHostname,
  schoolPublicHostname,
  originForHostname,
  formatHostname,
  type ParsedHost,
  type HostClassification,
} from "./hostname.js";

export {
  bindOrganisationHint,
  headerMatchesHostSlug,
  type BoundOrganisation,
} from "./tenancy.js";

export {
  writeAudit,
  currentAcademicYear,
  endDatedRow,
  isoDate,
} from "./academic.js";

export {
  comingLater,
  PORTAL_STUDENT_SQL,
  mapPortalStudent,
  portalChildSummary,
  loadSchool,
  loadPortalStudentsByIds,
  loadPortalStudent,
  loadOwnStudentProfile,
  requireLinkedChild,
  loadViewerGuardianship,
  PARENT_CHILD_SECTIONS,
  STUDENT_DASHBOARD_SECTIONS,
} from "./portal.js";

export {
  mapNotification,
  listInboxNotifications,
  countUnreadNotifications,
  markNotificationRead,
} from "./notifications.js";

export {
  isAttendanceCategory,
  roundAttendancePercentage,
  attendancePercentage,
  summariseAttendanceMarks,
  emptyAttendanceSummary,
  type AttendanceSummary,
} from "./attendance.js";

export {
  resolveStudentPortalAccess,
  yearGroupPortalEffective,
  type StudentPortalPolicyInput,
  type StudentPortalDecision,
} from "./student-portal.js";

export {
  ATTENDANCE_SCHOOL_READ_PERMISSIONS,
  ATTENDANCE_REGISTER_PERMISSIONS,
  canReadSchoolAttendance,
  canManageSchoolAttendance,
  canCorrectAttendance,
  canManageAssignedAttendance,
  canManageAttendanceConfig,
  canReadOwnChildrenAttendance,
  canReadOwnAttendance,
  assertCanAccessRegister,
  assertCanReadStudentAttendance,
  loadStudentPortalDecision,
  requireStudentPortalEnabled,
  studentDocumentVisibleToAudience,
  buildStudentDocumentKey,
} from "./attendance-access.js";

export {
  isLearningAssignmentStatus,
  isLearningSubmissionStatus,
  isLearningTargetType,
  isLearningResourceKind,
  isLearningWorkTypeKey,
  isLearningStudentBucket,
  isAssignmentStatusTransitionAllowed,
  isSubmissionStatusTransitionAllowed,
  pupilCanSubmitFrom,
  pupilCanSaveDraftFrom,
  pupilCanWriteOnAssignment,
  isAllowedLearningUrl,
  isScoreInRange,
  summariseLearningProgress,
  isLearningVisibleToPupil,
  studentLearningBuckets,
  parentLearningStatus,
  learningNotificationBody,
  type LearningProgressCounts,
  type StudentLearningVisibilityInput,
} from "./learning.js";

export {
  LMS_SCHOOL_READ_PERMISSIONS,
  LMS_ASSIGN_PERMISSIONS,
  LMS_READ_WORK_PERMISSIONS,
  LMS_READ_SUBMISSION_PERMISSIONS,
  LMS_MARK_PERMISSIONS,
  canManageSchoolLearning,
  canReadSchoolLearning,
  canManageAssignedLearning,
  canReadAssignedLearning,
  canMarkSchoolLearning,
  canMarkAssignedLearning,
  canReadOwnChildrenLearning,
  canReadOwnLearning,
  assertCanManageLearningWork,
  assertCanAccessClassForLearning,
  assertCanTargetClass,
  assertCanTargetStudent,
  assertCanTargetYearGroup,
  loadAuthorisedLearningClassIds,
  loadAuthorisedLearningStudentIds,
  assertCanReadAssignment,
  assertCanManageAssignment,
  assertCanReadOrMarkSubmission,
  canSeeLearningRecipient,
  resolveTargetRecipients,
  snapshotAssignmentRecipients,
  notifyLearningAssigned,
  notifyLearningFeedback,
  buildLearningResourceKey,
  buildSubmissionAttachmentKey,
} from "./learning-access.js";
