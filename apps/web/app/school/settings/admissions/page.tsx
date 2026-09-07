"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState, type CSSProperties } from "react";
import {
  ADMISSIONS_SETTINGS_PATH,
  isSubmissionConfirmationKey,
  submissionConfirmationEditorHref,
  type SubmissionConfirmationKey,
} from "@schoolapp/domain";
import {
  Alert,
  Button,
  EmptyState,
  FormField,
  Input,
  LoadingState,
  PageError,
  PageHeader,
  SectionCard,
  StatusBadge,
  Textarea,
} from "../../../../components/ui";
import { RequirePermission } from "../../../../components/require-permission";
import { api } from "../../../../lib/api";
import { AdmissionsSubmissionConfirmation } from "../../../../lib/admissions-submission-confirmation";
import { userFacingError } from "../../../../lib/errors";

type MergeField = { key: string; label: string; example: string };

type TemplateListItem = {
  key: SubmissionConfirmationKey;
  name: string;
  description: string;
  source: "custom" | "system";
  customised: boolean;
  updatedAt: string | null;
  availableFields: MergeField[];
  sampleReference: string;
  referenceLabel: string;
};

type TemplateDetail = TemplateListItem & {
  heading: string;
  message: string;
  additionalMessage: string | null;
  buttonLabel: string | null;
  buttonUrl: string | null;
};

type Preview = {
  fixture: boolean;
  queued: boolean;
  confirmation: {
    heading: string;
    message: string;
    additionalMessage: string | null;
    button: { label: string; url: string } | null;
    referenceLabel: string;
    reference: string;
    showSystemReference: boolean;
    source: "custom" | "system";
  };
  branding: { schoolName: string; primaryColor: string | null; logoUrl: string | null };
};

export default function SchoolAdmissionsSettingsPage() {
  return (
    <RequirePermission anyOf={["org.settings.manage"]}>
      <Suspense fallback={<LoadingState label="Loading admissions settings…" />}>
        <SchoolAdmissionsSettings />
      </Suspense>
    </RequirePermission>
  );
}

function SchoolAdmissionsSettings() {
  const searchParams = useSearchParams();
  const templateParam = searchParams.get("template");
  const editingKey = isSubmissionConfirmationKey(templateParam) ? templateParam : null;

  return (
    <>
      <PageHeader
        title="Admissions"
        description="Customise what visitors see on the school website after they submit an enquiry or application. This is separate from the acknowledgement email."
        breadcrumbs={[
          { href: "/school/settings", label: "School settings" },
          { label: "Admissions" },
        ]}
      />
      {editingKey ? (
        <SubmissionConfirmationEditor templateKey={editingKey} />
      ) : (
        <SubmissionConfirmationList />
      )}
    </>
  );
}

