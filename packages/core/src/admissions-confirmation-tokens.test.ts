import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createPublicSubmissionConfirmationToken,
  verifyPublicSubmissionConfirmationToken,
} from "./admissions-confirmation-tokens.js";

describe("public admissions confirmation tokens", () => {
  const secret = "phase1-test-secret-phase1-test-secret";
  const claims = {
    organisationId: randomUUID(),
    publicId: randomUUID(),
    formType: "enquiry",
    slug: "year-3-enquiry",
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  };

  it("round-trips a signed token and rejects tampering", () => {
    const token = createPublicSubmissionConfirmationToken(secret, claims);
    expect(verifyPublicSubmissionConfirmationToken(secret, token)).toEqual({ ok: true, claims });
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(verifyPublicSubmissionConfirmationToken(secret, tampered)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyPublicSubmissionConfirmationToken("other-secret-other-secret-other", token)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects expired tokens after HMAC verification would otherwise succeed", () => {
    const expired = createPublicSubmissionConfirmationToken(secret, {
      ...claims,
      expiresAt: Math.floor(Date.now() / 1000) - 30,
    });
    expect(verifyPublicSubmissionConfirmationToken(secret, expired)).toEqual({ ok: false, reason: "expired" });
  });
});
