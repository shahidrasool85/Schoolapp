"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode, Suspense, useEffect, useState } from "react";
import { loginHrefForReturn } from "@schoolapp/domain";
import { AppShell } from "../../components/app-shell";
import { api, getOrgId, getToken, setOrgId, setToken } from "../../lib/api";
import { resolveLoginBranding } from "../../lib/login-branding";
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
  { href: "/parent", label: "Dashboard", icon: "home" as const, exact: true },
  { href: "/parent/children", label: "My Children", icon: "users" as const },
  { href: "/parent/notices", label: "Notices", icon: "megaphone" as const },
  { href: "/parent/messages", label: "Messages", icon: "mail" as const },
  { href: "/parent/calendar", label: "Calendar", icon: "calendar" as const },
  { href: "/parent/activities", label: "Activities", icon: "flag" as const },
  { href: "/parent/finance", label: "Finance", icon: "card" as const },
  { href: "/parent/payments", label: "Other payments", icon: "card" as const },
  { href: "/parent/notifications", label: "Notifications", icon: "bell" as const },
  { href: "/parent/account", label: "Account", icon: "briefcase" as const },
];

function ParentShellInner({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [orgId, setOrg] = useState<string | null>(null);
  const [canOpenSchoolAdmin, setCanOpenSchoolAdmin] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [platformDomain, setPlatformDomain] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [unreadMessages, setUnreadMessages] = useState<number | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState<number | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace(loginHrefForReturn(`${window.location.pathname}${window.location.search}`, "parent"));
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
          if (!current || !hasParentRole(current.roleKeys)) {
            router.replace(current ? homePath(current.roleKeys) : "/login");
            return;
          }
          setMemberships(body.memberships.filter((m) => m.status === "active" && hasParentRole(m.roleKeys)));
          setOrgId(current.organisationId);
          setOrg(current.organisationId);
          setCanOpenSchoolAdmin(hasStaffRole(current.roleKeys));
          setReady(true);
          return;
        }
        const current = pickPortalMembership(body.memberships, "parent", getOrgId());
        if (!current) {
          const fallback = pickMembership(body.memberships, getOrgId());
          router.replace(fallback ? homePath(fallback.roleKeys) : "/login");
          return;
        }
        setMemberships(body.memberships.filter((m) => m.status === "active" && hasParentRole(m.roleKeys)));
        setOrgId(current.organisationId);
        setOrg(current.organisationId);
        setCanOpenSchoolAdmin(body.memberships.some((m) => m.status === "active" && hasStaffRole(m.roleKeys)));
        setReady(true);
      })
      .then(async () => {
        const me = await api<{ user: { fullName: string } }>("/api/v1/me").catch(() => null);
        const messages = await api<{ unreadCount: number }>("/api/v1/messages/unread-count").catch(() => null);
        const notifications = await api<{ unreadCount: number }>("/api/v1/notifications").catch(() => null);
        setUserName(me?.user.fullName ?? null);
        setUnreadMessages(messages?.unreadCount ?? null);
        setUnreadNotifications(notifications?.unreadCount ?? null);
      })
      .catch(() => {
        setError("Could not load your schools.");
        router.replace("/login");
      });
  }, [router]);

  function onOrgChange(value: string) {
    const selected = memberships.find((m) => m.organisationId === value);
    if (platformDomain && selected) {
      switchSchoolLocation(selected.slug, platformDomain, "/parent");
      return;
    }
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
  const sections = [
    {
      id: "parent",
      items: LINKS.map((link) =>
        link.href === "/parent/messages"
          ? { ...link, count: unreadMessages && unreadMessages > 0 ? unreadMessages : null }
          : link.href === "/parent/notifications"
            ? { ...link, count: unreadNotifications && unreadNotifications > 0 ? unreadNotifications : null }
            : link,
      ),
    },
  ];

  return (
    <AppShell
      variant="parent"
      schoolName={current?.name ?? "School"}
      personaLabel="Parent"
      userName={userName}
      logoUrl={logoUrl}
      schoolOptions={memberships.map((m) => ({ id: m.organisationId, name: m.name }))}
      selectedSchoolId={orgId}
      onSchoolChange={onOrgChange}
      sections={sections}
      extraNav={canOpenSchoolAdmin ? <Link href="/school" className="app-nav-link">School Admin</Link> : null}
      unreadMessages={unreadMessages}
      unreadNotifications={unreadNotifications}
      messagesHref="/parent/messages"
      notificationsHref="/parent/notifications"
      onLogout={logout}
      ready={ready}
      error={error}
    >
      {children}
    </AppShell>
  );
}

export default function ParentShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p className="content">Loading…</p>}>
      <ParentShellInner>{children}</ParentShellInner>
    </Suspense>
  );
}
