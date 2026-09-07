export class EmailAttachmentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EmailAttachmentError";
    this.code = code;
  }
}

export class EmailAttachmentLimitConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EmailAttachmentLimitConfigError";
    this.code = code;
  }
}

/** 1 MiB. Attachment limits are stored and compared in bytes. */
export const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * Postmark outbound (API and SMTP) rejects messages larger than 10 MB after
 * base64 encoding. Current production sends via Postmark SMTP.
 *
 * @see https://postmarkapp.com/support/article/1056-what-are-the-attachment-and-email-size-limits
 */
export const POSTMARK_MAX_ENCODED_MESSAGE_BYTES = 10 * BYTES_PER_MEGABYTE;

/**
 * Amazon SES v2 API and SES SMTP allow 40 MB after base64 encoding.
 * SES v1 API remains 10 MB. LuvLearn does not send via SES in this phase;
 * the figure is the future-provider ceiling used for application safety caps.
 *
 * @see https://docs.aws.amazon.com/ses/latest/dg/quotas.html
 */
export const SES_SMTP_MAX_ENCODED_MESSAGE_BYTES = 40 * BYTES_PER_MEGABYTE;

/**
 * MIME base64 is 4/3 of raw bytes. 76-character line wrapping adds ~2.6%.
 * Combined factor ≈ 4/3 * 78/76 ≈ 1.368.
 */
export const MIME_BASE64_ENCODED_RATIO = 4 / 3;
export const MIME_BASE64_LINE_WRAP_RATIO = 78 / 76;

/** HTML body, MIME headers, multipart boundaries, and SMTP envelope. */
export const TRANSACTIONAL_EMAIL_MESSAGE_OVERHEAD_RESERVE_BYTES = 256 * 1024;

export function estimateEncodedAttachmentBytes(rawBytes: number): number {
  const size = Number.isFinite(rawBytes) ? Math.max(0, rawBytes) : 0;
  const base64 = Math.ceil(size / 3) * 4;
  return base64 + Math.ceil(base64 / 76) * 2;
}

export function estimateEncodedMessageBytes(rawAttachmentBytes: number): number {
  return (
    estimateEncodedAttachmentBytes(rawAttachmentBytes) +
    TRANSACTIONAL_EMAIL_MESSAGE_OVERHEAD_RESERVE_BYTES
  );
}

export function maxRawBytesForEncodedBudget(encodedBudget: number): number {
  const factor = MIME_BASE64_ENCODED_RATIO * MIME_BASE64_LINE_WRAP_RATIO;
  return Math.floor(encodedBudget / factor);
}

/**
 * Whole-megabyte raw attachment budget that still fits an encoded message cap
 * after MIME wrapping and the HTML/header reserve.
 */
export function recommendedRawAttachmentBytesForEncodedLimit(encodedBudget: number): number {
  for (let megabytes = Math.floor(encodedBudget / BYTES_PER_MEGABYTE); megabytes >= 1; megabytes -= 1) {
    if (estimateEncodedMessageBytes(megabytes * BYTES_PER_MEGABYTE) <= encodedBudget) {
      return megabytes * BYTES_PER_MEGABYTE;
    }
  }
  return BYTES_PER_MEGABYTE;
}

/** Postmark-safe raw total. 7 MB encodes to ~9.6–10.0 MB with HTML/header reserve. */
export const POSTMARK_RECOMMENDED_MAX_RAW_ATTACHMENT_BYTES =
  recommendedRawAttachmentBytesForEncodedLimit(POSTMARK_MAX_ENCODED_MESSAGE_BYTES);

/**
 * Conservative application-wide ceiling under SES SMTP/v2's 40 MB encoded cap
 * (~29 MB raw theoretical). 25 MB leaves extra headroom and is the schema CHECK.
 * This is not the current Postmark effective limit.
 */
export const TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_MEGABYTES = 25;
export const TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_BYTES =
  TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_MEGABYTES * BYTES_PER_MEGABYTE;
export const TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_TOTAL_BYTES =
  TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_BYTES;
