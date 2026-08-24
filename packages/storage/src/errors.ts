import type { StorageErrorCode } from "./types.js";

const USER_MESSAGES: Record<StorageErrorCode, string> = {
  storage_unconfigured: "File storage is not configured",
  storage_unavailable: "File storage is temporarily unavailable",
  file_too_large: "This file is too large",
  unsupported_file_type: "This file type is not allowed",
  invalid_filename: "This filename is not allowed",
  invalid_object_key: "The file could not be stored",
  object_not_found: "This file is no longer available",
  upload_failed: "The file could not be uploaded",
  file_unavailable: "This file is no longer available",
};

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly status: number;

  constructor(code: StorageErrorCode, message?: string, status?: number) {
    super(message ?? USER_MESSAGES[code]);
    this.name = "StorageError";
    this.code = code;
    this.status =
      status ??
      (code === "file_too_large" ||
      code === "unsupported_file_type" ||
      code === "invalid_filename" ||
      code === "invalid_object_key"
        ? 400
        : code === "object_not_found" || code === "file_unavailable"
          ? 404
          : code === "storage_unconfigured"
            ? 503
            : 502);
  }
}

export function userFacingStorageMessage(code: StorageErrorCode): string {
  return USER_MESSAGES[code];
}
