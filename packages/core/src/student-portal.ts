import type { StudentPortalPolicySource } from "@schoolapp/domain";

export type StudentPortalPolicyInput = {
  schoolDefault: boolean;
  yearGroupOverride: boolean | null;
  classOverride: boolean | null;
  studentOverride: boolean | null;
};

export type StudentPortalDecision = {
  enabled: boolean;
  source: StudentPortalPolicySource;
};

/**
 * Effective student-portal access:
 * individual pupil → class → year group → school default.
 * `null` means inherit the next broader level. There is no age-based prohibition.
 */
export function resolveStudentPortalAccess(input: StudentPortalPolicyInput): StudentPortalDecision {
  if (input.studentOverride !== null) {
    return { enabled: input.studentOverride, source: "student" };
  }
  if (input.classOverride !== null) {
    return { enabled: input.classOverride, source: "class" };
  }
  if (input.yearGroupOverride !== null) {
    return { enabled: input.yearGroupOverride, source: "year_group" };
  }
  return { enabled: input.schoolDefault, source: "school" };
}

export function yearGroupPortalEffective(
  schoolDefault: boolean,
  yearGroupOverride: boolean | null,
): boolean {
  return yearGroupOverride ?? schoolDefault;
}
