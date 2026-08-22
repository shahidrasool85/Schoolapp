/**
 * Object-storage port. Phase 6–7 store document/resource/attachment metadata only.
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
  buildLearningResourceKey(input: {
    organisationId: string;
    assignmentId: string;
    resourceId: string;
    filename: string;
  }): string;
  buildSubmissionAttachmentKey(input: {
    organisationId: string;
    submissionId: string;
    revisionId: string;
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

  buildLearningResourceKey(input: {
    organisationId: string;
    assignmentId: string;
    resourceId: string;
    filename: string;
  }): string {
    const safeName = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "resource";
    return `org/${input.organisationId}/learning/${input.assignmentId}/resources/${input.resourceId}/${safeName}`;
  }

  buildSubmissionAttachmentKey(input: {
    organisationId: string;
    submissionId: string;
    revisionId: string;
    filename: string;
  }): string {
    const safeName = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "attachment";
    return `org/${input.organisationId}/learning/submissions/${input.submissionId}/${input.revisionId}/${safeName}`;
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
