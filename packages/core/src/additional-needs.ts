import {
  DIETARY_RECORD_STATUSES,
  DIETARY_REQUIREMENT_TYPES,
  MEDICATION_ADMINISTRATION_RESPONSIBILITIES,
  MEDICATION_RECORD_STATUSES,
  MEDICATION_ROUTES,
  PARENT_CONSENT_STATUSES,
  PUPIL_MEDICAL_CHANGE_KINDS,
  PUPIL_MEDICAL_VIEWS,
  type DietaryRecordStatus,
  type DietaryRequirementType,
  type MedicationAdministrationResponsibility,
  type MedicationRecordStatus,
  type MedicationRoute,
  type ParentConsentStatus,
  type PupilMedicalChangeKind,
  type PupilMedicalView,
} from "@schoolapp/domain";

export function isMedicationRoute(value: string): value is MedicationRoute {
  return (MEDICATION_ROUTES as readonly string[]).includes(value);
}

export function isMedicationAdministrationResponsibility(
  value: string,
): value is MedicationAdministrationResponsibility {
  return (MEDICATION_ADMINISTRATION_RESPONSIBILITIES as readonly string[]).includes(value);
}

export function isParentConsentStatus(value: string): value is ParentConsentStatus {
  return (PARENT_CONSENT_STATUSES as readonly string[]).includes(value);
}

export function isMedicationRecordStatus(value: string): value is MedicationRecordStatus {
  return (MEDICATION_RECORD_STATUSES as readonly string[]).includes(value);
}

export function isDietaryRequirementType(value: string): value is DietaryRequirementType {
  return (DIETARY_REQUIREMENT_TYPES as readonly string[]).includes(value);
}

export function isDietaryRecordStatus(value: string): value is DietaryRecordStatus {
  return (DIETARY_RECORD_STATUSES as readonly string[]).includes(value);
}

export function isPupilMedicalChangeKind(value: string): value is PupilMedicalChangeKind {
  return (PUPIL_MEDICAL_CHANGE_KINDS as readonly string[]).includes(value);
}

export function isPupilMedicalView(value: string): value is PupilMedicalView {
  return (PUPIL_MEDICAL_VIEWS as readonly string[]).includes(value);
}

export type MedicationRevisionView = {
  id: string;
  changeKind: string;
  changedFields: string[];
  previousData: Record<string, unknown>;
  createdAt: string;
  actorUserId: string | null;
};

export type MedicationRecordView = {
  id: string;
  studentProfileId: string;
  medicationName: string;
  dosage: string | null;
  route: string;
  scheduleText: string | null;
  isPrn: boolean;
  startedOn: string | null;
  endedOn: string | null;
  instructions: string | null;
  administrationResponsibility: string;
  parentConsentStatus: string;
  parentConsentOn: string | null;
  reviewOn: string | null;
  status: string;
  stoppedReason: string | null;
  parentVisible?: boolean;
  internalNotes?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string | null;
  updatedBy?: string | null;
  revisions?: MedicationRevisionView[];
};

export type DietaryRevisionView = {
  id: string;
  changeKind: string;
  changedFields: string[];
  previousData: Record<string, unknown>;
  createdAt: string;
  actorUserId: string | null;
};

export type DietaryRecordView = {
  id: string;
  studentProfileId: string;
  requirementType: string;
  requirement: string;
  foodsToAvoid: string | null;
  safeAlternatives: string | null;
  isReligiousOrCultural: boolean;
  relatedAllergy: string | null;
  textureFeedingNotes: string | null;
  parentConfirmedOn: string | null;
  reviewOn: string | null;
  status: string;
  endedOn: string | null;
  parentVisible?: boolean;
  internalNotes?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string | null;
  updatedBy?: string | null;
  revisions?: DietaryRevisionView[];
};

