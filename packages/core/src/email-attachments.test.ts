import { describe, expect, it } from "vitest";
import {
  EmailAttachmentError,
  EmailAttachmentLimitConfigError,
  POSTMARK_MAX_ENCODED_MESSAGE_BYTES,
  TRANSACTIONAL_EMAIL_ATTACHMENT_DEFAULT_BYTES,
  TRANSACTIONAL_EMAIL_ATTACHMENT_HARD_CAP_BYTES,
  TRANSACTIONAL_EMAIL_ATTACHMENT_HARD_CAP_MEGABYTES,
  TRANSACTIONAL_EMAIL_ATTACHMENT_MAX_BYTES,
  TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_COUNT,
  TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_TOTAL_BYTES,
  TRANSACTIONAL_EMAIL_ATTACHMENTS_HARD_CAP_COUNT,
  TRANSACTIONAL_EMAIL_ATTACHMENTS_HARD_CAP_TOTAL_BYTES,
  TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_COUNT,
  TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_TOTAL_BYTES,
  assertTransactionalEmailAttachmentSet,
  attachmentTooLargeMessage,
  describeAttachmentSetLimitStatus,
  estimateEncodedMessageBytes,
  formatAttachmentByteSize,
  parsePlatformEmailAttachmentLimits,
  presentEmailAttachmentMeta,
  sanitizeEmailAttachmentFilename,
  sanitizeEmailAttachments,
} from "./email-attachments.js";

const PDF = new Uint8Array(Buffer.from("%PDF-1.1\n%%EOF\n"));

