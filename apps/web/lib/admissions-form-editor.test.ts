import { describe, expect, it } from "vitest";
import {
  addCanonicalField,
  addCustomQuestion,
  addDraftOption,
  addSection,
  applyQuestionDraft,
  applyQuestionToSections,
  applySectionDraft,
  definitionPayload,
  definitionSaveError,
  definitionSnapshot,
  moveQuestion,
  moveSection,
  nextExpandedKey,
  questionCountLabel,
  planFormSave,
  questionDraft,
  removeDraftOption,
  settingsFromForm,
  settingsRequestBody,
  settingsSaveError,
  toEditor,
  updateDraftOption,
  type EditorSection,
  type FormDetail,
} from "./admissions-form-editor";

function detail(): FormDetail {
  return {
    form: {
      id: "form-1",
      name: "Application form",
      slug: "application",
      formType: "application",
      status: "published",
      successTitle: "Thank you",
      successText: "Received.",
      privacyNoticeText: "Privacy",
      opensAt: "2026-09-01T08:00:00.000Z",
      closesAt: null,
    },
    sections: [
      {
        sectionKey: "child",
        title: "Child details",
        helperText: "About the child",
        enabled: true,
        fields: [
          field("child.legal_name", "canonical", "Legal name", true),
          field("child.preferred_name", "canonical", "Preferred name", false),
          {
            ...field("child.gender", "canonical", "Gender", false),
            questionType: "single_choice",
            options: [
              { value: "female", label: "Female" },
              { value: "male", label: "Male" },
            ],
          },
        ],
      },
      {
        sectionKey: "guardians",
        title: "Parents / guardians",
        helperText: null,
        enabled: false,
        fields: [field("guardians", "canonical", "Parents / guardians", true)],
      },
    ],
  };
}

function field(
  key: string,
  kind: "canonical" | "custom",
  label: string,
  required: boolean,
): FormDetail["sections"][number]["fields"][number] {
  return {
    fieldKey: key,
    fieldKind: kind,
    canonicalKey: kind === "canonical" ? key : null,
    questionType: key === "guardians" ? "guardian_group" : "short_text",
    label,
    helperText: null,
    required,
    enabled: true,
    options: [],
    documentPurpose: null,
  };
}

function loaded(): EditorSection[] {
  return toEditor(detail());
}

