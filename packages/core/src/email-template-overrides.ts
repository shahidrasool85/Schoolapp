import {
  isAdmissionsStatusEmailTemplateKey,
  isCustomizableEmailTemplateKey,
  type AdmissionsStatusEmailTemplateKey,
  type CustomizableEmailTemplateKey,
} from "@schoolapp/domain";
import {
  fixturePreviewData,
  renderBrandedEmail,
  renderEmailTemplate,
  safeEmailText,
  type RenderedEmail,
  type TransactionalBranding,
} from "./email-templates.js";

export type OrganisationEmailTemplateOverride = {
  templateKey: CustomizableEmailTemplateKey;
  enabled: boolean;
  subject: string;
  heading: string;
  greeting: string;
  body: string;
  signoff: string;
};

export type EmailMergeField = {
  key: string;
  label: string;
  example: string;
};

export type EmailTemplateCatalogKind = "acknowledgement" | "admissions_status";

export type EmailTemplateCatalogItem = {
  key: CustomizableEmailTemplateKey;
  name: string;
  description: string;
  kind: EmailTemplateCatalogKind;
  defaultSendEnabled: boolean;
  mergeFields: readonly EmailMergeField[];
  defaults: OrganisationEmailTemplateOverride;
};

export class EmailTemplateValidationError extends Error {
  readonly code = "validation_failed";
  constructor(message: string) {
    super(message);
    this.name = "EmailTemplateValidationError";
  }
}

const SUBJECT_MAX = 200;
const HEADING_MAX = 120;
const GREETING_MAX = 200;
const BODY_MAX = 4000;
const SIGNOFF_MAX = 400;

const PLACEHOLDER_TOKEN = /\{\{([^{}]*)\}\}/g;
const VALID_PLACEHOLDER_NAME = /^[a-z][a-z0-9_]*$/;
const UNSAFE_MARKUP = /[<>]|javascript:|data:\s*text\/html/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const ENQUIRY_FIELDS: readonly EmailMergeField[] = [
  { key: "school_name", label: "School name", example: "Kingswood School" },
  { key: "recipient_first_name", label: "Recipient first name", example: "Jordan" },
  { key: "enquiry_reference", label: "Enquiry reference", example: "ENQ-1001" },
  { key: "school_contact_email", label: "School contact email", example: "admissions@kingswood.example.test" },
];

const APPLICATION_FIELDS: readonly EmailMergeField[] = [
  { key: "school_name", label: "School name", example: "Kingswood School" },
  { key: "recipient_first_name", label: "Recipient first name", example: "Sarah" },
  { key: "application_reference", label: "Application reference", example: "APP-1001" },
  { key: "pupil_first_name", label: "Pupil first name", example: "Maya" },
  { key: "school_contact_email", label: "School contact email", example: "admissions@kingswood.example.test" },
  { key: "intended_entry", label: "Intended year group / year", example: "Year 3 — 2026/27" },
];

const STATUS_FIELDS: readonly EmailMergeField[] = [
  ...APPLICATION_FIELDS,
  { key: "application_status", label: "Application status", example: "Offer made" },
];

const STATUS_ASSESSMENT_FIELDS: readonly EmailMergeField[] = [
  ...STATUS_FIELDS,
  { key: "assessment_date", label: "Assessment date", example: "12/05/2026" },
];

const STATUS_OFFER_FIELDS: readonly EmailMergeField[] = [
  ...STATUS_FIELDS,
  { key: "offer_deadline", label: "Offer response deadline", example: "01/06/2026" },
];

function statusDefaults(
  templateKey: AdmissionsStatusEmailTemplateKey,
  input: { subject: string; heading: string; greeting?: string; body: string; signoff?: string },
): OrganisationEmailTemplateOverride {
  return {
    templateKey,
    enabled: true,
    subject: input.subject,
    heading: input.heading,
    greeting: input.greeting ?? "Hello {{recipient_first_name}},",
    body: input.body,
    signoff: input.signoff ?? "Regards\n{{school_name}} Admissions",
  };
}

const ENQUIRY_DEFAULTS: OrganisationEmailTemplateOverride = {
  templateKey: "admissions_enquiry_received",
  enabled: true,
  subject: "Thank you for your enquiry – {{school_name}}",
  heading: "Enquiry received",
  greeting: "Dear {{recipient_first_name}},",
  body:
    "Thank you for contacting {{school_name}}.\n\nWe have received your enquiry and a member of our team will get back to you shortly.",
  signoff: "Kind regards,\n{{school_name}}",
};

