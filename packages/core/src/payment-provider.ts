import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.js";
import { redactProviderReference } from "./money.js";

export type PaymentProviderKey = "fake" | "stripe";

export type CreatePaymentSessionInput = {
  organisationId: string;
  chargeId: string;
  invoiceId?: string | null;
  billingAccountId?: string | null;
  studentProfileId?: string | null;
  chargeCategory?: string | null;
  sessionId: string;
  transactionId: string;
  reference: string;
  amountMinor: number;
  currency: string;
  title: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey?: string | null;
};

export type PaymentSessionResult = {
  providerKey: PaymentProviderKey;
  providerSessionId: string;
  checkoutUrl: string;
  expiresAt: Date | null;
};

export type ProviderRefundInput = {
  providerPaymentId: string;
  amountMinor: number;
  currency: string;
  reason: string;
  idempotencyKey?: string | null;
};

export type ProviderRefundResult = {
  providerRefundId: string;
  status: "pending" | "succeeded" | "failed";
};

export type ProviderEvent = {
  providerKey: PaymentProviderKey;
  eventId: string;
  eventType: string;
  providerSessionId?: string | null;
  providerPaymentId?: string | null;
  providerRefundId?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  outcome: "succeeded" | "failed" | "cancelled" | "refunded" | "ignored";
};

export type PaymentProvider = {
  key: PaymentProviderKey;
  createSession(input: CreatePaymentSessionInput): Promise<PaymentSessionResult>;
  retrieveStatus(providerSessionId: string): Promise<{ status: string; providerPaymentId?: string | null }>;
  refund(input: ProviderRefundInput): Promise<ProviderRefundResult>;
  verifyWebhook(rawBody: string, signature: string | null): ProviderEvent;
};

export type PaymentRuntimeConfig = {
  providerKey: PaymentProviderKey;
  fakeWebhookSecret: string;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  stripeApiBase?: string;
  fetchImpl?: typeof fetch;
};

export function paymentConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PaymentRuntimeConfig {
  const provider = (env.PAYMENT_PROVIDER ?? "fake").trim().toLowerCase();
  const providerKey: PaymentProviderKey = provider === "stripe" ? "stripe" : "fake";
  return {
    providerKey,
    fakeWebhookSecret:
      env.FAKE_PAYMENT_WEBHOOK_SECRET?.trim() ||
      `${env.AUTH_SECRET ?? "schoolapp-dev"}:fake-payments`,
    stripeSecretKey: env.STRIPE_SECRET_KEY?.trim() || null,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || null,
    stripeApiBase: env.STRIPE_API_BASE?.trim() || "https://api.stripe.com",
  };
}

export function createPaymentProvider(config: PaymentRuntimeConfig): PaymentProvider {
  if (config.providerKey === "stripe") {
    if (!config.stripeSecretKey || !config.stripeWebhookSecret) {
      throw new AppError(503, "provider_unavailable", "The payment provider is temporarily unavailable");
    }
    return new StripePaymentProvider(config);
  }
  return new FakePaymentProvider(config.fakeWebhookSecret);
}

export class FakePaymentProvider implements PaymentProvider {
  readonly key = "fake" as const;

  constructor(private readonly webhookSecret: string) {}

