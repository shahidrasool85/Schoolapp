"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { LoginHostKind } from "../../lib/login-shell-mode";
import { loadPublicTenant, type PublicTenant } from "../../lib/tenant";
import { AccountLifecycleShell } from "../login/account-lifecycle-shell";

function ForgotForm({ initialHostKind }: { initialHostKind: LoginHostKind }) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [tenant, setTenant] = useState<PublicTenant | { kind: "unknown" } | null>(null);

  useEffect(() => {
    loadPublicTenant()
      .then(setTenant)
      .catch(() => setTenant({ kind: "unknown" }));
  }, []);

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
    <AccountLifecycleShell initialHostKind={initialHostKind} tenant={tenant}>
      <h2 className="login-heading">Forgot password</h2>
      <p className="login-lede muted">If an account exists, reset instructions have been generated.</p>
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
    </AccountLifecycleShell>
  );
}

export function ForgotPasswordClient({ initialHostKind }: { initialHostKind: LoginHostKind }) {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <ForgotForm initialHostKind={initialHostKind} />
    </Suspense>
  );
}
