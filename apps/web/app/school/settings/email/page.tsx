"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  EmptyState,
  LoadingState,
  PageError,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../../../../components/ui";
import { RequirePermission } from "../../../../components/require-permission";
import { mailOutboxCanRetry } from "@schoolapp/core";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

const TEMPLATES = [
  { key: "account_invitation", label: "Account invitation" },
  { key: "password_reset", label: "Password reset" },
  { key: "admissions_application_received", label: "Application received" },
  { key: "admissions_status_update", label: "Application update" },
] as const;

type MailRow = {
  id: string;
  purpose: string;
  templateKey: string | null;
  toEmail: string;
  toName: string | null;
  subject: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  lastError: string | null;
  canRetry?: boolean;
};

type Preview = { template: string; subject: string; html: string; text: string; fixture: boolean };

export default function SchoolEmailDeliveryPage() {
  return (
    <RequirePermission anyOf={["org.settings.manage", "onboarding.manage"]}>
      <SchoolEmailDelivery />
    </RequirePermission>
  );
}

function SchoolEmailDelivery() {
  const [messages, setMessages] = useState<MailRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]["key"]>("account_invitation");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  async function load() {
    const body = await api<{ messages: MailRow[] }>("/api/v1/onboarding/mail");
    setMessages(body.messages);
  }

  async function loadPreview(key: (typeof TEMPLATES)[number]["key"]) {
    const body = await api<Preview>(`/api/v1/onboarding/mail/preview?template=${encodeURIComponent(key)}`);
    setPreview(body);
  }

  useEffect(() => {
    Promise.all([load(), loadPreview(template)])
      .catch((err: Error) => setError(userFacingError(err, "Could not load email delivery.")))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => messages, [messages]);

  async function retry(id: string) {
    setRetrying(id);
    setError("");
    try {
      await api(`/api/v1/onboarding/mail/${id}/retry`, { method: "POST" });
      setNotice("Delivery retried.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not retry that message."));
    } finally {
      setRetrying(null);
    }
  }

  if (loading) return <LoadingState label="Loading email delivery…" />;
  if (error && !messages.length && !preview) {
    return <PageError title="Email delivery unavailable" description={error} />;
  }

  return (
    <>
      <PageHeader
        title="Email delivery"
        description="Transactional messages queued for this school. Invitation and password-reset links are never stored after send."
        breadcrumbs={[
          { href: "/school/settings", label: "School settings" },
          { label: "Email delivery" },
        ]}
      />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <SectionCard
        title="Template preview"
        description="Sample data only. Live invitation and reset tokens are never shown here."
      >
        <div className="form-grid" style={{ marginBottom: "1rem" }}>
          <label>
            Template
            <select
              value={template}
              onChange={(event) => {
                const next = event.target.value as (typeof TEMPLATES)[number]["key"];
                setTemplate(next);
                void loadPreview(next).catch((err: Error) =>
                  setError(userFacingError(err, "Could not render the preview.")),
                );
              }}
            >
              {TEMPLATES.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {preview ? (
          <>
            <p>
              <strong>{preview.subject}</strong>
            </p>
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.html}
              style={{ width: "100%", minHeight: "22rem", border: "1px solid var(--line)", borderRadius: 8, background: "white" }}
            />
            <pre className="muted" style={{ whiteSpace: "pre-wrap", marginTop: "1rem" }}>
              {preview.text}
            </pre>
          </>
        ) : null}
      </SectionCard>

      <SectionCard title="Recent delivery">
        {rows.length === 0 ? (
          <EmptyState title="No transactional email yet" description="Invitations, password resets and admissions acknowledgements appear here after they are queued." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>To</th>
                  <th>Subject</th>
                  <th>Purpose</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <StatusBadge status={row.status} />
                      {row.lastErrorCode ? <div className="muted">{row.lastErrorCode}</div> : null}
                    </td>
                    <td>
                      {row.toName ? `${row.toName} · ` : ""}
                      {row.toEmail}
                    </td>
                    <td>{row.subject}</td>
                    <td>{row.purpose.replaceAll("_", " ")}</td>
                    <td>
                      {(row.canRetry ?? mailOutboxCanRetry(row.status, row.purpose)) ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={retrying === row.id}
                          onClick={() => void retry(row.id)}
                        >
                          {retrying === row.id ? "Retrying…" : "Retry"}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
