import type { Hono } from "hono";
import type { DbPools } from "@schoolapp/db";

export type ApiConfig = {
  pools: DbPools;
  authSecret: string;
  tokenTtlSeconds: number;
};

export type ApiEnv = {
  Variables: {
    config: ApiConfig;
    accessToken: string | null;
    userId: string;
    sessionId: string;
  };
};

export type SchoolappApi = Hono<ApiEnv>;

declare module "hono" {
  interface ContextVariableMap {
    config: ApiConfig;
    accessToken: string | null;
    userId: string;
    sessionId: string;
  }
}
