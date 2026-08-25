const UPN_CHECK_LETTERS = "ABCDEFGHJKLMNPQRTUVWXYZ";
const UPN_WEIGHTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

export type UpnKind = "permanent" | "temporary";

export type UpnValidation = {
  ok: boolean;
  kind: UpnKind | null;
  reason: string | null;
  normalised: string | null;
};

function checkLetterForDigits(digits: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits[i]) * UPN_WEIGHTS[i]!;
  }
  return UPN_CHECK_LETTERS[sum % 23]!;
}

export function normaliseUpn(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.replaceAll(/\s+/g, "").toUpperCase();
  return trimmed.length === 0 ? null : trimmed;
}

export function upnCheckLetter(digits: string): string {
  if (!/^\d{12}$/.test(digits)) {
    throw new Error("UPN digits must be exactly 12 numeric characters");
  }
  return checkLetterForDigits(digits);
}

export function generatePermanentUpn(digits: string): string {
  return `${upnCheckLetter(digits)}${digits}`;
}

/**
 * England Unique Pupil Number: 13 characters.
 * Permanent: check letter + 12 digits.
 * Temporary: check letter + letter (not I/O/S) + 11 digits.
 * Check letter uses DfE remainder-23 mapping (I, O and S omitted).
 */
export function validateUpn(value: string | null | undefined): UpnValidation {
  const normalised = normaliseUpn(value);
  if (!normalised) {
    return { ok: false, kind: null, reason: "missing", normalised: null };
  }
  if (normalised.length !== 13) {
    return { ok: false, kind: null, reason: "length", normalised };
  }
  const check = normalised[0]!;
  if (!UPN_CHECK_LETTERS.includes(check)) {
    return { ok: false, kind: null, reason: "check_letter", normalised };
  }

  const rest = normalised.slice(1);
  if (/^\d{12}$/.test(rest)) {
    const expected = checkLetterForDigits(rest);
    if (expected !== check) {
      return { ok: false, kind: "permanent", reason: "checksum", normalised };
    }
    return { ok: true, kind: "permanent", reason: null, normalised };
  }

  if (/^[A-HJ-NP-RT-Z]\d{11}$/.test(rest)) {
    return { ok: true, kind: "temporary", reason: null, normalised };
  }

  return { ok: false, kind: null, reason: "format", normalised };
}

export function isValidPermanentUpn(value: string | null | undefined): boolean {
  const result = validateUpn(value);
  return result.ok && result.kind === "permanent";
}
