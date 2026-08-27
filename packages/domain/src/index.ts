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
  ADMISSIONS_FORMS_READ: "admissions.forms.read",
  ADMISSIONS_FORMS_MANAGE: "admissions.forms.manage",
  ADMISSIONS_CAMPAIGNS_READ: "admissions.campaigns.read",
  ADMISSIONS_CAMPAIGNS_MANAGE: "admissions.campaigns.manage",
  ADMISSIONS_PUBLIC_SUBMISSIONS_READ: "admissions.public_submissions.read",
  STUDENTS_ADDITIONAL_NEEDS_READ: "students.additional_needs.read",
  STUDENTS_ADDITIONAL_NEEDS_MANAGE: "students.additional_needs.manage",
  STUDENTS_MEDICATIONS_READ_OPERATIONAL: "students.medications.read_operational",
  STUDENTS_DIETARY_READ_OPERATIONAL: "students.dietary.read_operational",
  STUDENTS_MEDICATIONS_READ_OWN_CHILDREN: "students.medications.read_own_children",
  STUDENTS_DIETARY_READ_OWN_CHILDREN: "students.dietary.read_own_children",
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
  LMS_ASSIGNMENTS_READ: "lms.assignments.read",
  LMS_ASSIGNMENTS_READ_ASSIGNED: "lms.assignments.read_assigned",
  LMS_ASSIGNMENTS_MANAGE: "lms.assignments.manage",
  LMS_ASSIGNMENTS_MANAGE_ASSIGNED: "lms.assignments.manage_assigned",
  LMS_ASSIGNMENTS_READ_OWN_CHILDREN: "lms.assignments.read_own_children",
  LMS_ASSIGNMENTS_READ_SELF: "lms.assignments.read_self",
  LMS_SUBMISSIONS_READ: "lms.submissions.read",
  LMS_SUBMISSIONS_READ_ASSIGNED: "lms.submissions.read_assigned",
  LMS_SUBMISSIONS_MARK: "lms.submissions.mark",
  LMS_SUBMISSIONS_MARK_ASSIGNED: "lms.submissions.mark_assigned",
  LMS_SUBMISSIONS_SUBMIT: "lms.submissions.submit",
  LMS_SUBMISSIONS_READ_SELF: "lms.submissions.read_self",
  LMS_SUBMISSIONS_READ_OWN_CHILDREN: "lms.submissions.read_own_children",
  LMS_RESOURCES_READ: "lms.resources.read",
  LMS_RESOURCES_MANAGE: "lms.resources.manage",
  LMS_RESOURCES_MANAGE_ASSIGNED: "lms.resources.manage_assigned",
  ASSESSMENTS_READ: "assessments.read",
  ASSESSMENTS_READ_ASSIGNED: "assessments.read_assigned",
  ASSESSMENTS_MANAGE: "assessments.manage",
  ASSESSMENTS_MANAGE_ASSIGNED: "assessments.manage_assigned",
  RESULTS_READ: "results.read",
  RESULTS_READ_ASSIGNED: "results.read_assigned",
  RESULTS_ENTER: "results.enter",
  RESULTS_ENTER_ASSIGNED: "results.enter_assigned",
  RESULTS_REVIEW: "results.review",
  RESULTS_PUBLISH: "results.publish",
  RESULTS_READ_OWN_CHILDREN: "results.read_own_children",
  RESULTS_READ_SELF: "results.read_self",
  REPORTS_READ: "reports.read",
  REPORTS_READ_ASSIGNED: "reports.read_assigned",
  REPORTS_MANAGE: "reports.manage",
  REPORTS_MANAGE_ASSIGNED: "reports.manage_assigned",
  REPORTS_REVIEW: "reports.review",
  REPORTS_PUBLISH: "reports.publish",
  REPORTS_READ_OWN_CHILDREN: "reports.read_own_children",
  REPORTS_READ_SELF: "reports.read_self",
  ACADEMIC_OVERSIGHT: "academic.oversight",
  NOTIFICATIONS_INBOX_READ: "notifications.inbox.read",
  ANNOUNCEMENTS_READ: "announcements.read",
  ANNOUNCEMENTS_READ_ASSIGNED: "announcements.read_assigned",
  ANNOUNCEMENTS_MANAGE: "announcements.manage",
  ANNOUNCEMENTS_MANAGE_ASSIGNED: "announcements.manage_assigned",
  ANNOUNCEMENTS_PUBLISH: "announcements.publish",
  ANNOUNCEMENTS_BROADCAST: "announcements.broadcast",
  ANNOUNCEMENTS_ACKNOWLEDGEMENTS_READ: "announcements.acknowledgements.read",
  ANNOUNCEMENTS_READ_OWN_CHILDREN: "announcements.read_own_children",
  ANNOUNCEMENTS_READ_SELF: "announcements.read_self",
  CALENDAR_READ: "calendar.read",
  CALENDAR_READ_ASSIGNED: "calendar.read_assigned",
  CALENDAR_MANAGE: "calendar.manage",
  CALENDAR_MANAGE_ASSIGNED: "calendar.manage_assigned",
  CALENDAR_MANAGE_SCHOOL: "calendar.manage_school",
  CALENDAR_READ_OWN_CHILDREN: "calendar.read_own_children",
  CALENDAR_READ_SELF: "calendar.read_self",
  BEHAVIOUR_READ: "behaviour.read",
  BEHAVIOUR_RECORD: "behaviour.record",
  BEHAVIOUR_MANAGE: "behaviour.manage",
  BEHAVIOUR_READ_ASSIGNED: "behaviour.read_assigned",
  BEHAVIOUR_POSITIVE_RECORD: "behaviour.positive.record",
  PASTORAL_READ: "pastoral.read",
  PASTORAL_MANAGE: "pastoral.manage",
  PASTORAL_READ_ASSIGNED: "pastoral.read_assigned",
  SAFEGUARDING_READ: "safeguarding.read",
  SAFEGUARDING_RECORD: "safeguarding.record",
  SAFEGUARDING_MANAGE: "safeguarding.manage",
  SAFEGUARDING_ASSIGN: "safeguarding.assign",
  TIMETABLE_READ: "timetable.read",
  TIMETABLE_READ_ASSIGNED: "timetable.read_assigned",
  TIMETABLE_MANAGE: "timetable.manage",
  TIMETABLE_MANAGE_SCHOOL: "timetable.manage_school",
  TIMETABLE_ROOMS_READ: "timetable.rooms.read",
  TIMETABLE_ROOMS_MANAGE: "timetable.rooms.manage",
  TIMETABLE_COVER_READ: "timetable.cover.read",
  TIMETABLE_COVER_MANAGE: "timetable.cover.manage",
  TIMETABLE_READ_OWN_CHILDREN: "timetable.read_own_children",
  TIMETABLE_READ_SELF: "timetable.read_self",
  ACTIVITIES_READ: "activities.read",
  ACTIVITIES_READ_ASSIGNED: "activities.read_assigned",
  ACTIVITIES_MANAGE: "activities.manage",
  ACTIVITIES_MANAGE_ASSIGNED: "activities.manage_assigned",
  ACTIVITIES_PUBLISH: "activities.publish",
  ACTIVITIES_PARTICIPANTS_READ: "activities.participants.read",
  ACTIVITIES_PARTICIPANTS_MANAGE: "activities.participants.manage",
  ACTIVITIES_RESPONSES_READ: "activities.responses.read",
  ACTIVITIES_RESPONSES_MANAGE: "activities.responses.manage",
  ACTIVITIES_MEDICAL_SUMMARY_READ: "activities.medical_summary.read",
  ACTIVITIES_READ_OWN_CHILDREN: "activities.read_own_children",
  ACTIVITIES_READ_SELF: "activities.read_self",
  FINANCE_CHARGES_READ: "finance.charges.read",
  FINANCE_CHARGES_MANAGE: "finance.charges.manage",
  FINANCE_TRANSACTIONS_READ: "finance.transactions.read",
  FINANCE_PAYMENTS_RECORD_OFFLINE: "finance.payments.record_offline",
  FINANCE_REFUNDS_MANAGE: "finance.refunds.manage",
  FINANCE_ADJUSTMENTS_MANAGE: "finance.adjustments.manage",
  FINANCE_REPORTS_READ: "finance.reports.read",
  FINANCE_READ_OWN_CHILDREN: "finance.read_own_children",
  MESSAGING_READ: "messaging.read",
  MESSAGING_READ_ASSIGNED: "messaging.read_assigned",
  MESSAGING_CREATE: "messaging.create",
  MESSAGING_CREATE_ASSIGNED: "messaging.create_assigned",
  MESSAGING_MANAGE: "messaging.manage",
  MESSAGING_MODERATE: "messaging.moderate",
  MESSAGING_READ_OWN_CHILDREN: "messaging.read_own_children",
  MESSAGING_REPLY_OWN: "messaging.reply_own",
  MESSAGING_STAFF_INTERNAL: "messaging.staff_internal",
  MESSAGING_ADMISSIONS: "messaging.admissions",
  STATUTORY_READ: "statutory.read",
  STATUTORY_MANAGE: "statutory.manage",
  STATUTORY_VALIDATE: "statutory.validate",
  STATUTORY_CENSUS_CREATE: "statutory.census.create",
  STATUTORY_CENSUS_FINALISE: "statutory.census.finalise",
  STATUTORY_CENSUS_EXPORT: "statutory.census.export",
  REPORTS_PUPILS_READ: "reports.pupils.read",
  REPORTS_ATTENDANCE_READ: "reports.attendance.read",
  REPORTS_ADMISSIONS_READ: "reports.admissions.read",
  REPORTS_SEND_READ: "reports.send.read",
  REPORTS_EXPORTS_CREATE: "reports.exports.create",
  PUPILS_STATUTORY_READ: "pupils.statutory.read",
  PUPILS_STATUTORY_MANAGE: "pupils.statutory.manage",
  ENGAGEMENT_SETTINGS_READ: "engagement.settings.read",
  ENGAGEMENT_SETTINGS_MANAGE: "engagement.settings.manage",
  REWARDS_READ: "rewards.read",
  REWARDS_READ_ASSIGNED: "rewards.read_assigned",
  REWARDS_AWARD: "rewards.award",
  REWARDS_AWARD_ASSIGNED: "rewards.award_assigned",
  REWARDS_MANAGE: "rewards.manage",
  REWARDS_READ_SELF: "rewards.read_self",
  REWARDS_READ_OWN_CHILDREN: "rewards.read_own_children",
  ACHIEVEMENTS_READ: "achievements.read",
  ACHIEVEMENTS_READ_ASSIGNED: "achievements.read_assigned",
  ACHIEVEMENTS_MANAGE: "achievements.manage",
  ACHIEVEMENTS_AWARD_ASSIGNED: "achievements.award_assigned",
  ACHIEVEMENTS_READ_SELF: "achievements.read_self",
  ACHIEVEMENTS_READ_OWN_CHILDREN: "achievements.read_own_children",
  COMPETITIONS_READ: "competitions.read",
  COMPETITIONS_READ_ASSIGNED: "competitions.read_assigned",
  COMPETITIONS_MANAGE: "competitions.manage",
  COMPETITIONS_MANAGE_SCHOOL: "competitions.manage_school",
  COMPETITIONS_READ_SELF: "competitions.read_self",
  COMPETITIONS_READ_OWN_CHILDREN: "competitions.read_own_children",
  LEARNING_PRACTICE_READ: "learning.practice.read",
  LEARNING_PRACTICE_READ_ASSIGNED: "learning.practice.read_assigned",
  LEARNING_PRACTICE_MANAGE: "learning.practice.manage",
  LEARNING_PRACTICE_MANAGE_ASSIGNED: "learning.practice.manage_assigned",
  LEARNING_PRACTICE_SUBMIT_SELF: "learning.practice.submit_self",
  LEARNING_PRACTICE_READ_SELF: "learning.practice.read_self",
  LEARNING_PRACTICE_READ_OWN_CHILDREN: "learning.practice.read_own_children",
  LEARNING_PRACTICE_SUBMIT_OWN_CHILDREN: "learning.practice.submit_own_children",
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

