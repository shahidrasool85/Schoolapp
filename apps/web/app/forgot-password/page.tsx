"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { resolveLoginBranding, type PublicLoginBranding } from "../../lib/login-branding";
import { loadPublicTenant, type PublicTenant } from "../../lib/tenant";
import { LoginShell } from "../login/login-shell";

function ForgotForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [tenant, setTenant] = useState<PublicTenant | { kind: "unknown" } | null>(null);

  useEffect(() => {
    loadPublicTenant()
      .then(setTenant)
      .catch(() => setTenant({ kind: "unknown" }));
  }, []);

  const branding = resolveLoginBranding({
    organisationName: tenant?.kind === "school" ? tenant.organisation.name : null,
    hostname: tenant && "hostname" in tenant ? tenant.hostname : null,
    branding: tenant?.kind === "school" ? (tenant.organisation.branding as PublicLoginBranding | null) : null,
    fallbackName: "School portal",
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/v1/auth/forgot-password", {
        method: "POST",
        orgId: null,
        body: JSON.stringify({ email }),
      });
      setDone(true);
    } catch {
      setDone(true);
    }
  }

  return (
    <LoginShell mode={tenant?.kind === "school" ? "school" : "platform"} branding={branding}>
      <h2 className="login-heading">Forgot password</h2>
      <p className="login-lede muted">
        If an account exists, reset instructions have been generated.
      </p>
      {done ? (
        <p>If an account exists, reset instructions have been generated.</p>
      ) : (
        <form onSubmit={onSubmit} className="login-form">
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <button type="submit" className="login-submit">
            Send reset instructions
          </button>
        </form>
      )}
      <p className="login-support muted">
        <a href="/login">Back to sign in</a>
      </p>
      {error ? <p className="error">{error}</p> : null}
    </LoginShell>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <ForgotForm />
    </Suspense>
  );
}
