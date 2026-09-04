import {
  AppError,
  loadStripeWebhookEndpoint,
  recordOrganisationWebhookResult,
  settleInvoiceProviderEvent,
  settleProviderEvent,
  type PaymentProvider,
  type ProviderEvent,
} from "@schoolapp/core";
import { withTenantContext } from "@schoolapp/db";
import type { Context } from "hono";
import type { ApiEnv, SchoolappApi } from "../types";
import { paymentProviderOf, paymentRuntime } from "../payments-context";

function requireFakeCheckoutToken(
  provider: PaymentProvider,
  sessionId: string,
  token: string | null | undefined,
): void {
  if (provider.key !== "fake" || !("verifyCheckoutToken" in provider)) {
    throw new AppError(404, "not_found", "Not found");
  }
  if (!(provider as { verifyCheckoutToken: (id: string, token: string | null | undefined) => boolean }).verifyCheckoutToken(sessionId, token)) {
    throw new AppError(401, "unauthenticated", "Invalid checkout token");
  }
}

async function processVerifiedPaymentEvent(
  c: Context<ApiEnv>,
  input: {
    provider: PaymentProvider;
    event: ProviderEvent;
    expectedOrganisationId?: string;
    configId?: string;
    enabled?: boolean;
  },
) {
  const event = input.event;
  if (!event.eventId) {
    throw new AppError(400, "validation_failed", "Invalid provider event");
  }

  const pools = c.get("config").pools;
  const resolved = event.providerSessionId
    ? await pools.app.query(
        `select organisation_id, session_id, charge_id, invoice_id, transaction_id, context_user_id,
                amount_minor, currency, session_status
           from resolve_payment_provider_session($1, $2)`,
        [input.provider.key, event.providerSessionId],
      )
    : event.providerPaymentId
      ? await pools.app.query(
          `select organisation_id, null::uuid as session_id, charge_id, invoice_id, transaction_id, context_user_id,
                  amount_minor, currency, null::text as session_status
             from resolve_payment_provider_payment($1, $2)`,
          [input.provider.key, event.providerPaymentId],
        )
      : { rows: [] as Array<Record<string, unknown>> };

  if (!resolved.rows[0]) {
    throw new AppError(400, "unknown_reference", "Unknown payment reference");
  }
  const row = resolved.rows[0] as {
    organisation_id: string;
    session_id: string | null;
    charge_id: string | null;
    invoice_id: string | null;
    transaction_id: string;
    context_user_id: string;
    amount_minor: string;
    currency: string;
  };

  if (input.expectedOrganisationId && row.organisation_id !== input.expectedOrganisationId) {
    if (input.configId) {
      await recordOrganisationWebhookResult(pools.app, {
        configId: input.configId,
        eventType: event.eventType,
        ok: false,
        errorCode: "organisation_mismatch",
      });
    }
    throw new AppError(400, "organisation_mismatch", "Payment does not belong to this school");
  }

  if (input.enabled === false && event.outcome === "succeeded") {
    if (input.configId) {
      await recordOrganisationWebhookResult(pools.app, {
        configId: input.configId,
        eventType: event.eventType,
        ok: false,
        errorCode: "payment_provider_disabled",
      });
    }
    throw new AppError(503, "payment_provider_disabled", "Online card payments are currently disabled");
  }

  const claimed = await pools.app.query<{
    event_row_id: string;
    already_processed: boolean;
    current_status: string;
  }>(
    `select event_row_id, already_processed, current_status
       from claim_payment_provider_event($1,$2,$3,$4,$5,$6)`,
    [input.provider.key, event.eventId, event.eventType, row.organisation_id, row.charge_id, row.transaction_id],
  );
  if (claimed.rows[0]?.already_processed) {
    console.info("payment_webhook", {
      provider: input.provider.key,
      eventId: event.eventId,
      eventType: event.eventType,
      outcome: event.outcome,
      result: "replayed",
      invoiceId: row.invoice_id,
      chargeId: row.charge_id,
      transactionId: row.transaction_id,
    });
    if (input.configId) {
      await recordOrganisationWebhookResult(pools.app, {
        configId: input.configId,
        eventType: event.eventType,
        ok: true,
      });
    }
    return c.json({ ok: true, replayed: true });
  }
  const eventRowId = claimed.rows[0]!.event_row_id;

  try {
    let rejected: { code: string; message: string } | undefined;
    await withTenantContext(pools.app, row.context_user_id, row.organisation_id, async (client) => {
      if (!row.session_id) {
        const session = await client.query<{ id: string }>(
          `select id from school_payment_sessions
            where transaction_id = $1 and organisation_id = $2
            order by created_at desc limit 1`,
          [row.transaction_id, row.organisation_id],
        );
        if (!session.rows[0]) throw new AppError(400, "unknown_reference", "Unknown payment reference");
        row.session_id = session.rows[0].id;
      }
      if (row.invoice_id) {
        const settled = await settleInvoiceProviderEvent(client, {
          organisationId: row.organisation_id,
          event,
          session: {
            session_id: row.session_id,
            invoice_id: row.invoice_id,
            transaction_id: row.transaction_id,
            amount_minor: row.amount_minor,
            currency: row.currency,
          },
        });
        rejected = settled.rejected;
      } else if (row.charge_id) {
        await settleProviderEvent(client, {
          organisationId: row.organisation_id,
          event,
          session: {
            session_id: row.session_id,
            charge_id: row.charge_id,
            transaction_id: row.transaction_id,
            amount_minor: row.amount_minor,
            currency: row.currency,
          },
        });
      } else {
        throw new AppError(400, "unknown_reference", "Unknown payment reference");
      }
    });
    await pools.app.query("select finish_payment_provider_event($1, 'processed')", [eventRowId]);
    if (input.configId) {
      await recordOrganisationWebhookResult(pools.app, {
        configId: input.configId,
        eventType: event.eventType,
        ok: !rejected,
        errorCode: rejected?.code ?? null,
      });
    }
    if (rejected) {
      console.info("payment_webhook", {
        provider: input.provider.key,
        eventId: event.eventId,
        eventType: event.eventType,
        outcome: event.outcome,
        result: "rejected",
        errorCode: rejected.code,
        invoiceId: row.invoice_id,
        chargeId: row.charge_id,
        transactionId: row.transaction_id,
      });
      return c.json({ error: rejected }, 400);
    }
    console.info("payment_webhook", {
      provider: input.provider.key,
      eventId: event.eventId,
      eventType: event.eventType,
      outcome: event.outcome,
      result: "processed",
      invoiceId: row.invoice_id,
      chargeId: row.charge_id,
      transactionId: row.transaction_id,
    });
    return c.json({ ok: true });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "processing_failed";
    await pools.app.query("select finish_payment_provider_event($1, 'failed', $2)", [eventRowId, code]);
    if (input.configId) {
      await recordOrganisationWebhookResult(pools.app, {
        configId: input.configId,
        eventType: event.eventType,
        ok: false,
        errorCode: code,
      });
    }
    console.info("payment_webhook", {
      provider: input.provider.key,
      eventId: event.eventId,
      eventType: event.eventType,
      outcome: event.outcome,
      result: "failed",
      errorCode: code,
      invoiceId: row.invoice_id,
      chargeId: row.charge_id,
      transactionId: row.transaction_id,
    });
    if (error instanceof AppError) throw error;
    console.error("payment_webhook_unhandled", error);
    throw new AppError(400, "validation_failed", "The payment event could not be processed");
  }
}

