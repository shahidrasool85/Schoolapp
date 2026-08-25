import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  chargeBalance,
  chargeIsPayable,
  deriveChargeStatus,
  dueUrgency,
  operationalPaymentStatus,
  shouldCancelActivityCharge,
  shouldGenerateActivityCharge,
} from "./payments.js";
import { FakePaymentProvider, verifyStripeSignature, mapStripeEvent } from "./payment-provider.js";

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
  });
});
