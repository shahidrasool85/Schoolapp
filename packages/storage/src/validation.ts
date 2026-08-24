import { filenameExtension, sanitizeOriginalFilename } from "./filenames.js";
import { StorageError } from "./errors.js";
import type { DetectedFileKind, FileProfile, FileProfileName } from "./types.js";

const KIND_MIME: Record<DetectedFileKind, readonly string[]> = {
  pdf: ["application/pdf"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  gif: ["image/gif"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  doc: ["application/msword"],
  xls: ["application/vnd.ms-excel"],
  txt: ["text/plain"],
  html: ["text/html", "application/xhtml+xml"],
  svg: ["image/svg+xml"],
  javascript: ["text/javascript", "application/javascript"],
  executable: ["application/octet-stream", "application/x-msdownload", "application/x-executable"],
  zip: ["application/zip", "application/x-zip-compressed"],
  unknown: ["application/octet-stream"],
};

const KIND_EXT: Record<DetectedFileKind, readonly string[]> = {
  pdf: ["pdf"],
  jpeg: ["jpg", "jpeg"],
  png: ["png"],
  webp: ["webp"],
  gif: ["gif"],
  docx: ["docx"],
  xlsx: ["xlsx"],
  doc: ["doc"],
  xls: ["xls"],
  txt: ["txt", "csv"],
  html: ["html", "htm"],
  svg: ["svg"],
  javascript: ["js", "mjs", "cjs"],
  executable: ["exe", "dll", "bat", "cmd", "com", "msi", "sh", "bash", "ps1", "php", "py"],
  zip: ["zip"],
  unknown: [],
};

const BLOCKED_KINDS = new Set<DetectedFileKind>([
  "html",
  "svg",
  "javascript",
  "executable",
]);

const DEFAULT_MAX: Record<FileProfileName, number> = {
  admissions: 8 * 1024 * 1024,
  student_document: 10 * 1024 * 1024,
  learning_resource: 20 * 1024 * 1024,
  learning_submission: 20 * 1024 * 1024,
  pastoral: 10 * 1024 * 1024,
  safeguarding: 15 * 1024 * 1024,
  activity: 10 * 1024 * 1024,
};

const PROFILE_KINDS: Record<FileProfileName, readonly DetectedFileKind[]> = {
  admissions: ["pdf", "jpeg", "png", "webp", "docx"],
  student_document: ["pdf", "jpeg", "png", "webp", "docx", "xlsx", "doc", "xls", "txt"],
  learning_resource: ["pdf", "jpeg", "png", "webp", "docx", "xlsx", "txt"],
  learning_submission: ["pdf", "jpeg", "png", "webp", "docx", "xlsx", "txt"],
  pastoral: ["pdf", "jpeg", "png", "webp", "docx"],
  safeguarding: ["pdf", "jpeg", "png", "webp", "docx"],
  activity: ["pdf", "jpeg", "png", "webp", "docx", "xlsx", "txt"],
};

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function containsAscii(bytes: Uint8Array, text: string, limit = 8192): boolean {
  const haystack = Buffer.from(bytes.subarray(0, Math.min(bytes.length, limit))).toString("latin1");
  return haystack.includes(text);
}

export function detectFileKind(bytes: Uint8Array, filename?: string): DetectedFileKind {
  if (bytes.length === 0) return "unknown";
  const extension = filename ? filenameExtension(filename) : "";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) return "webp";
  if (startsWith(bytes, [0x4d, 0x5a])) return "executable";
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return "executable";
  if (asciiAt(bytes, 0, "#!")) return "executable";
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return extension === "xls" ? "xls" : "doc";
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    if (containsAscii(bytes, "word/") || containsAscii(bytes, "word/document") || extension === "docx") {
      return "docx";
    }
    if (containsAscii(bytes, "xl/") || containsAscii(bytes, "xl/workbook") || extension === "xlsx") {
      return "xlsx";
    }
    return "zip";
  }
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024)))
    .toString("utf8")
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<svg") || head.includes("<svg")) return "svg";
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.includes("<script")) {
    return "html";
  }
  if (
    (extension === "txt" || extension === "csv") &&
    !bytes.subarray(0, Math.min(bytes.length, 4096)).includes(0)
  ) {
    return "txt";
  }
  return "unknown";
}

