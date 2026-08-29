"use client";

import { FormEvent, useEffect, useState } from "react";
import { captureSubmitTarget, resetFormSafely } from "@schoolapp/domain";
import { useRouter } from "next/navigation";
import { Alert, EmptyState, FormField, Input, InviteTokenAlert, LoadingState, PageError, PageHeader, SectionCard } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { api, getToken, setOrgId, setToken } from "../../lib/api";
import { userFacingError } from "../../lib/errors";
import { loadPublicTenant, schoolOrigin } from "../../lib/tenant";

type SchoolAdminState = {
  invitationStatus: "outstanding" | "accepted" | "none" | string;
  canReissue: boolean;
  invitationId: string | null;
  email: string | null;
  fullName: string | null;
  expiresAt: string | null;
  membershipStatus: string | null;
};

type Organisation = {
  id: string;
  slug: string;
  name: string;
  status: string;
  schoolAdmin?: SchoolAdminState;
};

export default function PlatformPage() {
  const router = useRouter();
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [platformDomain, setPlatformDomain] = useState("localhost");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState("");
  const [inviteSlug, setInviteSlug] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [reissuingId, setReissuingId] = useState<string | null>(null);

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

  const schoolHref = (slug: string) => `${schoolOrigin(slug, platformDomain)}/login`;
  const exampleSchoolLogin = schoolHref(organisations[0]?.slug ?? "your-school");
  const localPlatform = platformDomain === "localhost";

  async function createSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    setError("");
    setNotice("");
    try {
      const created = await api<{ invitationToken: string; organisationId: string; slug: string }>(
        "/api/v1/platform/organisations",
        {
          method: "POST",
          orgId: null,
          body: JSON.stringify({
            name: form.get("name"),
            slug: form.get("slug"),
            adminEmail: form.get("adminEmail"),
            adminFullName: form.get("adminFullName"),
          }),
        },
      );
      setInviteToken(created.invitationToken);
      setInviteSlug(created.slug);
      setInviteUrl("");
      setNotice("School created. Copy the one-time School Admin invitation now — it will not be shown again.");
      resetFormSafely(formEl);
      const body = await api<{ organisations: Organisation[] }>("/api/v1/platform/organisations", { orgId: null });
      setOrganisations(body.organisations);
    } catch (err) {
      setError(userFacingError(err, "Could not create school."));
    }
  }

  async function reissueSchoolAdminInvitation(org: Organisation) {
    setError("");
    setNotice("");
    setReissuingId(org.id);
    try {
      const issued = await api<{
        invitationToken: string;
        invitationUrl: string;
        email: string;
      }>(`/api/v1/platform/organisations/${org.id}/school-admin-invitation/reissue`, {
        method: "POST",
        orgId: null,
      });
      setInviteToken(issued.invitationToken);
      setInviteSlug(org.slug);
      setInviteUrl(issued.invitationUrl);
      setNotice(
        `New School Admin invitation issued for ${issued.email}. Copy the one-time URL now — it will not be shown again.`,
      );
      const body = await api<{ organisations: Organisation[] }>("/api/v1/platform/organisations", {
        orgId: null,
      });
      setOrganisations(body.organisations);
    } catch (err) {
      setError(userFacingError(err, "Could not reissue the School Admin invitation."));
    } finally {
      setReissuingId(null);
    }
  }

  function schoolAdminLabel(org: Organisation): string {
    const admin = org.schoolAdmin;
    if (!admin || admin.invitationStatus === "none") {
      return "No School Admin invitation";
    }
    const who = admin.fullName
      ? `${admin.fullName}${admin.email ? ` · ${admin.email}` : ""}`
      : admin.email ?? "School Admin";
    if (admin.invitationStatus === "outstanding") {
      return `Invitation outstanding · ${who}`;
    }
    if (admin.membershipStatus && admin.membershipStatus !== "active") {
      return `School Admin ${admin.membershipStatus} · ${who}`;
    }
    return `School Admin active · ${who}`;
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
            <>
              <InviteTokenAlert
                token={inviteToken}
                href={
                  inviteUrl ||
                  `${schoolOrigin(inviteSlug, platformDomain)}/invite?token=${encodeURIComponent(inviteToken)}`
                }
              />
              {inviteUrl ? (
                <p className="muted">
                  School invitation URL (shown once): <code>{inviteUrl}</code>
                </p>
              ) : null}
            </>
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
                    <th>School Admin</th>
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
                      <td>{schoolAdminLabel(org)}</td>
                      <td>
                        <div className="button-row">
                          {org.schoolAdmin?.canReissue ? (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={reissuingId === org.id}
                              onClick={() => reissueSchoolAdminInvitation(org)}
                            >
                              {reissuingId === org.id
                                ? "Reissuing…"
                                : "Reissue School Admin invitation"}
                            </Button>
                          ) : null}
                          <a href={schoolHref(org.slug)}>Open school login</a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted">
            {localPlatform ? (
              <>
                Local demo school addresses look like <code>{exampleSchoolLogin}</code>.
              </>
            ) : (
              <>
                Staff, parents and students sign in on each school host, for example{" "}
                <code>{exampleSchoolLogin}</code>.
              </>
            )}
          </p>
        </>
      ) : null}
    </main>
  );
}
