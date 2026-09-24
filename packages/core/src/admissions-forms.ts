import { createHash, randomBytes } from "node:crypto";
import {
  ADMISSIONS_CANONICAL_FIELD_CATALOGUE,
  ADMISSIONS_CANONICAL_FIELD_KEYS,
  ADMISSIONS_COMPLETENESS_STATUSES,
  ADMISSIONS_DOCUMENT_PURPOSES,
  ADMISSIONS_FORM_STATUSES,
  ADMISSIONS_FORM_TEMPLATES,
  ADMISSIONS_FORM_TYPES,
  ADMISSIONS_QUESTION_TYPES,
  ADMISSIONS_STRUCTURE_CHOICE_KEYS,
  CUSTOM_FIELD_KEY_PATTERN,
  PUBLIC_FORM_SLUG_MAX,
  PUBLIC_FORM_SLUG_PATTERN,
  type AdmissionsCanonicalFieldKey,
  type AdmissionsCompletenessStatus,
  type AdmissionsDocumentPurpose,
  type AdmissionsFormStatus,
  type AdmissionsFormTemplate,
  type AdmissionsFormType,
  type AdmissionsQuestionType,
} from "@schoolapp/domain";
import { AppError } from "./errors.js";
import { originForHostname, schoolPublicHostname } from "./hostname.js";

export const PUBLIC_FORM_MAX_BODY_BYTES = 64 * 1024;
export const PUBLIC_FORM_DRAFT_TTL_DAYS = 7;
export const PUBLIC_FORM_MAX_GUARDIANS = 6;
export const PUBLIC_SUBMISSION_CONFIRMATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const HTML_TAG = /<\/?[^>]+>/g;
const SCRIPTY = /javascript:|data:text\/html|vbscript:|on\w+=/gi;

export type FormFieldOption = { value: string; label: string };

export type FormFieldDefinition = {
  fieldKey: string;
  fieldKind: "canonical" | "custom";
  canonicalKey: AdmissionsCanonicalFieldKey | null;
  questionType: AdmissionsQuestionType;
  label: string;
  helperText: string | null;
  required: boolean;
  enabled: boolean;
  sortOrder: number;
  sectionKey: string;
  options: FormFieldOption[];
  documentPurpose: AdmissionsDocumentPurpose | null;
};

export type FormSectionDefinition = {
  sectionKey: string;
  title: string;
  helperText: string | null;
  sortOrder: number;
  enabled: boolean;
  fields: FormFieldDefinition[];
};

export type AddressValue = {
  line1?: string;
  line2?: string;
  town?: string;
  postcode?: string;
};

export type GuardianValue = {
  fullName?: string;
  title?: string;
  relationship?: string;
  occupation?: string;
  parentalResponsibility?: boolean;
  email?: string;
  phone?: string;
  phoneAlternative?: string;
  primaryContact?: boolean;
  address?: AddressValue;
};

export type FileAnswerValue = {
  filename?: string;
  contentType?: string;
  byteSize?: number;
  purpose?: string;
  documentId?: string;
};

export type CanonicalSnapshot = {
  child?: {
    legalName?: string;
    legalForename?: string;
    legalSurname?: string;
    preferredName?: string;
    dateOfBirth?: string;
    gender?: string;
    nationality?: string;
    address?: AddressValue;
    intendedAcademicYearId?: string;
    intendedYearGroupId?: string;
    intendedTermId?: string;
    proposedStartDate?: string;
    currentSchool?: string;
    previousSchool?: string;
  };
  guardians?: GuardianValue[];
  previousEducation?: {
    schoolName?: string;
    startDate?: string;
    endDate?: string;
    reportDetails?: string;
  };
  emergency?: {
    fullName?: string;
    relationship?: string;
    telephone?: string;
    authorisedCollection?: boolean;
  };
  medical?: {
    allergies?: string;
    conditions?: string;
    medication?: string;
    dietary?: string;
    sendNotes?: string;
  };
  notes?: string;
};

const CANONICAL_SET = new Set<string>(ADMISSIONS_CANONICAL_FIELD_KEYS);
const QUESTION_SET = new Set<string>(ADMISSIONS_QUESTION_TYPES);
const PURPOSE_SET = new Set<string>(ADMISSIONS_DOCUMENT_PURPOSES);
const STRUCTURE_CHOICE_KEYS = new Set<string>(ADMISSIONS_STRUCTURE_CHOICE_KEYS);

const CANONICAL_TYPES = Object.fromEntries(
  ADMISSIONS_CANONICAL_FIELD_CATALOGUE.map((row) => [row.key, row.questionType]),
) as Record<AdmissionsCanonicalFieldKey, AdmissionsQuestionType>;

const CANONICAL_LABELS = Object.fromEntries(
  ADMISSIONS_CANONICAL_FIELD_CATALOGUE.map((row) => [row.key, row.label]),
) as Record<AdmissionsCanonicalFieldKey, string>;