const APPLICATION_DEFAULTS: OrganisationEmailTemplateOverride = {
  templateKey: "admissions_application_received",
  enabled: true,
  subject: "{{school_name}} — Application received",
  heading: "Application received",
  greeting: "Hello {{recipient_first_name}},",
  body:
    "Thank you for applying to {{school_name}} for {{pupil_first_name}}.\n\nApplication reference: {{application_reference}}\n\nIntended entry: {{intended_entry}}\n\nWe have received your application.\n\nThe admissions team will contact you if further information is required.",
  signoff: "Regards\n{{school_name}} Admissions",
};

export const AUTOMATIC_EMAIL_TEMPLATE_CATALOG: readonly EmailTemplateCatalogItem[] = [
  {
    key: "admissions_enquiry_received",
    name: "Enquiry received",
    description: "Sent to the primary parent/guardian after a public enquiry form is submitted.",
    kind: "acknowledgement",
    defaultSendEnabled: true,
    mergeFields: ENQUIRY_FIELDS,
    defaults: ENQUIRY_DEFAULTS,
  },
  {
    key: "admissions_application_received",
    name: "Application received",
    description: "Sent to the primary parent/guardian after a public application form is submitted.",
    kind: "acknowledgement",
    defaultSendEnabled: true,
    mergeFields: APPLICATION_FIELDS,
    defaults: APPLICATION_DEFAULTS,
  },
  {
    key: "admissions_status_assessment_pending",
    name: "Assessment pending",
    description: "Sent when an application moves to Assessment pending.",
    kind: "admissions_status",
    defaultSendEnabled: false,
    mergeFields: STATUS_ASSESSMENT_FIELDS,
    defaults: statusDefaults("admissions_status_assessment_pending", {
      subject: "Application update – {{school_name}}",
      heading: "Assessment pending",
      body:
        "We are writing to let you know that the application for {{pupil_first_name}} has moved to assessment pending.\n\nApplication reference: {{application_reference}}\n\nIntended entry: {{intended_entry}}\n\nAssessment date: {{assessment_date}}\n\nThe admissions team will contact you if further information is required.",
    }),
  },
  {
    key: "admissions_status_waiting_list",
    name: "Waitlisted",
    description: "Sent when an application is placed on the waiting list.",
    kind: "admissions_status",
    defaultSendEnabled: false,
    mergeFields: STATUS_FIELDS,
    defaults: statusDefaults("admissions_status_waiting_list", {
      subject: "Application update – {{school_name}}",
      heading: "Application update",
      body:
        "Your application for {{pupil_first_name}} has been placed on the waiting list.\n\nApplication reference: {{application_reference}}\n\nWe will contact you if the position changes.",
    }),
  },
  {
    key: "admissions_status_offer_made",
    name: "Offer made",
    description: "Sent when an application moves to Offer made.",
    kind: "admissions_status",
    defaultSendEnabled: false,
    mergeFields: STATUS_OFFER_FIELDS,
    defaults: statusDefaults("admissions_status_offer_made", {
      subject: "Application update – {{school_name}}",
      heading: "Offer of a place",
      body:
        "We are pleased to let you know that an offer has been made for {{pupil_first_name}}.\n\nApplication reference: {{application_reference}}\n\nIntended entry: {{intended_entry}}\n\nResponse deadline: {{offer_deadline}}\n\nPlease review the application information and any instructions provided by the school.",
    }),
  },
  {
    key: "admissions_status_accepted",
    name: "Offer accepted",
    description: "Sent when an application moves to Accepted.",
    kind: "admissions_status",
    defaultSendEnabled: false,
    mergeFields: STATUS_FIELDS,
    defaults: statusDefaults("admissions_status_accepted", {
      subject: "Application update – {{school_name}}",
      heading: "Offer accepted",
      body:
        "We are writing to confirm that the offer for {{pupil_first_name}} has been recorded as accepted.\n\nApplication reference: {{application_reference}}\n\nThe school will contact you about the next steps.",
    }),
  },
  {
    key: "admissions_status_enrolled",
    name: "Enrolled",
    description: "Sent when an application moves to Enrolled.",
    kind: "admissions_status",
    defaultSendEnabled: false,
    mergeFields: STATUS_FIELDS,
    defaults: statusDefaults("admissions_status_enrolled", {
      subject: "Welcome to {{school_name}}",
      heading: "Welcome to {{school_name}}",
      body:
        "We are pleased to confirm that {{pupil_first_name}} has been enrolled.\n\nApplication reference: {{application_reference}}\n\nPlease contact the school if you have any questions about starting.",
    }),
  },
  {
    key: "admissions_status_rejected",
    name: "Application unsuccessful",
    description: "Sent when an application moves to Rejected.",
    kind: "admissions_status",
    defaultSendEnabled: false,
    mergeFields: STATUS_FIELDS,
    defaults: statusDefaults("admissions_status_rejected", {
      subject: "Application update – {{school_name}}",
      heading: "Application update",
      body:
        "We are writing to let you know that the application for {{pupil_first_name}} has not been successful.\n\nApplication reference: {{application_reference}}\n\nPlease contact the school if you have any questions.",
    }),
  },
  {
    key: "admissions_status_withdrawn",
    name: "Application withdrawn",
    description: "Sent when an application moves to Withdrawn.",
    kind: "admissions_status",
    defaultSendEnabled: false,
    mergeFields: STATUS_FIELDS,
    defaults: statusDefaults("admissions_status_withdrawn", {
      subject: "Application update – {{school_name}}",
      heading: "Application update",
      body:
        "We are writing to let you know that the application for {{pupil_first_name}} has been withdrawn.\n\nApplication reference: {{application_reference}}\n\nPlease contact the school if you have any questions.",
    }),
  },
];

