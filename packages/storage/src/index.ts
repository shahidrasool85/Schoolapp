/**
 * Object-storage port. Phase 6 stores document metadata only.
 * Binary uploads are deferred until an S3-compatible adapter is configured.
 * Do not store file bytes in PostgreSQL.
 */

export type StorageBackend = "unconfigured" | "s3";

export type ObjectRef = {
  backend: StorageBackend;
  bucket?: string;
  key: string;
  contentType?: string;
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

export interface ObjectStoragePort {
  readonly backend: StorageBackend;
  isConfigured(): boolean;
  buildStudentDocumentKey(input: {
    organisationId: string;
    studentProfileId: string;
    documentId: string;
    filename: string;
  }): string;
  createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent>;
}

export class UnconfiguredObjectStorage implements ObjectStoragePort {
  readonly backend = "unconfigured" as const;

  isConfigured(): boolean {
    return false;
  }

  buildStudentDocumentKey(input: {
    organisationId: string;
    studentProfileId: string;
    documentId: string;
    filename: string;
  }): string {
    const safeName = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "document";
    return `org/${input.organisationId}/students/${input.studentProfileId}/documents/${input.documentId}/${safeName}`;
  }

  async createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent> {
    return {
      backend: "unconfigured",
      key: input.key,
      uploadUrl: null,
      headers: {},
      expiresAt: null,
    };
  }
}

export const defaultObjectStorage: ObjectStoragePort = new UnconfiguredObjectStorage();