export function isAdmissionsFormType(value: string): value is AdmissionsFormType {
  return (ADMISSIONS_FORM_TYPES as readonly string[]).includes(value);
}

export function isAdmissionsFormStatus(value: string): value is AdmissionsFormStatus {
  return (ADMISSIONS_FORM_STATUSES as readonly string[]).includes(value);
}

export function isAdmissionsQuestionType(value: string): value is AdmissionsQuestionType {
  return QUESTION_SET.has(value);
}

export function isAdmissionsCompletenessStatus(value: string): value is AdmissionsCompletenessStatus {
  return (ADMISSIONS_COMPLETENESS_STATUSES as readonly string[]).includes(value);
}

export function isCanonicalFieldKey(value: string): value is AdmissionsCanonicalFieldKey {
  return CANONICAL_SET.has(value);
}

export function sanitizePlainText(value: unknown, max = 4000): string {
  if (value == null) return "";
  let text = String(value);
  text = text.replace(CONTROL_CHARS, "");
  text = text.replace(HTML_TAG, "");
  text = text.replace(SCRIPTY, "");
  text = text.replace(/[<>]/g, "");
  return text.trim().slice(0, max);
}

export function sanitizeHelperText(value: unknown, max = 2000): string {
  return sanitizePlainText(value, max);
}

export function isSafeHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 2000) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  return true;
}

export function safePrivacyNoticeUrl(value: unknown): string | null {
  const cleaned = sanitizePlainText(value, 2000);
  if (!cleaned) return null;
  if (!isSafeHttpUrl(cleaned)) {
    throw new AppError(400, "validation_failed", "Privacy notice URL must be http or https");
  }
  return cleaned;
}

export function normalizeFormSlug(value: string): string {
  const slug = sanitizePlainText(value, PUBLIC_FORM_SLUG_MAX)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PUBLIC_FORM_SLUG_MAX);
  if (!PUBLIC_FORM_SLUG_PATTERN.test(slug)) {
    throw new AppError(400, "validation_failed", "Form slug must be a lowercase hyphenated label");
  }
  return slug;
}

export function normalizeCampaignCode(value: string): string {
  const code = sanitizePlainText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!code || code.length > 80) {
    throw new AppError(400, "validation_failed", "Campaign code is invalid");
  }
  return code;
}

export function normalizeCustomFieldKey(value: string): string {
  const key = sanitizePlainText(value, 64)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 63);
  if (!CUSTOM_FIELD_KEY_PATTERN.test(key) || isCanonicalFieldKey(key)) {
    throw new AppError(400, "validation_failed", "Custom field key is invalid");
  }
  return key;
}

export function publicFormKind(formType: AdmissionsFormType): string {
  return formType === "application" ? "apply" : formType;
}

export function formTypeFromPublicKind(kind: string): AdmissionsFormType | null {
  if (kind === "apply") return "application";
  return isAdmissionsFormType(kind) ? kind : null;
}

export function publicFormPath(formType: AdmissionsFormType, slug: string): string {
  return `/admissions/${publicFormKind(formType)}/${slug}`;
}

export function publicFormEmbedPath(formType: AdmissionsFormType, slug: string): string {
  return `/admissions/embed/${publicFormKind(formType)}/${slug}`;
}

export function publicFormConfirmationPath(
  formType: AdmissionsFormType,
  slug: string,
  token: string,
  embed = false,
): string {
  const base = embed ? publicFormEmbedPath(formType, slug) : publicFormPath(formType, slug);
  return `${base}/confirmation/${encodeURIComponent(token)}`;
}

export function buildPublicFormUrl(input: {
  slug: string;
  formType: AdmissionsFormType;
  schoolSlug: string;
  platformDomain: string;
  hostname?: string;
  port?: string | null;
  protocol?: "http" | "https";
  campaignCode?: string | null;
}): string {
  const hostname = input.hostname ?? schoolPublicHostname(input.schoolSlug, input.platformDomain);
  const origin = originForHostname({
    hostname,
    port: input.port ?? null,
    protocol: input.protocol ?? (input.platformDomain === "localhost" ? "http" : "https"),
  });
  const path = publicFormPath(input.formType, input.slug);
  const url = new URL(path, `${origin}/`);
  if (input.campaignCode) url.searchParams.set("source", input.campaignCode);
  return url.toString();
}

