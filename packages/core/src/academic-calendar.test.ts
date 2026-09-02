import { describe, expect, it } from "vitest";
import {
  captureSubmitTarget,
  defaultRecurrenceEffectiveFrom,
  effectiveFromBeforeAcademicYear,
  FEE_SCHEDULE_DELETED_NOTICE,
  FEE_SCHEDULES_PATH,
  feeScheduleAnnualMatchesInstalments,
  feeScheduleCreateSummary,
  feeScheduleDeletedRedirect,
  feeScheduleInstalmentPlan,
  feeScheduleListNoticeFromQuery,
  formatGbpMinor,
  parseGbpPoundsToMinor,
  resetFormSafely,
  shouldOfferAcademicYearCreate,
  termKeyFromName,
  todayInTimeZone,
  uniqueTermKey,
  validateTermDates,
  validateClosureRange,
  statementPeriodRange,
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
    expect(feeScheduleInstalmentPlan(1000, 3)).toEqual({
      ok: true,
      amounts: [333, 333, 334],
      regularMinor: 333,
      finalMinor: 334,
    });
    expect(
      feeScheduleAnnualMatchesInstalments({
        amountMinor: 333,
        instalmentCount: 3,
        annualAmountMinor: 1000,
      }).ok,
    ).toBe(true);
    expect(feeScheduleCreateSummary({ annualMinor: 600000, instalmentCount: 10 })).toEqual({
      ok: true,
      text: `10 instalments × ${formatGbpMinor(60000)} = ${formatGbpMinor(600000)} total`,
      roundingNote: null,
      amountPerInstalmentMinor: 60000,
    });
    const uneven = feeScheduleCreateSummary({ annualMinor: 1000, instalmentCount: 3 });
    expect(uneven.ok).toBe(true);
    if (uneven.ok) {
      expect(uneven.amountPerInstalmentMinor).toBe(333);
      expect(uneven.roundingNote).toMatch(/final instalment/i);
    }
  });

  it("redirects successful schedule deletion to the list with a success notice", () => {
    expect(feeScheduleDeletedRedirect()).toBe(`${FEE_SCHEDULES_PATH}?notice=deleted`);
    expect(feeScheduleListNoticeFromQuery("deleted")).toBe(FEE_SCHEDULE_DELETED_NOTICE);
    expect(FEE_SCHEDULE_DELETED_NOTICE).toBe("Fee schedule deleted successfully.");
    expect(feeScheduleListNoticeFromQuery("other")).toBeNull();
    expect(feeScheduleListNoticeFromQuery(null)).toBeNull();
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

describe("closure range validation", () => {
  it("keeps half terms inside the parent term and academic year", () => {
    expect(
      validateClosureRange({
        startsOn: "2026-10-19",
        endsOn: "2026-10-30",
        yearStartsOn: "2026-09-07",
        yearEndsOn: "2027-07-09",
        termStartsOn: "2026-09-07",
        termEndsOn: "2026-12-11",
      }).ok,
    ).toBe(true);
    expect(
      validateClosureRange({
        startsOn: "2026-10-30",
        endsOn: "2026-10-19",
        yearStartsOn: "2026-09-07",
        yearEndsOn: "2027-07-09",
      }).ok,
    ).toBe(false);
    expect(
      validateClosureRange({
        startsOn: "2026-08-01",
        endsOn: "2026-08-02",
        yearStartsOn: "2026-09-07",
        yearEndsOn: "2027-07-09",
      }).ok,
    ).toBe(false);
    expect(
      validateClosureRange({
        startsOn: "2026-12-01",
        endsOn: "2026-12-20",
        yearStartsOn: "2026-09-07",
        yearEndsOn: "2027-07-09",
        termStartsOn: "2026-09-07",
        termEndsOn: "2026-12-11",
      }).ok,
    ).toBe(false);
  });
});

describe("statement period presets", () => {
  it("resolves academic, UK tax, calendar and custom ranges", () => {
    expect(
      statementPeriodRange({
        preset: "current_academic_year",
        today: "2026-10-01",
        currentAcademicYear: { startsOn: "2026-09-07", endsOn: "2027-07-09" },
      }),
    ).toEqual({ ok: true, from: "2026-09-07", to: "2027-07-09" });
    expect(
      statementPeriodRange({
        preset: "current_uk_tax_year",
        today: "2026-10-01",
      }),
    ).toEqual({ ok: true, from: "2026-04-06", to: "2027-04-05" });
    expect(
      statementPeriodRange({
        preset: "previous_uk_tax_year",
        today: "2026-10-01",
      }),
    ).toEqual({ ok: true, from: "2025-04-06", to: "2026-04-05" });
    expect(
      statementPeriodRange({
        preset: "current_uk_tax_year",
        today: "2026-04-05",
      }),
    ).toEqual({ ok: true, from: "2025-04-06", to: "2026-04-05" });
    expect(
      statementPeriodRange({
        preset: "calendar_year",
        today: "2026-10-01",
      }),
    ).toEqual({ ok: true, from: "2026-01-01", to: "2026-12-31" });
    expect(
      statementPeriodRange({
        preset: "custom",
        today: "2026-10-01",
        customFrom: "2026-09-01",
        customTo: "2027-07-31",
      }),
    ).toEqual({ ok: true, from: "2026-09-01", to: "2027-07-31" });
  });
});