/**
 * Display-only labels for the authenticated staff persona.
 * Do not use these strings for authorisation — permission keys remain authoritative.
 */
export const STAFF_PERSONA_LABELS = {
  "school.headteacher": "Headteacher",
  "school.admin": "School Admin",
  "school.admissions": "Admissions Staff",
  "school.teacher": "Teacher",
  "school.staff": "School Staff",
} as const;

const STAFF_PERSONA_PRECEDENCE = [
  "school.headteacher",
  "school.admin",
  "school.admissions",
  "school.teacher",
  "school.staff",
] as const satisfies ReadonlyArray<keyof typeof STAFF_PERSONA_LABELS>;

export function staffPersonaLabel(roleKeys: readonly string[]): string {
  for (const key of STAFF_PERSONA_PRECEDENCE) {
    if (roleKeys.includes(key)) {
      return STAFF_PERSONA_LABELS[key];
    }
  }
  return "Staff";
}

export {
  parseNavHref,
  navHrefSpecificity,
  navHrefMatches,
  isActiveNavHref,
  isNavSectionOpen,
  staffDashboardKind,
  statusTone,
  formatStatusLabel,
  hasAnyPermission,
  hasPermissionPrefix,
  type NavHref,
  type StatusTone,
} from "./ui.js";

export { captureSubmitTarget, resetFormSafely } from "./forms.js";

