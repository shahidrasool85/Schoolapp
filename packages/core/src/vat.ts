/**
 * School-specific optional VAT.
 *
 * LuvLearn calculates and snapshots VAT. The issued invoice gross total is
 * authoritative. Stripe (and other providers) collect the outstanding portion
 * of that gross amount. Do not enable Stripe Tax / automatic_tax — the provider
 * must not recalculate a different amount.
 *
 * First release uses the school default for every line (`inherit`). Line columns
 * (`vat_treatment`, rate, net/VAT/gross) exist so a later fee-type override
 * (tuition vs trips vs meals) can be stored without rewriting historical invoices.
 */
export const VAT_RATE_BPS_MAX = 10_000;
export const VAT_REGISTRATION_MAX_LENGTH = 40;

export type VatPriceMode = "inclusive" | "exclusive";
export type VatLineTreatment = "none" | "standard" | "inherit";

export type SchoolVatPolicy = {
  enabled: boolean;
  registrationNumber: string | null;
  rateBps: number;
  pricesInclusive: boolean;
};

export type VatSplit = {
  enteredMinor: number;
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
  rateBps: number;
  mode: VatPriceMode | null;
  treatment: VatLineTreatment;
};

export type IssuedVatSnapshot = {
  enabled: boolean;
  registrationNumber: string | null;
  rateBps: number | null;
  pricesInclusive: boolean | null;
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
};

const DISABLED_POLICY: SchoolVatPolicy = {
  enabled: false,
  registrationNumber: null,
  rateBps: 0,
  pricesInclusive: true,
};

export function defaultSchoolVatPolicy(): SchoolVatPolicy {
  return { ...DISABLED_POLICY };
}

export function vatRatePercentToBps(percent: number): number {
  if (!Number.isFinite(percent)) {
    throw new Error("invalid_vat_rate");
  }
  const bps = Math.round(percent * 100);
  assertVatRateBps(bps);
  return bps;
}

export function vatRateBpsToPercent(bps: number): number {
  assertVatRateBps(bps);
  return bps / 100;
}

export function formatVatRateLabel(bps: number | null | undefined): string {
  if (bps == null) return "";
  assertVatRateBps(bps);
  if (bps % 100 === 0) return `${bps / 100}%`;
  return `${(bps / 100).toFixed(2)}%`;
}

export function assertVatRateBps(bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > VAT_RATE_BPS_MAX) {
    throw new Error("invalid_vat_rate");
  }
}

export function normalizeVatRegistration(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.length > VAT_REGISTRATION_MAX_LENGTH) {
    throw new Error("invalid_vat_registration");
  }
  return trimmed;
}

export function schoolVatPolicyFromSettings(input: {
  vatEnabled?: boolean | null;
  vatRegistrationNumber?: string | null;
  vatRateBps?: number | null;
  vatRatePercent?: number | null;
  vatPricesInclusive?: boolean | null;
}): SchoolVatPolicy {
  const enabled = Boolean(input.vatEnabled);
  const rateBps =
    input.vatRateBps != null
      ? input.vatRateBps
      : input.vatRatePercent != null
        ? vatRatePercentToBps(input.vatRatePercent)
        : 0;
  assertVatRateBps(rateBps);
  return {
    enabled,
    registrationNumber: normalizeVatRegistration(input.vatRegistrationNumber),
    rateBps,
    pricesInclusive: input.vatPricesInclusive !== false,
  };
}

export function validateSchoolVatPolicy(policy: SchoolVatPolicy): void {
  assertVatRateBps(policy.rateBps);
  if (!policy.enabled) return;
  if (!policy.registrationNumber) {
    throw new Error("vat_registration_required");
  }
}

/**
 * Round half away from zero so VAT never leaves a fractional penny.
 * numerator/denominator are exact integer ratios (e.g. net * rateBps / 10000).
 */
export function roundHalfAwayFromZeroDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("invalid_vat_rate");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const rounded = (n + d / 2n) / d;
  return negative ? -rounded : rounded;
}

function asIntegerMinor(amountMinor: number): bigint {
  if (!Number.isInteger(amountMinor)) {
    throw new Error("invalid_amount");
  }
  return BigInt(amountMinor);
}

export function splitVatAmount(
  enteredMinor: number,
  rateBps: number,
  mode: VatPriceMode,
): Pick<VatSplit, "enteredMinor" | "netMinor" | "vatMinor" | "grossMinor"> {
  assertVatRateBps(rateBps);
  const entered = asIntegerMinor(enteredMinor);
  if (rateBps === 0) {
    const value = Number(entered);
    return { enteredMinor: value, netMinor: value, vatMinor: 0, grossMinor: value };
  }
  if (mode === "exclusive") {
    const vat = roundHalfAwayFromZeroDiv(entered * BigInt(rateBps), 10_000n);
    return {
      enteredMinor: Number(entered),
      netMinor: Number(entered),
      vatMinor: Number(vat),
      grossMinor: Number(entered + vat),
    };
  }
  const vat = roundHalfAwayFromZeroDiv(entered * BigInt(rateBps), 10_000n + BigInt(rateBps));
  return {
    enteredMinor: Number(entered),
    netMinor: Number(entered - vat),
    vatMinor: Number(vat),
    grossMinor: Number(entered),
  };
}

