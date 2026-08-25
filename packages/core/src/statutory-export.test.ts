import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_SUMMARY_COLUMNS,
  CENSUS_SNAPSHOT_COLUMNS,
  PUPIL_ROLL_COLUMNS,
  censusXmlPreview,
  csvCell,
  preventCsvInjection,
  toCsv,
} from "./statutory-export.js";

describe("CSV export safety", () => {
  it("prefixes formula-like cells", () => {
    expect(preventCsvInjection("=1+1")).toBe("'=1+1");
    expect(preventCsvInjection("+cmd")).toBe("'+cmd");
    expect(preventCsvInjection("-2+3")).toBe("'-2+3");
    expect(preventCsvInjection("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(preventCsvInjection("Amelia Khan")).toBe("Amelia Khan");
  });

  it("quotes commas, quotes, and newlines", () => {
    expect(csvCell('Khan, Amelia')).toBe('"Khan, Amelia"');
    expect(csvCell('He said "hello"')).toBe('"He said ""hello"""');
  });

  it("emits UTF-8 BOM, CRLF, and stable headers", () => {
    const csv = toCsv(PUPIL_ROLL_COLUMNS, [["GW-1", "Khan", "Amelia", null, "2018-04-12", "F", "3", "3A", "enrolled", "2026-09-01", null, true]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("admissionNumber,legalSurname,legalForename");
    expect(csv.split("\r\n")[0]?.replace("\uFEFF", "")).toBe(PUPIL_ROLL_COLUMNS.join(","));
    expect(ATTENDANCE_SUMMARY_COLUMNS[0]).toBe("admissionNumber");
    expect(CENSUS_SNAPSHOT_COLUMNS[1]).toBe("upn");
  });

  it("labels XML as a census-ready preview, not a DfE submission", () => {
    const xml = censusXmlPreview(
      {
        statutoryName: "Greenwood Academy",
        localAuthorityNumber: "201",
        establishmentNumber: "9901",
        urn: "999001",
        censusType: "autumn",
        censusDate: "2026-10-01",
        snapshotVersion: 1,
        schemaVersion: 1,
      },
      [
        {
          admissionNumber: "GW-1",
          upn: "P201990100001",
          legalSurname: "Khan",
          legalForename: "Amelia",
          middleNames: null,
          dateOfBirth: "2018-04-12",
          sex: "F",
          ethnicity: "APKN",
          language: "ENG",
          enrolmentStatus: "C",
          yearGroup: "3",
          className: "3A",
          dateOfAdmission: "2026-09-01",
          sendProvision: "K",
          fsmEligible: false,
          onRoll: true,
        },
      ],
    );
    expect(xml).toContain("Not a DfE-approved COLLECT submission");
    expect(xml).toContain("<UPN>P201990100001</UPN>");
    expect(xml).not.toContain("DfE approved");
  });
});