export const TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_COUNT = 10;

export const TRANSACTIONAL_EMAIL_ATTACHMENT_DEFAULT_BYTES = POSTMARK_RECOMMENDED_MAX_RAW_ATTACHMENT_BYTES;
export const TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_TOTAL_BYTES = POSTMARK_RECOMMENDED_MAX_RAW_ATTACHMENT_BYTES;
export const TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_COUNT = 5;

/** @deprecated Use DEFAULT constants. Kept as the Postmark-era effective default. */
export const TRANSACTIONAL_EMAIL_ATTACHMENT_MAX_BYTES = TRANSACTIONAL_EMAIL_ATTACHMENT_DEFAULT_BYTES;
/** @deprecated Use DEFAULT constants. Kept as the Postmark-era effective default. */
export const TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_TOTAL_BYTES =
  TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_TOTAL_BYTES;
/** @deprecated Use DEFAULT constants. Kept as the Postmark-era effective default. */
export const TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_COUNT = TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_COUNT;

/** @deprecated Use APPLICATION_CAP. Schema/app ceiling, not the active provider limit. */
export const TRANSACTIONAL_EMAIL_ATTACHMENT_HARD_CAP_BYTES =
  TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_BYTES;
/** @deprecated Use APPLICATION_CAP. Schema/app ceiling, not the active provider limit. */
export const TRANSACTIONAL_EMAIL_ATTACHMENTS_HARD_CAP_TOTAL_BYTES =
  TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_TOTAL_BYTES;
export const TRANSACTIONAL_EMAIL_ATTACHMENTS_HARD_CAP_COUNT =
  TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_COUNT;

export const TRANSACTIONAL_EMAIL_ATTACHMENT_HARD_CAP_MEGABYTES =
  TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_MEGABYTES;
export const TRANSACTIONAL_EMAIL_ATTACHMENTS_HARD_CAP_TOTAL_MEGABYTES =
  TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_MEGABYTES;
export const TRANSACTIONAL_EMAIL_ATTACHMENT_DEFAULT_MEGABYTES = 7;
export const TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_TOTAL_MEGABYTES = 7;

export const TRANSACTIONAL_EMAIL_ATTACHMENT_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
] as const;

export type TransactionalEmailAttachmentKind = "pdf" | "docx" | "jpeg" | "png";

export type TransactionalEmailAttachmentLimits = {
  maxBytesPerFile: number;
  maxTotalBytes: number;
  maxCount: number;
};

export const DEFAULT_TRANSACTIONAL_EMAIL_ATTACHMENT_LIMITS: TransactionalEmailAttachmentLimits = {
  maxBytesPerFile: TRANSACTIONAL_EMAIL_ATTACHMENT_DEFAULT_BYTES,
  maxTotalBytes: TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_TOTAL_BYTES,
  maxCount: TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_COUNT,
};

export const HARD_CAP_TRANSACTIONAL_EMAIL_ATTACHMENT_LIMITS: TransactionalEmailAttachmentLimits = {
  maxBytesPerFile: TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_BYTES,
  maxTotalBytes: TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_TOTAL_BYTES,
  maxCount: TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_COUNT,
};

export const POSTMARK_SAFE_TRANSACTIONAL_EMAIL_ATTACHMENT_LIMITS: TransactionalEmailAttachmentLimits = {
  maxBytesPerFile: POSTMARK_RECOMMENDED_MAX_RAW_ATTACHMENT_BYTES,
  maxTotalBytes: POSTMARK_RECOMMENDED_MAX_RAW_ATTACHMENT_BYTES,
  maxCount: TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_COUNT,
};

export type EmailProviderCapabilityKey = "postmark" | "ses" | "unknown";

export type EmailProviderCapabilities = {
  key: EmailProviderCapabilityKey;
  maxEncodedMessageBytes: number;
  recommendedMaxRawAttachmentBytes: number;
  supportsAttachments: boolean;
};

