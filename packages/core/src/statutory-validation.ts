import type { StatutoryIssueSeverity } from "@schoolapp/domain";
import { isOnRollOnDate } from "./on-roll.js";
import { isStatutoryCode, type StatutoryCodeLookup } from "./statutory-codes.js";
import {
  fsmEligibleOnDate,
  mapOperationalSendToStatutory,
  type PupilStatutoryRecord,
  type SchoolStatutoryRecord,
  type StatutoryIssue,
} from "./statutory.js";
import { validateUpn } from "./upn.js";

export type StatutoryValidationSubject = {
  asOf: string;
  school: SchoolStatutoryRecord;
  pupils: PupilStatutoryRecord[];
  codeLookup: StatutoryCodeLookup;
  attendanceConfig?: {
    activeSessionCount: number;
    unmappedCodeCount: number;
  };
};

function issue(input: {
  ruleKey: string;
  severity: StatutoryIssueSeverity;
  entityType: StatutoryIssue["entityType"];
  entityId: string | null;
  message: string;
  field?: string | null;
  metadata?: Record<string, unknown>;
}): StatutoryIssue {
  return {
    ruleKey: input.ruleKey,
    severity: input.severity,
    entityType: input.entityType,
    entityId: input.entityId,
    message: input.message,
    field: input.field ?? null,
    metadata: input.metadata ?? {},
  };
}

function pupilName(pupil: PupilStatutoryRecord): string {
  return pupil.legalName || [pupil.legalForename, pupil.legalSurname].filter(Boolean).join(" ") || "Pupil";
}

export function validateStatutorySchool(
  school: SchoolStatutoryRecord,
  attendanceConfig?: StatutoryValidationSubject["attendanceConfig"],
): StatutoryIssue[] {
  const issues: StatutoryIssue[] = [];
  if (!school.statutoryName?.trim()) {
    issues.push(
      issue({
        ruleKey: "school.statutory_name.missing",
        severity: "error",
        entityType: "school",
        entityId: null,
        field: "statutoryName",
        message: "Statutory school name is missing.",
      }),
    );
  }
  if (!school.localAuthorityNumber) {
    issues.push(
      issue({
        ruleKey: "school.la_number.missing",
        severity: "error",
        entityType: "school",
        entityId: null,
        field: "localAuthorityNumber",
        message: "Local authority number is missing.",
      }),
    );
  } else if (!/^\d{3}$/.test(school.localAuthorityNumber)) {
    issues.push(
      issue({
        ruleKey: "school.la_number.invalid",
        severity: "error",
        entityType: "school",
        entityId: null,
        field: "localAuthorityNumber",
        message: "Local authority number must be three digits.",
      }),
    );
  }
  if (!school.establishmentNumber) {
    issues.push(
      issue({
        ruleKey: "school.establishment_number.missing",
        severity: "error",
        entityType: "school",
        entityId: null,
        field: "establishmentNumber",
        message: "Establishment number is missing.",
      }),
    );
  } else if (!/^\d{4}$/.test(school.establishmentNumber)) {
    issues.push(
      issue({
        ruleKey: "school.establishment_number.invalid",
        severity: "error",
        entityType: "school",
        entityId: null,
        field: "establishmentNumber",
        message: "Establishment number must be four digits.",
      }),
    );
  }
  if (school.urn && !/^\d{6}$/.test(school.urn)) {
    issues.push(
      issue({
        ruleKey: "school.urn.invalid",
        severity: "error",
        entityType: "school",
        entityId: null,
        field: "urn",
        message: "URN must be six digits when provided.",
      }),
    );
  }
  if (!school.urn) {
    issues.push(
      issue({
        ruleKey: "school.urn.missing",
        severity: "warning",
        entityType: "school",
        entityId: null,
        field: "urn",
        message: "URN is not recorded.",
      }),
    );
  }
  if (!school.schoolPhase) {
    issues.push(
      issue({
        ruleKey: "school.phase.missing",
        severity: "warning",
        entityType: "school",
        entityId: null,
        field: "schoolPhase",
        message: "School phase is not recorded.",
      }),
    );
  }
  if (!school.timezone) {
    issues.push(
      issue({
        ruleKey: "school.timezone.missing",
        severity: "warning",
        entityType: "school",
        entityId: null,
        field: "timezone",
        message: "School timezone is not recorded.",
      }),
    );
  }
  if (attendanceConfig && attendanceConfig.activeSessionCount < 1) {
    issues.push(
      issue({
        ruleKey: "attendance.config.sessions_missing",
        severity: "error",
        entityType: "attendance",
        entityId: null,
        field: "sessions",
        message: "No active attendance sessions are configured.",
      }),
    );
  }
  if (attendanceConfig && attendanceConfig.unmappedCodeCount > 0) {
    issues.push(
      issue({
        ruleKey: "attendance.config.unmapped_codes",
        severity: "warning",
        entityType: "attendance",
        entityId: null,
        field: "statutoryCategory",
        message: "One or more attendance codes have no statutory category mapping.",
        metadata: { count: attendanceConfig.unmappedCodeCount },
      }),
    );
  }
  return issues;
}

