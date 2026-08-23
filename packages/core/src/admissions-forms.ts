import { createHash, randomBytes } from "node:crypto";
import {
  ADMISSIONS_CANONICAL_FIELD_KEYS,
  ADMISSIONS_COMPLETENESS_STATUSES,
  ADMISSIONS_DOCUMENT_PURPOSES,
  ADMISSIONS_FORM_STATUSES,
  ADMISSIONS_FORM_TYPES,
  ADMISSIONS_QUESTION_TYPES,
  CUSTOM_FIELD_KEY_PATTERN,
  PUBLIC_FORM_SLUG_MAX,
  PUBLIC_FORM_SLUG_PATTERN,
  type AdmissionsCanonicalFieldKey,
  type AdmissionsCompletenessStatus,
  type AdmissionsDocumentPurpose,
  type AdmissionsFormStatus,
  type AdmissionsFormType,
  type AdmissionsQuestionType,
} from "@schoolapp/domain";
import { AppError } from "./errors.js";
import { originForHostname, schoolPublicHostname } from "./hostname.js";

export const PUBLIC_FORM_MAX_BODY_BYTES = 64 * 1024;
export const PUBLIC_FORM_DRAFT_TTL_DAYS = 7;
export const PUBLIC_FORM_MAX_GUARDIANS = 6;

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
  relationship?: string;
  parentalResponsibility?: boolean;
  email?: string;
  phone?: string;
  primaryContact?: boolean;
  address?: AddressValue;
};

export type FileAnswerValue = {
  filename?: string;
  contentType?: string;
  byteSize?: number;
  purpose?: string;
};