export const POSTMARK_EMAIL_PROVIDER_CAPABILITIES: EmailProviderCapabilities = {
  key: "postmark",
  maxEncodedMessageBytes: POSTMARK_MAX_ENCODED_MESSAGE_BYTES,
  recommendedMaxRawAttachmentBytes: POSTMARK_RECOMMENDED_MAX_RAW_ATTACHMENT_BYTES,
  supportsAttachments: true,
};

/** Capability only. SES is not a configured LuvLearn delivery adapter in this phase. */
export const SES_SMTP_EMAIL_PROVIDER_CAPABILITIES: EmailProviderCapabilities = {
  key: "ses",
  maxEncodedMessageBytes: SES_SMTP_MAX_ENCODED_MESSAGE_BYTES,
  recommendedMaxRawAttachmentBytes: TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_BYTES,
  supportsAttachments: true,
};

export const UNKNOWN_SMTP_EMAIL_PROVIDER_CAPABILITIES: EmailProviderCapabilities = {
  ...POSTMARK_EMAIL_PROVIDER_CAPABILITIES,
  key: "unknown",
};

/**
 * Infer provider attachment capability from SMTP host. Unknown hosts fail closed
 * to Postmark's 10 MB encoded cap so we never expose a larger limit on the
 * current production path.
 */
export function emailProviderCapabilitiesFromHost(
  host: string | null | undefined,
): EmailProviderCapabilities {
  const value = (host ?? "").trim().toLowerCase();
  if (!value) return POSTMARK_EMAIL_PROVIDER_CAPABILITIES;
  if (value.includes("postmark")) return POSTMARK_EMAIL_PROVIDER_CAPABILITIES;
  if (value.includes("amazonses.com") || /^email-smtp\.[a-z0-9-]+\.amazonaws\.com$/.test(value)) {
    return SES_SMTP_EMAIL_PROVIDER_CAPABILITIES;
  }
  return UNKNOWN_SMTP_EMAIL_PROVIDER_CAPABILITIES;
}

export function configurableAttachmentMaxBytes(
  capabilities: EmailProviderCapabilities = POSTMARK_EMAIL_PROVIDER_CAPABILITIES,
): number {
  if (!capabilities.supportsAttachments) return 0;
  return Math.min(
    TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_BYTES,
    capabilities.recommendedMaxRawAttachmentBytes,
  );
}

export function effectiveTransactionalEmailAttachmentLimits(
  configured: TransactionalEmailAttachmentLimits,
  capabilities: EmailProviderCapabilities = POSTMARK_EMAIL_PROVIDER_CAPABILITIES,
): TransactionalEmailAttachmentLimits {
  const providerRaw = configurableAttachmentMaxBytes(capabilities);
  const maxTotalBytes = Math.min(
    Math.max(1, configured.maxTotalBytes),
    providerRaw || 1,
    TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_TOTAL_BYTES,
  );
  const maxBytesPerFile = Math.min(
    Math.max(1, configured.maxBytesPerFile),
    maxTotalBytes,
    providerRaw || 1,
    TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_BYTES,
  );
  const maxCount = Math.min(
    Math.max(1, configured.maxCount),
    TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_COUNT,
  );
  return { maxBytesPerFile, maxTotalBytes, maxCount };
}

export type EmailAttachment = {
  filename: string;
  content: Uint8Array;
  contentType: string;
};

export type EmailAttachmentMeta = {
  filename: string;
  contentType: string;
  byteSize: number;
  kind: TransactionalEmailAttachmentKind;
  overLimit: boolean;
};

const HEADER_BREAKS = /[\r\n\u0000-\u001F\u007F]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
const KIND_BY_CONTENT_TYPE: Record<string, TransactionalEmailAttachmentKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/jpeg": "jpeg",
  "image/png": "png",
};
const EXT_BY_KIND: Record<TransactionalEmailAttachmentKind, readonly string[]> = {
  pdf: ["pdf"],
  docx: ["docx"],
  jpeg: ["jpg", "jpeg"],
  png: ["png"],
};

