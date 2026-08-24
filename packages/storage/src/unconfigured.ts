import { StorageError } from "./errors.js";
import type {
  CreateUploadIntentInput,
  GetObjectResult,
  ObjectMeta,
  ObjectStoragePort,
  PutObjectInput,
  PutObjectResult,
  SignedDownloadUrl,
  StorageHealth,
  UploadIntent,
} from "./types.js";

export class UnconfiguredObjectStorage implements ObjectStoragePort {
  readonly backend = "unconfigured" as const;

  isConfigured(): boolean {
    return false;
  }

  async putObject(_input: PutObjectInput): Promise<PutObjectResult> {
    throw new StorageError("storage_unconfigured");
  }

  async getObject(_key: string): Promise<GetObjectResult | null> {
    throw new StorageError("storage_unconfigured");
  }

  async deleteObject(_key: string): Promise<void> {
    throw new StorageError("storage_unconfigured");
  }

  async objectExists(_key: string): Promise<boolean> {
    return false;
  }

  async headObject(_key: string): Promise<ObjectMeta | null> {
    return null;
  }

  async createSignedDownloadUrl(): Promise<SignedDownloadUrl | null> {
    return null;
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

  async health(): Promise<StorageHealth> {
    return { configured: false, driver: "unconfigured", writable: false };
  }
}
