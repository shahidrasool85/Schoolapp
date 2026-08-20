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
  STUDENTS_PROFILES_READ: "students.profiles.read",
  STUDENTS_PROFILES_READ_ASSIGNED: "students.profiles.read_assigned",
  STUDENTS_PROFILES_MANAGE: "students.profiles.manage",
  STUDENTS_PROFILES_READ_OWN_CHILDREN: "students.profiles.read_own_children",
  STUDENTS_PROFILES_READ_SELF: "students.profiles.read_self",
  STUDENTS_RESTRICTED_CONTACT_READ: "students.restricted_contact.read",
  GUARDIANSHIPS_MANAGE: "guardianships.manage",
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
  "general",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const PORTAL_COMING_LATER_MESSAGE = "Coming in a later phase.";
