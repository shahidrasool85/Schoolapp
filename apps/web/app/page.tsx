"use client";

import { useEffect, useState } from "react";
import { loadPublicTenant, type PublicTenant } from "../lib/tenant";

export default function HomePage() {
  const [tenant, setTenant] = useState<PublicTenant | { kind: "unknown" } | null>(null);

  useEffect(() => {
    loadPublicTenant()
      .then(setTenant)
      .catch(() => setTenant({ kind: "unknown" }));
  }, []);

  if (tenant?.kind === "unknown") {
    return (
      <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "2rem auto", padding: 16 }}>
        <h1>School not found</h1>
        <p>This address is not an active school on the platform.</p>
      </main>
    );
  }

  if (tenant?.kind === "school") {
    return (
      <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "2rem auto", padding: 16 }}>
        <h1>{tenant.organisation.name}</h1>
        <p>Sign in to your school.</p>
        <ul>
          <li>
            <a href="/login">Sign in</a>
          </li>
        </ul>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "2rem auto", padding: 16 }}>
      <h1>Schoolapp</h1>
      <p>
        Multi-tenant school platform. Each school uses the same application on its own subdomain.
        This is the platform entry point.
      </p>
      <ul>
        <li>
          <a href="/login">Sign in</a>
        </li>
        <li>
          <a href="/school">School Admin</a>
        </li>
        <li>
          <a href="/parent">Parent Portal</a>
        </li>
        <li>
          <a href="/student">Student Portal</a>
        </li>
        <li>
          Health: <code>GET /api/v1/health</code>
        </li>
      </ul>
    </main>
  );
}
