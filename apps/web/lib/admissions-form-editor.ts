import {
  ADMISSIONS_CANONICAL_FIELD_CATALOGUE,
  ADMISSIONS_STRUCTURE_CHOICE_KEYS,
  type AdmissionsQuestionType,
} from "@schoolapp/domain";

export const CUSTOM_QUESTION_TYPES = [
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

export type CustomQuestionType = (typeof CUSTOM_QUESTION_TYPES)[number];

const STRUCTURE_KEYS = new Set<string>(ADMISSIONS_STRUCTURE_CHOICE_KEYS);

const TYPE_LABELS: Record<string, string> = {
  short_text: "Short text",
  long_text: "Long text",
  email: "Email",
  phone: "Phone",
  date: "Date",
  number: "Number",
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  yes_no: "Yes / no",
  declaration: "Declaration",
  file: "File",
  address_group: "Address",
  guardian_group: "Parents / guardians",
};

export type EditorOption = { value: string; label: string };

export type EditorField = {
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

export type EditorSection = {
  sectionKey: string;
  title: string;
  helperText: string;
  enabled: boolean;
  fields: EditorField[];
};

export type FormMeta = {
  id: string;
  name: string;
  slug: string;
  formType: string;
  status: string;
  successTitle: string | null;
  successText: string | null;
  privacyNoticeText: string | null;
  opensAt: string | null;
  closesAt: string | null;
};

export type FormDetail = {
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

export type FormSettings = {
  name: string;
  slug: string;
  successTitle: string;
  successText: string;
  privacyNoticeText: string;
  opensAt: string;
  closesAt: string;
};

export type EditorResult<T> = { ok: true; value: T } | { ok: false; message: string };

export type DefinitionPayload = {
  sections: Array<{
    sectionKey: string;
    title: string;
    helperText: string | null;
    sortOrder: number;
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
      sortOrder: number;
      options: EditorOption[];
      documentPurpose: string | null;
    }>;
  }>;
};

export function slugKey(value: string, fallback: string): string {
  const key = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return key || fallback;
}

export function toEditor(detail: FormDetail): EditorSection[] {
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

export function move<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const next = index + direction;
  if (next < 0 || next >= items.length) return items;
  const copy = items.slice();
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item!);
  return copy;
}

export function usedCanonicalKeys(sections: EditorSection[]): Set<string> {
  const keys = new Set<string>();
  for (const section of sections) {
    for (const field of section.fields) {
      if (field.canonicalKey) keys.add(field.canonicalKey);
    }
  }
  return keys;
}

export function availableCanonicalFields(sections: EditorSection[]) {
  const used = usedCanonicalKeys(sections);
  return ADMISSIONS_CANONICAL_FIELD_CATALOGUE.filter((item) => !used.has(item.key));
}

/**
 * `undefined` means the editor has not chosen a section yet, so the first one opens.
 * `null` means the administrator collapsed every section.
 */
export function nextExpandedKey(sections: EditorSection[], current: string | null | undefined): string | null {
  if (current === undefined) return sections[0]?.sectionKey ?? null;
  if (current && sections.some((section) => section.sectionKey === current)) return current;
  if (current) return sections[0]?.sectionKey ?? null;
  return null;
}

export function questionCountLabel(count: number): string {
  return count === 1 ? "1 question" : `${count} questions`;
}

export function typeLabel(questionType: string): string {
  return TYPE_LABELS[questionType] ?? questionType.replaceAll("_", " ");
}

export function rowTypeLabel(field: EditorField): string {
  const type = typeLabel(field.questionType);
  return field.fieldKind === "canonical" ? `School record · ${type}` : type;
}

export function fieldIdentityLabel(field: EditorField): string {
  if (field.fieldKind === "canonical") {
    const catalogue = ADMISSIONS_CANONICAL_FIELD_CATALOGUE.find((item) => item.key === field.canonicalKey);
    return `School record · ${catalogue?.label ?? field.label}`;
  }
  return `Custom · ${typeLabel(field.questionType)}`;
}

export function isChoiceField(field: Pick<EditorField, "questionType">): boolean {
  return field.questionType === "single_choice" || field.questionType === "multiple_choice";
}

export function isStructureChoice(field: Pick<EditorField, "canonicalKey">): boolean {
  return field.canonicalKey ? STRUCTURE_KEYS.has(field.canonicalKey) : false;
}

export function definitionPayload(sections: EditorSection[]): DefinitionPayload {
  return {
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
  };
}

export function definitionSnapshot(sections: EditorSection[]): string {
  return JSON.stringify(definitionPayload(sections));
}

export function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocal(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function settingsFromForm(form: FormMeta): FormSettings {
  return {
    name: form.name,
    slug: form.slug,
    successTitle: form.successTitle ?? "",
    successText: form.successText ?? "",
    privacyNoticeText: form.privacyNoticeText ?? "",
    opensAt: toDateTimeLocal(form.opensAt),
    closesAt: toDateTimeLocal(form.closesAt),
  };
}

export function settingsSnapshot(settings: FormSettings): string {
  return JSON.stringify(settings);
}

export function settingsSaveError(current: FormSettings, baseline: FormSettings): string | null {
  if (!current.name.trim()) return "Enter a form name.";
  if (!current.slug.trim()) return "Enter a slug.";
  if (!current.opensAt.trim() && baseline.opensAt.trim()) {
    return "The open date can be changed, but a saved open date cannot be removed.";
  }
  if (!current.closesAt.trim() && baseline.closesAt.trim()) {
    return "The close date can be changed, but a saved close date cannot be removed.";
  }
  if (current.opensAt.trim() && current.opensAt !== baseline.opensAt && !fromDateTimeLocal(current.opensAt)) {
    return "Enter a valid open date.";
  }
  if (current.closesAt.trim() && current.closesAt !== baseline.closesAt && !fromDateTimeLocal(current.closesAt)) {
    return "Enter a valid close date.";
  }
  return null;
}

export function settingsRequestBody(current: FormSettings, baseline: FormSettings): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: current.name,
    slug: current.slug,
    successTitle: current.successTitle,
    successText: current.successText,
    privacyNoticeText: current.privacyNoticeText,
  };
  if (current.opensAt !== baseline.opensAt) {
    const opensAt = fromDateTimeLocal(current.opensAt);
    if (opensAt) body.opensAt = opensAt;
  }
  if (current.closesAt !== baseline.closesAt) {
    const closesAt = fromDateTimeLocal(current.closesAt);
    if (closesAt) body.closesAt = closesAt;
  }
  return body;
}

