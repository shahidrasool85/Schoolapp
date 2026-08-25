"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, LoadingState, PageError, PageHeader } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { api, getToken, setOrgId, setToken } from "../../lib/api";
import { userFacingError } from "../../lib/errors";
import { loadPublicTenant, schoolOrigin } from "../../lib/tenant";

type Organisation = {
  id: string;
  slug: string;
  name: string;
  status: string;
};

export default function PlatformPage() {
  const router = useRouter();
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [platformDomain, setPlatformDomain] = useState("localhost");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([
      loadPublicTenant(),
      api<{ isPlatformAdmin: boolean; user: { fullName: string } }>("/api/v1/me", { orgId: null }),
    ])
      .then(async ([tenant, me]) => {
        if (tenant.kind === "unknown") {
          setError("This address is not an active school on the platform.");
          return;
        }
        if (tenant.kind === "school") {
          router.replace("/login");
          return;
        }
        if (!me.isPlatformAdmin) {
          setError("This page is for platform administrators.");
          return;
        }
        setUserName(me.user?.fullName ?? null);
        setPlatformDomain(tenant.platformDomain);
        const body = await api<{ organisations: Organisation[] }>("/api/v1/platform/organisations", {
          orgId: null,
        });
        setOrganisations(body.organisations);
        setReady(true);
      })
      .catch((err: Error) => {
        setError(userFacingError(err, "Could not load platform administration."));
        router.replace("/login");
      });
  }, [router]);

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST", orgId: null });
    setToken(null);
    setOrgId(null);
    router.replace("/login");
  }

  const schoolHref = (slug: string) => {
    if (typeof window === "undefined") return `http://${slug}.${platformDomain}:3000/login`;
    return `${schoolOrigin(slug, platformDomain)}/login`;
  };

  return (
    <main className="platform-shell">
      <PageHeader
        title="Platform Admin"
        description="Manage schools on the platform host. Super Admin does not browse pupil records from here."
        actions={
          <Button type="button" variant="secondary" onClick={logout}>
            Sign out
          </Button>
        }
      />
      {userName ? <p className="muted">{userName} · Platform administrator</p> : null}
      {error ? <PageError description={error} /> : null}
      {!ready && !error ? <LoadingState label="Loading schools…" /> : null}
      {ready ? (
        <>
          <h2>Schools</h2>
          {organisations.length === 0 ? (
            <EmptyState title="No schools yet" description="No organisations have been provisioned yet." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>School</th>
                    <th>Slug</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {organisations.map((org) => (
                    <tr key={org.id}>
                      <td>
                        <strong>{org.name}</strong>
                      </td>
                      <td>{org.slug}</td>
                      <td>{org.status}</td>
                      <td>
                        <a href={schoolHref(org.slug)}>Open school login</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted">
            Local demo URLs look like <code>http://greenwood.localhost:3000</code>. Production DNS
            and TLS are not configured in this environment.
          </p>
        </>
      ) : null}
    </main>
  );
}
