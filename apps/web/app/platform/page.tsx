"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, EmptyState, FormField, Input, LoadingState, PageError, PageHeader, SectionCard } from "../../components/ui";
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
  const [inviteToken, setInviteToken] = useState("");
  const [notice, setNotice] = useState("");

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

  async function createSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setNotice("");
    try {
      const created = await api<{ invitationToken: string; organisationId: string }>("/api/v1/platform/organisations", {
        method: "POST",
        orgId: null,
        body: JSON.stringify({
          name: form.get("name"),
          slug: form.get("slug"),
          adminEmail: form.get("adminEmail"),
          adminFullName: form.get("adminFullName"),
        }),
      });
      setInviteToken(created.invitationToken);
      setNotice("School created. Copy the one-time School Admin invitation now — it will not be shown again.");
      event.currentTarget.reset();
      const body = await api<{ organisations: Organisation[] }>("/api/v1/platform/organisations", { orgId: null });
      setOrganisations(body.organisations);
    } catch (err) {
      setError(userFacingError(err, "Could not create school."));
    }
  }

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
          <SectionCard title="Create a school" description="Creates the organisation, hostname slug, and first School Admin invitation. Super Admin cannot browse pupils from here.">
            <form className="form-grid" onSubmit={createSchool}>
              <FormField label="School name">
                <Input name="name" required />
              </FormField>
              <FormField label="Slug / host">
                <Input name="slug" required placeholder="riverside" />
              </FormField>
              <FormField label="First School Admin name">
                <Input name="adminFullName" required />
              </FormField>
              <FormField label="First School Admin email">
                <Input name="adminEmail" type="email" required />
              </FormField>
              <div>
                <Button type="submit">Create school</Button>
              </div>
            </form>
          </SectionCard>
          {inviteToken ? (
            <Alert tone="info">
              One-time School Admin invitation (copy now): <code>{inviteToken}</code>
              {" · "}
              <a href={`/invite?token=${encodeURIComponent(inviteToken)}`}>Activation link</a>
            </Alert>
          ) : null}
          {notice ? <Alert tone="success">{notice}</Alert> : null}
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