export function buildEmbedCode(src: string, title: string): string {
  const safeSrc = src.replace(/"/g, "");
  const safeTitle = sanitizePlainText(title, 120).replace(/"/g, "");
  return `<iframe src="${safeSrc}" title="${safeTitle}" style="width:100%;max-width:780px;min-height:760px;border:0;border-radius:8px;" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
}

export function hashContinuationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createContinuationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashContinuationToken(token) };
}

export function hashClientIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const trimmed = ip.split(",")[0]?.trim();
  if (!trimmed) return null;
  return createHash("sha256").update(`public-form-ip:${trimmed}`).digest("hex");
}

export function fieldDefinitionForCanonical(
  key: AdmissionsCanonicalFieldKey,
  input: Partial<FormFieldDefinition> = {},
): FormFieldDefinition {
  return {
    fieldKey: key,
    fieldKind: "canonical",
    canonicalKey: key,
    questionType: input.questionType ?? CANONICAL_TYPES[key],
    label: input.label ?? CANONICAL_LABELS[key],
    helperText: input.helperText ?? null,
    required: input.required ?? false,
    enabled: input.enabled ?? true,
    sortOrder: input.sortOrder ?? 0,
    sectionKey: input.sectionKey ?? "details",
    options: input.options ?? (key === "child.gender"
      ? [
          { value: "female", label: "Female" },
          { value: "male", label: "Male" },
          { value: "prefer_not_to_say", label: "Prefer not to say" },
        ]
      : []),
    documentPurpose: input.documentPurpose ?? null,
  };
}

function section(
  sectionKey: string,
  title: string,
  fields: Array<AdmissionsCanonicalFieldKey | FormFieldDefinition>,
  helperText: string | null = null,
): FormSectionDefinition {
  return {
    sectionKey,
    title,
    helperText,
    sortOrder: 0,
    enabled: true,
    fields: fields.map((field, index) => {
      const def = typeof field === "string" ? fieldDefinitionForCanonical(field) : field;
      return { ...def, sectionKey, sortOrder: index };
    }),
  };
}

export function defaultFormTemplate(formType: AdmissionsFormType): FormSectionDefinition[] {
  if (formType === "enquiry") {
    return [
      section("child", "Child details", [
        fieldDefinitionForCanonical("child.legal_name", { required: true }),
        "child.preferred_name",
        fieldDefinitionForCanonical("child.date_of_birth", { required: true }),
        fieldDefinitionForCanonical("child.intended_academic_year_id", { required: true }),
        fieldDefinitionForCanonical("child.intended_year_group_id", { required: true }),
      ]),
      section("guardian", "Parent / guardian", [
        fieldDefinitionForCanonical("guardian.full_name", { required: true }),
        "guardian.relationship",
        fieldDefinitionForCanonical("guardian.email", { required: true }),
        "guardian.phone",
      ]),
      section("details", "Your enquiry", [
        fieldDefinitionForCanonical("enquiry.notes", { required: true }),
      ]),
    ].map((item, index) => ({ ...item, sortOrder: index }));
  }

  return [
    section("child", "Child details", [
      fieldDefinitionForCanonical("child.legal_name", {
        required: true,
        helperText: "The child's full legal name, as on their birth certificate or passport.",
      }),
      "child.preferred_name",
      fieldDefinitionForCanonical("child.date_of_birth", { required: true }),
      "child.gender",
      fieldDefinitionForCanonical("child.address", {
        helperText: "The child's home address.",
      }),
      fieldDefinitionForCanonical("child.intended_academic_year_id", { required: true }),
      fieldDefinitionForCanonical("child.intended_year_group_id", { required: true }),
      "child.proposed_start_date",
      fieldDefinitionForCanonical("child.current_school", {
        helperText: "The school the child attends now, if any.",
      }),
      fieldDefinitionForCanonical("child.previous_school", {
        helperText: "A school the child attended before the current school, if different.",
      }),
    ]),
    section(
      "guardians",
      "Parents / guardians",
      [fieldDefinitionForCanonical("guardians", { required: true })],
      "Add every parent or guardian we should contact. At least one primary contact is required.",
    ),
    section("previous_education", "Previous education", [
      "previous_education.school_name",
      "previous_education.start_date",
      "previous_education.end_date",
      "previous_education.report_details",
    ]),
    section("medical", "Medical and additional needs", [
      "medical.allergies",
      "medical.conditions",
      "medical.medication",
      "medical.dietary",
      "medical.send_notes",
    ]),
    section("emergency", "Emergency contacts", [
      "emergency.full_name",
      "emergency.relationship",
      "emergency.telephone",
      "emergency.authorised_collection",
    ]),
    section("application", "Application details", ["application.notes"]),
    section("declarations", "Documents and declarations", [
      {
        fieldKey: "declaration_privacy",
        fieldKind: "custom",
        canonicalKey: null,
        questionType: "declaration",
        label: "I confirm the information is accurate and I have read the privacy notice",
        helperText: null,
        required: true,
        enabled: true,
        sortOrder: 0,
        sectionKey: "declarations",
        options: [],
        documentPurpose: null,
      },
    ]),
  ].map((item, index) => ({ ...item, sortOrder: index }));
}

/**
 * Registration / application template.
 * Medical, medication, dietary, SEND, and emergency sections are omitted so a
 * school can collect them later. They remain in the canonical catalogue and
 * can be added in the form builder.
 * Faith/religion is an optional application-only custom question. It is not
 * written to the pupil record and is not ethnicity.
 * "How did you hear about us?" starts with editable generic options. Campaign
 * links stay separate.
 */
export function registrationApplicationTemplate(): FormSectionDefinition[] {
  return [
    section("child", "Child details", [
      fieldDefinitionForCanonical("child.legal_forename", { required: true }),
      fieldDefinitionForCanonical("child.legal_surname", { required: true }),
      "child.preferred_name",
      fieldDefinitionForCanonical("child.date_of_birth", { required: true }),
      fieldDefinitionForCanonical("child.nationality", {
        helperText: "Collect this only if your school needs it. Nationality is not ethnic background.",
      }),
      fieldDefinitionForCanonical("child.address", {
        helperText: "The child's home address.",
      }),
      fieldDefinitionForCanonical("child.intended_academic_year_id", { required: true }),
      fieldDefinitionForCanonical("child.intended_year_group_id", { required: true }),
      fieldDefinitionForCanonical("child.intended_term_id", {
        helperText: "The school term when the child would join.",
      }),
      "child.proposed_start_date",
      fieldDefinitionForCanonical("child.current_school", {
        helperText: "The school the child attends now, if any.",
      }),
      fieldDefinitionForCanonical("child.previous_school", {
        helperText: "Another school the child has been registered at, if different.",
      }),
    ]),
    section(
      "guardians",
      "Parents / guardians",
      [fieldDefinitionForCanonical("guardians", { required: true })],
      "Add each parent or guardian. Title, occupation, address, and telephone are stored with this application.",
    ),
    section("additional", "Additional information", [
      {
        fieldKey: "skills_and_talents",
        fieldKind: "custom",
        canonicalKey: null,
        questionType: "long_text",
        label: "Artistic, dramatic, musical or sporting skills and experience",
        helperText: "Stored with this application only.",
        required: false,
        enabled: true,
        sortOrder: 0,
        sectionKey: "additional",
        options: [],
        documentPurpose: null,
      },
      {
        fieldKey: "hobbies_and_interests",
        fieldKind: "custom",
        canonicalKey: null,
        questionType: "long_text",
        label: "Other hobbies and interests",
        helperText: null,
        required: false,
        enabled: true,
        sortOrder: 1,
        sectionKey: "additional",
        options: [],
        documentPurpose: null,
      },
      "application.notes",
      {
        fieldKey: "how_heard",
        fieldKind: "custom",
        canonicalKey: null,
        questionType: "single_choice",
        label: "How did you hear about us?",
        helperText: "Edit these options for your school. Campaign links are tracked separately.",
        required: false,
        enabled: true,
        sortOrder: 3,
        sectionKey: "additional",
        options: [
          { value: "recommendation", label: "Recommendation" },
          { value: "advertisement", label: "Advertisement" },
          { value: "another_school", label: "Another school" },
          { value: "other", label: "Other" },
        ],
        documentPurpose: null,
      },
    ]),
    section(
      "faith",
      "Faith or religion",
      [
        {
          fieldKey: "faith_or_religion",
          fieldKind: "custom",
          canonicalKey: null,
          questionType: "short_text",
          label: "Faith or religion",
          helperText:
            "Optional. Kept on this application only. It is not copied to the pupil record and is not used as ethnicity.",
          required: false,
          enabled: true,
          sortOrder: 0,
          sectionKey: "faith",
          options: [],
          documentPurpose: null,
        },
      ],
      "Disable this section if your school does not ask for faith or religion at registration.",
    ),
    section("declarations", "Declaration", [
      {
        fieldKey: "declaration_privacy",
        fieldKind: "custom",
        canonicalKey: null,
        questionType: "declaration",
        label: "I confirm the information in this registration is accurate and I have read the privacy notice",
        helperText: null,
        required: true,
        enabled: true,
        sortOrder: 0,
        sectionKey: "declarations",
        options: [],
        documentPurpose: null,
      },
    ]),
  ].map((item, index) => ({ ...item, sortOrder: index }));
}

export function isAdmissionsFormTemplate(value: string): value is AdmissionsFormTemplate {
  return (ADMISSIONS_FORM_TEMPLATES as readonly string[]).includes(value);
}

export function formTemplateFor(
  formType: AdmissionsFormType,
  template: AdmissionsFormTemplate | null | undefined,
): FormSectionDefinition[] {
  if (formType === "application" && template === "registration") return registrationApplicationTemplate();
  return defaultFormTemplate(formType);
}

/**
 * Parts win when they were collected. A legacy legal-name string is never split.
 */
export function applicantLegalName(input: {
  legalName?: string | null;
  legalForename?: string | null;
  legalSurname?: string | null;
}): string {
  const forename = input.legalForename?.trim() ?? "";
  const surname = input.legalSurname?.trim() ?? "";
  if (forename || surname) return [forename, surname].filter(Boolean).join(" ");
  return input.legalName?.trim() ?? "";
}

const CHOICE_TYPES = new Set<AdmissionsQuestionType>(["single_choice", "multiple_choice"]);

export function assertAdmissionsFormDefinition(sections: FormSectionDefinition[]): void {
  if (!sections.length) {
    throw new AppError(400, "validation_failed", "A form needs at least one section");
  }
  const sectionKeys = new Set<string>();
  const fieldKeys = new Set<string>();
  const canonicalKeys = new Set<string>();
  for (const section of sections) {
    const sectionKey = section.sectionKey.trim();
    if (!sectionKey || sectionKeys.has(sectionKey)) {
      throw new AppError(400, "validation_failed", "Section keys must be unique");
    }
    sectionKeys.add(sectionKey);
    for (const field of section.fields) {
      if (field.fieldKind === "canonical") {
        if (!field.canonicalKey || !isCanonicalFieldKey(field.canonicalKey)) {
          throw new AppError(400, "validation_failed", "Canonical field key is not allowed");
        }
        if (field.questionType !== canonicalTypeForKey(field.canonicalKey)) {
          throw new AppError(400, "validation_failed", "Canonical field type cannot be changed");
        }
        if (field.fieldKey !== field.canonicalKey) {
          throw new AppError(400, "validation_failed", "Canonical field key is not allowed");
        }
        if (canonicalKeys.has(field.canonicalKey)) {
          throw new AppError(400, "validation_failed", "Each canonical field can be added once");
        }
        canonicalKeys.add(field.canonicalKey);
      } else if (field.canonicalKey) {
        throw new AppError(400, "validation_failed", "Custom questions cannot use a canonical key");
      }
      if (fieldKeys.has(field.fieldKey)) {
        throw new AppError(400, "validation_failed", "Field keys must be unique");
      }
      fieldKeys.add(field.fieldKey);
      if (
        field.enabled &&
        CHOICE_TYPES.has(field.questionType) &&
        !STRUCTURE_CHOICE_KEYS.has(field.canonicalKey ?? "") &&
        field.options.length === 0
      ) {
        throw new AppError(400, "validation_failed", `${field.label} needs at least one option`);
      }
      if (field.questionType === "file" && !field.documentPurpose) {
        throw new AppError(400, "validation_failed", `${field.label} needs a document purpose`);
      }
    }
  }
}

export function publicFormIsAccepting(input: {
  status: string;
  opensAt: string | Date | null;
  closesAt: string | Date | null;
  now?: Date;
}): boolean {
  if (input.status !== "published") return false;
  const now = input.now ?? new Date();
  if (input.opensAt && new Date(input.opensAt) > now) return false;
  if (input.closesAt && new Date(input.closesAt) < now) return false;
  return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function fileAnswerDocumentId(value: unknown): string | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const documentId = typeof rec.documentId === "string" ? rec.documentId.trim() : "";
  return documentId || null;
}

function parseAddress(value: unknown): AddressValue | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const address: AddressValue = {
    line1: sanitizePlainText(rec.line1, 120) || undefined,
    line2: sanitizePlainText(rec.line2, 120) || undefined,
    town: sanitizePlainText(rec.town, 80) || undefined,
    postcode: sanitizePlainText(rec.postcode, 16) || undefined,
  };
  return address.line1 || address.town || address.postcode ? address : undefined;
}

function parseGuardian(value: unknown): GuardianValue | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const fullName = sanitizePlainText(rec.fullName ?? rec.full_name, 120);
  if (!fullName) return null;
  return {
    fullName,
    title: sanitizePlainText(rec.title, 20) || undefined,
    relationship: sanitizePlainText(rec.relationship, 40) || undefined,
    occupation: sanitizePlainText(rec.occupation, 120) || undefined,
    parentalResponsibility: rec.parentalResponsibility === true || rec.parental_responsibility === true,
    email: sanitizePlainText(rec.email, 120).toLowerCase() || undefined,
    phone: sanitizePlainText(rec.phone ?? rec.telephone, 40) || undefined,
    phoneAlternative: sanitizePlainText(rec.phoneAlternative ?? rec.phone_alternative ?? rec.alternativeTelephone, 40) || undefined,
    primaryContact: rec.primaryContact === true || rec.primary_contact === true,
    address: parseAddress(rec.address),
  };
}

function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((item) => isBlank(item));
  }
  return String(value).trim() === "";
}

function fieldError(field: FormFieldDefinition, message: string): never {
  throw new AppError(400, "validation_failed", message, {
    fieldKey: field.fieldKey,
    sectionKey: field.sectionKey || undefined,
  });
}

export const UK_POSTCODE_RE = /^(GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})$/i;

export function isValidUkPostcode(value: string): boolean {
  return UK_POSTCODE_RE.test(value.trim().replace(/\s+/g, " "));
}

export function publicFieldRequiredMessage(field: FormFieldDefinition): string {
  const key = field.canonicalKey ?? field.fieldKey;
  if (key === "child.legal_name") return "Enter the child's legal name.";
  if (key === "child.legal_forename") return "Enter the child's legal forename.";
  if (key === "child.legal_surname") return "Enter the child's legal surname.";
  if (key === "child.date_of_birth") return "Enter the child's date of birth.";
  if (key === "child.intended_academic_year_id") return "Select the intended academic year.";
  if (key === "child.intended_year_group_id") return "Select the intended year group.";
  if (key === "child.intended_term_id") return "Select the intended entry term.";
  if (key === "child.address") return "Enter the child's home address.";
  if (key === "guardians") return "Enter at least one parent or guardian.";
  if (key === "guardian.full_name") return "Enter the parent or guardian's name.";
  if (key === "guardian.email") return "Enter a parent or guardian email address.";
  if (key === "enquiry.notes") return "Enter your question or note.";
  return `Enter ${field.label.toLowerCase()}.`;
}

export function countryUsesUkPostcode(countryCode?: string | null): boolean {
  const code = (countryCode ?? "GB").trim().toUpperCase();
  return code === "GB" || code === "UK";
}

function assertEmail(value: string, field: FormFieldDefinition, label = field.label) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 120) {
    fieldError(field, `${label} must be a valid email`);
  }
}

function assertDate(value: string, field: FormFieldDefinition) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    fieldError(field, `${field.label} must be a valid date`);
  }
}

function assertUuid(value: string, field: FormFieldDefinition) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    fieldError(field, `${field.label} is invalid`);
  }
}

export function validateFieldAnswer(field: FormFieldDefinition, raw: unknown): unknown {
  if (!field.enabled) return undefined;
  if (isBlank(raw)) {
    if (field.required) {
      fieldError(field, publicFieldRequiredMessage(field));
    }
    return undefined;
  }

  switch (field.questionType) {
    case "short_text":
    case "phone":
      return sanitizePlainText(raw, field.questionType === "phone" ? 40 : 200);
    case "long_text":
      return sanitizePlainText(raw, 4000);
    case "email": {
      const email = sanitizePlainText(raw, 120).toLowerCase();
      assertEmail(email, field);
      return email;
    }
    case "date": {
      const date = sanitizePlainText(raw, 10);
      assertDate(date, field);
      return date;
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n) || Math.abs(n) > 1_000_000_000) {
        fieldError(field, `${field.label} must be a number`);
      }
      return n;
    }
    case "yes_no":
    case "declaration": {
      const accepted = raw === true || raw === "true" || raw === "yes";
      if (field.required && !accepted) {
        fieldError(field, `${field.label} must be accepted`);
      }
      return accepted;
    }
    case "single_choice": {
      const value = sanitizePlainText(raw, 80);
      if (field.options.length && !field.options.some((option) => option.value === value)) {
        if (!STRUCTURE_CHOICE_KEYS.has(field.canonicalKey ?? "")) {
          fieldError(field, `${field.label} is not a valid choice`);
        }
        assertUuid(value, field);
      }
      if (STRUCTURE_CHOICE_KEYS.has(field.canonicalKey ?? "")) {
        assertUuid(value, field);
      }
      return value;
    }
    case "multiple_choice": {
      const values = Array.isArray(raw) ? raw : [raw];
      const allowed = new Set(field.options.map((option) => option.value));
      const cleaned = values.map((item) => sanitizePlainText(item, 80));
      if (field.options.length && cleaned.some((item) => !allowed.has(item))) {
        fieldError(field, `${field.label} contains an invalid choice`);
      }
      return cleaned;
    }
    case "address_group": {
      const address = parseAddress(raw);
      if (field.required && !address?.line1) {
        fieldError(field, publicFieldRequiredMessage(field));
      }
      return address;
    }
    case "guardian_group": {
      const rows = Array.isArray(raw) ? raw : [raw];
      if (rows.length > PUBLIC_FORM_MAX_GUARDIANS) {
        fieldError(field, "Too many parents / guardians");
      }
      const guardians = rows.map(parseGuardian).filter((row): row is GuardianValue => row !== null);
      if (field.required && guardians.length === 0) {
        fieldError(field, `${field.label} is required`);
      }
      if (field.required && !guardians.some((row) => row.email)) {
        fieldError(field, "At least one parent / guardian email is required");
      }
      for (const guardian of guardians) {
        if (guardian.email) assertEmail(guardian.email, field, "Parent / guardian email");
      }
      if (!guardians.some((row) => row.primaryContact) && guardians[0]) {
        guardians[0].primaryContact = true;
      }
      return guardians;
    }
    case "file": {
      const rec = asRecord(raw);
      if (!rec) {
        fieldError(field, `${field.label} is invalid`);
      }
      const documentId = fileAnswerDocumentId(rec);
      const filename = sanitizePlainText(rec.filename ?? rec.originalFilename, 120);
      const contentType = sanitizePlainText(rec.contentType, 120);
      const byteSize = Number(rec.byteSize ?? rec.byte_size ?? 0);
      if (documentId) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) {
          fieldError(field, `${field.label} is invalid`);
        }
        return {
          documentId,
          filename: filename || "document",
          contentType: contentType || "application/octet-stream",
          byteSize: Number.isFinite(byteSize) ? byteSize : 0,
          purpose: field.documentPurpose ?? sanitizePlainText(rec.purpose, 40) ?? "other",
        } satisfies FileAnswerValue;
      }
      if (field.required) {
        fieldError(field, `${field.label} must be uploaded`);
      }
      return undefined;
    }
    default:
      fieldError(field, `${field.label} has an unsupported type`);
  }
}

const ALLOWED_UPLOAD_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ALLOWED_UPLOAD_EXT = new Set(["pdf", "jpg", "jpeg", "png", "webp", "docx"]);
export const ADMISSIONS_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

export function isAllowedAdmissionsUpload(input: {
  filename: string;
  contentType: string;
  byteSize: number;
}): boolean {
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0 || input.byteSize > ADMISSIONS_UPLOAD_MAX_BYTES) {
    return false;
  }
  const ext = input.filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_UPLOAD_EXT.has(ext)) return false;
  if (input.contentType && !ALLOWED_UPLOAD_TYPES.has(input.contentType)) return false;
  return true;
}

export function validatePublicAnswers(
  fields: FormFieldDefinition[],
  answers: Record<string, unknown>,
  options: { draft?: boolean; countryCode?: string | null } = {},
): Record<string, unknown> {
  const enabled = fields.filter((field) => field.enabled);
  const cleaned: Record<string, unknown> = {};
  const unknownKeys = Object.keys(answers).filter(
    (key) => !enabled.some((field) => field.fieldKey === key),
  );
  if (unknownKeys.length) {
    throw new AppError(400, "validation_failed", "Unexpected form fields were submitted");
  }
  for (const field of enabled) {
    const raw = answers[field.fieldKey];
    if (options.draft && isBlank(raw)) continue;
    const value = validateFieldAnswer(
      options.draft ? { ...field, required: false } : field,
      raw,
    );
    if (value !== undefined && field.questionType === "address_group") {
      const address = value as AddressValue;
      if (address.postcode && countryUsesUkPostcode(options.countryCode) && !isValidUkPostcode(address.postcode)) {
        fieldError(field, "Enter a valid UK postcode.");
      }
    }
    if (value !== undefined) cleaned[field.fieldKey] = value;
  }
  return cleaned;
}

export function mapAnswersToCanonical(
  fields: FormFieldDefinition[],
  answers: Record<string, unknown>,
): CanonicalSnapshot {
  const snapshot: CanonicalSnapshot = { child: {}, guardians: [], previousEducation: {}, emergency: {}, medical: {} };

  const setChild = <K extends keyof NonNullable<CanonicalSnapshot["child"]>>(
    key: K,
    value: NonNullable<CanonicalSnapshot["child"]>[K],
  ) => {
    snapshot.child = { ...snapshot.child, [key]: value };
  };

  for (const field of fields) {
    if (!field.enabled || !field.canonicalKey) continue;
    const value = answers[field.fieldKey];
    if (isBlank(value)) continue;
    switch (field.canonicalKey) {
      case "child.legal_name":
        setChild("legalName", String(value));
        break;
      case "child.legal_forename":
        setChild("legalForename", String(value));
        break;
      case "child.legal_surname":
        setChild("legalSurname", String(value));
        break;
      case "child.preferred_name":
        setChild("preferredName", String(value));
        break;
      case "child.date_of_birth":
        setChild("dateOfBirth", String(value));
        break;
      case "child.gender":
        setChild("gender", String(value));
        break;
      case "child.nationality":
        setChild("nationality", String(value));
        break;
      case "child.address":
        setChild("address", value as AddressValue);
        break;
      case "child.intended_academic_year_id":
        setChild("intendedAcademicYearId", String(value));
        break;
      case "child.intended_year_group_id":
        setChild("intendedYearGroupId", String(value));
        break;
      case "child.intended_term_id":
        setChild("intendedTermId", String(value));
        break;
      case "child.proposed_start_date":
        setChild("proposedStartDate", String(value));
        break;
      case "child.current_school":
        setChild("currentSchool", String(value));
        break;
      case "child.previous_school":
        setChild("previousSchool", String(value));
        break;
      case "guardian.full_name":
      case "guardian.title":
      case "guardian.relationship":
      case "guardian.occupation":
      case "guardian.parental_responsibility":
      case "guardian.address":
      case "guardian.email":
      case "guardian.phone":
      case "guardian.phone_alternative":
      case "guardian.primary_contact": {
        const current = snapshot.guardians?.[0] ?? {};
        if (field.canonicalKey === "guardian.full_name") current.fullName = String(value);
        if (field.canonicalKey === "guardian.title") current.title = String(value);
        if (field.canonicalKey === "guardian.relationship") current.relationship = String(value);
        if (field.canonicalKey === "guardian.occupation") current.occupation = String(value);
        if (field.canonicalKey === "guardian.parental_responsibility") current.parentalResponsibility = value === true;
        if (field.canonicalKey === "guardian.address") current.address = value as AddressValue;
        if (field.canonicalKey === "guardian.email") current.email = String(value);
        if (field.canonicalKey === "guardian.phone") current.phone = String(value);
        if (field.canonicalKey === "guardian.phone_alternative") current.phoneAlternative = String(value);
        if (field.canonicalKey === "guardian.primary_contact") current.primaryContact = value === true;
        snapshot.guardians = [current];
        break;
      }
      case "guardians":
        snapshot.guardians = value as GuardianValue[];
        break;
      case "previous_education.school_name":
        snapshot.previousEducation = { ...snapshot.previousEducation, schoolName: String(value) };
        break;
      case "previous_education.start_date":
        snapshot.previousEducation = { ...snapshot.previousEducation, startDate: String(value) };
        break;
      case "previous_education.end_date":
        snapshot.previousEducation = { ...snapshot.previousEducation, endDate: String(value) };
        break;
      case "previous_education.report_details":
        snapshot.previousEducation = { ...snapshot.previousEducation, reportDetails: String(value) };
        break;
      case "emergency.full_name":
        snapshot.emergency = { ...snapshot.emergency, fullName: String(value) };
        break;
      case "emergency.relationship":
        snapshot.emergency = { ...snapshot.emergency, relationship: String(value) };
        break;
      case "emergency.telephone":
        snapshot.emergency = { ...snapshot.emergency, telephone: String(value) };
        break;
      case "emergency.authorised_collection":
        snapshot.emergency = { ...snapshot.emergency, authorisedCollection: value === true };
        break;
      case "medical.allergies":
        snapshot.medical = { ...snapshot.medical, allergies: String(value) };
        break;
      case "medical.conditions":
        snapshot.medical = { ...snapshot.medical, conditions: String(value) };
        break;
      case "medical.medication":
        snapshot.medical = { ...snapshot.medical, medication: String(value) };
        break;
      case "medical.dietary":
        snapshot.medical = { ...snapshot.medical, dietary: String(value) };
        break;
      case "medical.send_notes":
        snapshot.medical = { ...snapshot.medical, sendNotes: String(value) };
        break;
      case "enquiry.notes":
      case "application.notes":
        snapshot.notes = String(value);
        break;
      default:
        break;
    }
  }

  if (snapshot.guardians && !snapshot.guardians.length) delete snapshot.guardians;
  if (snapshot.child) {
    const composed = applicantLegalName({
      legalName: snapshot.child.legalName,
      legalForename: snapshot.child.legalForename,
      legalSurname: snapshot.child.legalSurname,
    });
    if (composed) snapshot.child.legalName = composed;
  }
  return snapshot;
}

export function computeCompleteness(input: {
  draft: boolean;
  fields: FormFieldDefinition[];
  answers: Record<string, unknown>;
}): AdmissionsCompletenessStatus {
  if (input.draft) return "draft";
  const requiredFiles = input.fields.filter(
    (field) => field.enabled && field.required && field.questionType === "file",
  );
  const missingFiles = requiredFiles.filter((field) => !fileAnswerDocumentId(input.answers[field.fieldKey]));
  if (missingFiles.length) return "missing_documents";
  return "complete";
}

export function declarationSnapshot(input: {
  fields: FormFieldDefinition[];
  answers: Record<string, unknown>;
  privacyNoticeText: string | null;
  privacyNoticeUrl: string | null;
  successText?: string | null;
}): Record<string, unknown> {
  const declarations = input.fields
    .filter((field) => field.enabled && field.questionType === "declaration")
    .map((field) => ({
      fieldKey: field.fieldKey,
      label: field.label,
      accepted: input.answers[field.fieldKey] === true,
    }));
  return {
    capturedAt: new Date().toISOString(),
    privacyNoticeText: input.privacyNoticeText,
    privacyNoticeUrl: input.privacyNoticeUrl,
    declarations,
  };
}

export function auditSafeFormAfter(input: {
  formId: string;
  formType: string;
  slug: string;
  status?: string;
  publicId?: string;
}): Record<string, unknown> {
  return {
    formId: input.formId,
    formType: input.formType,
    slug: input.slug,
    status: input.status,
    publicId: input.publicId,
  };
}

export function canonicalTypeForKey(key: AdmissionsCanonicalFieldKey): AdmissionsQuestionType {
  return CANONICAL_TYPES[key];
}

export function canonicalLabelForKey(key: AdmissionsCanonicalFieldKey): string {
  return CANONICAL_LABELS[key];
}
