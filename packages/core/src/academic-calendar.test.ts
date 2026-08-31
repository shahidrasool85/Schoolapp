import { describe, expect, it } from "vitest";
import {
  captureSubmitTarget,
  defaultRecurrenceEffectiveFrom,
  effectiveFromBeforeAcademicYear,
  feeScheduleAnnualMatchesInstalments,
  parseGbpPoundsToMinor,
  resetFormSafely,
  shouldOfferAcademicYearCreate,
  termKeyFromName,
  todayInTimeZone,
  uniqueTermKey,
  validateTermDates,
} from "@schoolapp/domain";

describe("recurrence effective-from defaults", () => {
  it("uses the academic-year start when today is before the year", () => {
    expect(
      defaultRecurrenceEffectiveFrom({
        today: "2026-08-31",
        academicYearStartsOn: "2026-09-03",
        academicYearEndsOn: "2027-07-22",
      }),
    ).toBe("2026-09-03");
    expect(effectiveFromBeforeAcademicYear("2026-09-01", "2026-09-03")).toBe(true);
  });

  it("uses today once the academic year has started", () => {
    expect(
      defaultRecurrenceEffectiveFrom({
        today: "2026-09-20",
        academicYearStartsOn: "2026-09-03",
        academicYearEndsOn: "2027-07-22",
      }),
    ).toBe("2026-09-20");
  });

  it("recalculates when another academic year is selected", () => {
    const today = "2026-08-31";
    expect(
      defaultRecurrenceEffectiveFrom({
        today,
        academicYearStartsOn: "2026-09-03",
        academicYearEndsOn: "2027-07-22",
      }),
    ).toBe("2026-09-03");
    expect(
      defaultRecurrenceEffectiveFrom({
        today,
        academicYearStartsOn: "2025-09-01",
        academicYearEndsOn: "2026-07-21",
      }),
    ).toBe("2026-07-21");
  });

  it("formats today in the school timezone", () => {
    const eveningUtc = new Date("2026-09-01T00:30:00Z");
    expect(todayInTimeZone("Europe/London", eveningUtc)).toBe("2026-09-01");
    expect(todayInTimeZone("America/New_York", eveningUtc)).toBe("2026-08-31");
  });
});

describe("academic year onboarding create offer", () => {
  it("offers create only when no year exists", () => {
    expect(shouldOfferAcademicYearCreate(0)).toBe(true);
    expect(shouldOfferAcademicYearCreate(1)).toBe(false);
  });
});

describe("term date validation", () => {
  it("keeps terms inside the academic year and rejects overlap", () => {
    expect(
      validateTermDates({
        startsOn: "2026-09-03",
        endsOn: "2026-12-18",
        yearStartsOn: "2026-09-03",
        yearEndsOn: "2027-07-22",
      }).ok,
    ).toBe(true);
    expect(
      validateTermDates({
        startsOn: "2026-08-01",
        endsOn: "2026-12-18",
        yearStartsOn: "2026-09-03",
        yearEndsOn: "2027-07-22",
      }).ok,
    ).toBe(false);
    expect(
      validateTermDates({
        startsOn: "2026-09-03",
        endsOn: "2026-12-18",
        yearStartsOn: "2026-09-03",
        yearEndsOn: "2027-07-22",
        otherTerms: [{ id: "autumn", startsOn: "2026-09-03", endsOn: "2026-12-18" }],
      }).ok,
    ).toBe(false);
    expect(termKeyFromName("Autumn")).toBe("autumn");
    expect(uniqueTermKey("autumn", ["autumn"])).toBe("autumn-2");
  });

  it("allows adjacent non-overlapping UK terms", () => {
    const autumn = { startsOn: "2026-09-03", endsOn: "2026-12-18" };
    expect(
      validateTermDates({
        startsOn: "2027-01-04",
        endsOn: "2027-03-31",
        yearStartsOn: "2026-09-03",
        yearEndsOn: "2027-07-22",
        otherTerms: [autumn],
      }).ok,
    ).toBe(true);
    expect(
      validateTermDates({
        startsOn: "2026-12-18",
        endsOn: "2027-03-31",
        yearStartsOn: "2026-09-03",
        yearEndsOn: "2027-07-22",
        otherTerms: [autumn],
      }).ok,
    ).toBe(false);
  });
});

describe("fee schedule amounts", () => {
  it("parses pounds and checks annual totals", () => {
    expect(parseGbpPoundsToMinor("600.00")).toEqual({ ok: true, amount: 60000 });
    expect(parseGbpPoundsToMinor("£1,200.50")).toEqual({ ok: true, amount: 120050 });
    expect(parseGbpPoundsToMinor("£2,000")).toEqual({ ok: true, amount: 200000 });
    expect(parseGbpPoundsToMinor("2000")).toEqual({ ok: true, amount: 200000 });
    expect(parseGbpPoundsToMinor("2,000.00")).toEqual({ ok: true, amount: 200000 });
    expect(parseGbpPoundsToMinor("nope").ok).toBe(false);
    expect(
      feeScheduleAnnualMatchesInstalments({
        amountMinor: 60000,
        instalmentCount: 10,
        annualAmountMinor: 600000,
      }).ok,
    ).toBe(true);
    expect(
      feeScheduleAnnualMatchesInstalments({
        amountMinor: 60000,
        instalmentCount: 10,
        annualAmountMinor: 500000,
      }).ok,
    ).toBe(false);
    expect(
      feeScheduleAnnualMatchesInstalments({
        amountMinor: 60000,
        instalmentCount: 10,
        annualAmountMinor: null,
      }).ok,
    ).toBe(true);
    expect(
      feeScheduleAnnualMatchesInstalments({
        amountMinor: 60000,
        instalmentCount: null,
        annualAmountMinor: null,
      }).ok,
    ).toBe(true);
  });
});

describe("safe form reset after async submit", () => {
  it("captures the form before await and does not throw if currentTarget later becomes null", () => {
    const calls: string[] = [];
    const form = { reset: () => calls.push("reset") };
    const event = { currentTarget: form as { reset: () => void } | null };
    const captured = captureSubmitTarget(event);
    event.currentTarget = null;
    expect(() => {
      const target = event.currentTarget;
      if (!target) {
        throw new TypeError("Cannot read properties of null (reading 'reset')");
      }
      target.reset();
    }).toThrow(/null/);
    expect(() => resetFormSafely(captured)).not.toThrow();
    expect(() => resetFormSafely(null)).not.toThrow();
    expect(calls).toEqual(["reset"]);
  });
});