export function registerPaymentWebhookRoutes(app: SchoolappApi) {
  app.post("/webhooks/payments/stripe/:endpointId", async (c) => {
    const endpointId = c.req.param("endpointId");
    const runtime = paymentRuntime(c);
    const loaded = await loadStripeWebhookEndpoint(c.get("config").pools.app, endpointId, runtime);
    if (!loaded) {
      throw new AppError(404, "not_found", "Not found");
    }
    const rawBody = await c.req.text();
    const signature = c.req.header("stripe-signature") ?? null;
    let event: ProviderEvent;
    try {
      event = loaded.provider.verifyWebhook(rawBody, signature);
    } catch (error) {
      await recordOrganisationWebhookResult(c.get("config").pools.app, {
        configId: loaded.configId,
        eventType: "signature",
        ok: false,
        errorCode: "invalid_signature",
      });
      if (error instanceof AppError) throw error;
      throw new AppError(401, "unauthenticated", "Invalid provider signature");
    }
    return processVerifiedPaymentEvent(c, {
      provider: loaded.provider,
      event,
      expectedOrganisationId: loaded.organisationId,
      configId: loaded.configId,
      enabled: loaded.enabled,
    });
  });

  app.post("/webhooks/payments/:provider", async (c) => {
    const providerKey = c.req.param("provider");
    if (providerKey === "stripe") {
      throw new AppError(400, "validation_failed", "Use the school-specific Stripe webhook URL");
    }
    if (providerKey !== "fake") {
      throw new AppError(404, "not_found", "Not found");
    }
    const provider = paymentProviderOf(c);
    if (provider.key !== providerKey) {
      throw new AppError(400, "validation_failed", "Unknown payment provider");
    }
    const rawBody = await c.req.text();
    const signature = c.req.header("stripe-signature") ?? c.req.header("x-schoolapp-payment-signature") ?? null;
    let event: ProviderEvent;
    try {
      event = provider.verifyWebhook(rawBody, signature);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, "unauthenticated", "Invalid provider signature");
    }
    return processVerifiedPaymentEvent(c, { provider, event });
  });

  app.get("/payments/demo/checkout/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const provider = paymentProviderOf(c);
    requireFakeCheckoutToken(provider, sessionId, c.req.query("t"));
    const session = await c.get("config").pools.app.query<{
      amount_minor: string;
      currency: string;
      title: string;
      status: string;
      pupil_name: string;
    }>(
      `select amount_minor::text, currency, title, status, pupil_name
         from load_payment_demo_session($1)`,
      [sessionId],
    );
    if (!session.rows[0]) throw new AppError(404, "not_found", "Not found");
    const row = session.rows[0];
    return c.json({
      session: {
        id: sessionId,
        title: row.title,
        pupilName: row.pupil_name,
        amountMinor: Number(row.amount_minor),
        currency: row.currency,
        status: row.status,
      },
    });
  });

  app.post("/payments/demo/checkout/:sessionId/complete", async (c) => {
    const sessionId = c.req.param("sessionId");
    const parsed = (await c.req.json().catch(() => ({}))) as { outcome?: string; t?: string };
    const outcome = parsed.outcome ?? "succeeded";
    if (!["succeeded", "failed", "cancelled"].includes(outcome)) {
      throw new AppError(400, "validation_failed", "Invalid checkout outcome");
    }
    const provider = paymentProviderOf(c);
    requireFakeCheckoutToken(provider, sessionId, parsed.t ?? c.req.query("t"));
    const session = await c.get("config").pools.app.query<{
      organisation_id: string;
      provider_session_id: string;
      amount_minor: string;
      currency: string;
      charge_id: string | null;
      invoice_id: string | null;
    }>(
      `select organisation_id, provider_session_id, amount_minor::text, currency, charge_id, invoice_id
         from load_payment_demo_session($1)`,
      [sessionId],
    );
    if (!session.rows[0]) throw new AppError(404, "not_found", "Not found");
    const row = session.rows[0];
    const event = {
      providerKey: "fake" as const,
      eventId: `fake_evt_${sessionId}_${outcome}`,
      eventType: `demo.${outcome}`,
      providerSessionId: row.provider_session_id,
      providerPaymentId: outcome === "succeeded" ? `fake_pay_${sessionId.replace(/-/g, "")}` : null,
      providerRefundId: null,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      outcome: outcome as "succeeded" | "failed" | "cancelled",
    };
    const signature = "signEvent" in provider ? (provider as { signEvent: (e: typeof event) => string }).signEvent(event) : "";
    const res = await app.request("/api/v1/webhooks/payments/fake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Schoolapp-Payment-Signature": signature,
      },
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: { message: "Payment failed" } }));
      const message =
        body && typeof body === "object" && "error" in body
          ? String((body as { error?: { message?: string } }).error?.message ?? "Payment failed")
          : "Payment failed";
      throw new AppError(res.status, outcome === "succeeded" ? "payment_failed" : "payment_failed", message);
    }
    return c.json({ ok: true, outcome, chargeId: row.charge_id, invoiceId: row.invoice_id });
  });
}
