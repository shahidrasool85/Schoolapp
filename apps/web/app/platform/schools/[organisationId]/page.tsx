"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { loginHrefForReturn } from "@schoolapp/domain";
import {
  Alert,
  Checkbox,
  FormField,
  Input,
  LoadingState,
  PageError,
  PageHeader,
  SectionCard,
} from "../../../../components/ui";
import { Button } from "../../../../components/ui/button";
import { api, getToken, setOrgId, setToken } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { loadPublicTenant, schoolOrigin } from "../../../../lib/tenant";

type SchoolAdmin = {
  userId: string;
  email: string | null;
  fullName: string;
  membershipStatus: string;
};

type Preview = {
  mode: string;
  organisation: { id: string; slug: string; name: string; status: string };
  schoolAdminsPreserved: SchoolAdmin[];
  counts: Record<string, number>;
  preserved: Array<{ key: string; label: string }>;
  liveFinancialResetBlocked: boolean;
  alreadyClean: boolean;
  verification?: Record<string, boolean>;
};

const COUNT_LABELS: Record<string, string> = {
  pupils: "Pupils",
  guardianships: "Guardian relationships",
  staffToRemove: "Staff users to remove",
  admissionsEnquiries: "Admissions enquiries",
  admissionsApplications: "Applications",
  attendanceMarks: "Attendance marks",
  timetableLessons: "Timetable lessons",
  assignments: "Assignments",
  safeguardingRecords: "Safeguarding records",
  invoices: "Invoices",
  payments: "Payments",
  receipts: "Receipts",
  storedDocuments: "Stored operational documents",
  mailOutbox: "Emails/outbox records",
  academicYears: "Academic years",
  classes: "Classes/forms",
  notices: "Notices",
  messages: "Messages",
};

