import { headers } from "next/headers";
import { loginHostKindFromRequest, type LoginHostKind } from "@schoolapp/core";

export type { LoginHostKind };

function runtimeEnv(name: string): string | undefined {
  return process.env[name];
}

/** Server-only: classify the incoming request the same way as /login. */
export async function readLoginHostKind(): Promise<LoginHostKind> {
  const headerStore = await headers();
  return loginHostKindFromRequest({
    host: headerStore.get("host"),
    forwardedHost: headerStore.get("x-forwarded-host"),
    trustProxy: runtimeEnv("TRUST_PROXY") === "true",
    platformDomain: runtimeEnv("PLATFORM_DOMAIN"),
  });
}
