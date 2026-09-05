import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  extractPdfText,
  financePdfFilename,
  invoiceStatusLabel,
  paymentMethodLabel,
  renderFinancePdf,
  zipStoreFiles,
  applyFrozenSchoolBranding,
  type FinanceInvoiceDocument,
  type FinanceReceiptDocument,
  type FinanceStatementDocument,
} from "./finance-documents.js";
import { encodeWinAnsiBytes, extractPdfText as extractText } from "./finance-pdf.js";

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

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const sampleDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../test-artifacts/finance-pdfs");

function writeSample(name: string, bytes: Uint8Array): void {
  fs.mkdirSync(sampleDir, { recursive: true });
  fs.writeFileSync(path.join(sampleDir, name), bytes);
}

const school = {
  schoolName: "Riverside Independent School",
  schoolLegalName: "Riverside Independent School Ltd",
  schoolAddressLines: ["12 Chapel Lane", "Solihull", "B91 1AA"],
  schoolPhone: "0121 000 0000",
  schoolEmail: "finance@riverside.test",
  schoolWebsite: "www.riverside.test",
  accentColor: "#4A90C7",
  bankName: "Example Bank",
  bankAccountName: "Riverside Independent School Ltd",
  bankAccountNumber: "12345678",
  bankSortCode: "20-00-00",
};

const outstandingInvoice: FinanceInvoiceDocument = {
  kind: "invoice",
  ...school,
  invoiceNumber: "RIV-INV-2026-000001",
  invoiceDate: "2026-09-01",
  dueDate: "2026-09-15",
  terms: "Net 14",
  familyName: "Family — Shahid Rasool",
  billToName: "Shahid Rasool",
  billToAddressLines: ["14 Oak Road", "Birmingham", "B13 9AA"],
  pupilNames: ["Amina Rasool"],
  classOrYear: "Year 3",
  description: "Year 3 Tuition",
  billingPeriod: "01/09/2026–30/09/2026",
  currency: "GBP",
  subtotalMinor: 200000,
  discountTotalMinor: 0,
  creditTotalMinor: 0,
  amountMinor: 200000,
  paidMinor: 50000,
  outstandingMinor: 150000,
  status: "partially_paid",
  lines: [{ description: "Year 3 Tuition — Amina Rasool", pupilName: "Amina Rasool", amountMinor: 200000, kind: "tuition", date: "2026-09-01" }],
  footer: "Please quote the invoice number as your payment reference.",
  paymentInstructions: "Pay by bank transfer using the invoice number as the reference.",
  vatInvoice: false,
};

