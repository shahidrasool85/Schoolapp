"use client";

import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ADMISSIONS_DOCUMENT_PURPOSES } from "@schoolapp/domain";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmationDialog,
  Drawer,
  FormField,
  IconButton,
  Input,
  LoadingState,
  PageError,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
} from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import {
  CUSTOM_QUESTION_TYPES,
  addCanonicalField,
  addCustomQuestion,
  addDraftOption,
  addSection,
  applyQuestionToSections,
  applySectionDraft,
  availableCanonicalFields,
  definitionPayload,
  definitionSnapshot,
  fieldIdentityLabel,
  isChoiceField,
  isStructureChoice,
  moveQuestion,
  moveSection,
  nextExpandedKey,
  questionCountLabel,
  questionDraft,
  removeDraftOption,
  rowTypeLabel,
  sectionDraft,
  settingsFromForm,
  settingsRequestBody,
  settingsSaveError,
  settingsSnapshot,
  toEditor,
  typeLabel,
  updateDraftOption,
  type CustomQuestionType,
  type EditorField,
  type EditorSection,
  type FormDetail,
  type FormMeta,
  type FormSettings,
  type QuestionDraft,
  type SectionDraft,
} from "../../../../../lib/admissions-form-editor";
import { userFacingError } from "../../../../../lib/errors";

type ShareInfo = { publicUrl: string; embedCode: string; qrSvg: string | null };
type EditorTab = "builder" | "settings" | "share";
type Notice = { tone: "success" | "info" | "warning" | "danger"; text: string };
type ConfirmKind = "preview" | "publish" | "duplicate" | "leave" | null;

const TABS: Array<{ id: EditorTab; label: string }> = [
  { id: "builder", label: "Builder" },
  { id: "settings", label: "Settings" },
  { id: "share", label: "Share" },
];

