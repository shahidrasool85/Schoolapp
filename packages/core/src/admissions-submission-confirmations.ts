import {
  isSubmissionConfirmationKey,
  submissionConfirmationKind,
  type SubmissionConfirmationKey,
} from "@schoolapp/domain";
import { isSafeHttpUrl } from "./admissions-forms.js";
import { safeEmailText } from "./email-templates.js";

export type SubmissionConfirmationMergeField = {
  key: string;
  label: string;
  example: string;
};

export type OrganisationSubmissionConfirmation = {
  templateKey: SubmissionConfirmationKey;
  heading: string;
  message: string;
  additionalMessage: string | null;
  buttonLabel: string | null;
  buttonUrl: string | null;
};

export type RenderedSubmissionConfirmation = {
  heading: string;
  message: string;
  additionalMessage: string | null;
  button: { label: string; url: string } | null;
  referenceLabel: string;
  reference: string;
  showSystemReference: boolean;
  source: "custom" | "system";
};

export type SubmissionConfirmationCatalogItem = {
  key: SubmissionConfirmationKey;
  name: string;
  description: string;
  mergeFields: readonly SubmissionConfirmationMergeField[];
  defaults: OrganisationSubmissionConfirmation;
  sampleReference: string;
  referenceLabel: string;
};

export class SubmissionConfirmationValidationError extends Error {
  readonly code = "validation_failed";
  constructor(message: string) {
    super(message);
    this.name = "SubmissionConfirmationValidationError";
  }
}

const HEADING_MAX = 120;
const MESSAGE_MAX = 4000;
const ADDITIONAL_MAX = 2000;
const BUTTON_LABEL_MAX = 80;
const BUTTON_URL_MAX = 2000;

const PLACEHOLDER_TOKEN = /\{\{([^{}]*)\}\}/g;
const VALID_PLACEHOLDER_NAME = /^[a-z][a-z0-9_]*$/;
const UNSAFE_MARKUP = /[<>]|javascript:|data:\s*text\/html|vbscript:/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const ENQUIRY_FIELDS: readonly SubmissionConfirmationMergeField[] = [
  { key: "school_name", label: "School name", example: "Kingswood School" },
  { key: "enquiry_reference", label: "Enquiry reference", example: "ENQ-2026-0001" },
];

const APPLICATION_FIELDS: readonly SubmissionConfirmationMergeField[] = [
  { key: "school_name", label: "School name", example: "Kingswood School" },
  { key: "application_reference", label: "Application reference", example: "APP-2026-0001" },
  { key: "pupil_first_name", label: "Pupil first name", example: "Maya" },
];

const ENQUIRY_DEFAULTS: OrganisationSubmissionConfirmation = {
  templateKey: "admissions_enquiry_submission_confirmation",
  heading: "Thank you",
  message: "We have received your submission.",
  additionalMessage: null,
  buttonLabel: null,
  buttonUrl: null,
};

const APPLICATION_DEFAULTS: OrganisationSubmissionConfirmation = {
  templateKey: "admissions_application_submission_confirmation",
  heading: "Thank you",
  message: "We have received your application.",
  additionalMessage: null,
  buttonLabel: null,
  buttonUrl: null,
};

export const SUBMISSION_CONFIRMATION_CATALOG: readonly SubmissionConfirmationCatalogItem[] = [
  {
    key: "admissions_enquiry_submission_confirmation",
    name: "Enquiry submitted",
    description: "Shown on the website immediately after a public enquiry is submitted.",
    mergeFields: ENQUIRY_FIELDS,
    defaults: ENQUIRY_DEFAULTS,
    sampleReference: "ENQ-2026-0001",
    referenceLabel: "Enquiry reference",
  },
  {
    key: "admissions_application_submission_confirmation",
    name: "Application submitted",
    description: "Shown on the website immediately after a public application is submitted.",
    mergeFields: APPLICATION_FIELDS,
    defaults: APPLICATION_DEFAULTS,
    sampleReference: "APP-2026-0001",
    referenceLabel: "Application reference",
  },
];

