import type { Hono } from "hono";
import type { DbPools } from "@schoolapp/db";
import type { FileScanner, ObjectStoragePort } from "@schoolapp/storage";
import type { PaymentProvider, PaymentRuntimeConfig } from "@schoolapp/core";

export type ApiConfig = {
  pools: DbPools;
  authSecret: string;
  tokenTtlSeconds: number;
  platformDomain: string;
  trustProxy: boolean;
  storage: ObjectStoragePort;
  fileScanner: FileScanner;
  payments?: PaymentRuntimeConfig;
  paymentProvider?: PaymentProvider;
};

export type ApiEnv = {
  Variables: {
    config: ApiConfig;
    accessToken: string | null;
    userId: string;
    sessionId: string;
    tenantHost: import("./tenant-resolver").ResolvedTenantHost;
  };
};

export type SchoolappApi = Hono<ApiEnv>;

declare module "hono" {
  interface ContextVariableMap {
    config: ApiConfig;
    accessToken: string | null;
    userId: string;
    sessionId: string;
    tenantHost: import("./tenant-resolver").ResolvedTenantHost;
  }
}
