export type StorageBackend = "unconfigured" | "filesystem" | "s3";

export type StoredObjectDomain =
  | "admissions_form"
  | "admissions_application"
  | "student_document"
  | "learning_resource"
  | "learning_submission"
  | "pastoral"
  | "safeguarding"
  | "activity"
  | "message";

export type FileSensitivity = "standard" | "confidential" | "safeguarding";

export type StoredObjectStatus = "pending" | "active" | "rejected" | "deleted";

export type ScanStatus = "unscanned" | "pending" | "clean" | "rejected";

export type DetectedFileKind =
  | "pdf"
  | "jpeg"
  | "png"
  | "webp"
  | "gif"
  | "docx"
  | "xlsx"
  | "doc"
  | "xls"
  | "txt"
  | "html"
  | "svg"
  | "javascript"
  | "executable"
  | "zip"
  | "unknown";

export type ObjectMeta = {
  key: string;
  contentType: string;
  byteSize: number;
  checksumSha256?: string;
  lastModified?: Date;
};

export type PutObjectInput = {
  key: string;
  body: Uint8Array;
  contentType: string;
};

export type PutObjectResult = {
  key: string;
  byteSize: number;
  checksumSha256: string;
};

export type GetObjectResult = {
  body: Uint8Array;
  contentType?: string;
  byteSize: number;
};

export type CreateUploadIntentInput = {
  organisationId: string;
  key: string;
  contentType: string;
  byteSize?: number;
};

export type UploadIntent = {
  backend: StorageBackend;
  key: string;
  uploadUrl: string | null;
  headers: Record<string, string>;
  expiresAt: string | null;
};

export type SignedDownloadUrl = {
  url: string;
  expiresAt: string;
  expiresInSeconds: number;
};

export type StorageHealth = {
  configured: boolean;
  driver: StorageBackend;
  writable: boolean | null;
};

export interface ObjectStoragePort {
  readonly backend: StorageBackend;
  isConfigured(): boolean;
  putObject(input: PutObjectInput): Promise<PutObjectResult>;
  getObject(key: string): Promise<GetObjectResult | null>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
  headObject(key: string): Promise<ObjectMeta | null>;
  createSignedDownloadUrl(input: {
    key: string;
    expiresInSeconds: number;
    filename?: string;
    contentType?: string;
    disposition?: "inline" | "attachment";
  }): Promise<SignedDownloadUrl | null>;
  createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent>;
  health(): Promise<StorageHealth>;
}

export type ScanVerdict = {
  status: ScanStatus;
  scanner: string;
  reason?: string;
};

export interface FileScanner {
  readonly name: string;
  scan(input: { bytes: Uint8Array; filename: string; contentType: string }): Promise<ScanVerdict>;
}

export type FileProfileName =
  | "admissions"
  | "student_document"
  | "learning_resource"
  | "learning_submission"
  | "pastoral"
  | "safeguarding"
  | "activity"
  | "message";

export type FileProfile = {
  name: FileProfileName;
  maxBytes: number;
  allowedKinds: readonly DetectedFileKind[];
  allowedExtensions: readonly string[];
  allowedMimeTypes: readonly string[];
};

export type StorageErrorCode =
  | "storage_unconfigured"
  | "storage_unavailable"
  | "file_too_large"
  | "unsupported_file_type"
  | "invalid_filename"
  | "invalid_object_key"
  | "object_not_found"
  | "upload_failed"
  | "file_unavailable";
