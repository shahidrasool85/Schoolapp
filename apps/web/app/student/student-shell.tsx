"use client";

import { useRouter } from "next/navigation";
import { ReactNode, Suspense, useEffect, useState } from "react";
import { loginHrefForReturn } from "@schoolapp/domain";
import { AppShell } from "../../components/app-shell";
import { api, getOrgId, getToken, setOrgId, setToken } from "../../lib/api";
import { resolveLoginBranding } from "../../lib/login-branding";
import { homePath, hasStudentRole, pickMembership, pickPortalMembership, type Membership } from "../../lib/portal";
import { loadPublicTenant, membershipForHost } from "../../lib/tenant";

const LINKS = [
  { href: "/student", label: "Home", icon: "home" as const, exact: true },
  { href: "/student/timetable", label: "My Timetable", icon: "calendar" as const },
  { href: "/student/attendance", label: "Attendance", icon: "check" as const },
  {
    href: "/student/learning",
    label: "My Learning",
    icon: "book" as const,
    exact: true,
    children: [
      { href: "/student/learning", label: "Assigned", exact: true },
      { href: "/student/learning/due", label: "Due" },
      { href: "/student/learning/submitted", label: "Submitted" },
      { href: "/student/learning/feedback", label: "Feedback" },
    ],
  },
  { href: "/student/play", label: "Play & learn", icon: "book" as const },
  { href: "/student/rewards", label: "Rewards", icon: "flag" as const },
  { href: "/student/competitions", label: "Competitions", icon: "chart" as const },
  { href: "/student/results", label: "Results", icon: "chart" as const },
  { href: "/student/reports", label: "Reports", icon: "clipboard" as const },
  { href: "/student/notices", label: "Notices", icon: "megaphone" as const },
  { href: "/student/calendar", label: "Calendar", icon: "flag" as const },
  { href: "/student/activities", label: "Activities", icon: "flag" as const },
  { href: "/student/notifications", label: "Notifications", icon: "bell" as const },
  { href: "/student/profile", label: "Profile", icon: "users" as const },
];

function StudentShellInner({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [schoolName, setSchoolName] = useState("My school");
  const [userName, setUserName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [unreadNotifications, setUnreadNotifications] = useState<number | null>(null);
  const [financeEnabled, setFinanceEnabled] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace(loginHrefForReturn(`${window.location.pathname}${window.location.search}`, "student"));
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
          const branding = resolveLoginBranding({
            organisationName: tenant.organisation.name,
            hostname: tenant.hostname,
            branding: tenant.organisation.branding,
          });
          setLogoUrl(branding.logoUrl);
          document.documentElement.style.setProperty("--sidebar", branding.primaryColor);
          document.documentElement.style.setProperty("--navy", branding.primaryColor);
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
      .then(async () => {
        const me = await api<{ user: { fullName: string } }>("/api/v1/me").catch(() => null);
        const notifications = await api<{ unreadCount: number }>("/api/v1/notifications").catch(() => null);
        setUserName(me?.user.fullName ?? null);
        setUnreadNotifications(notifications?.unreadCount ?? null);
        const finance = await api<{ enabled?: boolean }>("/api/v1/student/finance").catch(() => null);
        setFinanceEnabled(Boolean(finance?.enabled));
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
    <AppShell
      variant="student"
      schoolName={schoolName}
      personaLabel="Student"
      userName={userName}
      logoUrl={logoUrl}
      sections={[
        {
          id: "student",
          items: [
            ...LINKS.map((link) =>
              link.href === "/student/notifications"
                ? { ...link, count: unreadNotifications && unreadNotifications > 0 ? unreadNotifications : null }
                : link,
            ),
            ...(financeEnabled
              ? [{ href: "/student/finance", label: "My fees", icon: "card" as const }]
              : []),
          ],
        },
      ]}
      unreadNotifications={unreadNotifications}
      notificationsHref="/student/notifications"
      onLogout={logout}
      ready={ready}
      error={error}
    >
      {children}
    </AppShell>
  );
}

export default function StudentShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p className="content">Loading…</p>}>
      <StudentShellInner>{children}</StudentShellInner>
    </Suspense>
  );
}