  async createSession(input: CreatePaymentSessionInput): Promise<PaymentSessionResult> {
    const providerSessionId = `fake_sess_${input.sessionId.replace(/-/g, "")}`;
    const token = signFakeCheckoutToken(this.webhookSecret, input.sessionId);
    const checkoutUrl = `/payments/demo/checkout/${input.sessionId}?t=${token}`;
    return {
      providerKey: "fake",
      providerSessionId,
      checkoutUrl,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  }

  async retrieveStatus(providerSessionId: string): Promise<{ status: string; providerPaymentId?: string | null }> {
    return { status: "open", providerPaymentId: null };
  }

  async refund(input: ProviderRefundInput): Promise<ProviderRefundResult> {
    return {
      providerRefundId: `fake_re_${input.providerPaymentId.slice(-12)}_${input.amountMinor}`,
      status: "succeeded",
    };
  }

  verifyCheckoutToken(sessionId: string, token: string | null | undefined): boolean {
    if (!token) return false;
    const expected = signFakeCheckoutToken(this.webhookSecret, sessionId);
    return safeEqual(token, expected);
  }

  signEvent(event: ProviderEvent): string {
    return signFakePaymentEvent(this.webhookSecret, event);
  }

  verifyWebhook(rawBody: string, signature: string | null): ProviderEvent {
    const event = parseFakePaymentEvent(rawBody);
    const expected = signFakePaymentEvent(this.webhookSecret, event);
    if (!signature || !safeEqual(signature, expected)) {
      throw new AppError(401, "unauthenticated", "Invalid provider signature");
    }
    return event;
  }
}

export class StripePaymentProvider implements PaymentProvider {
  readonly key = "stripe" as const;
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: PaymentRuntimeConfig) {
    this.secretKey = config.stripeSecretKey!;
    this.webhookSecret = config.stripeWebhookSecret!;
    this.apiBase = config.stripeApiBase ?? "https://api.stripe.com";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async createSession(input: CreatePaymentSessionInput): Promise<PaymentSessionResult> {
    const body = new URLSearchParams();
    body.set("mode", "payment");
    body.set("success_url", input.successUrl);
    body.set("cancel_url", input.cancelUrl);
    body.set("client_reference_id", input.reference);
    body.set("payment_method_types[0]", "card");
    body.set("line_items[0][quantity]", "1");
    body.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
    body.set("line_items[0][price_data][unit_amount]", String(input.amountMinor));
    body.set("line_items[0][price_data][product_data][name]", input.title);
    body.set("metadata[schoolapp_organisation_id]", input.organisationId);
    if (input.chargeId) body.set("metadata[schoolapp_charge_id]", input.chargeId);
    if (input.invoiceId) body.set("metadata[schoolapp_invoice_id]", input.invoiceId);
    if (input.billingAccountId) body.set("metadata[schoolapp_billing_account_id]", input.billingAccountId);
    if (input.studentProfileId) body.set("metadata[schoolapp_pupil_id]", input.studentProfileId);
    if (input.chargeCategory) body.set("metadata[schoolapp_charge_category]", input.chargeCategory);
    body.set("metadata[schoolapp_session_id]", input.sessionId);
    body.set("metadata[schoolapp_transaction_id]", input.transactionId);
    body.set("metadata[schoolapp_reference]", input.reference);
    body.set("payment_intent_data[metadata][schoolapp_organisation_id]", input.organisationId);
    if (input.chargeId) body.set("payment_intent_data[metadata][schoolapp_charge_id]", input.chargeId);
    if (input.invoiceId) body.set("payment_intent_data[metadata][schoolapp_invoice_id]", input.invoiceId);
    body.set("payment_intent_data[metadata][schoolapp_session_id]", input.sessionId);
    if (input.idempotencyKey) body.set("metadata[schoolapp_idempotency_key]", input.idempotencyKey);

    const response = await this.request("POST", "/v1/checkout/sessions", body, input.idempotencyKey);
    return {
      providerKey: "stripe",
      providerSessionId: String(response.id),
      checkoutUrl: String(response.url),
      expiresAt: response.expires_at ? new Date(Number(response.expires_at) * 1000) : null,
    };
  }

  async retrieveStatus(providerSessionId: string): Promise<{ status: string; providerPaymentId?: string | null }> {
    const response = await this.request("GET", `/v1/checkout/sessions/${encodeURIComponent(providerSessionId)}`);
    return {
      status: String(response.status ?? "open"),
      providerPaymentId: response.payment_intent ? String(response.payment_intent) : null,
    };
  }

  async refund(input: ProviderRefundInput): Promise<ProviderRefundResult> {
    const body = new URLSearchParams();
    body.set("payment_intent", input.providerPaymentId);
    body.set("amount", String(input.amountMinor));
    const response = await this.request("POST", "/v1/refunds", body, input.idempotencyKey);
    const stripeStatus = String(response.status ?? "pending");
    return {
      providerRefundId: String(response.id),
      status: stripeStatus === "succeeded" ? "succeeded" : stripeStatus === "failed" ? "failed" : "pending",
    };
  }

  verifyWebhook(rawBody: string, signature: string | null): ProviderEvent {
    const event = verifyStripeSignature(rawBody, signature, this.webhookSecret);
    return mapStripeEvent(event);
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: URLSearchParams,
    idempotencyKey?: string | null,
  ): Promise<Record<string, unknown>> {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.secretKey}`,
      };
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
      const response = await this.fetchImpl(`${this.apiBase}${path}`, {
        method,
        headers,
        body: body?.toString(),
      });
      const json = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new AppError(503, "provider_unavailable", "The payment provider is temporarily unavailable");
      }
      return json;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(503, "provider_unavailable", "The payment provider is temporarily unavailable");
    }
  }
}

export function signFakeCheckoutToken(secret: string, sessionId: string): string {
  return createHmac("sha256", secret).update(`checkout:${sessionId}`).digest("hex");
}

export function signFakePaymentEvent(secret: string, event: ProviderEvent): string {
  const payload = [
    event.eventId,
    event.eventType,
    event.providerSessionId ?? "",
    event.providerPaymentId ?? "",
    String(event.amountMinor ?? ""),
    event.currency ?? "",
    event.outcome,
  ].join(".");
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function parseFakePaymentEvent(rawBody: string): ProviderEvent {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new AppError(400, "validation_failed", "Invalid provider event");
  }
  const outcome = String(parsed.outcome ?? "");
  if (!["succeeded", "failed", "cancelled", "refunded"].includes(outcome)) {
    throw new AppError(400, "validation_failed", "Invalid provider event");
  }
  return {
    providerKey: "fake",
    eventId: String(parsed.eventId ?? ""),
    eventType: String(parsed.eventType ?? "payment"),
    providerSessionId: parsed.providerSessionId ? String(parsed.providerSessionId) : null,
    providerPaymentId: parsed.providerPaymentId ? String(parsed.providerPaymentId) : null,
    providerRefundId: parsed.providerRefundId ? String(parsed.providerRefundId) : null,
    amountMinor: parsed.amountMinor == null ? null : Number(parsed.amountMinor),
    currency: parsed.currency ? String(parsed.currency) : null,
    outcome: outcome as ProviderEvent["outcome"],
  };
}

export function verifyStripeSignature(rawBody: string, header: string | null, secret: string): Record<string, unknown> {
  if (!header) {
    throw new AppError(401, "unauthenticated", "Invalid provider signature");
  }
  const parts = Object.fromEntries(
    header.split(",").map((item) => {
      const [rawKey, ...rest] = item.split("=");
      return [(rawKey ?? "").trim(), rest.join("=")];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) {
    throw new AppError(401, "unauthenticated", "Invalid provider signature");
  }
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(Number(timestamp)) || ageSeconds > 60 * 5) {
    throw new AppError(401, "unauthenticated", "Invalid provider signature");
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  if (!safeEqual(signature, expected)) {
    throw new AppError(401, "unauthenticated", "Invalid provider signature");
  }
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new AppError(400, "validation_failed", "Invalid provider event");
  }
}

export function mapStripeEvent(event: Record<string, unknown>): ProviderEvent {
  const type = String(event.type ?? "");
  const object = ((event.data as { object?: Record<string, unknown> } | undefined)?.object ??
    {}) as Record<string, unknown>;
  const sessionId = type.startsWith("checkout.session") ? String(object.id ?? "") : String(object.id ?? "");
  const paymentIntent =
    object.payment_intent != null
      ? String(object.payment_intent)
      : type.startsWith("payment_intent")
        ? String(object.id ?? "")
        : null;
  let outcome: ProviderEvent["outcome"] = "ignored";
  if (type === "checkout.session.completed") {
    outcome = String(object.payment_status ?? "") === "paid" ? "succeeded" : "ignored";
  } else if (type === "checkout.session.async_payment_succeeded" || type === "payment_intent.succeeded") {
    outcome = "succeeded";
  } else if (
    type === "checkout.session.expired" ||
    type === "checkout.session.async_payment_failed" ||
    type === "payment_intent.payment_failed"
  ) {
    outcome = "failed";
  } else if (type === "refund.created" || type === "refund.updated" || type === "charge.refund.updated") {
    const refundStatus = String(object.status ?? "");
    outcome = refundStatus === "succeeded" || refundStatus === "paid" ? "refunded" : refundStatus === "failed" ? "failed" : "ignored";
  } else if (type === "charge.refunded") {
    outcome = "refunded";
  } else if (type === "payment_intent.canceled") {
    outcome = "cancelled";
  }
  return {
    providerKey: "stripe",
    eventId: String(event.id ?? ""),
    eventType: type,
    providerSessionId: type.startsWith("checkout.session")
      ? sessionId
      : String((object.metadata as { schoolapp_session_id?: string } | undefined)?.schoolapp_session_id ?? "") || null,
    providerPaymentId: paymentIntent,
    providerRefundId: type.includes("refund") ? String(object.id ?? "") : null,
    amountMinor: object.amount_total != null ? Number(object.amount_total) : object.amount != null ? Number(object.amount) : null,
    currency: object.currency ? String(object.currency).toUpperCase() : null,
    outcome,
  };
}

export function safeProviderMetadata(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value) return {};
  const blocked = ["secret", "card", "cvc", "pan", "number", "webhook", "key"];
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (blocked.some((word) => key.toLowerCase().includes(word))) continue;
    if (typeof item === "string") out[key] = redactProviderReference(item);
    else if (typeof item === "number" || typeof item === "boolean") out[key] = item;
  }
  return out;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
