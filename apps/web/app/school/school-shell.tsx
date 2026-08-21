"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { api, getOrgId, getToken, setOrgId, setToken } from "../../lib/api";
import {
  hasParentRole,
  hasStaffRole,
  homePath,
  pickMembership,
  pickPortalMembership,
  type Membership,
} from "../../lib/portal";
import { loadPublicTenant, membershipForHost, switchSchoolLocation } from "../../lib/tenant";

const LINKS = [
  { href: "/school", label: "Dashboard" },
  { href: "/school/admissions", label: "Admissions", permissionPrefix: "admissions." },
  { href: "/school/admissions/enquiries", label: "Enquiries", permissionPrefix: "admissions." },
  { href: "/school/admissions/applications", label: "Applications", permissionPrefix: "admissions." },
  { href: "/school/admissions/assessments", label: "Assessments", permissionPrefix: "admissions." },
  { href: "/school/admissions/waiting-list", label: "Waiting list", permissionPrefix: "admissions." },
  { href: "/school/admissions/offers", label: "Offers", permissionPrefix: "admissions." },
  { href: "/school/students", label: "Students" },
  { href: "/school/staff", label: "Staff / Teachers" },
  { href: "/school/parents", label: "Parents / Guardians" },
  { href: "/school/academic-years", label: "Academic Years" },
  { href: "/school/year-groups", label: "Year Groups" },
  { href: "/school/classes", label: "Classes" },
  { href: "/school/subjects", label: "Subjects" },
];

export default function SchoolShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [orgId, setOrg] = useState<string | null>(null);
  const [canOpenParentPortal, setCanOpenParentPortal] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [platformDomain, setPlatformDomain] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([
      loadPublicTenant(),
      api<{ memberships: Membership[] }>("/api/v1/me/memberships", { orgId: null }),
    ])
      .then(([tenant, body]) => {
        if (tenant.kind === "unknown") {
          setError("This school is not available.");
          return;
        }
        setPlatformDomain(tenant.platformDomain);
        const active = body.memberships.filter((m) => m.status === "active");
        if (tenant.kind === "school") {
          const current = membershipForHost(active, tenant);
          if (!current || !hasStaffRole(current.roleKeys)) {
            const fallback = current ? homePath(current.roleKeys) : "/login";
            if (fallback !== "/school") {
              router.replace(fallback);
              return;
            }
            setError("You do not have access to this school.");
            return;
          }
          setMemberships(active.filter((m) => hasStaffRole(m.roleKeys)));
          setOrgId(current.organisationId);
          setOrg(current.organisationId);
          setCanOpenParentPortal(hasParentRole(current.roleKeys));
          return api<{ permissions: string[] }>("/api/v1/me", { orgId: current.organisationId });
        }
        const current = pickPortalMembership(active, "staff", getOrgId());
        if (!current) {
          const fallback = pickMembership(active, getOrgId());
          router.replace(fallback ? homePath(fallback.roleKeys) : "/login");
          return;
        }
        setMemberships(active.filter((m) => hasStaffRole(m.roleKeys)));
        setOrgId(current.organisationId);
        setOrg(current.organisationId);
        setCanOpenParentPortal(active.some((m) => hasParentRole(m.roleKeys)));
        return api<{ permissions: string[] }>("/api/v1/me");
      })
      .then((me) => {
        if (!me) return;
        setPermissions(me.permissions ?? []);
        setReady(true);
      })
      .catch((err: Error) => {
        setError(err.message);
        if (err instanceof Error) router.replace("/login");
      });
  }, [router]);

  async function onOrgChange(event: FormEvent<HTMLSelectElement>) {
    const value = event.currentTarget.value;
    const selected = memberships.find((m) => m.organisationId === value);
    if (platformDomain && selected) {
      switchSchoolLocation(selected.slug, platformDomain, "/school");
      return;
    }
    setOrgId(value);
    setOrg(value);
    window.location.reload();
  }

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST", orgId: null });
    setToken(null);
    setOrgId(null);
    router.replace("/login");
  }

  const current = memberships.find((m) => m.organisationId === orgId);

  return (
    <div className="shell">
      <aside className="nav">
        <h1>School Admin</h1>
        <p className="muted" style={{ color: "#d6e4f5", margin: "0 0 1rem" }}>
          {current?.name ?? "Select a school"}
        </p>
        {memberships.length > 1 ? (
          <select value={orgId ?? ""} onChange={onOrgChange} style={{ marginBottom: 12 }}>
            {memberships.map((m) => (
              <option key={m.organisationId} value={m.organisationId}>
                {m.name}
              </option>
            ))}
          </select>
        ) : null}
        {LINKS.filter((link) => {
          if (!link.permissionPrefix) return true;
          return permissions.some((key) => key.startsWith(link.permissionPrefix!));
        }).map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={
              link.href === "/school"
                ? pathname === "/school"
                  ? "active"
                  : undefined
                : pathname === link.href || pathname.startsWith(`${link.href}/`)
                  ? "active"
                  : undefined
            }
          >
            {link.label}
          </Link>
        ))}
        {canOpenParentPortal ? <Link href="/parent">Parent Portal</Link> : null}
        <div style={{ marginTop: "auto", paddingTop: 24 }}>
          <button className="secondary" type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        {error ? <p className="error">{error}</p> : ready ? children : <p>Loading…</p>}
      </main>
    </div>
  );
}