export {
  PUPIL_RECORD_TABS,
  describeEnrolmentChange,
  enrolmentFormInitialState,
  filterFormClasses,
  formatPupilAddress,
  guardianAccountLabel,
  isSamePrimaryPlacement,
  lookedAfterPersistValue,
  mapOperationalGenderToStatutorySex,
  parsePupilRecordTab,
  portalAccessGranted,
  portalAccessLabel,
  pupilIdentityGaps,
  pupilRecordHashCanonicalize,
  resolvePupilRecordTab,
  selectedEnrolmentClassId,
  sensitiveSelectValue,
  statutoryIssueFix,
  upnValidationMessage,
  visiblePupilRecordTabs,
  type LookedAfterPersistValue,
  type OperationalGender,
  type PupilRecordTab,
} from "./pupil-record.js";

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
  "learning_assigned",
  "learning_due",
  "learning_feedback",
  "learning_resubmission",
  "announcement_published",
  "announcement_important",
  "announcement_acknowledgement",
  "calendar_upcoming",
  "pastoral_assigned",
  "safeguarding_assigned",
  "pastoral_follow_up",
  "behaviour_follow_up",
  "activity_published",
  "activity_updated",
  "activity_cancelled",
  "activity_consent_required",
  "activity_deadline",
  "activity_place_confirmed",
  "activity_waitlisted",
  "activity_promoted",
  "activity_assignment",
  "payment_request",
  "payment_due_soon",
  "payment_received",
  "payment_refunded",
  "payment_activity_required",
  "payment_refund_failed",
  "message_received",
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
  "calendar",
  "behaviour",
  "pastoral",
  "safeguarding",
  "activities",
  "finance",
  "messaging",
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

export {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_TRANSITIONS,
  APPLICATION_STAGE_COPY,
  allowedApplicationTransitions,
  isApplicationStatusTransitionAllowed,
  applicationTransitionChannel,
  applicationWorkflowActions,
  isDomainActionStatus,
  directCorrectionStatuses,
  workflowActionVisible,
  canUseAdministrativeCorrection,
  applicationWorkflowActionsForView,
  type ApplicationStatus,
  type ApplicationTransitionChannel,
  type ApplicationWorkflowPermission,
  type ApplicationWorkflowAction,
} from "./admissions-workflow.js";

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

export const ADMISSIONS_FORM_TYPES = [
  "enquiry",
  "application",
  "open_day",
  "waiting_list",
  "scholarship",
  "sixth_form",
  "nursery",
] as const;
export type AdmissionsFormType = (typeof ADMISSIONS_FORM_TYPES)[number];

