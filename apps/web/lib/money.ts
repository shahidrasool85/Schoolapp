import { parseGbpPoundsToMinor } from "@schoolapp/domain";

export function formatMinor(amountMinor: number, currency = "GBP"): string {
  const safe = Number.isInteger(amountMinor) ? amountMinor : 0;
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe / 100);
  } catch {
    const sign = safe < 0 ? "-" : "";
    return `${sign}${currency} ${(Math.abs(safe) / 100).toFixed(2)}`;
  }
}

export function poundsToMinor(value: string): number {
  const parsed = parseGbpPoundsToMinor(value);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.amount;
}
