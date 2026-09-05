import { formatUkNumericDate } from "@schoolapp/domain";
import { formatMoney } from "./money.js";
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
  amountMinor: number;
  date?: string | null;
  activity?: string | null;
  quantity?: number | null;
  rateMinor?: number | null;
  kind?: string | null;
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
  card: "Stripe / Card",
  stripe: "Stripe / Card",
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
  if (key.includes("stripe") || key.includes("card")) return "Stripe / Card";
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

function schoolContactLines(doc: FinanceSchoolBranding): string[] {
  const lines: string[] = [];
  if (nonEmpty(doc.schoolPhone)) lines.push(doc.schoolPhone!);
  if (nonEmpty(doc.schoolEmail)) lines.push(doc.schoolEmail!);
  if (nonEmpty(doc.schoolWebsite)) lines.push(doc.schoolWebsite!);
  if (!lines.length && nonEmpty(doc.schoolContact)) {
    return doc.schoolContact!.split("·").map((part) => part.trim()).filter(Boolean);
  }
  return lines;
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
  const showQtyRate = doc.lines.some(lineShowsQtyRate);
  const cols: TableColumn[] = [
    { key: "date", title: "DATE", width: 68, align: "left" },
    { key: "activity", title: "ACTIVITY", width: 78, align: "left" },
    { key: "description", title: "DESCRIPTION", width: 0, align: "left" },
  ];
  if (showQtyRate) {
    cols.push({ key: "qty", title: "QTY", width: 36, align: "right" });
    cols.push({ key: "rate", title: "RATE", width: 58, align: "right" });
  }
  cols.push({ key: "amount", title: "AMOUNT", width: 70, align: "right" });
  const used = cols.reduce((sum, col) => sum + col.width, 0);
  const desc = cols.find((col) => col.key === "description")!;
  desc.width = CONTENT_WIDTH - used;
  return cols;
}

