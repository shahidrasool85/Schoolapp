import { formatUkNumericDate } from "@schoolapp/domain";
import { formatVatRateLabel } from "./vat.js";
import { formatMoney } from "./money.js";
import {
  DEFAULT_FINANCE_DOCUMENT_TEMPLATE,
  financePayerDisplayName,
  freezeDocumentTemplate,
  presentTuitionLineDescription,
  type FinanceDocumentTemplate,
} from "./finance-document-template.js";
import {
  DEFAULT_FINANCE_ACCENT,
  PDF_MARGIN_BOTTOM,
  PDF_MARGIN_LEFT,
  PDF_MARGIN_RIGHT,
  PDF_MARGIN_TOP,
  PDF_PAGE_HEIGHT,
  PDF_PAGE_WIDTH,
  PdfBuilder,
  extractPdfText,
  fittedImageSize,
  parseHexColor,
  textWidth,
  wrapText,
  type FinancePdfLogo,
  type PdfFont,
  type PdfRgb,
} from "./finance-pdf.js";

export type { FinancePdfLogo };
export { extractPdfText, DEFAULT_FINANCE_ACCENT };

export type FinanceObjectStore = {
  getObject(key: string): Promise<{ body: Uint8Array } | null>;
};

export type FinanceDocumentLine = {
  description: string;
  pupilName?: string | null;
  classOrYear?: string | null;
  amountMinor: number;
  date?: string | null;
  activity?: string | null;
  quantity?: number | null;
  rateMinor?: number | null;
  kind?: string | null;
  vatTreatment?: "none" | "standard" | "inherit" | null;
  vatRateBps?: number | null;
  netMinor?: number | null;
  vatMinor?: number | null;
  grossMinor?: number | null;
};

export type FinanceReceiptAllocation = {
  invoiceNumber: string;
  invoiceDate?: string | null;
  amountMinor: number;
};

export type FinanceSchoolBranding = {
  schoolName: string;
  schoolLegalName?: string | null;
  schoolAddress?: string | null;
  schoolAddressLines?: string[];
  schoolPhone?: string | null;
  schoolEmail?: string | null;
  schoolWebsite?: string | null;
  schoolContact?: string | null;
  accentColor?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankSortCode?: string | null;
  paymentInstructions?: string | null;
  logoObjectId?: string | null;
  documentTemplate?: FinanceDocumentTemplate | null;
  samplePreview?: boolean;
};

export type FinanceInvoiceDocument = FinanceSchoolBranding & {
  kind: "invoice";
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  terms?: string | null;
  familyName: string;
  billToName?: string | null;
  billToAddressLines?: string[];
  pupilNames: string[];
  classOrYear?: string | null;
  description: string;
  billingPeriod: string;
  instalmentLabel?: string | null;
  currency: string;
  subtotalMinor?: number;
  discountTotalMinor?: number;
  creditTotalMinor?: number;
  amountMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  status: string;
  lines: FinanceDocumentLine[];
  footer?: string | null;
  vatInvoice: boolean;
  vatRegistrationNumber?: string | null;
  vatRateBps?: number | null;
  vatPricesInclusive?: boolean | null;
  vatNetMinor?: number | null;
  vatAmountMinor?: number | null;
  logo?: FinancePdfLogo | null;
};

export type FinanceReceiptDocument = FinanceSchoolBranding & {
  kind: "receipt";
  receiptNumber: string;
  paymentDate: string;
  familyName: string;
  billToName?: string | null;
  billToAddressLines?: string[];
  pupilNames: string[];
  invoiceReferences: string[];
  allocations?: FinanceReceiptAllocation[];
  description: string;
  currency: string;
  amountMinor: number;
  paymentMethod: string;
  providerReference?: string | null;
  memo?: string | null;
  remainingMinor: number;
  status: string;
  logo?: FinancePdfLogo | null;
};

export type FinanceStatementDocument = FinanceSchoolBranding & {
  kind: "statement";
  familyName: string;
  pupilNames: string[];
  periodLabel: string;
  from: string;
  to: string;
  currency: string;
  openingMinor: number;
  closingMinor: number;
  outstandingMinor: number;
  entries: Array<{
    date: string;
    kind: string;
    reference: string;
    description?: string | null;
    debitMinor: number;
    creditMinor: number;
    balanceMinor: number;
  }>;
  logo?: FinancePdfLogo | null;
};

export type FinancePdfDocument = FinanceInvoiceDocument | FinanceReceiptDocument | FinanceStatementDocument;

const INK: PdfRgb = { r: 0.12, g: 0.14, b: 0.18 };
const MUTED: PdfRgb = { r: 0.42, g: 0.45, b: 0.5 };
const RULE: PdfRgb = { r: 0.82, g: 0.85, b: 0.88 };
const WHITE: PdfRgb = { r: 1, g: 1, b: 1 };
const PAID: PdfRgb = { r: 0.11, g: 0.49, b: 0.31 };
const VOID: PdfRgb = { r: 0.61, g: 0.11, b: 0.11 };
const CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN_LEFT - PDF_MARGIN_RIGHT;

