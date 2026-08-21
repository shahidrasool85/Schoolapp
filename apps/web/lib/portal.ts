export type Membership = {
  membershipId: string;
  organisationId: string;
  name: string;
  slug: string;
  status: string;
  roleKeys: string[];
};

const STAFF_ROLES = new Set([
  "school.admin",
  "school.headteacher",
  "school.teacher",
  "school.admissions",
  "school.staff",
]);

export function hasStaffRole(roleKeys: string[]): boolean {
  return roleKeys.some((key) => STAFF_ROLES.has(key));
}

export function hasParentRole(roleKeys: string[]): boolean {
  return roleKeys.includes("school.parent");
}

export function hasStudentRole(roleKeys: string[]): boolean {
  return roleKeys.includes("school.student");
}

export function homePath(roleKeys: string[]): string {
  if (hasStaffRole(roleKeys)) return "/school";
  if (hasParentRole(roleKeys)) return "/parent";
  if (hasStudentRole(roleKeys)) return "/student";
  return "/login";
}

export type PortalKind = "staff" | "parent" | "student";

export function pickPortalMembership(
  memberships: Membership[],
  portal: PortalKind,
  preferredOrgId: string | null,
): Membership | null {
  const eligible = memberships.filter((m) => {
    if (m.status !== "active") return false;
    if (portal === "staff") return hasStaffRole(m.roleKeys);
    if (portal === "parent") return hasParentRole(m.roleKeys);
    return hasStudentRole(m.roleKeys);
  });
  if (preferredOrgId) {
    const preferred = eligible.find((m) => m.organisationId === preferredOrgId);
    if (preferred) return preferred;
  }
  return eligible[0] ?? null;
}

export function pickMembership(
  memberships: Membership[],
  preferredOrgId: string | null,
): Membership | null {
  const active = memberships.filter((m) => m.status === "active");
  if (preferredOrgId) {
    const preferred = active.find((m) => m.organisationId === preferredOrgId);
    if (preferred) return preferred;
  }
  return (
    active.find((m) => hasStaffRole(m.roleKeys)) ??
    active.find((m) => hasParentRole(m.roleKeys)) ??
    active.find((m) => hasStudentRole(m.roleKeys)) ??
    active[0] ??
    null
  );
}

export type ComingLater = {
  available: boolean;
  message?: string;
};

export type PortalSchool = { id: string; name: string };

export type PortalChild = {
  id: string;
  displayName: string;
  legalName: string;
  preferredName: string | null;
  dateOfBirth?: string | null;
  admissionNumber?: string | null;
  enrolmentStatus: string;
  currentAcademicYearId?: string | null;
  currentAcademicYearName: string | null;
  currentYearGroupId?: string | null;
  currentYearGroupName: string | null;
  currentFormClassId?: string | null;
  currentFormClassName: string | null;
  houseName?: string | null;
  school: PortalSchool;
  guardianship?: {
    relationship: string;
    hasParentalResponsibility: boolean;
    isEmergencyContact: boolean;
    livesWithStudent: boolean;
    portalAccess: boolean;
    priority: number;
  } | null;
};

export type InboxNotification = {
  id: string;
  type: string;
  category: string;
  title: string;
  body: string;
  actionTarget: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
};
