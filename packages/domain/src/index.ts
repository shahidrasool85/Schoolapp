export {
  SLUG_MIN_LENGTH,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  RESERVED_SUBDOMAINS,
  RESERVED_SUBDOMAIN_SET,
  BLOCKED_CUSTOM_HOSTNAME_TLDS,
  BLOCKED_CUSTOM_HOSTNAME_TLD_SET,
  isBlockedCustomHostname,
  normalizeSlugInput,
  isReservedSubdomain,
  validateOrganisationSlug,
  slugValidationMessage,
  type SlugValidationError,
} from "./slugs.js";

export const PERMISSIONS = {
  PLATFORM_ORGANISATIONS_MANAGE: "platform.organisations.manage",
  PLATFORM_SUPPORT_ACCESS_MANAGE: "platform.support_access.manage",
  ORG_SETTINGS_READ: "org.settings.read",
  ORG_SETTINGS_MANAGE: "org.settings.manage",
  ORG_MEMBERS_READ: "org.members.read",
  ORG_MEMBERS_MANAGE: "org.members.manage",
  ORG_ROLES_MANAGE: "org.roles.manage",
  ORG_SUPPORT_ACCESS_READ: "org.support_access.read",
  ORG_BILLING_READ: "org.billing.read",
  ACADEMIC_STRUCTURE_READ: "academic.structure.read",
  ACADEMIC_STRUCTURE_MANAGE: "academic.structure.manage",
  ADMISSIONS_READ: "admissions.read",
  ADMISSIONS_ENQUIRIES_MANAGE: "admissions.enquiries.manage",
  ADMISSIONS_APPLICATIONS_MANAGE: "admissions.applications.manage",
  ADMISSIONS_OFFERS_MANAGE: "admissions.offers.manage",
  ADMISSIONS_DECIDE: "admissions.decide",
  ADMISSIONS_CONVERT: "admissions.convert",
  STUDENTS_PROFILES_READ: "students.profiles.read",
  STUDENTS_PROFILES_READ_ASSIGNED: "students.profiles.read_assigned",
  STUDENTS_PROFILES_MANAGE: "students.profiles.manage",
  STUDENTS_PROFILES_READ_OWN_CHILDREN: "students.profiles.read_own_children",
  STUDENTS_PROFILES_READ_SELF: "students.profiles.read_self",
  STUDENTS_RESTRICTED_CONTACT_READ: "students.restricted_contact.read",
  GUARDIANSHIPS_MANAGE: "guardianships.manage",
  ATTENDANCE_RECORD_READ: "attendance.record.read",
  ATTENDANCE_RECORD_MANAGE: "attendance.record.manage",
  ATTENDANCE_RECORD_MANAGE_ASSIGNED: "attendance.record.manage_assigned",
  ATTENDANCE_RECORD_CORRECT: "attendance.record.correct",
  ATTENDANCE_RECORD_READ_OWN_CHILDREN: "attendance.record.read_own_children",
  ATTENDANCE_RECORD_READ_SELF: "attendance.record.read_self",
  ATTENDANCE_CONFIG_MANAGE: "attendance.config.manage",
  STUDENTS_PORTAL_ACCESS_MANAGE: "students.portal_access.manage",
  STUDENTS_DOCUMENTS_READ: "students.documents.read",
  STUDENTS_DOCUMENTS_MANAGE: "students.documents.manage",
  STUDENTS_DOCUMENTS_READ_OWN_CHILDREN: "students.documents.read_own_children",
  STUDENTS_DOCUMENTS_READ_SELF: "students.documents.read_self",
  NOTIFICATIONS_INBOX_READ: "notifications.inbox.read",
  AUDIT_READ: "audit.read",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS] | string;

export const SYSTEM_ROLE_KEYS = [
  "school.admin",
  "school.headteacher",
  "school.teacher",
  "school.admissions",
  "school.staff",
  "school.parent",
  "school.student",
] as const;

export const STAFF_ROLE_KEYS = [
  "school.admin",
  "school.headteacher",
  "school.teacher",
  "school.admissions",
  "school.staff",
] as const;

export type UserKind = "platform_admin" | "staff" | "parent" | "student";

export type Actor = {
  userId: string;
  userKind: UserKind;
  isPlatformAdmin: boolean;
  organisationId: string | null;
  membershipId: string | null;
  roleKeys: string[];
  permissions: ReadonlySet<string>;
  supportAccessGrantId: string | null;
};

export function actorHas(actor: Actor, permission: string): boolean {
  return actor.permissions.has(permission);
}

export function actorHasAny(actor: Actor, permissions: readonly string[]): boolean {
  return permissions.some((permission) => actor.permissions.has(permission));
}

export const YEAR_GROUP_CODES = [
  "N",
  "R",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
] as const;

export type YearGroupCode = (typeof YEAR_GROUP_CODES)[number];