const LINE_ACTIVITY: Record<string, string> = {
  tuition: "Tuition",
  trip: "School trip",
  club: "Club",
  examination: "Examination",
  activity: "Activity",
  registration: "Registration",
  deposit: "Deposit",
  meal: "Meal",
  discount: "Discount",
  credit: "Credit",
  miscellaneous: "Miscellaneous",
  music: "Music",
  after_school: "After-school care",
  admissions: "Admissions",
};

const QTY_RATE_KINDS = new Set([
  "trip",
  "club",
  "examination",
  "activity",
  "registration",
  "meal",
  "music",
  "after_school",
  "admissions",
]);

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  card: "Card payment (Stripe)",
  stripe: "Card payment (Stripe)",
  bank_transfer: "Bank transfer",
  cash: "Cash",
  cheque: "Cheque",
  direct_debit: "Direct debit",
  other: "Other / manual",
  manual: "Other / manual",
};

export function paymentMethodLabel(method: string | null | undefined): string {
  const key = (method ?? "").trim().toLowerCase();
  if (!key) return "Other / manual";
  if (PAYMENT_METHOD_LABELS[key]) return PAYMENT_METHOD_LABELS[key];
  if (key.includes("stripe") || key.includes("card")) return "Card payment (Stripe)";
  if (key.includes("bank") || key.includes("transfer")) return "Bank transfer";
  if (key.includes("cash")) return "Cash";
  if (key.includes("cheque") || key.includes("check")) return "Cheque";
  return "Other / manual";
}

export function invoiceStatusLabel(status: string, outstandingMinor: number): string {
  const key = status.replace(/_/g, " ").trim().toLowerCase();
  if (key === "void") return "VOID";
  if (outstandingMinor <= 0 && key !== "draft") return "PAID";
  if (key === "partially paid" || key === "partial") return "PARTIALLY PAID";
  if (key === "overdue") return "OVERDUE";
  if (key === "issued" || key === "outstanding") return "OUTSTANDING";
  return status.replace(/_/g, " ").toUpperCase();
}

export function isSensitiveProviderReference(value: string | null | undefined): boolean {
  if (!value) return true;
  return /^(pi_|cs_|ch_|py_|seti_|acct_|sk_|whsec_)/i.test(value.trim());
}

function money(amountMinor: number, currency: string, withSymbol = true): string {
  const absolute = Math.abs(amountMinor);
  try {
    const formatted = formatMoney(absolute, currency);
    const signed = amountMinor < 0 ? `-${formatted}` : formatted;
    if (withSymbol) return signed;
    return signed.replace(/^[^\d-]+/, "").trim();
  } catch {
    const major = (absolute / 100).toFixed(2);
    const prefix = withSymbol && currency === "GBP" ? "£" : withSymbol ? `${currency} ` : "";
    return `${amountMinor < 0 ? "-" : ""}${prefix}${major}`;
  }
}

function displayDate(value: string | null | undefined): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return formatUkNumericDate(value);
  return value;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || /^n\/a$/i.test(trimmed)) return null;
  return trimmed;
}

