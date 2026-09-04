import type { Context } from "hono";
import type pg from "pg";
import {
  createPaymentProvider,
  paymentConfigFromEnv,
  resolveOrganisationPaymentProvider,
  resolveOrganisationPaymentProviderForRefund,
  type PaymentProvider,
  type PaymentRuntimeConfig,
} from "@schoolapp/core";
import type { ApiEnv } from "./types";

export function paymentRuntime(c: Context<ApiEnv>): PaymentRuntimeConfig {
  return c.get("config").payments ?? paymentConfigFromEnv();
}

export function paymentProviderOf(c: Context<ApiEnv>): PaymentProvider {
  return c.get("config").paymentProvider ?? createPaymentProvider(paymentRuntime(c));
}

export async function organisationPaymentProviderOf(
  c: Context<ApiEnv>,
  client: pg.PoolClient,
  organisationId: string,
): Promise<PaymentProvider> {
  return resolveOrganisationPaymentProvider(client, organisationId, paymentRuntime(c));
}

export async function organisationRefundProviderOf(
  c: Context<ApiEnv>,
  client: pg.PoolClient,
  organisationId: string,
  transactionProviderKey: string,
): Promise<PaymentProvider> {
  return resolveOrganisationPaymentProviderForRefund(
    client,
    organisationId,
    paymentRuntime(c),
    transactionProviderKey,
  );
}

export function publicOriginFromRequest(c: Context<ApiEnv>): string {
  const host = c.req.header("x-forwarded-host") && c.get("config").trustProxy
    ? c.req.header("x-forwarded-host")
    : c.req.header("host");
  const proto = c.req.header("x-forwarded-proto") && c.get("config").trustProxy
    ? c.req.header("x-forwarded-proto")
    : "http";
  if (!host) return "";
  return `${proto}://${host}`;
}