describe("automatic email attachments", () => {
  it("defaults to Postmark-safe 7 MB per file, 7 MB total, and 5 files", () => {
    expect(TRANSACTIONAL_EMAIL_ATTACHMENT_MAX_BYTES).toBe(7 * 1024 * 1024);
    expect(TRANSACTIONAL_EMAIL_ATTACHMENT_DEFAULT_BYTES).toBe(7 * 1024 * 1024);
    expect(TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_TOTAL_BYTES).toBe(7 * 1024 * 1024);
    expect(TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_TOTAL_BYTES).toBe(7 * 1024 * 1024);
    expect(TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_COUNT).toBe(5);
    expect(TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_COUNT).toBe(5);
    expect(estimateEncodedMessageBytes(TRANSACTIONAL_EMAIL_ATTACHMENTS_HARD_CAP_TOTAL_BYTES)).toBeLessThanOrEqual(
      POSTMARK_MAX_ENCODED_MESSAGE_BYTES,
    );
  });

  it("caps Platform Admin values at 7 MB / 7 MB / 10 so encoded size stays under 10 MB", () => {
    expect(TRANSACTIONAL_EMAIL_ATTACHMENT_HARD_CAP_BYTES).toBe(7 * 1024 * 1024);
    expect(TRANSACTIONAL_EMAIL_ATTACHMENTS_HARD_CAP_TOTAL_BYTES).toBe(7 * 1024 * 1024);
    expect(TRANSACTIONAL_EMAIL_ATTACHMENTS_HARD_CAP_COUNT).toBe(10);
    expect(TRANSACTIONAL_EMAIL_ATTACHMENT_HARD_CAP_MEGABYTES).toBe(7);
    expect(
      estimateEncodedMessageBytes(15 * 1024 * 1024),
    ).toBeGreaterThan(POSTMARK_MAX_ENCODED_MESSAGE_BYTES);
  });

  it("sanitises path traversal and header-breaking filenames", () => {
    expect(sanitizeEmailAttachmentFilename("../../etc/passwd.pdf", "application/pdf")).toBe("passwd.pdf");
    expect(sanitizeEmailAttachmentFilename("Prospectus\r\nBcc:x.pdf", "application/pdf")).toBe("ProspectusBcc_x.pdf");
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
        { filename: "b.pdf", contentType: "application/pdf", byteSize: 3 * 1024 * 1024 },
      ]),
    ).toThrow(/maximum total attachment size/i);
    expect(() =>
      assertTransactionalEmailAttachmentSet([
        { filename: "a.html", contentType: "text/html", byteSize: 100 },
      ]),
    ).toThrow(/not an allowed file type/i);
  });

  it("accepts a file just under the default 7 MB per-file limit", () => {
    const presented = assertTransactionalEmailAttachmentSet([
      { filename: "brochure.pdf", contentType: "application/pdf", byteSize: 7 * 1024 * 1024 - 1 },
    ]);
    expect(presented).toHaveLength(1);
    expect(presented[0]?.overLimit).toBe(false);
  });

  it("rejects a file over the configured per-file limit with a user-facing size message", () => {
    expect(() =>
      assertTransactionalEmailAttachmentSet(
        [{ filename: "Brochure.pdf", contentType: "application/pdf", byteSize: 8 * 1024 * 1024 }],
        { maxBytesPerFile: 7 * 1024 * 1024, maxTotalBytes: 7 * 1024 * 1024, maxCount: 5 },
      ),
    ).toThrow(/Brochure\.pdf is 8 MB\. The maximum attachment size is 7 MB\./);
  });

  it("marks existing over-limit files for display instead of throwing", () => {
    const meta = presentEmailAttachmentMeta(
      { filename: "Brochure.pdf", contentType: "application/pdf", byteSize: 8 * 1024 * 1024 },
      { maxBytesPerFile: 7 * 1024 * 1024, maxTotalBytes: 7 * 1024 * 1024, maxCount: 5 },
      { enforceSize: false },
    );
    expect(meta.overLimit).toBe(true);
    expect(meta.filename).toBe("Brochure.pdf");
    const status = describeAttachmentSetLimitStatus([meta], {
      maxBytesPerFile: 7 * 1024 * 1024,
      maxTotalBytes: 7 * 1024 * 1024,
      maxCount: 5,
    });
    expect(status.totalOverLimit).toBe(true);
  });

  it("rejects Platform Admin values above the hard cap, zero, negative, and total below per-file", () => {
    expect(() =>
      parsePlatformEmailAttachmentLimits({ maxMegabytesPerFile: 15, maxTotalMegabytes: 20, maxCount: 5 }),
    ).toThrow(EmailAttachmentLimitConfigError);
    expect(() =>
      parsePlatformEmailAttachmentLimits({ maxMegabytesPerFile: 8, maxTotalMegabytes: 7, maxCount: 5 }),
    ).toThrow(/cannot exceed 7 MB/);
    expect(() =>
      parsePlatformEmailAttachmentLimits({ maxMegabytesPerFile: 0, maxTotalMegabytes: 7, maxCount: 5 }),
    ).toThrow(/greater than zero/);
    expect(() =>
      parsePlatformEmailAttachmentLimits({ maxMegabytesPerFile: -1, maxTotalMegabytes: 7, maxCount: 5 }),
    ).toThrow(/greater than zero/);
    expect(() =>
      parsePlatformEmailAttachmentLimits({ maxMegabytesPerFile: 7, maxTotalMegabytes: 6, maxCount: 5 }),
    ).toThrow(/at least the per-file maximum/);
    expect(() =>
      parsePlatformEmailAttachmentLimits({ maxMegabytesPerFile: 3, maxTotalMegabytes: 7, maxCount: 11 }),
    ).toThrow(/cannot exceed 10/);
    const ok = parsePlatformEmailAttachmentLimits({
      maxMegabytesPerFile: 5,
      maxTotalMegabytes: 7,
      maxCount: 8,
    });
    expect(ok.maxBytesPerFile).toBe(5 * 1024 * 1024);
    expect(ok.maxCount).toBe(8);
  });

  it("formats sizes for preview metadata and rejection copy", () => {
    expect(formatAttachmentByteSize(640 * 1024)).toBe("640 KB");
    expect(formatAttachmentByteSize(2.1 * 1024 * 1024)).toBe("2.1 MB");
    expect(attachmentTooLargeMessage("Brochure.pdf", 18.4 * 1024 * 1024, 7 * 1024 * 1024)).toBe(
      "Brochure.pdf is 18.4 MB. The maximum attachment size is 7 MB.",
    );
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
