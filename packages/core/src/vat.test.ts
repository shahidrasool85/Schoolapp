import { describe, expect, it } from "vitest";
import {
  applyVatToEnteredAmount,
  applyVatToInvoiceLines,
  freezeIssuedVat,
  formatVatRateLabel,
  parseVatLineTreatment,
  roundHalfAwayFromZeroDiv,
  schoolVatPolicyFromSettings,
  splitVatAmount,
  sumVatSplits,
  vatRatePercentToBps,
} from "./vat.js";

const exclusive20 = schoolVatPolicyFromSettings({
  vatEnabled: true,
  vatRegistrationNumber: "GB123456789",
  vatRatePercent: 20,
  vatPricesInclusive: false,
});

const inclusive20 = schoolVatPolicyFromSettings({
  vatEnabled: true,
  vatRegistrationNumber: "GB123456789",
  vatRatePercent: 20,
  vatPricesInclusive: true,
});

describe("school VAT calculations", () => {
  it("defaults existing schools to VAT off", () => {
    const policy = schoolVatPolicyFromSettings({});
    expect(policy.enabled).toBe(false);
    expect(applyVatToEnteredAmount(50_000, policy).grossMinor).toBe(50_000);
    expect(applyVatToEnteredAmount(50_000, policy).vatMinor).toBe(0);
  });

  it("adds VAT on exclusive £500 at 20%", () => {
    const split = splitVatAmount(50_000, 2000, "exclusive");
    expect(split.netMinor).toBe(50_000);
    expect(split.vatMinor).toBe(10_000);
    expect(split.grossMinor).toBe(60_000);
  });

  it("extracts VAT from inclusive £600 at 20%", () => {
    const split = splitVatAmount(60_000, 2000, "inclusive");
    expect(split.netMinor).toBe(50_000);
    expect(split.vatMinor).toBe(10_000);
    expect(split.grossMinor).toBe(60_000);
  });

  it("leaves non-VAT fees unchanged", () => {
    const split = applyVatToEnteredAmount(60_000, schoolVatPolicyFromSettings({ vatEnabled: false }));
    expect(split).toMatchObject({ netMinor: 60_000, vatMinor: 0, grossMinor: 60_000, treatment: "none" });
  });

  it("uses integer half-away-from-zero rounding", () => {
    expect(Number(roundHalfAwayFromZeroDiv(1n, 2n))).toBe(1);
    expect(Number(roundHalfAwayFromZeroDiv(3n, 2n))).toBe(2);
    expect(splitVatAmount(1001, 2000, "exclusive").vatMinor).toBe(200);
    expect(splitVatAmount(1001, 2000, "inclusive")).toEqual({
      enteredMinor: 1001,
      netMinor: 834,
      vatMinor: 167,
      grossMinor: 1001,
    });
  });

  it("sums per-line VAT deterministically across mixed signs", () => {
    const lines = applyVatToInvoiceLines(
      [
        { amountMinor: 50_000 },
        { amountMinor: 25_000 },
        { amountMinor: -5_000 },
      ],
      exclusive20,
    );
    expect(lines.map((line) => line.vatMinor)).toEqual([10_000, 5_000, -1_000]);
    expect(sumVatSplits(lines)).toEqual({ netMinor: 70_000, vatMinor: 14_000, grossMinor: 84_000 });
  });

  it("does not invent a VAT document from a legacy snapshot after VAT is enabled", () => {
    const frozen = freezeIssuedVat({ kind: "invoice", amountMinor: 50_000 });
    expect(frozen.enabled).toBe(false);
    expect(frozen.vatMinor).toBe(0);
    expect(frozen.grossMinor).toBe(50_000);
  });

  it("keeps issued VAT snapshots when later settings would differ", () => {
    const frozen = freezeIssuedVat({
      enabled: true,
      vatInvoice: true,
      registrationNumber: "GB-OLD",
      rateBps: 2000,
      pricesInclusive: false,
      netMinor: 50_000,
      vatMinor: 10_000,
      grossMinor: 60_000,
    });
    expect(frozen.registrationNumber).toBe("GB-OLD");
    expect(frozen.rateBps).toBe(2000);
    expect(frozen.grossMinor).toBe(60_000);
  });

  it("reads issued PDF snapshot field names without recomputing from live settings", () => {
    const frozen = freezeIssuedVat({
      kind: "invoice",
      vatInvoice: true,
      vatRegistrationNumber: "IE1234567T",
      vatRateBps: 500,
      vatPricesInclusive: true,
      vatNetMinor: 50_000,
      vatAmountMinor: 2_500,
      amountMinor: 52_500,
    });
    expect(frozen.enabled).toBe(true);
    expect(frozen.registrationNumber).toBe("IE1234567T");
    expect(frozen.rateBps).toBe(500);
    expect(frozen.netMinor).toBe(50_000);
    expect(frozen.vatMinor).toBe(2_500);
    expect(frozen.grossMinor).toBe(52_500);
  });

  it("parses unknown line treatments as inherit for later fee-type overrides", () => {
    expect(parseVatLineTreatment("standard")).toBe("standard");
    expect(parseVatLineTreatment("none")).toBe("none");
    expect(parseVatLineTreatment("unexpected")).toBe("inherit");
  });

  it("formats rates without forcing 20%", () => {
    expect(vatRatePercentToBps(5)).toBe(500);
    expect(formatVatRateLabel(500)).toBe("5%");
    expect(formatVatRateLabel(2050)).toBe("20.50%");
  });
});
