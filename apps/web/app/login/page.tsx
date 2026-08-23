"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setOrgId, setToken } from "../../lib/api";
import {
  hasParentRole,
  hasStaffRole,
  hasStudentRole,
  type Membership,
} from "../../lib/portal";
import { loadPublicTenant, membershipForHost, type PublicTenant } from "../../lib/tenant";

type SchoolPersona = "staff" | "parent" | "student";

export default function LoginPage() {
  const router = useRouter();
  const [persona, setPersona] = useState<SchoolPersona>("staff");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organisationSlug, setOrganisationSlug] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [tenant, setTenant] = useState<PublicTenant | { kind: "unknown" } | null>(null);
  const [schoolHost, setSchoolHost] = useState(false);

  useEffect(() => {
    const host = window.location.hostname;
    setSchoolHost(host !== "localhost" && host !== "127.0.0.1");
    loadPublicTenant()
      .then((value) => {
        setTenant(value);
        if (value.kind === "school") {
          setOrganisationSlug(value.organisation.slug);
        }
      })
      .catch(() => setTenant({ kind: "unknown" }));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (schoolHost && tenant?.kind !== "school") {
      setError("School sign-in is still loading. Please try again.");
      return;
    }
    try {
      const body = await api<{
        accessToken: string;
        organisationId: string | null;
        hostOrganisation: { id: string; slug: string; name: string } | null;
      }>("/api/v1/auth/login", {
        method: "POST",
        orgId: null,
        body: JSON.stringify(
          persona === "student"
            ? {
                organisationSlug: tenant?.kind === "school" ? tenant.organisation.slug : organisationSlug,
                username,
                password,
              }
            : { email, password },
        ),
      });
      setToken(body.accessToken);
      const me = await api<{ isPlatformAdmin: boolean }>("/api/v1/me", { orgId: null });
      const memberships = await api<{ memberships: Membership[] }>("/api/v1/me/memberships", {
        orgId: null,
      });
      if (tenant?.kind === "school") {
        const current = membershipForHost(memberships.memberships, tenant);
        if (!current) {
          setError("You do not have access to this school.");
          setOrgId(null);
          return;
        }
        if (persona === "staff" && !hasStaffRole(current.roleKeys)) {
          setError("This account cannot use staff sign-in at this school.");
          setOrgId(null);
          return;
        }
        if (persona === "parent" && !hasParentRole(current.roleKeys)) {
          setError("This account cannot use the parent portal at this school.");
          setOrgId(null);
          return;
        }
        if (persona === "student" && !hasStudentRole(current.roleKeys)) {
          setError("This account cannot use the student portal at this school.");
          setOrgId(null);
          return;
        }
        setOrgId(current.organisationId);
        router.push(persona === "staff" ? "/school" : persona === "parent" ? "/parent" : "/student");
        return;
      }
      if (me.isPlatformAdmin) {
        setOrgId(null);
        router.push("/platform");
        return;
      }
      setError("Use your school address to sign in as staff, a parent or a student.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    }
  }

  const schoolName = tenant?.kind === "school" ? tenant.organisation.name : null;

  if (schoolHost && !tenant) {
    return (
      <main style={{ fontFamily: "system-ui", maxWidth: 480, margin: "4rem auto", padding: 16 }}>
        <h1>Sign in</h1>
        <p className="muted">Loading school sign-in…</p>
      </main>
    );
  }

  if (tenant?.kind === "unknown") {
    return (
      <main style={{ fontFamily: "system-ui", maxWidth: 480, margin: "4rem auto", padding: 16 }}>
        <h1>School not found</h1>
        <p className="muted">This address is not an active school on the platform.</p>
      </main>
    );
  }

  if (tenant?.kind !== "school") {
    return (
      <main style={{ fontFamily: "system-ui", maxWidth: 480, margin: "4rem auto", padding: 16 }}>
        <h1>Platform sign in</h1>
        <p className="muted">Platform administrators sign in here. School staff, parents and students use their school address.</p>
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

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 480, margin: "4rem auto", padding: 16 }}>
      <h1>{schoolName}</h1>
      <p className="muted">Sign in to your school</p>
      <div className="toolbar" style={{ marginBottom: 16 }}>
        {(["staff", "parent", "student"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={persona === value ? undefined : "secondary"}
            onClick={() => setPersona(value)}
          >
            {value === "staff" ? "Staff" : value === "parent" ? "Parent" : "Student"}
          </button>
        ))}
      </div>
      <form onSubmit={onSubmit} className="form-grid">
        {persona === "student" ? (
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoCapitalize="none"
            />
          </label>
        ) : (
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
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
      {persona === "staff" ? (
        <p className="muted">Staff includes school administrators, the headteacher, teachers and other authorised staff. Your role is applied after you sign in.</p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
