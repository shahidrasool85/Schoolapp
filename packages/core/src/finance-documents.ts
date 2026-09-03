import { formatUkDateRange, formatUkShortDate } from "@schoolapp/domain";
import { formatMoney } from "./money.js";

export type FinanceDocumentLine = {
  description: string;
  pupilName?: string | null;
  amountMinor: number;
};

export type FinanceInvoiceDocument = {
  kind: "invoice";
  schoolName: string;
  schoolAddress?: string | null;
  schoolContact?: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  familyName: string;
  pupilNames: string[];
  classOrYear?: string | null;
  description: string;
  billingPeriod: string;
  currency: string;
  amountMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  status: string;
  lines: FinanceDocumentLine[];
  footer?: string | null;
  vatInvoice: boolean;
};

export type FinanceReceiptDocument = {
  kind: "receipt";
  schoolName: string;
  schoolAddress?: string | null;
  schoolContact?: string | null;
  receiptNumber: string;
  paymentDate: string;
  familyName: string;
  pupilNames: string[];
  invoiceReferences: string[];
  description: string;
  currency: string;
  amountMinor: number;
  paymentMethod: string;
  providerReference?: string | null;
  remainingMinor: number;
  status: string;
};

export type FinanceStatementDocument = {
  kind: "statement";
  schoolName: string;
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
};

export type FinancePdfDocument = FinanceInvoiceDocument | FinanceReceiptDocument | FinanceStatementDocument;

function pdfEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLine(text: string, width = 88): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function money(amountMinor: number, currency: string): string {
  try {
    return formatMoney(Math.abs(amountMinor), currency);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function documentTitle(doc: FinancePdfDocument): string {
  if (doc.kind === "invoice") return `Invoice ${doc.invoiceNumber}`;
  if (doc.kind === "receipt") return `Receipt ${doc.receiptNumber}`;
  return `Family statement`;
}

function documentLines(doc: FinancePdfDocument): string[] {
  const lines: string[] = [];
  const push = (text: string) => {
    for (const part of wrapLine(text)) lines.push(part);
  };
  push(doc.schoolName);
  if ("schoolAddress" in doc && doc.schoolAddress) push(doc.schoolAddress);
  if ("schoolContact" in doc && doc.schoolContact) push(doc.schoolContact);
  lines.push("");
  if (doc.kind === "invoice") {
    push(documentTitle(doc));
    if (!doc.vatInvoice) push("This is not a VAT invoice.");
    push(`Invoice date: ${doc.invoiceDate}`);
    push(`Due date: ${doc.dueDate}`);
    push(`Family: ${doc.familyName}`);
    if (doc.pupilNames.length) push(`Pupil(s): ${doc.pupilNames.join(", ")}`);
    if (doc.classOrYear) push(`Class / year: ${doc.classOrYear}`);
    push(`Billing period: ${doc.billingPeriod}`);
    push(`Status: ${statusLabel(doc.status)}`);
    lines.push("");
    for (const line of doc.lines) {
      const pupil = line.pupilName ? ` (${line.pupilName})` : "";
      push(`${line.description}${pupil}  ${money(line.amountMinor, doc.currency)}`);
    }
    lines.push("");
    push(`Amount: ${money(doc.amountMinor, doc.currency)}`);
    push(`Paid to date: ${money(doc.paidMinor, doc.currency)}`);
    push(`Outstanding: ${money(doc.outstandingMinor, doc.currency)}`);
    if (doc.footer) {
      lines.push("");
      push(doc.footer);
    }
  } else if (doc.kind === "receipt") {
    push(documentTitle(doc));
    push(`Payment date: ${doc.paymentDate}`);
    push(`Family: ${doc.familyName}`);
    if (doc.pupilNames.length) push(`Pupil(s): ${doc.pupilNames.join(", ")}`);
    if (doc.invoiceReferences.length) push(`Invoice(s): ${doc.invoiceReferences.join(", ")}`);
    push(doc.description);
    push(`Amount paid: ${money(doc.amountMinor, doc.currency)}`);
    push(`Payment method: ${doc.paymentMethod}`);
    if (doc.providerReference) push(`Payment reference: ${doc.providerReference}`);
    push(`Remaining balance: ${money(doc.remainingMinor, doc.currency)}`);
    push(`Status: ${statusLabel(doc.status)}`);
  } else {
    push(`Family statement`);
    push(`Family: ${doc.familyName}`);
    if (doc.pupilNames.length) push(`Children: ${doc.pupilNames.join(", ")}`);
    push(`Period: ${doc.periodLabel} (${formatUkDateRange(doc.from, doc.to)})`);
    push(`Opening balance: ${money(doc.openingMinor, doc.currency)}`);
    lines.push("");
    for (const entry of doc.entries) {
      const debit = entry.debitMinor ? ` charge ${money(entry.debitMinor, doc.currency)}` : "";
      const credit = entry.creditMinor ? ` paid ${money(entry.creditMinor, doc.currency)}` : "";
      const pupils = entry.description ? ` (${entry.description})` : "";
      push(`${formatUkShortDate(entry.date)}  ${entry.reference}${pupils}  ${entry.kind}${debit}${credit}  bal ${money(entry.balanceMinor, doc.currency)}`);
    }
    lines.push("");
    push(`Closing balance: ${money(doc.closingMinor, doc.currency)}`);
    push(`Outstanding: ${money(doc.outstandingMinor, doc.currency)}`);
  }
  lines.push("");
  push("LuvLearn school platform");
  return lines;
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

export function renderFinancePdf(doc: FinancePdfDocument): Uint8Array {
  const contentLines = documentLines(doc);
  const commands = ["BT", "/F1 11 Tf", "50 800 Td", "14 TL"];
  commands.push(`(${pdfEscape(contentLines[0] ?? "")}) Tj`);
  for (const line of contentLines.slice(1)) {
    commands.push("T*");
    commands.push(`(${pdfEscape(line)}) Tj`);
  }
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
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