export function isSameSnapshot(left: string, right: string): boolean {
  return left === right;
}

export function addSection(sections: EditorSection[], title: string): EditorResult<EditorSection[]> {
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, message: "Enter a section title." };
  const base = slugKey(trimmed, "section");
  const taken = new Set(sections.map((section) => section.sectionKey));
  let key = base;
  let n = 2;
  while (taken.has(key)) {
    key = `${base}_${n}`;
    n += 1;
  }
  return {
    ok: true,
    value: [...sections, { sectionKey: key, title: trimmed, helperText: "", enabled: true, fields: [] }],
  };
}

export function addCustomQuestion(
  sections: EditorSection[],
  sectionIndex: number,
  label: string,
  questionType: CustomQuestionType,
): EditorResult<EditorSection[]> {
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, message: "Enter a question label." };
  const section = sections[sectionIndex];
  if (!section) return { ok: false, message: "Choose a section for this question." };
  const taken = new Set(sections.flatMap((item) => item.fields.map((field) => field.fieldKey)));
  let key = slugKey(trimmed, "question");
  let n = 2;
  while (taken.has(key) || key.length < 2) {
    key = `${slugKey(trimmed, "question")}_${n}`.slice(0, 63);
    n += 1;
  }
  const choice = questionType === "single_choice" || questionType === "multiple_choice";
  const field: EditorField = {
    fieldKey: key,
    fieldKind: "custom",
    canonicalKey: null,
    questionType,
    label: trimmed,
    helperText: "",
    required: false,
    enabled: true,
    options: choice ? [{ value: "option_1", label: "Option 1" }] : [],
    documentPurpose: questionType === "file" ? "other" : null,
  };
  return { ok: true, value: replaceFields(sections, sectionIndex, [...section.fields, field]) };
}

export function addCanonicalField(
  sections: EditorSection[],
  sectionIndex: number,
  canonicalKey: string,
): EditorResult<EditorSection[]> {
  if (!canonicalKey) return { ok: false, message: "Select a school-record field." };
  const section = sections[sectionIndex];
  if (!section) return { ok: false, message: "Choose a section for this field." };
  const item = ADMISSIONS_CANONICAL_FIELD_CATALOGUE.find((row) => row.key === canonicalKey);
  if (!item) return { ok: false, message: "That school-record field is not available." };
  if (usedCanonicalKeys(sections).has(item.key)) {
    return { ok: false, message: "That school-record field is already on this form." };
  }
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
  return { ok: true, value: replaceFields(sections, sectionIndex, [...section.fields, field]) };
}

