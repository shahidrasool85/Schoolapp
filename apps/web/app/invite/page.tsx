"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { resolveLoginBranding, type PublicLoginBranding } from "../../lib/login-branding";
import { loadPublicTenant, type PublicTenant } from "../../lib/tenant";
import { LoginShell } from "../login/login-shell";

function InviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenFromUrl = useMemo(() => params.get("token") ?? "", [params]);
  const [token, setToken] = useState(tokenFromUrl);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [tenant, setTenant] = useState<PublicTenant | { kind: "unknown" } | null>(null);

  useEffect(() => {
    setToken(tokenFromUrl);
  }, [tokenFromUrl]);

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
      await api("/api/v1/invitations/accept", {
        method: "POST",
        orgId: null,
        body: JSON.stringify({ token, fullName, password }),
      });
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "This link is invalid or has expired");
    }
  }

  return (
    <LoginShell mode={tenant?.kind === "school" ? "school" : "platform"} branding={branding}>
      <h2 className="login-heading">Accept invitation</h2>
      <p className="login-lede muted">Create your password to join this school.</p>
      <form onSubmit={onSubmit} className="login-form">
        {!tokenFromUrl ? (
          <label>
            Invitation token
            <input value={token} onChange={(e) => setToken(e.target.value)} required />
          </label>
        ) : null}
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
            autoComplete="new-password"
          />
        </label>
        <button type="submit" className="login-submit">
          Create account
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </LoginShell>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <InviteForm />
    </Suspense>
  );
}