const CATALOG_BY_KEY = new Map(AUTOMATIC_EMAIL_TEMPLATE_CATALOG.map((item) => [item.key, item]));

export function automaticEmailCatalogItem(
  key: CustomizableEmailTemplateKey,
): EmailTemplateCatalogItem {
  return CATALOG_BY_KEY.get(key)!;
}

export function allowedMergeFieldKeys(key: CustomizableEmailTemplateKey): ReadonlySet<string> {
  return new Set(automaticEmailCatalogItem(key).mergeFields.map((field) => field.key));
}

export function automaticEmailDefaultSendEnabled(key: CustomizableEmailTemplateKey): boolean {
  return automaticEmailCatalogItem(key).defaultSendEnabled;
}

export function resolveAutomaticEmailSendEnabled(
  key: CustomizableEmailTemplateKey,
  storedSendEnabled: boolean | null | undefined,
): boolean {
  if (!isAdmissionsStatusEmailTemplateKey(key)) return true;
  return storedSendEnabled === true;
}

export function firstNameFromDisplayName(value: unknown): string {
  const cleaned = safeEmailText(value, 120);
  if (!cleaned) return "";
  return cleaned.split(/\s+/)[0] ?? "";
}

export function sampleMergeData(
  template: CustomizableEmailTemplateKey,
  branding: TransactionalBranding,
  schoolContactEmail?: string | null,
): Record<string, string> {
  const fixture = fixturePreviewData(template);
  return {
    ...fixture,
    schoolName: branding.schoolName || fixture.schoolName || "School",
    schoolContactEmail:
      safeEmailText(schoolContactEmail, 120) ||
      fixture.schoolContactEmail ||
      "admissions@example.test",
  };
}

export function mergeFieldValues(
  template: CustomizableEmailTemplateKey,
  data: Record<string, string | null | undefined>,
  branding: TransactionalBranding,
): Record<string, string> {
  const school = safeEmailText(branding.schoolName || data.schoolName, 160) || "School";
  const recipient = firstNameFromDisplayName(data.recipientName) || "Parent/Guardian";
  const contact = safeEmailText(data.schoolContactEmail, 120);
  const values: Record<string, string> = {
    school_name: school,
    recipient_first_name: recipient,
    school_contact_email: contact,
  };
  if (template === "admissions_enquiry_received") {
    values.enquiry_reference = safeEmailText(data.enquiryReference, 40);
  }
  if (template === "admissions_application_received" || isAdmissionsStatusEmailTemplateKey(template)) {
    values.application_reference = safeEmailText(data.applicationReference, 40);
    values.pupil_first_name = firstNameFromDisplayName(data.childName) || "your child";
    values.intended_entry = safeEmailText(data.intendedEntry, 80);
  }
  if (isAdmissionsStatusEmailTemplateKey(template)) {
    values.application_status = safeEmailText(data.statusLabel || data.applicationStatus, 80);
    if (template === "admissions_status_assessment_pending") {
      values.assessment_date = safeEmailText(data.assessmentDate, 40);
    }
    if (template === "admissions_status_offer_made") {
      values.offer_deadline = safeEmailText(data.offerDeadline, 40);
    }
  }
  return values;
}

export function validateOrganisationEmailTemplate(input: {
  templateKey: string;
  enabled?: boolean;
  subject: string;
  heading: string;
  greeting: string;
  body: string;
  signoff: string;
}): OrganisationEmailTemplateOverride {
  if (!isCustomizableEmailTemplateKey(input.templateKey)) {
    throw new EmailTemplateValidationError("This automatic email cannot be customised.");
  }
  const subject = requirePlainField("Subject", input.subject, SUBJECT_MAX);
  const heading = requirePlainField("Heading", input.heading, HEADING_MAX);
  const greeting = requirePlainField("Greeting", input.greeting, GREETING_MAX);
  const body = requirePlainField("Body", input.body, BODY_MAX, { allowBlankLines: true });
  const signoff = requirePlainField("Sign-off", input.signoff, SIGNOFF_MAX, { allowBlankLines: true });
  const draft: OrganisationEmailTemplateOverride = {
    templateKey: input.templateKey,
    enabled: input.enabled !== false,
    subject,
    heading,
    greeting,
    body,
    signoff,
  };
  assertApprovedPlaceholders(draft);
  return draft;
}