const CATALOG_BY_KEY = new Map(SUBMISSION_CONFIRMATION_CATALOG.map((item) => [item.key, item]));

export function submissionConfirmationCatalogItem(
  key: SubmissionConfirmationKey,
): SubmissionConfirmationCatalogItem {
  return CATALOG_BY_KEY.get(key)!;
}

export function allowedSubmissionConfirmationFieldKeys(
  key: SubmissionConfirmationKey,
): ReadonlySet<string> {
  return new Set(submissionConfirmationCatalogItem(key).mergeFields.map((field) => field.key));
}

export function sampleSubmissionConfirmationData(
  key: SubmissionConfirmationKey,
  schoolName: string,
): Record<string, string> {
  const item = submissionConfirmationCatalogItem(key);
  const school = safeEmailText(schoolName, 160) || "School";
  if (key === "admissions_enquiry_submission_confirmation") {
    return { schoolName: school, enquiryReference: item.sampleReference };
  }
  return {
    schoolName: school,
    applicationReference: item.sampleReference,
    childName: "Maya Example",
  };
}

export function submissionConfirmationMergeValues(
  key: SubmissionConfirmationKey,
  data: Record<string, string | null | undefined>,
  schoolName: string,
): Record<string, string> {
  const school = safeEmailText(schoolName || data.schoolName, 160) || "School";
  const values: Record<string, string> = { school_name: school };
  if (key === "admissions_enquiry_submission_confirmation") {
    values.enquiry_reference = safeEmailText(data.enquiryReference, 40);
  }
  if (key === "admissions_application_submission_confirmation") {
    values.application_reference = safeEmailText(data.applicationReference, 40);
    values.pupil_first_name = firstNameFromDisplay(data.childName) || "your child";
  }
  return values;
}

export function validateOrganisationSubmissionConfirmation(input: {
  templateKey: string;
  heading: string;
  message: string;
  additionalMessage?: string | null;
  buttonLabel?: string | null;
  buttonUrl?: string | null;
}): OrganisationSubmissionConfirmation {
  if (!isSubmissionConfirmationKey(input.templateKey)) {
    throw new SubmissionConfirmationValidationError("This confirmation page cannot be customised.");
  }
  const heading = requirePlainField("Heading", input.heading, HEADING_MAX);
  const message = requirePlainField("Message", input.message, MESSAGE_MAX, { allowBlankLines: true });
  const additionalMessage = optionalPlainField(
    "Additional message",
    input.additionalMessage,
    ADDITIONAL_MAX,
    { allowBlankLines: true },
  );
  const buttonLabel = optionalPlainField("Button label", input.buttonLabel, BUTTON_LABEL_MAX);
  const buttonUrl = optionalButtonUrl(input.buttonUrl);
  if (Boolean(buttonLabel) !== Boolean(buttonUrl)) {
    throw new SubmissionConfirmationValidationError(
      "Button label and URL are both required, or leave both blank.",
    );
  }
  const draft: OrganisationSubmissionConfirmation = {
    templateKey: input.templateKey,
    heading,
    message,
    additionalMessage,
    buttonLabel,
    buttonUrl,
  };
  assertApprovedPlaceholders(draft);
  return draft;
}

export function renderSubmissionConfirmation(input: {
  templateKey: SubmissionConfirmationKey;
  override?: OrganisationSubmissionConfirmation | null;
  schoolName: string;
  data?: Record<string, string | null | undefined>;
  formSuccessTitle?: string | null;
  formSuccessText?: string | null;
}): RenderedSubmissionConfirmation {
  const item = submissionConfirmationCatalogItem(input.templateKey);
  const reference = authoritativeReference(input.templateKey, input.data);
  try {
    if (input.override && input.override.templateKey === input.templateKey) {
      return renderOverride(input.override, input.schoolName, input.data ?? {}, reference, "custom");
    }
  } catch {
    return systemDefaultConfirmation(input.templateKey, input.schoolName, input.data ?? {}, reference);
  }
  return fallbackConfirmation(item, input, reference);
}

