"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type ReactNode } from "react";
import { api, ApiError } from "./api";

const PUBLIC_FORM_TYPES = [
  "enquiry",
  "application",
  "open_day",
  "waiting_list",
  "scholarship",
  "sixth_form",
  "nursery",
] as const;

export type PublicFormType = (typeof PUBLIC_FORM_TYPES)[number];

export function formTypeFromPublicKind(kind: string): PublicFormType | null {
  if (kind === "apply") return "application";
  return (PUBLIC_FORM_TYPES as readonly string[]).includes(kind) ? (kind as PublicFormType) : null;
}

const UK_POSTCODE_RE = /^(GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})$/i;

const PUBLIC_LABELS: Record<string, string> = {
  "child.legal_name": "Legal name",
  "child.preferred_name": "Preferred name",
  "child.date_of_birth": "Date of birth",
  "child.gender": "Gender",
  "child.address": "Home address",
  "child.intended_academic_year_id": "Intended academic year",
  "child.intended_year_group_id": "Intended year group",
  "child.proposed_start_date": "Proposed start date",
  "child.current_school": "Current school",
  "child.previous_school": "Previous school",
};

const PUBLIC_HELP: Record<string, string> = {
  "child.legal_name": "The child's full legal name, as on their birth certificate or passport.",
  "child.current_school": "The school the child attends now, if any.",
  "child.previous_school": "A school the child attended before the current school, if different.",
};

type PublicField = {
  fieldKey: string;
  questionType: string;
  label: string;
  helperText: string | null;
  required: boolean;
  options: Array<{ value: string; label: string }>;
};

type PublicSection = {
  sectionKey: string;
  title: string;
  helperText: string | null;
  fields: PublicField[];
};

type PublicFormPayload = {
  form: {
    name: string;
    description: string | null;
    formType: string;
    successTitle: string | null;
    successText: string | null;
    privacyNoticeText: string | null;
    privacyNoticeUrl: string | null;
    allowedAcademicYearIds: string[];
    allowedYearGroupIds: string[];
  };
  organisation: { name: string; slug?: string; countryCode?: string };
  branding?: { primaryColor?: string; logoUrl?: string | null; hasLogo?: boolean; tagline?: string | null };
  academicYears?: YearOption[];
  yearGroups?: YearOption[];
  sections: PublicSection[];
};

type YearOption = { id: string; name: string };

function fieldValue(type: string, form: FormData, key: string): unknown {
  if (type === "yes_no" || type === "declaration") return form.get(key) === "on" || form.get(key) === "true";
  if (type === "file") {
    const documentId = String(form.get(`${key}.documentId`) ?? "").trim();
    if (documentId) {
      return {
        documentId,
        filename: String(form.get(`${key}.filename`) ?? "document"),
        contentType: String(form.get(`${key}.contentType`) ?? "application/octet-stream"),
        byteSize: Number(form.get(`${key}.byteSize`) ?? 0),
      };
    }
    const file = form.get(key);
    if (!(file instanceof File) || !file.name) return null;
    return { filename: file.name, contentType: file.type || "application/octet-stream", byteSize: file.size };
  }
  if (type === "multiple_choice") return form.getAll(key);
  if (type === "address_group") {
    return {
      line1: form.get(`${key}.line1`),
      line2: form.get(`${key}.line2`),
      town: form.get(`${key}.town`),
      postcode: form.get(`${key}.postcode`),
    };
  }
  if (type === "guardian_group") {
    const names = form.getAll(`${key}.fullName`);
    return names.map((name, index) => ({
      fullName: String(name),
      email: String(form.getAll(`${key}.email`)[index] ?? ""),
      phone: String(form.getAll(`${key}.phone`)[index] ?? ""),
      relationship: String(form.getAll(`${key}.relationship`)[index] ?? ""),
      parentalResponsibility: form.getAll(`${key}.parentalResponsibility`)[index] === "on",
      primaryContact: form.getAll(`${key}.primaryContact`)[index] === "on",
    }));
  }
  return form.get(key);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.every((item) => isBlank(item));
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).every(isBlank);
  return String(value).trim() === "";
}

function fieldLabel(field: PublicField): string {
  return PUBLIC_LABELS[field.fieldKey] ?? field.label;
}

function requiredMessage(field: PublicField): string {
  const key = field.fieldKey;
  if (key === "child.legal_name") return "Enter the child's legal name.";
  if (key === "child.date_of_birth") return "Enter the child's date of birth.";
  if (key === "child.intended_academic_year_id") return "Select the intended academic year.";
  if (key === "child.intended_year_group_id") return "Select the intended year group.";
  if (key === "child.address") return "Enter the child's home address.";
  if (key === "guardians") return "Enter at least one parent or guardian.";
  return `Enter ${fieldLabel(field).toLowerCase()}.`;
}

function usesUkPostcode(countryCode?: string | null): boolean {
  const code = (countryCode ?? "GB").trim().toUpperCase();
  return code === "GB" || code === "UK";
}

function collectAnswers(form: FormData, sections: PublicSection[]): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const section of sections) {
    for (const field of section.fields) {
      answers[field.fieldKey] = fieldValue(field.questionType, form, field.fieldKey);
    }
  }
  return answers;
}