export const ADMISSIONS_FORM_STATUSES = ["draft", "published", "unpublished"] as const;
export type AdmissionsFormStatus = (typeof ADMISSIONS_FORM_STATUSES)[number];

export const ADMISSIONS_FORM_FIELD_KINDS = ["canonical", "custom"] as const;
export type AdmissionsFormFieldKind = (typeof ADMISSIONS_FORM_FIELD_KINDS)[number];

export const ADMISSIONS_QUESTION_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "date",
  "number",
  "single_choice",
  "multiple_choice",
  "yes_no",
  "declaration",
  "file",
  "guardian_group",
  "address_group",
] as const;
export type AdmissionsQuestionType = (typeof ADMISSIONS_QUESTION_TYPES)[number];

export const ADMISSIONS_COMPLETENESS_STATUSES = [
  "draft",
  "submitted",
  "missing_documents",
  "complete",
] as const;
export type AdmissionsCompletenessStatus = (typeof ADMISSIONS_COMPLETENESS_STATUSES)[number];

export const ADMISSIONS_DOCUMENT_PURPOSES = [
  "birth_certificate",
  "passport_id",
  "previous_school_report",
  "send_support",
  "proof_of_address",
  "other",
] as const;
export type AdmissionsDocumentPurpose = (typeof ADMISSIONS_DOCUMENT_PURPOSES)[number];

export const ADMISSIONS_CANONICAL_FIELD_KEYS = [
  "child.legal_name",
  "child.preferred_name",
  "child.date_of_birth",
  "child.gender",
  "child.address",
  "child.intended_academic_year_id",
  "child.intended_year_group_id",
  "child.proposed_start_date",
  "child.current_school",
  "child.previous_school",
  "guardian.full_name",
  "guardian.relationship",
  "guardian.parental_responsibility",
  "guardian.address",
  "guardian.email",
  "guardian.phone",
  "guardian.primary_contact",
  "guardians",
  "previous_education.school_name",
  "previous_education.start_date",
  "previous_education.end_date",
  "previous_education.report_details",
  "emergency.full_name",
  "emergency.relationship",
  "emergency.telephone",
  "emergency.authorised_collection",
  "medical.allergies",
  "medical.conditions",
  "medical.medication",
  "medical.dietary",
  "medical.send_notes",
  "enquiry.notes",
  "application.notes",
] as const;
export type AdmissionsCanonicalFieldKey = (typeof ADMISSIONS_CANONICAL_FIELD_KEYS)[number];

export const PUBLIC_FORM_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PUBLIC_FORM_SLUG_MAX = 80;
export const CUSTOM_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;

export const APPLICATION_CONTACT_RELATIONSHIPS = [
  "mother",
  "father",
  "carer",
  "step-parent",
  "grandparent",
  "other",
] as const;

export const LEARNING_ASSIGNMENT_STATUSES = ["draft", "published", "closed", "archived"] as const;
export type LearningAssignmentStatus = (typeof LEARNING_ASSIGNMENT_STATUSES)[number];

export const LEARNING_SUBMISSION_STATUSES = [
  "not_started",
  "in_progress",
  "submitted",
  "returned",
  "resubmission_requested",
  "completed",
] as const;
export type LearningSubmissionStatus = (typeof LEARNING_SUBMISSION_STATUSES)[number];

export const LEARNING_WORK_TYPE_KEYS = [
  "homework",
  "classwork",
  "revision",
  "project",
  "reading",
  "practice",
  "assessment_preparation",
] as const;
export type LearningWorkTypeKey = (typeof LEARNING_WORK_TYPE_KEYS)[number];

export const LEARNING_TARGET_TYPES = ["class", "year_group", "student"] as const;
export type LearningTargetType = (typeof LEARNING_TARGET_TYPES)[number];

export const LEARNING_RESOURCE_KINDS = ["pdf", "worksheet", "image", "url", "video", "document"] as const;
export type LearningResourceKind = (typeof LEARNING_RESOURCE_KINDS)[number];

export const LEARNING_STUDENT_BUCKETS = [
  "assigned",
  "due_soon",
  "overdue",
  "submitted",
  "returned",
  "completed",
] as const;
export type LearningStudentBucket = (typeof LEARNING_STUDENT_BUCKETS)[number];

/** Formal academic assessment lifecycle. Distinct from admissions `ASSESSMENT_STATUSES`. */
export const FORMAL_ASSESSMENT_STATUSES = [
  "draft",
  "open",
  "completed",
  "reviewed",
  "published",
  "archived",
] as const;
export type FormalAssessmentStatus = (typeof FORMAL_ASSESSMENT_STATUSES)[number];

export const FORMAL_ASSESSMENT_TYPE_KEYS = [
  "class_test",
  "end_of_unit",
  "mock_exam",
  "eleven_plus_practice",
  "spelling_test",
  "reading_assessment",
  "teacher_assessment",
  "practical_assessment",
  "baseline_assessment",
] as const;
export type FormalAssessmentTypeKey = (typeof FORMAL_ASSESSMENT_TYPE_KEYS)[number];

export const GRADE_SCHEME_KINDS = [
  "percentage",
  "letter",
  "numeric",
  "teacher_judgement",
  "age_related",
  "school_defined",
] as const;
export type GradeSchemeKind = (typeof GRADE_SCHEME_KINDS)[number];

