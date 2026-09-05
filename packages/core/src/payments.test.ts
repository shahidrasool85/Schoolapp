import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors.js";
import {
  chargeBalance,
  chargeIsPayable,
  deriveChargeStatus,
  dueUrgency,
  operationalPaymentStatus,
  shouldCancelActivityCharge,
  shouldGenerateActivityCharge,
} from "./payments.js";
import {
  FakePaymentProvider,
  StripePaymentProvider,
  buildStripeCheckoutFailureLog,
  originSchemeAndHost,
  verifyStripeSignature,
  mapStripeEvent,
  type StripeCheckoutFailureLog,
} from "./payment-provider.js";

describe("charge status and activity policy", () => {
  it("derives issued, partial, paid, waived and refunded", () => {
    expect(deriveChargeStatus({ current: "issued", amountDueMinor: 1000, netPaidMinor: 0, refundedMinor: 0 })).toBe("issued");
    expect(deriveChargeStatus({ current: "issued", amountDueMinor: 1000, netPaidMinor: 400, refundedMinor: 0 })).toBe("partially_paid");
    expect(deriveChargeStatus({ current: "issued", amountDueMinor: 1000, netPaidMinor: 1000, refundedMinor: 0 })).toBe("paid");
    expect(deriveChargeStatus({ current: "issued", amountDueMinor: 0, netPaidMinor: 0, refundedMinor: 0 })).toBe("waived");
    expect(deriveChargeStatus({ current: "paid", amountDueMinor: 1000, netPaidMinor: 0, refundedMinor: 1000 })).toBe("refunded");
    expect(deriveChargeStatus({ current: "cancelled", amountDueMinor: 1000, netPaidMinor: 0, refundedMinor: 0 })).toBe("cancelled");
    expect(chargeIsPayable("issued", 100)).toBe(true);
    expect(chargeIsPayable("paid", 0)).toBe(false);
  });

  it("does not charge waitlisted pupils by default", () => {
    expect(
      shouldGenerateActivityCharge({
        chargePolicy: "on_confirmed",
        paymentRequired: true,
        priceAmountMinor: 1250,
        registrationStatus: "waitlisted",
        consentResponse: "consented",
      }),
    ).toBe(false);
    expect(
      shouldGenerateActivityCharge({
        chargePolicy: "on_confirmed",
        paymentRequired: true,
        priceAmountMinor: 1250,
        registrationStatus: "confirmed",
      }),
    ).toBe(true);
    expect(
      shouldCancelActivityCharge({ registrationStatus: "declined", chargeStatus: "issued" }),
    ).toBe(true);
    expect(
      shouldCancelActivityCharge({ registrationStatus: "declined", chargeStatus: "paid" }),
    ).toBe(false);
  });

  it("keeps consent and payment operational status separate", () => {
    expect(operationalPaymentStatus({ paymentRequired: true, chargeStatus: "issued" })).toBe("outstanding");
    expect(operationalPaymentStatus({ paymentRequired: true, chargeStatus: "paid" })).toBe("paid");
    expect(operationalPaymentStatus({ paymentRequired: false, chargeStatus: null })).toBe("not_required");
    expect(dueUrgency(new Date(Date.now() - 1000).toISOString())).toBe("overdue");
    expect(chargeBalance({ originalAmountMinor: 1000, amountDueMinor: 800, grossPaidMinor: 400, refundedMinor: 0 })).toMatchObject({
      outstandingMinor: 400,
      adjustmentMinor: 200,
      netPaidMinor: 400,
    });
  });
});

describe("fake provider signatures", () => {
  it("accepts a matching HMAC and rejects a bad signature", () => {
    const provider = new FakePaymentProvider("test-secret");
    const event = {
      providerKey: "fake" as const,
      eventId: "evt_1",
      eventType: "demo.succeeded",
      providerSessionId: "fake_sess_1",
      providerPaymentId: "fake_pay_1",
      providerRefundId: null,
      amountMinor: 800,
      currency: "GBP",
      outcome: "succeeded" as const,
    };
    const signature = provider.signEvent(event);
    expect(provider.verifyWebhook(JSON.stringify(event), signature).eventId).toBe("evt_1");
    expect(() => provider.verifyWebhook(JSON.stringify(event), "nope")).toThrow(/Invalid provider signature/);
    expect(provider.verifyCheckoutToken("sess-1", "nope")).toBe(false);
  });
});