export function updateSection(sections: EditorSection[], sectionIndex: number, patch: Partial<EditorSection>): EditorSection[] {
  return sections.map((section, index) => (index === sectionIndex ? { ...section, ...patch, sectionKey: section.sectionKey } : section));
}

export function moveSection(sections: EditorSection[], sectionIndex: number, direction: -1 | 1): EditorSection[] {
  return move(sections, sectionIndex, direction);
}

export function moveQuestion(
  sections: EditorSection[],
  sectionIndex: number,
  fieldIndex: number,
  direction: -1 | 1,
): EditorSection[] {
  const section = sections[sectionIndex];
  if (!section) return sections;
  return replaceFields(sections, sectionIndex, move(section.fields, fieldIndex, direction));
}

export type QuestionDraft = {
  label: string;
  helperText: string;
  required: boolean;
  enabled: boolean;
  options: EditorOption[];
  documentPurpose: string | null;
};

export function questionDraft(field: EditorField): QuestionDraft {
  return {
    label: field.label,
    helperText: field.helperText,
    required: field.required,
    enabled: field.enabled,
    options: field.options.map((option) => ({ ...option })),
    documentPurpose: field.documentPurpose,
  };
}

export function applyQuestionDraft(field: EditorField, draft: QuestionDraft): EditorResult<EditorField> {
  if (!draft.label.trim()) return { ok: false, message: "Enter a question label." };
  return {
    ok: true,
    value: {
      ...field,
      label: draft.label,
      helperText: draft.helperText,
      required: draft.required,
      enabled: draft.enabled,
      options: draft.options.map((option) => ({ ...option })),
      documentPurpose: field.questionType === "file" ? draft.documentPurpose : field.documentPurpose,
    },
  };
}

export function applyQuestionToSections(
  sections: EditorSection[],
  sectionKey: string,
  fieldKey: string,
  draft: QuestionDraft,
): EditorResult<EditorSection[]> {
  const sectionIndex = sections.findIndex((section) => section.sectionKey === sectionKey);
  const section = sections[sectionIndex];
  if (!section) return { ok: false, message: "That section is no longer on the form." };
  const fieldIndex = section.fields.findIndex((field) => field.fieldKey === fieldKey);
  const field = section.fields[fieldIndex];
  if (!field) return { ok: false, message: "That question is no longer in this section." };
  const applied = applyQuestionDraft(field, draft);
  if (!applied.ok) return applied;
  const fields = section.fields.slice();
  fields[fieldIndex] = applied.value;
  return { ok: true, value: replaceFields(sections, sectionIndex, fields) };
}

export type SectionDraft = { title: string; helperText: string; enabled: boolean };

export function sectionDraft(section: EditorSection): SectionDraft {
  return { title: section.title, helperText: section.helperText, enabled: section.enabled };
}

export function applySectionDraft(sections: EditorSection[], sectionKey: string, draft: SectionDraft): EditorResult<EditorSection[]> {
  if (!draft.title.trim()) return { ok: false, message: "Enter a section title." };
  const sectionIndex = sections.findIndex((section) => section.sectionKey === sectionKey);
  if (sectionIndex < 0) return { ok: false, message: "That section is no longer on the form." };
  return {
    ok: true,
    value: updateSection(sections, sectionIndex, {
      title: draft.title,
      helperText: draft.helperText,
      enabled: draft.enabled,
    }),
  };
}

export function updateDraftOption(draft: QuestionDraft, optionIndex: number, patch: Partial<EditorOption>): QuestionDraft {
  const options = draft.options.slice();
  const current = options[optionIndex];
  if (!current) return draft;
  options[optionIndex] = { ...current, ...patch };
  return { ...draft, options };
}

export function removeDraftOption(draft: QuestionDraft, optionIndex: number): QuestionDraft {
  return { ...draft, options: draft.options.filter((_, index) => index !== optionIndex) };
}

export function addDraftOption(draft: QuestionDraft): QuestionDraft {
  return {
    ...draft,
    options: [...draft.options, { value: `option_${draft.options.length + 1}`, label: "New option" }],
  };
}

export function canonicalQuestionType(key: string): AdmissionsQuestionType | null {
  return ADMISSIONS_CANONICAL_FIELD_CATALOGUE.find((item) => item.key === key)?.questionType ?? null;
}

function replaceFields(sections: EditorSection[], sectionIndex: number, fields: EditorField[]): EditorSection[] {
  return sections.map((section, index) => (index === sectionIndex ? { ...section, fields } : section));
}
