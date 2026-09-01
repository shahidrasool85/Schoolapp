import { describe, expect, it } from "vitest";
import {
  APPLY_FROM_AFTER_ORIGINAL_END,
  computeRecurrenceStatus,
  defaultStopFromDate,
  recurrenceLifecycleFromState,
  recurrencePatchTouchesStructure,
  validateRecurrenceApplyFrom,
  validateRecurrenceStopFrom,
} from "@schoolapp/domain";

describe("recurrence lifecycle", () => {
  it("treats unused future recurrences as deletable", () => {
    const lifecycle = recurrenceLifecycleFromState({
      effectiveFrom: "2026-09-03",
      effectiveUntil: null,
      isActive: true,
      today: "2026-08-31",
      usage: [
        { key: "timetable_covers", label: "cover assignments", count: 0 },
        { key: "attendance_marks", label: "attendance marks", count: 0 },
      ],
    });
    expect(lifecycle.status).toBe("future");
    expect(lifecycle.canDelete).toBe(true);
    expect(lifecycle.canEnd).toBe(false);
    expect(lifecycle.canEditStructure).toBe(true);
  });

  it("blocks hard delete once a recurrence has started or has history", () => {
    const active = recurrenceLifecycleFromState({
      effectiveFrom: "2026-08-01",
      effectiveUntil: null,
      isActive: true,
      today: "2026-08-31",
      usage: [],
    });
    expect(active.status).toBe("active");
    expect(active.canDelete).toBe(false);
    expect(active.canEnd).toBe(true);
    expect(active.canEditStructure).toBe(false);
    const withCover = recurrenceLifecycleFromState({
      effectiveFrom: "2026-09-03",
      effectiveUntil: null,
      isActive: true,
      today: "2026-08-31",
      usage: [{ key: "timetable_covers", label: "cover assignments", count: 1 }],
    });
    expect(withCover.canDelete).toBe(false);
    expect(withCover.canEnd).toBe(true);
    expect(withCover.message).toMatch(/already has timetable history/i);
    expect(withCover.message).toMatch(/End the recurrence instead/i);
  });

  it("marks ended recurrences as readable history", () => {
    expect(
      computeRecurrenceStatus({
        effectiveFrom: "2026-08-01",
        effectiveUntil: "2026-08-20",
        isActive: true,
        today: "2026-08-31",
      }),
    ).toBe("ended");
    const ended = recurrenceLifecycleFromState({
      effectiveFrom: "2026-08-01",
      effectiveUntil: "2026-08-20",
      isActive: true,
      today: "2026-08-31",
      usage: [{ key: "timetable_covers", label: "cover assignments", count: 2 }],
    });
    expect(ended.canDelete).toBe(false);
    expect(ended.canEnd).toBe(false);
    expect(ended.message).toMatch(/Past timetable history remains readable/i);
    expect(
      computeRecurrenceStatus({
        effectiveFrom: "2026-08-01",
        effectiveUntil: "2026-09-10",
        isActive: true,
        today: "2026-08-31",
      }),
    ).toBe("active");
    expect(
      computeRecurrenceStatus({
        effectiveFrom: "2026-08-01",
        effectiveUntil: "2026-09-10",
        isActive: true,
        today: "2026-09-11",
      }),
    ).toBe("ended");
  });

  it("stops from a date without rewriting the past", () => {
    expect(defaultStopFromDate("2026-08-31")).toBe("2026-09-01");
    expect(
      validateRecurrenceStopFrom({
        stopFrom: "2026-09-01",
        effectiveFrom: "2026-08-01",
        today: "2026-08-31",
        yearEndsOn: "2027-07-22",
      }),
    ).toEqual({ ok: true, effectiveUntil: "2026-08-31" });
    expect(
      validateRecurrenceStopFrom({
        stopFrom: "2026-08-20",
        effectiveFrom: "2026-08-01",
        today: "2026-08-31",
        yearEndsOn: "2027-07-22",
      }).ok,
    ).toBe(false);
    expect(recurrencePatchTouchesStructure({ weekday: 2 })).toBe(true);
    expect(recurrencePatchTouchesStructure({ staffNotes: "note" })).toBe(false);
  });

  it("splits Apply change from by inheriting the stored original end date", () => {
    expect(
      validateRecurrenceApplyFrom({
        applyFrom: "2026-11-01",
        effectiveFrom: "2026-09-03",
        effectiveUntil: "2026-12-18",
        today: "2026-09-01",
        yearEndsOn: "2027-07-23",
      }),
    ).toEqual({ ok: true, oldEffectiveUntil: "2026-10-31", inheritedUntil: "2026-12-18" });
    expect(
      validateRecurrenceApplyFrom({
        applyFrom: "2026-11-01",
        effectiveFrom: "2026-09-03",
        effectiveUntil: "2026-11-20",
        today: "2026-09-01",
        yearEndsOn: "2027-07-23",
      }),
    ).toEqual({ ok: true, oldEffectiveUntil: "2026-10-31", inheritedUntil: "2026-11-20" });
    expect(
      validateRecurrenceApplyFrom({
        applyFrom: "2026-11-01",
        effectiveFrom: "2026-09-03",
        effectiveUntil: null,
        today: "2026-09-01",
        yearEndsOn: "2027-07-23",
      }),
    ).toEqual({ ok: true, oldEffectiveUntil: "2026-10-31", inheritedUntil: null });
    const afterEnd = validateRecurrenceApplyFrom({
      applyFrom: "2026-12-19",
      effectiveFrom: "2026-09-03",
      effectiveUntil: "2026-12-18",
      today: "2026-09-01",
      yearEndsOn: "2027-07-23",
    });
    expect(afterEnd).toEqual({ ok: false, error: APPLY_FROM_AFTER_ORIGINAL_END });
  });
});
