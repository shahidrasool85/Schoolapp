import {
  SCHOOL_ACTIVITY_CHARGE_POLICIES,
  SCHOOL_ACTIVITY_PAYMENT_STATUSES,
  SCHOOL_CHARGE_ADJUSTMENT_KINDS,
  SCHOOL_CHARGE_CATEGORY_KEYS,
  SCHOOL_CHARGE_SOURCE_KINDS,
  SCHOOL_CHARGE_STATUSES,
  SCHOOL_OFFLINE_PAYMENT_METHODS,
  SCHOOL_PAYMENT_CHANNELS,
  SCHOOL_PAYMENT_PROVIDER_KEYS,
  SCHOOL_PAYMENT_REFUND_STATUSES,
  SCHOOL_PAYMENT_SESSION_STATUSES,
  SCHOOL_PAYMENT_TRANSACTION_STATUSES,
  type SchoolActivityChargePolicy,
  type SchoolActivityPaymentStatus,
  type SchoolChargeAdjustmentKind,
  type SchoolChargeCategoryKey,
  type SchoolChargeSourceKind,
  type SchoolChargeStatus,
  type SchoolOfflinePaymentMethod,
  type SchoolPaymentChannel,
  type SchoolPaymentProviderKey,
  type SchoolPaymentRefundStatus,
  type SchoolPaymentSessionStatus,
  type SchoolPaymentTransactionStatus,
} from "@schoolapp/domain";
import { outstandingMinor } from "./money.js";

export function isSchoolChargeStatus(value: string): value is SchoolChargeStatus {
  return (SCHOOL_CHARGE_STATUSES as readonly string[]).includes(value);
}

export function isSchoolChargeCategoryKey(value: string): value is SchoolChargeCategoryKey {
  return (SCHOOL_CHARGE_CATEGORY_KEYS as readonly string[]).includes(value);
}

export function isSchoolChargeSourceKind(value: string): value is SchoolChargeSourceKind {
  return (SCHOOL_CHARGE_SOURCE_KINDS as readonly string[]).includes(value);
}

export function isSchoolChargeAdjustmentKind(value: string): value is SchoolChargeAdjustmentKind {
  return (SCHOOL_CHARGE_ADJUSTMENT_KINDS as readonly string[]).includes(value);
}

export function isSchoolPaymentTransactionStatus(
  value: string,
): value is SchoolPaymentTransactionStatus {
  return (SCHOOL_PAYMENT_TRANSACTION_STATUSES as readonly string[]).includes(value);
}

export function isSchoolPaymentChannel(value: string): value is SchoolPaymentChannel {
  return (SCHOOL_PAYMENT_CHANNELS as readonly string[]).includes(value);
}

export function isSchoolPaymentProviderKey(value: string): value is SchoolPaymentProviderKey {
  return (SCHOOL_PAYMENT_PROVIDER_KEYS as readonly string[]).includes(value);
}

export function isSchoolOfflinePaymentMethod(value: string): value is SchoolOfflinePaymentMethod {
  return (SCHOOL_OFFLINE_PAYMENT_METHODS as readonly string[]).includes(value);
}

export function isSchoolPaymentRefundStatus(value: string): value is SchoolPaymentRefundStatus {
  return (SCHOOL_PAYMENT_REFUND_STATUSES as readonly string[]).includes(value);
}

export function isSchoolPaymentSessionStatus(value: string): value is SchoolPaymentSessionStatus {
  return (SCHOOL_PAYMENT_SESSION_STATUSES as readonly string[]).includes(value);
}

export function isSchoolActivityChargePolicy(value: string): value is SchoolActivityChargePolicy {
  return (SCHOOL_ACTIVITY_CHARGE_POLICIES as readonly string[]).includes(value);
}

export function isSchoolActivityPaymentStatus(value: string): value is SchoolActivityPaymentStatus {
  return (SCHOOL_ACTIVITY_PAYMENT_STATUSES as readonly string[]).includes(value);
}

export type ChargeBalance = {
  originalAmountMinor: number;
  amountDueMinor: number;
  grossPaidMinor: number;
  refundedMinor: number;
  netPaidMinor: number;
  outstandingMinor: number;
  adjustmentMinor: number;
};

export function chargeBalance(input: {
  originalAmountMinor: number;
  amountDueMinor: number;
  grossPaidMinor: number;
  refundedMinor: number;
}): ChargeBalance {
  const net = input.grossPaidMinor >= input.refundedMinor ? input.grossPaidMinor - input.refundedMinor : 0;
  return {
    originalAmountMinor: input.originalAmountMinor,
    amountDueMinor: input.amountDueMinor,
    grossPaidMinor: input.grossPaidMinor,
    refundedMinor: input.refundedMinor,
    netPaidMinor: net,
    outstandingMinor: outstandingMinor(input.amountDueMinor, net),
    adjustmentMinor:
      input.originalAmountMinor >= input.amountDueMinor
        ? input.originalAmountMinor - input.amountDueMinor
        : 0,
  };
}