export function renderCustomEmailTemplate(
  override: OrganisationEmailTemplateOverride,
  data: Record<string, string | null | undefined>,
  branding: TransactionalBranding,
): RenderedEmail {
  const values = mergeFieldValues(override.templateKey, data, branding);
  const subject = substitutePlaceholders(override.subject, values, override.templateKey);
  const heading = substitutePlaceholders(override.heading, values, override.templateKey);
  const greeting = substitutePlaceholders(override.greeting, values, override.templateKey);
  const body = substitutePlaceholders(override.body, values, override.templateKey);
  const signoff = substitutePlaceholders(override.signoff, values, override.templateKey);
  const paragraphs = body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!paragraphs.length) {
    throw new EmailTemplateValidationError("Body is required.");
  }
  const school = values.school_name || "School";
  return renderBrandedEmail({
    branding,
    subject,
    heading,
    preheader: paragraphs[0] ?? `Update from ${school}`,
    greeting,
    paragraphs,
    signoff,
  });
}

export function renderTransactionalEmail(
  template: Parameters<typeof renderEmailTemplate>[0],
  data: Record<string, string | null | undefined>,
  branding: TransactionalBranding,
  override?: OrganisationEmailTemplateOverride | null,
): RenderedEmail {
  if (
    override &&
    override.enabled &&
    isCustomizableEmailTemplateKey(template) &&
    override.templateKey === template
  ) {
    try {
      return renderCustomEmailTemplate(override, data, branding);
    } catch {
      if (isAdmissionsStatusEmailTemplateKey(template)) {
        return renderCustomEmailTemplate(automaticEmailCatalogItem(template).defaults, data, branding);
      }
      return renderEmailTemplate(template, data, branding);
    }
  }
  if (isAdmissionsStatusEmailTemplateKey(template)) {
    return renderCustomEmailTemplate(automaticEmailCatalogItem(template).defaults, data, branding);
  }
  return renderEmailTemplate(template, data, branding);
}

function requirePlainField(
  label: string,
  value: string,
  max: number,
  options: { allowBlankLines?: boolean } = {},
): string {
  const raw = String(value ?? "");
  if (CONTROL_CHARS.test(raw)) {
    throw new EmailTemplateValidationError(`${label} contains invalid characters.`);
  }
  if (UNSAFE_MARKUP.test(raw)) {
    throw new EmailTemplateValidationError(`${label} cannot include HTML or scripts.`);
  }
  const normalised = options.allowBlankLines
    ? raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
    : raw.replace(/\s+/g, " ").trim();
  if (!normalised) {
    throw new EmailTemplateValidationError(`${label} is required.`);
  }
  if (normalised.length > max) {
    throw new EmailTemplateValidationError(`${label} must be ${max} characters or fewer.`);
  }
  return normalised;
}

function assertApprovedPlaceholders(override: OrganisationEmailTemplateOverride): void {
  for (const [label, value] of [
    ["Subject", override.subject],
    ["Heading", override.heading],
    ["Greeting", override.greeting],
    ["Body", override.body],
    ["Sign-off", override.signoff],
  ] as const) {
    inspectPlaceholders(label, value, override.templateKey);
  }
}

function inspectPlaceholders(
  label: string,
  value: string,
  template: CustomizableEmailTemplateKey,
): void {
  const allowed = allowedMergeFieldKeys(template);
  let match: RegExpExecArray | null;
  PLACEHOLDER_TOKEN.lastIndex = 0;
  const seen = new Set<number>();
  while ((match = PLACEHOLDER_TOKEN.exec(value))) {
    seen.add(match.index);
    const name = match[1] ?? "";
    if (!VALID_PLACEHOLDER_NAME.test(name)) {
      throw new EmailTemplateValidationError(
        `${label} contains a malformed placeholder. Use {{field_name}} from the available fields list.`,
      );
    }
    if (!allowed.has(name)) {
      throw new EmailTemplateValidationError(
        `${label} contains an unsupported field {{${name}}}.`,
      );
    }
  }
  if (/\{\{|\}\}/.test(value.replace(PLACEHOLDER_TOKEN, ""))) {
    throw new EmailTemplateValidationError(
      `${label} contains a malformed placeholder. Use {{field_name}} from the available fields list.`,
    );
  }
}

function substitutePlaceholders(
  value: string,
  fields: Record<string, string>,
  template: CustomizableEmailTemplateKey,
): string {
  inspectPlaceholders("Template", value, template);
  return value.replace(PLACEHOLDER_TOKEN, (_, name: string) => fields[name] ?? "");
}
