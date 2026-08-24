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
  organisation: { name: string };
  branding?: { primaryColor?: string };
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
      const publicId = draftTokens.publicId;
      if (token && publicId) {
        await api(
          `/api/v1/public/admissions/forms/${formType}/${slug}/documents/${meta.documentId}?continuationToken=${encodeURIComponent(token)}&publicId=${encodeURIComponent(publicId)}`,
          { method: "DELETE", orgId: mode === "staff" ? undefined : null },
        ).catch(() => undefined);
      }
    }
    setMeta({ documentId: "", filename: "", contentType: "", byteSize: "" });
    setStatus("idle");
    setMessage("");
  }

  return (
    <label className="span-2" data-upload-state={status}>
      {field.label}
      {requiredMark}
      <input type="hidden" name={`${field.fieldKey}.documentId`} value={meta.documentId} />
      <input type="hidden" name={`${field.fieldKey}.filename`} value={meta.filename} />
      <input type="hidden" name={`${field.fieldKey}.contentType`} value={meta.contentType} />
      <input type="hidden" name={`${field.fieldKey}.byteSize`} value={meta.byteSize} />
      <input
        id={field.fieldKey}
        name={field.fieldKey}
        type="file"
        required={field.required && !meta.documentId}
        aria-describedby={describedBy}
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
      {status === "failed" ? <small className="error">{message}</small> : null}
      {status === "idle" ? (
        <small className="muted">PDF, JPEG, PNG, WebP or DOCX, up to 8 MB.</small>
      ) : null}
      {field.helperText ? <small id={`${field.fieldKey}-help`} className="muted">{field.helperText}</small> : null}
    </label>
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
}) {
  const requiredMark = field.required ? <span aria-hidden="true"> *</span> : null;
  const describedBy = field.helperText ? `${field.fieldKey}-help` : undefined;
  if (field.questionType === "long_text") {
    return (
      <label className="span-2">
        {field.label}
        {requiredMark}
        <textarea id={field.fieldKey} name={field.fieldKey} required={field.required} aria-describedby={describedBy} rows={4} defaultValue={initial == null ? "" : String(initial)} />
        {field.helperText ? <small id={`${field.fieldKey}-help`} className="muted">{field.helperText}</small> : null}
      </label>
    );
  }
  if (field.questionType === "yes_no" || field.questionType === "declaration") {
    return (
      <label className="span-2" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" name={field.fieldKey} value="true" required={field.required} aria-describedby={describedBy} defaultChecked={initial === true || initial === "true"} />
        <span>
          {field.label}
          {requiredMark}
        </span>
      </label>
    );
  }
  if (field.questionType === "address_group") {
    return (
      <fieldset className="span-2">
        <legend>
          {field.label}
          {requiredMark}
        </legend>
        <div className="form-grid">
          <label>Line 1<input name={`${field.fieldKey}.line1`} required={field.required} defaultValue={String(asRecord(initial)?.line1 ?? "")} /></label>
          <label>Line 2<input name={`${field.fieldKey}.line2`} defaultValue={String(asRecord(initial)?.line2 ?? "")} /></label>
          <label>Town<input name={`${field.fieldKey}.town`} defaultValue={String(asRecord(initial)?.town ?? "")} /></label>
          <label>Postcode<input name={`${field.fieldKey}.postcode`} defaultValue={String(asRecord(initial)?.postcode ?? "")} /></label>
        </div>
      </fieldset>
    );
  }
  if (field.questionType === "guardian_group") {
    return (
      <fieldset className="span-2">
        <legend>
          {field.label}
          {requiredMark}
        </legend>
        {[0, 1].map((index) => {
          const row = Array.isArray(initial) ? asRecord(initial[index]) : null;
          return (
          <div key={index} className="form-grid" style={{ marginBottom: 12 }}>
            <label>Name<input name={`${field.fieldKey}.fullName`} required={field.required && index === 0} defaultValue={String(row?.fullName ?? "")} /></label>
            <label>Email<input type="email" name={`${field.fieldKey}.email`} required={field.required && index === 0} defaultValue={String(row?.email ?? "")} /></label>
            <label>Telephone<input name={`${field.fieldKey}.phone`} defaultValue={String(row?.phone ?? "")} /></label>
            <label>Relationship<input name={`${field.fieldKey}.relationship`} defaultValue={String(row?.relationship ?? "")} /></label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" name={`${field.fieldKey}.parentalResponsibility`} defaultChecked={row?.parentalResponsibility === true} /> Parental responsibility
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" name={`${field.fieldKey}.primaryContact`} defaultChecked={row?.primaryContact === true || (!row && index === 0)} /> Primary contact
            </label>
          </div>
          );
        })}
      </fieldset>
    );
  }
  if (field.fieldKey === "child.intended_academic_year_id") {
    return (
      <label>
        {field.label}
        {requiredMark}
        <select name={field.fieldKey} required={field.required} aria-describedby={describedBy} defaultValue={initial == null ? "" : String(initial)}>
          <option value="">Select</option>
          {years.map((year) => (
            <option key={year.id} value={year.id}>{year.name}</option>
          ))}
        </select>
      </label>
    );
  }
  if (field.fieldKey === "child.intended_year_group_id") {
    return (
      <label>
        {field.label}
        {requiredMark}
        <select name={field.fieldKey} required={field.required} aria-describedby={describedBy} defaultValue={initial == null ? "" : String(initial)}>
          <option value="">Select</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>{group.name}</option>
          ))}
        </select>
      </label>
    );
  }
  if (field.questionType === "single_choice") {
    return (
      <label>
        {field.label}
        {requiredMark}
        <select name={field.fieldKey} required={field.required} aria-describedby={describedBy} defaultValue={initial == null ? "" : String(initial)}>
          <option value="">Select</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    );
  }
  if (field.questionType === "multiple_choice") {
    const selected = new Set(Array.isArray(initial) ? initial.map(String) : []);
    return (
      <fieldset className="span-2">
        <legend>
          {field.label}
          {requiredMark}
        </legend>
        {field.options.map((option) => (
          <label key={option.value} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" name={field.fieldKey} value={option.value} defaultChecked={selected.has(option.value)} />
            {option.label}
          </label>
        ))}
        {field.helperText ? <small id={`${field.fieldKey}-help`} className="muted">{field.helperText}</small> : null}
      </fieldset>
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
      />
    );
  }
  const inputType = field.questionType === "email" ? "email" : field.questionType === "date" ? "date" : field.questionType === "number" ? "number" : "text";
  return (
    <label>
      {field.label}
      {requiredMark}
      <input id={field.fieldKey} name={field.fieldKey} type={inputType} required={field.required} aria-describedby={describedBy} defaultValue={initial == null ? "" : String(initial)} />
      {field.helperText ? <small id={`${field.fieldKey}-help`} className="muted">{field.helperText}</small> : null}
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
  const [done, setDone] = useState<{ title: string; text: string; reference?: string } | null>(null);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [publicId, setPublicId] = useState<string | null>(null);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, unknown>>({});
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

  const brandStyle = useMemo(
    () =>
      payload?.branding?.primaryColor
        ? ({ ["--brand" as string]: payload.branding.primaryColor } as CSSProperties)
        : undefined,
    [payload],
  );

  const years = payload?.academicYears ?? [];
  const groups = payload?.yearGroups ?? [];

  async function persistDraft(silent = false) {
    const formEl = formRef.current;
    if (!payload || !formEl) throw new Error("Form is not ready");
    if (!silent) setError("");
    const form = new FormData(formEl);
    const answers: Record<string, unknown> = {};
    for (const section of sections) {
      for (const field of section.fields) {
        answers[field.fieldKey] = fieldValue(field.questionType, form, field.fieldKey);
      }
    }
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
      if (mode === "public") {
        const next = new URL(window.location.href);
        next.searchParams.set("continue", nextToken);
        window.history.replaceState({}, "", next.toString());
      }
    }
    if (!silent) {
      setError("");
      alert(mode === "staff" ? "Draft saved." : "Draft saved. Keep this page or the continuation link to resume later.");
    }
    if (!publicIdRef.current || !continuationRef.current) {
      throw new Error("A saved draft is required before uploading a file");
    }
    return { continuationToken: continuationRef.current, publicId: publicIdRef.current };
  }

  async function submitFromForm(draft = false) {
    const formEl = formRef.current;
    if (!payload || !formEl) return;
    if (formEl.querySelector('[data-upload-state="uploading"]')) {
      setError("Please wait for the file upload to finish.");
      return;
    }
    setError("");
    const form = new FormData(formEl);
    const answers: Record<string, unknown> = {};
    for (const section of sections) {
      for (const field of section.fields) {
        answers[field.fieldKey] = fieldValue(field.questionType, form, field.fieldKey);
      }
    }
    try {
      if (draft) {
        await persistDraft(false);
        return;
      }
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
      const message = err instanceof Error ? err.message : "Could not submit the form";
      setError(message);
      const fieldKey = err instanceof ApiError ? err.details?.fieldKey : undefined;
      const sectionKey = err instanceof ApiError ? err.details?.sectionKey : undefined;
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
  }

  if (error && !payload) {
    return (
      <main className={`public-form${embed ? " embed" : ""}`}>
        <h1>Form unavailable</h1>
        <p>This form is not available.</p>
      </main>
    );
  }
  if (!payload) return <main className="public-form"><p>Loading…</p></main>;
  if (done) {
    return (
      <main className={`public-form${embed ? " embed" : ""}`} style={brandStyle}>
        <p className="muted">{payload.organisation.name}</p>
        <h1>{done.title}</h1>
        <p>{done.text}</p>
        {done.reference ? <p className="muted">Reference: {done.reference}</p> : null}
      </main>
    );
  }

  return (
    <main className={`public-form${embed ? " embed" : ""}`} style={brandStyle}>
      {mode === "public" ? <p className="muted">{payload.organisation.name}</p> : null}
      <h1>{payload.form.name}</h1>
      {payload.form.description ? <p>{payload.form.description}</p> : null}
      {isMulti ? (
        <ol className="form-steps" aria-label="Application steps">
          {sections.map((section, index) => (
            <li key={section.sectionKey} aria-current={index === step ? "step" : undefined}>
              {section.title}
            </li>
          ))}
        </ol>
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
          void submitFromForm(false);
        }}
      >
        {sections.map((section, index) => (
          <section
            id={`${section.sectionKey}-section`}
            key={section.sectionKey}
            className="card"
            aria-labelledby={`${section.sectionKey}-heading`}
            hidden={isMulti && index !== step}
          >
            <h2 id={`${section.sectionKey}-heading`}>{section.title}</h2>
            {section.helperText ? <p className="muted">{section.helperText}</p> : null}
            <div className="form-grid">
              {section.fields.map((field) => (
                <FieldInput
                  key={field.fieldKey}
                  field={field}
                  years={years}
                  groups={groups}
                  initial={draftAnswers[field.fieldKey]}
                  mode={mode}
                  formType={formType}
                  slug={slug}
                  continuation={continuation}
                  publicId={publicId}
                  ensureDraft={() => persistDraft(true)}
                />
              ))}
            </div>
          </section>
        ))}
        {payload.form.privacyNoticeText ? <p className="muted">{payload.form.privacyNoticeText}</p> : null}
        {privacyUrl ? (
          <p>
            <a href={privacyUrl} rel="noreferrer">Privacy notice</a>
          </p>
        ) : null}
        <div className="toolbar">
          {isMulti && step > 0 ? (
            <button type="button" className="secondary" onClick={() => setStep((value) => value - 1)}>
              Back
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {formType !== "enquiry" ? (
              <button type="button" className="secondary" onClick={() => void submitFromForm(true)}>
                Save draft
              </button>
            ) : null}
            {isMulti && step < sections.length - 1 ? (
              <button
                type="button"
                onClick={() => {
                  const root = document.getElementById(`${sections[step]?.sectionKey}-section`);
                  const firstInvalid = root?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(":invalid");
                  if (firstInvalid) {
                    firstInvalid.reportValidity();
                    return;
                  }
                  setStep((value) => value + 1);
                }}
              >
                Continue
              </button>
            ) : (
              <button type="submit">Submit</button>
            )}
          </div>
        </div>
      </form>
    </main>
  );
}
