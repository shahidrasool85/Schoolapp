import { describe, expect, it } from "vitest";
import {
  applyDiscounts,
  applyMidPeriodPolicy,
  arrearsBucket,
  asIsoDate,
  billingPeriodKey,
  compareSiblings,
  daysOverdue,
  deriveInvoiceStatus,
  invoiceOutstandingMinor,
  orderSiblings,
  percentOfMinor,
  prorateMinor,
  splitAnnualIntoInstalments,
  type DiscountCandidate,
  type SiblingSortInput,
} from "./tuition.js";

const sibling10: DiscountCandidate = {
  key: "sibling",
  ruleId: "r-sib",
  concessionId: null,
  kind: "sibling",
  name: "Sibling 10%",
  amountType: "percent",
  percentBps: 1000,
  amountMinor: null,
  stackingPriority: 20,
  exclusiveGroup: "family",
};

const staff25: DiscountCandidate = {
  key: "staff",
  ruleId: "r-staff",
  concessionId: null,
  kind: "staff_child",
  name: "Staff child 25%",
  amountType: "percent",
  percentBps: 2500,
  amountMinor: null,
  stackingPriority: 10,
  exclusiveGroup: "family",
};

const fixed50: DiscountCandidate = {
  key: "concession",
  ruleId: null,
  concessionId: "c1",
  kind: "individual",
  name: "Hardship",
  amountType: "fixed",
  percentBps: null,
  amountMinor: 5000,
  stackingPriority: 30,
  exclusiveGroup: null,
};

describe("tuition money helpers", () => {
  it("calculates 10% of £600 as £60 using integer bps", () => {
    expect(percentOfMinor(60000, 1000)).toBe(6000);
    expect(percentOfMinor(60000, 2500)).toBe(15000);
  });

  it("splits an annual amount into instalments that sum exactly", () => {
    expect(splitAnnualIntoInstalments(600000, 10)).toEqual([
      60000, 60000, 60000, 60000, 60000, 60000, 60000, 60000, 60000, 60000,
    ]);
    const uneven = splitAnnualIntoInstalments(1000, 3);
    expect(uneven).toEqual([333, 333, 334]);
    expect(uneven.reduce((sum, value) => sum + value, 0)).toBe(1000);
  });

  it("prorates deterministically", () => {
    expect(prorateMinor(60000, 15, 30)).toBe(30000);
    expect(prorateMinor(60000, 30, 30)).toBe(60000);
    expect(prorateMinor(60000, 0, 30)).toBe(0);
  });
});

describe("discount stacking", () => {
  it("C: 10% sibling of £600 is £540", () => {
    const result = applyDiscounts(60000, [sibling10], "stack");
    expect(result.discountTotalMinor).toBe(6000);
    expect(result.netMinor).toBe(54000);
    expect(result.applied[0]?.calculatedMinor).toBe(6000);
  });

  it("D: £50 fixed concession of £600 is £550", () => {
    const result = applyDiscounts(60000, [fixed50], "stack");
    expect(result.netMinor).toBe(55000);
  });

  it("E stack: sibling 10% and staff 25% both apply against original tuition", () => {
    const result = applyDiscounts(60000, [sibling10, staff25], "stack");
    expect(result.applied.map((row) => row.calculatedMinor).sort((left, right) => left - right)).toEqual([
      6000, 15000,
    ]);
    expect(result.netMinor).toBe(39000);
  });

  it("E highest: only the staff 25% applies", () => {
    const result = applyDiscounts(60000, [sibling10, staff25], "highest");
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]?.kind).toBe("staff_child");
    expect(result.netMinor).toBe(45000);
    expect(result.discarded.some((row) => row.reason === "highest_only")).toBe(true);
  });

  it("E priority: staff exclusive-group supersedes sibling", () => {
    const result = applyDiscounts(60000, [sibling10, staff25], "priority");
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]?.kind).toBe("staff_child");
    expect(result.netMinor).toBe(45000);
    expect(result.discarded[0]?.reason).toBe("exclusive_group");
  });

  it("never reduces net below zero", () => {
    const huge: DiscountCandidate = { ...fixed50, amountMinor: 99_999 };
    const result = applyDiscounts(60000, [huge], "stack");
    expect(result.netMinor).toBe(0);
    expect(result.applied[0]?.calculatedMinor).toBe(60000);
  });
});

