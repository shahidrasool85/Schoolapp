export class EmailAttachmentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EmailAttachmentError";
    this.code = code;
  }
}

export const TRANSACTIONAL_EMAIL_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_COUNT = 5;

export const TRANSACTIONAL_EMAIL_ATTACHMENT_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
] as const;

export type TransactionalEmailAttachmentKind = "pdf" | "docx" | "jpeg" | "png";

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

export function formatAttachmentByteSize(bytes: number): string {
  const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (size >= 1024 * 1024) {
    const mb = size / (1024 * 1024);
    const rounded = mb >= 10 ? mb.toFixed(0) : mb.toFixed(1);
    return `${trimTrailingZero(rounded)} MB`;
  }
  if (size >= 1024) {
    const kb = size / 1024;
    const rounded = kb >= 10 ? kb.toFixed(0) : kb.toFixed(1);
    return `${trimTrailingZero(rounded)} KB`;
  }
  return `${Math.round(size)} B`;
}

export function attachmentKindLabel(kind: TransactionalEmailAttachmentKind): string {
  if (kind === "pdf") return "PDF";
  if (kind === "docx") return "DOCX";
  if (kind === "jpeg") return "JPEG";
  return "PNG";
}

export function presentEmailAttachmentMeta(input: {
  filename: string;
  contentType: string;
  byteSize: number;
}): EmailAttachmentMeta {
  const kind = transactionalEmailAttachmentKind(input.contentType);
  if (!kind) {
    throw new EmailAttachmentError("attachment_invalid", "A configured email attachment is not an allowed file type");
  }
  const byteSize = Number(input.byteSize);
  if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > TRANSACTIONAL_EMAIL_ATTACHMENT_MAX_BYTES) {
    throw new EmailAttachmentError("attachment_invalid", "A configured email attachment is outside the allowed size");
  }
  return {
    filename: sanitizeEmailAttachmentFilename(input.filename, input.contentType),
    contentType: KIND_CONTENT_TYPE[kind],
    byteSize,
    kind,
  };
}

const KIND_CONTENT_TYPE: Record<TransactionalEmailAttachmentKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  png: "image/png",
};

export function assertTransactionalEmailAttachmentSet(
  items: Array<{ byteSize: number; contentType: string; filename: string }>,
): EmailAttachmentMeta[] {
  if (items.length > TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_COUNT) {
    throw new EmailAttachmentError(
      "attachment_limit_exceeded",
      "This automatic email has too many attachments",
    );
  }
  const presented = items.map((item) => presentEmailAttachmentMeta(item));
  const total = presented.reduce((sum, item) => sum + item.byteSize, 0);
  if (total > TRANSACTIONAL_EMAIL_ATTACHMENTS_MAX_TOTAL_BYTES) {
    throw new EmailAttachmentError(
      "attachment_limit_exceeded",
      "This automatic email's attachments are too large in total",
    );
  }
  return presented;
}

export function sanitizeEmailAttachments(
  attachments: EmailAttachment[] | undefined,
): EmailAttachment[] | undefined {
  if (!attachments?.length) return undefined;
  const presented = assertTransactionalEmailAttachmentSet(
    attachments.map((item) => ({
      filename: item.filename,
      contentType: item.contentType,
      byteSize: item.content.byteLength,
    })),
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