function sectionComplete(section: PublicSection, answers: Record<string, unknown>): boolean {
  return section.fields.every((field) => !field.required || !isBlank(answers[field.fieldKey]));
}

function validateSection(
  section: PublicSection,
  answers: Record<string, unknown>,
  countryCode?: string | null,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of section.fields) {
    const value = answers[field.fieldKey];
    if (field.required && isBlank(value)) {
      errors[field.fieldKey] = requiredMessage(field);
      continue;
    }
    if (field.questionType === "email" && !isBlank(value)) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
        errors[field.fieldKey] = "Enter a valid email address.";
      }
    }
    if (field.questionType === "address_group" && !isBlank(value)) {
      const rec = asRecord(value);
      const postcode = String(rec?.postcode ?? "").trim();
      if (postcode && usesUkPostcode(countryCode) && !UK_POSTCODE_RE.test(postcode)) {
        errors[field.fieldKey] = "Enter a valid UK postcode.";
      }
    }
    if (field.questionType === "guardian_group" && field.required) {
      const rows = Array.isArray(value) ? value : [];
      const filled = rows.filter((row) => !isBlank(asRecord(row)?.fullName));
      if (!filled.length) errors[field.fieldKey] = requiredMessage(field);
      else if (!filled.some((row) => String(asRecord(row)?.email ?? "").trim())) {
        errors[field.fieldKey] = "Enter at least one parent or guardian email address.";
      }
    }
  }
  return errors;
}

function displayAnswer(
  field: PublicField,
  value: unknown,
  years: YearOption[],
  groups: YearOption[],
): string {
  if (isBlank(value)) return "Not provided";
  if (field.questionType === "yes_no" || field.questionType === "declaration") {
    return value === true || value === "true" ? "Yes" : "No";
  }
  if (field.fieldKey === "child.intended_academic_year_id") {
    return years.find((row) => row.id === String(value))?.name ?? "Selected";
  }
  if (field.fieldKey === "child.intended_year_group_id") {
    return groups.find((row) => row.id === String(value))?.name ?? "Selected";
  }
  if (field.questionType === "address_group") {
    const rec = asRecord(value);
    return [rec?.line1, rec?.line2, rec?.town, rec?.postcode].filter(Boolean).join(", ") || "Not provided";
  }
  if (field.questionType === "guardian_group") {
    const rows = Array.isArray(value) ? value : [];
    return rows
      .map((row) => asRecord(row))
      .filter((row) => row && String(row.fullName ?? "").trim())
      .map((row) => `${row!.fullName}${row!.email ? ` (${row!.email})` : ""}`)
      .join("; ") || "Not provided";
  }
  if (field.questionType === "file") {
    const rec = asRecord(value);
    return rec?.filename ? String(rec.filename) : "Uploaded";
  }
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (field.options?.length) {
    return field.options.find((option) => option.value === String(value))?.label ?? String(value);
  }
  return String(value);
}

function childGroups(fields: PublicField[]): Array<{ title: string; keys: string[] }> {
  return [
    {
      title: "Child information",
      keys: ["child.legal_name", "child.preferred_name", "child.date_of_birth", "child.gender"],
    },
    { title: "Home address", keys: ["child.address"] },
    {
      title: "Application information",
      keys: [
        "child.intended_academic_year_id",
        "child.intended_year_group_id",
        "child.proposed_start_date",
        "child.current_school",
        "child.previous_school",
      ],
    },
  ].map((group) => ({ ...group, keys: group.keys.filter((key) => fields.some((field) => field.fieldKey === key)) }))
    .filter((group) => group.keys.length);
}