export function systemDefaultConfirmation(
  templateKey: SubmissionConfirmationKey,
  schoolName: string,
  data: Record<string, string | null | undefined> = {},
  reference = authoritativeReference(templateKey, data),
): RenderedSubmissionConfirmation {
  const item = submissionConfirmationCatalogItem(templateKey);
  return renderOverride(item.defaults, schoolName, data, reference, "system");
}

function fallbackConfirmation(
  item: SubmissionConfirmationCatalogItem,
  input: {
    templateKey: SubmissionConfirmationKey;
    schoolName: string;
    data?: Record<string, string | null | undefined>;
    formSuccessTitle?: string | null;
    formSuccessText?: string | null;
  },
  reference: string,
): RenderedSubmissionConfirmation {
  const heading = optionalPlainOrNull("Heading", input.formSuccessTitle, HEADING_MAX) || item.defaults.heading;
  const message = optionalPlainOrNull("Message", input.formSuccessText, MESSAGE_MAX) || item.defaults.message;
  return renderOverride(
    {
      ...item.defaults,
      heading,
      message,
    },
    input.schoolName,
    input.data ?? {},
    reference,
    "system",
  );
}

function renderOverride(
  override: OrganisationSubmissionConfirmation,
  schoolName: string,
  data: Record<string, string | null | undefined>,
  reference: string,
  source: "custom" | "system",
): RenderedSubmissionConfirmation {
  const validated = source === "custom" ? validateOrganisationSubmissionConfirmation(override) : override;
  const values = submissionConfirmationMergeValues(validated.templateKey, data, schoolName);
  const heading = substitutePlaceholders(validated.heading, values, validated.templateKey);
  const message = substitutePlaceholders(validated.message, values, validated.templateKey);
  const additionalMessage = validated.additionalMessage
    ? substitutePlaceholders(validated.additionalMessage, values, validated.templateKey)
    : null;
  const buttonLabel = validated.buttonLabel
    ? substitutePlaceholders(validated.buttonLabel, values, validated.templateKey)
    : null;
  const buttonUrl = validated.buttonUrl;
  const item = submissionConfirmationCatalogItem(validated.templateKey);
  const usedReference = templateUsesReferencePlaceholder(validated);
  return {
    heading,
    message,
    additionalMessage: additionalMessage || null,
    button: buttonLabel && buttonUrl ? { label: buttonLabel, url: buttonUrl } : null,
    referenceLabel: item.referenceLabel,
    reference,
    showSystemReference: !usedReference,
    source,
  };
}

export function templateUsesReferencePlaceholder(override: OrganisationSubmissionConfirmation): boolean {
  const key =
    submissionConfirmationKind(override.templateKey) === "enquiry"
      ? "enquiry_reference"
      : "application_reference";
  const token = `{{${key}}}`;
  return [override.heading, override.message, override.additionalMessage ?? "", override.buttonLabel ?? ""].some(
    (value) => value.includes(token),
  );
}

export function authoritativeReference(
  templateKey: SubmissionConfirmationKey,
  data?: Record<string, string | null | undefined>,
): string {
  const item = submissionConfirmationCatalogItem(templateKey);
  if (templateKey === "admissions_enquiry_submission_confirmation") {
    return safeEmailText(data?.enquiryReference, 40) || item.sampleReference;
  }
  return safeEmailText(data?.applicationReference, 40) || item.sampleReference;
}

function firstNameFromDisplay(value: unknown): string {
  const cleaned = safeEmailText(value, 120);
  if (!cleaned) return "";
  return cleaned.split(/\s+/)[0] ?? "";
}

