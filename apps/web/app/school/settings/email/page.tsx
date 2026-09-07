"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import {
  EMAIL_SETTINGS_TAB_ITEMS,
  emailSettingsTabHref,
  emailTemplateEditorHref,
  isCustomizableEmailTemplateKey,
  parseEmailSettingsTab,
  type CustomizableEmailTemplateKey,
} from "@schoolapp/domain";
import { ATTACHMENT_TOO_LARGE_FOR_PROVIDER_MESSAGE, attachmentTooLargeMessage, formatAttachmentByteSize } from "@schoolapp/core/email-attachments";
import {
  Alert,
  Button,
  Checkbox,
  EmptyState,
  FormField,
  Input,
  LoadingState,
  PageError,
  PageHeader,
  SectionCard,
  StatusBadge,
  Tabs,
  Textarea,
} from "../../../../components/ui";
import { RequirePermission } from "../../../../components/require-permission";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

function mailOutboxCanRetry(status: string, purpose: string): boolean {
  if (status === "queued") return true;
  return (
    status === "failed" &&
    (purpose === "admissions_enquiry_received" ||
      purpose === "admissions_application_received" ||
      purpose === "admissions_status_update")
  );
}

const TEMPLATES = [
  { key: "account_invitation", label: "Account invitation" },
  { key: "password_reset", label: "Password reset" },
  { key: "admissions_enquiry_received", label: "Enquiry received" },
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

type Preview = {
  template: string;
  subject: string;
  html: string;
  text: string;
  fixture: boolean;
  queued?: boolean;
  showSchoolLogo?: boolean;
  attachments?: Array<{ filename: string; sizeLabel: string; kindLabel?: string; byteSize?: number }>;
};

type MergeField = { key: string; label: string; example: string };

type TemplateListItem = {
  key: CustomizableEmailTemplateKey;
  name: string;
  description: string;
  enabled: boolean;
  source: "custom" | "system";
  customised: boolean;
  updatedAt: string | null;
  availableFields: MergeField[];
};

type TemplateAttachment = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  kindLabel: string;
  sizeLabel: string;
  overLimit?: boolean;
  overLimitReason?: string | null;
};

type AttachmentLimits = {
  maxBytesPerFile: number;
  maxTotalBytes: number;
  maxCount: number;
  maxMegabytesPerFile: number;
  maxTotalMegabytes: number;
  summary?: string;
  acceptedTypes?: string[];
  provider?: { recommendedMaxRawAttachmentBytes: number };
};

type TemplateDetail = TemplateListItem & {
  subject: string;
  heading: string;
  greeting: string;
  body: string;
  signoff: string;
  showSchoolLogo: boolean;
  attachments: TemplateAttachment[];
  attachmentLimits?: AttachmentLimits;
};

export default function SchoolEmailDeliveryPage() {
  return (
    <RequirePermission anyOf={["org.settings.manage", "onboarding.manage"]}>
      <Suspense fallback={<LoadingState label="Loading email delivery…" />}>
        <SchoolEmailDelivery />
      </Suspense>
    </RequirePermission>
  );
}

