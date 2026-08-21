"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setOrgId, setToken } from "../../lib/api";
import {
  hasStudentRole,
  homePath,
  pickMembership,
  pickPortalMembership,
  type Membership,
} from "../../lib/portal";
import { loadPublicTenant, membershipForHost, type PublicTenant } from "../../lib/tenant";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"email" | "student">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organisationSlug, setOrganisationSlug] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [tenant, setTenant] = useState<PublicTenant | { kind: "unknown" } | null>(null);

  useEffect(() => {
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
    try {
      const body = await api<{
        accessToken: string;
        organisationId: string | null;
        hostOrganisation: { id: string; slug: string; name: string } | null;
      }>("/api/v1/auth/login", {
        method: "POST",
        orgId: null,
        body: JSON.stringify(
          mode === "email"
            ? { email, password }
            : {
                organisationSlug: tenant?.kind === "school" ? tenant.organisation.slug : organisationSlug,
                username,
                password,
              },
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
        if (mode === "student" && !hasStudentRole(current.roleKeys)) {
          setError("This account cannot use the student portal at this school.");
          setOrgId(null);
          return;
        }
        setOrgId(current.organisationId);
        router.push(mode === "student" ? "/student" : homePath(current.roleKeys));
        return;
      }
      if (me.isPlatformAdmin) {
        setOrgId(null);
        router.push("/platform");
        return;
      }
      const current =
        mode === "student"
          ? pickPortalMembership(memberships.memberships, "student", body.organisationId) ??
            memberships.memberships.find(
              (m) =>
                m.status === "active" &&
                m.slug === organisationSlug &&
                hasStudentRole(m.roleKeys),
            ) ??
            null
          : pickMembership(memberships.memberships, body.organisationId);
      if (!current) {
        setError("No active school membership was found for this account.");
        return;
      }
      setOrgId(current.organisationId);
      router.push(mode === "student" ? "/student" : homePath(current.roleKeys));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    }
  }

  const schoolName = tenant?.kind === "school" ? tenant.organisation.name : null;

  if (tenant?.kind === "unknown") {
    return (
      <main style={{ fontFamily: "system-ui", maxWidth: 480, margin: "4rem auto", padding: 16 }}>
        <h1>School not found</h1>
        <p className="muted">This address is not an active school on the platform.</p>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 480, margin: "4rem auto", padding: 16 }}>
      <h1>{schoolName ?? "Sign in"}</h1>
      {schoolName ? <p className="muted">Sign in to your school</p> : null}
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
            {tenant?.kind === "school" ? null : (
              <label>
                School code
                <input
                  value={organisationSlug}
                  onChange={(e) => setOrganisationSlug(e.target.value)}
                  required
                  autoCapitalize="none"
                />
              </label>
            )}
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