export function transactionalEmailAttachmentKind(
  contentType: string | null | undefined,
): TransactionalEmailAttachmentKind | null {
  const mime = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return KIND_BY_CONTENT_TYPE[mime] ?? null;
}

export function sanitizeEmailAttachmentFilename(
  input: string | null | undefined,
  contentType?: string | null,
): string {
  const raw = (input ?? "").normalize("NFC").replace(HEADER_BREAKS, "");
  const trimmed = raw.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  const cleaned = trimmed.replace(/^\.+/, "").replace(/[<>:"|?*]+/g, "_").replace(/\s+/g, " ").trim();
  let name = cleaned.slice(0, 180);
  if (!name || name === "." || name === ".." || WINDOWS_RESERVED.test(name) || name.includes("%00")) {
    name = "attachment";
  }
  const kind = transactionalEmailAttachmentKind(contentType);
  if (kind) {
    const ext = filenameExtension(name);
    if (!EXT_BY_KIND[kind].includes(ext)) {
      name = `${stripExtension(name) || "attachment"}.${EXT_BY_KIND[kind][0]}`;
    }
  }
  return name.slice(0, 180);
}

export function megabytesToBytes(megabytes: number): number {
  return Math.round(megabytes * BYTES_PER_MEGABYTE);
}

export function bytesToMegabytes(bytes: number): number {
  return bytes / BYTES_PER_MEGABYTE;
}

export function formatAttachmentByteSize(bytes: number): string {
  const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (size >= BYTES_PER_MEGABYTE) {
    const mb = size / BYTES_PER_MEGABYTE;
    const rounded = mb >= 100 ? mb.toFixed(0) : mb.toFixed(1);
    return `${trimTrailingZero(rounded)} MB`;
  }
  if (size >= 1024) {
    const kb = size / 1024;
    const rounded = kb >= 10 ? kb.toFixed(0) : kb.toFixed(1);
    return `${trimTrailingZero(rounded)} KB`;
  }
  return `${Math.round(size)} B`;
}

export function attachmentTooLargeMessage(filename: string, byteSize: number, maxBytes: number): string {
  const name = sanitizeEmailAttachmentFilename(filename) || "This file";
  return `${name} is ${formatAttachmentByteSize(byteSize)}. The maximum attachment size is ${formatAttachmentByteSize(maxBytes)}.`;
}

export const ATTACHMENT_TOO_LARGE_FOR_PROVIDER_MESSAGE =
  "This file is too large to send as an email attachment with the current email provider. Add a download link to the email instead.";

export function attachmentSizeRejectionMessage(
  filename: string,
  byteSize: number,
  maxBytes: number,
  capabilities: EmailProviderCapabilities = POSTMARK_EMAIL_PROVIDER_CAPABILITIES,
): string {
  if (byteSize > capabilities.recommendedMaxRawAttachmentBytes) {
    return ATTACHMENT_TOO_LARGE_FOR_PROVIDER_MESSAGE;
  }
  return attachmentTooLargeMessage(filename, byteSize, maxBytes);
}

export function attachmentsTooLargeInTotalMessage(totalBytes: number, maxTotalBytes: number): string {
  return `These attachments are ${formatAttachmentByteSize(totalBytes)} in total. The maximum total attachment size is ${formatAttachmentByteSize(maxTotalBytes)}.`;
}

export function tooManyAttachmentsMessage(maxCount: number): string {
  return `This automatic email already has the maximum number of attachments (${maxCount})`;
}

export function attachmentKindLabel(kind: TransactionalEmailAttachmentKind): string {
  if (kind === "pdf") return "PDF";
  if (kind === "docx") return "DOCX";
  if (kind === "jpeg") return "JPEG";
  return "PNG";
}

export function acceptedAttachmentTypeSummary(): string {
  return "Accepted: PDF, DOCX, JPEG, PNG";
}

export function attachmentLimitsSummary(limits: TransactionalEmailAttachmentLimits): string {
  return [
    acceptedAttachmentTypeSummary(),
    `Maximum ${formatAttachmentByteSize(limits.maxBytesPerFile)} per file`,
    `Maximum ${formatAttachmentByteSize(limits.maxTotalBytes)} total`,
    `Up to ${limits.maxCount} attachments`,
  ].join("\n");
}

export function defaultTransactionalEmailAttachmentLimits(): TransactionalEmailAttachmentLimits {
  return { ...DEFAULT_TRANSACTIONAL_EMAIL_ATTACHMENT_LIMITS };
}

export function clampTransactionalEmailAttachmentLimits(
  input: Partial<TransactionalEmailAttachmentLimits> | null | undefined,
  capabilities: EmailProviderCapabilities = POSTMARK_EMAIL_PROVIDER_CAPABILITIES,
): TransactionalEmailAttachmentLimits {
  const maxBytesPerFile = clampInteger(
    input?.maxBytesPerFile,
    1,
    TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_BYTES,
    TRANSACTIONAL_EMAIL_ATTACHMENT_DEFAULT_BYTES,
  );
  const maxTotalBytes = clampInteger(
    input?.maxTotalBytes,
    maxBytesPerFile,
    TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_TOTAL_BYTES,
    Math.max(maxBytesPerFile, TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_TOTAL_BYTES),
  );
  const maxCount = clampInteger(
    input?.maxCount,
    1,
    TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_COUNT,
    TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_COUNT,
  );
  return effectiveTransactionalEmailAttachmentLimits(
    { maxBytesPerFile, maxTotalBytes, maxCount },
    capabilities,
  );
}

export function parsePlatformEmailAttachmentLimits(
  input: {
    maxMegabytesPerFile?: unknown;
    maxTotalMegabytes?: unknown;
    maxCount?: unknown;
  },
  capabilities: EmailProviderCapabilities = POSTMARK_EMAIL_PROVIDER_CAPABILITIES,
): TransactionalEmailAttachmentLimits {
  const maxMegabytesPerFile = requirePositiveInt(input.maxMegabytesPerFile, "Maximum size per attachment");
  const maxTotalMegabytes = requirePositiveInt(input.maxTotalMegabytes, "Maximum total attachment size per email");
  const maxCount = requirePositiveInt(input.maxCount, "Maximum attachments per email");
  const providerMaxMegabytes = bytesToMegabytes(configurableAttachmentMaxBytes(capabilities));
  if (maxMegabytesPerFile > TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_MEGABYTES) {
    throw new EmailAttachmentLimitConfigError(
      "attachment_limit_cap_exceeded",
      `Maximum size per attachment cannot exceed ${TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_MEGABYTES} MB`,
    );
  }
  if (maxTotalMegabytes > TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_MEGABYTES) {
    throw new EmailAttachmentLimitConfigError(
      "attachment_limit_cap_exceeded",
      `Maximum total attachment size cannot exceed ${TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_MEGABYTES} MB`,
    );
  }
  if (maxCount > TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_COUNT) {
    throw new EmailAttachmentLimitConfigError(
      "attachment_limit_cap_exceeded",
      `Maximum attachments per email cannot exceed ${TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_COUNT}`,
    );
  }
  if (maxMegabytesPerFile > providerMaxMegabytes) {
    throw new EmailAttachmentLimitConfigError(
      "attachment_limit_cap_exceeded",
      `Maximum size per attachment cannot exceed ${providerMaxMegabytes} MB with the current email provider`,
    );
  }
  if (maxTotalMegabytes > providerMaxMegabytes) {
    throw new EmailAttachmentLimitConfigError(
      "attachment_limit_cap_exceeded",
      `Maximum total attachment size cannot exceed ${providerMaxMegabytes} MB with the current email provider`,
    );
  }
  if (maxTotalMegabytes < maxMegabytesPerFile) {
    throw new EmailAttachmentLimitConfigError(
      "validation_failed",
      "Maximum total attachment size must be at least the per-file maximum",
    );
  }
  const limits = {
    maxBytesPerFile: megabytesToBytes(maxMegabytesPerFile),
    maxTotalBytes: megabytesToBytes(maxTotalMegabytes),
    maxCount,
  };
  assertEncodedSizeFitsProvider(limits.maxTotalBytes, capabilities);
  return limits;
}

export function presentPlatformEmailAttachmentLimits(
  limits: TransactionalEmailAttachmentLimits,
  capabilities: EmailProviderCapabilities = POSTMARK_EMAIL_PROVIDER_CAPABILITIES,
) {
  const effective = effectiveTransactionalEmailAttachmentLimits(limits, capabilities);
  const configurableMaxBytes = configurableAttachmentMaxBytes(capabilities);
  const providerMegabytes = bytesToMegabytes(capabilities.recommendedMaxRawAttachmentBytes);
  return {
    maxBytesPerFile: effective.maxBytesPerFile,
    maxTotalBytes: effective.maxTotalBytes,
    maxCount: effective.maxCount,
    maxMegabytesPerFile: bytesToMegabytes(effective.maxBytesPerFile),
    maxTotalMegabytes: bytesToMegabytes(effective.maxTotalBytes),
    configuredMaxMegabytesPerFile: bytesToMegabytes(limits.maxBytesPerFile),
    configuredMaxTotalMegabytes: bytesToMegabytes(limits.maxTotalBytes),
    configuredMaxCount: limits.maxCount,
    hardCapMegabytesPerFile: bytesToMegabytes(configurableMaxBytes),
    hardCapTotalMegabytes: bytesToMegabytes(configurableMaxBytes),
    hardCapCount: TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_COUNT,
    applicationCapMegabytesPerFile: TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_MEGABYTES,
    applicationCapTotalMegabytes: TRANSACTIONAL_EMAIL_ATTACHMENT_APPLICATION_CAP_MEGABYTES,
    applicationCapCount: TRANSACTIONAL_EMAIL_ATTACHMENTS_APPLICATION_CAP_COUNT,
    defaultMegabytesPerFile: TRANSACTIONAL_EMAIL_ATTACHMENT_DEFAULT_MEGABYTES,
    defaultTotalMegabytes: TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_TOTAL_MEGABYTES,
    defaultCount: TRANSACTIONAL_EMAIL_ATTACHMENTS_DEFAULT_COUNT,
    provider: {
      key: capabilities.key,
      maxEncodedMessageBytes: capabilities.maxEncodedMessageBytes,
      recommendedMaxRawAttachmentBytes: capabilities.recommendedMaxRawAttachmentBytes,
      recommendedMaxRawAttachmentMegabytes: providerMegabytes,
      supportsAttachments: capabilities.supportsAttachments,
    },
    providerLimitSummary: `Maximum allowed by current email provider: ${formatAttachmentByteSize(capabilities.recommendedMaxRawAttachmentBytes)} total attachments`,
    acceptedTypes: ["PDF", "DOCX", "JPEG", "PNG"] as const,
    summary: attachmentLimitsSummary(effective),
  };
}

export function presentEmailAttachmentMeta(
  input: {
    filename: string;
    contentType: string;
    byteSize: number;
  },
  limits: TransactionalEmailAttachmentLimits = DEFAULT_TRANSACTIONAL_EMAIL_ATTACHMENT_LIMITS,
  options: { enforceSize?: boolean } = {},
): EmailAttachmentMeta {
  const kind = transactionalEmailAttachmentKind(input.contentType);
  if (!kind) {
    throw new EmailAttachmentError("attachment_invalid", "A configured email attachment is not an allowed file type");
  }
  const byteSize = Number(input.byteSize);
  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    throw new EmailAttachmentError("attachment_invalid", "A configured email attachment is outside the allowed size");
  }
  const overLimit = byteSize > limits.maxBytesPerFile;
  if (overLimit && options.enforceSize !== false) {
    throw new EmailAttachmentError(
      "attachment_too_large",
      attachmentTooLargeMessage(input.filename, byteSize, limits.maxBytesPerFile),
    );
  }
  return {
    filename: sanitizeEmailAttachmentFilename(input.filename, input.contentType),
    contentType: KIND_CONTENT_TYPE[kind],
    byteSize,
    kind,
    overLimit,
  };
}

const KIND_CONTENT_TYPE: Record<TransactionalEmailAttachmentKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  png: "image/png",
};

