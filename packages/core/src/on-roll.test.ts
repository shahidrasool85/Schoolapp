import { describe, expect, it } from "vitest";
import {
  dateCountsTowardAttendance,
  isCurrentPupil,
  isFormerPupil,
  isOnRollOnDate,
  leftDuringPeriod,
  wasAdmittedDuringPeriod,
} from "./on-roll.js";

const enrolled = {
  enrolmentStatus: "enrolled",
  dateOfAdmission: "2026-09-01",
  dateOfLeaving: null as string | null,
  enrolments: [{ startedOn: "2026-09-01", endedOn: null as string | null, isPrimary: true }],
};

describe("on-roll date boundaries", () => {
  it("counts the admission date as on roll and the day before as off roll", () => {
    expect(isOnRollOnDate(enrolled, "2026-09-01")).toBe(true);
    expect(isOnRollOnDate(enrolled, "2026-08-31")).toBe(false);
  });

  it("counts the leaving date as the last day on roll", () => {
    const leaver = {
      ...enrolled,
      enrolmentStatus: "left",
      dateOfLeaving: "2026-12-18",
      enrolments: [{ startedOn: "2026-09-01", endedOn: "2026-12-18", isPrimary: true }],
    };
    expect(isOnRollOnDate(leaver, "2026-12-18")).toBe(true);
    expect(isOnRollOnDate(leaver, "2026-12-19")).toBe(false);
    expect(isFormerPupil(leaver, "2026-12-19")).toBe(true);
    expect(isCurrentPupil(leaver, "2026-12-18")).toBe(false);
  });

  it("identifies joiners and leavers inside a period, including boundary dates", () => {
    const joiner = {
      ...enrolled,
      dateOfAdmission: "2026-11-03",
      enrolments: [{ startedOn: "2026-11-03", endedOn: null, isPrimary: true }],
    };
    expect(wasAdmittedDuringPeriod(joiner, "2026-09-01", "2026-12-31")).toBe(true);
    expect(wasAdmittedDuringPeriod(joiner, "2026-11-03", "2026-11-03")).toBe(true);
    expect(wasAdmittedDuringPeriod(joiner, "2026-09-01", "2026-11-02")).toBe(false);

    const leaver = {
      ...enrolled,
      dateOfLeaving: "2026-12-18",
      enrolments: [{ startedOn: "2026-09-01", endedOn: "2026-12-18", isPrimary: true }],
    };
    expect(leftDuringPeriod(leaver, "2026-12-01", "2026-12-31")).toBe(true);
    expect(leftDuringPeriod(leaver, "2026-12-18", "2026-12-18")).toBe(true);
    expect(leftDuringPeriod(leaver, "2026-09-01", "2026-12-17")).toBe(false);
  });

  it("does not count attendance sessions before admission or after leaving", () => {
    const joiner = {
      ...enrolled,
      dateOfAdmission: "2026-11-03",
      enrolments: [{ startedOn: "2026-11-03", endedOn: null, isPrimary: true }],
    };
    expect(dateCountsTowardAttendance(joiner, "2026-11-02")).toBe(false);
    expect(dateCountsTowardAttendance(joiner, "2026-11-03")).toBe(true);
  });

  it("treats prospective pupils as never on roll", () => {
    expect(
      isOnRollOnDate(
        { ...enrolled, enrolmentStatus: "prospective" },
        "2026-09-01",
      ),
    ).toBe(false);
  });
});
