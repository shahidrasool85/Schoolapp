export const EMAIL_DELIVERY_PATH = "/school/settings/email";

export const EMAIL_SETTINGS_TABS = ["delivery", "automatic"] as const;

export type EmailSettingsTab = (typeof EMAIL_SETTINGS_TABS)[number];

export const DEFAULT_EMAIL_SETTINGS_TAB: EmailSettingsTab = "delivery";

export const EMAIL_SETTINGS_TAB_ITEMS: ReadonlyArray<{
  key: EmailSettingsTab;
  label: string;
}> = [
  { key: "delivery", label: "Delivery" },
  { key: "automatic", label: "Automatic emails" },
];

export const ADMISSIONS_STATUS_EMAIL_TEMPLATE_KEYS = [
  "admissions_status_assessment_pending",
  "admissions_status_waiting_list",
  "admissions_status_offer_made",
  "admissions_status_accepted",
  "admissions_status_enrolled",
  "admissions_status_rejected",
  "admissions_status_withdrawn",
] as const;
export type AdmissionsStatusEmailTemplateKey = (typeof ADMISSIONS_STATUS_EMAIL_TEMPLATE_KEYS)[number];

export const CUSTOMIZABLE_EMAIL_TEMPLATE_KEYS = [
  "admissions_enquiry_received",
  "admissions_application_received",
  ...ADMISSIONS_STATUS_EMAIL_TEMPLATE_KEYS,
] as const;

export type CustomizableEmailTemplateKey = (typeof CUSTOMIZABLE_EMAIL_TEMPLATE_KEYS)[number];

export const ADMISSIONS_STATUS_EMAIL_BY_STATUS = {
  assessment_pending: "admissions_status_assessment_pending",
  waiting_list: "admissions_status_waiting_list",
  offer_made: "admissions_status_offer_made",
  accepted: "admissions_status_accepted",
  enrolled: "admissions_status_enrolled",
  rejected: "admissions_status_rejected",
  withdrawn: "admissions_status_withdrawn",
} as const;

export type AdmissionsStatusEmailDestination =
  keyof typeof ADMISSIONS_STATUS_EMAIL_BY_STATUS;

export function isAdmissionsStatusEmailTemplateKey(
  value: string | null | undefined,
): value is AdmissionsStatusEmailTemplateKey {
  return (ADMISSIONS_STATUS_EMAIL_TEMPLATE_KEYS as readonly string[]).includes(value ?? "");
}

export function isCustomizableEmailTemplateKey(
  value: string | null | undefined,
): value is CustomizableEmailTemplateKey {
  return (CUSTOMIZABLE_EMAIL_TEMPLATE_KEYS as readonly string[]).includes(value ?? "");
}

export function admissionsStatusEmailTemplateKeyForStatus(
  status: string | null | undefined,
): AdmissionsStatusEmailTemplateKey | null {
  if (!status) return null;
  return (ADMISSIONS_STATUS_EMAIL_BY_STATUS as Record<string, AdmissionsStatusEmailTemplateKey>)[status] ?? null;
}

export function parseEmailSettingsTab(value: string | null | undefined): EmailSettingsTab {
  const key = (value ?? "").trim().toLowerCase();
  return (EMAIL_SETTINGS_TABS as readonly string[]).includes(key)
    ? (key as EmailSettingsTab)
    : DEFAULT_EMAIL_SETTINGS_TAB;
}

export function emailSettingsTabHref(tab: EmailSettingsTab): string {
  return `${EMAIL_DELIVERY_PATH}?tab=${tab}`;
}

export function emailTemplateEditorHref(templateKey: CustomizableEmailTemplateKey): string {
  return `${EMAIL_DELIVERY_PATH}?tab=automatic&template=${templateKey}`;
}
