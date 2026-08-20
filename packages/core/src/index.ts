export {
  canReadStudentProfile,
  canReadRestrictedContact,
  assignedStudentIds,
  isAssignedToClass,
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
