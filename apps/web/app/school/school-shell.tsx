"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode, Suspense, useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { api, getOrgId, getToken, setOrgId, setToken } from "../../lib/api";
import { userFacingError } from "../../lib/errors";
import { resolveLoginBranding } from "../../lib/login-branding";
import {
  hasParentRole,
  hasStaffRole,
  homePath,
  pickMembership,
  pickPortalMembership,
  staffPersonaLabel,
  type Membership,
} from "../../lib/portal";
import { visibleStaffNav } from "../../lib/staff-nav";
import { loadPublicTenant, membershipForHost, switchSchoolLocation } from "../../lib/tenant";

function SchoolShellInner({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [orgId, setOrg] = useState<string | null>(null);
  const [canOpenParentPortal, setCanOpenParentPortal] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [signedInName, setSignedInName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [platformDomain, setPlatformDomain] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState("School");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [unreadMessages, setUnreadMessages] = useState<number | null>(null);

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
          const branding = resolveLoginBranding({
            organisationName: tenant.organisation.name,
            hostname: tenant.hostname,
            branding: tenant.organisation.branding,
          });
          setSchoolName(branding.organisationName);
          setLogoUrl(branding.logoUrl);
          document.documentElement.style.setProperty("--sidebar", branding.primaryColor);
          document.documentElement.style.setProperty("--navy", branding.primaryColor);
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
          return api<{ permissions: string[]; user: { fullName: string } }>("/api/v1/me", {
            orgId: current.organisationId,
          });
        }
        const current = pickPortalMembership(active, "staff", getOrgId());
        if (!current) {
          const fallback = pickMembership(active, getOrgId());
          router.replace(fallback ? homePath(fallback.roleKeys) : "/login");
          return;
        }
        setSchoolName(current.name);
        setMemberships(active.filter((m) => hasStaffRole(m.roleKeys)));
        setOrgId(current.organisationId);
        setOrg(current.organisationId);
        setCanOpenParentPortal(active.some((m) => hasParentRole(m.roleKeys)));
        return api<{ permissions: string[]; user: { fullName: string } }>("/api/v1/me");
      })
      .then((me) => {
        if (!me) return;
        setPermissions(me.permissions ?? []);
        setSignedInName(me.user?.fullName ?? null);
        setReady(true);
        return api<{ unreadCount: number }>("/api/v1/messages/unread-count")
          .then((body) => setUnreadMessages(body.unreadCount))
          .catch(() => setUnreadMessages(null));
      })
      .catch((err: Error) => {
        setError(userFacingError(err, "You do not have access to this school."));
        if (err instanceof Error) router.replace("/login");
      });
  }, [router]);

  async function onOrgChange(value: string) {
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
  const personaLabel = staffPersonaLabel(current?.roleKeys ?? []);
  const sections = visibleStaffNav(permissions).map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.href === "/school/messages"
        ? { ...item, count: unreadMessages && unreadMessages > 0 ? unreadMessages : null }
        : item,
    ),
  }));

  return (
    <AppShell
      variant="staff"
      schoolName={current?.name ?? schoolName}
      personaLabel={personaLabel}
      userName={signedInName}
      logoUrl={logoUrl}
      schoolOptions={memberships.map((m) => ({ id: m.organisationId, name: m.name }))}
      selectedSchoolId={orgId}
      onSchoolChange={onOrgChange}
      sections={sections}
      extraNav={canOpenParentPortal ? <Link href="/parent" className="app-nav-link">Parent Portal</Link> : null}
      unreadMessages={unreadMessages}
      messagesHref={
        permissions.some((key) => key.startsWith("messaging.")) ? "/school/messages" : undefined
      }
      onLogout={logout}
      ready={ready}
      error={error}
    >
      {children}
    </AppShell>
  );
}

export default function SchoolShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p className="content">Loading…</p>}>
      <SchoolShellInner>{children}</SchoolShellInner>
    </Suspense>
  );
}