function addressLines(doc: FinanceSchoolBranding & { billToAddressLines?: string[] }, which: "school" | "billTo"): string[] {
  if (which === "billTo") {
    return (doc as FinanceInvoiceDocument | FinanceReceiptDocument).billToAddressLines?.map((line) => line.trim()).filter(Boolean) ?? [];
  }
  if (doc.schoolAddressLines?.length) return doc.schoolAddressLines.map((line) => line.trim()).filter(Boolean);
  if (doc.schoolAddress) {
    return doc.schoolAddress
      .split(/\n|,/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

function documentTemplateOf(doc: FinanceSchoolBranding): FinanceDocumentTemplate {
  return doc.documentTemplate ?? DEFAULT_FINANCE_DOCUMENT_TEMPLATE;
}

function schoolContactLines(doc: FinanceSchoolBranding): string[] {
  const template = documentTemplateOf(doc);
  const lines: string[] = [];
  if (template.showPhone && nonEmpty(doc.schoolPhone)) lines.push(doc.schoolPhone!);
  if (template.showEmail && nonEmpty(doc.schoolEmail)) lines.push(doc.schoolEmail!);
  if (template.showWebsite && nonEmpty(doc.schoolWebsite)) lines.push(doc.schoolWebsite!);
  if (!lines.length && template.showPhone && template.showEmail && nonEmpty(doc.schoolContact)) {
    return doc.schoolContact!.split("·").map((part) => part.trim()).filter(Boolean);
  }
  return lines;
}

function showBankDetails(doc: FinancePdfDocument): boolean {
  if (doc.kind === "invoice") return doc.outstandingMinor > 0;
  if (doc.kind === "receipt") {
    const method = (doc.paymentMethod ?? "").toLowerCase();
    return method.includes("bank") || method.includes("transfer");
  }
  return false;
}

function bankFooterLines(doc: FinanceSchoolBranding): string[] {
  const parts: string[] = [];
  if (nonEmpty(doc.bankAccountNumber)) parts.push(`Account number: ${doc.bankAccountNumber}`);
  if (nonEmpty(doc.bankSortCode)) parts.push(`Sort code: ${doc.bankSortCode}`);
  if (nonEmpty(doc.bankName)) parts.push(`Bank: ${doc.bankName}`);
  return parts;
}

function tint(color: PdfRgb, amount: number): PdfRgb {
  return {
    r: color.r + (1 - color.r) * amount,
    g: color.g + (1 - color.g) * amount,
    b: color.b + (1 - color.b) * amount,
  };
}

function statusColor(label: string, accent: PdfRgb): PdfRgb {
  if (label === "PAID") return PAID;
  if (label === "VOID") return VOID;
  return accent;
}

function lineShowsQtyRate(line: FinanceDocumentLine): boolean {
  const kind = (line.kind ?? "").toLowerCase();
  if (kind && QTY_RATE_KINDS.has(kind)) return true;
  return Boolean(line.quantity && line.quantity !== 1) || Boolean(line.rateMinor && line.quantity);
}

type TableColumn = { key: string; title: string; width: number; align: "left" | "right" };

function invoiceColumns(doc: FinanceInvoiceDocument): TableColumn[] {
  const vat = Boolean(doc.vatInvoice);
  const showQtyRate = !vat && doc.lines.some(lineShowsQtyRate);
  const cols: TableColumn[] = [
    { key: "date", title: "DATE", width: vat ? 58 : 68, align: "left" },
  ];
  if (!vat) cols.push({ key: "activity", title: "ACTIVITY", width: 78, align: "left" });
  cols.push({ key: "description", title: "DESCRIPTION", width: 0, align: "left" });
  if (showQtyRate) {
    cols.push({ key: "qty", title: "QTY", width: 36, align: "right" });
    cols.push({ key: "rate", title: "RATE", width: 58, align: "right" });
  }
  if (vat) {
    cols.push({ key: "net", title: "NET", width: 62, align: "right" });
    cols.push({ key: "vatRate", title: "VAT %", width: 42, align: "right" });
    cols.push({ key: "vat", title: "VAT", width: 58, align: "right" });
    cols.push({ key: "gross", title: "GROSS", width: 64, align: "right" });
  } else {
    cols.push({ key: "amount", title: "AMOUNT", width: 70, align: "right" });
  }
  const used = cols.reduce((sum, col) => sum + col.width, 0);
  const desc = cols.find((col) => col.key === "description")!;
  desc.width = CONTENT_WIDTH - used;
  return cols;
}

function lineDescription(line: FinanceDocumentLine, doc?: FinanceInvoiceDocument): string {
  const presented = presentTuitionLineDescription({
    kind: line.kind,
    description: line.description,
    pupilName: line.pupilName,
    pupilNames: doc?.pupilNames,
    classOrYear: line.classOrYear ?? doc?.classOrYear,
  });
  if ((line.kind ?? "").toLowerCase() === "tuition" && presented !== line.description) return presented;
  const pupil = nonEmpty(line.pupilName);
  if (pupil && !presented.includes(pupil)) return `${presented} (${pupil})`;
  return presented;
}

function lineActivity(line: FinanceDocumentLine): string {
  if (nonEmpty(line.activity)) return line.activity!;
  if (line.kind && LINE_ACTIVITY[line.kind]) return LINE_ACTIVITY[line.kind] ?? "";
  return "";
}

class DocumentPainter {
  readonly pdf = new PdfBuilder();
  y = PDF_PAGE_HEIGHT - PDF_MARGIN_TOP;
  readonly accent: PdfRgb;
  readonly logo;
  pageHeader: "full" | "compact" = "full";
  onNewPage?: (compact: boolean) => void;

  constructor(
    readonly doc: FinancePdfDocument,
    accentHex: string,
  ) {
    this.accent = parseHexColor(accentHex);
    this.logo = this.pdf.registerLogo("logo" in doc ? doc.logo : null);
  }

  get contentBottom(): number {
    return PDF_MARGIN_BOTTOM + 28;
  }

  ensure(height: number, compactHeader = true): void {
    if (this.y - height >= this.contentBottom) return;
    this.pdf.addPage();
    this.y = PDF_PAGE_HEIGHT - PDF_MARGIN_TOP;
    this.pageHeader = "compact";
    this.onNewPage?.(compactHeader);
  }

  gap(size: number): void {
    this.y -= size;
  }

  textLine(text: string, opts: { size?: number; font?: PdfFont; color?: PdfRgb; x?: number } = {}): void {
    const size = opts.size ?? 9;
    this.ensure(size + 3);
    this.pdf.text({
      text,
      x: opts.x ?? PDF_MARGIN_LEFT,
      y: this.y - size,
      size,
      font: opts.font,
      color: opts.color ?? INK,
    });
    this.y -= size + 3;
  }

  wrapped(text: string, opts: { size?: number; font?: PdfFont; color?: PdfRgb; width?: number; x?: number } = {}): number {
    const size = opts.size ?? 9;
    const width = opts.width ?? CONTENT_WIDTH;
    const lines = wrapText(text, width, size, opts.font ?? "regular");
    for (const line of lines) this.textLine(line, { ...opts, size });
    return lines.length;
  }

  drawSchoolHeader(title: string, compact: boolean): void {
    const startY = PDF_PAGE_HEIGHT - PDF_MARGIN_TOP;
    const template = documentTemplateOf(this.doc);
    const logoBoxW = compact ? 110 : 168;
    const logoBoxH = compact ? 48 : 72;
    let logoHeight = 0;
    let textX = PDF_MARGIN_LEFT;
    let textWidthMax = CONTENT_WIDTH;
    if (this.logo) {
      const fitted = fittedImageSize(this.logo, logoBoxW, logoBoxH);
      logoHeight = fitted.height;
      this.pdf.drawImage(this.logo, PDF_MARGIN_LEFT, startY - fitted.height, fitted.width, fitted.height);
      textX = PDF_MARGIN_LEFT + logoBoxW + 12;
      textWidthMax = CONTENT_WIDTH - logoBoxW - 12;
    }
    this.y = startY;
    if (template.showSchoolName) {
      this.wrapped(this.doc.schoolName, {
        size: compact ? 11 : 13,
        font: "bold",
        color: INK,
        width: textWidthMax,
        x: textX,
      });
    }
    if (!compact) {
      this.gap(2);
      if (
        template.showLegalName &&
        nonEmpty(this.doc.schoolLegalName) &&
        this.doc.schoolLegalName !== this.doc.schoolName
      ) {
        this.wrapped(this.doc.schoolLegalName!, { size: 9, color: MUTED, width: textWidthMax, x: textX });
      }
      if (template.showAddress) {
        for (const line of addressLines(this.doc, "school")) {
          this.wrapped(line, { size: 9, color: MUTED, width: textWidthMax, x: textX });
        }
      }
      for (const line of schoolContactLines(this.doc)) {
        this.textLine(line, { size: 9, color: MUTED, x: textX });
      }
    }
    const headerBottom = Math.min(this.y, startY - logoHeight - 4);
    this.y = headerBottom - 10;
    this.pdf.line(PDF_MARGIN_LEFT, this.y + 6, PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT, this.y + 6, this.accent, compact ? 1 : 1.6);
    this.textLine(title, { size: compact ? 13 : 18, font: "bold", color: this.accent });
    if (this.doc.samplePreview) {
      this.textLine("SAMPLE — preview only", { size: 8, font: "bold", color: MUTED });
    }
    this.gap(compact ? 6 : 12);
  }

  drawFooter(pageIndex: number, pageCount: number): void {
    const template = documentTemplateOf(this.doc);
    const legal = nonEmpty(this.doc.schoolLegalName) ?? this.doc.schoolName;
    const bank = bankFooterLines(this.doc);
    const contact = schoolContactLines(this.doc).join(" · ");
    const y = 28;
    this.pdf.line(PDF_MARGIN_LEFT, 46, PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT, 46, RULE, 0.5);
    if (template.footerShowLegal) {
      this.pdf.text({ text: legal, x: PDF_MARGIN_LEFT, y, size: 8, color: MUTED });
    } else if (template.footerShowContact && contact) {
      this.pdf.text({ text: contact, x: PDF_MARGIN_LEFT, y, size: 8, color: MUTED });
    }
    if (template.footerShowLegal && template.footerShowContact && contact) {
      this.pdf.text({ text: contact, x: PDF_MARGIN_LEFT, y: y - 11, size: 8, color: MUTED });
    }
    if (showBankDetails(this.doc) && bank.length) {
      const bankY = template.footerShowLegal && template.footerShowContact && contact ? y - 22 : y - 11;
      this.pdf.text({ text: bank.join("   "), x: PDF_MARGIN_LEFT, y: bankY, size: 8, color: MUTED });
    }
    const pageLabel = `Page ${pageIndex + 1} of ${pageCount}`;
    this.pdf.text({
      text: pageLabel,
      x: PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT - textWidth(pageLabel, 8),
      y,
      size: 8,
      color: MUTED,
    });
  }

  drawKv(rows: Array<[string, string]>, x: number, startY: number): number {
    let y = startY;
    const labelWidth = 92;
    const valueWidth = PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT - x - labelWidth;
    for (const [label, value] of rows) {
      if (!nonEmpty(value)) continue;
      const wrapped = wrapText(value, Math.max(80, valueWidth), 9);
      this.pdf.text({ text: label, x, y: y - 9, size: 8, font: "bold", color: MUTED });
      wrapped.forEach((line, index) => {
        this.pdf.text({ text: line, x: x + labelWidth, y: y - 9 - index * 11, size: 9, color: INK });
      });
      y -= Math.max(14, wrapped.length * 11 + 3);
    }
    return y;
  }
}

function drawTableHeader(painter: DocumentPainter, columns: TableColumn[]): void {
  painter.ensure(18);
  const y = painter.y - 16;
  painter.pdf.fillRect(PDF_MARGIN_LEFT, y, CONTENT_WIDTH, 16, tint(painter.accent, 0.82));
  let x = PDF_MARGIN_LEFT + 6;
  for (const col of columns) {
    const textX = col.align === "right" ? x + col.width - 8 - textWidth(col.title, 7.5, "bold") : x;
    painter.pdf.text({ text: col.title, x: textX, y: y + 4.5, size: 7.5, font: "bold", color: INK });
    x += col.width;
  }
  painter.y = y - 2;
}

function drawInvoiceRow(
  painter: DocumentPainter,
  columns: TableColumn[],
  cells: Record<string, string>,
): void {
  const wrapped: Record<string, string[]> = {};
  let rowHeight = 14;
  for (const col of columns) {
    const lines = wrapText(cells[col.key] ?? "", col.width - 10, 8);
    wrapped[col.key] = lines;
    rowHeight = Math.max(rowHeight, lines.length * 11 + 6);
  }
  painter.ensure(rowHeight + 2);
  const top = painter.y;
  const bottom = top - rowHeight;
  painter.pdf.line(PDF_MARGIN_LEFT, bottom, PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT, bottom, RULE, 0.4);
  let x = PDF_MARGIN_LEFT + 6;
  for (const col of columns) {
    const lines = wrapped[col.key] ?? [""];
    lines.forEach((line, index) => {
      const textX = col.align === "right" ? x + col.width - 8 - textWidth(line, 8) : x;
      painter.pdf.text({ text: line, x: textX, y: top - 11 - index * 11, size: 8, color: INK });
    });
    x += col.width;
  }
  painter.y = bottom;
}

function drawSummary(painter: DocumentPainter, rows: Array<{ label: string; value: string; emphasize?: boolean }>, status?: { label: string; color: PdfRgb }): void {
  const width = 220;
  const x = PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT - width;
  const height = rows.length * 14 + (status ? 28 : 8);
  painter.ensure(height);
  painter.gap(8);
  for (const row of rows) {
    painter.pdf.text({
      text: row.label,
      x,
      y: painter.y - 10,
      size: row.emphasize ? 10 : 9,
      font: "bold",
      color: row.emphasize ? INK : MUTED,
    });
    painter.pdf.text({
      text: row.value,
      x: PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT - textWidth(row.value, row.emphasize ? 10 : 9, row.emphasize ? "bold" : "regular"),
      y: painter.y - 10,
      size: row.emphasize ? 10 : 9,
      font: row.emphasize ? "bold" : "regular",
      color: INK,
    });
    painter.y -= 14;
  }
  if (status) {
    painter.gap(6);
    const labelWidth = textWidth(status.label, 14, "bold") + 16;
    painter.pdf.fillRect(PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT - labelWidth, painter.y - 18, labelWidth, 18, tint(status.color, 0.82));
    painter.pdf.text({
      text: status.label,
      x: PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT - labelWidth + 8,
      y: painter.y - 13,
      size: 11,
      font: "bold",
      color: status.color,
    });
    painter.y -= 22;
  }
}

function renderInvoice(doc: FinanceInvoiceDocument): Uint8Array {
  const painter = new DocumentPainter(doc, doc.accentColor ?? DEFAULT_FINANCE_ACCENT);
  const columns = invoiceColumns(doc);
  let inTable = false;
  const drawHeader = (compact: boolean) => {
    painter.drawSchoolHeader("INVOICE", compact);
    if (compact && inTable) drawTableHeader(painter, columns);
  };
  painter.onNewPage = () => drawHeader(true);
  drawHeader(false);

  const billName = financePayerDisplayName(doc);
  const leftX = PDF_MARGIN_LEFT;
  const rightX = PDF_MARGIN_LEFT + CONTENT_WIDTH / 2 + 12;
  const blockTop = painter.y;
  const leftWidth = CONTENT_WIDTH / 2 - 16;
  painter.pdf.text({ text: "INVOICE TO", x: leftX, y: blockTop - 9, size: 8, font: "bold", color: MUTED });
  const nameLines = wrapText(billName, leftWidth, 10, "bold");
  let leftY = blockTop - 24;
  nameLines.forEach((line) => {
    painter.pdf.text({ text: line, x: leftX, y: leftY, size: 10, font: "bold", color: INK });
    leftY -= 13;
  });
  leftY -= 4;
  for (const line of addressLines(doc, "billTo")) {
    const wrapped = wrapText(line, leftWidth, 9);
    for (const part of wrapped) {
      painter.pdf.text({ text: part, x: leftX, y: leftY, size: 9, color: INK });
      leftY -= 12;
    }
  }
  const metaRows: Array<[string, string]> = [
    ["INVOICE", doc.invoiceNumber],
    ["DATE", displayDate(doc.invoiceDate)],
    ["TERMS", nonEmpty(doc.terms) ?? ""],
    ["DUE DATE", displayDate(doc.dueDate)],
  ];
  if (doc.vatInvoice && documentTemplateOf(doc).showVatNumber && nonEmpty(doc.vatRegistrationNumber)) {
    metaRows.push(["VAT NUMBER", doc.vatRegistrationNumber!]);
  }
  const metaEnd = painter.drawKv(metaRows, rightX, blockTop);
  painter.y = Math.min(leftY, metaEnd) - 12;

  if (doc.vatInvoice) {
    painter.textLine("VAT invoice", { size: 8, font: "bold", color: MUTED });
  } else {
    painter.textLine("This is not a VAT invoice.", { size: 8, color: MUTED });
  }
  if (nonEmpty(doc.billingPeriod)) {
    painter.textLine(`Billing period: ${doc.billingPeriod}`, { size: 8, color: MUTED });
  }
  if (nonEmpty(doc.instalmentLabel)) {
    painter.textLine(doc.instalmentLabel!, { size: 8, color: MUTED });
  }
  if (doc.classOrYear) painter.textLine(`Year group / class: ${doc.classOrYear}`, { size: 8, color: MUTED });
  if (doc.pupilNames.length) {
    painter.wrapped(`Pupil${doc.pupilNames.length === 1 ? "" : "s"}: ${doc.pupilNames.join(", ")}`, { size: 8, color: MUTED });
  }
  painter.gap(8);

  inTable = true;
  drawTableHeader(painter, columns);
  for (const line of doc.lines) {
    const showQty = lineShowsQtyRate(line);
    const vatRate = line.vatRateBps ?? doc.vatRateBps;
    const net = line.netMinor ?? line.amountMinor;
    const vat = line.vatMinor ?? 0;
    const gross = line.grossMinor ?? line.amountMinor;
    drawInvoiceRow(painter, columns, {
      date: displayDate(line.date ?? doc.invoiceDate),
      activity: lineActivity(line),
      description:
        doc.vatInvoice && lineActivity(line) && (line.kind ?? "").toLowerCase() !== "tuition"
          ? `${lineActivity(line)} — ${lineDescription(line, doc)}`
          : lineDescription(line, doc),
      qty: showQty && line.quantity != null ? String(line.quantity) : "",
      rate: showQty && line.rateMinor != null ? money(line.rateMinor, doc.currency, false) : "",
      amount: money(line.amountMinor, doc.currency, false),
      net: money(net, doc.currency, false),
      vatRate: vatRate != null ? formatVatRateLabel(vatRate) : "",
      vat: money(vat, doc.currency, false),
      gross: money(gross, doc.currency, false),
    });
  }
  inTable = false;

  const subtotal = doc.subtotalMinor ?? doc.amountMinor + Math.abs(doc.discountTotalMinor ?? 0);
  const summary: Array<{ label: string; value: string; emphasize?: boolean }> = [];
  if (doc.vatInvoice) {
    summary.push({ label: "Net", value: money(doc.vatNetMinor ?? subtotal, doc.currency) });
    const vatLabel = doc.vatRateBps != null ? `VAT at ${formatVatRateLabel(doc.vatRateBps)}` : "VAT";
    summary.push({ label: vatLabel, value: money(doc.vatAmountMinor ?? 0, doc.currency) });
    summary.push({ label: "Invoice total", value: money(doc.amountMinor, doc.currency) });
  } else {
    summary.push({ label: "Subtotal", value: money(subtotal, doc.currency) });
    if (doc.discountTotalMinor) summary.push({ label: "Discounts", value: money(-Math.abs(doc.discountTotalMinor), doc.currency) });
    summary.push({ label: "Invoice total", value: money(doc.amountMinor, doc.currency) });
  }
  if (doc.creditTotalMinor) summary.push({ label: "Credits", value: money(-Math.abs(doc.creditTotalMinor), doc.currency) });
  if (doc.paidMinor) summary.push({ label: "Payments received", value: money(doc.paidMinor, doc.currency) });
  summary.push({ label: "BALANCE DUE", value: money(doc.outstandingMinor, doc.currency), emphasize: true });
  const status = invoiceStatusLabel(doc.status, doc.outstandingMinor);
  drawSummary(painter, summary, { label: status, color: statusColor(status, painter.accent) });

  if (nonEmpty(doc.paymentInstructions) && doc.outstandingMinor > 0) {
    painter.gap(10);
    painter.textLine("Payment instructions", { size: 8, font: "bold", color: MUTED });
    painter.wrapped(doc.paymentInstructions!, { size: 8, color: INK });
  }
  if (nonEmpty(doc.footer)) {
    painter.gap(8);
    painter.wrapped(doc.footer!, { size: 8, color: MUTED });
  }

  stampFooters(painter);
  return painter.pdf.build();
}

function stampFooters(painter: DocumentPainter): void {
  const pageCount = painter.pdf.pageCount;
  for (let i = 0; i < pageCount; i += 1) {
    const ops = painter.pdf.capturePageOps(() => painter.drawFooter(i, pageCount));
    painter.pdf.appendToPage(i, ops);
  }
}

function receiptAllocations(doc: FinanceReceiptDocument): FinanceReceiptAllocation[] {
  if (doc.allocations?.length) return doc.allocations;
  if (doc.invoiceReferences.length <= 1) {
    return [
      {
        invoiceNumber: doc.invoiceReferences[0] ?? nonEmpty(doc.description) ?? "Payment",
        invoiceDate: null,
        amountMinor: doc.amountMinor,
      },
    ];
  }
  return doc.invoiceReferences.map((reference, index) => ({
    invoiceNumber: reference,
    invoiceDate: null,
    amountMinor: index === 0 ? doc.amountMinor : 0,
  }));
}

function renderReceipt(doc: FinanceReceiptDocument): Uint8Array {
  const painter = new DocumentPainter(doc, doc.accentColor ?? DEFAULT_FINANCE_ACCENT);
  painter.onNewPage = () => painter.drawSchoolHeader("RECEIPT", true);
  painter.drawSchoolHeader("RECEIPT", false);

  const billName = financePayerDisplayName(doc);
  const blockTop = painter.y;
  const leftWidth = CONTENT_WIDTH / 2 - 16;
  painter.pdf.text({ text: "RECEIVED FROM", x: PDF_MARGIN_LEFT, y: blockTop - 9, size: 8, font: "bold", color: MUTED });
  const nameLines = wrapText(billName, leftWidth, 10, "bold");
  let leftY = blockTop - 24;
  nameLines.forEach((line) => {
    painter.pdf.text({ text: line, x: PDF_MARGIN_LEFT, y: leftY, size: 10, font: "bold", color: INK });
    leftY -= 13;
  });
  leftY -= 4;
  for (const line of addressLines(doc, "billTo")) {
    const wrapped = wrapText(line, leftWidth, 9);
    for (const part of wrapped) {
      painter.pdf.text({ text: part, x: PDF_MARGIN_LEFT, y: leftY, size: 9, color: INK });
      leftY -= 12;
    }
  }
  const method = paymentMethodLabel(doc.paymentMethod);
  const metaEnd = painter.drawKv(
    [
      ["DATE", displayDate(doc.paymentDate)],
      ["REFERENCE NO", doc.receiptNumber],
      ["PAYMENT METHOD", method],
    ],
    PDF_MARGIN_LEFT + CONTENT_WIDTH / 2 + 12,
    blockTop,
  );
  painter.y = Math.min(leftY, metaEnd) - 12;
  if (doc.pupilNames.length === 1) {
    painter.textLine(`Pupil: ${doc.pupilNames[0]}`, { size: 8, color: MUTED });
  } else if (doc.pupilNames.length > 1) {
    painter.wrapped(`Pupils: ${doc.pupilNames.join(", ")}`, { size: 8, color: MUTED });
  }

  const columns: TableColumn[] = [
    { key: "n", title: "", width: 24, align: "left" },
    { key: "invoice", title: "INVOICE NUMBER", width: 160, align: "left" },
    { key: "date", title: "INVOICE DATE", width: 110, align: "left" },
    { key: "payment", title: "PAYMENT", width: CONTENT_WIDTH - 24 - 160 - 110, align: "right" },
  ];
  drawTableHeader(painter, columns);
  const allocations = receiptAllocations(doc);
  allocations.forEach((row, index) => {
    drawInvoiceRow(painter, columns, {
      n: String(index + 1),
      invoice: row.invoiceNumber,
      date: displayDate(row.invoiceDate),
      payment: row.amountMinor ? money(row.amountMinor, doc.currency, false) : "",
    });
  });

  const memo = nonEmpty(doc.memo) ?? (isSensitiveProviderReference(doc.providerReference) ? null : nonEmpty(doc.providerReference));
  const summary = [
    { label: "Total payment received", value: money(doc.amountMinor, doc.currency), emphasize: true },
    { label: "BALANCE DUE", value: money(doc.remainingMinor, doc.currency), emphasize: true },
  ];
  if (memo) summary.unshift({ label: "Memo", value: memo, emphasize: false });
  const status = doc.remainingMinor <= 0 ? "PAID" : "PARTIALLY PAID";
  drawSummary(painter, summary, { label: status, color: statusColor(status, painter.accent) });
  stampFooters(painter);
  return painter.pdf.build();
}

function renderStatement(doc: FinanceStatementDocument): Uint8Array {
  const painter = new DocumentPainter(doc, doc.accentColor ?? DEFAULT_FINANCE_ACCENT);
  painter.onNewPage = () => {
    painter.drawSchoolHeader("FAMILY STATEMENT", true);
  };
  painter.drawSchoolHeader("FAMILY STATEMENT", false);
  painter.textLine(`Family: ${doc.familyName}`, { size: 10, font: "bold" });
  if (doc.pupilNames.length) painter.textLine(`Children: ${doc.pupilNames.join(", ")}`, { size: 9, color: MUTED });
  painter.textLine(`Period: ${doc.periodLabel} (${displayDate(doc.from)} – ${displayDate(doc.to)})`, { size: 9, color: MUTED });
  painter.textLine(`Opening balance: ${money(doc.openingMinor, doc.currency)}`, { size: 9 });
  painter.gap(6);
  const columns: TableColumn[] = [
    { key: "date", title: "DATE", width: 70, align: "left" },
    { key: "reference", title: "REFERENCE", width: 130, align: "left" },
    { key: "description", title: "DESCRIPTION", width: 150, align: "left" },
    { key: "debit", title: "CHARGE", width: 70, align: "right" },
    { key: "credit", title: "PAID", width: 70, align: "right" },
    { key: "balance", title: "BALANCE", width: CONTENT_WIDTH - 70 - 130 - 150 - 70 - 70, align: "right" },
  ];
  drawTableHeader(painter, columns);
  for (const entry of doc.entries) {
    drawInvoiceRow(painter, columns, {
      date: displayDate(entry.date),
      reference: entry.reference,
      description: [entry.kind, entry.description].filter(Boolean).join(" · "),
      debit: entry.debitMinor ? money(entry.debitMinor, doc.currency, false) : "",
      credit: entry.creditMinor ? money(entry.creditMinor, doc.currency, false) : "",
      balance: money(entry.balanceMinor, doc.currency, false),
    });
  }
  drawSummary(painter, [
    { label: "Closing balance", value: money(doc.closingMinor, doc.currency) },
    { label: "Outstanding", value: money(doc.outstandingMinor, doc.currency), emphasize: true },
  ]);
  stampFooters(painter);
  return painter.pdf.build();
}

export function renderFinancePdf(doc: FinancePdfDocument): Uint8Array {
  if (doc.kind === "invoice") return renderInvoice(doc);
  if (doc.kind === "receipt") return renderReceipt(doc);
  return renderStatement(doc);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipStoreFiles(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name.replace(/\\/g, "/"));
    const data = Buffer.from(file.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    Buffer.from(name).copy(local, 30);
    data.copy(local, 30 + name.length);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    Buffer.from(name).copy(central, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralStart = offset;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centrals.reduce((sum, part) => sum + part.length, 0), 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function financePdfFilename(doc: FinancePdfDocument): string {
  if (doc.kind === "invoice") return `${doc.invoiceNumber}.pdf`;
  if (doc.kind === "receipt") return `${doc.receiptNumber}.pdf`;
  return `statement-${doc.from}-to-${doc.to}.pdf`;
}

export function snapshotWithoutLogo<T extends { logo?: FinancePdfLogo | null }>(doc: T): Omit<T, "logo"> {
  const { logo: _logo, ...rest } = doc;
  return rest;
}

function snapshotHas(raw: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

/**
 * Newly issued invoices/receipts store school identity in the snapshot, including explicit nulls.
 * Live school settings are used only for legacy snapshots that omit a key entirely.
 */
export function applyFrozenSchoolBranding<T extends FinanceSchoolBranding>(
  snapshot: T,
  live: FinanceSchoolBranding & { schoolName: string },
): T & FinanceSchoolBranding {
  const raw = snapshot as T & Record<string, unknown>;
  const pick = <K extends keyof FinanceSchoolBranding>(key: K): T[K] => {
    if (snapshotHas(raw, key as string)) {
      return ((snapshot[key] as T[K] | undefined) ?? null) as T[K];
    }
    return (live[key] as T[K] | undefined) ?? (null as T[K]);
  };
  return {
    ...snapshot,
    schoolName: snapshotHas(raw, "schoolName")
      ? snapshot.schoolName?.trim()
        ? snapshot.schoolName
        : "School"
      : live.schoolName,
    schoolLegalName: pick("schoolLegalName"),
    schoolAddress: pick("schoolAddress"),
    schoolAddressLines: snapshotHas(raw, "schoolAddressLines")
      ? snapshot.schoolAddressLines ?? []
      : live.schoolAddressLines ?? [],
    schoolPhone: pick("schoolPhone"),
    schoolEmail: pick("schoolEmail"),
    schoolWebsite: pick("schoolWebsite"),
    schoolContact: pick("schoolContact"),
    accentColor: pick("accentColor"),
    bankName: pick("bankName"),
    bankAccountName: pick("bankAccountName"),
    bankAccountNumber: pick("bankAccountNumber"),
    bankSortCode: pick("bankSortCode"),
    paymentInstructions: pick("paymentInstructions"),
    logoObjectId: pick("logoObjectId"),
    documentTemplate: snapshotHas(raw, "documentTemplate")
      ? freezeDocumentTemplate(raw)
      : DEFAULT_FINANCE_DOCUMENT_TEMPLATE,
  };
}