describe("admissions form editor", () => {
  it("loads an existing form without expanding every question into the payload", () => {
    const sections = loaded();
    expect(sections.map((section) => section.title)).toEqual(["Child details", "Parents / guardians"]);
    expect(sections[0]?.fields).toHaveLength(3);
    expect(sections[1]?.enabled).toBe(false);
    expect(nextExpandedKey(sections, undefined)).toBe("child");
    expect(nextExpandedKey(sections, null)).toBeNull();
    expect(questionCountLabel(sections[0]!.fields.length)).toBe("3 questions");
    expect(questionCountLabel(1)).toBe("1 question");
  });

  it("edits a label, help text, required, and enabled without changing canonical identity", () => {
    const sections = loaded();
    const original = sections[0]!.fields[0]!;
    const draft = questionDraft(original);
    draft.label = "Child's legal name";
    draft.helperText = "As shown on the birth certificate.";
    draft.required = false;
    draft.enabled = false;
    const applied = applyQuestionDraft(original, { ...draft, options: [] });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value).toMatchObject({
      fieldKey: "child.legal_name",
      fieldKind: "canonical",
      canonicalKey: "child.legal_name",
      questionType: "short_text",
      label: "Child's legal name",
      helperText: "As shown on the birth certificate.",
      required: false,
      enabled: false,
    });
    const saved = applyQuestionToSections(sections, "child", "child.legal_name", draft);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const payload = definitionPayload(saved.value);
    const field = payload.sections[0]?.fields[0];
    expect(field?.label).toBe("Child's legal name");
    expect(field?.helperText).toBe("As shown on the birth certificate.");
    expect(field?.required).toBe(false);
    expect(field?.enabled).toBe(false);
    expect(field?.canonicalKey).toBe("child.legal_name");
    expect(field?.questionType).toBe("short_text");
  });

  it("keeps a disabled required field required in the saved definition", () => {
    const sections = loaded();
    const draft = questionDraft(sections[1]!.fields[0]!);
    draft.enabled = false;
    draft.required = true;
    const saved = applyQuestionToSections(sections, "guardians", "guardians", draft);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const field = definitionPayload(saved.value).sections[1]?.fields[0];
    expect(field).toMatchObject({ required: true, enabled: false, canonicalKey: "guardians" });
  });

  it("edits choice labels and options inside the question draft", () => {
    const sections = loaded();
    let draft = questionDraft(sections[0]!.fields[2]!);
    draft = updateDraftOption(draft, 0, { label: "Girl", value: "female" });
    draft = addDraftOption(draft);
    draft = removeDraftOption(draft, 1);
    const saved = applyQuestionToSections(sections, "child", "child.gender", draft);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(definitionPayload(saved.value).sections[0]?.fields[2]?.options).toEqual([
      { value: "female", label: "Girl" },
      { value: "option_3", label: "New option" },
    ]);
  });

  it("drops blank choices so a published choice with no options can still be rejected", () => {
    const sections = loaded();
    const draft = questionDraft(sections[0]!.fields[2]!);
    draft.options = [
      { value: " ", label: "Missing" },
      { value: "kept", label: " " },
    ];
    const saved = applyQuestionToSections(sections, "child", "child.gender", draft);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(definitionPayload(saved.value).sections[0]?.fields[2]?.options).toEqual([]);
  });

  it("adds a custom question and a canonical field, and rejects a duplicate or unknown canonical key", () => {
    let sections = loaded();
    const custom = addCustomQuestion(sections, 0, "School bus", "single_choice");
    expect(custom.ok).toBe(true);
    if (!custom.ok) return;
    sections = custom.value;
    const canonical = addCanonicalField(sections, 1, "medical.allergies");
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) return;
    sections = canonical.value;
    const duplicate = addCanonicalField(sections, 0, "child.legal_name");
    expect(duplicate.ok).toBe(false);
    const unknown = addCanonicalField(sections, 0, "child.secret_key");
    expect(unknown.ok).toBe(false);
    const payload = definitionPayload(sections);
    const customField = payload.sections[0]?.fields.at(-1);
    expect(customField).toMatchObject({
      fieldKind: "custom",
      canonicalKey: null,
      questionType: "single_choice",
      label: "School bus",
      options: [{ value: "option_1", label: "Option 1" }],
    });
    expect(payload.sections[1]?.fields.at(-1)).toMatchObject({
      fieldKey: "medical.allergies",
      fieldKind: "canonical",
      canonicalKey: "medical.allergies",
      questionType: "long_text",
    });
    expect(payload.sections.flatMap((section) => section.fields).filter((field) => field.canonicalKey === "child.legal_name")).toHaveLength(1);
  });

  it("does not let a question draft change a canonical field into another field", () => {
    const sections = loaded();
    const field = sections[0]!.fields[0]!;
    const applied = applyQuestionDraft(field, {
      ...questionDraft(field),
      label: "Something else",
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.fieldKey).toBe("child.legal_name");
    expect(applied.value.canonicalKey).toBe("child.legal_name");
    expect(applied.value.questionType).toBe("short_text");
    expect(applied.value.fieldKind).toBe("canonical");
  });

  it("persists section and question order as sort positions", () => {
    let sections = loaded();
    sections = moveQuestion(sections, 0, 2, -1);
    sections = moveSection(sections, 1, -1);
    const payload = definitionPayload(sections);
    expect(payload.sections.map((section) => section.sectionKey)).toEqual(["guardians", "child"]);
    expect(payload.sections.map((section) => section.sortOrder)).toEqual([0, 1]);
    expect(payload.sections[1]?.fields.map((field) => field.fieldKey)).toEqual([
      "child.legal_name",
      "child.gender",
      "child.preferred_name",
    ]);
    expect(payload.sections[1]?.fields.map((field) => field.sortOrder)).toEqual([0, 1, 2]);
  });

  it("edits section title, help, and enabled state without changing the section key", () => {
    const added = addSection(loaded(), "Emergency contacts");
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const saved = applySectionDraft(added.value, "emergency_contacts", {
      title: "Emergency",
      helperText: "Who to call",
      enabled: false,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(definitionPayload(saved.value).sections.at(-1)).toMatchObject({
      sectionKey: "emergency_contacts",
      title: "Emergency",
      helperText: "Who to call",
      enabled: false,
    });
  });

  it("marks definition and settings changes, and only sends an open date when it changed", () => {
    const sections = loaded();
    const baseline = definitionSnapshot(sections);
    expect(definitionSnapshot(sections)).toBe(baseline);
    const edited = applyQuestionToSections(sections, "child", "child.preferred_name", {
      ...questionDraft(sections[0]!.fields[1]!),
      label: "Known as",
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(definitionSnapshot(edited.value)).not.toBe(baseline);

    const form = detail().form;
    const settings = settingsFromForm(form);
    expect(settingsSaveError(settings, settings)).toBeNull();
    expect(settingsRequestBody(settings, settings)).not.toHaveProperty("opensAt");
    const next = { ...settings, opensAt: "2026-10-01T09:30", name: "Registration" };
    expect(settingsRequestBody(next, settings).opensAt).toBe(new Date("2026-10-01T09:30").toISOString());
    expect(settingsRequestBody(next, settings).name).toBe("Registration");
    expect(settingsSaveError({ ...settings, opensAt: "" }, settings)).toMatch(/open date/i);
    expect(settingsSaveError({ ...settings, closesAt: "" }, settings)).toBeNull();
  });

  it("does not plan any save when the question definition is invalid, even if settings also changed", () => {
    const sections = loaded();
    const gender = sections[0]!.fields[2]!;
    const cleared = applyQuestionToSections(sections, "child", "child.gender", {
      ...questionDraft(gender),
      options: [],
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(definitionSaveError(cleared.value)).toMatch(/Gender needs at least one option/);

    const settings = settingsFromForm(detail().form);
    const plan = planFormSave({
      sections: cleared.value,
      savedDefinition: definitionSnapshot(sections),
      settings: { ...settings, name: "Renamed form" },
      savedSettings: settings,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.focus).toBe("builder");
    expect(plan).not.toHaveProperty("steps");
  });

  it("plans the question definition before settings, and plans nothing when settings are invalid", () => {
    const sections = loaded();
    const renamed = applyQuestionToSections(sections, "child", "child.preferred_name", {
      ...questionDraft(sections[0]!.fields[1]!),
      label: "Known as",
    });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    const settings = settingsFromForm(detail().form);
    const plan = planFormSave({
      sections: renamed.value,
      savedDefinition: definitionSnapshot(sections),
      settings: { ...settings, name: "Registration" },
      savedSettings: settings,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.steps.map((step) => step.kind)).toEqual(["definition", "settings"]);
    expect(definitionSaveError(renamed.value)).toBeNull();

    const blocked = planFormSave({
      sections: renamed.value,
      savedDefinition: definitionSnapshot(sections),
      settings: { ...settings, name: "" },
      savedSettings: settings,
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.focus).toBe("settings");
    expect(blocked).not.toHaveProperty("steps");
  });

  it("rejects definition problems the server would reject before a save is planned", () => {
    const sections = loaded();
    const duplicate = structuredClone(sections);
    duplicate[1]!.fields.push({ ...duplicate[0]!.fields[0]! });
    expect(definitionSaveError(duplicate)).toMatch(/canonical field can be added once/i);

    const unknown = structuredClone(sections);
    unknown[0]!.fields[0] = {
      ...unknown[0]!.fields[0]!,
      fieldKey: "child.secret_key",
      canonicalKey: "child.secret_key",
    };
    expect(definitionSaveError(unknown)).toMatch(/Canonical field key is not allowed/);

    const added = addCustomQuestion(sections, 0, "Passport", "file");
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const file = structuredClone(added.value);
    file[0]!.fields.at(-1)!.documentPurpose = null;
    expect(definitionSaveError(file)).toMatch(/Passport needs a document purpose/);

    const disabledChoice = applyQuestionToSections(sections, "child", "child.gender", {
      ...questionDraft(sections[0]!.fields[2]!),
      enabled: false,
      options: [],
    });
    expect(disabledChoice.ok).toBe(true);
    if (!disabledChoice.ok) return;
    expect(definitionSaveError(disabledChoice.value)).toBeNull();
  });
});
