"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import type { LoginHostKind } from "../../lib/login-shell-mode";
import { loadPublicTenant, type PublicTenant } from "../../lib/tenant";
import { AccountLifecycleShell } from "../login/account-lifecycle-shell";

function ResetForm({ initialHostKind }: { initialHostKind: LoginHostKind }) {
  const router = useRouter();
  const params = useSearchParams();
  const token = useMemo(() => params.get("token") ?? "", [params]);
  const [password, setPassword] = useState("");
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
      await api("/api/v1/auth/reset-password", {
        method: "POST",
        orgId: null,
        body: JSON.stringify({ token, password }),
      });
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "This link is invalid or has expired");
    }
  }

  return (
    <AccountLifecycleShell initialHostKind={initialHostKind} tenant={tenant}>
      <h2 className="login-heading">Set a new password</h2>
      <p className="login-lede muted">Choose a password of at least 10 characters.</p>
      <form onSubmit={onSubmit} className="login-form">
        <label>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
            autoComplete="new-password"
          />
        </label>
        <button type="submit" className="login-submit" disabled={!token}>
          Save password
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </AccountLifecycleShell>
  );
}

export function ResetPasswordClient({ initialHostKind }: { initialHostKind: LoginHostKind }) {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <ResetForm initialHostKind={initialHostKind} />
    </Suspense>
  );
}
