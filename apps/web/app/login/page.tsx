"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setOrgId, setToken } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const body = await api<{ accessToken: string }>("/api/v1/auth/login", {
        method: "POST",
        orgId: null,
        body: JSON.stringify({ email, password }),
      });
      setToken(body.accessToken);
      const memberships = await api<{
        memberships: Array<{ organisationId: string; status: string }>;
      }>("/api/v1/me/memberships", { orgId: null });
      const first = memberships.memberships.find((m) => m.status === "active");
      if (first) setOrgId(first.organisationId);
      router.push("/school");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 480, margin: "4rem auto", padding: 16 }}>
      <h1>Sign in</h1>
      <form onSubmit={onSubmit} className="form-grid">
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <button type="submit">Sign in</button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
