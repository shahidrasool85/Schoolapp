import { hasAnyPermission } from "./ui.js";

/** Administrative School Settings UI and writes. org.settings.read is not enough. */
export const SCHOOL_SETTINGS_ADMIN_PERMISSIONS = ["org.settings.manage"] as const;

/** Full school-settings profile payload (identity, contact, branding admin URLs). */
export const SCHOOL_SETTINGS_PROFILE_READ_PERMISSIONS = [
  "org.settings.manage",
  "onboarding.manage",
  "onboarding.read",
] as const;

export function canAccessSchoolSettingsAdmin(permissions: readonly string[]): boolean {
  return hasAnyPermission(permissions, SCHOOL_SETTINGS_ADMIN_PERMISSIONS);
}

export function canReadSchoolSettingsProfile(permissions: readonly string[]): boolean {
  return hasAnyPermission(permissions, SCHOOL_SETTINGS_PROFILE_READ_PERMISSIONS);
}