export default function PlatformSchoolPage() {
  const router = useRouter();
  const params = useParams<{ organisationId: string }>();
  const organisationId = params.organisationId;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [platformDomain, setPlatformDomain] = useState("localhost");
  const [confirmationText, setConfirmationText] = useState("");
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [understandPermanent, setUnderstandPermanent] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace(loginHrefForReturn(`${window.location.pathname}${window.location.search}`, "platform"));
      return;
    }
    Promise.all([
      loadPublicTenant(),
      api<{ isPlatformAdmin: boolean }>("/api/v1/me", { orgId: null }),
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
        setPlatformDomain(tenant.platformDomain);
        const body = await api<Preview>(`/api/v1/platform/organisations/${organisationId}/operational-reset`, {
          orgId: null,
        });
        setPreview(body);
        setReady(true);
      })
      .catch((err: Error) => {
        setError(userFacingError(err, "Could not load this school."));
      });
  }, [organisationId, router]);

  const canSubmit = useMemo(() => {
    if (!preview || preview.liveFinancialResetBlocked || resetting) return false;
    if (preview.schoolAdminsPreserved.length < 1) return false;
    return backupConfirmed && understandPermanent && confirmationText.trim().length > 0;
  }, [backupConfirmed, confirmationText, preview, resetting, understandPermanent]);

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST", orgId: null });
    setToken(null);
    setOrgId(null);
    router.replace("/login");
  }

  async function runReset(event: FormEvent) {
    event.preventDefault();
    if (!preview) return;
    setError("");
    setNotice("");
    setResetting(true);
    try {
      const result = await api<Preview>(`/api/v1/platform/organisations/${organisationId}/operational-reset`, {
        method: "POST",
        orgId: null,
        body: JSON.stringify({
          confirmationText,
          backupConfirmed,
          understandPermanent,
          resetMode: "operational_reset_v1",
        }),
      });
      setPreview(result);
      setConfirmationText("");
      setBackupConfirmed(false);
      setUnderstandPermanent(false);
      setNotice(`${preview.organisation.name} operational data has been reset. School Admin accounts were preserved.`);
    } catch (err) {
      setError(userFacingError(err as Error, "Could not reset school operational data."));
    } finally {
      setResetting(false);
    }
  }

  return (
    <main className="platform-shell">
      <PageHeader
        title={preview ? preview.organisation.name : "School"}
        description="Platform Admin school controls. This is not School Admin settings."
        breadcrumbs={[
          { href: "/platform", label: "Platform Admin" },
          { href: "/platform", label: "Schools" },
          { label: preview?.organisation.name ?? "School" },
        ]}
        actions={
          <Button type="button" variant="secondary" onClick={logout}>
            Sign out
          </Button>
        }
      />
      {error ? <PageError description={error} /> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!ready && !error ? <LoadingState label="Loading school…" /> : null}
      {ready && preview ? (
        <>
          <SectionCard title="School identity" description="These values stay after an operational reset.">
            <p>
              <strong>{preview.organisation.name}</strong> · <code>{preview.organisation.slug}</code> ·{" "}
              {preview.organisation.status}
            </p>
            <p className="muted">
              School login:{" "}
              <a href={`${schoolOrigin(preview.organisation.slug, platformDomain)}/login`}>Open school login</a>
            </p>
          </SectionCard>
          <section className="danger-zone" aria-labelledby="danger-zone-heading">
            <h2 id="danger-zone-heading">Danger zone</h2>
            <p>
              <strong>RESET SCHOOL OPERATIONAL DATA</strong>
            </p>
            <p>
              This permanently deletes this school&apos;s operational and UAT records. It does not delete the school,
              hostname, branding, or School Admin accounts. This cannot be undone through the UI.
            </p>
            <Alert tone="danger">Create and verify a backup before resetting school data.</Alert>
            {preview.liveFinancialResetBlocked ? (
              <Alert tone="danger">
                Reset is blocked because this school has live Stripe mode or live payment evidence.
              </Alert>
            ) : null}
            <h3>School Admin accounts preserved</h3>
            <ul>
              {preview.schoolAdminsPreserved.map((admin) => (
                <li key={admin.userId}>
                  {admin.email ?? admin.fullName}
                  {admin.email && admin.fullName ? ` · ${admin.fullName}` : ""}
                </li>
              ))}
            </ul>
            {preview.schoolAdminsPreserved.length === 0 ? (
              <p className="muted">No active School Admin is available to preserve. Reset is blocked.</p>
            ) : null}
            <h3>What will be deleted</h3>
            <ul className="reset-count-list">
              {Object.entries(preview.counts).map(([key, value]) => (
                <li key={key}>
                  {COUNT_LABELS[key] ?? key}: {value}
                </li>
              ))}
            </ul>
            <h3>What will be preserved</h3>
            <ul>
              {preview.preserved.map((item) => (
                <li key={item.key}>{item.label}</li>
              ))}
            </ul>
            {preview.alreadyClean ? (
              <Alert tone="info">This school already has no operational records. A second reset is safe.</Alert>
            ) : null}
            <form className="form-grid" onSubmit={runReset}>
              <FormField
                label={`Type ${preview.organisation.slug} to confirm`}
                hint="Type the exact school slug or school name."
              >
                <Input
                  value={confirmationText}
                  onChange={(event) => setConfirmationText(event.target.value)}
                  autoComplete="off"
                  required
                />
              </FormField>
              <Checkbox
                checked={backupConfirmed}
                onChange={(event) => setBackupConfirmed(event.target.checked)}
                label="I confirm a current backup has been created."
              />
              <Checkbox
                checked={understandPermanent}
                onChange={(event) => setUnderstandPermanent(event.target.checked)}
                label="I understand this will permanently delete this school's operational data."
              />
              <div>
                <Button type="submit" variant="danger" disabled={!canSubmit}>
                  {resetting ? "Resetting…" : `Reset ${preview.organisation.name} data`}
                </Button>
              </div>
            </form>
          </section>
        </>
      ) : null}
    </main>
  );
}
