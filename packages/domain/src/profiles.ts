export const PERSON_TITLES = [
  "Mr",
  "Mrs",
  "Miss",
  "Ms",
  "Mx",
  "Dr",
  "Prof",
  "Rev",
  "Sir",
  "Dame",
] as const;

export type PersonTitle = (typeof PERSON_TITLES)[number];

export const STAFF_SELF_EDITABLE_PROFILE_FIELDS = [
  "title",
  "preferredName",
  "phone",
  "addressLine1",
  "addressLine2",
  "addressTown",
  "addressCounty",
  "addressPostcode",
  "photo",
] as const;

export const PARENT_SELF_EDITABLE_PROFILE_FIELDS = STAFF_SELF_EDITABLE_PROFILE_FIELDS;

export const SCHOOL_CONTROLLED_STAFF_FIELDS = [
  "fullName",
  "email",
  "employeeNumber",
  "jobTitle",
  "roleKeys",
  "membershipStatus",
  "accountStatus",
  "startedOn",
  "assignments",
] as const;

export const SCHOOL_CONTROLLED_PARENT_FIELDS = [
  "fullName",
  "email",
  "relationship",
  "hasParentalResponsibility",
  "isEmergencyContact",
  "livesWithStudent",
  "portalAccess",
  "priority",
] as const;

export type ProfileFieldKey =
  | (typeof STAFF_SELF_EDITABLE_PROFILE_FIELDS)[number]
  | (typeof SCHOOL_CONTROLLED_STAFF_FIELDS)[number]
  | (typeof SCHOOL_CONTROLLED_PARENT_FIELDS)[number];

export function isPersonTitle(value: string): value is PersonTitle {
  return (PERSON_TITLES as readonly string[]).includes(value);
}

export function displayPersonName(input: {
  title?: string | null;
  fullName?: string | null;
  preferredName?: string | null;
}): string {
  const preferred = input.preferredName?.trim();
  const legal = input.fullName?.trim() || "";
  const shown = preferred || legal || "Unknown";
  const title = input.title?.trim();
  if (title && !shown.toLowerCase().startsWith(`${title.toLowerCase()} `)) {
    return `${title} ${shown}`;
  }
  return shown;
}

export function profilePhotoUrl(storedObjectId: string | null | undefined): string | null {
  if (!storedObjectId) return null;
  return `/api/v1/files/${storedObjectId}`;
}

export function staffSelfCanEditField(field: string): boolean {
  return (STAFF_SELF_EDITABLE_PROFILE_FIELDS as readonly string[]).includes(field);
}

export function parentSelfCanEditField(field: string): boolean {
  return (PARENT_SELF_EDITABLE_PROFILE_FIELDS as readonly string[]).includes(field);
}

export function schoolControlledStaffField(field: string): boolean {
  return (SCHOOL_CONTROLLED_STAFF_FIELDS as readonly string[]).includes(field);
}