export type AttachmentSetLimitStatus = {
  overLimit: boolean;
  countOverLimit: boolean;
  totalOverLimit: boolean;
  encodedOverLimit: boolean;
  totalBytes: number;
};

export function describeAttachmentSetLimitStatus(
  items: Array<{ byteSize: number }>,
  limits: TransactionalEmailAttachmentLimits,
  capabilities: EmailProviderCapabilities = POSTMARK_EMAIL_PROVIDER_CAPABILITIES,
): AttachmentSetLimitStatus {
  const totalBytes = items.reduce((sum, item) => sum + Number(item.byteSize || 0), 0);
  const countOverLimit = items.length > limits.maxCount;
  const totalOverLimit = totalBytes > limits.maxTotalBytes;
  const encodedOverLimit = estimateEncodedMessageBytes(totalBytes) > capabilities.maxEncodedMessageBytes;
  return {
    overLimit: countOverLimit || totalOverLimit || encodedOverLimit,
    countOverLimit,
    totalOverLimit,
    encodedOverLimit,
    totalBytes,
  };
}

export function assertTransactionalEmailAttachmentSet(
  items: Array<{ byteSize: number; contentType: string; filename: string }>,
  limits: TransactionalEmailAttachmentLimits = DEFAULT_TRANSACTIONAL_EMAIL_ATTACHMENT_LIMITS,
  capabilities: EmailProviderCapabilities = POSTMARK_EMAIL_PROVIDER_CAPABILITIES,
): EmailAttachmentMeta[] {
  if (items.length > limits.maxCount) {
    throw new EmailAttachmentError("attachment_limit_exceeded", tooManyAttachmentsMessage(limits.maxCount));
  }
  const presented = items.map((item) => presentEmailAttachmentMeta(item, limits, { enforceSize: true }));
  const status = describeAttachmentSetLimitStatus(presented, limits, capabilities);
  if (status.totalOverLimit || status.encodedOverLimit) {
    throw new EmailAttachmentError(
      "attachment_limit_exceeded",
      attachmentsTooLargeInTotalMessage(status.totalBytes, limits.maxTotalBytes),
    );
  }
  return presented;
}

