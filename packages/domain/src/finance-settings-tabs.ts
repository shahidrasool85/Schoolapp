export const FINANCE_SETTINGS_PATH = "/school/finance/settings";

export const FINANCE_SETTINGS_TABS = [
  "general",
  "documents",
  "payment",
  "vat",
  "online-payments",
  "notifications",
] as const;

export type FinanceSettingsTab = (typeof FINANCE_SETTINGS_TABS)[number];

export const DEFAULT_FINANCE_SETTINGS_TAB: FinanceSettingsTab = "general";

export const FINANCE_SETTINGS_TAB_ITEMS: ReadonlyArray<{
  key: FinanceSettingsTab;
  label: string;
}> = [
  { key: "general", label: "General" },
  { key: "documents", label: "Documents" },
  { key: "payment", label: "Payment details" },
  { key: "vat", label: "VAT / Tax" },
  { key: "online-payments", label: "Online payments" },
  { key: "notifications", label: "Notifications" },
];

export function parseFinanceSettingsTab(value: string | null | undefined): FinanceSettingsTab {
  const key = (value ?? "").trim().toLowerCase();
  return (FINANCE_SETTINGS_TABS as readonly string[]).includes(key)
    ? (key as FinanceSettingsTab)
    : DEFAULT_FINANCE_SETTINGS_TAB;
}

export function financeSettingsTabHref(tab: FinanceSettingsTab): string {
  return `${FINANCE_SETTINGS_PATH}?tab=${tab}`;
}