function lineDescription(line: FinanceDocumentLine): string {
  const pupil = nonEmpty(line.pupilName);
  if (pupil && !line.description.includes(pupil)) return `${line.description} (${pupil})`;
  return line.description;
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
    let logoHeight = 0;
    if (this.logo) {
      const maxH = compact ? 36 : 58;
      const maxW = compact ? 88 : 118;
      const fitted = fittedImageSize(this.logo, maxW, maxH);
      logoHeight = fitted.height;
      this.pdf.drawImage(
        this.logo,
        PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT - fitted.width,
        startY - fitted.height,
        fitted.width,
        fitted.height,
      );
    }
    const textWidthMax = CONTENT_WIDTH - (this.logo ? 132 : 0);
    this.y = startY;
    this.textLine(this.doc.schoolName, { size: compact ? 11 : 14, font: "bold", color: INK });
    if (!compact) {
      for (const line of addressLines(this.doc, "school")) {
        this.wrapped(line, { size: 9, color: MUTED, width: textWidthMax });
      }
      for (const line of schoolContactLines(this.doc)) {
        this.textLine(line, { size: 9, color: MUTED });
      }
    }
    const headerBottom = Math.min(this.y, startY - logoHeight - 4);
    this.y = headerBottom - 8;
    this.pdf.line(PDF_MARGIN_LEFT, this.y + 6, PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT, this.y + 6, this.accent, compact ? 1 : 1.6);
    this.textLine(title, { size: compact ? 13 : 20, font: "bold", color: this.accent });
    this.gap(compact ? 4 : 10);
  }

  drawFooter(pageIndex: number, pageCount: number): void {
    const legal = nonEmpty(this.doc.schoolLegalName) ?? this.doc.schoolName;
    const bank = bankFooterLines(this.doc);
    const y = 28;
    this.pdf.line(PDF_MARGIN_LEFT, 46, PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT, 46, RULE, 0.5);
    this.pdf.text({ text: legal, x: PDF_MARGIN_LEFT, y, size: 8, color: MUTED });
    if (bank.length) {
      this.pdf.text({ text: bank.join("   "), x: PDF_MARGIN_LEFT, y: y - 11, size: 8, color: MUTED });
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
    const labelWidth = 78;
    for (const [label, value] of rows) {
      if (!nonEmpty(value)) continue;
      this.pdf.text({ text: label, x, y: y - 9, size: 8, font: "bold", color: MUTED });
      this.pdf.text({ text: value, x: x + labelWidth, y: y - 9, size: 9, color: INK });
      y -= 14;
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

  const billName = nonEmpty(doc.billToName) ?? doc.familyName;
  const leftX = PDF_MARGIN_LEFT;
  const rightX = PDF_MARGIN_LEFT + CONTENT_WIDTH / 2 + 12;
  const blockTop = painter.y;
  painter.pdf.text({ text: "INVOICE TO", x: leftX, y: blockTop - 9, size: 8, font: "bold", color: MUTED });
  painter.pdf.text({ text: billName, x: leftX, y: blockTop - 24, size: 10, font: "bold", color: INK });
  let leftY = blockTop - 38;
  for (const line of addressLines(doc, "billTo")) {
    painter.pdf.text({ text: line, x: leftX, y: leftY, size: 9, color: INK });
    leftY -= 12;
  }
  const metaEnd = painter.drawKv(
    [
      ["INVOICE", doc.invoiceNumber],
      ["DATE", displayDate(doc.invoiceDate)],
      ["TERMS", nonEmpty(doc.terms) ?? ""],
      ["DUE DATE", displayDate(doc.dueDate)],
    ],
    rightX,
    blockTop,
  );
  painter.y = Math.min(leftY, metaEnd) - 8;

  if (!doc.vatInvoice) {
    painter.textLine("This is not a VAT invoice.", { size: 8, color: MUTED });
  }
  if (nonEmpty(doc.billingPeriod)) {
    painter.textLine(`Billing period: ${doc.billingPeriod}`, { size: 8, color: MUTED });
  }
  if (nonEmpty(doc.instalmentLabel)) {
    painter.textLine(doc.instalmentLabel!, { size: 8, color: MUTED });
  }
  if (doc.classOrYear) painter.textLine(`Year group / class: ${doc.classOrYear}`, { size: 8, color: MUTED });
  painter.gap(6);

  inTable = true;
  drawTableHeader(painter, columns);
  for (const line of doc.lines) {
    const showQty = lineShowsQtyRate(line);
    drawInvoiceRow(painter, columns, {
      date: displayDate(line.date ?? doc.invoiceDate),
      activity: lineActivity(line),
      description: lineDescription(line),
      qty: showQty && line.quantity != null ? String(line.quantity) : "",
      rate: showQty && line.rateMinor != null ? money(line.rateMinor, doc.currency, false) : "",
      amount: money(line.amountMinor, doc.currency, false),
    });
  }
  inTable = false;

  const subtotal = doc.subtotalMinor ?? doc.amountMinor + Math.abs(doc.discountTotalMinor ?? 0);
  const summary: Array<{ label: string; value: string; emphasize?: boolean }> = [
    { label: "Subtotal", value: money(subtotal, doc.currency) },
  ];
  if (doc.discountTotalMinor) summary.push({ label: "Discounts", value: money(-Math.abs(doc.discountTotalMinor), doc.currency) });
  if (doc.creditTotalMinor) summary.push({ label: "Credits", value: money(-Math.abs(doc.creditTotalMinor), doc.currency) });
  summary.push({ label: "Invoice total", value: money(doc.amountMinor, doc.currency) });
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

  const billName = nonEmpty(doc.billToName) ?? doc.familyName;
  const blockTop = painter.y;
  painter.pdf.text({ text: "INVOICE TO", x: PDF_MARGIN_LEFT, y: blockTop - 9, size: 8, font: "bold", color: MUTED });
  painter.pdf.text({ text: billName, x: PDF_MARGIN_LEFT, y: blockTop - 24, size: 10, font: "bold", color: INK });
  let leftY = blockTop - 38;
  for (const line of addressLines(doc, "billTo")) {
    painter.pdf.text({ text: line, x: PDF_MARGIN_LEFT, y: leftY, size: 9, color: INK });
    leftY -= 12;
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
  painter.y = Math.min(leftY, metaEnd) - 10;

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
