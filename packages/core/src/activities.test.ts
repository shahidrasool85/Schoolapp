import { describe, expect, it } from "vitest";
import {
  activityDatesValid,
  activityDeadlineValid,
  activityDocumentVisibleToAudience,
  activityResponseWindowOpen,
  activityStaffSeesMedicalWindow,
  allocateRegistrationStatus,
  expandActivityOccurrences,
  isActivityStatusTransitionAllowed,
  nextWaitingListPosition,
  snapshotConsentWording,
} from "./activities.js";

describe("activities domain", () => {
  it("allows the activity lifecycle and blocks illegal moves", () => {
    expect(isActivityStatusTransitionAllowed("draft", "published")).toBe(true);
    expect(isActivityStatusTransitionAllowed("published", "cancelled")).toBe(true);
    expect(isActivityStatusTransitionAllowed("published", "draft")).toBe(false);
    expect(isActivityStatusTransitionAllowed("cancelled", "published")).toBe(false);
    expect(isActivityStatusTransitionAllowed("archived", "published")).toBe(false);
  });

  it("requires end on or after start and a sensible deadline", () => {
    expect(activityDatesValid("2026-11-12T09:00:00Z", "2026-11-12T15:30:00Z")).toBe(true);
    expect(activityDatesValid("2026-11-12T15:30:00Z", "2026-11-12T09:00:00Z")).toBe(false);
    expect(activityDeadlineValid("2026-11-01T00:00:00Z", "2026-11-12T15:30:00Z")).toBe(true);
    expect(activityDeadlineValid("2026-11-20T00:00:00Z", "2026-11-12T15:30:00Z")).toBe(false);
  });

  it("blocks parent responses after the deadline unless policy allows it", () => {
    expect(
      activityResponseWindowOpen({
        status: "published",
        responseDeadlineAt: "2026-01-01T00:00:00Z",
        allowAfterDeadline: false,
        now: new Date("2026-02-01"),
      }),
    ).toBe(false);
    expect(
      activityResponseWindowOpen({
        status: "published",
        responseDeadlineAt: "2026-01-01T00:00:00Z",
        allowAfterDeadline: true,
        now: new Date("2026-02-01"),
      }),
    ).toBe(true);
    expect(
      activityResponseWindowOpen({
        status: "cancelled",
        responseDeadlineAt: null,
        allowAfterDeadline: true,
      }),
    ).toBe(false);
  });

  it("allocates the final place then waitlists without overbooking", () => {
    expect(allocateRegistrationStatus({ capacity: 20, confirmedCount: 19, preferConfirmed: true })).toBe(
      "confirmed",
    );
    expect(allocateRegistrationStatus({ capacity: 20, confirmedCount: 20, preferConfirmed: true })).toBe(
      "waitlisted",
    );
    expect(allocateRegistrationStatus({ capacity: null, confirmedCount: 400, preferConfirmed: true })).toBe(
      "confirmed",
    );
    expect(nextWaitingListPosition([1, 2, 4])).toBe(5);
    expect(nextWaitingListPosition([])).toBe(1);
  });

  it("keeps consent wording snapshots independent of later edits", () => {
    const snapshot = snapshotConsentWording(
      [
        {
          clauseKey: "permission_to_attend",
          title: "Permission",
          wording: "I give permission for the original wording.",
          required: true,
          sortOrder: 0,
        },
      ],
      1,
      "2026-09-01T00:00:00.000Z",
    );
    expect(snapshot.consentVersion).toBe(1);
    expect((snapshot.clauses as Array<{ wording: string }>)[0]?.wording).toContain("original wording");
  });

  it("hides staff-only documents from parents and students", () => {
    expect(activityDocumentVisibleToAudience("staff", "parent")).toBe(false);
    expect(activityDocumentVisibleToAudience("staff_and_parents", "parent")).toBe(true);
    expect(activityDocumentVisibleToAudience("staff_and_parents", "student")).toBe(false);
    expect(activityDocumentVisibleToAudience("staff_parents_and_student", "student")).toBe(true);
  });

  it("limits assigned-staff medical access to the operational window", () => {
    expect(
      activityStaffSeesMedicalWindow({
        status: "published",
        endsAt: "2026-11-12T15:30:00Z",
      }),
    ).toBe(true);
    expect(
      activityStaffSeesMedicalWindow({
        status: "archived",
        endsAt: "2026-11-12T15:30:00Z",
      }),
    ).toBe(false);
  });

  it("expands recurring club dates without duplicating one-off trips", () => {
    const club = expandActivityOccurrences({
      startsAt: "2026-09-08T15:30:00.000Z",
      endsAt: "2026-09-08T16:30:00.000Z",
      occurrenceKind: "recurring",
      recurrenceWeekdays: [2],
      recurrenceUntil: "2026-09-22",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(club.map((row) => row.date)).toEqual(["2026-09-08", "2026-09-15", "2026-09-22"]);
    const trip = expandActivityOccurrences({
      startsAt: "2026-11-12T09:00:00.000Z",
      endsAt: "2026-11-12T15:30:00.000Z",
      occurrenceKind: "one_off",
      recurrenceWeekdays: null,
      recurrenceUntil: null,
    });
    expect(trip).toHaveLength(1);
  });
});