function FileUploadField({
  field,
  describedBy,
  requiredMark,
  initial,
  mode,
  formType,
  slug,
  continuation,
  publicId,
  ensureDraft,
  error,
}: {
  field: PublicField;
  describedBy?: string;
  requiredMark: ReactNode;
  initial?: unknown;
  mode: "public" | "staff";
  formType: PublicFormType;
  slug: string;
  continuation: string | null;
  publicId: string | null;
  ensureDraft: () => Promise<{ continuationToken: string; publicId: string }>;
  error?: string;
}) {
  const initialRec = asRecord(initial);
  const [status, setStatus] = useState<"idle" | "uploading" | "complete" | "failed">(
    initialRec?.documentId ? "complete" : "idle",
  );
  const [meta, setMeta] = useState({
    documentId: String(initialRec?.documentId ?? ""),
    filename: String(initialRec?.filename ?? ""),
    contentType: String(initialRec?.contentType ?? ""),
    byteSize: String(initialRec?.byteSize ?? ""),
  });
  const [message, setMessage] = useState(initialRec?.documentId ? "Uploaded" : "");
  const [draftTokens, setDraftTokens] = useState({
    continuationToken: continuation ?? "",
    publicId: publicId ?? "",
  });

  useEffect(() => {
    if (continuation && publicId) {
      setDraftTokens({ continuationToken: continuation, publicId });
    }
  }, [continuation, publicId]);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus("uploading");
    setMessage("Uploading…");
    try {
      const draft = await ensureDraft();
      setDraftTokens(draft);
      const payload = new FormData();
      payload.append("file", file);
      payload.append("fieldKey", field.fieldKey);
      payload.append("continuationToken", draft.continuationToken);
      payload.append("publicId", draft.publicId);
      const body = await api<{
        document: { id: string; filename: string; contentType: string; byteSize: number };
      }>(`/api/v1/public/admissions/forms/${formType}/${slug}/documents`, {
        method: "POST",
        orgId: mode === "staff" ? undefined : null,
        body: payload,
      });
      setMeta({
        documentId: body.document.id,
        filename: body.document.filename,
        contentType: body.document.contentType,
        byteSize: String(body.document.byteSize),
      });
      setStatus("complete");
      setMessage("Uploaded");
    } catch (err) {
      setStatus("failed");
      setMessage(err instanceof Error ? err.message : "Upload failed");
      event.target.value = "";
    }
  }

  async function onRemove() {
    if (meta.documentId) {
      const token = draftTokens.continuationToken;
      const id = draftTokens.publicId;
      if (token && id) {
        await api(
          `/api/v1/public/admissions/forms/${formType}/${slug}/documents/${meta.documentId}?continuationToken=${encodeURIComponent(token)}&publicId=${encodeURIComponent(id)}`,
          { method: "DELETE", orgId: mode === "staff" ? undefined : null },
        ).catch(() => undefined);
      }
    }
    setMeta({ documentId: "", filename: "", contentType: "", byteSize: "" });
    setStatus("idle");
    setMessage("");
  }

  const errorId = `${field.fieldKey}-error`;
  return (
    <div className={`admissions-field span-2${error ? " is-invalid" : ""}`} data-upload-state={status}>
      <span>
        {fieldLabel(field)}
        {requiredMark}
      </span>
      <input type="hidden" name={`${field.fieldKey}.documentId`} value={meta.documentId} />
      <input type="hidden" name={`${field.fieldKey}.filename`} value={meta.filename} />
      <input type="hidden" name={`${field.fieldKey}.contentType`} value={meta.contentType} />
      <input type="hidden" name={`${field.fieldKey}.byteSize`} value={meta.byteSize} />
      <input
        id={field.fieldKey}
        name={field.fieldKey}
        type="file"
        required={field.required && !meta.documentId}
        aria-describedby={[describedBy, error ? errorId : null].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? true : undefined}
        accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => void onFile(event)}
        disabled={status === "uploading"}
      />
      {status === "uploading" ? <small className="muted">Uploading…</small> : null}
      {status === "complete" && meta.filename ? (
        <small>
          {meta.filename}
          {meta.byteSize ? ` · ${Math.max(1, Math.round(Number(meta.byteSize) / 1024))} KB` : ""}
          {" · "}
          <button type="button" className="secondary" onClick={() => void onRemove()}>
            Remove
          </button>
        </small>
      ) : null}
      {status === "failed" ? <small className="admissions-error">{message}</small> : null}
      {status === "idle" ? <small className="muted">PDF, JPEG, PNG, WebP or DOCX, up to 8 MB.</small> : null}
      {field.helperText ? <small id={`${field.fieldKey}-help`} className="muted">{field.helperText}</small> : null}
      {error ? <small id={errorId} className="admissions-error" role="alert">{error}</small> : null}
    </div>
  );
}

