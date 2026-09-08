import { createHmac, timingSafeEqual } from "node:crypto";
import { PUBLIC_SUBMISSION_CONFIRMATION_TTL_MS } from "./admissions-forms.js";

const PUBLIC_CONFIRMATION_TOKEN_VERSION = "v1";

export type PublicSubmissionConfirmationClaims = {
  organisationId: string;
  publicId: string;
  formType: string;
  slug: string;
  expiresAt: number;
};

export type VerifyPublicSubmissionConfirmationResult =
  | { ok: true; claims: PublicSubmissionConfirmationClaims }
  | { ok: false; reason: "invalid" | "expired" };

function confirmationPayload(claims: PublicSubmissionConfirmationClaims): string {
  return Buffer.from(
    JSON.stringify({
      e: claims.expiresAt,
      f: claims.formType,
      o: claims.organisationId,
      p: claims.publicId,
      s: claims.slug,
    }),
    "utf8",
  ).toString("base64url");
}

function signConfirmationPayload(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(`${PUBLIC_CONFIRMATION_TOKEN_VERSION}.${payload}`).digest("base64url");
}

function confirmationSafeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function publicSubmissionConfirmationExpiry(nowMs = Date.now()): number {
  return Math.floor((nowMs + PUBLIC_SUBMISSION_CONFIRMATION_TTL_MS) / 1000);
}

export function createPublicSubmissionConfirmationToken(
  secret: string,
  claims: PublicSubmissionConfirmationClaims,
): string {
  const payload = confirmationPayload(claims);
  return `${PUBLIC_CONFIRMATION_TOKEN_VERSION}.${payload}.${signConfirmationPayload(secret, payload)}`;
}

export function verifyPublicSubmissionConfirmationToken(
  secret: string,
  token: string,
  nowMs = Date.now(),
): VerifyPublicSubmissionConfirmationResult {
  if (!secret || !token || token.length > 400) return { ok: false, reason: "invalid" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PUBLIC_CONFIRMATION_TOKEN_VERSION) {
    return { ok: false, reason: "invalid" };
  }
  const payload = parts[1] ?? "";
  const signature = parts[2] ?? "";
  const expected = signConfirmationPayload(secret, payload);
  if (!confirmationSafeEqual(signature, expected)) return { ok: false, reason: "invalid" };
  let parsed: { e?: unknown; f?: unknown; o?: unknown; p?: unknown; s?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as typeof parsed;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const organisationId = typeof parsed.o === "string" ? parsed.o : "";
  const publicId = typeof parsed.p === "string" ? parsed.p : "";
  const formType = typeof parsed.f === "string" ? parsed.f : "";
  const slug = typeof parsed.s === "string" ? parsed.s : "";
  const expiresAt = typeof parsed.e === "number" && Number.isFinite(parsed.e) ? parsed.e : NaN;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(organisationId) || !uuid.test(publicId) || !formType || !slug || !Number.isFinite(expiresAt)) {
    return { ok: false, reason: "invalid" };
  }
  if (expiresAt * 1000 <= nowMs) return { ok: false, reason: "expired" };
  return {
    ok: true,
    claims: { organisationId, publicId, formType, slug, expiresAt },
  };
}
