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
  STUDENTS_PROFILES_READ: "students.profiles.read",
  STUDENTS_PROFILES_READ_ASSIGNED: "students.profiles.read_assigned",
  STUDENTS_PROFILES_MANAGE: "students.profiles.manage",
  STUDENTS_PROFILES_READ_OWN_CHILDREN: "students.profiles.read_own_children",
  STUDENTS_PROFILES_READ_SELF: "students.profiles.read_self",
  STUDENTS_RESTRICTED_CONTACT_READ: "students.restricted_contact.read",
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
