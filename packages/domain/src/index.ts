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