export default function AdmissionsFormDetailPage() {
  const params = useParams<{ id: string }>();
  const [form, setForm] = useState<FormMeta | null>(null);
  const [sections, setSections] = useState<EditorSection[]>([]);
  const [settings, setSettings] = useState<FormSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<FormSettings | null>(null);
  const [savedDefinition, setSavedDefinition] = useState("");
  const [ready, setReady] = useState(false);
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [tab, setTab] = useState<EditorTab>("builder");
  const [expandedKey, setExpandedKey] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);
  const [customType, setCustomType] = useState<CustomQuestionType>("short_text");
  const [customLabel, setCustomLabel] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [canonicalKey, setCanonicalKey] = useState("");
  const [targetSection, setTargetSection] = useState("");
  const [questionEdit, setQuestionEdit] = useState<{ sectionKey: string; fieldKey: string; draft: QuestionDraft } | null>(null);
  const [sectionEdit, setSectionEdit] = useState<{ sectionKey: string; draft: SectionDraft } | null>(null);
  const [draftError, setDraftError] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const bypassUnload = useRef(false);

  const definitionDirty = ready && definitionSnapshot(sections) !== savedDefinition;
  const settingsDirty =
    ready && settings !== null && savedSettings !== null && settingsSnapshot(settings) !== settingsSnapshot(savedSettings);
  const dirty = definitionDirty || settingsDirty;
  const expanded = nextExpandedKey(sections, expandedKey);
  const catalogue = availableCanonicalFields(sections);

  async function load() {
    const [detail, shareBody] = await Promise.all([
      api<FormDetail>(`/api/v1/admissions/forms/${params.id}`),
      api<ShareInfo>(`/api/v1/admissions/forms/${params.id}/share`),
    ]);
    const nextSections = toEditor(detail);
    const nextSettings = settingsFromForm(detail.form);
    setForm(detail.form);
    setSections(nextSections);
    setSettings(nextSettings);
    setSavedSettings(nextSettings);
    setSavedDefinition(definitionSnapshot(nextSections));
    setShare(shareBody);
    setReady(true);
    setTargetSection((current) =>
      nextSections.some((section) => section.sectionKey === current) ? current : (nextSections[0]?.sectionKey ?? ""),
    );
  }

  useEffect(() => {
    setReady(false);
    load().catch((err: unknown) => setError(userFacingError(err, "Could not load this form.")));
  }, [params.id]);

  useEffect(() => {
    if (!sections.length) return;
    setTargetSection((current) =>
      sections.some((section) => section.sectionKey === current) ? current : sections[0]!.sectionKey,
    );
  }, [sections]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (bypassUnload.current || !dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    function onClick(event: MouseEvent) {
      if (bypassUnload.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest("a");
      if (!anchor || anchor.target === "_blank") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (/^https?:\/\//i.test(href)) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveHref(href);
      setConfirm("leave");
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  useEffect(() => {
    if (!moreOpen) return;
    function onPointer(event: MouseEvent) {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  function editingField(): EditorField | null {
    if (!questionEdit) return null;
    return (
      sections
        .find((section) => section.sectionKey === questionEdit.sectionKey)
        ?.fields.find((field) => field.fieldKey === questionEdit.fieldKey) ?? null
    );
  }

  async function saveAll(): Promise<boolean> {
    if (!settings || !savedSettings) return false;
    setError("");
    let message = "Changes saved.";
    if (settingsSnapshot(settings) !== settingsSnapshot(savedSettings)) {
      const problem = settingsSaveError(settings, savedSettings);
      if (problem) {
        setError(problem);
        setTab("settings");
        return false;
      }
      try {
        const saved = await api<{ form: FormMeta }>(`/api/v1/admissions/forms/${params.id}`, {
          method: "PATCH",
          body: JSON.stringify(settingsRequestBody(settings, savedSettings)),
        });
        const next = settingsFromForm(saved.form);
        setSettings(next);
        setSavedSettings(next);
        setForm(saved.form);
        const shareBody = await api<ShareInfo>(`/api/v1/admissions/forms/${params.id}/share`);
        setShare(shareBody);
        if (!settings.successTitle.trim() && saved.form.successTitle) {
          message = "Changes saved. An empty success title stays as the previous title.";
          setNotice({ tone: "info", text: message });
        }
      } catch (err) {
        setError(userFacingError(err, "Could not save this form."));
        setTab("settings");
        return false;
      }
    }
    if (definitionSnapshot(sections) !== savedDefinition) {
      try {
        const saved = await api<FormDetail>(`/api/v1/admissions/forms/${params.id}/definition`, {
          method: "PUT",
          body: JSON.stringify(definitionPayload(sections)),
        });
        const nextSections = toEditor(saved);
        setSections(nextSections);
        setSavedDefinition(definitionSnapshot(nextSections));
        setForm(saved.form);
      } catch (err) {
        setError(userFacingError(err, "Could not save the questions."));
        setTab("builder");
        return false;
      }
    }
    setNotice({ tone: "success", text: message });
    return true;
  }

  async function onSave() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await saveAll();
    } finally {
      setSaving(false);
    }
  }

  async function runPublish(path: "publish" | "unpublish") {
    setError("");
    setSaving(true);
    try {
      const saved = await api<{ form: FormMeta }>(`/api/v1/admissions/forms/${params.id}/${path}`, {
        method: "POST",
        body: "{}",
      });
      setForm(saved.form);
      const shareBody = await api<ShareInfo>(`/api/v1/admissions/forms/${params.id}/share`);
      setShare(shareBody);
      setNotice({ tone: "success", text: path === "publish" ? "Published." : "Unpublished." });
    } catch (err) {
      setError(userFacingError(err, "Could not update publication."));
    } finally {
      setSaving(false);
    }
  }

  function requestPublish() {
    setMoreOpen(false);
    if (dirty) {
      setConfirm("publish");
      return;
    }
    void runPublish("publish");
  }

  async function saveThenPublish() {
    setConfirm(null);
    setSaving(true);
    try {
      const ok = await saveAll();
      if (!ok) return;
      await runPublish("publish");
    } finally {
      setSaving(false);
    }
  }

  function requestPreview() {
    if (!share || !form) return;
    if (form.status !== "published") {
      setNotice({
        tone: "info",
        text: "This form is not published, so the public page is not available. Publish it to preview the live form. The public address stays closed until then.",
      });
      return;
    }
    if (dirty) {
      setConfirm("preview");
      return;
    }
    window.open(share.publicUrl, "_blank", "noopener,noreferrer");
  }

  function requestDuplicate() {
    setMoreOpen(false);
    if (dirty) {
      setConfirm("duplicate");
      return;
    }
    void duplicate();
  }

  async function duplicate() {
    setError("");
    setSaving(true);
    try {
      const body = await api<{ form: { id: string } }>(`/api/v1/admissions/forms/${params.id}/duplicate`, {
        method: "POST",
        body: "{}",
      });
      bypassUnload.current = true;
      window.location.href = `/school/admissions/forms/${body.form.id}`;
    } catch (err) {
      setError(userFacingError(err, "Could not duplicate this form."));
      setSaving(false);
    }
  }

  function leave() {
    if (!leaveHref) return;
    bypassUnload.current = true;
    window.location.href = leaveHref;
  }

  function onTabKey(event: ReactKeyboardEvent<HTMLButtonElement>, id: EditorTab) {
    const index = TABS.findIndex((item) => item.id === id);
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next =
      event.key === "ArrowRight" ? TABS[(index + 1) % TABS.length]! : TABS[(index - 1 + TABS.length) % TABS.length]!;
    setTab(next.id);
    document.getElementById(`form-editor-tab-${next.id}`)?.focus();
  }

  function openQuestion(sectionKey: string, field: EditorField) {
    setDraftError("");
    setSectionEdit(null);
    setQuestionEdit({ sectionKey, fieldKey: field.fieldKey, draft: questionDraft(field) });
  }

  function saveQuestion() {
    if (!questionEdit) return;
    const result = applyQuestionToSections(sections, questionEdit.sectionKey, questionEdit.fieldKey, questionEdit.draft);
    if (!result.ok) {
      setDraftError(result.message);
      return;
    }
    setSections(result.value);
    setQuestionEdit(null);
    setDraftError("");
  }

  function saveSectionEdit() {
    if (!sectionEdit) return;
    const result = applySectionDraft(sections, sectionEdit.sectionKey, sectionEdit.draft);
    if (!result.ok) {
      setDraftError(result.message);
      return;
    }
    setSections(result.value);
    setSectionEdit(null);
    setDraftError("");
  }

  function onAddSection() {
    const result = addSection(sections, sectionTitle);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSections(result.value);
    setSectionTitle("");
    setExpandedKey(result.value.at(-1)?.sectionKey ?? null);
    setError("");
  }

  function onAddCustom() {
    const index = sections.findIndex((section) => section.sectionKey === targetSection);
    const result = addCustomQuestion(sections, index, customLabel, customType);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSections(result.value);
    setCustomLabel("");
    setExpandedKey(targetSection);
    setError("");
  }

  function onAddCanonical() {
    const index = sections.findIndex((section) => section.sectionKey === targetSection);
    const result = addCanonicalField(sections, index, canonicalKey);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSections(result.value);
    setCanonicalKey("");
    setExpandedKey(targetSection);
    setError("");
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice({ tone: "success", text: `${label} copied.` });
      setError("");
    } catch {
      setError("Could not copy. Select the text and copy it manually.");
    }
  }

  if (!ready && error) return <PageError description={error} />;
  if (!form || !settings) return <LoadingState label="Loading form…" />;

  const activeQuestion = editingField();
  const slugChanged = savedSettings ? settings.slug !== savedSettings.slug : false;

  return (
    <div className="form-editor-page">
      <div className="form-editor-sticky">
        <PageHeader
          title={settings.name.trim() || form.name}
          description={
            <>
              {form.formType} · <StatusBadge status={form.status} /> ·{" "}
              <span aria-live="polite">{dirty ? "Unsaved changes" : "Saved"}</span>
            </>
          }
          actions={
            <>
              <Button type="button" variant="secondary" onClick={requestPreview} disabled={!share || saving}>
                Preview form
              </Button>
              <Button type="button" onClick={() => void onSave()} disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <div className="editor-more" ref={moreRef}>
                <Button
                  type="button"
                  variant="secondary"
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                  aria-controls="form-editor-more"
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  More
                </Button>
                {moreOpen ? (
                  <div id="form-editor-more" className="editor-more-menu" role="menu">
                    <button type="button" role="menuitem" className="editor-menu-item" onClick={requestPublish} disabled={saving}>
                      Publish
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="editor-menu-item"
                      onClick={() => {
                        setMoreOpen(false);
                        void runPublish("unpublish");
                      }}
                      disabled={saving}
                    >
                      Unpublish
                    </button>
                    <button type="button" role="menuitem" className="editor-menu-item" onClick={requestDuplicate} disabled={saving}>
                      Duplicate
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          }
        />
        <div className="tabs" role="tablist" aria-label="Form editor">
          {TABS.map((item) => (
            <button
              key={item.id}
              id={`form-editor-tab-${item.id}`}
              type="button"
              role="tab"
              className={tab === item.id ? "active" : ""}
              aria-selected={tab === item.id}
              aria-controls={`form-editor-panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
              onKeyDown={(event) => onTabKey(event, item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {tab === "builder" ? (
        <div role="tabpanel" id="form-editor-panel-builder" aria-labelledby="form-editor-tab-builder">
          <h2 className="visually-hidden">Builder</h2>
          <p className="muted">
            Open a section to see its questions. Labels, help text, choices, and required settings stay in the question
            editor. Academic year, year group, and entry term use this school&apos;s structure.
          </p>
          <div className="builder-list">
            {sections.map((section, sectionIndex) => {
              const open = expanded === section.sectionKey;
              const panelId = `section-panel-${section.sectionKey}`;
              return (
                <section
                  key={section.sectionKey}
                  className={`card builder-section${section.enabled ? "" : " is-disabled"}`}
                >
                  <div className="builder-section-head">
                    <h3 className="builder-section-heading">
                      <button
                        type="button"
                        className="builder-section-toggle"
                        aria-expanded={open}
                        aria-controls={panelId}
                        onClick={() => setExpandedKey(open ? null : section.sectionKey)}
                      >
                        <span className={`builder-chevron${open ? " is-open" : ""}`} aria-hidden="true" />
                        <span className="builder-section-copy">
                          <span className="builder-section-title">
                            {sectionIndex + 1}. {section.title || "Untitled section"}
                          </span>
                          <span className="builder-section-meta">{questionCountLabel(section.fields.length)}</span>
                        </span>
                        {section.enabled ? null : <Badge tone="neutral">Disabled</Badge>}
                      </button>
                    </h3>
                    <div className="builder-section-tools">
                      <IconButton
                        label={`Move ${section.title || "section"} up`}
                        disabled={sectionIndex === 0}
                        onClick={() => setSections((current) => moveSection(current, sectionIndex, -1))}
                      >
                        ↑
                      </IconButton>
                      <IconButton
                        label={`Move ${section.title || "section"} down`}
                        disabled={sectionIndex === sections.length - 1}
                        onClick={() => setSections((current) => moveSection(current, sectionIndex, 1))}
                      >
                        ↓
                      </IconButton>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setDraftError("");
                          setQuestionEdit(null);
                          setSectionEdit({ sectionKey: section.sectionKey, draft: sectionDraft(section) });
                        }}
                      >
                        <span className="builder-settings-label" aria-hidden="true">
                          Settings
                        </span>
                        <span className="visually-hidden">Edit section {section.title || "untitled"}</span>
                      </Button>
                    </div>
                  </div>
                  {open ? (
                    <div id={panelId} className="builder-questions">
                      {section.fields.length === 0 ? (
                        <p className="muted builder-empty">No questions in this section yet.</p>
                      ) : (
                        section.fields.map((field, fieldIndex) => (
                          <div key={field.fieldKey} className={`builder-question${field.enabled ? "" : " is-disabled"}`}>
                            <div className="builder-question-main">
                              <p className="builder-question-label">{field.label || "Untitled question"}</p>
                              <p className="builder-question-type">{rowTypeLabel(field)}</p>
                            </div>
                            <div className="builder-question-status">
                              {field.required ? <Badge tone="info">Required</Badge> : null}
                              {field.enabled ? null : <Badge tone="neutral">Disabled</Badge>}
                            </div>
                            <div className="builder-question-actions">
                              <IconButton
                                label={`Move ${field.label || "question"} up`}
                                disabled={fieldIndex === 0}
                                onClick={() =>
                                  setSections((current) => moveQuestion(current, sectionIndex, fieldIndex, -1))
                                }
                              >
                                ↑
                              </IconButton>
                              <IconButton
                                label={`Move ${field.label || "question"} down`}
                                disabled={fieldIndex === section.fields.length - 1}
                                onClick={() =>
                                  setSections((current) => moveQuestion(current, sectionIndex, fieldIndex, 1))
                                }
                              >
                                ↓
                              </IconButton>
                              <Button type="button" variant="secondary" onClick={() => openQuestion(section.sectionKey, field)}>
                                Edit <span className="visually-hidden">{field.label || "question"}</span>
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>

          <section className="card builder-add">
            <h3>Add to this form</h3>
            <p className="muted">
              School-record fields can be added once. Medical, SEND, and emergency questions stay in that list until you
              add them.
            </p>
            <label>
              Section
              <Select value={targetSection} onChange={(event) => setTargetSection(event.target.value)}>
                {sections.map((section) => (
                  <option key={section.sectionKey} value={section.sectionKey}>
                    {section.title || section.sectionKey}
                  </option>
                ))}
              </Select>
            </label>
            <div className="builder-add-row">
              <label>
                School-record field
                <Select value={canonicalKey} onChange={(event) => setCanonicalKey(event.target.value)}>
                  <option value="">Select</option>
                  {catalogue.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </label>
              <Button type="button" variant="secondary" onClick={onAddCanonical}>
                Add field
              </Button>
            </div>
            <div className="builder-add-row">
              <label>
                Custom question
                <Input
                  value={customLabel}
                  onChange={(event) => setCustomLabel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onAddCustom();
                    }
                  }}
                  placeholder="Question label"
                />
              </label>
              <label>
                Type
                <Select value={customType} onChange={(event) => setCustomType(event.target.value as CustomQuestionType)}>
                  {CUSTOM_QUESTION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {typeLabel(type)}
                    </option>
                  ))}
                </Select>
              </label>
              <Button type="button" variant="secondary" onClick={onAddCustom}>
                Add question
              </Button>
            </div>
            <div className="builder-add-row">
              <label>
                New section
                <Input
                  value={sectionTitle}
                  onChange={(event) => setSectionTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onAddSection();
                    }
                  }}
                  placeholder="Additional information"
                />
              </label>
              <Button type="button" variant="secondary" onClick={onAddSection}>
                Add section
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "settings" ? (
        <div role="tabpanel" id="form-editor-panel-settings" aria-labelledby="form-editor-tab-settings">
          <h2 className="visually-hidden">Settings</h2>
          <form
            className="card stack form-editor-settings"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void onSave();
            }}
          >
            <FormField label="Form name" htmlFor="form-name">
              <Input
                id="form-name"
                value={settings.name}
                required
                maxLength={120}
                onChange={(event) => setSettings({ ...settings, name: event.target.value })}
              />
            </FormField>
            <FormField label="Slug" htmlFor="form-slug" hint="Used in the public address.">
              <Input
                id="form-slug"
                value={settings.slug}
                required
                maxLength={80}
                onChange={(event) => setSettings({ ...settings, slug: event.target.value })}
              />
            </FormField>
            <FormField label="Success title" htmlFor="form-success-title">
              <Input
                id="form-success-title"
                value={settings.successTitle}
                maxLength={120}
                onChange={(event) => setSettings({ ...settings, successTitle: event.target.value })}
              />
            </FormField>
            <FormField label="Success text" htmlFor="form-success-text">
              <Textarea
                id="form-success-text"
                value={settings.successText}
                onChange={(event) => setSettings({ ...settings, successText: event.target.value })}
              />
            </FormField>
            <FormField label="Privacy notice" htmlFor="form-privacy">
              <Textarea
                id="form-privacy"
                value={settings.privacyNoticeText}
                onChange={(event) => setSettings({ ...settings, privacyNoticeText: event.target.value })}
              />
            </FormField>
            <FormField
              label="Opens"
              htmlFor="form-opens"
              hint="Optional. The public form accepts responses only while it is published and inside these dates."
            >
              <Input
                id="form-opens"
                type="datetime-local"
                value={settings.opensAt}
                onChange={(event) => setSettings({ ...settings, opensAt: event.target.value })}
              />
            </FormField>
            <FormField
              label="Closes"
              htmlFor="form-closes"
              hint={
                savedSettings?.opensAt || savedSettings?.closesAt
                  ? "A date that is already saved can be changed. It cannot be cleared from this screen."
                  : "Leave blank if the form should not close on a date."
              }
            >
              <Input
                id="form-closes"
                type="datetime-local"
                value={settings.closesAt}
                onChange={(event) => setSettings({ ...settings, closesAt: event.target.value })}
              />
            </FormField>
            <div>
              <p>
                Publication · <StatusBadge status={form.status} />
              </p>
              <div className="button-row">
                <Button type="button" onClick={requestPublish} disabled={saving}>
                  Publish
                </Button>
                <Button type="button" variant="secondary" onClick={() => void runPublish("unpublish")} disabled={saving}>
                  Unpublish
                </Button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {tab === "share" ? (
        <div role="tabpanel" id="form-editor-panel-share" aria-labelledby="form-editor-tab-share">
          <h2 className="visually-hidden">Share</h2>
          {share ? (
            <section className="card stack form-editor-share">
              <p className="muted">
                {form.status === "published"
                  ? "The public page, QR code, and embed use the last saved form."
                  : "This address is ready, but the form stays unavailable until you publish it."}
                {slugChanged ? " Save the new slug before sharing the updated address." : ""}
              </p>
              <div>
                <h3>Public URL</h3>
                {form.status === "published" ? (
                  <p>
                    <a href={share.publicUrl} target="_blank" rel="noopener noreferrer">
                      {share.publicUrl}
                    </a>
                  </p>
                ) : (
                  <p>
                    <code>{share.publicUrl}</code>
                  </p>
                )}
                <Button type="button" variant="secondary" onClick={() => void copyText(share.publicUrl, "Link")}>
                  Copy link
                </Button>
              </div>
              <div>
                <h3>Embed code</h3>
                <pre className="share-code">{share.embedCode}</pre>
                <Button type="button" variant="secondary" onClick={() => void copyText(share.embedCode, "Embed code")}>
                  Copy embed code
                </Button>
              </div>
              <div>
                <h3>QR code</h3>
                {share.qrSvg ? (
                  <div className="share-qr" dangerouslySetInnerHTML={{ __html: share.qrSvg }} aria-label="QR code for the public form" />
                ) : (
                  <p className="muted">Publish the form to generate a QR code.</p>
                )}
              </div>
            </section>
          ) : (
            <p className="muted">Share details are not available yet.</p>
          )}
        </div>
      ) : null}

      <Drawer
        open={Boolean(questionEdit && activeQuestion)}
        title="Edit question"
        description={activeQuestion ? fieldIdentityLabel(activeQuestion) : undefined}
        onClose={() => {
          setQuestionEdit(null);
          setDraftError("");
        }}
        footer={
          <div className="dialog-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setQuestionEdit(null);
                setDraftError("");
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={saveQuestion}>
              Save
            </Button>
          </div>
        }
      >
        {questionEdit && activeQuestion ? (
          <div className="stack">
            {draftError ? <Alert tone="danger">{draftError}</Alert> : null}
            <p className="muted">
              {activeQuestion.fieldKind === "canonical"
                ? "This stays linked to the school record. You can change the label and help text. You cannot turn it into a different field."
                : "This is a custom question. Its type stays as it was when you added it."}
            </p>
            <FormField label="Label" htmlFor="question-label">
              <Input
                id="question-label"
                value={questionEdit.draft.label}
                onChange={(event) =>
                  setQuestionEdit({ ...questionEdit, draft: { ...questionEdit.draft, label: event.target.value } })
                }
              />
            </FormField>
            <FormField label="Help text" htmlFor="question-help">
              <Textarea
                id="question-help"
                value={questionEdit.draft.helperText}
                onChange={(event) =>
                  setQuestionEdit({ ...questionEdit, draft: { ...questionEdit.draft, helperText: event.target.value } })
                }
              />
            </FormField>
            <Checkbox
              label="Enabled"
              checked={questionEdit.draft.enabled}
              onChange={(event) =>
                setQuestionEdit({ ...questionEdit, draft: { ...questionEdit.draft, enabled: event.target.checked } })
              }
            />
            <Checkbox
              label="Required"
              checked={questionEdit.draft.required}
              onChange={(event) =>
                setQuestionEdit({ ...questionEdit, draft: { ...questionEdit.draft, required: event.target.checked } })
              }
            />
            <p className="builder-identity">
              <span className="muted">Field type</span>
              <span>{fieldIdentityLabel(activeQuestion)}</span>
            </p>
            {activeQuestion.questionType === "file" ? (
              <FormField label="Document purpose" htmlFor="question-purpose">
                <Select
                  id="question-purpose"
                  value={questionEdit.draft.documentPurpose ?? "other"}
                  onChange={(event) =>
                    setQuestionEdit({
                      ...questionEdit,
                      draft: { ...questionEdit.draft, documentPurpose: event.target.value },
                    })
                  }
                >
                  {ADMISSIONS_DOCUMENT_PURPOSES.map((purpose) => (
                    <option key={purpose} value={purpose}>
                      {purpose.replaceAll("_", " ")}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
            {isChoiceField(activeQuestion) && isStructureChoice(activeQuestion) ? (
              <p className="muted">Options are this school&apos;s academic years, year groups, or terms.</p>
            ) : null}
            {isChoiceField(activeQuestion) && !isStructureChoice(activeQuestion) ? (
              <div className="stack">
                <h3>Choices</h3>
                {questionEdit.draft.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="builder-choice">
                    <FormField label="Stored value" htmlFor={`choice-value-${optionIndex}`}>
                      <Input
                        id={`choice-value-${optionIndex}`}
                        value={option.value}
                        onChange={(event) =>
                          setQuestionEdit({
                            ...questionEdit,
                            draft: updateDraftOption(questionEdit.draft, optionIndex, { value: event.target.value }),
                          })
                        }
                      />
                    </FormField>
                    <FormField label="Label" htmlFor={`choice-label-${optionIndex}`}>
                      <Input
                        id={`choice-label-${optionIndex}`}
                        value={option.label}
                        onChange={(event) =>
                          setQuestionEdit({
                            ...questionEdit,
                            draft: updateDraftOption(questionEdit.draft, optionIndex, { label: event.target.value }),
                          })
                        }
                      />
                    </FormField>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setQuestionEdit({
                          ...questionEdit,
                          draft: removeDraftOption(questionEdit.draft, optionIndex),
                        })
                      }
                    >
                      Remove choice
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setQuestionEdit({ ...questionEdit, draft: addDraftOption(questionEdit.draft) })}
                >
                  Add choice
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={Boolean(sectionEdit)}
        title="Section settings"
        onClose={() => {
          setSectionEdit(null);
          setDraftError("");
        }}
        footer={
          <div className="dialog-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSectionEdit(null);
                setDraftError("");
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={saveSectionEdit}>
              Save
            </Button>
          </div>
        }
      >
        {sectionEdit ? (
          <div className="stack">
            {draftError ? <Alert tone="danger">{draftError}</Alert> : null}
            <FormField label="Section title" htmlFor="section-title">
              <Input
                id="section-title"
                value={sectionEdit.draft.title}
                onChange={(event) => setSectionEdit({ ...sectionEdit, draft: { ...sectionEdit.draft, title: event.target.value } })}
              />
            </FormField>
            <FormField label="Section help" htmlFor="section-help">
              <Textarea
                id="section-help"
                value={sectionEdit.draft.helperText}
                onChange={(event) =>
                  setSectionEdit({ ...sectionEdit, draft: { ...sectionEdit.draft, helperText: event.target.value } })
                }
              />
            </FormField>
            <Checkbox
              label="Section enabled"
              checked={sectionEdit.draft.enabled}
              onChange={(event) =>
                setSectionEdit({ ...sectionEdit, draft: { ...sectionEdit.draft, enabled: event.target.checked } })
              }
            />
          </div>
        ) : null}
      </Drawer>

      <ConfirmationDialog
        open={confirm === "preview"}
        title="Preview the saved form?"
        description="Preview opens the last saved public page. Unsaved changes will not appear until you save them."
        confirmLabel="Open preview"
        onConfirm={() => {
          setConfirm(null);
          if (share) window.open(share.publicUrl, "_blank", "noopener,noreferrer");
        }}
        onClose={() => setConfirm(null)}
      />
      <ConfirmationDialog
        open={confirm === "publish"}
        title="Save changes before publishing?"
        description="Publishing uses the saved form. Save your changes first so the public page includes them."
        confirmLabel="Save and publish"
        onConfirm={() => void saveThenPublish()}
        onClose={() => setConfirm(null)}
      />
      <ConfirmationDialog
        open={confirm === "duplicate"}
        title="Duplicate the saved form?"
        description="Duplicate copies the last saved form. Unsaved changes on this page will be lost."
        confirmLabel="Duplicate anyway"
        onConfirm={() => {
          setConfirm(null);
          void duplicate();
        }}
        onClose={() => setConfirm(null)}
      />
      <ConfirmationDialog
        open={confirm === "leave"}
        title="Leave without saving?"
        description="You have unsaved changes. Leave this page and discard them?"
        confirmLabel="Leave"
        danger
        onConfirm={leave}
        onClose={() => {
          setConfirm(null);
          setLeaveHref(null);
        }}
      />
    </div>
  );
}
