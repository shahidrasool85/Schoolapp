export type OperationalGender = "male" | "female" | "prefer_not_to_say";

export type LookedAfterPersistValue = "none" | "looked_after" | "previously_looked_after";

export type PupilRecordTab =
  | "overview"
  | "attendance"
  | "learning"
  | "academic"
  | "documents"
  | "statutory"
  | "pastoral";

export const PUPIL_RECORD_TABS: PupilRecordTab[] = [
  "overview",
  "attendance",
  "learning",
  "academic",
  "documents",
  "statutory",
  "pastoral",
];

const OPERATIONAL_GENDER_TO_SEX: Record<string, "M" | "F"> = {
  male: "M",
  female: "F",
  m: "M",
  f: "F",
};

export function mapOperationalGenderToStatutorySex(
  gender: string | null | undefined,
): "M" | "F" | null {
  if (!gender) return null;
  return OPERATIONAL_GENDER_TO_SEX[gender.trim().toLowerCase()] ?? null;
}

export function formatPupilAddress(input: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressTown?: string | null;
  addressPostcode?: string | null;
}): string | null {
  const parts = [
    input.addressLine1,
    input.addressLine2,
    input.addressTown,
    input.addressPostcode,
  ]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function pupilIdentityGaps(input: {
  dateOfBirth?: string | null;
  legalName?: string | null;
  sex?: string | null;
  gender?: string | null;
  addressLine1?: string | null;
}): string[] {
  const gaps: string[] = [];
  if (!input.legalName?.trim()) gaps.push("legal name");
  if (!input.dateOfBirth) gaps.push("date of birth");
  if (!input.sex && !mapOperationalGenderToStatutorySex(input.gender)) gaps.push("sex");
  return gaps;
}

export function sensitiveSelectValue(persisted: string | null | undefined): string {
  const value = persisted?.trim() ?? "";
  return value;
}

export function lookedAfterPersistValue(
  selected: string | null | undefined,
): LookedAfterPersistValue {
  if (selected === "looked_after" || selected === "previously_looked_after") return selected;
  return "none";
}

export function enrolmentFormInitialState(input: {
  currentAcademicYearId?: string | null;
  currentYearGroupId?: string | null;
  currentFormClassId?: string | null;
  academicYears: Array<{ id: string; isCurrent?: boolean | null }>;
}): {
  academicYearId: string;
  yearGroupId: string;
  classId: string;
} {
  const currentYear = input.academicYears.find((year) => year.isCurrent);
  return {
    academicYearId: input.currentAcademicYearId || currentYear?.id || "",
    yearGroupId: "",
    classId: "",
  };
}

export function filterFormClasses<T extends {
  id: string;
  classType?: string | null;
  academicYearId?: string | null;
  yearGroupId?: string | null;
}>(
  classes: T[],
  input: { academicYearId?: string | null; yearGroupId?: string | null },
): T[] {
  return classes.filter((row) => {
    if ((row.classType ?? "form") !== "form") return false;
    if (input.academicYearId && row.academicYearId && row.academicYearId !== input.academicYearId) {
      return false;
    }
    if (input.yearGroupId && row.yearGroupId && row.yearGroupId !== input.yearGroupId) {
      return false;
    }
    return true;
  });
}

export function isSamePrimaryPlacement(input: {
  currentAcademicYearId?: string | null;
  currentYearGroupId?: string | null;
  currentFormClassId?: string | null;
  academicYearId: string;
  yearGroupId: string;
  classId?: string | null;
  placementKind?: string | null;
}): boolean {
  if ((input.placementKind ?? "primary") !== "primary") return false;
  const nextClass = input.classId || null;
  const currentClass = input.currentFormClassId || null;
  return (
    Boolean(input.academicYearId) &&
    input.academicYearId === input.currentAcademicYearId &&
    input.yearGroupId === input.currentYearGroupId &&
    nextClass === currentClass
  );
}

export function describeEnrolmentChange(input: {
  currentYearGroupName?: string | null;
  currentFormClassName?: string | null;
  currentAcademicYearName?: string | null;
  nextYearGroupName?: string | null;
  nextFormClassName?: string | null;
  nextAcademicYearName?: string | null;
  placementKind?: string | null;
}): string {
  const from = [input.currentAcademicYearName, input.currentYearGroupName, input.currentFormClassName]
    .filter(Boolean)
    .join(" · ");
  const to = [input.nextAcademicYearName, input.nextYearGroupName, input.nextFormClassName || "No form class"]
    .filter(Boolean)
    .join(" · ");
  const kind = input.placementKind && input.placementKind !== "primary" ? ` (${input.placementKind})` : "";
  if (!from) return `This will enrol the pupil in ${to}${kind}.`;
  if (from === to) return `The pupil is already in ${from}. Saving would not change placement.`;
  return `This will move the pupil from ${from} to ${to}${kind}. The previous enrolment and class membership stay on the history.`;
}

export function guardianAccountLabel(membershipStatus: string | null | undefined): string {
  if (membershipStatus === "invited") return "Invite pending";
  if (membershipStatus === "active") return "Account active";
  if (membershipStatus === "suspended") return "Account suspended";
  return "No account";
}

export function portalAccessLabel(portalAccess: boolean | null | undefined): string {
  return portalAccess ? "Enabled" : "Off";
}

export function parsePupilRecordTab(hash: string | null | undefined): PupilRecordTab {
  const key = (hash ?? "").replace(/^#/, "").trim().toLowerCase();
  return (PUPIL_RECORD_TABS as string[]).includes(key) ? (key as PupilRecordTab) : "overview";
}

export function statutoryIssueFix(issue: {
  ruleKey?: string | null;
  field?: string | null;
  entityId?: string | null;
  entityType?: string | null;
}): { href: string; label: string } | null {
  if (issue.entityType === "school" || issue.entityType === "attendance") {
    return { href: "/school/settings/statutory", label: "Open school statutory settings" };
  }
  if (!issue.entityId) return { href: "/school/statutory/data-quality", label: "Open data quality" };
  const identityFields = new Set(["dateOfBirth", "preferredName", "legalName", "admissionNumber"]);
  const identityKeys = new Set(["pupil.dob.missing"]);
  if (identityKeys.has(issue.ruleKey ?? "") || identityFields.has(issue.field ?? "")) {
    return { href: `/school/students/${issue.entityId}#overview`, label: "Fix pupil details" };
  }
  return { href: `/school/students/${issue.entityId}#statutory`, label: "Fix statutory record" };
}

export function upnValidationMessage(reason: string | null | undefined): string | null {
  if (!reason || reason === "missing") return null;
  return "UPN format is invalid.";
}