export function validateStatutoryPupil(
  pupil: PupilStatutoryRecord,
  asOf: string,
  codeLookup: StatutoryCodeLookup,
  upnIndex: Map<string, string[]>,
): StatutoryIssue[] {
  const issues: StatutoryIssue[] = [];
  const name = pupilName(pupil);
  const onRoll = isOnRollOnDate(
    {
      enrolmentStatus: pupil.enrolmentStatus,
      dateOfAdmission: pupil.dateOfAdmission,
      dateOfLeaving: pupil.dateOfLeaving,
      enrolments: pupil.enrolments,
    },
    asOf,
  );

  const upn = validateUpn(pupil.upn);
  if (!pupil.upn) {
    if (onRoll) {
      issues.push(
        issue({
          ruleKey: "pupil.upn.missing",
          severity: "error",
          entityType: "pupil",
          entityId: pupil.studentProfileId,
          field: "upn",
          message: `${name} has no UPN.`,
        }),
      );
    }
  } else if (!upn.ok) {
    issues.push(
      issue({
        ruleKey: "pupil.upn.invalid",
        severity: "error",
        entityType: "pupil",
        entityId: pupil.studentProfileId,
        field: "upn",
        message: `${name} has an invalid UPN.`,
        metadata: { reason: upn.reason },
      }),
    );
  } else if (upn.kind === "temporary") {
    issues.push(
      issue({
        ruleKey: "pupil.upn.temporary",
        severity: "warning",
        entityType: "pupil",
        entityId: pupil.studentProfileId,
        field: "upn",
        message: `${name} has a temporary UPN.`,
      }),
    );
  }
  if (upn.ok && upn.normalised) {
    const holders = upnIndex.get(upn.normalised) ?? [];
    if (holders.length > 1) {
      issues.push(
        issue({
          ruleKey: "pupil.upn.duplicate",
          severity: "error",
          entityType: "pupil",
          entityId: pupil.studentProfileId,
          field: "upn",
          message: `${name} shares a UPN with another pupil at this school.`,
          metadata: { count: holders.length },
        }),
      );
    }
  }

  if (!pupil.legalForename?.trim() || !pupil.legalSurname?.trim()) {
    issues.push(
      issue({
        ruleKey: "pupil.legal_name.missing",
        severity: "error",
        entityType: "pupil",
        entityId: pupil.studentProfileId,
        field: "legalName",
        message: `${name} is missing a legal forename or surname.`,
      }),
    );
  }
  if (!pupil.dateOfBirth) {
    issues.push(
      issue({
        ruleKey: "pupil.dob.missing",
        severity: "error",
        entityType: "pupil",
        entityId: pupil.studentProfileId,
        field: "dateOfBirth",
        message: `${name} is missing a date of birth.`,
      }),
    );
  }
  if (!pupil.sex) {
    issues.push(
      issue({
        ruleKey: "pupil.sex.missing",
        severity: "error",
        entityType: "pupil",
        entityId: pupil.studentProfileId,
        field: "sex",
        message: `${name} is missing statutory sex.`,
      }),
    );
  } else if (!isStatutoryCode(codeLookup, "sex", pupil.sex)) {
    issues.push(
      issue({
        ruleKey: "pupil.sex.invalid",
        severity: "error",
        entityType: "pupil",
        entityId: pupil.studentProfileId,
        field: "sex",
        message: `${name} has an unrecognised statutory sex code.`,
      }),
    );
  }
  if (onRoll && !pupil.ethnicityCode) {
    issues.push(
      issue({
        ruleKey: "pupil.ethnicity.missing",
        severity: "warning",
        entityType: "pupil",
        entityId: pupil.studentProfileId,
        field: "ethnicityCode",
        message: `${name} has no ethnicity code.`,
      }),
    );
  } else if (pupil.ethnicityCode && !isStatutoryCode(codeLookup, "ethnicity", pupil.ethnicityCode)) {
    issues.push(
      issue({
        ruleKey: "pupil.ethnicity.invalid",
        severity: "error",
        entityType: "pupil",
        entityId: pupil.studentProfileId,
        field: "ethnicityCode",
        message: `${name} has an unrecognised ethnicity code.`,
      }),
    );
  }
  if (onRoll && !pupil.languageCode) {
    issues.push(
      issue({
        ruleKey: "pupil.language.missing",
        severity: "warning",
        entityType: "pupil",
        entityId: pupil.studentProfileId,
        field: "languageCode",
        message: `${name} has no first language code.`,
      }),
    );
  } else if (pupil.languageCode && !isStatutoryCode(codeLookup, "language", pupil.languageCode)) {
    issues.push(
      issue({
        ruleKey: "pupil.language.invalid",
        severity: "error",
        entityType: "pupil",
        entityId: pupil.studentProfileId,
        field: "languageCode",
        message: `${name} has an unrecognised language code.`,
      }),
    );
  }
  if (onRoll && !pupil.enrolmentStatusCode) {
    issues.push(
      issue({
        ruleKey: "pupil.enrolment_status.missing",
        severity: "error",
        entityType: "enrolment",
        entityId: pupil.studentProfileId,
        field: "enrolmentStatusCode",
        message: `${name} has no statutory enrolment status.`,
      }),
    );
  } else if (
    pupil.enrolmentStatusCode &&
    !isStatutoryCode(codeLookup, "enrolment_status", pupil.enrolmentStatusCode)
  ) {
    issues.push(
      issue({
        ruleKey: "pupil.enrolment_status.invalid",
        severity: "error",
        entityType: "enrolment",
        entityId: pupil.studentProfileId,
        field: "enrolmentStatusCode",
        message: `${name} has an unrecognised enrolment status code.`,
      }),
    );
  }
  if (onRoll && !pupil.dateOfAdmission && pupil.enrolments.length === 0) {
    issues.push(
      issue({
        ruleKey: "pupil.admission.missing",
        severity: "error",
        entityType: "enrolment",
        entityId: pupil.studentProfileId,
        field: "dateOfAdmission",
        message: `${name} has no admission date or enrolment.`,
      }),
    );
  }
  if (pupil.dateOfAdmission && pupil.dateOfLeaving && pupil.dateOfAdmission > pupil.dateOfLeaving) {
    issues.push(
      issue({
        ruleKey: "pupil.dates.inconsistent",
        severity: "error",
        entityType: "enrolment",
        entityId: pupil.studentProfileId,
        field: "dateOfLeaving",
        message: `${name} has a leaving date before the admission date.`,
      }),
    );
  }
  if (onRoll && !pupil.yearGroupCode) {
    issues.push(
      issue({
        ruleKey: "pupil.year_group.missing",
        severity: "error",
        entityType: "enrolment",
        entityId: pupil.studentProfileId,
        field: "yearGroupCode",
        message: `${name} is not assigned to a year group in the current academic structure.`,
      }),
    );
  }
  if (pupil.dateOfLeaving && !pupil.leavingReasonCode) {
    issues.push(
      issue({
        ruleKey: "pupil.leaving_reason.missing",
        severity: "warning",
        entityType: "enrolment",
        entityId: pupil.studentProfileId,
        field: "leavingReasonCode",
        message: `${name} has a leaving date but no leaving reason.`,
      }),
    );
  } else if (
    pupil.leavingReasonCode &&
    !isStatutoryCode(codeLookup, "leaving_reason", pupil.leavingReasonCode)
  ) {
    issues.push(
      issue({
        ruleKey: "pupil.leaving_reason.invalid",
        severity: "error",
        entityType: "enrolment",
        entityId: pupil.studentProfileId,
        field: "leavingReasonCode",
        message: `${name} has an unrecognised leaving reason.`,
      }),
    );
  }

  const send = mapOperationalSendToStatutory({
    sendProvisionCode: pupil.sendProvisionCode,
    sendNotes: pupil.sendNotes,
  });
  if (send.incomplete) {
    issues.push(
      issue({
        ruleKey: "pupil.send.incomplete",
        severity: "warning",
        entityType: "send",
        entityId: pupil.studentProfileId,
        field: "sendProvisionCode",
        message: `${name} has additional-needs notes but no statutory SEND provision classification.`,
      }),
    );
  } else if (
    pupil.sendProvisionCode &&
    !isStatutoryCode(codeLookup, "send_provision", pupil.sendProvisionCode)
  ) {
    issues.push(
      issue({
        ruleKey: "pupil.send.invalid",
        severity: "error",
        entityType: "send",
        entityId: pupil.studentProfileId,
        field: "sendProvisionCode",
        message: `${name} has an unrecognised SEND provision code.`,
      }),
    );
  }

  const overlappingFsm = pupil.fsmPeriods.some((period, index) =>
    pupil.fsmPeriods.some(
      (other, otherIndex) =>
        otherIndex > index &&
        period.startedOn <= (other.endedOn ?? "9999-12-31") &&
        other.startedOn <= (period.endedOn ?? "9999-12-31"),
    ),
  );
  if (overlappingFsm) {
    issues.push(
      issue({
        ruleKey: "pupil.fsm.overlap",
        severity: "error",
        entityType: "fsm",
        entityId: pupil.studentProfileId,
        field: "fsmPeriods",
        message: `${name} has overlapping FSM eligibility periods.`,
      }),
    );
  }
  if (pupil.fsmPeriods.some((period) => period.endedOn && period.endedOn < period.startedOn)) {
    issues.push(
      issue({
        ruleKey: "pupil.fsm.dates_invalid",
        severity: "error",
        entityType: "fsm",
        entityId: pupil.studentProfileId,
        field: "fsmPeriods",
        message: `${name} has an FSM period that ends before it starts.`,
      }),
    );
  }
  if (onRoll && fsmEligibleOnDate(pupil.fsmPeriods, asOf)) {
    issues.push(
      issue({
        ruleKey: "pupil.fsm.eligible",
        severity: "information",
        entityType: "fsm",
        entityId: pupil.studentProfileId,
        field: "fsmPeriods",
        message: `${name} is FSM eligible on the census date.`,
      }),
    );
  }
  if (pupil.lookedAfterStatus && !isStatutoryCode(codeLookup, "looked_after", pupil.lookedAfterStatus)) {
    issues.push(
      issue({
        ruleKey: "pupil.looked_after.invalid",
        severity: "error",
        entityType: "pupil",
        entityId: pupil.studentProfileId,
        field: "lookedAfterStatus",
        message: `${name} has an unrecognised looked-after status.`,
      }),
    );
  }
  return issues;
}

export function validateStatutory(subject: StatutoryValidationSubject): StatutoryIssue[] {
  const upnIndex = new Map<string, string[]>();
  for (const pupil of subject.pupils) {
    const upn = validateUpn(pupil.upn);
    if (upn.ok && upn.normalised) {
      const holders = upnIndex.get(upn.normalised) ?? [];
      holders.push(pupil.studentProfileId);
      upnIndex.set(upn.normalised, holders);
    }
  }
  const issues = [
    ...validateStatutorySchool(subject.school, subject.attendanceConfig),
    ...subject.pupils.flatMap((pupil) =>
      validateStatutoryPupil(pupil, subject.asOf, subject.codeLookup, upnIndex),
    ),
  ];
  return issues.sort((a, b) => {
    const severity = { error: 0, warning: 1, information: 2 }[a.severity] - { error: 0, warning: 1, information: 2 }[b.severity];
    if (severity !== 0) return severity;
    return a.ruleKey.localeCompare(b.ruleKey);
  });
}