export const RESULT_REVIEW_STATUSES = ["entered", "reviewed", "approved"] as const;
export type ResultReviewStatus = (typeof RESULT_REVIEW_STATUSES)[number];

export const REPORTING_PERIOD_STATUSES = ["planned", "open", "closed", "published"] as const;
export type ReportingPeriodStatus = (typeof REPORTING_PERIOD_STATUSES)[number];

export const ACADEMIC_REPORT_STATUSES = [
  "draft",
  "submitted_for_review",
  "approved",
  "published",
  "archived",
] as const;
export type AcademicReportStatus = (typeof ACADEMIC_REPORT_STATUSES)[number];

export const ANNOUNCEMENT_STATUSES = [
  "draft",
  "scheduled",
  "published",
  "expired",
  "archived",
] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_PRIORITIES = ["normal", "important", "urgent"] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

export const COMMUNICATION_TARGET_TYPES = [
  "whole_school",
  "staff",
  "parents",
  "students",
  "year_group",
  "class",
  "student",
  "staff_member",
] as const;
export type CommunicationTargetType = (typeof COMMUNICATION_TARGET_TYPES)[number];

export const COMMUNICATION_AUDIENCE_ROLES = ["staff", "parent", "student"] as const;
export type CommunicationAudienceRole = (typeof COMMUNICATION_AUDIENCE_ROLES)[number];

export const COMMUNICATION_RESOURCE_KINDS = [
  "pdf",
  "worksheet",
  "image",
  "url",
  "video",
  "document",
] as const;
export type CommunicationResourceKind = (typeof COMMUNICATION_RESOURCE_KINDS)[number];

export const SCHOOL_EVENT_STATUSES = [
  "draft",
  "scheduled",
  "published",
  "cancelled",
  "archived",
] as const;
export type SchoolEventStatus = (typeof SCHOOL_EVENT_STATUSES)[number];

export const SCHOOL_EVENT_TYPE_KEYS = [
  "school_holiday",
  "inset_day",
  "parents_evening",
  "assembly",
  "sports_day",
  "open_day",
  "trip",
  "exam",
  "class_event",
  "club",
  "meeting",
] as const;
export type SchoolEventTypeKey = (typeof SCHOOL_EVENT_TYPE_KEYS)[number];

export const COMMUNICATION_RELATED_KINDS = [
  "none",
  "academic_year",
  "term",
  "class",
  "year_group",
  "assessment",
  "assignment",
  "admissions_open_day",
  "school_activity",
] as const;
export type CommunicationRelatedKind = (typeof COMMUNICATION_RELATED_KINDS)[number];

export const BROADCAST_TARGET_TYPES = [
  "whole_school",
  "staff",
  "parents",
  "students",
  "year_group",
] as const;

export const BEHAVIOUR_INCIDENT_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type BehaviourIncidentStatus = (typeof BEHAVIOUR_INCIDENT_STATUSES)[number];

export const BEHAVIOUR_SEVERITIES = ["low", "medium", "high"] as const;
export type BehaviourSeverity = (typeof BEHAVIOUR_SEVERITIES)[number];

export const BEHAVIOUR_ACTION_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const;
export type BehaviourActionStatus = (typeof BEHAVIOUR_ACTION_STATUSES)[number];

export const PASTORAL_CONCERN_STATUSES = ["open", "monitoring", "resolved", "closed"] as const;
export type PastoralConcernStatus = (typeof PASTORAL_CONCERN_STATUSES)[number];

export const PASTORAL_PRIORITIES = ["low", "medium", "high"] as const;
export type PastoralPriority = (typeof PASTORAL_PRIORITIES)[number];

export const PASTORAL_INTERVENTION_TYPES = [
  "pupil_meeting",
  "parent_meeting",
  "parent_contact",
  "mentoring",
  "support_plan",
  "internal_referral",
  "review",
] as const;
export type PastoralInterventionType = (typeof PASTORAL_INTERVENTION_TYPES)[number];

export const SAFEGUARDING_CONCERN_STATUSES = ["open", "monitoring", "referred_internal", "closed"] as const;
export type SafeguardingConcernStatus = (typeof SAFEGUARDING_CONCERN_STATUSES)[number];

export const SAFEGUARDING_CHRONOLOGY_ENTRY_TYPES = [
  "note",
  "action",
  "decision",
  "contact",
  "review",
  "amendment",
] as const;
export type SafeguardingChronologyEntryType = (typeof SAFEGUARDING_CHRONOLOGY_ENTRY_TYPES)[number];

export const BEHAVIOUR_INCIDENT_CATEGORY_KEYS = [
  "disruption",
  "defiance",
  "unkindness",
  "physical_incident",
  "unsafe_behaviour",
  "late_to_lesson",
  "equipment",
  "other",
] as const;
export type BehaviourIncidentCategoryKey = (typeof BEHAVIOUR_INCIDENT_CATEGORY_KEYS)[number];

export const BEHAVIOUR_ACTION_CATEGORY_KEYS = [
  "verbal_warning",
  "parent_contact",
  "detention",
  "restorative_conversation",
  "loss_of_privilege",
  "internal_intervention",
  "suspension_placeholder",
  "exclusion_placeholder",
] as const;
export type BehaviourActionCategoryKey = (typeof BEHAVIOUR_ACTION_CATEGORY_KEYS)[number];

