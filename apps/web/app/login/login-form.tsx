"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setOrgId, setToken } from "../../lib/api";
import { resolveLoginBranding, type PublicLoginBranding } from "../../lib/login-branding";
import {
  hasParentRole,
  hasStaffRole,
  hasStudentRole,
  type Membership,
} from "../../lib/portal";
import { loadPublicTenant, membershipForHost, type PublicTenant } from "../../lib/tenant";
import { EyeIcon, EyeOffIcon, ParentIcon, StaffIcon, StudentIcon } from "./login-icons";
import { LoginShell } from "./login-shell";

type LoginHostKind = "platform" | "school" | "unknown";

type SchoolPersona = "staff" | "parent" | "student";

const PERSONAS: Array<{
  value: SchoolPersona;
  label: string;
  Icon: typeof StaffIcon;
}> = [
  { value: "staff", label: "Staff", Icon: StaffIcon },
  { value: "parent", label: "Parent", Icon: ParentIcon },
  { value: "student", label: "Student", Icon: StudentIcon },
];

function tenantBranding(tenant: PublicTenant | { kind: "unknown" } | null): PublicLoginBranding | null {
  if (tenant?.kind !== "school") return null;
  return tenant.organisation.branding ?? null;
}

export function LoginForm({ initialHostKind }: { initialHostKind: LoginHostKind }) {
  const router = useRouter();
  const passwordId = useId();
  const [persona, setPersona] = useState<SchoolPersona>("staff");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  const awaitingSchoolTenant = initialHostKind === "school" && tenant === null;
  const unknownHost =
    tenant?.kind === "unknown" || (tenant === null && initialHostKind === "unknown");
  const schoolHost = tenant?.kind === "school" || awaitingSchoolTenant;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (awaitingSchoolTenant) {
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

  const branding = resolveLoginBranding({
    organisationName: tenant?.kind === "school" ? tenant.organisation.name : null,
    hostname: tenant && "hostname" in tenant ? tenant.hostname : null,
    branding: tenantBranding(tenant),
    fallbackName: schoolHost ? "School portal" : "LuvLearn",
  });

  if (awaitingSchoolTenant) {
    return (
      <LoginShell mode="loading" branding={branding}>
        <h2 className="login-heading">Sign in</h2>
        <p className="login-lede muted">Loading school sign-in…</p>
      </LoginShell>
    );
  }

  if (unknownHost) {
    return (
      <LoginShell mode="unknown" branding={branding}>
        <h2 className="login-heading">School not found</h2>
        <p className="login-lede muted">This address is not an active school on the platform.</p>
      </LoginShell>
    );
  }

  if (tenant?.kind !== "school") {
    return (
      <LoginShell mode="platform" branding={branding}>
        <h2 className="login-heading">Platform sign in</h2>
        <p className="login-lede muted">
          LuvLearn Platform Administration. Platform administrators sign in here. School staff,
          parents and students use their school address.
        </p>
        <form onSubmit={onSubmit} className="login-form">
          <EmailField value={email} onChange={setEmail} />
          <PasswordField
            id={`${passwordId}-platform`}
            value={password}
            onChange={setPassword}
            showPassword={showPassword}
            onToggle={() => setShowPassword((value) => !value)}
          />
          <button type="submit" className="login-submit">
            Sign in
          </button>
          <p className="login-support muted">
            <a href="/forgot-password">Forgot password?</a>
          </p>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </LoginShell>
    );
  }

  return (
    <LoginShell mode="school" branding={branding}>
      <h2 className="login-heading">Welcome Back</h2>
      <p className="login-lede muted">Please sign in to access your school portal.</p>
      <fieldset className="login-personas">
        <legend className="login-personas-legend">Select your portal</legend>
        <div className="login-persona-grid" role="tablist" aria-label="Select your portal">
          {PERSONAS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={persona === value}
              className={persona === value ? "login-persona is-active" : "login-persona"}
              onClick={() => setPersona(value)}
            >
              <Icon className="login-persona-icon" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <form onSubmit={onSubmit} className="login-form">
        {persona === "student" ? (
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoCapitalize="none"
              autoComplete="username"
            />
          </label>
        ) : (
          <EmailField value={email} onChange={setEmail} />
        )}
        <PasswordField
          id={`${passwordId}-school`}
          value={password}
          onChange={setPassword}
          showPassword={showPassword}
          onToggle={() => setShowPassword((value) => !value)}
        />
        <button type="submit" className="login-submit">
          Sign in
        </button>
        {persona !== "student" ? (
          <p className="login-support muted">
            <a href="/forgot-password">Forgot password?</a>
          </p>
        ) : null}
      </form>
      {persona === "staff" ? (
        <p className="login-support muted">
          Staff includes school administrators, the headteacher, teachers and other authorised
          staff. Your access is determined automatically after sign-in.
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </LoginShell>
  );
}

function EmailField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label>
      Email address
      <input
        type="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        autoComplete="email"
      />
    </label>
  );
}

function PasswordField({
  id,
  value,
  onChange,
  showPassword,
  onToggle,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  showPassword: boolean;
  onToggle: () => void;
}) {
  return (
    <label htmlFor={id}>
      Password
      <span className="login-password-wrap">
        <input
          id={id}
          type={showPassword ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={8}
          autoComplete="current-password"
        />
        <button
          type="button"
          className="login-password-toggle"
          onClick={onToggle}
          aria-label={showPassword ? "Hide password" : "Show password"}
          aria-pressed={showPassword}
        >
          {showPassword ? <EyeOffIcon className="login-password-icon" /> : <EyeIcon className="login-password-icon" />}
        </button>
      </span>
    </label>
  );
}