export type CanonicalSnapshot = {
  child?: {
    legalName?: string;
    preferredName?: string;
    dateOfBirth?: string;
    gender?: string;
    address?: AddressValue;
    intendedAcademicYearId?: string;
    intendedYearGroupId?: string;
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

const CANONICAL_TYPES: Record<AdmissionsCanonicalFieldKey, AdmissionsQuestionType> = {
  "child.legal_name": "short_text",
  "child.preferred_name": "short_text",
  "child.date_of_birth": "date",
  "child.gender": "single_choice",
  "child.address": "address_group",
  "child.intended_academic_year_id": "single_choice",
  "child.intended_year_group_id": "single_choice",
  "child.proposed_start_date": "date",
  "child.current_school": "short_text",
  "child.previous_school": "short_text",
  "guardian.full_name": "short_text",
  "guardian.relationship": "short_text",
  "guardian.parental_responsibility": "yes_no",
  "guardian.address": "address_group",
  "guardian.email": "email",
  "guardian.phone": "phone",
  "guardian.primary_contact": "yes_no",
  guardians: "guardian_group",
  "previous_education.school_name": "short_text",
  "previous_education.start_date": "date",
  "previous_education.end_date": "date",
  "previous_education.report_details": "long_text",
  "emergency.full_name": "short_text",
  "emergency.relationship": "short_text",
  "emergency.telephone": "phone",
  "emergency.authorised_collection": "yes_no",
  "medical.allergies": "long_text",
  "medical.conditions": "long_text",
  "medical.medication": "long_text",
  "medical.dietary": "short_text",
  "medical.send_notes": "long_text",
  "enquiry.notes": "long_text",
  "application.notes": "long_text",
};

const CANONICAL_LABELS: Record<AdmissionsCanonicalFieldKey, string> = {
  "child.legal_name": "Child's legal name",
  "child.preferred_name": "Preferred name",
  "child.date_of_birth": "Date of birth",
  "child.gender": "Gender",
  "child.address": "Child's address",
  "child.intended_academic_year_id": "Intended academic year",
  "child.intended_year_group_id": "Intended year group",
  "child.proposed_start_date": "Proposed start date",
  "child.current_school": "Current school",
  "child.previous_school": "Previous school",
  "guardian.full_name": "Parent / guardian name",
  "guardian.relationship": "Relationship to child",
  "guardian.parental_responsibility": "Has parental responsibility",
  "guardian.address": "Parent / guardian address",
  "guardian.email": "Email",
  "guardian.phone": "Telephone",
  "guardian.primary_contact": "Primary contact",
  guardians: "Parents / guardians",
  "previous_education.school_name": "Current or previous school",
  "previous_education.start_date": "Dates attended (from)",
  "previous_education.end_date": "Dates attended (to)",
  "previous_education.report_details": "Previous report or reference details",
  "emergency.full_name": "Emergency contact name",
  "emergency.relationship": "Emergency contact relationship",
  "emergency.telephone": "Emergency telephone",
  "emergency.authorised_collection": "Authorised to collect the child",
  "medical.allergies": "Allergies",
  "medical.conditions": "Medical conditions",
  "medical.medication": "Medication",
  "medical.dietary": "Dietary requirements",
  "medical.send_notes": "SEND / additional support notes",
  "enquiry.notes": "Your question or note",
  "application.notes": "Anything else we should know",
};

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
      fieldDefinitionForCanonical("child.legal_name", { required: true }),
      "child.preferred_name",
      fieldDefinitionForCanonical("child.date_of_birth", { required: true }),
      "child.gender",
      "child.address",
      fieldDefinitionForCanonical("child.intended_academic_year_id", { required: true }),
      fieldDefinitionForCanonical("child.intended_year_group_id", { required: true }),
      "child.proposed_start_date",
      "child.current_school",
      "child.previous_school",
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
    relationship: sanitizePlainText(rec.relationship, 40) || undefined,
    parentalResponsibility: rec.parentalResponsibility === true || rec.parental_responsibility === true,
    email: sanitizePlainText(rec.email, 120).toLowerCase() || undefined,
    phone: sanitizePlainText(rec.phone ?? rec.telephone, 40) || undefined,
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
      fieldError(field, `${field.label} is required`);
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
        if (
          field.canonicalKey !== "child.intended_academic_year_id" &&
          field.canonicalKey !== "child.intended_year_group_id"
        ) {
          fieldError(field, `${field.label} is not a valid choice`);
        }
        assertUuid(value, field);
      }
      if (
        field.canonicalKey === "child.intended_academic_year_id" ||
        field.canonicalKey === "child.intended_year_group_id"
      ) {
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
        fieldError(field, `${field.label} is required`);
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
      const filename = sanitizePlainText(rec.filename ?? rec.originalFilename, 120);
      const contentType = sanitizePlainText(rec.contentType, 120);
      const byteSize = Number(rec.byteSize ?? rec.byte_size ?? 0);
      if (!filename) {
        fieldError(field, `${field.label} requires a filename`);
      }
      if (!isAllowedAdmissionsUpload({ filename, contentType, byteSize })) {
        fieldError(field, `${field.label} file type or size is not allowed`);
      }
      return {
        filename,
        contentType,
        byteSize,
        purpose: field.documentPurpose ?? sanitizePlainText(rec.purpose, 40) ?? "other",
      } satisfies FileAnswerValue;
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
  options: { draft?: boolean } = {},
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
      case "child.preferred_name":
        setChild("preferredName", String(value));
        break;
      case "child.date_of_birth":
        setChild("dateOfBirth", String(value));
        break;
      case "child.gender":
        setChild("gender", String(value));
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
      case "guardian.relationship":
      case "guardian.parental_responsibility":
      case "guardian.address":
      case "guardian.email":
      case "guardian.phone":
      case "guardian.primary_contact": {
        const current = snapshot.guardians?.[0] ?? {};
        if (field.canonicalKey === "guardian.full_name") current.fullName = String(value);
        if (field.canonicalKey === "guardian.relationship") current.relationship = String(value);
        if (field.canonicalKey === "guardian.parental_responsibility") current.parentalResponsibility = value === true;
        if (field.canonicalKey === "guardian.address") current.address = value as AddressValue;
        if (field.canonicalKey === "guardian.email") current.email = String(value);
        if (field.canonicalKey === "guardian.phone") current.phone = String(value);
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
  const missingFiles = requiredFiles.filter((field) => isBlank(input.answers[field.fieldKey]));
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
