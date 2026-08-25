const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const CSV_NEWLINE = "\r\n";

export function preventCsvInjection(value: string): string {
  if (FORMULA_PREFIX.test(value)) {
    return `'${value}`;
  }
  return value;
}

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value == null) return "";
  const raw = preventCsvInjection(String(value));
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>): string {
  const lines = [
    headers.map((header) => csvCell(header)).join(","),
    ...rows.map((row) => row.map((cell) => csvCell(cell)).join(",")),
  ];
  return `\uFEFF${lines.join(CSV_NEWLINE)}${CSV_NEWLINE}`;
}

export function xmlEscape(value: string | number | boolean | null | undefined): string {
  if (value == null) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export const PUPIL_ROLL_COLUMNS = [
  "admissionNumber",
  "legalSurname",
  "legalForename",
  "preferredName",
  "dateOfBirth",
  "sex",
  "yearGroup",
  "className",
  "enrolmentStatus",
  "dateOfAdmission",
  "dateOfLeaving",
  "onRoll",
] as const;

export const ATTENDANCE_SUMMARY_COLUMNS = [
  "admissionNumber",
  "legalName",
  "yearGroup",
  "className",
  "sessionsPossible",
  "sessionsPresent",
  "authorisedAbsence",
  "unauthorisedAbsence",
  "late",
  "attendancePercentage",
] as const;

export const ADMISSIONS_ENROLMENT_COLUMNS = [
  "admissionNumber",
  "legalName",
  "enrolmentStatus",
  "yearGroup",
  "dateOfAdmission",
  "dateOfLeaving",
  "leavingReason",
  "previousSchool",
] as const;

export const SEND_EXPORT_COLUMNS = [
  "admissionNumber",
  "legalName",
  "yearGroup",
  "sendProvision",
  "hasAdditionalNeedsRecord",
] as const;

export const CENSUS_SNAPSHOT_COLUMNS = [
  "admissionNumber",
  "upn",
  "legalSurname",
  "legalForename",
  "middleNames",
  "preferredName",
  "dateOfBirth",
  "sex",
  "ethnicity",
  "language",
  "enrolmentStatus",
  "yearGroup",
  "className",
  "dateOfAdmission",
  "dateOfLeaving",
  "sendProvision",
  "fsmEligible",
  "lookedAfterStatus",
  "serviceChild",
  "onRoll",
] as const;

export type CensusXmlPupil = {
  admissionNumber: string | null;
  upn: string | null;
  legalSurname: string | null;
  legalForename: string | null;
  middleNames: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  ethnicity: string | null;
  language: string | null;
  enrolmentStatus: string | null;
  yearGroup: string | null;
  className: string | null;
  dateOfAdmission: string | null;
  sendProvision: string | null;
  fsmEligible: boolean;
  onRoll: boolean;
};

export type CensusXmlHeader = {
  statutoryName: string | null;
  localAuthorityNumber: string | null;
  establishmentNumber: string | null;
  urn: string | null;
  censusType: string;
  censusDate: string;
  snapshotVersion: number;
  schemaVersion: number;
};

/**
 * Census-ready XML preview. This is not a DfE COLLECT submission file
 * and is not claimed to match the live School Census XSD.
 */
export function censusXmlPreview(header: CensusXmlHeader, pupils: readonly CensusXmlPupil[]): string {
  const pupilXml = pupils
    .map(
      (pupil) => `    <Pupil>
      <UPN>${xmlEscape(pupil.upn)}</UPN>
      <Surname>${xmlEscape(pupil.legalSurname)}</Surname>
      <Forename>${xmlEscape(pupil.legalForename)}</Forename>
      <MiddleNames>${xmlEscape(pupil.middleNames)}</MiddleNames>
      <DOB>${xmlEscape(pupil.dateOfBirth)}</DOB>
      <Sex>${xmlEscape(pupil.sex)}</Sex>
      <Ethnicity>${xmlEscape(pupil.ethnicity)}</Ethnicity>
      <Language>${xmlEscape(pupil.language)}</Language>
      <EnrolStatus>${xmlEscape(pupil.enrolmentStatus)}</EnrolStatus>
      <NCyearActual>${xmlEscape(pupil.yearGroup)}</NCyearActual>
      <Class>${xmlEscape(pupil.className)}</Class>
      <EntryDate>${xmlEscape(pupil.dateOfAdmission)}</EntryDate>
      <SENprovision>${xmlEscape(pupil.sendProvision)}</SENprovision>
      <FSMeligible>${pupil.fsmEligible ? "true" : "false"}</FSMeligible>
      <OnRoll>${pupil.onRoll ? "true" : "false"}</OnRoll>
    </Pupil>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Schoolapp census-ready export (preview). Not a DfE-approved COLLECT submission. -->
<SchoolCensusPreview schemaVersion="${header.schemaVersion}" snapshotVersion="${header.snapshotVersion}" generatedAs="preview">
  <Header>
    <SchoolName>${xmlEscape(header.statutoryName)}</SchoolName>
    <LA>${xmlEscape(header.localAuthorityNumber)}</LA>
    <Estab>${xmlEscape(header.establishmentNumber)}</Estab>
    <URN>${xmlEscape(header.urn)}</URN>
    <CensusType>${xmlEscape(header.censusType)}</CensusType>
    <CensusDate>${xmlEscape(header.censusDate)}</CensusDate>
  </Header>
  <Pupils>
${pupilXml}
  </Pupils>
</SchoolCensusPreview>
`;
}