export function sanitizeEmailAttachments(
  attachments: EmailAttachment[] | undefined,
  limits: TransactionalEmailAttachmentLimits = POSTMARK_SAFE_TRANSACTIONAL_EMAIL_ATTACHMENT_LIMITS,
): EmailAttachment[] | undefined {
  if (!attachments?.length) return undefined;
  const presented = assertTransactionalEmailAttachmentSet(
    attachments.map((item) => ({
      filename: item.filename,
      contentType: item.contentType,
      byteSize: item.content.byteLength,
    })),
    limits,
  );
  return attachments.map((item, index) => ({
    filename: presented[index]!.filename,
    contentType: presented[index]!.contentType,
    content: item.content,
  }));
}

function filenameExtension(filename: string): string {
  const index = filename.lastIndexOf(".");
  if (index <= 0 || index === filename.length - 1) return "";
  return filename.slice(index + 1).toLowerCase();
}

function stripExtension(filename: string): string {
  const index = filename.lastIndexOf(".");
  if (index <= 0) return filename;
  return filename.slice(0, index);
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.0$/, "");
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function requirePositiveInt(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new EmailAttachmentLimitConfigError(
      "validation_failed",
      `${label} must be a whole number greater than zero`,
    );
  }
  return parsed;
}

function assertEncodedSizeFitsProvider(
  rawTotalBytes: number,
  capabilities: EmailProviderCapabilities,
): void {
  if (estimateEncodedMessageBytes(rawTotalBytes) > capabilities.maxEncodedMessageBytes) {
    throw new EmailAttachmentLimitConfigError(
      "attachment_limit_cap_exceeded",
      "That total would exceed the current email provider's encoded message limit",
    );
  }
}
