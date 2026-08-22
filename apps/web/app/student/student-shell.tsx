"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { api, getOrgId, getToken, setOrgId, setToken } from "../../lib/api";
import { homePath, hasStudentRole, pickMembership, pickPortalMembership, type Membership } from "../../lib/portal";
import { loadPublicTenant, membershipForHost } from "../../lib/tenant";

type NavLink = {
  href: string;
  label: string;
  exact?: boolean;
  children?: NavLink[];
};

const LINKS: NavLink[] = [
  { href: "/student", label: "Home", exact: true },
  { href: "/student/attendance", label: "Attendance" },
  {
    href: "/student/learning",
    label: "My Learning",
    exact: true,
    children: [
      { href: "/student/learning", label: "Assigned", exact: true },
      { href: "/student/learning/due", label: "Due" },
      { href: "/student/learning/submitted", label: "Submitted" },
      { href: "/student/learning/feedback", label: "Feedback" },
    ],
  },
  { href: "/student/notifications", label: "Notifications" },
  { href: "/student/profile", label: "Profile" },
];

function isActivePath(pathname: string, href: string, exact?: boolean, siblingHrefs: string[] = []): boolean {
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  if (siblingHrefs.some((sibling) => sibling !== href && (pathname === sibling || pathname.startsWith(`${sibling}/`)))) {
    return false;
  }
  return !exact || siblingHrefs.length > 0;
}

function isSectionOpen(pathname: string, link: NavLink): boolean {
  if (!link.children?.length) return false;
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}

export default function StudentShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [schoolName, setSchoolName] = useState("My school");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

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
        if (tenant.kind === "school") {
          const current = membershipForHost(body.memberships, tenant);
          if (!current || !hasStudentRole(current.roleKeys)) {
            router.replace(current ? homePath(current.roleKeys) : "/login");
            return;
          }
          setOrgId(current.organisationId);
          setSchoolName(current.name);
          setReady(true);
          return;
        }
        const current = pickPortalMembership(body.memberships, "student", getOrgId());
        if (!current) {
          const fallback = pickMembership(body.memberships, getOrgId());
          router.replace(fallback ? homePath(fallback.roleKeys) : "/login");
          return;
        }
        setOrgId(current.organisationId);
        setSchoolName(current.name);
        setReady(true);
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
        {LINKS.map((link) => {
          const children = link.children ?? [];
          const siblingHrefs = children.map((child) => child.href);
          const open = isSectionOpen(pathname, link);
          const childActive = children.some((child) =>
            isActivePath(pathname, child.href, child.exact, siblingHrefs),
          );
          const parentActive = isActivePath(pathname, link.href, link.exact) && !childActive;
          if (children.length === 0) {
            return (
              <Link key={link.href} href={link.href} className={parentActive ? "active" : undefined}>
                {link.label}
              </Link>
            );
          }
          return (
            <div key={link.href} className={`nav-group${open ? " open" : ""}`}>
              <Link
                href={link.href}
                className={`nav-parent${parentActive ? " active" : ""}${open && !parentActive ? " open" : ""}`}
              >
                {link.label}
              </Link>
              {open
                ? children.map((child) => (
                    <Link
                      key={child.href + child.label}
                      href={child.href}
                      className={`nav-child${isActivePath(pathname, child.href, child.exact, siblingHrefs) ? " active" : ""}`}
                    >
                      {child.label}
                    </Link>
                  ))
                : null}
            </div>
          );
        })}
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
