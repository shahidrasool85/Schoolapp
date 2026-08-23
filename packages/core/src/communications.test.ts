import { describe, expect, it } from "vitest";
import {
  announcementNeedsActivation,
  buildCommunicationResourceKey,
  effectiveAnnouncementStatus,
  eventDatesValid,
  isAnnouncementStatusTransitionAllowed,
  isBroadcastTargetType,
  isEventStatusTransitionAllowed,
  summariseAnnouncementReceipts,
} from "./communications.js";

describe("communications domain", () => {
  it("allows the announcement lifecycle and blocks illegal moves", () => {
    expect(isAnnouncementStatusTransitionAllowed("draft", "scheduled")).toBe(true);
    expect(isAnnouncementStatusTransitionAllowed("scheduled", "published")).toBe(true);
    expect(isAnnouncementStatusTransitionAllowed("published", "expired")).toBe(true);
    expect(isAnnouncementStatusTransitionAllowed("published", "draft")).toBe(false);
    expect(isAnnouncementStatusTransitionAllowed("archived", "published")).toBe(false);
  });

  it("treats published-but-expired notices as expired", () => {
    expect(effectiveAnnouncementStatus("published", "2020-01-01T00:00:00Z", new Date("2026-01-01"))).toBe(
      "expired",
    );
    expect(effectiveAnnouncementStatus("published", "2030-01-01T00:00:00Z", new Date("2026-01-01"))).toBe(
      "published",
    );
  });

  it("activates scheduled items when publish_at is due", () => {
    expect(announcementNeedsActivation("scheduled", "2020-01-01T00:00:00Z")).toBe(true);
    expect(announcementNeedsActivation("scheduled", "2099-01-01T00:00:00Z")).toBe(false);
    expect(announcementNeedsActivation("draft", "2020-01-01T00:00:00Z")).toBe(false);
  });

  it("requires event end on or after start", () => {
    expect(eventDatesValid("2026-09-01T09:00:00Z", "2026-09-01T10:00:00Z")).toBe(true);
    expect(eventDatesValid("2026-09-01T10:00:00Z", "2026-09-01T09:00:00Z")).toBe(false);
  });

  it("summarises receipts without inventing acknowledgements", () => {
    expect(
      summariseAnnouncementReceipts({
        recipients: 10,
        read: 4,
        acknowledged: 2,
        acknowledgementRequired: true,
      }),
    ).toEqual({
      recipients: 10,
      read: 4,
      unread: 6,
      acknowledged: 2,
      outstandingAcknowledgements: 8,
    });
    expect(
      summariseAnnouncementReceipts({
        recipients: 10,
        read: 4,
        acknowledged: 2,
        acknowledgementRequired: false,
      }).outstandingAcknowledgements,
    ).toBe(0);
  });

  it("treats whole-school and year-group audiences as broadcast targets", () => {
    expect(isBroadcastTargetType("whole_school")).toBe(true);
    expect(isBroadcastTargetType("year_group")).toBe(true);
    expect(isBroadcastTargetType("class")).toBe(false);
  });

  it("builds storage keys without exposing raw filenames unsafely", () => {
    expect(
      buildCommunicationResourceKey({
        organisationId: "org",
        kind: "announcement",
        parentId: "a1",
        resourceId: "r1",
        filename: "../secret.pdf",
      }),
    ).toBe("org/org/communications/announcement/a1/r1/.._secret.pdf");
  });

  it("allows event cancel and archive but not republish from archived", () => {
    expect(isEventStatusTransitionAllowed("published", "cancelled")).toBe(true);
    expect(isEventStatusTransitionAllowed("cancelled", "archived")).toBe(true);
    expect(isEventStatusTransitionAllowed("archived", "published")).toBe(false);
  });
});
