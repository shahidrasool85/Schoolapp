import { describe, expect, it } from "vitest";
import {
  matchSearchDestinations,
  PARENT_SEARCH_DESTINATIONS,
  STAFF_SEARCH_DESTINATIONS,
  STUDENT_SEARCH_DESTINATIONS,
} from "@schoolapp/domain";

describe("global search destinations", () => {
  it("maps common navigation queries for school admin", () => {
    const admin = [
      "academic.structure.manage",
      "timetable.read",
      "timetable.manage",
      "students.profiles.read",
      "attendance.read",
      "finance.read",
      "finance.invoices.read",
      "finance.payments.read",
    ];
    expect(matchSearchDestinations("term dates", STAFF_SEARCH_DESTINATIONS, admin).map((item) => item.href)).toContain(
      "/school/term-dates",
    );
    expect(matchSearchDestinations("academic calendar", STAFF_SEARCH_DESTINATIONS, admin).map((item) => item.href)).toContain(
      "/school/term-dates",
    );
    expect(matchSearchDestinations("add lesson", STAFF_SEARCH_DESTINATIONS, admin).map((item) => item.href)).toContain(
      "/school/timetable/schedule",
    );
    expect(matchSearchDestinations("timetable", STAFF_SEARCH_DESTINATIONS, admin).map((item) => item.href)).toContain(
      "/school/timetable/schedule",
    );
    expect(matchSearchDestinations("student records", STAFF_SEARCH_DESTINATIONS, admin).map((item) => item.href)).toContain(
      "/school/students",
    );
    expect(matchSearchDestinations("invoices", STAFF_SEARCH_DESTINATIONS, admin).map((item) => item.href)).toContain(
      "/school/finance/invoices",
    );
    expect(matchSearchDestinations("receipts", STAFF_SEARCH_DESTINATIONS, admin).map((item) => item.href)).toContain(
      "/school/finance/receipts",
    );
  });

  it("hides School Admin finance and safeguarding destinations from teachers", () => {
    const teacher = ["timetable.read", "students.profiles.read_assigned", "attendance.read"];
    const titles = matchSearchDestinations("invoices", STAFF_SEARCH_DESTINATIONS, teacher).map((item) => item.title);
    expect(titles).not.toContain("Finance invoices");
    expect(matchSearchDestinations("safeguarding", STAFF_SEARCH_DESTINATIONS, teacher)).toEqual([]);
    expect(matchSearchDestinations("term dates", STAFF_SEARCH_DESTINATIONS, teacher)).toEqual([]);
    expect(matchSearchDestinations("timetable", STAFF_SEARCH_DESTINATIONS, teacher).map((item) => item.href)).toContain(
      "/school/timetable/schedule",
    );
  });

  it("lets parents reach fees but not staff admin pages", () => {
    const parent = ["finance.read_own_children"];
    expect(matchSearchDestinations("fees", PARENT_SEARCH_DESTINATIONS, parent).map((item) => item.href)).toContain(
      "/parent/finance",
    );
    expect(matchSearchDestinations("term dates", PARENT_SEARCH_DESTINATIONS, parent)).toEqual([]);
    expect(matchSearchDestinations("timetable", STUDENT_SEARCH_DESTINATIONS, []).map((item) => item.href)).toContain(
      "/student/timetable",
    );
  });
});
