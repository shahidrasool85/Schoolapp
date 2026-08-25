import type { Context } from "hono";
import {
  createPaymentProvider,
  paymentConfigFromEnv,
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
