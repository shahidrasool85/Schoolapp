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
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error("Enter an amount such as 8.00");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
