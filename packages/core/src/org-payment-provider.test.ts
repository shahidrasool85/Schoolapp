import { describe, expect, it } from "vitest";
import { createPaymentProvider } from "./payment-provider.js";
import {
  derivePaymentProviderConnectionStatus,
  emptyOrganisationPaymentProvider,
  paymentProviderAuditPayload,
  stripeWebhookPath,
  testStripeSecretKey,
} from "./org-payment-provider.js";

describe("organisation payment provider helpers", () => {
  it("starts a new school as not configured", () => {
    expect(emptyOrganisationPaymentProvider()).toMatchObject({
      provider: "stripe",
      configured: false,
      enabled: false,
      connectionStatus: "not_configured",
      webhookUrl: null,
    });
  });

  it("derives test/live connection status without exposing secrets", () => {
    expect(
      derivePaymentProviderConnectionStatus({ secretKeyConfigured: false, mode: "test" }),
    ).toBe("not_configured");
    expect(
      derivePaymentProviderConnectionStatus({ secretKeyConfigured: true, mode: "test" }),
    ).toBe("test_mode_configured");
    expect(
      derivePaymentProviderConnectionStatus({
        secretKeyConfigured: true,
        mode: "live",
        lastTestResult: "connected",
      }),
    ).toBe("connected");
    expect(
      derivePaymentProviderConnectionStatus({
        secretKeyConfigured: true,
        mode: "test",
        lastTestResult: "authentication_failed",
      }),
    ).toBe("attention_required");
    expect(paymentProviderAuditPayload(emptyOrganisationPaymentProvider())).not.toHaveProperty("secretKey");
    expect(stripeWebhookPath("abc123")).toBe("/api/v1/webhooks/payments/stripe/abc123");
  });

  it("tests a Stripe secret key without creating charges", async () => {
    const calls: string[] = [];
    const result = await testStripeSecretKey({
      secretKey: "sk_test_placeholder",
      fetchImpl: (async (url) => {
        calls.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "acct_123", business_profile: { name: "Kingswood" } }),
        } as Response;
      }) as typeof fetch,
    });
    expect(calls[0]).toContain("/v1/account");
    expect(result).toEqual({ result: "connected", accountId: "acct_123", displayName: "Kingswood" });
    const failed = await testStripeSecretKey({
      secretKey: "sk_test_bad",
      fetchImpl: (async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "sk_test_bad" } }) }) as Response) as typeof fetch,
    });
    expect(failed.result).toBe("authentication_failed");
  });

  it("keeps the fake provider available for local/CI when no org config exists", () => {
    const provider = createPaymentProvider({
      providerKey: "fake",
      fakeWebhookSecret: "test",
      stripeSecretKey: null,
      stripeWebhookSecret: null,
    });
    expect(provider.key).toBe("fake");
  });
});
