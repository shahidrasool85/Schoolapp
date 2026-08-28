"use client";

import type { ReactNode } from "react";
import { resolveLoginBranding, type PublicLoginBranding } from "../../lib/login-branding";
import { loginShellMode, type LoginHostKind } from "../../lib/login-shell-mode";
import type { PublicTenant } from "../../lib/tenant";
import { LoginShell } from "./login-shell";

export function AccountLifecycleShell({
  initialHostKind,
  tenant,
  children,
}: {
  initialHostKind: LoginHostKind;
  tenant: PublicTenant | { kind: "unknown" } | null;
  children: ReactNode;
}) {
  const mode = loginShellMode(tenant, initialHostKind);
  const branding = resolveLoginBranding({
    organisationName: tenant?.kind === "school" ? tenant.organisation.name : null,
    hostname: tenant && "hostname" in tenant ? tenant.hostname : null,
    branding: tenant?.kind === "school" ? (tenant.organisation.branding as PublicLoginBranding | null) : null,
    fallbackName: mode === "platform" ? "Schoolapp" : "School portal",
  });

  if (mode === "loading") {
    return (
      <LoginShell mode="loading" branding={branding}>
        <h2 className="login-heading">Loading…</h2>
        <p className="login-lede muted">Checking this address…</p>
      </LoginShell>
    );
  }

  if (mode === "unknown") {
    return (
      <LoginShell mode="unknown" branding={branding}>
        <h2 className="login-heading">School not found</h2>
        <p className="login-lede muted">This address is not an active school on the platform.</p>
      </LoginShell>
    );
  }

  return (
    <LoginShell mode={mode} branding={branding}>
      {children}
    </LoginShell>
  );
}
