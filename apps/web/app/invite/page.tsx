"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { Suspense } from "react";

function InviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenFromUrl = useMemo(() => params.get("token") ?? "", [params]);
  const [token, setToken] = useState(tokenFromUrl);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

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
      setError(err instanceof Error ? err.message : "Could not accept invitation");
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 480, margin: "4rem auto", padding: 16 }}>
      <h1>Accept invitation</h1>
      <form onSubmit={onSubmit} className="form-grid">
        <label>
          Invitation token
          <input value={token} onChange={(e) => setToken(e.target.value)} required />
        </label>
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
          />
        </label>
        <button type="submit">Create account</button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <InviteForm />
    </Suspense>
  );
}