describe("stripe webhook helper", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies timestamped HMAC signatures and rejects stale ones", () => {
    const secret = "whsec_test";
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
    const timestamp = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    const event = verifyStripeSignature(body, `t=${timestamp},v1=${v1}`, secret);
    expect(event.id).toBe("evt_1");
    expect(() => verifyStripeSignature(body, `t=${timestamp - 1000},v1=${v1}`, secret)).toThrow();
    expect(() => verifyStripeSignature(body, `t=${timestamp},v1=deadbeef`, secret)).toThrow();
    expect(
      mapStripeEvent({
        id: "evt_unpaid",
        type: "checkout.session.completed",
        data: { object: { id: "cs_1", payment_status: "unpaid", amount_total: 1250, currency: "gbp" } },
      }).outcome,
    ).toBe("ignored");
    expect(
      mapStripeEvent({
        id: "evt_paid",
        type: "checkout.session.completed",
        data: { object: { id: "cs_1", payment_status: "paid", amount_total: 1250, currency: "gbp" } },
      }).outcome,
    ).toBe("succeeded");
    expect(
      mapStripeEvent({
        id: "evt_async",
        type: "checkout.session.async_payment_succeeded",
        data: { object: { id: "cs_1", payment_status: "paid" } },
      }).outcome,
    ).toBe("succeeded");
    expect(
      mapStripeEvent({
        id: "evt_fail",
        type: "checkout.session.expired",
        data: { object: { id: "cs_1" } },
      }).outcome,
    ).toBe("failed");
    expect(
      mapStripeEvent({
        id: "evt_refund",
        type: "charge.refunded",
        data: { object: { id: "re_1", status: "succeeded", amount: 500 } },
      }).outcome,
    ).toBe("refunded");
  });

  it("attaches organisation, invoice and family metadata to Stripe Checkout Sessions", async () => {
    let posted = "";
    const provider = new StripePaymentProvider({
      providerKey: "stripe",
      fakeWebhookSecret: "unused",
      stripeSecretKey: "sk_test_placeholder",
      stripeWebhookSecret: "whsec_test",
      fetchImpl: (async (_url, init) => {
        posted = String(init?.body ?? "");
        return {
          ok: true,
          json: async () => ({ id: "cs_test_1", url: "https://checkout.stripe.test/cs_test_1" }),
        } as Response;
      }) as typeof fetch,
    });
    const created = await provider.createSession({
      organisationId: "org-1",
      chargeId: "",
      invoiceId: "inv-1",
      billingAccountId: "fam-1",
      studentProfileId: "pupil-1",
      chargeCategory: "tuition",
      sessionId: "sess-1",
      transactionId: "tx-1",
      reference: "PAY-2026-000001",
      amountMinor: 200000,
      currency: "GBP",
      title: "Invoice KSW-INV-2026-000123",
      successUrl: "https://school.test/success",
      cancelUrl: "https://school.test/cancel",
    });
    expect(created.checkoutUrl).toContain("checkout.stripe.test");
    expect(posted).toContain("metadata%5Bschoolapp_organisation_id%5D=org-1");
    expect(posted).toContain("metadata%5Bschoolapp_invoice_id%5D=inv-1");
    expect(posted).toContain("metadata%5Bschoolapp_billing_account_id%5D=fam-1");
    expect(posted).toContain("metadata%5Bschoolapp_pupil_id%5D=pupil-1");
    expect(posted).toContain("metadata%5Bschoolapp_charge_category%5D=tuition");
    expect(posted).not.toContain("schoolapp_charge_id");
    expect(posted).not.toContain("payment_method_types");
  });

  it("creates a £500 GBP Checkout Session without payment_method_types and keeps tenant HTTPS return URLs", async () => {
    let posted = "";
    let requestedUrl = "";
    const provider = new StripePaymentProvider({
      providerKey: "stripe",
      fakeWebhookSecret: "unused",
      stripeSecretKey: "sk_test_placeholder",
      stripeWebhookSecret: "whsec_test",
      fetchImpl: (async (url, init) => {
        requestedUrl = String(url);
        posted = String(init?.body ?? "");
        return {
          ok: true,
          json: async () => ({ id: "cs_ksw_500", url: "https://checkout.stripe.com/c/pay/cs_ksw_500" }),
        } as Response;
      }) as typeof fetch,
    });
    const created = await provider.createSession({
      organisationId: "org-kingswood",
      chargeId: "",
      invoiceId: "inv-ksw-500",
      billingAccountId: "fam-1",
      studentProfileId: "pupil-1",
      chargeCategory: "tuition",
      sessionId: "sess-1",
      transactionId: "tx-1",
      reference: "KSW-INV-2026-000001",
      amountMinor: 50000,
      currency: "GBP",
      title: "Invoice KSW-INV-2026-000001",
      successUrl: "https://kingswood.luvlearn.co.uk/parent/finance/checkout/success?invoiceId=inv-ksw-500",
      cancelUrl: "https://kingswood.luvlearn.co.uk/parent/finance/checkout/cancel?invoiceId=inv-ksw-500",
    });
    expect(requestedUrl).toContain("/v1/checkout/sessions");
    expect(created.checkoutUrl).toBe("https://checkout.stripe.com/c/pay/cs_ksw_500");
    const params = new URLSearchParams(posted);
    expect(params.has("payment_method_types[0]")).toBe(false);
    expect(posted).not.toMatch(/payment_method_types/);
    expect(params.get("line_items[0][price_data][unit_amount]")).toBe("50000");
    expect(params.get("line_items[0][price_data][currency]")).toBe("gbp");
    expect(params.get("mode")).toBe("payment");
    expect(params.get("success_url")).toBe(
      "https://kingswood.luvlearn.co.uk/parent/finance/checkout/success?invoiceId=inv-ksw-500",
    );
    expect(params.get("cancel_url")).toBe(
      "https://kingswood.luvlearn.co.uk/parent/finance/checkout/cancel?invoiceId=inv-ksw-500",
    );
  });

  it("logs sanitised Stripe 400 diagnostics without secrets or the raw response body", async () => {
    const secretKey = "sk_live_super_secret_key_value";
    const webhookSecret = "whsec_never_log_this_secret";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const stripeBody = {
      error: {
        type: "invalid_request_error",
        code: "url_invalid",
        param: "success_url",
        message:
          "Not a valid URL: https://kingswood.luvlearn.co.uk/parent/finance/checkout/success?invoiceId=inv-1&token=tok_abc (sk_live_super_secret_key_value)",
        charge: "ch_should_not_appear",
        decline_code: "do_not_log_nested",
      },
      extra: { card: "4242424242424242", authorization: `Bearer ${secretKey}` },
    };
    const provider = new StripePaymentProvider({
      providerKey: "stripe",
      fakeWebhookSecret: "unused",
      stripeSecretKey: secretKey,
      stripeWebhookSecret: webhookSecret,
      stripeApiBase: "https://api.stripe.com",
      fetchImpl: (async () =>
        ({
          ok: false,
          status: 400,
          headers: new Headers({ "Request-Id": "req_checkout_400" }),
          json: async () => stripeBody,
        }) as Response) as typeof fetch,
    });
    const thrown = await provider
      .createSession({
        organisationId: "org-kingswood",
        chargeId: "",
        invoiceId: "inv-1",
        billingAccountId: "fam-should-not-log",
        studentProfileId: "pupil-should-not-log",
        chargeCategory: "tuition",
        sessionId: "sess-1",
        transactionId: "tx-1",
        reference: "PAY-2026-000001",
        amountMinor: 50000,
        currency: "GBP",
        title: "Invoice for Pat Parent",
        successUrl: "https://kingswood.luvlearn.co.uk/parent/finance/checkout/success?invoiceId=inv-1",
        cancelUrl: "http://kingswood.luvlearn.co.uk/parent/finance/checkout/cancel?invoiceId=inv-1",
      })
      .catch((error) => error);
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({
      status: 503,
      code: "provider_unavailable",
      message: "The payment provider is temporarily unavailable",
    });
    const logged = info.mock.calls.find((call) => call[0] === "stripe_checkout_failed");
    expect(logged).toBeTruthy();
    const payload = logged![1] as StripeCheckoutFailureLog;
    expect(payload).toEqual({
      event: "stripe_checkout_failed",
      stripeHttpStatus: 400,
      stripeErrorType: "invalid_request_error",
      stripeErrorCode: "url_invalid",
      stripeErrorParam: "success_url",
      stripeRequestId: "req_checkout_400",
      stripeErrorMessage: null,
      organisationId: "org-kingswood",
      invoiceId: "inv-1",
      mode: "live",
      currency: "GBP",
      amountMinor: 50000,
      successOrigin: "https://kingswood.luvlearn.co.uk",
      cancelOrigin: "http://kingswood.luvlearn.co.uk",
      stripeApiHost: "api.stripe.com",
    });
    const serialised = JSON.stringify(info.mock.calls);
    expect(serialised).not.toContain(secretKey);
    expect(serialised).not.toContain(webhookSecret);
    expect(serialised).not.toContain("Bearer ");
    expect(serialised).not.toContain("whsec_");
    expect(serialised).not.toContain("4242424242424242");
    expect(serialised).not.toContain("fam-should-not-log");
    expect(serialised).not.toContain("pupil-should-not-log");
    expect(serialised).not.toContain("Pat Parent");
    expect(serialised).not.toContain("/parent/finance");
    expect(serialised).not.toContain("invoiceId=inv-1");
    expect(serialised).not.toContain("ch_should_not_appear");
    expect(serialised).not.toContain("do_not_log_nested");
    expect(serialised).not.toContain("Authorization");
    expect(Object.keys(payload).sort()).toEqual(
      [
        "amountMinor",
        "cancelOrigin",
        "currency",
        "event",
        "invoiceId",
        "mode",
        "organisationId",
        "stripeApiHost",
        "stripeErrorCode",
        "stripeErrorMessage",
        "stripeErrorParam",
        "stripeErrorType",
        "stripeHttpStatus",
        "stripeRequestId",
        "successOrigin",
      ].sort(),
    );
  });

  it("keeps a safe Stripe error message and reduces URLs to scheme and host", () => {
    const log = buildStripeCheckoutFailureLog({
      httpStatus: 400,
      headers: { "request-id": "req_safe" },
      responseJson: {
        error: {
          type: "invalid_request_error",
          code: "url_invalid",
          param: "success_url",
          message:
            "Not a valid URL: https://kingswood.luvlearn.co.uk/parent/finance/checkout/success?invoiceId=inv-1",
        },
      },
      diagnostics: {
        organisationId: "org-1",
        invoiceId: "inv-1",
        currency: "gbp",
        amountMinor: 50000,
        successUrl: "https://kingswood.luvlearn.co.uk/parent/finance/checkout/success?invoiceId=inv-1",
        cancelUrl: "https://kingswood.luvlearn.co.uk/parent/finance/checkout/cancel?invoiceId=inv-1",
      },
      apiBase: "https://api.stripe.com",
      mode: "live",
    });
    expect(log.stripeErrorMessage).toBe("Not a valid URL: https://kingswood.luvlearn.co.uk");
    expect(log.stripeErrorMessage).not.toContain("/parent/finance");
    expect(log.successOrigin).toBe("https://kingswood.luvlearn.co.uk");
    expect(originSchemeAndHost("https://kingswood.luvlearn.co.uk/parent/finance/checkout/success?invoiceId=inv-1")).toBe(
      "https://kingswood.luvlearn.co.uk",
    );
  });
});
