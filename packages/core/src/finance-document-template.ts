export const FINANCE_DOCUMENT_LOGO_MODES = ["school", "finance", "none"] as const;
export type FinanceDocumentLogoMode = (typeof FINANCE_DOCUMENT_LOGO_MODES)[number];

export type FinanceDocumentTemplate = {
  logoMode: FinanceDocumentLogoMode;
  showSchoolName: boolean;
  showLegalName: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showEmail: boolean;
  showWebsite: boolean;
  showVatNumber: boolean;
  footerShowContact: boolean;
  footerShowLegal: boolean;
};

export const DEFAULT_FINANCE_DOCUMENT_TEMPLATE: FinanceDocumentTemplate = {
  logoMode: "school",
  showSchoolName: true,
  showLegalName: true,
  showAddress: true,
  showPhone: true,
  showEmail: true,
  showWebsite: true,
  showVatNumber: true,
  footerShowContact: false,
  footerShowLegal: true,
};

export function isFinanceDocumentLogoMode(value: string | null | undefined): value is FinanceDocumentLogoMode {
  return FINANCE_DOCUMENT_LOGO_MODES.includes(value as FinanceDocumentLogoMode);
}

export function parseFinanceDocumentLogoMode(value: string | null | undefined): FinanceDocumentLogoMode {
  return isFinanceDocumentLogoMode(value) ? value : "school";
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === false) return value;
  return fallback;
}

export function financeDocumentTemplateFromSettings(row: Record<string, unknown> | null | undefined): FinanceDocumentTemplate {
  const raw = row ?? {};
  return {
    logoMode: parseFinanceDocumentLogoMode(raw.document_logo_mode ? String(raw.document_logo_mode) : raw.logoMode ? String(raw.logoMode) : "school"),
    showSchoolName: asBoolean(raw.document_show_school_name ?? raw.showSchoolName, true),
    showLegalName: asBoolean(raw.document_show_legal_name ?? raw.showLegalName, true),
    showAddress: asBoolean(raw.document_show_address ?? raw.showAddress, true),
    showPhone: asBoolean(raw.document_show_phone ?? raw.showPhone, true),
    showEmail: asBoolean(raw.document_show_email ?? raw.showEmail, true),
    showWebsite: asBoolean(raw.document_show_website ?? raw.showWebsite, true),
    showVatNumber: asBoolean(raw.document_show_vat_number ?? raw.showVatNumber, true),
    footerShowContact: asBoolean(raw.document_footer_show_contact ?? raw.footerShowContact, false),
    footerShowLegal: asBoolean(raw.document_footer_show_legal ?? raw.footerShowLegal, true),
  };
}

function snapshotHas(raw: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

export function freezeDocumentTemplate(raw: Record<string, unknown> | null | undefined): FinanceDocumentTemplate {
  const source = (raw?.documentTemplate as Record<string, unknown> | undefined) ?? raw ?? {};
  const hasAny =
    snapshotHas(source, "logoMode") ||
    snapshotHas(source, "showSchoolName") ||
    snapshotHas(source, "showLegalName") ||
    snapshotHas(source, "showAddress") ||
    snapshotHas(source, "showPhone") ||
    snapshotHas(source, "showEmail") ||
    snapshotHas(source, "showWebsite") ||
    snapshotHas(source, "showVatNumber") ||
    snapshotHas(source, "footerShowContact") ||
    snapshotHas(source, "footerShowLegal");
  if (!hasAny) return { ...DEFAULT_FINANCE_DOCUMENT_TEMPLATE };
  return financeDocumentTemplateFromSettings(source);
}

export function resolveFinanceLogoObjectId(input: {
  logoMode: FinanceDocumentLogoMode;
  financeLogoObjectId?: string | null;
  schoolLogoObjectId?: string | null;
}): string | null {
  if (input.logoMode === "none") return null;
  if (input.logoMode === "finance") return input.financeLogoObjectId || input.schoolLogoObjectId || null;
  return input.schoolLogoObjectId || null;
}

const FAMILY_PREFIX = /^family\s*[—–\-:]+\s*/i;

export function stripPrintedFamilyPrefix(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const stripped = trimmed.replace(FAMILY_PREFIX, "").trim();
  return stripped || trimmed;
}

export function financePayerDisplayName(input: {
  billToName?: string | null;
  familyName?: string | null;
}): string {
  return stripPrintedFamilyPrefix(input.billToName) || stripPrintedFamilyPrefix(input.familyName) || "Account holder";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function presentTuitionLineDescription(input: {
  kind?: string | null;
  description: string;
  pupilName?: string | null;
  pupilNames?: string[];
  classOrYear?: string | null;
}): string {
  const description = input.description.trim();
  if ((input.kind ?? "").toLowerCase() !== "tuition") return input.description;
  const pupilNames = [
    ...new Set([input.pupilName, ...(input.pupilNames ?? [])].map((name) => name?.trim()).filter((name): name is string => Boolean(name))),
  ];
  const autoFromPupil = pupilNames.some((name) => new RegExp(`^${escapeRegExp(name)}\\s+tuition$`, "i").test(description));
  if (!autoFromPupil) return input.description;
  const year = input.classOrYear?.trim();
  return year ? `Tuition fees – ${year}` : "Tuition fees";
}
