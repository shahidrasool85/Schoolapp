import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256Hex } from "./checksum.js";
import { StorageError } from "./errors.js";
import { assertSafeObjectKey } from "./keys.js";
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

export type FilesystemStorageOptions = {
  rootDir: string;
};

function resolveUnderRoot(rootDir: string, key: string): string {
  const safeKey = assertSafeObjectKey(key);
  const root = path.resolve(rootDir);
  const target = path.resolve(root, ...safeKey.split("/"));
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new StorageError("invalid_object_key");
  }
  return target;
}

export class FilesystemObjectStorage implements ObjectStoragePort {
  readonly backend = "filesystem" as const;
  readonly rootDir: string;

  constructor(options: FilesystemStorageOptions) {
    this.rootDir = path.resolve(options.rootDir);
  }

  isConfigured(): boolean {
    return true;
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const target = resolveUnderRoot(this.rootDir, input.key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tmp, input.body, { flag: "wx" });
      await fs.rename(tmp, target);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      if (error instanceof StorageError) throw error;
      throw new StorageError("upload_failed");
    }
    return {
      key: input.key,
      byteSize: input.body.byteLength,
      checksumSha256: sha256Hex(input.body),
    };
  }

  async getObject(key: string): Promise<GetObjectResult | null> {
    const target = resolveUnderRoot(this.rootDir, key);
    try {
      const body = await fs.readFile(target);
      return { body, byteSize: body.byteLength };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new StorageError("storage_unavailable");
    }
  }

  async deleteObject(key: string): Promise<void> {
    const target = resolveUnderRoot(this.rootDir, key);
    await fs.rm(target, { force: true });
  }

  async objectExists(key: string): Promise<boolean> {
    return (await this.headObject(key)) != null;
  }

  async headObject(key: string): Promise<ObjectMeta | null> {
    const target = resolveUnderRoot(this.rootDir, key);
    try {
      const stat = await fs.stat(target);
      if (!stat.isFile()) return null;
      return { key, contentType: "application/octet-stream", byteSize: stat.size, lastModified: stat.mtime };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new StorageError("storage_unavailable");
    }
  }

  async createSignedDownloadUrl(_input?: {
    key: string;
    expiresInSeconds: number;
    filename?: string;
    contentType?: string;
    disposition?: "inline" | "attachment";
  }): Promise<SignedDownloadUrl | null> {
    return null;
  }

  async createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent> {
    return {
      backend: "filesystem",
      key: input.key,
      uploadUrl: null,
      headers: {},
      expiresAt: null,
    };
  }

  async health(): Promise<StorageHealth> {
    try {
      await fs.mkdir(this.rootDir, { recursive: true });
      await fs.access(this.rootDir, fsSync.constants.W_OK);
      return { configured: true, driver: "filesystem", writable: true };
    } catch {
      return { configured: true, driver: "filesystem", writable: false };
    }
  }
}

export function defaultFilesystemRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.OBJECT_STORAGE_FS_ROOT?.trim() || path.join(os.tmpdir(), "schoolapp-object-storage");
}
