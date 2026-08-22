"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "./api";

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

function FieldInput({
  field,
  years,
  groups,
  initial,
}: {
  field: PublicField;
  years: YearOption[];
  groups: YearOption[];
  initial?: unknown;
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
}: {
  formType: "enquiry" | "application";
  slug: string;
  embed?: boolean;
}) {
  const [payload, setPayload] = useState<PublicFormPayload | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ title: string; text: string; reference?: string } | null>(null);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [publicId, setPublicId] = useState<string | null>(null);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, unknown>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const idempotencyKey = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `form-${Date.now()}`,
  );

  const sections = payload?.sections ?? [];
  const isMulti = formType === "application" && sections.length > 1;
  const privacyUrl =
    payload?.form.privacyNoticeUrl && /^https?:\/\//i.test(payload.form.privacyNoticeUrl)
      ? payload.form.privacyNoticeUrl
      : null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    api<PublicFormPayload>(`/api/v1/public/admissions/forms/${formType}/${slug}`, { orgId: null })
      .then(async (body) => {
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
      })
      .catch((err: Error) => setError(err.message));
  }, [formType, slug]);

  const brandStyle = useMemo(
    () =>
      payload?.branding?.primaryColor
        ? ({ ["--brand" as string]: payload.branding.primaryColor } as CSSProperties)
        : undefined,
    [payload],
  );

  const years = payload?.academicYears ?? [];
  const groups = payload?.yearGroups ?? [];

  async function submitFromForm(draft = false) {
    const formEl = formRef.current;
    if (!payload || !formEl) return;
    setError("");
    const form = new FormData(formEl);
    const answers: Record<string, unknown> = {};
    for (const section of sections) {
      for (const field of section.fields) {
        answers[field.fieldKey] = fieldValue(field.questionType, form, field.fieldKey);
      }
    }
    try {
      const source = new URLSearchParams(window.location.search).get("source") ?? undefined;
      const body = await api<{
        submission: {
          publicId?: string;
          enquiryReference?: string;
          applicationReference?: string;
          continuationToken?: string;
        };
      }>(`/api/v1/public/admissions/forms/${formType}/${slug}/submissions`, {
        method: "POST",
        orgId: null,
        body: JSON.stringify({
          answers,
          source,
          draft,
          continuationToken: continuation,
          publicId,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      if (body.submission.publicId) setPublicId(body.submission.publicId);
      if (draft) {
        const token = body.submission.continuationToken ?? continuation;
        setContinuation(token);
        setError("");
        if (token) {
          const next = new URL(window.location.href);
          next.searchParams.set("continue", token);
          window.history.replaceState({}, "", next.toString());
        }
        alert("Draft saved. Keep this page or the continuation link to resume later.");
        return;
      }
      setDone({
        title: payload.form.successTitle ?? "Thank you",
        text: payload.form.successText ?? "We have received your submission.",
        reference: body.submission.enquiryReference ?? body.submission.applicationReference,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the form");
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
      <p className="muted">{payload.organisation.name}</p>
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
                <FieldInput key={field.fieldKey} field={field} years={years} groups={groups} initial={draftAnswers[field.fieldKey]} />
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
            {formType === "application" ? (
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
