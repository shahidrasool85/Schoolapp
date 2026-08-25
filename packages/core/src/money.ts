import { DEFAULT_CURRENCY, ISO_CURRENCY_PATTERN } from "@schoolapp/domain";

export type Money = {
  amountMinor: number;
  currency: string;
};

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "HUF", "TWD"]);

export function isIsoCurrency(value: string): boolean {
  return ISO_CURRENCY_PATTERN.test(value);
}

export function normalizeCurrency(value: string | null | undefined, fallback = DEFAULT_CURRENCY): string {
  const code = (value ?? fallback).trim().toUpperCase();
  if (!isIsoCurrency(code)) {
    throw new Error("invalid_currency");
  }
  return code;
}

export function assertSameCurrency(left: string, right: string): void {
  if (left !== right) {
    throw new Error("currency_mismatch");
  }
}

export function assertNonNegativeMinor(amountMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error("invalid_amount");
  }
}

export function assertPositiveMinor(amountMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("invalid_amount");
  }
}

export function addMinor(a: number, b: number): number {
  assertNonNegativeMinor(a);
  assertNonNegativeMinor(b);
  return a + b;
}

export function subtractMinor(a: number, b: number): number {
  assertNonNegativeMinor(a);
  assertNonNegativeMinor(b);
  if (b > a) {
    throw new Error("amount_underflow");
  }
  return a - b;
}

export function minMinor(a: number, b: number): number {
  return a < b ? a : b;
}

export function maxMinor(a: number, b: number): number {
  return a > b ? a : b;
}

export function outstandingMinor(amountDue: number, amountPaid: number): number {
  assertNonNegativeMinor(amountDue);
  assertNonNegativeMinor(amountPaid);
  return amountPaid >= amountDue ? 0 : amountDue - amountPaid;
}

export function netPaidMinor(grossPaid: number, refunded: number): number {
  return subtractMinor(grossPaid, refunded);
}

export function currencyExponent(currency: string): number {
  return ZERO_DECIMAL.has(normalizeCurrency(currency)) ? 0 : 2;
}

export function formatMoney(amountMinor: number, currency: string): string {
  assertNonNegativeMinor(amountMinor);
  const code = normalizeCurrency(currency);
  const exponent = currencyExponent(code);
  const major = exponent === 0 ? String(amountMinor) : (amountMinor / 10 ** exponent).toFixed(exponent);
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(exponent === 0 ? amountMinor : amountMinor / 10 ** exponent);
  } catch {
    return `${code} ${major}`;
  }
}

export function parseMajorToMinor(major: string, currency: string): number {
  const code = normalizeCurrency(currency);
  const exponent = currencyExponent(code);
  const trimmed = major.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("invalid_amount");
  }
  if (exponent === 0) {
    if (trimmed.includes(".")) throw new Error("invalid_amount");
    const value = Number(trimmed);
    assertNonNegativeMinor(value);
    return value;
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > exponent) throw new Error("invalid_amount");
  const padded = fraction.padEnd(exponent, "0");
  const value = Number(whole) * 10 ** exponent + Number(padded);
  assertNonNegativeMinor(value);
  return value;
}

export function redactProviderReference(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
