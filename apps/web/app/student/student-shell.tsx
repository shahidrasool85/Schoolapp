"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { api, getOrgId, getToken, setOrgId, setToken } from "../../lib/api";
import { hasStudentRole, homePath, pickMembership, type Membership } from "../../lib/portal";

const LINKS = [
  { href: "/student", label: "Home" },
  { href: "/student/learning", label: "My Learning" },
  { href: "/student/notifications", label: "Notifications" },
  { href: "/student/profile", label: "Profile" },
];

export default function StudentShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [schoolName, setSchoolName] = useState("My school");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api<{ memberships: Membership[] }>("/api/v1/me/memberships", { orgId: null })
      .then((body) => {
        const studentMemberships = body.memberships.filter(
          (m) => m.status === "active" && hasStudentRole(m.roleKeys),
        );
        const current = pickMembership(studentMemberships, getOrgId());
        if (!current) {
          const fallback = pickMembership(body.memberships, getOrgId());
          router.replace(fallback ? homePath(fallback.roleKeys) : "/login");
          return;
        }
        setOrgId(current.organisationId);
        setSchoolName(current.name);
      })
      .catch(() => {
        setError("Could not load your school.");
        router.replace("/login");
      });
  }, [router]);

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST", orgId: null });
    setToken(null);
    setOrgId(null);
    router.replace("/login");
  }

  return (
    <div className="shell portal-student">
      <aside className="nav">
        <h1>Student Portal</h1>
        <p className="muted" style={{ color: "#e7f7ef", margin: "0 0 1rem" }}>
          {schoolName}
        </p>
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={
              link.href === "/student"
                ? pathname === "/student"
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
        <div style={{ marginTop: "auto", paddingTop: 24 }}>
          <button className="secondary" type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        {error ? <p className="error">{error}</p> : children}
      </main>
    </div>
  );
}