export function deriveChargeStatus(input: {
  current: SchoolChargeStatus;
  amountDueMinor: number;
  netPaidMinor: number;
  refundedMinor: number;
}): SchoolChargeStatus {
  if (input.current === "draft" || input.current === "cancelled") {
    return input.current;
  }
  if (input.amountDueMinor === 0 && input.netPaidMinor === 0 && input.refundedMinor === 0) {
    return "waived";
  }
  if (input.refundedMinor > 0 && input.netPaidMinor === 0) {
    return "refunded";
  }
  if (input.netPaidMinor <= 0) {
    return input.current === "waived" ? "waived" : "issued";
  }
  if (input.netPaidMinor < input.amountDueMinor) {
    return "partially_paid";
  }
  return "paid";
}

export function chargeIsPayable(status: SchoolChargeStatus, outstanding: number): boolean {
  return outstanding > 0 && (status === "issued" || status === "partially_paid");
}

export function dueUrgency(dueAt: Date | string | null, now = new Date()): "overdue" | "due_soon" | "none" {
  if (!dueAt) return "none";
  const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  if (Number.isNaN(due.getTime())) return "none";
  if (due.getTime() < now.getTime()) return "overdue";
  const week = 7 * 24 * 60 * 60 * 1000;
  if (due.getTime() - now.getTime() <= week) return "due_soon";
  return "none";
}

export function operationalPaymentStatus(input: {
  paymentRequired: boolean;
  chargeStatus: SchoolChargeStatus | null;
}): SchoolActivityPaymentStatus {
  if (!input.paymentRequired && !input.chargeStatus) return "not_required";
  if (!input.chargeStatus) return "not_requested";
  if (input.chargeStatus === "paid") return "paid";
  if (input.chargeStatus === "waived") return "waived";
  if (input.chargeStatus === "refunded") return "refunded";
  if (input.chargeStatus === "cancelled" || input.chargeStatus === "draft") return "not_requested";
  return "outstanding";
}

export function shouldGenerateActivityCharge(input: {
  chargePolicy: SchoolActivityChargePolicy;
  paymentRequired: boolean;
  priceAmountMinor: number | null;
  registrationStatus: string;
  consentResponse?: string | null;
}): boolean {
  if (!input.paymentRequired) return false;
  if (!input.priceAmountMinor || input.priceAmountMinor <= 0) return false;
  if (input.chargePolicy === "none") return false;
  if (input.registrationStatus === "waitlisted" && input.chargePolicy !== "on_consent") {
    return false;
  }
  if (input.chargePolicy === "on_confirmed") {
    return input.registrationStatus === "confirmed";
  }
  return input.consentResponse === "consented";
}

export function shouldCancelActivityCharge(input: {
  registrationStatus: string;
  chargeStatus: SchoolChargeStatus;
}): boolean {
  if (input.chargeStatus === "paid" || input.chargeStatus === "partially_paid" || input.chargeStatus === "refunded") {
    return false;
  }
  return input.registrationStatus === "declined" || input.registrationStatus === "withdrawn";
}

export function paymentNotificationBody(
  type:
    | "payment_request"
    | "payment_due_soon"
    | "payment_received"
    | "payment_refunded"
    | "payment_activity_required"
    | "payment_refund_failed",
  title: string,
): { title: string; body: string } {
  switch (type) {
    case "payment_request":
      return {
        title: `Payment requested: ${title}`,
        body: `A school payment request is ready for ${title}. Open Payments to review the amount due.`,
      };
    case "payment_due_soon":
      return {
        title: `Payment due soon: ${title}`,
        body: `${title} is due soon. Open Payments if an amount is still outstanding.`,
      };
    case "payment_received":
      return {
        title: `Payment received: ${title}`,
        body: `A payment for ${title} has been recorded. A receipt is available in Payments.`,
      };
    case "payment_refunded":
      return {
        title: `Refund issued: ${title}`,
        body: `A refund has been issued for ${title}. See Payments for the updated status.`,
      };
    case "payment_activity_required":
      return {
        title: `Activity payment required: ${title}`,
        body: `A place is confirmed for ${title}. Payment is now requested in the Payments area.`,
      };
    case "payment_refund_failed":
      return {
        title: `Refund failed: ${title}`,
        body: `A refund for ${title} could not be completed. Review the transaction in Finance.`,
      };
  }
}

export function financeUserError(code: string): { status: number; code: string; message: string } {
  switch (code) {
    case "charge_already_paid":
      return { status: 409, code, message: "This charge is already paid" };
    case "no_amount_outstanding":
      return { status: 409, code, message: "There is no amount outstanding" };
    case "payment_unavailable":
      return { status: 409, code, message: "Payment is not available for this charge" };
    case "payment_failed":
      return { status: 409, code, message: "Payment failed" };
    case "refund_failed":
      return { status: 409, code, message: "Refund failed" };
    case "invalid_amount":
      return { status: 400, code, message: "The amount is invalid" };
    case "overpayment":
      return { status: 409, code, message: "This payment would exceed the amount outstanding" };
    case "currency_mismatch":
      return { status: 400, code, message: "Currency does not match the payment session" };
    case "provider_unavailable":
      return { status: 503, code, message: "The payment provider is temporarily unavailable" };
    case "payment_provider_not_configured":
      return { status: 503, code, message: "Online card payments are not configured for this school" };
    case "payment_provider_disabled":
      return { status: 503, code, message: "Online card payments are currently disabled" };
    case "test_live_mismatch":
      return { status: 400, code, message: "The Stripe secret key does not match the selected mode" };
    case "stale_session":
      return { status: 409, code, message: "This payment session is no longer valid" };
    default:
      return { status: 400, code: "validation_failed", message: "The request could not be completed" };
  }
}