type MedicationRow = {
  id: string;
  student_profile_id: string;
  medication_name: string;
  dosage: string | null;
  route: string;
  schedule_text: string | null;
  is_prn: boolean;
  started_on: string | null;
  ended_on: string | null;
  instructions: string | null;
  administration_responsibility: string;
  parent_consent_status: string;
  parent_consent_on: string | null;
  review_on: string | null;
  status: string;
  stopped_reason: string | null;
  parent_visible: boolean;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

type DietaryRow = {
  id: string;
  student_profile_id: string;
  requirement_type: string;
  requirement: string;
  foods_to_avoid: string | null;
  safe_alternatives: string | null;
  is_religious_or_cultural: boolean;
  related_allergy: string | null;
  texture_feeding_notes: string | null;
  parent_confirmed_on: string | null;
  review_on: string | null;
  status: string;
  ended_on: string | null;
  parent_visible: boolean;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

function redactRevisionData(data: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...data };
  delete copy.internalNotes;
  return copy;
}

export function mapMedicationRecord(
  row: MedicationRow,
  view: PupilMedicalView,
  revisions?: MedicationRevisionView[],
): MedicationRecordView {
  const base: MedicationRecordView = {
    id: row.id,
    studentProfileId: row.student_profile_id,
    medicationName: row.medication_name,
    dosage: row.dosage,
    route: row.route,
    scheduleText: row.schedule_text,
    isPrn: row.is_prn,
    startedOn: row.started_on,
    endedOn: row.ended_on,
    instructions: row.instructions,
    administrationResponsibility: row.administration_responsibility,
    parentConsentStatus: row.parent_consent_status,
    parentConsentOn: row.parent_consent_on,
    reviewOn: row.review_on,
    status: row.status,
    stoppedReason: row.stopped_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (view === "full") {
    return {
      ...base,
      parentVisible: row.parent_visible,
      internalNotes: row.internal_notes,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      revisions,
    };
  }
  return base;
}

export function mapDietaryRecord(
  row: DietaryRow,
  view: PupilMedicalView,
  revisions?: DietaryRevisionView[],
): DietaryRecordView {
  const base: DietaryRecordView = {
    id: row.id,
    studentProfileId: row.student_profile_id,
    requirementType: row.requirement_type,
    requirement: row.requirement,
    foodsToAvoid: row.foods_to_avoid,
    safeAlternatives: row.safe_alternatives,
    isReligiousOrCultural: row.is_religious_or_cultural,
    relatedAllergy: row.related_allergy,
    textureFeedingNotes: row.texture_feeding_notes,
    parentConfirmedOn: row.parent_confirmed_on,
    reviewOn: row.review_on,
    status: row.status,
    endedOn: row.ended_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (view === "full") {
    return {
      ...base,
      parentVisible: row.parent_visible,
      internalNotes: row.internal_notes,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      revisions,
    };
  }
  return base;
}

export function mapMedicationRevision(
  row: {
    id: string;
    change_kind: string;
    changed_fields: string[];
    previous_data: Record<string, unknown>;
    created_at: string;
    actor_user_id: string | null;
  },
  view: PupilMedicalView,
): MedicationRevisionView {
  return {
    id: row.id,
    changeKind: row.change_kind,
    changedFields: row.changed_fields,
    previousData: view === "full" ? row.previous_data : redactRevisionData(row.previous_data),
    createdAt: row.created_at,
    actorUserId: view === "full" ? row.actor_user_id : null,
  };
}

export function mapDietaryRevision(
  row: {
    id: string;
    change_kind: string;
    changed_fields: string[];
    previous_data: Record<string, unknown>;
    created_at: string;
    actor_user_id: string | null;
  },
  view: PupilMedicalView,
): DietaryRevisionView {
  return {
    id: row.id,
    changeKind: row.change_kind,
    changedFields: row.changed_fields,
    previousData: view === "full" ? row.previous_data : redactRevisionData(row.previous_data),
    createdAt: row.created_at,
    actorUserId: view === "full" ? row.actor_user_id : null,
  };
}

export function auditSafeMedicationAfter(input: {
  action: string;
  id: string;
  studentProfileId: string;
  status?: string | null;
  isPrn?: boolean | null;
  parentVisible?: boolean | null;
}): Record<string, unknown> {
  return {
    action: input.action,
    id: input.id,
    studentProfileId: input.studentProfileId,
    status: input.status ?? null,
    isPrn: input.isPrn ?? null,
    parentVisible: input.parentVisible ?? null,
  };
}

export function auditSafeDietaryAfter(input: {
  action: string;
  id: string;
  studentProfileId: string;
  status?: string | null;
  requirementType?: string | null;
  parentVisible?: boolean | null;
}): Record<string, unknown> {
  return {
    action: input.action,
    id: input.id,
    studentProfileId: input.studentProfileId,
    status: input.status ?? null,
    requirementType: input.requirementType ?? null,
    parentVisible: input.parentVisible ?? null,
  };
}

export function summariseActiveMedications(
  rows: Array<{ medicationName: string; dosage: string | null; isPrn: boolean; scheduleText: string | null }>,
): string | null {
  if (rows.length === 0) return null;
  return rows
    .map((row) =>
      [row.medicationName, row.dosage, row.isPrn ? "PRN" : row.scheduleText].filter(Boolean).join(" — "),
    )
    .join("; ");
}

export function summariseActiveDietary(
  rows: Array<{ requirement: string; foodsToAvoid: string | null }>,
): string | null {
  if (rows.length === 0) return null;
  return rows
    .map((row) => [row.requirement, row.foodsToAvoid].filter(Boolean).join(" — "))
    .join("; ");
}
