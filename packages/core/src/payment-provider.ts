import { createHmac, timingSafeEqual } from "node:crypto";
import { detectStripeSecretMode, looksLikeSecret } from "./encrypted-secrets.js";
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

const STRIPE_CHECKOUT_LOG_EVENT = "stripe_checkout_failed" as const;
const SANITISED_MESSAGE_MAX = 180;
const TOKEN_MAX = 80;

export type StripeCheckoutFailureDiagnostics = {
  organisationId: string;
  invoiceId?: string | null;
  currency: string;
  amountMinor: number;
  successUrl: string;
  cancelUrl: string;
};

export type StripeCheckoutFailureLog = {
  event: typeof STRIPE_CHECKOUT_LOG_EVENT;
  stripeHttpStatus: number | null;
  stripeErrorType: string | null;
  stripeErrorCode: string | null;
  stripeErrorParam: string | null;
  stripeRequestId: string | null;
  stripeErrorMessage: string | null;
  organisationId: string | null;
  invoiceId: string | null;
  mode: "test" | "live" | null;
  currency: string | null;
  amountMinor: number | null;
  successOrigin: string | null;
  cancelOrigin: string | null;
  stripeApiHost: string | null;
};

function containsSecretMaterial(value: string): boolean {
  if (looksLikeSecret(value.trim())) return true;
  return /sk_(?:test|live)_|rk_(?:test|live)_|whsec_|Bearer\s|v1:/.test(value);
}

export function originSchemeAndHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (containsSecretMaterial(url.host)) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function hostOnly(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!url.host || containsSecretMaterial(url.host)) return null;
    return url.host;
  } catch {
    return null;
  }
}

function safeToken(value: unknown, max = TOKEN_MAX): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || containsSecretMaterial(trimmed)) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function sanitiseStripeErrorMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value.replace(/\s+/g, " ").trim();
  if (!text || containsSecretMaterial(text)) return null;
  text = text.replace(/\bhttps?:\/\/[^\s]+/gi, (match) => originSchemeAndHost(match) ?? "[url]");
  if (containsSecretMaterial(text)) return null;
  if (text.length > SANITISED_MESSAGE_MAX) text = text.slice(0, SANITISED_MESSAGE_MAX);
  return text;
}

