import { describe, expect, it } from "vitest";
import {
  addMinor,
  formatMoney,
  isIsoCurrency,
  outstandingMinor,
  parseMajorToMinor,
  redactProviderReference,
  subtractMinor,
} from "./money.js";

describe("money helpers", () => {
  it("keeps integer minor units and rejects floats", () => {
    expect(addMinor(1250, 40)).toBe(1290);
    expect(subtractMinor(1250, 250)).toBe(1000);
    expect(outstandingMinor(10000, 4000)).toBe(6000);
    expect(outstandingMinor(10000, 10000)).toBe(0);
    expect(outstandingMinor(10000, 12000)).toBe(0);
    expect(() => addMinor(12.5, 1)).toThrow("invalid_amount");
    expect(() => subtractMinor(10, 11)).toThrow("amount_underflow");
  });

  it("validates ISO currency codes", () => {
    expect(isIsoCurrency("GBP")).toBe(true);
    expect(isIsoCurrency("usd")).toBe(false);
    expect(isIsoCurrency("GB")).toBe(false);
    expect(formatMoney(1250, "GBP")).toContain("12.50");
    expect(parseMajorToMinor("12.50", "GBP")).toBe(1250);
    expect(() => parseMajorToMinor("12.505", "GBP")).toThrow("invalid_amount");
  });

  it("redacts provider references", () => {
    expect(redactProviderReference("pi_1234567890abcdef")).toBe("pi_123…cdef");
    expect(redactProviderReference("short")).toBe("short");
  });
});
