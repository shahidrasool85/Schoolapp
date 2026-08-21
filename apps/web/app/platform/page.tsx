"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, setOrgId, setToken } from "../../lib/api";
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

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([
      loadPublicTenant(),
      api<{ isPlatformAdmin: boolean }>("/api/v1/me", { orgId: null }),
      api<{ organisations: Organisation[] }>("/api/v1/platform/organisations", { orgId: null }),
    ])
      .then(([tenant, me, body]) => {
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
        setPlatformDomain(tenant.platformDomain);
        setOrganisations(body.organisations);
        setReady(true);
      })
      .catch((err: Error) => {
        setError(err.message);
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
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "2rem auto", padding: 16 }}>
      <h1>Platform Admin</h1>
      <p className="muted">
        This is the platform host. Schools are opened on their own subdomain. Super Admin does not
        browse pupil records from here.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {!ready && !error ? <p>Loading…</p> : null}
      {ready ? (
        <>
          <h2>Schools</h2>
          {organisations.length === 0 ? (
            <p>No organisations have been provisioned yet.</p>
          ) : (
            <ul>
              {organisations.map((org) => (
                <li key={org.id}>
                  <strong>{org.name}</strong> ({org.slug}) — {org.status}{" "}
                  <a href={schoolHref(org.slug)}>Open school login</a>
                </li>
              ))}
            </ul>
          )}
          <p className="muted">
            Local demo URLs look like <code>http://greenwood.localhost:3000</code>. Production DNS
            and TLS are not configured in this environment.
          </p>
          <button className="secondary" type="button" onClick={logout}>
            Sign out
          </button>
        </>
      ) : null}
    </main>
  );
}
