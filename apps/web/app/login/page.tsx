"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setOrgId, setToken } from "../../lib/api";
import { homePath, pickMembership, type Membership } from "../../lib/portal";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"email" | "student">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organisationSlug, setOrganisationSlug] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const body = await api<{ accessToken: string }>("/api/v1/auth/login", {
        method: "POST",
        orgId: null,
        body: JSON.stringify(
          mode === "email"
            ? { email, password }
            : { organisationSlug, username, password },
        ),
      });
      setToken(body.accessToken);
      const memberships = await api<{ memberships: Membership[] }>("/api/v1/me/memberships", {
        orgId: null,
      });
      const current = pickMembership(memberships.memberships, null);
      if (!current) {
        setError("No active school membership was found for this account.");
        return;
      }
      setOrgId(current.organisationId);
      router.push(homePath(current.roleKeys));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 480, margin: "4rem auto", padding: 16 }}>
      <h1>Sign in</h1>
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={mode === "email" ? undefined : "secondary"}
          onClick={() => setMode("email")}
        >
          Staff or parent
        </button>
        <button
          type="button"
          className={mode === "student" ? undefined : "secondary"}
          onClick={() => setMode("student")}
        >
          Student
        </button>
      </div>
      <form onSubmit={onSubmit} className="form-grid">
        {mode === "email" ? (
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
        ) : (
          <>
            <label>
              School code
              <input
                value={organisationSlug}
                onChange={(e) => setOrganisationSlug(e.target.value)}
                required
                autoCapitalize="none"
              />
            </label>
            <label>
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoCapitalize="none"
              />
            </label>
          </>
        )}
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