describe("finance PDF documents", () => {
  it("renders a simple non-VAT invoice PDF", () => {
    const bytes = renderFinancePdf({
      ...outstandingInvoice,
      paidMinor: 0,
      outstandingMinor: 200000,
      status: "issued",
    });
    const text = extractPdfText(bytes);
    expect(Buffer.from(bytes).toString("latin1").startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("RIV-INV-2026-000001");
    expect(text).toContain("This is not a VAT invoice.");
    expect(text).toContain("INVOICE");
    expect(text).toContain("OUTSTANDING");
    expect(financePdfFilename(outstandingInvoice)).toBe("RIV-INV-2026-000001.pdf");
  });

  it("encodes sterling, en-dash and em-dash instead of mojibake", () => {
    const bytes = renderFinancePdf({
      ...outstandingInvoice,
      billToName: "Family — Shahid Rasool",
      familyName: "Family — Shahid Rasool",
      billingPeriod: "01/09/2026–30/09/2026",
      lines: [
        {
          description: "O'Connor's tuition — September",
          amountMinor: 200000,
          kind: "tuition",
        },
      ],
    });
    const stream = Buffer.from(bytes).toString("latin1");
    const content = stream.slice(stream.indexOf("stream"), stream.indexOf("endstream"));
    expect(content).not.toContain(Buffer.from("—", "utf8").toString("latin1"));
    expect(content).not.toContain(Buffer.from("–", "utf8").toString("latin1"));
    expect(content).not.toContain(Buffer.from("£", "utf8").toString("latin1"));
    expect(content).toContain("\\243");
    expect(content).toContain("\\226");
    expect(content).toContain("\\227");
    const text = extractPdfText(bytes);
    expect(text).toContain("Family — Shahid Rasool");
    expect(text).toContain("01/09/2026–30/09/2026");
    expect(text).toContain("O'Connor's tuition — September");
    expect(text).toContain("£");
    expect(encodeWinAnsiBytes("£")[0]).toBe(0xa3);
    expect(encodeWinAnsiBytes("–")[0]).toBe(0x96);
    expect(encodeWinAnsiBytes("—")[0]).toBe(0x97);
    expect(encodeWinAnsiBytes("’")[0]).toBe(0x92);
  });

  it("renders school details, billing address and paid / partial / outstanding states", () => {
    const partial = extractPdfText(renderFinancePdf(outstandingInvoice));
    expect(partial).toContain("Riverside Independent School");
    expect(partial).toContain("12 Chapel Lane");
    expect(partial).toContain("Shahid Rasool");
    expect(partial).toContain("14 Oak Road");
    expect(partial).toContain("PARTIALLY PAID");
    expect(partial).toContain("BALANCE DUE");
    expect(partial).toContain("Example Bank");

    const paid = extractPdfText(
      renderFinancePdf({ ...outstandingInvoice, paidMinor: 200000, outstandingMinor: 0, status: "paid" }),
    );
    expect(paid).toContain("PAID");
    expect(paid).toContain("£0.00");

    const voided = extractPdfText(renderFinancePdf({ ...outstandingInvoice, status: "void" }));
    expect(voided).toContain("VOID");
  });

  it("renders credits and omits fake quantity/rate on tuition lines", () => {
    const text = extractPdfText(
      renderFinancePdf({
        ...outstandingInvoice,
        creditTotalMinor: 25000,
        outstandingMinor: 125000,
        lines: [
          { description: "Year 3 Tuition", amountMinor: 200000, kind: "tuition" },
          { description: "Sibling discount", amountMinor: -20000, kind: "discount" },
          { description: "Account credit", amountMinor: -25000, kind: "credit" },
        ],
      }),
    );
    expect(text).toContain("Credits");
    expect(text).toContain("Tuition");
    expect(text).toContain("Discount");
    expect(text).not.toMatch(/QTY[\s\S]*RATE/);
  });

  it("shows quantity and rate for activity lines and paginates long invoices", () => {
    const lines = Array.from({ length: 55 }, (_, index) => ({
      description: `Stone Age Experience ${index + 1}`,
      amountMinor: 1200,
      kind: "trip",
      activity: "School trip",
      quantity: 1,
      rateMinor: 1200,
      date: "2026-09-01",
    }));
    const bytes = renderFinancePdf({
      ...outstandingInvoice,
      amountMinor: 66000,
      subtotalMinor: 66000,
      paidMinor: 0,
      outstandingMinor: 66000,
      status: "issued",
      lines,
    });
    const text = extractPdfText(bytes);
    expect(text).toContain("QTY");
    expect(text).toContain("RATE");
    expect(text).toContain("Stone Age Experience 1");
    expect(text).toContain("Stone Age Experience 40");
    expect(text).toContain("Page 1 of");
    expect(text).toMatch(/Page 2 of 2|Page 1 of 2/);
    expect(Buffer.from(bytes).toString("latin1")).toMatch(/Page 2 of 2|\/Count 2/);
  });

  it("falls back to a text header when no logo is present and omits missing bank details", () => {
    const text = extractPdfText(
      renderFinancePdf({
        ...outstandingInvoice,
        logo: null,
        bankName: null,
        bankAccountNumber: null,
        bankSortCode: null,
        schoolLegalName: "Riverside Independent School Ltd",
      }),
    );
    expect(text).toContain("Riverside Independent School");
    expect(text).not.toContain("Account number:");
    expect(text).not.toContain("N/A");
    expect(Buffer.from(renderFinancePdf({ ...outstandingInvoice, logo: null })).toString("latin1")).not.toContain("/Subtype /Image");
  });

  it("embeds a school logo image xobject", () => {
    const logo = solidPng(64, 40, [20, 80, 160]);
    const bytes = renderFinancePdf({
      ...outstandingInvoice,
      logo: { bytes: logo, contentType: "image/png" },
    });
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).toContain("/Subtype /Image");
    expect(extractPdfText(bytes)).toContain("INVOICE");
  });

  it("freezes issued school identity including explicit nulls", () => {
    const frozen = applyFrozenSchoolBranding(
      {
        schoolName: "Issued School",
        schoolLegalName: "Issued Ltd",
        schoolAddress: null,
        schoolAddressLines: [],
        schoolPhone: null,
        schoolEmail: "bursar@issued.test",
        schoolWebsite: null,
        schoolContact: null,
        accentColor: "#4A90C7",
        bankName: null,
        bankAccountName: null,
        bankAccountNumber: null,
        bankSortCode: null,
        paymentInstructions: "Quote the invoice number.",
        logoObjectId: "logo-issued",
      },
      {
        schoolName: "Changed School",
        schoolLegalName: "Changed Ltd",
        schoolAddress: "99 New Road",
        schoolAddressLines: ["99 New Road"],
        schoolPhone: "0000 000 0000",
        schoolEmail: "new@changed.test",
        schoolWebsite: "www.changed.test",
        schoolContact: "0000 000 0000 · new@changed.test",
        accentColor: "#ff0000",
        bankName: "New Bank",
        bankAccountName: "New Account",
        bankAccountNumber: "99999999",
        bankSortCode: "00-00-00",
        paymentInstructions: "New instructions",
        logoObjectId: "logo-new",
      },
    );
    expect(frozen.schoolName).toBe("Issued School");
    expect(frozen.schoolLegalName).toBe("Issued Ltd");
    expect(frozen.schoolAddress).toBeNull();
    expect(frozen.schoolAddressLines).toEqual([]);
    expect(frozen.schoolPhone).toBeNull();
    expect(frozen.schoolEmail).toBe("bursar@issued.test");
    expect(frozen.schoolWebsite).toBeNull();
    expect(frozen.bankName).toBeNull();
    expect(frozen.bankAccountNumber).toBeNull();
    expect(frozen.paymentInstructions).toBe("Quote the invoice number.");
    expect(frozen.logoObjectId).toBe("logo-issued");
  });

  it("fills only missing keys on legacy snapshots from current school settings", () => {
    const filled = applyFrozenSchoolBranding(
      { schoolName: "Legacy Header" },
      {
        schoolName: "Live School",
        schoolLegalName: "Live Ltd",
        schoolAddress: "1 Live Street",
        schoolAddressLines: ["1 Live Street"],
        bankName: "Live Bank",
        paymentInstructions: "Live instructions",
        logoObjectId: "logo-live",
      },
    );
    expect(filled.schoolName).toBe("Legacy Header");
    expect(filled.bankName).toBe("Live Bank");
    expect(filled.schoolAddressLines).toEqual(["1 Live Street"]);
    expect(filled.logoObjectId).toBe("logo-live");
  });

  it("keeps immutable snapshot line amounts while showing live balance", () => {
    const snapshotLines = [{ description: "Frozen tuition", amountMinor: 123456, kind: "tuition" }];
    const text = extractPdfText(
      renderFinancePdf({
        ...outstandingInvoice,
        amountMinor: 123456,
        paidMinor: 23456,
        outstandingMinor: 100000,
        status: "partially_paid",
        lines: snapshotLines,
      }),
    );
    expect(text).toContain("1,234.56");
    expect(text).toContain("PARTIALLY PAID");
  });

  it("renders stripe and bank-transfer receipts with allocations", () => {
    const receipt: FinanceReceiptDocument = {
      kind: "receipt",
      ...school,
      receiptNumber: "RIV-RCT-2026-000001",
      paymentDate: "2026-09-05",
      familyName: "Family — Shahid Rasool",
      billToName: "Shahid Rasool",
      billToAddressLines: ["14 Oak Road", "Birmingham", "B13 9AA"],
      pupilNames: ["Amina Rasool"],
      invoiceReferences: ["RIV-INV-2026-000001", "RIV-INV-2026-000002"],
      allocations: [
        { invoiceNumber: "RIV-INV-2026-000001", invoiceDate: "2026-09-01", amountMinor: 50000 },
        { invoiceNumber: "RIV-INV-2026-000002", invoiceDate: "2026-09-01", amountMinor: 20000 },
      ],
      description: "Payment",
      currency: "GBP",
      amountMinor: 70000,
      paymentMethod: "card",
      remainingMinor: 150000,
      status: "succeeded",
      memo: "Family payment",
    };
    const card = extractPdfText(renderFinancePdf(receipt));
    expect(card).toContain("RECEIPT");
    expect(card).toContain("Stripe / Card");
    expect(card).toContain("RIV-INV-2026-000001");
    expect(card).toContain("RIV-INV-2026-000002");
    expect(card).toContain("Family payment");
    expect(card).not.toContain("pi_");
    expect(financePdfFilename(receipt)).toBe("RIV-RCT-2026-000001.pdf");

    const transfer = extractPdfText(renderFinancePdf({ ...receipt, paymentMethod: "bank_transfer", remainingMinor: 0 }));
    expect(transfer).toContain("Bank transfer");
    expect(transfer).toContain("PAID");
  });

  it("does not print Stripe payment intent ids", () => {
    const text = extractPdfText(
      renderFinancePdf({
        kind: "receipt",
        ...school,
        receiptNumber: "RIV-RCT-2026-000009",
        paymentDate: "2026-09-05",
        familyName: "Family Rasool",
        pupilNames: [],
        invoiceReferences: ["RIV-INV-2026-000001"],
        description: "Payment",
        currency: "GBP",
        amountMinor: 1200,
        paymentMethod: "card",
        providerReference: "pi_secret_1234567890",
        remainingMinor: 0,
        status: "succeeded",
      }),
    );
    expect(text).not.toContain("pi_secret");
    expect(text).toContain("Stripe / Card");
  });

  it("labels payment methods for parents", () => {
    expect(paymentMethodLabel("card")).toBe("Stripe / Card");
    expect(paymentMethodLabel("bank_transfer")).toBe("Bank transfer");
    expect(paymentMethodLabel("cash")).toBe("Cash");
    expect(paymentMethodLabel("cheque")).toBe("Cheque");
    expect(paymentMethodLabel("other")).toBe("Other / manual");
    expect(invoiceStatusLabel("issued", 100)).toBe("OUTSTANDING");
    expect(invoiceStatusLabel("issued", 0)).toBe("PAID");
  });

  it("keeps pupil attribution on family statement lines", () => {
    const statement: FinanceStatementDocument = {
      kind: "statement",
      schoolName: "Riverside Independent School",
      familyName: "Family Rasool",
      pupilNames: ["Child A", "Child B"],
      periodLabel: "current academic year",
      from: "2026-09-01",
      to: "2027-07-31",
      currency: "GBP",
      openingMinor: 0,
      closingMinor: 200000,
      outstandingMinor: 200000,
      entries: [
        {
          date: "2026-09-15",
          kind: "invoice",
          reference: "RIV-INV-1",
          description: "Child A",
          debitMinor: 200000,
          creditMinor: 0,
          balanceMinor: 200000,
        },
      ],
    };
    const text = extractPdfText(renderFinancePdf(statement));
    expect(text).toContain("Child A");
    expect(text).toContain("RIV-INV-1");
    expect(text).toContain("Opening balance");
  });

  it("builds a ZIP of stored documents without mutating records", () => {
    const zip = zipStoreFiles([{ name: "invoices/one.pdf", data: renderFinancePdf(outstandingInvoice) }]);
    expect(Buffer.from(zip).readUInt32LE(0)).toBe(0x04034b50);
  });

  it("writes visual review sample PDFs", () => {
    const logo = { bytes: solidPng(80, 48, [74, 144, 199]), contentType: "image/png" };
    writeSample("partially-paid-invoice.pdf", renderFinancePdf({ ...outstandingInvoice, logo }));
    writeSample(
      "fully-paid-invoice.pdf",
      renderFinancePdf({ ...outstandingInvoice, logo, paidMinor: 200000, outstandingMinor: 0, status: "paid" }),
    );
    writeSample(
      "stripe-card-receipt.pdf",
      renderFinancePdf({
        kind: "receipt",
        ...school,
        logo,
        receiptNumber: "RIV-RCT-2026-000001",
        paymentDate: "2026-09-05",
        familyName: "Family — Shahid Rasool",
        billToName: "Shahid Rasool",
        billToAddressLines: ["14 Oak Road", "Birmingham", "B13 9AA"],
        pupilNames: ["Amina Rasool"],
        invoiceReferences: ["RIV-INV-2026-000001"],
        allocations: [{ invoiceNumber: "RIV-INV-2026-000001", invoiceDate: "2026-09-01", amountMinor: 200000 }],
        description: "Payment",
        currency: "GBP",
        amountMinor: 200000,
        paymentMethod: "card",
        remainingMinor: 0,
        status: "succeeded",
        memo: "Card payment",
      }),
    );
    writeSample(
      "bank-transfer-receipt.pdf",
      renderFinancePdf({
        kind: "receipt",
        ...school,
        logo,
        receiptNumber: "RIV-RCT-2026-000002",
        paymentDate: "2026-09-06",
        familyName: "Family — Shahid Rasool",
        billToName: "Shahid Rasool",
        billToAddressLines: ["14 Oak Road", "Birmingham", "B13 9AA"],
        pupilNames: ["Amina Rasool"],
        invoiceReferences: ["RIV-INV-2026-000001"],
        allocations: [{ invoiceNumber: "RIV-INV-2026-000001", invoiceDate: "2026-09-01", amountMinor: 50000 }],
        description: "Payment",
        currency: "GBP",
        amountMinor: 50000,
        paymentMethod: "bank_transfer",
        remainingMinor: 150000,
        status: "succeeded",
        memo: "September fees",
      }),
    );
    expect(fs.existsSync(path.join(sampleDir, "partially-paid-invoice.pdf"))).toBe(true);
    expect(extractText).toBe(extractPdfText);
  });
});
