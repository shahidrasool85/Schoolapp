import { describe, expect, it } from "vitest";
import {
  assertStripeSecretMatchesMode,
  decryptOrganisationSecret,
  decryptSecret,
  encryptSecret,
  looksLikeSecret,
  parseSecretsEncryptionKey,
  payloadContainsSecret,
  paymentProviderAuditSafe,
  secretsCipherVersion,
  stripeSecretHint,
} from "./encrypted-secrets.js";

const KEY = parseSecretsEncryptionKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

describe("encrypted organisation secrets", () => {
  it("round-trips AES-256-GCM and refuses a different key", () => {
    const blob = encryptSecret("sk_test_school_a_secret", KEY);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(decryptSecret(blob, KEY)).toBe("sk_test_school_a_secret");
    expect(secretsCipherVersion(blob)).toBe("v1");
    const other = parseSecretsEncryptionKey("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
    expect(() => decryptSecret(blob, other)).toThrow(/could not be read/);
  });

  it("rejects test/live key mismatches without echoing the key", () => {
    expect(() => assertStripeSecretMatchesMode("sk_live_abc", "test")).toThrow(/does not match/);
    expect(() => assertStripeSecretMatchesMode("sk_test_abc", "live")).toThrow(/does not match/);
    try {
      assertStripeSecretMatchesMode("sk_live_super_secret_value", "test");
    } catch (error) {
      expect(String(error)).not.toContain("super_secret_value");
    }
    expect(stripeSecretHint("sk_test_abcdefghijklmnopqrstuv")).toBe("sk_test_••••stuv");
  });

  it("strips secrets from audit metadata", () => {
    expect(
      paymentProviderAuditSafe({
        provider: "stripe",
        secretKey: "sk_test_abc",
        webhookSecret: "whsec_abc",
        encryptedSecretKey: "v1:abcd",
        enabled: true,
        mode: "test",
      }),
    ).toEqual({ provider: "stripe", enabled: true, mode: "test" });
    expect(looksLikeSecret("sk_live_abc")).toBe(true);
    expect(looksLikeSecret("pi_abc_secret_def")).toBe(true);
    expect(payloadContainsSecret({ after: { secretKey: "sk_test_abc" } })).toBe(true);
    expect(payloadContainsSecret({ after: { enabled: true, mode: "test" } })).toBe(false);
  });

  it("decrypts with the previous key during a rotation window", () => {
    const previous = parseSecretsEncryptionKey("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
    const blob = encryptSecret("whsec_rotated", previous);
    expect(() => decryptSecret(blob, KEY)).toThrow(/could not be read/);
    expect(
      decryptOrganisationSecret(blob, {
        SCHOOLAPP_SECRETS_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        SCHOOLAPP_SECRETS_ENCRYPTION_KEY_PREVIOUS: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      }),
    ).toBe("whsec_rotated");
  });
});
