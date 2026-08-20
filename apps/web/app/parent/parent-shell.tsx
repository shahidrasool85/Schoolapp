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

const LINKS = [
  { href: "/parent", label: "Dashboard" },
  { href: "/parent/children", label: "My Children" },
  { href: "/parent/notifications", label: "Notifications" },
  { href: "/parent/account", label: "Account" },
];

export default function ParentShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [orgId, setOrg] = useState<string | null>(null);
  const [canOpenSchoolAdmin, setCanOpenSchoolAdmin] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api<{ memberships: Membership[] }>("/api/v1/me/memberships", { orgId: null })
      .then((body) => {
        const current = pickPortalMembership(body.memberships, "parent", getOrgId());
        if (!current) {
          const fallback = pickMembership(body.memberships, getOrgId());
          router.replace(fallback ? homePath(fallback.roleKeys) : "/login");
          return;
        }
        setMemberships(
          body.memberships.filter((m) => m.status === "active" && hasParentRole(m.roleKeys)),
        );
        setOrgId(current.organisationId);
        setOrg(current.organisationId);
        setCanOpenSchoolAdmin(
          body.memberships.some((m) => m.status === "active" && hasStaffRole(m.roleKeys)),
        );
        setReady(true);
      })
      .catch(() => {
        setError("Could not load your schools.");
        router.replace("/login");
      });
  }, [router]);

  function onOrgChange(event: FormEvent<HTMLSelectElement>) {
    const value = event.currentTarget.value;
    setOrgId(value);
    setOrg(value);
    window.location.assign("/parent");
  }

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST", orgId: null });
    setToken(null);
    setOrgId(null);
    router.replace("/login");
  }

  const current = memberships.find((m) => m.organisationId === orgId);

  return (
    <div className="shell portal-parent">
      <aside className="nav">
        <h1>Parent Portal</h1>
        <p className="muted" style={{ color: "#d6e4f5", margin: "0 0 1rem" }}>
          {current?.name ?? "Select a school"}
        </p>
        {memberships.length > 1 ? (
          <label>
            School
            <select value={orgId ?? ""} onChange={onOrgChange} style={{ marginBottom: 12 }}>
              {memberships.map((m) => (
                <option key={m.organisationId} value={m.organisationId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={
              link.href === "/parent"
                ? pathname === "/parent"
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
        {canOpenSchoolAdmin ? <Link href="/school">School Admin</Link> : null}
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