function FieldInput({
  field,
  years,
  groups,
  initial,
  mode,
  formType,
  slug,
  continuation,
  publicId,
  ensureDraft,
  error,
  countryCode,
}: {
  field: PublicField;
  years: YearOption[];
  groups: YearOption[];
  initial?: unknown;
  mode: "public" | "staff";
  formType: PublicFormType;
  slug: string;
  continuation: string | null;
  publicId: string | null;
  ensureDraft: () => Promise<{ continuationToken: string; publicId: string }>;
  error?: string;
  countryCode?: string | null;
}) {
  const label = fieldLabel(field);
  const helper = field.helperText || PUBLIC_HELP[field.fieldKey] || null;
  const requiredMark = field.required ? (
    <span className="admissions-req"> (required)</span>
  ) : (
    <span className="admissions-opt"> (optional)</span>
  );
  const describedBy = [helper ? `${field.fieldKey}-help` : null, error ? `${field.fieldKey}-error` : null]
    .filter(Boolean)
    .join(" ") || undefined;
  const help = helper ? <small id={`${field.fieldKey}-help`} className="muted">{helper}</small> : null;
  const err = error ? (
    <small id={`${field.fieldKey}-error`} className="admissions-error" role="alert">
      {error}
    </small>
  ) : null;
  const invalid = Boolean(error);

  if (field.questionType === "long_text") {
    return (
      <label className={`admissions-field span-2${invalid ? " is-invalid" : ""}`}>
        <span>
          {label}
          {requiredMark}
        </span>
        <textarea
          id={field.fieldKey}
          name={field.fieldKey}
          required={field.required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          rows={4}
          defaultValue={initial == null ? "" : String(initial)}
        />
        {help}
        {err}
      </label>
    );
  }
  if (field.questionType === "yes_no" || field.questionType === "declaration") {
    return (
      <label className={`admissions-field span-2 checkbox-row${invalid ? " is-invalid" : ""}`}>
        <input
          type="checkbox"
          id={field.fieldKey}
          name={field.fieldKey}
          value="true"
          required={field.required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          defaultChecked={initial === true || initial === "true"}
        />
        <span>
          {label}
          {field.required ? <span className="admissions-req"> (required)</span> : null}
        </span>
        {help}
        {err}
      </label>
    );
  }
  if (field.questionType === "address_group") {
    const rec = asRecord(initial);
    return (
      <div className={`admissions-field span-2${invalid ? " is-invalid" : ""}`} role="group" aria-labelledby={`${field.fieldKey}-legend`}>
        <span id={`${field.fieldKey}-legend`}>
          {label}
          {requiredMark}
        </span>
        <div className="admissions-grid">
          <label className="admissions-field span-2">
            <span>Address line 1{field.required ? <span className="admissions-req"> (required)</span> : null}</span>
            <input name={`${field.fieldKey}.line1`} required={field.required} autoComplete="address-line1" defaultValue={String(rec?.line1 ?? "")} />
          </label>
          <label className="admissions-field span-2">
            <span>Address line 2<span className="admissions-opt"> (optional)</span></span>
            <input name={`${field.fieldKey}.line2`} autoComplete="address-line2" defaultValue={String(rec?.line2 ?? "")} />
          </label>
          <label className="admissions-field">
            <span>Town / city</span>
            <input name={`${field.fieldKey}.town`} autoComplete="address-level2" defaultValue={String(rec?.town ?? "")} />
          </label>
          <label className="admissions-field">
            <span>Postcode</span>
            <input
              name={`${field.fieldKey}.postcode`}
              autoComplete="postal-code"
              defaultValue={String(rec?.postcode ?? "")}
              inputMode="text"
              aria-describedby={describedBy}
            />
          </label>
        </div>
        {usesUkPostcode(countryCode) ? <small className="muted">Use a UK postcode, for example SW1A 1AA.</small> : null}
        {help}
        {err}
      </div>
    );
  }
  if (field.questionType === "guardian_group") {
    return (
      <div className={`admissions-field span-2${invalid ? " is-invalid" : ""}`} role="group" aria-labelledby={`${field.fieldKey}-legend`}>
        <span id={`${field.fieldKey}-legend`}>
          {label}
          {requiredMark}
        </span>
        {[0, 1].map((index) => {
          const row = Array.isArray(initial) ? asRecord(initial[index]) : null;
          return (
            <div key={index} className="admissions-subsection">
              <h3>{index === 0 ? "Primary parent / guardian" : "Additional parent / guardian"}</h3>
              <div className="admissions-grid">
                <label className="admissions-field">
                  <span>Name{field.required && index === 0 ? <span className="admissions-req"> (required)</span> : <span className="admissions-opt"> (optional)</span>}</span>
                  <input name={`${field.fieldKey}.fullName`} required={field.required && index === 0} defaultValue={String(row?.fullName ?? "")} autoComplete="name" />
                </label>
                <label className="admissions-field">
                  <span>Email{field.required && index === 0 ? <span className="admissions-req"> (required)</span> : <span className="admissions-opt"> (optional)</span>}</span>
                  <input type="email" name={`${field.fieldKey}.email`} required={field.required && index === 0} defaultValue={String(row?.email ?? "")} autoComplete="email" />
                </label>
                <label className="admissions-field">
                  <span>Telephone<span className="admissions-opt"> (optional)</span></span>
                  <input name={`${field.fieldKey}.phone`} defaultValue={String(row?.phone ?? "")} autoComplete="tel" />
                </label>
                <label className="admissions-field">
                  <span>Relationship<span className="admissions-opt"> (optional)</span></span>
                  <input name={`${field.fieldKey}.relationship`} defaultValue={String(row?.relationship ?? "")} />
                </label>
                <label className="admissions-field checkbox-row">
                  <input type="checkbox" name={`${field.fieldKey}.parentalResponsibility`} defaultChecked={row?.parentalResponsibility === true} />
                  <span>Parental responsibility</span>
                </label>
                <label className="admissions-field checkbox-row">
                  <input type="checkbox" name={`${field.fieldKey}.primaryContact`} defaultChecked={row?.primaryContact === true || (!row && index === 0)} />
                  <span>Primary contact</span>
                </label>
              </div>
            </div>
          );
        })}
        {help}
        {err}
      </div>
    );
  }
  if (field.fieldKey === "child.intended_academic_year_id" || field.fieldKey === "child.intended_year_group_id") {
    const options = field.fieldKey === "child.intended_academic_year_id" ? years : groups;
    return (
      <label className={`admissions-field${invalid ? " is-invalid" : ""}`}>
        <span>
          {label}
          {requiredMark}
        </span>
        <select
          name={field.fieldKey}
          id={field.fieldKey}
          required={field.required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          defaultValue={initial == null ? "" : String(initial)}
        >
          <option value="">Select</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
        {help}
        {err}
      </label>
    );
  }
  if (field.questionType === "single_choice") {
    return (
      <label className={`admissions-field${invalid ? " is-invalid" : ""}`}>
        <span>
          {label}
          {requiredMark}
        </span>
        <select
          name={field.fieldKey}
          id={field.fieldKey}
          required={field.required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          defaultValue={initial == null ? "" : String(initial)}
        >
          <option value="">Select</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {help}
        {err}
      </label>
    );
  }
  if (field.questionType === "multiple_choice") {
    const selected = new Set(Array.isArray(initial) ? initial.map(String) : []);
    return (
      <div className={`admissions-field span-2${invalid ? " is-invalid" : ""}`} role="group" aria-labelledby={`${field.fieldKey}-legend`}>
        <span id={`${field.fieldKey}-legend`}>
          {label}
          {requiredMark}
        </span>
        {field.options.map((option) => (
          <label key={option.value} className="checkbox-row">
            <input type="checkbox" name={field.fieldKey} value={option.value} defaultChecked={selected.has(option.value)} />
            {option.label}
          </label>
        ))}
        {help}
        {err}
      </div>
    );
  }
  if (field.questionType === "file") {
    return (
      <FileUploadField
        field={field}
        describedBy={describedBy}
        requiredMark={requiredMark}
        initial={initial}
        mode={mode}
        formType={formType}
        slug={slug}
        continuation={continuation}
        publicId={publicId}
        ensureDraft={ensureDraft}
        error={error}
      />
    );
  }
  const inputType = field.questionType === "email" ? "email" : field.questionType === "date" ? "date" : field.questionType === "number" ? "number" : "text";
  return (
    <label className={`admissions-field${invalid ? " is-invalid" : ""}`}>
      <span>
        {label}
        {requiredMark}
      </span>
      <input
        id={field.fieldKey}
        name={field.fieldKey}
        type={inputType}
        required={field.required}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        defaultValue={initial == null ? "" : String(initial)}
      />
      {help}
      {err}
    </label>
  );
}

export function PublicAdmissionsForm({
  formType,
  slug,
  embed = false,
  mode = "public",
  formId,
  onCreated,
}: {
  formType: PublicFormType;
  slug: string;
  embed?: boolean;
  mode?: "public" | "staff";
  formId?: string;
  onCreated?: (result: {
    applicationId?: string;
    applicationReference?: string;
    enquiryId?: string;
    enquiryReference?: string;
  }) => void;
}) {
  const [payload, setPayload] = useState<PublicFormPayload | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ title: string; text: string; reference?: string } | null>(null);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [publicId, setPublicId] = useState<string | null>(null);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, unknown>>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const continuationRef = useRef<string | null>(null);
  const publicIdRef = useRef<string | null>(null);
  const idempotencyKey = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `form-${Date.now()}`,
  );
  continuationRef.current = continuation;
  publicIdRef.current = publicId;

  const sections = payload?.sections ?? [];
  const isMulti = formType !== "enquiry" && sections.length > 1;
  const reviewIndex = isMulti ? sections.length : -1;
  const totalSteps = isMulti ? sections.length + 1 : Math.max(sections.length, 1);
  const onReview = isMulti && step === reviewIndex;
  const privacyUrl =
    payload?.form.privacyNoticeUrl && /^https?:\/\//i.test(payload.form.privacyNoticeUrl)
      ? payload.form.privacyNoticeUrl
      : null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const load = async () => {
      if (mode === "staff" && formId) {
        const [formBody, yearsBody, groupsBody] = await Promise.all([
          api<{
            form: PublicFormPayload["form"] & { name: string };
            sections: PublicSection[];
          }>(`/api/v1/admissions/forms/${formId}`),
          api<{ academicYears: YearOption[] }>("/api/v1/academic-years"),
          api<{ yearGroups: YearOption[] }>("/api/v1/year-groups"),
        ]);
        const token = params.get("continue");
        if (token) {
          try {
            const draft = await api<{ publicId?: string; answers?: Record<string, unknown> }>(
              `/api/v1/public/admissions/forms/${formType}/${slug}/draft?token=${encodeURIComponent(token)}`,
              { orgId: null },
            );
            setDraftAnswers(draft.answers ?? {});
            setPublicId(draft.publicId ?? null);
            setContinuation(token);
            continuationRef.current = token;
            publicIdRef.current = draft.publicId ?? null;
          } catch {
            setError("This saved draft could not be opened. You can start the form again.");
          }
        }
        setPayload({
          form: {
            ...formBody.form,
            allowedAcademicYearIds: formBody.form.allowedAcademicYearIds ?? [],
            allowedYearGroupIds: formBody.form.allowedYearGroupIds ?? [],
          },
          organisation: { name: "Staff entry" },
          academicYears: yearsBody.academicYears,
          yearGroups: groupsBody.yearGroups,
          sections: formBody.sections.filter((section) => section.fields?.length),
        });
        return;
      }
      const body = await api<PublicFormPayload>(`/api/v1/public/admissions/forms/${formType}/${slug}`, {
        orgId: null,
      });
      const token = params.get("continue");
      if (token) {
        try {
          const draft = await api<{ publicId?: string; answers?: Record<string, unknown> }>(
            `/api/v1/public/admissions/forms/${formType}/${slug}/draft?token=${encodeURIComponent(token)}`,
            { orgId: null },
          );
          setDraftAnswers(draft.answers ?? {});
          setPublicId(draft.publicId ?? null);
          setContinuation(token);
        } catch {
          setError("This saved draft could not be opened. You can start the form again.");
        }
      }
      setPayload(body);
    };
    load().catch((err: Error) => setError(err.message));
  }, [formType, slug, mode, formId]);

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!dirty || done) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty, done]);

  const brandStyle = useMemo(
    () =>
      payload?.branding?.primaryColor
        ? ({ ["--brand" as string]: payload.branding.primaryColor } as CSSProperties)
        : undefined,
    [payload],
  );

  const years = payload?.academicYears ?? [];
  const groups = payload?.yearGroups ?? [];
  const liveAnswers = formRef.current ? collectAnswers(new FormData(formRef.current), sections) : draftAnswers;
  const mergedAnswers = { ...draftAnswers, ...liveAnswers };
  const completed = new Set(
    sections
      .map((section, index) => (sectionComplete(section, mergedAnswers) ? index : -1))
      .filter((index) => index >= 0),
  );
  const currentSection = onReview ? null : sections[step];
  const progressCurrent = Math.min(step, totalSteps - 1);
  const progressPercent = totalSteps <= 1 ? 100 : Math.round(((progressCurrent + (onReview ? 1 : 0)) / totalSteps) * 100);

  async function persistDraft(silent = false) {
    const formEl = formRef.current;
    if (!payload || !formEl) throw new Error("Form is not ready");
    if (!silent) {
      setError("");
      setSaveState("saving");
    }
    const answers = collectAnswers(new FormData(formEl), sections);
    setDraftAnswers(answers);
    const source = new URLSearchParams(window.location.search).get("source") ?? undefined;
    const requestBody: Record<string, unknown> = {
      answers,
      draft: true,
      idempotencyKey: idempotencyKey.current,
    };
    if (source) requestBody.source = source;
    if (mode === "staff") requestBody.source = "staff";
    const token = continuationRef.current;
    const existingPublicId = publicIdRef.current;
    if (token) requestBody.continuationToken = token;
    if (existingPublicId) requestBody.publicId = existingPublicId;
    const path =
      mode === "staff" && formId
        ? `/api/v1/admissions/forms/${formId}/staff-submissions`
        : `/api/v1/public/admissions/forms/${formType}/${slug}/submissions`;
    const body = await api<{
      submission: {
        publicId?: string;
        continuationToken?: string;
        applicationReference?: string;
      };
    }>(path, {
      method: "POST",
      orgId: mode === "staff" ? undefined : null,
      body: JSON.stringify(requestBody),
    });
    if (body.submission.publicId) {
      setPublicId(body.submission.publicId);
      publicIdRef.current = body.submission.publicId;
    }
    const nextToken = body.submission.continuationToken ?? token;
    if (nextToken) {
      setContinuation(nextToken);
      continuationRef.current = nextToken;
      const next = new URL(window.location.href);
      next.searchParams.set("continue", nextToken);
      window.history.replaceState({}, "", next.toString());
    }
    setDirty(false);
    if (!silent) {
      setError("");
      setSaveState("saved");
      setNotice(
        mode === "staff"
          ? "Draft saved."
          : "Draft saved. Keep this page open, or bookmark the link in the address bar to return later. You do not need an account.",
      );
    }
    if (!publicIdRef.current || !continuationRef.current) {
      throw new Error("A saved draft is required before uploading a file");
    }
    return { continuationToken: continuationRef.current, publicId: publicIdRef.current };
  }

  function applyServerError(err: unknown) {
    const message = err instanceof Error ? err.message : "Could not submit the form";
    const looksRaw = /zod|invalid_type|too_small|P0002|sql/i.test(message);
    setError(looksRaw ? "Please check the highlighted fields and try again." : message);
    const fieldKey = err instanceof ApiError ? err.details?.fieldKey : undefined;
    const sectionKey = err instanceof ApiError ? err.details?.sectionKey : undefined;
    if (fieldKey) setFieldErrors({ [fieldKey]: looksRaw ? requiredMessage({ fieldKey, label: fieldKey, questionType: "short_text", helperText: null, required: true, options: [] }) : message });
    const index = sections.findIndex(
      (section) =>
        section.sectionKey === sectionKey ||
        section.fields.some((field) => field.fieldKey === fieldKey),
    );
    if (index >= 0) setStep(index);
    queueMicrotask(() => {
      const target = document.getElementById(fieldKey ?? `${sectionKey ?? ""}-section`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (target instanceof HTMLElement) target.focus();
    });
  }

  async function submitFromForm(draft = false) {
    const formEl = formRef.current;
    if (!payload || !formEl) return;
    if (formEl.querySelector('[data-upload-state="uploading"]')) {
      setError("Please wait for the file upload to finish.");
      return;
    }
    if (submitting || saveState === "saving") return;
    setError("");
    setNotice("");
    const answers = collectAnswers(new FormData(formEl), sections);
    setDraftAnswers(answers);
    try {
      if (draft) {
        await persistDraft(false);
        return;
      }
      setSubmitting(true);
      const source = new URLSearchParams(window.location.search).get("source") ?? undefined;
      const requestBody: Record<string, unknown> = {
        answers,
        draft: false,
        idempotencyKey: idempotencyKey.current,
      };
      if (source) requestBody.source = source;
      if (continuationRef.current) requestBody.continuationToken = continuationRef.current;
      if (publicIdRef.current) requestBody.publicId = publicIdRef.current;
      if (mode === "staff") requestBody.source = "staff";
      const path =
        mode === "staff" && formId
          ? `/api/v1/admissions/forms/${formId}/staff-submissions`
          : `/api/v1/public/admissions/forms/${formType}/${slug}/submissions`;
      const body = await api<{
        submission: {
          publicId?: string;
          enquiryId?: string;
          enquiryReference?: string;
          applicationId?: string;
          applicationReference?: string;
          continuationToken?: string;
        };
      }>(path, {
        method: "POST",
        orgId: mode === "staff" ? undefined : null,
        body: JSON.stringify(requestBody),
      });
      if (body.submission.publicId) setPublicId(body.submission.publicId);
      setDirty(false);
      onCreated?.({
        applicationId: body.submission.applicationId,
        applicationReference: body.submission.applicationReference,
        enquiryId: body.submission.enquiryId,
        enquiryReference: body.submission.enquiryReference,
      });
      if (mode === "staff") return;
      setDone({
        title: payload.form.successTitle ?? "Thank you",
        text: payload.form.successText ?? "We have received your submission.",
        reference: body.submission.enquiryReference ?? body.submission.applicationReference,
      });
    } catch (err) {
      applyServerError(err);
    } finally {
      setSubmitting(false);
    }
  }

  function goNext() {
    const section = sections[step];
    if (!section || !formRef.current) return;
    const answers = collectAnswers(new FormData(formRef.current), sections);
    setDraftAnswers(answers);
    const errors = validateSection(section, answers, payload?.organisation.countryCode);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      const firstKey = Object.keys(errors)[0];
      document.getElementById(firstKey ?? `${section.sectionKey}-section`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const root = document.getElementById(`${section.sectionKey}-section`);
    const firstInvalid = root?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(":invalid");
    if (firstInvalid) {
      firstInvalid.reportValidity();
      return;
    }
    setFieldErrors({});
    setError("");
    setNotice("");
    setStep((value) => Math.min(value + 1, totalSteps - 1));
  }

  function goToStep(index: number) {
    if (index < 0 || index >= totalSteps) return;
    if (index > step) {
      const blocked = sections.slice(0, index).some((section, sectionIndex) => !completed.has(sectionIndex));
      if (blocked && index !== step + 1) return;
    }
    setFieldErrors({});
    setError("");
    setNotice("");
    setStep(index);
  }

  if (error && !payload) {
    return (
      <main className={`admissions-app${embed ? " embed" : ""}`}>
        <h1>Form unavailable</h1>
        <p>This form is not available.</p>
      </main>
    );
  }
  if (!payload) return <main className="admissions-app"><p>Loading…</p></main>;
  if (done) {
    return (
      <main className={`admissions-app${embed ? " embed" : ""}`} style={brandStyle}>
        <div className="admissions-success">
          <p className="admissions-kicker">{payload.organisation.name}</p>
          <h1>{done.title}</h1>
          <p>{done.text}</p>
          {done.reference ? <p className="admissions-ref">Application reference: {done.reference}</p> : null}
        </div>
      </main>
    );
  }

  const fieldProps = {
    years,
    groups,
    mode,
    formType,
    slug,
    continuation,
    publicId,
    ensureDraft: () => persistDraft(true),
    countryCode: payload.organisation.countryCode,
  };
  const currentTitle = onReview ? "Review" : currentSection?.title ?? payload.form.name;
  const logoUrl = payload.branding?.logoUrl;

  return (
    <main className={`admissions-app${embed ? " embed" : ""}`} style={brandStyle}>
      <header className="admissions-header">
        {mode === "public" ? (
          <div className="admissions-header-brand">
            {logoUrl ? <img className="admissions-logo" src={logoUrl} alt="" /> : null}
            <div>
              <p className="admissions-kicker">{payload.organisation.name}</p>
              <h1>Admissions application</h1>
            </div>
          </div>
        ) : (
          <h1>{payload.form.name}</h1>
        )}
        {mode === "public" ? (
          <p className="admissions-lede">
            {payload.form.description ||
              "Complete the sections below. You can save your application and return later using the link in the address bar. You do not need an account."}
          </p>
        ) : payload.form.description ? (
          <p className="admissions-lede">{payload.form.description}</p>
        ) : null}
        {publicId ? <p className="admissions-ref">Draft reference {publicId.slice(0, 8)}</p> : null}
      </header>

      {isMulti ? (
        <nav className="admissions-stepper" aria-label="Application progress">
          <div className="admissions-stepper-meta">
            <strong>
              Step {Math.min(step + 1, totalSteps)} of {totalSteps}
            </strong>
            <span>{currentTitle}</span>
          </div>
          <div className="admissions-progress" aria-hidden="true">
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <ol className="admissions-steps">
            {sections.map((section, index) => {
              const current = index === step;
              const doneStep = !current && completed.has(index);
              return (
                <li key={section.sectionKey}>
                  <button
                    type="button"
                    className={`admissions-step${current ? " is-current" : ""}${doneStep ? " is-complete" : ""}`}
                    aria-current={current ? "step" : undefined}
                    onClick={() => goToStep(index)}
                  >
                    <span className="admissions-step-index">{doneStep ? "✓" : index + 1}</span>
                    <span className="admissions-step-label">{section.title}</span>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                className={`admissions-step${onReview ? " is-current" : ""}`}
                aria-current={onReview ? "step" : undefined}
                onClick={() => goToStep(reviewIndex)}
              >
                <span className="admissions-step-index">{sections.length + 1}</span>
                <span className="admissions-step-label">Review</span>
              </button>
            </li>
          </ol>
          <div className="admissions-stepper-mobile">
            <label>
              Jump to section
              <select
                value={step}
                onChange={(event) => goToStep(Number(event.target.value))}
                aria-label="Application section"
              >
                {sections.map((section, index) => (
                  <option key={section.sectionKey} value={index}>
                    Step {index + 1} of {totalSteps} — {section.title}
                    {completed.has(index) ? " (complete)" : ""}
                  </option>
                ))}
                <option value={reviewIndex}>Step {totalSteps} of {totalSteps} — Review</option>
              </select>
            </label>
          </div>
        </nav>
      ) : null}

      {notice ? (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}

      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          if (isMulti && !onReview) {
            goNext();
            return;
          }
          void submitFromForm(false);
        }}
        onChange={() => {
          setDirty(true);
          if (saveState === "saved") setSaveState("idle");
        }}
      >
        {sections.map((section, index) => {
          const child = section.sectionKey === "child";
          const grouped = child ? childGroups(section.fields) : [];
          const groupedKeys = new Set(grouped.flatMap((group) => group.keys));
          const leftover = section.fields.filter((field) => !groupedKeys.has(field.fieldKey));
          return (
            <section
              id={`${section.sectionKey}-section`}
              key={section.sectionKey}
              className="admissions-card"
              aria-labelledby={`${section.sectionKey}-heading`}
              hidden={isMulti && index !== step}
            >
              <h2 id={`${section.sectionKey}-heading`}>{section.title}</h2>
              {section.helperText ? <p className="muted">{section.helperText}</p> : null}
              {child && grouped.length ? (
                grouped.map((group) => (
                  <div key={group.title} className="admissions-subsection">
                    <h3>{group.title}</h3>
                    <div className="admissions-grid">
                      {group.keys.map((key) => {
                        const field = section.fields.find((item) => item.fieldKey === key);
                        if (!field) return null;
                        return (
                          <FieldInput
                            key={field.fieldKey}
                            field={field}
                            {...fieldProps}
                            initial={draftAnswers[field.fieldKey]}
                            error={fieldErrors[field.fieldKey]}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : null}
              {child && leftover.length ? (
                <div className="admissions-grid">
                  {leftover.map((field) => (
                    <FieldInput
                      key={field.fieldKey}
                      field={field}
                      {...fieldProps}
                      initial={draftAnswers[field.fieldKey]}
                      error={fieldErrors[field.fieldKey]}
                    />
                  ))}
                </div>
              ) : null}
              {!child ? (
                <div className="admissions-grid">
                  {section.fields.map((field) => (
                    <FieldInput
                      key={field.fieldKey}
                      field={field}
                      {...fieldProps}
                      initial={draftAnswers[field.fieldKey]}
                      error={fieldErrors[field.fieldKey]}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}

        {onReview ? (
          <section className="admissions-card" aria-labelledby="review-heading">
            <h2 id="review-heading">Review your application</h2>
            <p className="muted">Check each section before you submit. You can still edit anything that needs changing.</p>
            <div className="admissions-review">
              {sections.map((section, index) => (
                <article key={section.sectionKey} className="admissions-review-block">
                  <header>
                    <h3>{section.title}</h3>
                    <button type="button" className="secondary" onClick={() => goToStep(index)}>
                      Edit
                    </button>
                  </header>
                  <dl>
                    {section.fields.map((field) => (
                      <div key={field.fieldKey} style={{ display: "contents" }}>
                        <dt>{fieldLabel(field)}</dt>
                        <dd>{displayAnswer(field, mergedAnswers[field.fieldKey], years, groups)}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {payload.form.privacyNoticeText ? <p className="muted">{payload.form.privacyNoticeText}</p> : null}
        {privacyUrl ? (
          <p>
            <a href={privacyUrl} rel="noreferrer">Privacy notice</a>
          </p>
        ) : null}

        <div className="admissions-actions">
          {isMulti && step > 0 ? (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setError("");
                setNotice("");
                setFieldErrors({});
                setStep((value) => value - 1);
              }}
            >
              Back
            </button>
          ) : (
            <span />
          )}
          <div className="admissions-actions-end">
            {formType !== "enquiry" ? (
              <button
                type="button"
                className="secondary"
                disabled={saveState === "saving" || submitting}
                onClick={() => void submitFromForm(true)}
              >
                {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Save draft"}
              </button>
            ) : null}
            {isMulti && !onReview ? (
              <button type="button" onClick={goNext}>
                Continue
              </button>
            ) : (
              <button type="submit" disabled={submitting}>
                {submitting ? "Submitting..." : isMulti ? "Submit application" : "Submit"}
              </button>
            )}
          </div>
        </div>
      </form>
    </main>
  );
}
