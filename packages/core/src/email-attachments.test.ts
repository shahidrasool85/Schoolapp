import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_TOO_LARGE_FOR_PROVIDER_MESSAGE,
  EmailAttachmentError,
  EmailAttachmentLimitConfigError,
  POSTMARK_MAX_ENCODED_MESSAGE_BYTES,
  POSTMARK_RECOMMENDED_MAX_RAW_ATTACHMENT_BYTES,
  SES_SMTP_EMAIL_PROVIDER_CAPABILITIES,
  SES_SMTP_MAX_ENCODED_MESSAGE_BYTES,
  TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_BYTES,
  TRANSACTIONAL_EMAIL_ATTACHMENT_DEFAULT_BYTES,
  TRANSACTIONAL_EMAIL_ATTACHMENT_MAX_BYTES,
  TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_COUNT,
  TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_COUNT,
  TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_TOTAL_BYTES,
  TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_COUNT,
  TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_TOTAL_BYTES,
  assertTransactionalEmailAttachmentSet,
  attachmentSizeRejectionMessage,
  attachmentTooLargeMessage,
  describeAttachmentSetLimitStatus,
  effectiveTransactionalEmailAttachmentLimits,
  emailProviderCapabilitiesFromHost,
  estimateEncodedMessageBytes,
  formatAttachmentByteSize,
  parsePlatformEmailAttachmentLimits,
  presentEmailAttachmentMeta,
  presentPlatformEmailAttachmentLimits,
  recommendedRawAttachmentBytesForEncodedLimit,
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
    expect(POSTMARK_RECOMMENDED_MAX_RAW_ATTACHMENT_BYTES).toBe(7 * 1024 * 1024);
    expect(estimateEncodedMessageBytes(POSTMARK_RECOMMENDED_MAX_RAW_ATTACHMENT_BYTES)).toBeLessThanOrEqual(
      POSTMARK_MAX_ENCODED_MESSAGE_BYTES,
    );
  });

  it("keeps Postmark as the active provider ceiling without making 7 MB the application maximum", () => {
    expect(TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_BYTES).toBe(25 * 1024 * 1024);
    expect(TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_COUNT).toBe(10);
    expect(estimateEncodedMessageBytes(TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_BYTES)).toBeLessThanOrEqual(
      SES_SMTP_MAX_ENCODED_MESSAGE_BYTES,
    );
    expect(estimateEncodedMessageBytes(15 * 1024 * 1024)).toBeGreaterThan(POSTMARK_MAX_ENCODED_MESSAGE_BYTES);
    expect(recommendedRawAttachmentBytesForEncodedLimit(POSTMARK_MAX_ENCODED_MESSAGE_BYTES)).toBe(7 * 1024 * 1024);
  });

  it("treats unknown SMTP as Postmark-safe and SES host as the larger future capability", () => {
    expect(emailProviderCapabilitiesFromHost(null).key).toBe("postmark");
    expect(emailProviderCapabilitiesFromHost("smtp.postmarkapp.com").recommendedMaxRawAttachmentBytes).toBe(
      7 * 1024 * 1024,
    );
    expect(emailProviderCapabilitiesFromHost("smtp.example.test").key).toBe("unknown");
    expect(emailProviderCapabilitiesFromHost("smtp.example.test").recommendedMaxRawAttachmentBytes).toBe(
      7 * 1024 * 1024,
    );
    const ses = emailProviderCapabilitiesFromHost("email-smtp.eu-west-1.amazonaws.com");
    expect(ses.key).toBe("ses");
    expect(ses.maxEncodedMessageBytes).toBe(SES_SMTP_MAX_ENCODED_MESSAGE_BYTES);
    expect(ses.recommendedMaxRawAttachmentBytes).toBe(25 * 1024 * 1024);
  });

  it("uses min(configured, provider, application cap) as the effective limit", () => {
    const configured = { maxBytesPerFile: 25 * 1024 * 1024, maxTotalBytes: 25 * 1024 * 1024, maxCount: 8 };
    const postmark = effectiveTransactionalEmailAttachmentLimits(configured);
    expect(postmark.maxBytesPerFile).toBe(7 * 1024 * 1024);
    expect(postmark.maxTotalBytes).toBe(7 * 1024 * 1024);
    expect(postmark.maxCount).toBe(8);
    const ses = effectiveTransactionalEmailAttachmentLimits(configured, SES_SMTP_EMAIL_PROVIDER_CAPABILITIES);
    expect(ses.maxBytesPerFile).toBe(25 * 1024 * 1024);
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

  it("uses a provider-capability message when the file exceeds the active email provider", () => {
    expect(
      attachmentSizeRejectionMessage("Brochure.pdf", 8 * 1024 * 1024, 7 * 1024 * 1024),
    ).toBe(ATTACHMENT_TOO_LARGE_FOR_PROVIDER_MESSAGE);
    expect(
      attachmentSizeRejectionMessage("Guide.pdf", 3 * 1024 * 1024, 1 * 1024 * 1024),
    ).toBe("Guide.pdf is 3 MB. The maximum attachment size is 1 MB.");
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

  it("rejects Platform Admin values above the active provider, zero, negative, and total below per-file", () => {
    expect(() =>
      parsePlatformEmailAttachmentLimits({ maxMegabytesPerFile: 15, maxTotalMegabytes: 20, maxCount: 5 }),
    ).toThrow(EmailAttachmentLimitConfigError);
    expect(() =>
      parsePlatformEmailAttachmentLimits({ maxMegabytesPerFile: 8, maxTotalMegabytes: 7, maxCount: 5 }),
    ).toThrow(/cannot exceed 7 MB with the current email provider/);
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
    const sesOk = parsePlatformEmailAttachmentLimits(
      { maxMegabytesPerFile: 15, maxTotalMegabytes: 20, maxCount: 5 },
      SES_SMTP_EMAIL_PROVIDER_CAPABILITIES,
    );
    expect(sesOk.maxTotalBytes).toBe(20 * 1024 * 1024);
    expect(() =>
      parsePlatformEmailAttachmentLimits(
        { maxMegabytesPerFile: 26, maxTotalMegabytes: 26, maxCount: 5 },
        SES_SMTP_EMAIL_PROVIDER_CAPABILITIES,
      ),
    ).toThrow(/cannot exceed 25 MB/);
  });

  it("presents provider capability separately from the application cap", () => {
    const presented = presentPlatformEmailAttachmentLimits({
      maxBytesPerFile: 7 * 1024 * 1024,
      maxTotalBytes: 7 * 1024 * 1024,
      maxCount: 5,
    });
    expect(presented.providerLimitSummary).toBe(
      "Maximum allowed by current email provider: 7 MB total attachments",
    );
    expect(presented.hardCapMegabytesPerFile).toBe(7);
    expect(presented.applicationCapMegabytesPerFile).toBe(25);
    expect(presented.provider.key).toBe("postmark");
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