export const POSITIVE_BEHAVIOUR_CATEGORY_KEYS = [
  "praise",
  "merit",
  "excellent_work",
  "kindness",
  "leadership",
  "effort",
  "attendance_achievement",
] as const;
export type PositiveBehaviourCategoryKey = (typeof POSITIVE_BEHAVIOUR_CATEGORY_KEYS)[number];

export const BEHAVIOUR_LOCATION_KEYS = [
  "classroom",
  "playground",
  "corridor",
  "dining_hall",
  "assembly",
  "trip",
  "other",
] as const;
export type BehaviourLocationKey = (typeof BEHAVIOUR_LOCATION_KEYS)[number];

export const PASTORAL_CONCERN_CATEGORY_KEYS = [
  "wellbeing",
  "attendance_concern",
  "friendship",
  "emotional_support",
  "family_circumstance",
  "engagement",
  "repeated_behaviour",
] as const;
export type PastoralConcernCategoryKey = (typeof PASTORAL_CONCERN_CATEGORY_KEYS)[number];

export const SAFEGUARDING_CONCERN_CATEGORY_KEYS = [
  "general_concern",
  "wellbeing_safety",
  "disclosure",
  "unexplained_injury",
  "change_in_presentation",
  "home_circumstance",
  "other",
] as const;
export type SafeguardingConcernCategoryKey = (typeof SAFEGUARDING_CONCERN_CATEGORY_KEYS)[number];

export const PASTORAL_RECORD_ATTACHMENT_PARENT_KINDS = [
  "incident",
  "positive",
  "action",
  "pastoral_concern",
  "pastoral_intervention",
] as const;
export type PastoralRecordAttachmentParentKind = (typeof PASTORAL_RECORD_ATTACHMENT_PARENT_KINDS)[number];

export const SCHOOL_DAY_PERIOD_TYPES = [
  "teaching",
  "registration",
  "break",
  "lunch",
  "assembly",
  "other",
] as const;
export type SchoolDayPeriodType = (typeof SCHOOL_DAY_PERIOD_TYPES)[number];

export const ROOM_LOCATION_TYPES = ["teaching", "non_teaching"] as const;
export type RoomLocationType = (typeof ROOM_LOCATION_TYPES)[number];

export const TIMETABLE_LESSON_TYPES = ["lesson", "registration", "assembly", "other"] as const;
export type TimetableLessonType = (typeof TIMETABLE_LESSON_TYPES)[number];

export const TIMETABLE_TEACHER_ROLES = [
  "teacher",
  "co_teacher",
  "teaching_assistant",
  "support",
] as const;
export type TimetableTeacherRole = (typeof TIMETABLE_TEACHER_ROLES)[number];

export const TIMETABLE_EXCEPTION_TYPES = [
  "cancelled",
  "room_changed",
  "teacher_changed",
  "replacement",
  "school_closure",
  "special_activity",
] as const;
export type TimetableExceptionType = (typeof TIMETABLE_EXCEPTION_TYPES)[number];

export const TIMETABLE_OCCURRENCE_STATUSES = [
  "scheduled",
  "cancelled",
  "room_changed",
  "teacher_changed",
  "covered",
  "replacement",
  "school_closure",
  "special_activity",
] as const;
export type TimetableOccurrenceStatus = (typeof TIMETABLE_OCCURRENCE_STATUSES)[number];

export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];

export const SCHOOL_ACTIVITY_STATUSES = [
  "draft",
  "published",
  "closed",
  "completed",
  "cancelled",
  "archived",
] as const;
export type SchoolActivityStatus = (typeof SCHOOL_ACTIVITY_STATUSES)[number];

export const SCHOOL_ACTIVITY_TYPE_KEYS = [
  "trip",
  "residential",
  "visit",
  "club",
  "after_school",
  "breakfast_club",
  "sports_fixture",
  "workshop",
  "performance",
  "extracurricular",
  "other",
] as const;
export type SchoolActivityTypeKey = (typeof SCHOOL_ACTIVITY_TYPE_KEYS)[number];

export const SCHOOL_ACTIVITY_TARGET_TYPES = [
  "whole_school",
  "year_group",
  "class",
  "student",
  "staff_member",
] as const;
export type SchoolActivityTargetType = (typeof SCHOOL_ACTIVITY_TARGET_TYPES)[number];

export const SCHOOL_ACTIVITY_STAFF_ROLES = [
  "lead",
  "trip_leader",
  "accompanying",
  "support",
] as const;
export type SchoolActivityStaffRole = (typeof SCHOOL_ACTIVITY_STAFF_ROLES)[number];

export const SCHOOL_ACTIVITY_OCCURRENCE_KINDS = ["one_off", "recurring"] as const;
export type SchoolActivityOccurrenceKind = (typeof SCHOOL_ACTIVITY_OCCURRENCE_KINDS)[number];

export const SCHOOL_ACTIVITY_REGISTRATION_STATUSES = [
  "expected",
  "interested",
  "confirmed",
  "waitlisted",
  "withdrawn",
  "declined",
] as const;
export type SchoolActivityRegistrationStatus = (typeof SCHOOL_ACTIVITY_REGISTRATION_STATUSES)[number];

export const SCHOOL_ACTIVITY_ATTENDANCE_STATUSES = [
  "expected",
  "attended",
  "absent",
  "withdrawn",
] as const;
export type SchoolActivityAttendanceStatus = (typeof SCHOOL_ACTIVITY_ATTENDANCE_STATUSES)[number];

