import { describe, expect, it } from "vitest";
import {
  describeEnrolmentChange,
  enrolmentFormInitialState,
  filterFormClasses,
  formatPupilAddress,
  guardianAccountLabel,
  isSamePrimaryPlacement,
  lookedAfterPersistValue,
  mapOperationalGenderToStatutorySex,
  parsePupilRecordTab,
  portalAccessGranted,
  portalAccessLabel,
  pupilIdentityGaps,
  resolvePupilRecordTab,
  selectedEnrolmentClassId,
  sensitiveSelectValue,
  statutoryIssueFix,
  upnValidationMessage,
  visiblePupilRecordTabs,
} from "@schoolapp/domain";
import { validateUpn } from "./upn.js";

describe("pupil record helpers", () => {
  it("maps only valid operational gender to statutory sex", () => {
    expect(mapOperationalGenderToStatutorySex("female")).toBe("F");
    expect(mapOperationalGenderToStatutorySex("Male")).toBe("M");
    expect(mapOperationalGenderToStatutorySex("prefer_not_to_say")).toBeNull();
    expect(mapOperationalGenderToStatutorySex("custom-answer")).toBeNull();
    expect(mapOperationalGenderToStatutorySex(null)).toBeNull();
  });

  it("does not treat missing sensitive values as the first catalogue option", () => {
    expect(sensitiveSelectValue(null)).toBe("");
    expect(sensitiveSelectValue("looked_after")).toBe("looked_after");
    expect(lookedAfterPersistValue("")).toBe("none");
    expect(lookedAfterPersistValue("looked_after")).toBe("looked_after");
    expect(lookedAfterPersistValue(undefined)).toBe("none");
  });

  it("starts enrolment forms without the first year-group catalogue row", () => {
    const years = [
      { id: "y-old", isCurrent: false },
      { id: "y-current", isCurrent: true },
    ];
    expect(
      enrolmentFormInitialState({
        currentAcademicYearId: "y-current",
        currentYearGroupId: "year-3",
        currentFormClassId: "class-3a",
        academicYears: years,
      }),
    ).toEqual({ academicYearId: "y-current", yearGroupId: "", classId: "" });
    expect(
      enrolmentFormInitialState({
        academicYears: years,
      }).yearGroupId,
    ).toBe("");
  });

  it("filters form classes by academic year and year group", () => {
    const classes = [
      { id: "3a", name: "3A", classType: "form", academicYearId: "y1", yearGroupId: "yg3" },
      { id: "n1", name: "Nursery", classType: "form", academicYearId: "y1", yearGroupId: "ygN" },
      { id: "maths", name: "Maths", classType: "teaching", academicYearId: "y1", yearGroupId: "yg3" },
      { id: "3a-next", name: "3A", classType: "form", academicYearId: "y2", yearGroupId: "yg3" },
    ];
    expect(filterFormClasses(classes, { academicYearId: "y1", yearGroupId: "yg3" }).map((row) => row.id)).toEqual([
      "3a",
    ]);
    expect(selectedEnrolmentClassId("3a", filterFormClasses(classes, { academicYearId: "y1", yearGroupId: "yg3" }))).toBe(
      "3a",
    );
    expect(selectedEnrolmentClassId("3a", filterFormClasses(classes, { academicYearId: "y1", yearGroupId: "ygN" }))).toBe(
      "",
    );
    expect(selectedEnrolmentClassId("3a", filterFormClasses(classes, { academicYearId: "y2", yearGroupId: "yg3" }))).toBe(
      "",
    );
  });

  it("falls back from hidden or unknown pupil-record hash tabs", () => {
    const adminTabs = visiblePupilRecordTabs({ canViewStatutory: true, canViewPastoral: true });
    const teacherTabs = visiblePupilRecordTabs({ canViewStatutory: false, canViewPastoral: false });
    const parentOrStudentTabs = visiblePupilRecordTabs({ canViewStatutory: false, canViewPastoral: false });
    expect(adminTabs).toContain("statutory");
    expect(adminTabs).toContain("pastoral");
    expect(teacherTabs).not.toContain("statutory");
    expect(parentOrStudentTabs).toEqual(["overview", "attendance", "learning", "academic", "documents"]);
    const healthTabs = visiblePupilRecordTabs({ canViewHealth: true });
    expect(healthTabs).toContain("health");
    expect(healthTabs).not.toContain("statutory");
    expect(resolvePupilRecordTab("#medication", healthTabs)).toBe("health");
    expect(resolvePupilRecordTab("#dietary", healthTabs)).toBe("health");
    expect(resolvePupilRecordTab("#health", teacherTabs)).toBe("overview");
    expect(resolvePupilRecordTab("#statutory", adminTabs)).toBe("statutory");
    expect(resolvePupilRecordTab("#statutory", teacherTabs)).toBe("overview");
    expect(resolvePupilRecordTab("#pastoral", parentOrStudentTabs)).toBe("overview");
    expect(resolvePupilRecordTab("#does-not-exist", adminTabs)).toBe("overview");
    expect(resolvePupilRecordTab("", teacherTabs)).toBe("overview");
  });

  it("rejects an unchanged primary placement", () => {
    expect(
      isSamePrimaryPlacement({
        currentAcademicYearId: "y1",
        currentYearGroupId: "yg3",
        currentFormClassId: "3a",
        academicYearId: "y1",
        yearGroupId: "yg3",
        classId: "3a",
        placementKind: "primary",
      }),
    ).toBe(true);
    expect(
      isSamePrimaryPlacement({
        currentAcademicYearId: "y1",
        currentYearGroupId: "yg3",
        currentFormClassId: "3a",
        academicYearId: "y1",
        yearGroupId: "yg4",
        classId: "4a",
        placementKind: "primary",
      }),
    ).toBe(false);
  });

  it("describes an enrolment move without implying a second overlapping row", () => {
    expect(
      describeEnrolmentChange({
        currentAcademicYearName: "2026/27",
        currentYearGroupName: "Year 3",
        currentFormClassName: "3A",
        nextAcademicYearName: "2026/27",
        nextYearGroupName: "Year 4",
        nextFormClassName: "4A",
      }),
    ).toContain("move the pupil from 2026/27 · Year 3 · 3A to 2026/27 · Year 4 · 4A");
  });

  it("labels guardian account and portal access separately", () => {
    expect(guardianAccountLabel("invited")).toBe("Invite pending");
    expect(guardianAccountLabel("active")).toBe("Account active");
    expect(guardianAccountLabel(null)).toBe("No account");
    expect(portalAccessLabel(true)).toBe("Enabled");
    expect(portalAccessLabel(false)).toBe("Off");
    expect(portalAccessGranted(undefined)).toBe(false);
    expect(portalAccessGranted(null)).toBe(false);
    expect(portalAccessGranted(false)).toBe(false);
    expect(portalAccessGranted(true)).toBe(true);
  });

  it("links identity warnings to pupil details and statutory warnings to the statutory record", () => {
    expect(
      statutoryIssueFix({
        ruleKey: "pupil.dob.missing",
        field: "dateOfBirth",
        entityId: "stu-1",
      }),
    ).toEqual({ href: "/school/students/stu-1#overview", label: "Fix pupil details" });
    expect(
      statutoryIssueFix({
        ruleKey: "pupil.sex.missing",
        field: "sex",
        entityId: "stu-1",
      }),
    ).toEqual({ href: "/school/students/stu-1#statutory", label: "Fix statutory record" });
  });

  it("keeps client UPN wording aligned with the server validator", () => {
    expect(upnValidationMessage(validateUpn("NOT-A-UPN").reason)).toBe("UPN format is invalid.");
    expect(upnValidationMessage(validateUpn("").reason)).toBeNull();
    expect(parsePupilRecordTab("#statutory")).toBe("statutory");
    expect(parsePupilRecordTab("")).toBe("overview");
    expect(formatPupilAddress({ addressLine1: "1 High St", addressTown: "Leeds", addressPostcode: "LS1 1AA" })).toBe(
      "1 High St, Leeds, LS1 1AA",
    );
    expect(pupilIdentityGaps({ legalName: "Freya Walsh", dateOfBirth: null, sex: null })).toContain("date of birth");
  });
});
