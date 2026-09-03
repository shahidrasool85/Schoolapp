import { describe, expect, it } from "vitest";
import {
  financePdfFilename,
  renderFinancePdf,
  zipStoreFiles,
  type FinanceInvoiceDocument,
  type FinanceStatementDocument,
} from "./finance-documents.js";

const invoice: FinanceInvoiceDocument = {
  kind: "invoice",
  schoolName: "Kingswood School",
  schoolAddress: "1 School Lane",
  invoiceNumber: "KSW-INV-2026-000123",
  invoiceDate: "2026-09-01",
  dueDate: "2026-09-15",
  familyName: "Family Rasool",
  pupilNames: ["Child A"],
  classOrYear: "Year 3",
  description: "Year 3 Tuition",
  billingPeriod: "2026-09-01 – 2026-09-30",
  currency: "GBP",
  amountMinor: 200000,
  paidMinor: 0,
  outstandingMinor: 200000,
  status: "issued",
  lines: [{ description: "Year 3 Tuition", pupilName: "Child A", amountMinor: 200000 }],
  vatInvoice: false,
};

describe("finance PDF documents", () => {
  it("renders a simple non-VAT invoice PDF", () => {
    const bytes = renderFinancePdf(invoice);
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("KSW-INV-2026-000123");
    expect(text).toContain("This is not a VAT invoice.");
    expect(text).not.toContain("VAT Invoice");
    expect(text).toContain("LuvLearn");
    expect(financePdfFilename(invoice)).toBe("KSW-INV-2026-000123.pdf");
  });

  it("keeps pupil attribution on family statement lines", () => {
    const statement: FinanceStatementDocument = {
      kind: "statement",
      schoolName: "Kingswood School",
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
          reference: "KSW-INV-1",
          description: "Child A",
          debitMinor: 200000,
          creditMinor: 0,
          balanceMinor: 200000,
        },
      ],
    };
    const text = Buffer.from(renderFinancePdf(statement)).toString("latin1");
    expect(text).toContain("Child A");
    expect(text).toContain("KSW-INV-1");
    expect(text).toContain("Opening balance");
  });

  it("builds a ZIP of stored documents without mutating records", () => {
    const zip = zipStoreFiles([{ name: "invoices/one.pdf", data: renderFinancePdf(invoice) }]);
    expect(Buffer.from(zip).readUInt32LE(0)).toBe(0x04034b50);
  });
});
