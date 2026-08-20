"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json();
    setResult(JSON.stringify(body, null, 2));
    if (response.ok && body.accessToken) {
      const me = await fetch("/api/v1/me", {
        headers: { Authorization: `Bearer ${body.accessToken}` },
      });
      const memberships = await fetch("/api/v1/me/memberships", {
        headers: { Authorization: `Bearer ${body.accessToken}` },
      });
      setResult(
        JSON.stringify(
          { login: body, me: await me.json(), memberships: await memberships.json() },
          null,
          2,
        ),
      );
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 640, margin: "2rem auto", padding: 16 }}>
      <h1>Sign in</h1>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ display: "block", width: "100%" }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            style={{ display: "block", width: "100%" }}
          />
        </label>
        <button type="submit">Sign in</button>
      </form>
      {result ? <pre>{result}</pre> : null}
    </main>
  );
}