export function applyVatToEnteredAmount(
  enteredMinor: number,
  policy: SchoolVatPolicy,
  treatment: VatLineTreatment = "standard",
): VatSplit {
  const resolvedTreatment = treatment === "inherit" ? (policy.enabled ? "standard" : "none") : treatment;
  if (!policy.enabled || resolvedTreatment === "none") {
    return {
      enteredMinor,
      netMinor: enteredMinor,
      vatMinor: 0,
      grossMinor: enteredMinor,
      rateBps: 0,
      mode: null,
      treatment: "none",
    };
  }
  const mode: VatPriceMode = policy.pricesInclusive ? "inclusive" : "exclusive";
  return {
    ...splitVatAmount(enteredMinor, policy.rateBps, mode),
    rateBps: policy.rateBps,
    mode,
    treatment: "standard",
  };
}

export function parseVatLineTreatment(value: unknown): VatLineTreatment {
  if (value === "none" || value === "standard" || value === "inherit") return value;
  return "inherit";
}

export function applyVatToInvoiceLines<T extends { amountMinor: number; vatTreatment?: VatLineTreatment | null }>(
  lines: T[],
  policy: SchoolVatPolicy,
): Array<T & VatSplit> {
  return lines.map((line) => ({
    ...line,
    ...applyVatToEnteredAmount(line.amountMinor, policy, line.vatTreatment ?? "inherit"),
  }));
}

export function sumVatSplits(splits: Array<Pick<VatSplit, "netMinor" | "vatMinor" | "grossMinor">>): {
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
} {
  return splits.reduce(
    (acc, row) => ({
      netMinor: acc.netMinor + row.netMinor,
      vatMinor: acc.vatMinor + row.vatMinor,
      grossMinor: acc.grossMinor + row.grossMinor,
    }),
    { netMinor: 0, vatMinor: 0, grossMinor: 0 },
  );
}

export function issuedVatSnapshot(policy: SchoolVatPolicy, totals: { netMinor: number; vatMinor: number; grossMinor: number }): IssuedVatSnapshot {
  if (!policy.enabled) {
    return {
      enabled: false,
      registrationNumber: null,
      rateBps: null,
      pricesInclusive: null,
      netMinor: totals.grossMinor,
      vatMinor: 0,
      grossMinor: totals.grossMinor,
    };
  }
  return {
    enabled: true,
    registrationNumber: policy.registrationNumber,
    rateBps: policy.rateBps,
    pricesInclusive: policy.pricesInclusive,
    netMinor: totals.netMinor,
    vatMinor: totals.vatMinor,
    grossMinor: totals.grossMinor,
  };
}

export function freezeIssuedVat(snapshot: Partial<IssuedVatSnapshot> & Record<string, unknown> | null | undefined): IssuedVatSnapshot {
  const raw = snapshot ?? {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key);
  if (has("enabled") || has("vatInvoice") || has("vatEnabled")) {
    const enabled = Boolean(raw.enabled ?? raw.vatInvoice ?? raw.vatEnabled);
    if (!enabled) {
      const gross = Number(raw.grossMinor ?? raw.amountMinor ?? raw.netMinor ?? 0);
      return {
        enabled: false,
        registrationNumber: has("registrationNumber") || has("vatRegistrationNumber")
          ? (raw.registrationNumber as string | null) ?? (raw.vatRegistrationNumber as string | null) ?? null
          : null,
        rateBps: null,
        pricesInclusive: null,
        netMinor: gross,
        vatMinor: 0,
        grossMinor: gross,
      };
    }
    return {
      enabled: true,
      registrationNumber: (raw.registrationNumber as string | null) ?? (raw.vatRegistrationNumber as string | null) ?? null,
      rateBps: raw.rateBps == null && raw.vatRateBps == null ? null : Number(raw.rateBps ?? raw.vatRateBps),
      pricesInclusive:
        raw.pricesInclusive == null && raw.vatPricesInclusive == null
          ? null
          : Boolean(raw.pricesInclusive ?? raw.vatPricesInclusive),
      netMinor: Number(raw.netMinor ?? raw.vatNetMinor ?? 0),
      vatMinor: Number(raw.vatMinor ?? raw.vatAmountMinor ?? 0),
      grossMinor: Number(raw.grossMinor ?? raw.amountMinor ?? 0),
    };
  }
  const gross = Number(raw.grossMinor ?? raw.amountMinor ?? 0);
  return {
    enabled: false,
    registrationNumber: null,
    rateBps: null,
    pricesInclusive: null,
    netMinor: gross,
    vatMinor: 0,
    grossMinor: gross,
  };
}