export function yearGroupCodeRank(code: string): number | null {
  if (code === "N") return -1;
  if (code === "R") return 0;
  if (/^[0-9]+$/.test(code)) return Number(code);
  return null;
}

export function yearGroupDisplayName(code: string): string {
  if (code === "N") return "Nursery";
  if (code === "R") return "Reception";
  return `Year ${code}`;
}

export function isYearGroupWithinMaximum(code: string, maxCode: string): boolean {
  const rank = yearGroupCodeRank(code);
  const max = yearGroupCodeRank(maxCode);
  if (rank === null || max === null) return false;
  return rank <= max;
}

export const CLASS_TYPES = ["form", "teaching"] as const;
export type ClassType = (typeof CLASS_TYPES)[number];

export const STAFF_ASSIGNMENT_ROLES = [
  "form_tutor",
  "co_tutor",
  "subject_teacher",
  "head_of_year",
  "other",
] as const;
export type StaffAssignmentRole = (typeof STAFF_ASSIGNMENT_ROLES)[number];

export const ENROLMENT_STATUSES = ["planned", "enrolled", "withdrawn", "completed"] as const;
export type EnrolmentStatus = (typeof ENROLMENT_STATUSES)[number];

export const PLACEMENT_KINDS = ["primary", "secondary", "exceptional"] as const;
export type PlacementKind = (typeof PLACEMENT_KINDS)[number];

export const STUDENT_PROFILE_STATUSES = [
  "prospective",
  "admitted",
  "enrolled",
  "left",
  "alumni",
] as const;
export type StudentProfileStatus = (typeof STUDENT_PROFILE_STATUSES)[number];

export const GUARDIAN_RELATIONSHIPS = [
  "mother",
  "father",
  "carer",
  "step-parent",
  "grandparent",
  "other",
] as const;

export const NOTIFICATION_TYPES = [
  "homework_assigned",
  "homework_due",
  "result_published",
  "teacher_feedback",
  "school_announcement",
  "attendance_concern",
  "competition_challenge",
  "report_available",
  "admissions_update",
  "general",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CATEGORIES = [
  "homework",
  "results",
  "feedback",
  "announcement",
  "attendance",
  "competition",
  "reports",
  "admissions",
  "general",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const ATTENDANCE_CATEGORIES = [
  "present",
  "late",
  "authorised_absence",
  "unauthorised_absence",
  "not_required",
] as const;
export type AttendanceCategory = (typeof ATTENDANCE_CATEGORIES)[number];

export const ATTENDANCE_SESSION_KEYS = ["am", "pm"] as const;
export type AttendanceSessionKey = (typeof ATTENDANCE_SESSION_KEYS)[number];

export const STUDENT_DOCUMENT_TYPES = [
  "report",
  "letter",
  "consent",
  "support",
  "school_record",
  "other",
] as const;
export type StudentDocumentType = (typeof STUDENT_DOCUMENT_TYPES)[number];

export const STUDENT_DOCUMENT_VISIBILITIES = [
  "staff",
  "staff_and_parents",
  "staff_parents_and_student",
] as const;
export type StudentDocumentVisibility = (typeof STUDENT_DOCUMENT_VISIBILITIES)[number];

export const STUDENT_PORTAL_POLICY_SOURCES = ["student", "class", "year_group", "school"] as const;
export type StudentPortalPolicySource = (typeof STUDENT_PORTAL_POLICY_SOURCES)[number];

export const PORTAL_COMING_LATER_MESSAGE = "Coming in a later phase.";

export const ENQUIRY_STATUSES = ["open", "contacted", "converted", "closed", "withdrawn"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const APPLICATION_STATUSES = [
  "enquiry",
  "draft",
  "submitted",
  "under_review",
  "information_required",
  "assessment_pending",
  "assessment_completed",
  "waiting_list",
  "offer_pending",
  "offer_made",
  "accepted",
  "deferred",
  "rejected",
  "withdrawn",
  "enrolled",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const ASSESSMENT_TYPES = [
  "admissions_interview",
  "academic_assessment",
  "school_visit",
  "eleven_plus",
  "other",
] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

export const ASSESSMENT_STATUSES = ["scheduled", "completed", "cancelled", "no_show"] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const ASSESSMENT_RECOMMENDATIONS = [
  "offer",
  "waitlist",
  "reject",
  "further_assessment",
  "defer",
  "undecided",
] as const;
export type AssessmentRecommendation = (typeof ASSESSMENT_RECOMMENDATIONS)[number];

export const WAITING_LIST_STATUSES = ["active", "offered", "removed", "enrolled"] as const;
export type WaitingListStatus = (typeof WAITING_LIST_STATUSES)[number];

export const OFFER_STATUSES = ["made", "accepted", "declined", "expired", "withdrawn"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const APPLICATION_CONTACT_RELATIONSHIPS = [
  "mother",
  "father",
  "carer",
  "step-parent",
  "grandparent",
  "other",
] as const;
