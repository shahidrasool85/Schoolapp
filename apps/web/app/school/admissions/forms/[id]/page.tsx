"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ADMISSIONS_CANONICAL_FIELD_CATALOGUE,
  ADMISSIONS_DOCUMENT_PURPOSES,
  ADMISSIONS_STRUCTURE_CHOICE_KEYS,
} from "@schoolapp/domain";
import { api } from "../../../../../lib/api";

const CUSTOM_QUESTION_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "date",
  "number",
  "single_choice",
  "multiple_choice",
  "yes_no",
  "declaration",
  "file",
] as const;

const STRUCTURE_KEYS = new Set<string>(ADMISSIONS_STRUCTURE_CHOICE_KEYS);

type EditorOption = { value: string; label: string };
type EditorField = {
  fieldKey: string;
  fieldKind: "canonical" | "custom";
  canonicalKey: string | null;
  questionType: string;
  label: string;
  helperText: string;
  required: boolean;
  enabled: boolean;
  options: EditorOption[];
  documentPurpose: string | null;
};
type EditorSection = {
  sectionKey: string;
  title: string;
  helperText: string;
  enabled: boolean;
  fields: EditorField[];
};

type FormMeta = {
  id: string;
  name: string;
  slug: string;
  formType: string;
  status: string;
  successTitle: string | null;
  successText: string | null;
  privacyNoticeText: string | null;
};

type FormDetail = {
  form: FormMeta;
  sections: Array<{
    sectionKey: string;
    title: string;
    helperText: string | null;
    enabled: boolean;
    fields: Array<{
      fieldKey: string;
      fieldKind: "canonical" | "custom";
      canonicalKey: string | null;
      questionType: string;
      label: string;
      helperText: string | null;
      required: boolean;
      enabled: boolean;
      options: EditorOption[] | null;
      documentPurpose: string | null;
    }>;
  }>;
};

function slugKey(value: string, fallback: string): string {
  const key = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return key || fallback;
}

function toEditor(detail: FormDetail): EditorSection[] {
  return detail.sections.map((section) => ({
    sectionKey: section.sectionKey,
    title: section.title,
    helperText: section.helperText ?? "",
    enabled: section.enabled,
    fields: section.fields.map((field) => ({
      fieldKey: field.fieldKey,
      fieldKind: field.fieldKind,
      canonicalKey: field.canonicalKey,
      questionType: field.questionType,
      label: field.label,
      helperText: field.helperText ?? "",
      required: field.required,
      enabled: field.enabled,
      options: Array.isArray(field.options) ? field.options.map((option) => ({ ...option })) : [],
      documentPurpose: field.documentPurpose,
    })),
  }));
}

function move<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const next = index + direction;
  if (next < 0 || next >= items.length) return items;
  const copy = items.slice();
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item!);
  return copy;
}