function SchoolEmailDelivery() {
  const searchParams = useSearchParams();
  const tab = parseEmailSettingsTab(searchParams.get("tab"));
  const templateParam = searchParams.get("template");
  const editingKey = isCustomizableEmailTemplateKey(templateParam) ? templateParam : null;

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
      <Tabs label="Email delivery">
        {EMAIL_SETTINGS_TAB_ITEMS.map((item) => {
          const active = tab === item.key;
          return (
            <Link
              key={item.key}
              href={emailSettingsTabHref(item.key)}
              scroll={false}
              className={active ? "active" : undefined}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </Tabs>
      {tab === "automatic" ? (
        editingKey ? <AutomaticEmailEditor templateKey={editingKey} /> : <AutomaticEmailList />
      ) : (
        <EmailDeliveryOutbox />
      )}
    </>
  );
}

function EmailDeliveryOutbox() {
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
        {preview ? <EmailPreviewFrame preview={preview} /> : null}
      </SectionCard>

      <SectionCard title="Recent delivery">
        {rows.length === 0 ? (
          <EmptyState
            title="No transactional email yet"
            description="Invitations, password resets and admissions acknowledgements appear here after they are queued."
          />
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

function AutomaticEmailList() {
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ templates: TemplateListItem[] }>("/api/v1/onboarding/mail/templates")
      .then((body) => setTemplates(body.templates))
      .catch((err: Error) => setError(userFacingError(err, "Could not load automatic emails.")))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState label="Loading automatic emails…" />;
  if (error && !templates.length) {
    return <PageError title="Automatic emails unavailable" description={error} />;
  }

  return (
    <>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <SectionCard
        title="Automatic emails"
        description="Customise the wording, logo visibility, and school documents attached to acknowledgements this school already sends. The layout and LuvLearn footer stay the same."
      >
        {templates.length === 0 ? (
          <EmptyState title="No automatic emails" description="Enquiry and application acknowledgements will appear here." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Last updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((item) => (
                  <tr key={item.key}>
                    <td>
                      <strong>{item.name}</strong>
                      <div className="muted">{item.description}</div>
                    </td>
                    <td>
                      <StatusBadge status={item.source === "custom" ? "customised" : "system default"} />
                      {!item.enabled ? <div className="muted">Using system default</div> : null}
                    </td>
                    <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "Never customised"}</td>
                    <td>
                      <span style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <Link className="button secondary" href={emailTemplateEditorHref(item.key)}>
                          Edit
                        </Link>
                        <Link
                          className="button secondary"
                          href={`${emailTemplateEditorHref(item.key)}&preview=1`}
                        >
                          Preview
                        </Link>
                      </span>
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

function AutomaticEmailEditor({ templateKey }: { templateKey: CustomizableEmailTemplateKey }) {
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [subject, setSubject] = useState("");
  const [heading, setHeading] = useState("");
  const [greeting, setGreeting] = useState("");
  const [body, setBody] = useState("");
  const [signoff, setSignoff] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [showSchoolLogo, setShowSchoolLogo] = useState(true);
  const [attachments, setAttachments] = useState<TemplateAttachment[]>([]);
  const [attachmentLimits, setAttachmentLimits] = useState<AttachmentLimits | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  async function load() {
    const bodyJson = await api<{ template: TemplateDetail }>(
      `/api/v1/onboarding/mail/templates/${encodeURIComponent(templateKey)}`,
    );
    const item = bodyJson.template;
    setDetail(item);
    setSubject(item.subject);
    setHeading(item.heading);
    setGreeting(item.greeting);
    setBody(item.body);
    setSignoff(item.signoff);
    setEnabled(item.enabled);
    setShowSchoolLogo(item.showSchoolLogo !== false);
    setAttachments(item.attachments ?? []);
    setAttachmentLimits(item.attachmentLimits ?? null);
    return item;
  }

  useEffect(() => {
    load()
      .then((item) => {
        if (searchParams.get("preview") === "1") {
          return renderPreview(item);
        }
        return undefined;
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not load this template.")))
      .finally(() => setLoading(false));
  }, [templateKey]);

  async function renderPreview(item?: TemplateDetail) {
    setPreviewing(true);
    setError("");
    try {
      const result = await api<Preview>(
        `/api/v1/onboarding/mail/templates/${encodeURIComponent(templateKey)}/preview`,
        {
          method: "POST",
          body: JSON.stringify({
            enabled,
            subject,
            heading,
            greeting,
            body,
            signoff,
            showSchoolLogo,
            ...(item
              ? {
                  enabled: item.enabled,
                  subject: item.subject,
                  heading: item.heading,
                  greeting: item.greeting,
                  body: item.body,
                  signoff: item.signoff,
                  showSchoolLogo: item.showSchoolLogo,
                }
              : {}),
          }),
        },
      );
      setPreview(result);
    } catch (err) {
      setError(userFacingError(err as Error, "Could not render the preview."));
    } finally {
      setPreviewing(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await api<{ template: TemplateDetail }>(
        `/api/v1/onboarding/mail/templates/${encodeURIComponent(templateKey)}`,
        {
          method: "PUT",
          body: JSON.stringify({ enabled, subject, heading, greeting, body, signoff }),
        },
      );
      setDetail(result.template);
      setShowSchoolLogo(result.template.showSchoolLogo !== false);
      setAttachments(result.template.attachments ?? []);
      setAttachmentLimits(result.template.attachmentLimits ?? attachmentLimits);
      setNotice("Template saved. New acknowledgements will use this wording.");
    } catch (err) {
      setError(userFacingError(err as Error, "Could not save this template."));
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    setSaving(true);
    setError("");
    try {
      const result = await api<{ template: TemplateDetail }>(
        `/api/v1/onboarding/mail/templates/${encodeURIComponent(templateKey)}`,
        { method: "DELETE" },
      );
      setDetail(result.template);
      setSubject(result.template.subject);
      setHeading(result.template.heading);
      setGreeting(result.template.greeting);
      setBody(result.template.body);
      setSignoff(result.template.signoff);
      setEnabled(result.template.enabled);
      setShowSchoolLogo(result.template.showSchoolLogo !== false);
      setAttachments(result.template.attachments ?? []);
      setAttachmentLimits(result.template.attachmentLimits ?? attachmentLimits);
      setPreview(null);
      setNotice("Restored the system default wording.");
    } catch (err) {
      setError(userFacingError(err as Error, "Could not restore the system default."));
    } finally {
      setSaving(false);
    }
  }

  async function applyTemplate(item: TemplateDetail, noticeText: string) {
    setDetail(item);
    setShowSchoolLogo(item.showSchoolLogo !== false);
    setAttachments(item.attachments ?? []);
    setAttachmentLimits(item.attachmentLimits ?? attachmentLimits);
    setNotice(noticeText);
  }

  async function toggleLogo(next: boolean) {
    setShowSchoolLogo(next);
    setError("");
    try {
      const result = await api<{ template: TemplateDetail }>(
        `/api/v1/onboarding/mail/templates/${encodeURIComponent(templateKey)}/presentation`,
        { method: "PUT", body: JSON.stringify({ showSchoolLogo: next }) },
      );
      await applyTemplate(result.template, next ? "School logo will be shown." : "School logo will be omitted.");
    } catch (err) {
      setShowSchoolLogo(!next);
      setError(userFacingError(err as Error, "Could not update logo visibility."));
    }
  }

  async function addAttachment(file: File) {
    setError("");
    if (attachmentLimits) {
      if (
        attachmentLimits.provider?.recommendedMaxRawAttachmentBytes &&
        file.size > attachmentLimits.provider.recommendedMaxRawAttachmentBytes
      ) {
        setError(ATTACHMENT_TOO_LARGE_FOR_PROVIDER_MESSAGE);
        return;
      }
      if (file.size > attachmentLimits.maxBytesPerFile) {
        setError(attachmentTooLargeMessage(file.name, file.size, attachmentLimits.maxBytesPerFile));
        return;
      }
      if (attachments.length >= attachmentLimits.maxCount) {
        setError(`This automatic email already has the maximum number of attachments (${attachmentLimits.maxCount}).`);
        return;
      }
      const nextTotal = attachments.reduce((sum, item) => sum + item.byteSize, 0) + file.size;
      if (nextTotal > attachmentLimits.maxTotalBytes) {
        setError(
          `These attachments would be ${formatAttachmentByteSize(nextTotal)} in total. The maximum total attachment size is ${formatAttachmentByteSize(attachmentLimits.maxTotalBytes)}.`,
        );
        return;
      }
    }
    const body = new FormData();
    body.append("file", file);
    try {
      const result = await api<{ template: TemplateDetail }>(
        `/api/v1/onboarding/mail/templates/${encodeURIComponent(templateKey)}/attachments`,
        { method: "POST", body },
      );
      await applyTemplate(result.template, `${file.name} will be attached when this email is sent.`);
    } catch (err) {
      setError(userFacingError(err as Error, "Could not attach that document."));
    }
  }

  async function removeAttachment(attachment: TemplateAttachment) {
    setError("");
    try {
      const result = await api<{ template: TemplateDetail }>(
        `/api/v1/onboarding/mail/templates/${encodeURIComponent(templateKey)}/attachments/${encodeURIComponent(attachment.id)}`,
        { method: "DELETE" },
      );
      await applyTemplate(result.template, `${attachment.filename} was removed from this email.`);
    } catch (err) {
      setError(userFacingError(err as Error, "Could not remove that attachment."));
    }
  }

  if (loading) return <LoadingState label="Loading template…" />;
  if (error && !detail) return <PageError title="Template unavailable" description={error} />;
  if (!detail) return <EmptyState title="Template not found" />;

  return (
    <>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <SectionCard
        title={detail.name}
        description={detail.description}
      >
        <p>
          <Link href={emailSettingsTabHref("automatic")}>Back to automatic emails</Link>
        </p>
        <form className="stack" onSubmit={save}>
          <Checkbox
            label="Use this customised wording"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <FormField label="Subject" hint="Required. Use available fields such as {{school_name}}.">
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} required maxLength={200} />
          </FormField>
          <FormField label="Heading">
            <Input value={heading} onChange={(event) => setHeading(event.target.value)} required maxLength={120} />
          </FormField>
          <FormField label="Greeting">
            <Input value={greeting} onChange={(event) => setGreeting(event.target.value)} required maxLength={200} />
          </FormField>
          <FormField label="Body" hint="Line breaks are kept. HTML is not allowed.">
            <Textarea value={body} onChange={(event) => setBody(event.target.value)} required rows={8} maxLength={4000} />
          </FormField>
          <FormField label="Sign-off">
            <Textarea value={signoff} onChange={(event) => setSignoff(event.target.value)} required rows={3} maxLength={400} />
          </FormField>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="secondary" disabled={previewing} onClick={() => void renderPreview()}>
              {previewing ? "Rendering…" : "Preview"}
            </Button>
            {detail.customised ? (
              <Button type="button" variant="secondary" disabled={saving} onClick={() => void resetToDefault()}>
                Use system default
              </Button>
            ) : null}
          </div>
        </form>
      </SectionCard>
      <SectionCard
        title="Branding & layout"
        description="Use this school's existing logo. A separate logo is not uploaded here."
      >
        <Checkbox
          label="Show school logo"
          checked={showSchoolLogo}
          onChange={(event) => void toggleLogo(event.target.checked)}
        />
      </SectionCard>
      <SectionCard
        title="Attachments"
        description="Attach school documents automatically when this email is sent. Each automatic email has its own attachments. Prospectuses and fee guides are appropriate; applications, medical, or safeguarding files are not."
      >
        {attachments.some((item) => item.overLimit) ? (
          <Alert tone="danger">
            One or more attachments are over the current platform limit. This email will not send until those files
            are removed. Existing files are not deleted automatically.
          </Alert>
        ) : null}
        <p className="muted" style={{ whiteSpace: "pre-line" }}>
          {attachmentLimits
            ? [
                "Accepted: PDF, DOCX, JPEG, PNG",
                `Maximum ${formatAttachmentByteSize(attachmentLimits.maxBytesPerFile)} per file`,
                `Maximum ${formatAttachmentByteSize(attachmentLimits.maxTotalBytes)} total`,
                `Up to ${attachmentLimits.maxCount} attachments`,
              ].join("\n")
            : "Accepted: PDF, DOCX, JPEG, PNG"}
        </p>
        {attachments.length ? (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: "0 0 1rem" }}>
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  alignItems: "center",
                  padding: "0.5rem 0",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div>
                  <strong>{attachment.filename}</strong>
                  <div className="muted">
                    {attachment.kindLabel} • {attachment.sizeLabel}
                    {attachment.overLimit ? " • Over current limit" : ""}
                  </div>
                  {attachment.overLimitReason ? <div className="muted">{attachment.overLimitReason}</div> : null}
                </div>
                <Button type="button" variant="secondary" onClick={() => void removeAttachment(attachment)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No documents are attached to this email yet.</p>
        )}
        <label className="button secondary" style={{ display: "inline-block" }}>
          + Add attachment
          <input
            type="file"
            accept=".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void addAttachment(file);
            }}
          />
        </label>
      </SectionCard>
      <SectionCard title="Available fields" description="Only these placeholders can be inserted. They are filled with sample data in preview and live values when the email is sent.">
        <ul>
          {detail.availableFields.map((field) => (
            <li key={field.key}>
              <code>{`{{${field.key}}}`}</code> — {field.label}
              <span className="muted"> (e.g. {field.example})</span>
            </li>
          ))}
        </ul>
      </SectionCard>
      {preview ? (
        <SectionCard title="Preview" description="Sample data only. This does not send an email or use real parent or pupil details.">
          <EmailPreviewFrame preview={preview} />
        </SectionCard>
      ) : null}
    </>
  );
}

function EmailPreviewFrame({ preview }: { preview: Preview }) {
  return (
    <>
      <p>
        <strong>{preview.subject}</strong>
      </p>
      {preview.attachments?.length ? (
        <p>
          Attachments:
          <br />
          {preview.attachments.map((item) => (
            <span key={item.filename}>
              • {item.filename} — {item.sizeLabel}
              <br />
            </span>
          ))}
        </p>
      ) : (
        <p className="muted">No attachments configured for this email.</p>
      )}
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
  );
}