describe("sibling order", () => {
  const childA: SiblingSortInput = {
    studentProfileId: "aaa",
    dateOfBirth: "2018-01-01",
    legalName: "Ava Smith",
    yearGroupSort: 2,
    explicitPriority: null,
  };
  const childB: SiblingSortInput = {
    studentProfileId: "bbb",
    dateOfBirth: "2014-06-01",
    legalName: "Ben Smith",
    yearGroupSort: 5,
    explicitPriority: null,
  };
  const childC: SiblingSortInput = {
    studentProfileId: "ccc",
    dateOfBirth: "2012-03-01",
    legalName: "Cara Jones",
    yearGroupSort: 8,
    explicitPriority: 2,
  };

  it("does not use insertion order; oldest_first is deterministic", () => {
    const ordered = orderSiblings([childA, childC, childB], "oldest_first");
    expect(ordered.map((row) => row.studentProfileId)).toEqual(["ccc", "bbb", "aaa"]);
  });

  it("uses explicit priority when assigned, then date of birth", () => {
    const ordered = orderSiblings([childA, childB, childC], "oldest_first");
    expect(ordered[0]?.studentProfileId).toBe("ccc");
  });

  it("compares equal names by id, never surname inference", () => {
    const left = { ...childA, legalName: "Sam", dateOfBirth: null, studentProfileId: "z" };
    const right = { ...childB, legalName: "Sam", dateOfBirth: null, studentProfileId: "a" };
    expect(compareSiblings(left, right, "oldest_first")).toBeGreaterThan(0);
  });
});

describe("invoice status and arrears", () => {
  it("J/K: partial then full payment", () => {
    expect(invoiceOutstandingMinor(60000, 30000)).toBe(30000);
    expect(
      deriveInvoiceStatus({
        current: "issued",
        totalMinor: 60000,
        paidMinor: 30000,
        dueDate: "2026-09-14",
        gracePeriodDays: 0,
        today: "2026-09-01",
      }),
    ).toBe("partially_paid");
    expect(
      deriveInvoiceStatus({
        current: "partially_paid",
        totalMinor: 60000,
        paidMinor: 60000,
        dueDate: "2026-09-14",
        gracePeriodDays: 0,
        today: "2026-09-20",
      }),
    ).toBe("paid");
    expect(invoiceOutstandingMinor(60000, 60000)).toBe(0);
  });

  it("marks overdue after grace", () => {
    expect(
      deriveInvoiceStatus({
        current: "issued",
        totalMinor: 60000,
        paidMinor: 0,
        dueDate: "2026-09-01",
        gracePeriodDays: 7,
        today: "2026-09-08",
      }),
    ).toBe("issued");
    expect(
      deriveInvoiceStatus({
        current: "issued",
        totalMinor: 60000,
        paidMinor: 0,
        dueDate: "2026-09-01",
        gracePeriodDays: 7,
        today: "2026-09-09",
      }),
    ).toBe("overdue");
  });

  it("classifies arrears buckets", () => {
    expect(arrearsBucket(daysOverdue("2026-09-20", "2026-09-10"))).toBe("current");
    expect(arrearsBucket(45)).toBe("30");
    expect(arrearsBucket(75)).toBe("60");
    expect(arrearsBucket(100)).toBe("90");
  });

  it("builds a stable billing period key", () => {
    expect(billingPeriodKey("monthly", "2026-09-01", "2026-09-30")).toBe(
      "tuition:monthly:2026-09-01:2026-09-30",
    );
  });

  it("normalises driver Date values to ISO calendar dates", () => {
    expect(asIsoDate(new Date("2026-09-15T00:00:00.000Z"))).toBe("2026-09-15");
    expect(asIsoDate("2026-09-15T12:00:00.000Z")).toBe("2026-09-15");
  });
});

describe("mid-period policy", () => {
  it("full policy still charges the period amount", () => {
    const result = applyMidPeriodPolicy({
      amountMinor: 60000,
      policy: "full",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      enrolStart: "2026-09-15",
      enrolEnd: null,
    });
    expect(result.amountMinor).toBe(60000);
    expect(result.prorated).toBe(false);
  });

  it("prorate policy uses chargeable days", () => {
    const result = applyMidPeriodPolicy({
      amountMinor: 60000,
      policy: "prorate",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      enrolStart: "2026-09-16",
      enrolEnd: null,
    });
    expect(result.prorated).toBe(true);
    expect(result.chargeableDays).toBe(15);
    expect(result.amountMinor).toBe(30000);
  });

  it("manual policy skips automatic invoicing", () => {
    const result = applyMidPeriodPolicy({
      amountMinor: 60000,
      policy: "manual",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      enrolStart: "2026-09-15",
      enrolEnd: null,
    });
    expect(result.skipped).toBe(true);
    expect(result.amountMinor).toBe(0);
  });
});