function SubmissionConfirmationList() {
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ templates: TemplateListItem[] }>("/api/v1/onboarding/admissions/submission-confirmations")
      .then((body) => setTemplates(body.templates))
      .catch((err: Error) => setError(userFacingError(err, "Could not load submission confirmations.")))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState label="Loading submission confirmations…" />;
  if (error && !templates.length) {
    return <PageError title="Submission confirmations unavailable" description={error} />;
  }

  return (
    <>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <SectionCard
        title="Submission confirmations"
        description="These messages appear on the website immediately after a successful enquiry or application. They do not change the automatic acknowledgement email."
      >
        {templates.length === 0 ? (
          <EmptyState title="No confirmation pages" description="Enquiry and application confirmations will appear here." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Page</th>
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
                    </td>
                    <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "Never customised"}</td>
                    <td>
                      <span style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <Link className="button secondary" href={submissionConfirmationEditorHref(item.key)}>
                          Edit
                        </Link>
                        <Link
                          className="button secondary"
                          href={`${submissionConfirmationEditorHref(item.key)}&preview=1`}
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

function SubmissionConfirmationEditor({ templateKey }: { templateKey: SubmissionConfirmationKey }) {
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [heading, setHeading] = useState("");
  const [message, setMessage] = useState("");
  const [additionalMessage, setAdditionalMessage] = useState("");
  const [buttonLabel, setButtonLabel] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  async function load() {
    const bodyJson = await api<{ template: TemplateDetail }>(
      `/api/v1/onboarding/admissions/submission-confirmations/${encodeURIComponent(templateKey)}`,
    );
    const item = bodyJson.template;
    setDetail(item);
    setHeading(item.heading);
    setMessage(item.message);
    setAdditionalMessage(item.additionalMessage ?? "");
    setButtonLabel(item.buttonLabel ?? "");
    setButtonUrl(item.buttonUrl ?? "");
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
      .catch((err: Error) => setError(userFacingError(err, "Could not load this confirmation page.")))
      .finally(() => setLoading(false));
  }, [templateKey]);

  function draftPayload(item?: TemplateDetail) {
    return {
      heading: item?.heading ?? heading,
      message: item?.message ?? message,
      additionalMessage: (item ? item.additionalMessage : additionalMessage) || null,
      buttonLabel: (item ? item.buttonLabel : buttonLabel) || null,
      buttonUrl: (item ? item.buttonUrl : buttonUrl) || null,
    };
  }

  async function renderPreview(item?: TemplateDetail) {
    setPreviewing(true);
    setError("");
    try {
      const result = await api<Preview>(
        `/api/v1/onboarding/admissions/submission-confirmations/${encodeURIComponent(templateKey)}/preview`,
        { method: "POST", body: JSON.stringify(draftPayload(item)) },
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
        `/api/v1/onboarding/admissions/submission-confirmations/${encodeURIComponent(templateKey)}`,
        { method: "PUT", body: JSON.stringify(draftPayload()) },
      );
      setDetail(result.template);
      setNotice("Confirmation page saved. New submissions will use this wording.");
    } catch (err) {
      setError(userFacingError(err as Error, "Could not save this confirmation page."));
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    setSaving(true);
    setError("");
    try {
      const result = await api<{ template: TemplateDetail }>(
        `/api/v1/onboarding/admissions/submission-confirmations/${encodeURIComponent(templateKey)}`,
        { method: "DELETE" },
      );
      setDetail(result.template);
      setHeading(result.template.heading);
      setMessage(result.template.message);
      setAdditionalMessage(result.template.additionalMessage ?? "");
      setButtonLabel(result.template.buttonLabel ?? "");
      setButtonUrl(result.template.buttonUrl ?? "");
      setPreview(null);
      setNotice("Restored the system default confirmation.");
    } catch (err) {
      setError(userFacingError(err as Error, "Could not restore the system default."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading confirmation page…" />;
  if (error && !detail) return <PageError title="Confirmation page unavailable" description={error} />;
  if (!detail) return <EmptyState title="Confirmation page not found" />;

  const previewStyle = preview?.branding.primaryColor
    ? ({ ["--brand" as string]: preview.branding.primaryColor } as CSSProperties)
    : undefined;

  return (
    <>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <SectionCard title={detail.name} description={detail.description}>
        <p>
          <Link href={ADMISSIONS_SETTINGS_PATH}>Back to submission confirmations</Link>
        </p>
        <form className="stack" onSubmit={save}>
          <FormField label="Heading" hint="Required. Shown as the main title on the confirmation page.">
            <Input value={heading} onChange={(event) => setHeading(event.target.value)} required maxLength={120} />
          </FormField>
          <FormField label="Message" hint="Line breaks are kept. HTML is not allowed.">
            <Textarea value={message} onChange={(event) => setMessage(event.target.value)} required rows={6} maxLength={4000} />
          </FormField>
          <FormField label="Additional message" hint="Optional. Appears below the main message.">
            <Textarea
              value={additionalMessage}
              onChange={(event) => setAdditionalMessage(event.target.value)}
              rows={4}
              maxLength={2000}
            />
          </FormField>
          <FormField label="Button label" hint="Optional. Leave blank if you do not want a button.">
            <Input value={buttonLabel} onChange={(event) => setButtonLabel(event.target.value)} maxLength={80} />
          </FormField>
          <FormField label="Button URL" hint="Optional. Must be http or https. Both label and URL are required for a button.">
            <Input
              value={buttonUrl}
              onChange={(event) => setButtonUrl(event.target.value)}
              maxLength={2000}
              placeholder="https://"
            />
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
        title="Available fields"
        description="Only these placeholders can be inserted. They are filled with sample data in preview and live values after a real submission. The submission reference is always shown underneath if you do not include it here."
      >
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
        <SectionCard
          title="Preview"
          description="Sample data only. This does not create an enquiry or application, send email, or use a real reference number."
        >
          <div className="admissions-app" style={previewStyle}>
            <AdmissionsSubmissionConfirmation
              view={{
                schoolName: preview.branding.schoolName,
                logoUrl: preview.branding.logoUrl,
                heading: preview.confirmation.heading,
                message: preview.confirmation.message,
                additionalMessage: preview.confirmation.additionalMessage,
                button: preview.confirmation.button,
                referenceLabel: preview.confirmation.referenceLabel,
                reference: preview.confirmation.reference,
                showSystemReference: preview.confirmation.showSystemReference,
              }}
            />
          </div>
        </SectionCard>
      ) : null}
    </>
  );
}