function requirePlainField(
  label: string,
  value: string,
  max: number,
  options: { allowBlankLines?: boolean } = {},
): string {
  const normalised = normalisePlainField(label, value, max, options);
  if (!normalised) {
    throw new SubmissionConfirmationValidationError(`${label} is required.`);
  }
  return normalised;
}

function optionalPlainField(
  label: string,
  value: string | null | undefined,
  max: number,
  options: { allowBlankLines?: boolean } = {},
): string | null {
  if (value == null || String(value).trim() === "") return null;
  return requirePlainField(label, value, max, options);
}

function optionalPlainOrNull(label: string, value: string | null | undefined, max: number): string | null {
  if (value == null || String(value).trim() === "") return null;
  try {
    return requirePlainField(label, value, max, { allowBlankLines: true });
  } catch {
    return null;
  }
}

function normalisePlainField(
  label: string,
  value: string,
  max: number,
  options: { allowBlankLines?: boolean } = {},
): string {
  const raw = String(value ?? "");
  if (CONTROL_CHARS.test(raw)) {
    throw new SubmissionConfirmationValidationError(`${label} contains invalid characters.`);
  }
  if (UNSAFE_MARKUP.test(raw)) {
    throw new SubmissionConfirmationValidationError(`${label} cannot include HTML or scripts.`);
  }
  const normalised = options.allowBlankLines
    ? raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
    : raw.replace(/\s+/g, " ").trim();
  if (normalised.length > max) {
    throw new SubmissionConfirmationValidationError(`${label} must be ${max} characters or fewer.`);
  }
  return normalised;
}

function optionalButtonUrl(value: string | null | undefined): string | null {
  if (value == null || String(value).trim() === "") return null;
  const trimmed = String(value).trim();
  if (CONTROL_CHARS.test(trimmed)) {
    throw new SubmissionConfirmationValidationError("Button URL contains invalid characters.");
  }
  if (trimmed.length > BUTTON_URL_MAX) {
    throw new SubmissionConfirmationValidationError(`Button URL must be ${BUTTON_URL_MAX} characters or fewer.`);
  }
  if (!isSafeHttpUrl(trimmed)) {
    throw new SubmissionConfirmationValidationError("Button URL must be http or https.");
  }
  return trimmed;
}

function assertApprovedPlaceholders(override: OrganisationSubmissionConfirmation): void {
  for (const [label, value] of [
    ["Heading", override.heading],
    ["Message", override.message],
    ["Additional message", override.additionalMessage ?? ""],
    ["Button label", override.buttonLabel ?? ""],
  ] as const) {
    if (value) inspectPlaceholders(label, value, override.templateKey);
  }
}

function inspectPlaceholders(label: string, value: string, template: SubmissionConfirmationKey): void {
  const allowed = allowedSubmissionConfirmationFieldKeys(template);
  let match: RegExpExecArray | null;
  PLACEHOLDER_TOKEN.lastIndex = 0;
  while ((match = PLACEHOLDER_TOKEN.exec(value))) {
    const name = match[1] ?? "";
    if (!VALID_PLACEHOLDER_NAME.test(name)) {
      throw new SubmissionConfirmationValidationError(
        `${label} contains a malformed placeholder. Use {{field_name}} from the available fields list.`,
      );
    }
    if (!allowed.has(name)) {
      throw new SubmissionConfirmationValidationError(`${label} contains an unsupported field {{${name}}}.`);
    }
  }
  if (/\{\{|\}\}/.test(value.replace(PLACEHOLDER_TOKEN, ""))) {
    throw new SubmissionConfirmationValidationError(
      `${label} contains a malformed placeholder. Use {{field_name}} from the available fields list.`,
    );
  }
}

function substitutePlaceholders(
  value: string,
  fields: Record<string, string>,
  template: SubmissionConfirmationKey,
): string {
  inspectPlaceholders("Template", value, template);
  return value.replace(PLACEHOLDER_TOKEN, (_, name: string) => fields[name] ?? "");
}