export const SCHOOL_ACTIVITY_RESPONSE_VALUES = [
  "pending",
  "consented",
  "declined",
  "withdrawn",
] as const;
export type SchoolActivityResponseValue = (typeof SCHOOL_ACTIVITY_RESPONSE_VALUES)[number];

export const SCHOOL_ACTIVITY_RESPONSE_CHANNELS = [
  "parent_portal",
  "student_portal",
  "staff_offline",
] as const;
export type SchoolActivityResponseChannel = (typeof SCHOOL_ACTIVITY_RESPONSE_CHANNELS)[number];

export const SCHOOL_ACTIVITY_REGISTRATION_SOURCES = [
  "parent_consent",
  "student_signup",
  "staff_assigned",
  "school_assigned",
  "staff_offline",
] as const;
export type SchoolActivityRegistrationSource = (typeof SCHOOL_ACTIVITY_REGISTRATION_SOURCES)[number];

export const SCHOOL_ACTIVITY_DOCUMENT_VISIBILITIES = [
  "staff",
  "staff_and_parents",
  "staff_parents_and_student",
] as const;
export type SchoolActivityDocumentVisibility = (typeof SCHOOL_ACTIVITY_DOCUMENT_VISIBILITIES)[number];

export const SCHOOL_CHARGE_STATUSES = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "waived",
  "cancelled",
  "refunded",
] as const;
export type SchoolChargeStatus = (typeof SCHOOL_CHARGE_STATUSES)[number];

export const SCHOOL_CHARGE_CATEGORY_KEYS = [
  "trip",
  "club",
  "contribution",
  "music",
  "examination",
  "uniform",
  "lost_item",
  "meal",
  "other",
] as const;
export type SchoolChargeCategoryKey = (typeof SCHOOL_CHARGE_CATEGORY_KEYS)[number];

export const SCHOOL_CHARGE_SOURCE_KINDS = ["manual", "activity", "bulk", "admissions"] as const;
export type SchoolChargeSourceKind = (typeof SCHOOL_CHARGE_SOURCE_KINDS)[number];

export const SCHOOL_CHARGE_ADJUSTMENT_KINDS = [
  "waiver",
  "reduction",
  "subsidy",
  "discount",
] as const;
export type SchoolChargeAdjustmentKind = (typeof SCHOOL_CHARGE_ADJUSTMENT_KINDS)[number];

export const SCHOOL_PAYMENT_TRANSACTION_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "cancelled",
  "partially_refunded",
  "refunded",
] as const;
export type SchoolPaymentTransactionStatus = (typeof SCHOOL_PAYMENT_TRANSACTION_STATUSES)[number];

export const SCHOOL_PAYMENT_CHANNELS = ["provider", "offline"] as const;
export type SchoolPaymentChannel = (typeof SCHOOL_PAYMENT_CHANNELS)[number];

export const SCHOOL_PAYMENT_PROVIDER_KEYS = ["fake", "stripe", "offline"] as const;
export type SchoolPaymentProviderKey = (typeof SCHOOL_PAYMENT_PROVIDER_KEYS)[number];

export const SCHOOL_OFFLINE_PAYMENT_METHODS = [
  "cash",
  "bank_transfer",
  "cheque",
  "card_terminal",
  "other",
] as const;
export type SchoolOfflinePaymentMethod = (typeof SCHOOL_OFFLINE_PAYMENT_METHODS)[number];

export const SCHOOL_PAYMENT_REFUND_STATUSES = ["pending", "succeeded", "failed"] as const;
export type SchoolPaymentRefundStatus = (typeof SCHOOL_PAYMENT_REFUND_STATUSES)[number];

export const SCHOOL_PAYMENT_SESSION_STATUSES = [
  "open",
  "completed",
  "expired",
  "cancelled",
  "failed",
] as const;
export type SchoolPaymentSessionStatus = (typeof SCHOOL_PAYMENT_SESSION_STATUSES)[number];

export const SCHOOL_ACTIVITY_CHARGE_POLICIES = ["none", "on_confirmed", "on_consent"] as const;
export type SchoolActivityChargePolicy = (typeof SCHOOL_ACTIVITY_CHARGE_POLICIES)[number];

export const SCHOOL_ACTIVITY_PAYMENT_STATUSES = [
  "not_required",
  "not_requested",
  "outstanding",
  "paid",
  "waived",
  "refunded",
] as const;
export type SchoolActivityPaymentStatus = (typeof SCHOOL_ACTIVITY_PAYMENT_STATUSES)[number];

export const ISO_CURRENCY_PATTERN = /^[A-Z]{3}$/;
export const DEFAULT_CURRENCY = "GBP";

export const MESSAGE_CONVERSATION_TYPES = [
  "parent_teacher",
  "parent_school",
  "admissions",
  "staff_internal",
] as const;
export type MessageConversationType = (typeof MESSAGE_CONVERSATION_TYPES)[number];

export const MESSAGE_CONVERSATION_STATUSES = ["open", "closed", "archived"] as const;
export type MessageConversationStatus = (typeof MESSAGE_CONVERSATION_STATUSES)[number];

export const MESSAGE_PARTICIPANT_KINDS = ["staff", "parent"] as const;
export type MessageParticipantKind = (typeof MESSAGE_PARTICIPANT_KINDS)[number];

