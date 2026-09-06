import { describe, expect, it } from "vitest";
import {
  EmailAttachmentError,
  TRANSACTIONAL_EMAIL_ATTACHMENT_MAX_BYTES,
  TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_COUNT,
  TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_TOTAL_BYTES,
  assertTransactionalEmailAttachmentSet,
  formatAttachmentByteSize,
  sanitizeEmailAttachmentFilename,
  sanitizeEmailAttachments,
} from "./email-attachments.js";

const PDF = new Uint8Array(Buffer.from("%PDF-1.1\n%%EOF\n"));

describe("automatic email attachments", () => {
  it("uses conservative per-file, total, and count limits under Postmark/SMTP 10 MB", () => {
    expect(TRANSACTIONAL_EMAIL_ATTACHMENT_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_TOTAL_BYTES).toBe(8 * 1024 * 1024);
    expect(TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_COUNT).toBe(5);
    expect(TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_TOTAL_BYTES).toBeLessThan(10 * 1024 * 1024);
  });

  it("sanitises path traversal and header-breaking filenames", () => {
    expect(sanitizeEmailAttachmentFilename("../../etc/passwd.pdf", "application/pdf")).toBe("passwd.pdf");
    expect(sanitizeEmailAttachmentFilename("Prospectus\r\nBcc:x.pdf", "application/pdf")).toBe("Prospectus Bcc_x.pdf");
    expect(sanitizeEmailAttachmentFilename("guide.txt", "application/pdf")).toBe("guide.pdf");
    expect(sanitizeEmailAttachmentFilename("", "image/png")).toBe("attachment.png");
  });

  it("rejects too many or oversized attachment sets without dropping files", () => {
    expect(() =>
      assertTransactionalEmailAttachmentSet(
        Array.from({ length: 6 }, (_, i) => ({
          filename: `doc-${i}.pdf`,
          contentType: "application/pdf",
          byteSize: 100,
        })),
      ),
    ).toThrow(EmailAttachmentError);
    expect(() =>
      assertTransactionalEmailAttachmentSet([
        { filename: "a.pdf", contentType: "application/pdf", byteSize: 5 * 1024 * 1024 },
        { filename: "b.pdf", contentType: "application/pdf", byteSize: 4 * 1024 * 1024 },
      ]),
    ).toThrow(/too large in total/i);
    expect(() =>
      assertTransactionalEmailAttachmentSet([
        { filename: "a.html", contentType: "text/html", byteSize: 100 },
      ]),
    ).toThrow(/not an allowed file type/i);
  });

  it("formats sizes for preview metadata", () => {
    expect(formatAttachmentByteSize(640 * 1024)).toBe("640 KB");
    expect(formatAttachmentByteSize(2.1 * 1024 * 1024)).toBe("2.1 MB");
  });

  it("keeps attachment bytes when sanitising a valid set", () => {
    const result = sanitizeEmailAttachments([
      { filename: "../Prospectus 2026.pdf", contentType: "application/pdf", content: PDF },
    ]);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.filename).toBe("Prospectus 2026.pdf");
    expect(result?.[0]?.content).toBe(PDF);
  });
});
