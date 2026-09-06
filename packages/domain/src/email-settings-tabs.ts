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

export const CUSTOMIZABLE_EMAIL_TEMPLATE_KEYS = [
  "admissions_enquiry_received",
  "admissions_application_received",
] as const;

export type CustomizableEmailTemplateKey = (typeof CUSTOMIZABLE_EMAIL_TEMPLATE_KEYS)[number];

export function isCustomizableEmailTemplateKey(
  value: string | null | undefined,
): value is CustomizableEmailTemplateKey {
  return (CUSTOMIZABLE_EMAIL_TEMPLATE_KEYS as readonly string[]).includes(value ?? "");
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