export function sniffDeclaredMime(contentType: string | null | undefined): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

export function fileLimitsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<FileProfileName, number> {
  const read = (key: string, fallback: number) => {
    const raw = env[key];
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  };
  return {
    admissions: read("OBJECT_STORAGE_MAX_BYTES_ADMISSIONS", DEFAULT_MAX.admissions),
    student_document: read("OBJECT_STORAGE_MAX_BYTES_STANDARD", DEFAULT_MAX.student_document),
    learning_resource: read("OBJECT_STORAGE_MAX_BYTES_LEARNING", DEFAULT_MAX.learning_resource),
    learning_submission: read(
      "OBJECT_STORAGE_MAX_BYTES_LEARNING",
      DEFAULT_MAX.learning_submission,
    ),
    pastoral: read("OBJECT_STORAGE_MAX_BYTES_PASTORAL", DEFAULT_MAX.pastoral),
    safeguarding: read("OBJECT_STORAGE_MAX_BYTES_SAFEGUARDING", DEFAULT_MAX.safeguarding),
    activity: read("OBJECT_STORAGE_MAX_BYTES_STANDARD", DEFAULT_MAX.activity),
  };
}

export function fileProfile(
  name: FileProfileName,
  limits: Record<FileProfileName, number> = fileLimitsFromEnv(),
): FileProfile {
  const kinds = PROFILE_KINDS[name];
  return {
    name,
    maxBytes: limits[name],
    allowedKinds: kinds,
    allowedExtensions: kinds.flatMap((kind) => [...KIND_EXT[kind]]),
    allowedMimeTypes: kinds.flatMap((kind) => [...KIND_MIME[kind]]),
  };
}

export type ValidatedUpload = {
  originalFilename: string;
  extension: string;
  declaredMime: string;
  storedContentType: string;
  kind: DetectedFileKind;
  byteSize: number;
};

export function validateUpload(input: {
  filename: string;
  declaredMime?: string | null;
  bytes: Uint8Array;
  profile: FileProfile;
}): ValidatedUpload {
  const originalFilename = sanitizeOriginalFilename(input.filename);
  const extension = filenameExtension(originalFilename);
  const declaredMime = sniffDeclaredMime(input.declaredMime);
  const byteSize = input.bytes.byteLength;
  if (byteSize <= 0) {
    throw new StorageError("unsupported_file_type");
  }
  if (byteSize > input.profile.maxBytes) {
    throw new StorageError("file_too_large");
  }
  if (!extension || !input.profile.allowedExtensions.includes(extension)) {
    throw new StorageError("unsupported_file_type");
  }
  const kind = detectFileKind(input.bytes, originalFilename);
  if (BLOCKED_KINDS.has(kind) || kind === "unknown" || kind === "zip") {
    throw new StorageError("unsupported_file_type");
  }
  if (!input.profile.allowedKinds.includes(kind)) {
    throw new StorageError("unsupported_file_type");
  }
  if (!KIND_EXT[kind].includes(extension)) {
    throw new StorageError("unsupported_file_type");
  }
  if (declaredMime && !KIND_MIME[kind].includes(declaredMime) && declaredMime !== "application/octet-stream") {
    throw new StorageError("unsupported_file_type");
  }
  return {
    originalFilename,
    extension,
    declaredMime,
    storedContentType: KIND_MIME[kind][0] ?? "application/octet-stream",
    kind,
    byteSize,
  };
}

export function contentDispositionFor(
  kind: DetectedFileKind,
  filename: string,
): { type: "inline" | "attachment"; header: string } {
  const safeName = sanitizeOriginalFilename(filename).replace(/"/g, "");
  const inline = kind === "pdf" || kind === "jpeg" || kind === "png" || kind === "webp" || kind === "gif";
  const type = inline ? "inline" : "attachment";
  const encoded = encodeURIComponent(safeName);
  return {
    type,
    header: `${type}; filename="${safeName}"; filename*=UTF-8''${encoded}`,
  };
}

export function downloadCacheControl(): string {
  return "private, no-store, no-cache, max-age=0, must-revalidate";
}

export { DEFAULT_MAX as DEFAULT_FILE_MAX_BYTES, KIND_MIME, KIND_EXT, PROFILE_KINDS };
