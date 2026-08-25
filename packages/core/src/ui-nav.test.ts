import { describe, expect, it } from "vitest";
import {
  formatStatusLabel,
  isActiveNavHref,
  isNavSectionOpen,
  staffDashboardKind,
  statusTone,
} from "@schoolapp/domain";

describe("isActiveNavHref", () => {
  it("does not highlight a parent when a child route is active", () => {
    const siblings = ["/school/admissions", "/school/admissions/applications"];
    expect(
      isActiveNavHref("/school/admissions/applications", "", "/school/admissions", true, siblings),
    ).toBe(false);
    expect(
      isActiveNavHref(
        "/school/admissions/applications",
        "",
        "/school/admissions/applications",
        false,
        siblings,
      ),
    ).toBe(true);
  });

  it("keeps inbox active on a conversation page without also marking archived", () => {
    const siblings = ["/school/messages", "/school/messages?folder=archived"];
    expect(isActiveNavHref("/school/messages/abc", "", "/school/messages", false, siblings)).toBe(
      true,
    );
    expect(
      isActiveNavHref("/school/messages/abc", "", "/school/messages?folder=archived", false, siblings),
    ).toBe(false);
  });

  it("highlights archived folder without also highlighting inbox", () => {
    const siblings = ["/school/messages", "/school/messages?folder=archived"];
    expect(
      isActiveNavHref("/school/messages", "folder=archived", "/school/messages", true, siblings),
    ).toBe(false);
    expect(
      isActiveNavHref(
        "/school/messages",
        "folder=archived",
        "/school/messages?folder=archived",
        false,
        siblings,
      ),
    ).toBe(true);
  });

  it("prefers a query-specific activities child over the parent list", () => {
    const siblings = ["/school/activities", "/school/activities?type=trips", "/school/activities?type=club"];
    expect(
      isActiveNavHref("/school/activities", "type=trips", "/school/activities", true, siblings),
    ).toBe(false);
    expect(
      isActiveNavHref(
        "/school/activities",
        "type=trips",
        "/school/activities?type=trips",
        false,
        siblings,
      ),
    ).toBe(true);
  });
});

describe("isNavSectionOpen", () => {
  it("opens a section for nested and query child routes", () => {
    expect(isNavSectionOpen("/school/messages/abc", "", "/school/messages", ["/school/messages"])).toBe(
      true,
    );
    expect(
      isNavSectionOpen("/school/messages", "folder=archived", "/school/messages", [
        "/school/messages?folder=archived",
      ]),
    ).toBe(true);
  });
});

describe("staffDashboardKind", () => {
  it("selects the teacher dashboard only for assigned-only pupil access", () => {
    expect(staffDashboardKind(["students.profiles.read_assigned", "lms.assignments.read_assigned"])).toBe(
      "teacher",
    );
    expect(staffDashboardKind(["students.profiles.read", "students.profiles.read_assigned"])).toBe(
      "operational",
    );
    expect(staffDashboardKind(["students.profiles.read", "admissions.read"])).toBe("operational");
    expect(staffDashboardKind(["admissions.read"])).toBe("operational");
  });
});

describe("statusTone", () => {
  it("maps common school statuses without relying on colour alone", () => {
    expect(statusTone("paid")).toBe("success");
    expect(statusTone("published")).toBe("success");
    expect(statusTone("under_review")).toBe("warning");
    expect(statusTone("overdue")).toBe("danger");
    expect(statusTone("rejected")).toBe("danger");
    expect(statusTone("draft")).toBe("warning");
    expect(statusTone("archived")).toBe("neutral");
    expect(statusTone("open")).toBe("info");
    expect(formatStatusLabel("under_review")).toBe("Under review");
  });
});
