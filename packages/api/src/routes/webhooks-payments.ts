import { AppError, settleProviderEvent, type PaymentProvider } from "@schoolapp/core";
import { withTenantContext } from "@schoolapp/db";
import type { SchoolappApi } from "../types";
import { paymentProviderOf } from "../payments-context";

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

export function registerPaymentWebhookRoutes(app: SchoolappApi) {
  app.post("/webhooks/payments/:provider", async (c) => {
    const providerKey = c.req.param("provider");
    if (providerKey !== "fake" && providerKey !== "stripe") {
      throw new AppError(404, "not_found", "Not found");
    }
    const provider = paymentProviderOf(c);
    if (provider.key !== providerKey) {
      throw new AppError(400, "validation_failed", "Unknown payment provider");
    }
    const rawBody = await c.req.text();
    const signature = c.req.header("stripe-signature") ?? c.req.header("x-schoolapp-payment-signature") ?? null;
    let event;
    try {
      event = provider.verifyWebhook(rawBody, signature);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, "unauthenticated", "Invalid provider signature");
    }
    if (!event.eventId) {
      throw new AppError(400, "validation_failed", "Invalid provider event");
    }

    const pools = c.get("config").pools;
    const resolved = event.providerSessionId
      ? await pools.app.query(
          `select organisation_id, session_id, charge_id, transaction_id, context_user_id,
                  amount_minor, currency, session_status
             from resolve_payment_provider_session($1, $2)`,
          [provider.key, event.providerSessionId],
        )
      : event.providerPaymentId
        ? await pools.app.query(
            `select organisation_id, null::uuid as session_id, charge_id, transaction_id, context_user_id,
                    amount_minor, currency, null::text as session_status
               from resolve_payment_provider_payment($1, $2)`,
            [provider.key, event.providerPaymentId],
          )
        : { rows: [] as Array<Record<string, unknown>> };

    if (!resolved.rows[0]) {
      throw new AppError(400, "unknown_reference", "Unknown payment reference");
    }
    const row = resolved.rows[0] as {
      organisation_id: string;
      session_id: string | null;
      charge_id: string;
      transaction_id: string;
      context_user_id: string;
      amount_minor: string;
      currency: string;
    };

    const claimed = await pools.app.query<{
      event_row_id: string;
      already_processed: boolean;
      current_status: string;
    }>(
      `select event_row_id, already_processed, current_status
         from claim_payment_provider_event($1,$2,$3,$4,$5,$6)`,
      [provider.key, event.eventId, event.eventType, row.organisation_id, row.charge_id, row.transaction_id],
    );
    if (claimed.rows[0]?.already_processed) {
      return c.json({ ok: true, replayed: true });
    }
    const eventRowId = claimed.rows[0]!.event_row_id;

    try {
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
      });
      await pools.app.query("select finish_payment_provider_event($1, 'processed')", [eventRowId]);
      return c.json({ ok: true });
    } catch (error) {
      const code = error instanceof AppError ? error.code : "processing_failed";
      await pools.app.query("select finish_payment_provider_event($1, 'failed', $2)", [eventRowId, code]);
      if (error instanceof AppError) throw error;
      throw new AppError(400, "validation_failed", "The payment event could not be processed");
    }
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
      charge_id: string;
    }>(
      `select organisation_id, provider_session_id, amount_minor::text, currency, charge_id
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
    return c.json({ ok: true, outcome, chargeId: row.charge_id });
  });
}
