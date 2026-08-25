import { describe, expect, it } from "vitest";
import { summariseStatutoryAttendance } from "./statutory-attendance.js";
import { fsmEligibleOnDate, mapOperationalSendToStatutory, censusIsImmutable } from "./statutory.js";
import { defaultStatutoryCodeLookup } from "./statutory-codes.js";
import { validateStatutory } from "./statutory-validation.js";
import type { PupilStatutoryRecord } from "./statutory.js";

const pupilBase: PupilStatutoryRecord = {
  studentProfileId: "p1",
  legalName: "Amelia Khan",
  preferredName: "Amelia",
  legalSurname: "Khan",
  legalForename: "Amelia",
  middleNames: null,
  dateOfBirth: "2018-04-12",
  sex: "F",
  upn: "P201990100001",
  formerUpn: null,
  ethnicityCode: "APKN",
  languageCode: "ENG",
  enrolmentStatus: "enrolled",
  enrolmentStatusCode: "C",
  admissionNumber: "GW-1",
  dateOfAdmission: "2026-09-01",
  dateOfLeaving: null,
  leavingReasonCode: null,
  previousSchoolName: null,
  yearGroupId: "yg3",
  yearGroupCode: "3",
  yearGroupName: "Year 3",
  classId: "c3a",
  className: "3A",
  academicYearId: "ay",
  sendProvisionCode: "N",
  sendNotes: null,
  lookedAfterStatus: "none",
  serviceChild: false,
  fsmPeriods: [],
  enrolments: [{ startedOn: "2026-09-01", endedOn: null, isPrimary: true, yearGroupId: "yg3", academicYearId: "ay" }],
};

const school = {
  establishmentNumber: "9901",
  localAuthorityNumber: "201",
  urn: "999001",
  statutoryName: "Greenwood Academy (demo)",
  schoolPhase: "PS",
  establishmentType: "11",
  establishmentStatus: "1",
  addressLine1: "1 Demo Lane",
  addressTown: "London",
  addressPostcode: "N1 1AA",
  timezone: "Europe/London",
};

describe("statutory validation engine", () => {
  it("flags missing and duplicate UPNs, required fields, and code-set errors", () => {
    const duplicate = { ...pupilBase, studentProfileId: "p2", legalName: "Jack Brennan", legalForename: "Jack", legalSurname: "Brennan" };
    const missing = {
      ...pupilBase,
      studentProfileId: "p3",
      legalName: "Priya Shah",
      legalForename: "Priya",
      legalSurname: "Shah",
      upn: null,
      ethnicityCode: null,
      languageCode: null,
      sex: null,
    };
    const issues = validateStatutory({
      asOf: "2026-10-01",
      school,
      pupils: [pupilBase, duplicate, missing],
      codeLookup: defaultStatutoryCodeLookup,
      attendanceConfig: { activeSessionCount: 2, unmappedCodeCount: 0 },
    });
    expect(issues.some((row) => row.ruleKey === "pupil.upn.duplicate")).toBe(true);
    expect(issues.some((row) => row.ruleKey === "pupil.upn.missing" && row.entityId === "p3")).toBe(true);
    expect(issues.some((row) => row.ruleKey === "pupil.sex.missing")).toBe(true);
    expect(issues.some((row) => row.ruleKey === "pupil.ethnicity.missing")).toBe(true);
  });

  it("applies the same rules to a snapshot-shaped record", () => {
    const live = validateStatutory({
      asOf: "2026-10-01",
      school,
      pupils: [{ ...pupilBase, upn: "A201990100001" }],
      codeLookup: defaultStatutoryCodeLookup,
    });
    const snapshot = validateStatutory({
      asOf: "2026-10-01",
      school,
      pupils: [{ ...pupilBase, upn: "A201990100001" }],
      codeLookup: defaultStatutoryCodeLookup,
    });
    expect(live.map((row) => row.ruleKey)).toEqual(snapshot.map((row) => row.ruleKey));
    expect(live.some((row) => row.ruleKey === "pupil.upn.invalid")).toBe(true);
  });
});

describe("SEND mapping and FSM periods", () => {
  it("does not treat operational notes as a census SEND classification", () => {
    expect(mapOperationalSendToStatutory({ sendProvisionCode: "E", sendNotes: "EHCP (demo)" })).toEqual({
      code: "E",
      incomplete: false,
    });
    expect(mapOperationalSendToStatutory({ sendProvisionCode: "N", sendNotes: "Needs review" }).incomplete).toBe(
      true,
    );
  });

  it("treats FSM as historical periods, not a permanent boolean", () => {
    const periods = [
      { startedOn: "2026-09-01", endedOn: "2026-12-31" },
      { startedOn: "2027-04-01", endedOn: null },
    ];
    expect(fsmEligibleOnDate(periods, "2026-10-01")).toBe(true);
    expect(fsmEligibleOnDate(periods, "2027-01-15")).toBe(false);
    expect(fsmEligibleOnDate(periods, "2027-04-01")).toBe(true);
  });
});

describe("statutory attendance denominators", () => {
  it("excludes sessions before admission", () => {
    const summary = summariseStatutoryAttendance(
      {
        enrolmentStatus: "enrolled",
        dateOfAdmission: "2026-11-03",
        dateOfLeaving: null,
        enrolments: [{ startedOn: "2026-11-03", endedOn: null, isPrimary: true }],
      },
      [
        { markDate: "2026-11-02", category: "unauthorised_absence" },
        { markDate: "2026-11-03", category: "present" },
        { markDate: "2026-11-03", category: "late" },
      ],
    );
    expect(summary.sessionsPossible).toBe(2);
    expect(summary.sessionsPresent).toBe(2);
    expect(summary.late).toBe(1);
    expect(summary.unauthorisedAbsence).toBe(0);
  });
});

describe("census snapshot lifecycle", () => {
  it("treats ready and later statuses as immutable", () => {
    expect(censusIsImmutable("draft")).toBe(false);
    expect(censusIsImmutable("validating")).toBe(false);
    expect(censusIsImmutable("ready")).toBe(true);
    expect(censusIsImmutable("exported")).toBe(true);
    expect(censusIsImmutable("superseded")).toBe(true);
    expect(censusIsImmutable("archived")).toBe(true);
  });
});