export const MESSAGE_TYPES = ["user", "system"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_RELATED_DOMAINS = [
  "none",
  "admissions_application",
  "school_charge",
  "school_activity",
  "learning_assignment",
  "attendance",
] as const;
export type MessageRelatedDomain = (typeof MESSAGE_RELATED_DOMAINS)[number];

export const MESSAGE_PARENT_CONTACT_POINTS = [
  "class_teacher",
  "school_office",
  "admissions",
] as const;
export type MessageParentContactPoint = (typeof MESSAGE_PARENT_CONTACT_POINTS)[number];

export const MESSAGE_BODY_MAX_LENGTH = 8000;
export const MESSAGE_SUBJECT_MAX_LENGTH = 200;
export const MESSAGE_PREVIEW_MAX_LENGTH = 140;
export const MESSAGE_REDACTED_PLACEHOLDER = "Message removed by authorised staff";

export const STATUTORY_CODE_CATALOGUES = [
  "ethnicity",
  "language",
  "enrolment_status",
  "send_provision",
  "leaving_reason",
  "school_phase",
  "establishment_type",
  "establishment_status",
  "sex",
  "looked_after",
] as const;
export type StatutoryCodeCatalogue = (typeof STATUTORY_CODE_CATALOGUES)[number];

export const STATUTORY_SEX_CODES = ["M", "F"] as const;
export type StatutorySexCode = (typeof STATUTORY_SEX_CODES)[number];

export const STATUTORY_ENROLMENT_STATUS_CODES = ["C", "G", "M", "S", "F"] as const;
export type StatutoryEnrolmentStatusCode = (typeof STATUTORY_ENROLMENT_STATUS_CODES)[number];

export const STATUTORY_SEND_PROVISION_CODES = ["N", "K", "E"] as const;
export type StatutorySendProvisionCode = (typeof STATUTORY_SEND_PROVISION_CODES)[number];

export const LOOKED_AFTER_STATUSES = ["none", "looked_after", "previously_looked_after"] as const;
export type LookedAfterStatus = (typeof LOOKED_AFTER_STATUSES)[number];

export const CENSUS_TYPES = ["autumn", "spring", "summer"] as const;
export type CensusType = (typeof CENSUS_TYPES)[number];

export const CENSUS_RUN_STATUSES = [
  "draft",
  "validating",
  "ready",
  "exported",
  "superseded",
  "archived",
] as const;
export type CensusRunStatus = (typeof CENSUS_RUN_STATUSES)[number];

export const STATUTORY_ISSUE_SEVERITIES = ["error", "warning", "information"] as const;
export type StatutoryIssueSeverity = (typeof STATUTORY_ISSUE_SEVERITIES)[number];

export const STATUTORY_ENTITY_TYPES = ["school", "pupil", "enrolment", "attendance", "fsm", "send"] as const;
export type StatutoryEntityType = (typeof STATUTORY_ENTITY_TYPES)[number];

export const DATA_EXPORT_KINDS = [
  "pupil_roll",
  "attendance_summary",
  "admissions_enrolment",
  "send_additional_needs",
  "census_snapshot",
  "census_ready",
] as const;
export type DataExportKind = (typeof DATA_EXPORT_KINDS)[number];

export const DATA_EXPORT_FORMATS = ["csv", "xml"] as const;
export type DataExportFormat = (typeof DATA_EXPORT_FORMATS)[number];

export const STATUTORY_CODE_SET_VERSION = "2025-2026";
export const CENSUS_SNAPSHOT_SCHEMA_VERSION = 1;

export const STATUTORY_ATTENDANCE_CATEGORIES = [
  "present",
  "late",
  "authorised_absence",
  "unauthorised_absence",
  "not_required",
] as const;
export type StatutoryAttendanceCategory = (typeof STATUTORY_ATTENDANCE_CATEGORIES)[number];

export const MEDICATION_ROUTES = ["oral", "inhaled", "topical", "injection", "buccal", "other"] as const;
export type MedicationRoute = (typeof MEDICATION_ROUTES)[number];

export const MEDICATION_ADMINISTRATION_RESPONSIBILITIES = [
  "school_staff",
  "parent",
  "pupil",
  "shared",
  "other",
] as const;
export type MedicationAdministrationResponsibility = (typeof MEDICATION_ADMINISTRATION_RESPONSIBILITIES)[number];

export const PARENT_CONSENT_STATUSES = ["pending", "granted", "declined", "not_required"] as const;
export type ParentConsentStatus = (typeof PARENT_CONSENT_STATUSES)[number];

export const MEDICATION_RECORD_STATUSES = ["active", "stopped"] as const;
export type MedicationRecordStatus = (typeof MEDICATION_RECORD_STATUSES)[number];

export const DIETARY_REQUIREMENT_TYPES = [
  "allergy",
  "intolerance",
  "religious",
  "cultural",
  "medical",
  "preference",
  "texture",
  "other",
] as const;
export type DietaryRequirementType = (typeof DIETARY_REQUIREMENT_TYPES)[number];

export const DIETARY_RECORD_STATUSES = ["active", "inactive"] as const;
export type DietaryRecordStatus = (typeof DIETARY_RECORD_STATUSES)[number];

export const PUPIL_MEDICAL_CHANGE_KINDS = ["updated", "stopped", "reactivated"] as const;
export type PupilMedicalChangeKind = (typeof PUPIL_MEDICAL_CHANGE_KINDS)[number];

export const PUPIL_MEDICAL_VIEWS = ["full", "operational", "parent"] as const;
export type PupilMedicalView = (typeof PUPIL_MEDICAL_VIEWS)[number];