export default function AdmissionsFormDetailPage() {
  const params = useParams<{ id: string }>();
  const [form, setForm] = useState<FormMeta | null>(null);
  const [sections, setSections] = useState<EditorSection[]>([]);
  const [share, setShare] = useState<{ publicUrl: string; embedCode: string; qrSvg: string | null } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [customType, setCustomType] = useState<(typeof CUSTOM_QUESTION_TYPES)[number]>("short_text");
  const [customLabel, setCustomLabel] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [canonicalKey, setCanonicalKey] = useState("");
  const [targetSection, setTargetSection] = useState(0);

  const usedCanonical = useMemo(() => {
    const keys = new Set<string>();
    for (const section of sections) {
      for (const field of section.fields) {
        if (field.canonicalKey) keys.add(field.canonicalKey);
      }
    }
    return keys;
  }, [sections]);

  const availableCanonical = ADMISSIONS_CANONICAL_FIELD_CATALOGUE.filter((item) => !usedCanonical.has(item.key));

  async function load(replaceSections: boolean) {
    const [detail, shareBody] = await Promise.all([
      api<FormDetail>(`/api/v1/admissions/forms/${params.id}`),
      api<{ publicUrl: string; embedCode: string; qrSvg: string | null }>(`/api/v1/admissions/forms/${params.id}/share`),
    ]);
    setForm(detail.form);
    if (replaceSections) setSections(toEditor(detail));
    setShare(shareBody);
  }

  useEffect(() => {
    load(true).catch((err: Error) => setError(err.message));
  }, [params.id]);

  function updateSection(index: number, patch: Partial<EditorSection>) {
    setSections((current) => current.map((section, i) => (i === index ? { ...section, ...patch } : section)));
  }

  function updateField(sectionIndex: number, fieldIndex: number, patch: Partial<EditorField>) {
    setSections((current) =>
      current.map((section, i) =>
        i === sectionIndex
          ? {
              ...section,
              fields: section.fields.map((field, j) => (j === fieldIndex ? { ...field, ...patch } : field)),
            }
          : section,
      ),
    );
  }

  function addSection() {
    const title = sectionTitle.trim();
    if (!title) return;
    const base = slugKey(title, "section");
    const taken = new Set(sections.map((section) => section.sectionKey));
    let key = base;
    let n = 2;
    while (taken.has(key)) {
      key = `${base}_${n}`;
      n += 1;
    }
    setSections((current) => [...current, { sectionKey: key, title, helperText: "", enabled: true, fields: [] }]);
    setSectionTitle("");
  }

  function addCustom(sectionIndex: number) {
    const label = customLabel.trim();
    if (!label) return;
    const taken = new Set(sections.flatMap((section) => section.fields.map((field) => field.fieldKey)));
    let key = slugKey(label, "question");
    let n = 2;
    while (taken.has(key) || key.length < 2) {
      key = `${slugKey(label, "question")}_${n}`.slice(0, 63);
      n += 1;
    }
    const choice = customType === "single_choice" || customType === "multiple_choice";
    const field: EditorField = {
      fieldKey: key,
      fieldKind: "custom",
      canonicalKey: null,
      questionType: customType,
      label,
      helperText: "",
      required: false,
      enabled: true,
      options: choice ? [{ value: "option_1", label: "Option 1" }] : [],
      documentPurpose: customType === "file" ? "other" : null,
    };
    setSections((current) =>
      current.map((section, i) => (i === sectionIndex ? { ...section, fields: [...section.fields, field] } : section)),
    );
    setCustomLabel("");
  }

  function addCanonical(sectionIndex: number) {
    const item = ADMISSIONS_CANONICAL_FIELD_CATALOGUE.find((row) => row.key === canonicalKey);
    if (!item || usedCanonical.has(item.key)) return;
    const field: EditorField = {
      fieldKey: item.key,
      fieldKind: "canonical",
      canonicalKey: item.key,
      questionType: item.questionType,
      label: item.label,
      helperText: STRUCTURE_KEYS.has(item.key) ? "Choices come from this school's academic structure." : "",
      required: false,
      enabled: true,
      options:
        item.key === "child.gender"
          ? [
              { value: "female", label: "Female" },
              { value: "male", label: "Male" },
              { value: "prefer_not_to_say", label: "Prefer not to say" },
            ]
          : [],
      documentPurpose: null,
    };
    setSections((current) =>
      current.map((section, i) => (i === sectionIndex ? { ...section, fields: [...section.fields, field] } : section)),
    );
    setCanonicalKey("");
  }

  async function saveMeta(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    try {
      const saved = await api<{ form: FormMeta }>(`/api/v1/admissions/forms/${params.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: data.get("name"),
          slug: data.get("slug"),
          successTitle: data.get("successTitle"),
          successText: data.get("successText"),
          privacyNoticeText: data.get("privacyNoticeText"),
        }),
      });
      setForm(saved.form);
      setMessage("Form details saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this form.");
    }
  }

  async function saveDefinition() {
    setError("");
    try {
      const saved = await api<FormDetail>(`/api/v1/admissions/forms/${params.id}/definition`, {
        method: "PUT",
        body: JSON.stringify({
          sections: sections.map((section, sectionIndex) => ({
            sectionKey: section.sectionKey,
            title: section.title,
            helperText: section.helperText || null,
            sortOrder: sectionIndex,
            enabled: section.enabled,
            fields: section.fields.map((field, fieldIndex) => ({
              fieldKey: field.fieldKey,
              fieldKind: field.fieldKind,
              canonicalKey: field.canonicalKey,
              questionType: field.questionType,
              label: field.label,
              helperText: field.helperText || null,
              required: field.required,
              enabled: field.enabled,
              sortOrder: fieldIndex,
              options: field.options.filter((option) => option.value.trim() && option.label.trim()),
              documentPurpose: field.documentPurpose,
            })),
          })),
        }),
      });
      setForm(saved.form);
      setSections(toEditor(saved));
      setMessage("Questions saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the questions.");
    }
  }

  async function publish(path: "publish" | "unpublish") {
    setError("");
    try {
      await api(`/api/v1/admissions/forms/${params.id}/${path}`, { method: "POST", body: "{}" });
      setMessage(path === "publish" ? "Published." : "Unpublished.");
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update publication.");
    }
  }

  if (error && !form) return <p className="error">{error}</p>;
  if (!form) return <p>Loading…</p>;

  return (
    <>
      <h1>{form.name}</h1>
      <p className="muted">
        {form.formType} · {form.status}
      </p>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p>{message}</p> : null}
      <form className="card stack" onSubmit={saveMeta}>
        <label>
          Name
          <input name="name" defaultValue={form.name} required />
        </label>
        <label>
          Slug
          <input name="slug" defaultValue={form.slug} required />
        </label>
        <label>
          Success title
          <input name="successTitle" defaultValue={form.successTitle ?? ""} maxLength={120} />
        </label>
        <label>
          Success text
          <textarea name="successText" defaultValue={form.successText ?? ""} />
        </label>
        <label>
          Privacy notice text
          <textarea name="privacyNoticeText" defaultValue={form.privacyNoticeText ?? ""} />
        </label>
        <button type="submit">Save details</button>
      </form>
      <div className="toolbar">
        <button type="button" onClick={() => void publish("publish")}>
          Publish
        </button>
        <button type="button" className="secondary" onClick={() => void publish("unpublish")}>
          Unpublish
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void api(`/api/v1/admissions/forms/${params.id}/duplicate`, { method: "POST", body: "{}" })
              .then((body) => {
                window.location.href = `/school/admissions/forms/${(body as { form: { id: string } }).form.id}`;
              })
              .catch((err: Error) => setError(err.message))
          }
        >
          Duplicate
        </button>
      </div>
      {share ? (
        <section className="card">
          <h2>Share</h2>
          <p>
            Public URL: <code>{share.publicUrl}</code>
          </p>
          <button type="button" className="secondary" onClick={() => void navigator.clipboard.writeText(share.publicUrl)}>
            Copy link
          </button>
          <pre style={{ whiteSpace: "pre-wrap" }}>{share.embedCode}</pre>
          <button type="button" className="secondary" onClick={() => void navigator.clipboard.writeText(share.embedCode)}>
            Copy embed code
          </button>
          {share.qrSvg ? (
            <div
              dangerouslySetInnerHTML={{ __html: share.qrSvg }}
              style={{ width: 180 }}
              aria-label="QR code for the public form"
            />
          ) : (
            <p className="muted">Publish the form to generate a QR code.</p>
          )}
        </section>
      ) : null}

      <h2>Questions</h2>
      <p className="muted">
        Turn sections and questions on or off, change labels and help text, and set the choices for your own questions.
        Academic year, year group, and entry term use this school&apos;s structure. Medical and SEND questions stay available
        for schools that want them; a registration template does not include them until you add them.
      </p>
      <div className="card form-grid">
        <label>
          New section
          <input value={sectionTitle} onChange={(event) => setSectionTitle(event.target.value)} placeholder="Additional information" />
        </label>
        <button type="button" className="secondary" onClick={addSection}>
          Add section
        </button>
      </div>

      {sections.map((section, sectionIndex) => (
        <section key={section.sectionKey} className="card stack">
          <div className="toolbar">
            <strong>{section.title || "Untitled section"}</strong>
            <button type="button" className="secondary" onClick={() => setSections((current) => move(current, sectionIndex, -1))}>
              Move up
            </button>
            <button type="button" className="secondary" onClick={() => setSections((current) => move(current, sectionIndex, 1))}>
              Move down
            </button>
          </div>
          <label>
            Section title
            <input value={section.title} onChange={(event) => updateSection(sectionIndex, { title: event.target.value })} />
          </label>
          <label>
            Section help
            <textarea
              value={section.helperText}
              onChange={(event) => updateSection(sectionIndex, { helperText: event.target.value })}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={section.enabled}
              onChange={(event) => updateSection(sectionIndex, { enabled: event.target.checked })}
            />
            Section enabled
          </label>
          {section.fields.map((field, fieldIndex) => {
            const choice = field.questionType === "single_choice" || field.questionType === "multiple_choice";
            const structure = field.canonicalKey ? STRUCTURE_KEYS.has(field.canonicalKey) : false;
            return (
              <div key={field.fieldKey} className="card stack">
                <div className="toolbar">
                  <span>
                    {field.fieldKind === "canonical" ? "School record" : "Custom question"} · {field.questionType}
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      updateSection(sectionIndex, { fields: move(section.fields, fieldIndex, -1) })
                    }
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      updateSection(sectionIndex, { fields: move(section.fields, fieldIndex, 1) })
                    }
                  >
                    Down
                  </button>
                </div>
                <label>
                  Label
                  <input value={field.label} onChange={(event) => updateField(sectionIndex, fieldIndex, { label: event.target.value })} />
                </label>
                <label>
                  Help text
                  <textarea
                    value={field.helperText}
                    onChange={(event) => updateField(sectionIndex, fieldIndex, { helperText: event.target.value })}
                  />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={field.enabled}
                    onChange={(event) => updateField(sectionIndex, fieldIndex, { enabled: event.target.checked })}
                  />
                  Enabled
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(event) => updateField(sectionIndex, fieldIndex, { required: event.target.checked })}
                  />
                  Required
                </label>
                {field.questionType === "file" ? (
                  <label>
                    Document purpose
                    <select
                      value={field.documentPurpose ?? "other"}
                      onChange={(event) => updateField(sectionIndex, fieldIndex, { documentPurpose: event.target.value })}
                    >
                      {ADMISSIONS_DOCUMENT_PURPOSES.map((purpose) => (
                        <option key={purpose} value={purpose}>
                          {purpose.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {choice && structure ? (
                  <p className="muted">Options are the school&apos;s academic years, year groups, or terms.</p>
                ) : null}
                {choice && !structure ? (
                  <div className="stack">
                    <span>Choices</span>
                    {field.options.map((option, optionIndex) => (
                      <div key={optionIndex} className="form-grid">
                        <label>
                          Stored value
                          <input
                            value={option.value}
                            onChange={(event) => {
                              const options = field.options.slice();
                              options[optionIndex] = { ...option, value: event.target.value };
                              updateField(sectionIndex, fieldIndex, { options });
                            }}
                          />
                        </label>
                        <label>
                          Label
                          <input
                            value={option.label}
                            onChange={(event) => {
                              const options = field.options.slice();
                              options[optionIndex] = { ...option, label: event.target.value };
                              updateField(sectionIndex, fieldIndex, { options });
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            updateField(sectionIndex, fieldIndex, {
                              options: field.options.filter((_, i) => i !== optionIndex),
                            })
                          }
                        >
                          Remove choice
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        updateField(sectionIndex, fieldIndex, {
                          options: [...field.options, { value: `option_${field.options.length + 1}`, label: "New option" }],
                        })
                      }
                    >
                      Add choice
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}
      <div className="card stack">
        <h3>Add a question</h3>
        <label>
          Section
          <select value={String(targetSection)} onChange={(event) => setTargetSection(Number(event.target.value))}>
            {sections.map((section, index) => (
              <option key={section.sectionKey} value={index}>
                {section.title || section.sectionKey}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            School-record field
            <select value={canonicalKey} onChange={(event) => setCanonicalKey(event.target.value)}>
              <option value="">Select</option>
              {availableCanonical.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary" onClick={() => addCanonical(targetSection)}>
            Add field
          </button>
        </div>
        <div className="form-grid">
          <label>
            Custom question
            <input value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} placeholder="Question label" />
          </label>
          <label>
            Type
            <select value={customType} onChange={(event) => setCustomType(event.target.value as (typeof CUSTOM_QUESTION_TYPES)[number])}>
              {CUSTOM_QUESTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary" onClick={() => addCustom(targetSection)}>
            Add question
          </button>
        </div>
      </div>
      <button type="button" onClick={() => void saveDefinition()}>
        Save questions
      </button>
    </>
  );
}