function stripeErrorObject(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const error = (json as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  return error as Record<string, unknown>;
}

function readHeader(headers: unknown, name: string): string | null {
  if (!headers) return null;
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === "function") {
    const value = (getter as (headerName: string) => string | null).call(headers, name);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  if (typeof headers === "object") {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() === name.toLowerCase() && typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

export function buildStripeCheckoutFailureLog(input: {
  httpStatus: number | null;
  headers?: unknown;
  responseJson?: unknown;
  diagnostics: StripeCheckoutFailureDiagnostics;
  apiBase: string;
  mode: "test" | "live" | null;
}): StripeCheckoutFailureLog {
  const error = stripeErrorObject(input.responseJson);
  const requestId = readHeader(input.headers, "request-id") ?? readHeader(input.headers, "Request-Id");
  const currency =
    typeof input.diagnostics.currency === "string" && /^[A-Za-z]{3}$/.test(input.diagnostics.currency.trim())
      ? input.diagnostics.currency.trim().toUpperCase()
      : null;
  const amountMinor =
    Number.isInteger(input.diagnostics.amountMinor) && Number.isFinite(input.diagnostics.amountMinor)
      ? input.diagnostics.amountMinor
      : null;
  return {
    event: STRIPE_CHECKOUT_LOG_EVENT,
    stripeHttpStatus:
      typeof input.httpStatus === "number" && Number.isFinite(input.httpStatus) ? input.httpStatus : null,
    stripeErrorType: error ? safeToken(error.type) : null,
    stripeErrorCode: error ? safeToken(error.code) : null,
    stripeErrorParam: error ? safeToken(error.param, 120) : null,
    stripeRequestId: requestId && !containsSecretMaterial(requestId) ? safeToken(requestId) : null,
    stripeErrorMessage: error ? sanitiseStripeErrorMessage(error.message) : null,
    organisationId: safeToken(input.diagnostics.organisationId),
    invoiceId: input.diagnostics.invoiceId ? safeToken(input.diagnostics.invoiceId) : null,
    mode: input.mode === "test" || input.mode === "live" ? input.mode : null,
    currency,
    amountMinor,
    successOrigin: originSchemeAndHost(input.diagnostics.successUrl),
    cancelOrigin: originSchemeAndHost(input.diagnostics.cancelUrl),
    stripeApiHost: hostOnly(input.apiBase),
  };
}

function logStripeCheckoutFailure(log: StripeCheckoutFailureLog): void {
  try {
    console.info(STRIPE_CHECKOUT_LOG_EVENT, log);
  } catch {
    // Logging must never change the parent-facing failure.
  }
}

/**
 * Platform/runtime defaults. Per-school Stripe secret key and webhook secret
 * are stored encrypted on school_payment_provider_configs and are never read
 * from STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET for tenant payments.
 *
 * Precedence for checkout/refund:
 * 1. Organisation Stripe config, if a row exists (fail closed when disabled/incomplete)
 * 2. Fake provider when PAYMENT_PROVIDER=fake (local/CI default) and no org row
 * 3. Fail closed — never silently use a platform Stripe account
 *
 * STRIPE_API_BASE remains an optional infrastructure default.
 * STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are retained only for StripePaymentProvider
 * unit tests and are ignored for school payment resolution.
 */
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
  private readonly webhookSecret: string | null;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: PaymentRuntimeConfig) {
    this.secretKey = config.stripeSecretKey ?? "";
    this.webhookSecret = config.stripeWebhookSecret;
    this.apiBase = config.stripeApiBase ?? "https://api.stripe.com";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async createSession(input: CreatePaymentSessionInput): Promise<PaymentSessionResult> {
    const body = new URLSearchParams();
    body.set("mode", "payment");
    body.set("success_url", input.successUrl);
    body.set("cancel_url", input.cancelUrl);
    body.set("client_reference_id", input.reference);
    // Some Stripe accounts default Managed Payments on Checkout Sessions even
    // when Dashboard onboarding still shows Get started. That path forbids
    // automatic_tax[enabled]=false and requires a product tax_code. School
    // tuition Checkout keeps the school as merchant of record: opt out per
    // session and omit automatic_tax so the invoice outstanding is charged
    // unchanged. Do not send payment_method_types (dynamic methods / MP).
    body.set("managed_payments[enabled]", "false");
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

    const response = await this.request("POST", "/v1/checkout/sessions", body, input.idempotencyKey, {
      organisationId: input.organisationId,
      invoiceId: input.invoiceId ?? null,
      currency: input.currency,
      amountMinor: input.amountMinor,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });
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
    if (!this.webhookSecret) {
      throw new AppError(401, "unauthenticated", "Invalid provider signature");
    }
    const event = verifyStripeSignature(rawBody, signature, this.webhookSecret);
    return mapStripeEvent(event);
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: URLSearchParams,
    idempotencyKey?: string | null,
    checkoutDiagnostics?: StripeCheckoutFailureDiagnostics,
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
      let json: Record<string, unknown> | null = null;
      try {
        json = (await response.json()) as Record<string, unknown>;
      } catch {
        json = null;
      }
      if (!response.ok) {
        if (checkoutDiagnostics) {
          logStripeCheckoutFailure(
            buildStripeCheckoutFailureLog({
              httpStatus: response.status,
              headers: response.headers,
              responseJson: json,
              diagnostics: checkoutDiagnostics,
              apiBase: this.apiBase,
              mode: detectStripeSecretMode(this.secretKey),
            }),
          );
        }
        throw new AppError(503, "provider_unavailable", "The payment provider is temporarily unavailable");
      }
      if (!json) {
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
