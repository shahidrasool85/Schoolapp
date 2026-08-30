import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  canAccessSchoolSettingsAdmin,
  canReadSchoolSettingsProfile,
} from "@schoolapp/domain";

const teacher = [PERMISSIONS.ORG_SETTINGS_READ, PERMISSIONS.ACADEMIC_STRUCTURE_READ];
const headteacher = [
  PERMISSIONS.ORG_SETTINGS_READ,
  PERMISSIONS.ONBOARDING_READ,
  PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE,
];
const schoolAdmin = [
  PERMISSIONS.ORG_SETTINGS_READ,
  PERMISSIONS.ORG_SETTINGS_MANAGE,
  PERMISSIONS.ONBOARDING_MANAGE,
];

describe("school settings access", () => {
  it("shows School Settings only for settings administration, not org.settings.read", () => {
    expect(canAccessSchoolSettingsAdmin(schoolAdmin)).toBe(true);
    expect(canAccessSchoolSettingsAdmin(teacher)).toBe(false);
    expect(canAccessSchoolSettingsAdmin(headteacher)).toBe(false);
    expect(canAccessSchoolSettingsAdmin([PERMISSIONS.ORG_SETTINGS_READ])).toBe(false);
  });

  it("does not treat teacher read permission as the admin settings payload", () => {
    expect(canReadSchoolSettingsProfile(teacher)).toBe(false);
    expect(canReadSchoolSettingsProfile(schoolAdmin)).toBe(true);
    expect(canReadSchoolSettingsProfile(headteacher)).toBe(true);
  });

  it("leaves parent, student, and platform personas without settings admin", () => {
    expect(canAccessSchoolSettingsAdmin([])).toBe(false);
    expect(canAccessSchoolSettingsAdmin([PERMISSIONS.PLATFORM_ORGANISATIONS_MANAGE])).toBe(false);
    expect(canReadSchoolSettingsProfile([PERMISSIONS.STUDENTS_PROFILES_READ_OWN_CHILDREN])).toBe(false);
    expect(canReadSchoolSettingsProfile([PERMISSIONS.STUDENTS_PROFILES_READ_SELF])).toBe(false);
  });
});
