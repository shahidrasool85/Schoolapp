import { headers } from "next/headers";
import { loginHostKindFromRequest } from "@schoolapp/core";
import { LoginForm } from "./login-form";

function runtimeEnv(name: string): string | undefined {
  return process.env[name];
}

export default async function LoginPage() {
  const headerStore = await headers();
  const initialHostKind = loginHostKindFromRequest({
    host: headerStore.get("host"),
    forwardedHost: headerStore.get("x-forwarded-host"),
    trustProxy: runtimeEnv("TRUST_PROXY") === "true",
    platformDomain: runtimeEnv("PLATFORM_DOMAIN"),
  });
  return <LoginForm initialHostKind={initialHostKind} />;
}
