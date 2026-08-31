import { hasAnyPermission } from "./ui.js";

/** School-wide Student Portal Access policy (school default and year-group overrides). */
export const STUDENT_PORTAL_POLICY_MANAGE_PERMISSIONS = ["students.portal_access.manage"] as const;

export function canManageStudentPortalPolicy(permissions: readonly string[]): boolean {
  return hasAnyPermission(permissions, STUDENT_PORTAL_POLICY_MANAGE_PERMISSIONS);
}
