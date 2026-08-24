import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

export type S3StorageConfig = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  signedUrlTtlSeconds?: number;
};

export type S3CompatibleOps = {
  putObject(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void>;
  getObject(input: { bucket: string; key: string }): Promise<{
    body: Uint8Array;
    contentType?: string;
    contentLength?: number;
  } | null>;
  deleteObject(input: { bucket: string; key: string }): Promise<void>;
  headObject(input: { bucket: string; key: string }): Promise<{
    contentType?: string;
    contentLength?: number;
    lastModified?: Date;
  } | null>;
  signGetObject?(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
    filename?: string;
    contentType?: string;
    disposition?: "inline" | "attachment";
  }): Promise<string>;
  signPutObject?(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
    contentType: string;
  }): Promise<string>;
};

async function streamToBytes(body: unknown): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (Buffer.isBuffer(body)) return body;
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    return (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  }
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new StorageError("storage_unavailable");
}

export class AwsSdkS3Ops implements S3CompatibleOps {
  constructor(private readonly client: S3Client) {}

  async putObject(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ACL: undefined,
      }),
    );
  }

  async getObject(input: { bucket: string; key: string }) {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
      );
      const body = await streamToBytes(result.Body);
      return {
        body,
        contentType: result.ContentType,
        contentLength: result.ContentLength,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new StorageError("storage_unavailable");
    }
  }

  async deleteObject(input: { bucket: string; key: string }): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }));
  }

  async headObject(input: { bucket: string; key: string }) {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
      );
      return {
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        lastModified: result.LastModified,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new StorageError("storage_unavailable");
    }
  }

  async signGetObject(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
    filename?: string;
    contentType?: string;
    disposition?: "inline" | "attachment";
  }): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ResponseContentType: input.contentType,
      ResponseContentDisposition: input.disposition
        ? `${input.disposition}; filename="${(input.filename ?? "download").replace(/"/g, "")}"`
        : undefined,
    });
    return getSignedUrl(this.client, command, { expiresIn: input.expiresInSeconds });
  }

  async signPutObject(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
    contentType: string;
  }): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ContentType: input.contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: input.expiresInSeconds });
  }
}

function isNotFound(error: unknown): boolean {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: string }).name) : "";
  const status =
    error && typeof error === "object" && "$metadata" in error
      ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      : undefined;
  return name === "NotFound" || name === "NoSuchKey" || status === 404;
}

export class S3CompatibleObjectStorage implements ObjectStoragePort {
  readonly backend = "s3" as const;
  private readonly bucket: string;
  private readonly signedUrlTtlSeconds: number;
  private readonly ops: S3CompatibleOps;

  constructor(ops: S3CompatibleOps, config: Pick<S3StorageConfig, "bucket" | "signedUrlTtlSeconds">) {
    this.ops = ops;
    this.bucket = config.bucket;
    this.signedUrlTtlSeconds = config.signedUrlTtlSeconds ?? 60;
  }

  isConfigured(): boolean {
    return true;
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const key = assertSafeObjectKey(input.key);
    try {
      await this.ops.putObject({
        bucket: this.bucket,
        key,
        body: input.body,
        contentType: input.contentType,
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError("upload_failed");
    }
    return {
      key,
      byteSize: input.body.byteLength,
      checksumSha256: sha256Hex(input.body),
    };
  }

  async getObject(key: string): Promise<GetObjectResult | null> {
    const safeKey = assertSafeObjectKey(key);
    try {
      const result = await this.ops.getObject({ bucket: this.bucket, key: safeKey });
      if (!result) return null;
      return {
        body: result.body,
        contentType: result.contentType,
        byteSize: result.contentLength ?? result.body.byteLength,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError("storage_unavailable");
    }
  }

  async deleteObject(key: string): Promise<void> {
    const safeKey = assertSafeObjectKey(key);
    try {
      await this.ops.deleteObject({ bucket: this.bucket, key: safeKey });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError("storage_unavailable");
    }
  }

  async objectExists(key: string): Promise<boolean> {
    return (await this.headObject(key)) != null;
  }

  async headObject(key: string): Promise<ObjectMeta | null> {
    const safeKey = assertSafeObjectKey(key);
    const result = await this.ops.headObject({ bucket: this.bucket, key: safeKey });
    if (!result) return null;
    return {
      key: safeKey,
      contentType: result.contentType ?? "application/octet-stream",
      byteSize: result.contentLength ?? 0,
      lastModified: result.lastModified,
    };
  }

  async createSignedDownloadUrl(input: {
    key: string;
    expiresInSeconds: number;
    filename?: string;
    contentType?: string;
    disposition?: "inline" | "attachment";
  }): Promise<SignedDownloadUrl | null> {
    if (!this.ops.signGetObject) return null;
    const expiresInSeconds = Math.min(Math.max(input.expiresInSeconds, 15), 300);
    const url = await this.ops.signGetObject({
      bucket: this.bucket,
      key: assertSafeObjectKey(input.key),
      expiresInSeconds,
      filename: input.filename,
      contentType: input.contentType,
      disposition: input.disposition,
    });
    return {
      url,
      expiresInSeconds,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  async createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent> {
    const key = assertSafeObjectKey(input.key);
    if (!this.ops.signPutObject) {
      return { backend: "s3", key, uploadUrl: null, headers: {}, expiresAt: null };
    }
    const expiresInSeconds = this.signedUrlTtlSeconds;
    const url = await this.ops.signPutObject({
      bucket: this.bucket,
      key,
      expiresInSeconds,
      contentType: input.contentType,
    });
    return {
      backend: "s3",
      key,
      uploadUrl: url,
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  async health(): Promise<StorageHealth> {
    return { configured: true, driver: "s3", writable: null };
  }
}

export function createS3ClientFromConfig(config: S3StorageConfig): S3Client {
  return new S3Client({
    region: config.region || "auto",
    endpoint: config.endpoint || undefined,
    forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3StorageConfig {
  const bucket = env.OBJECT_STORAGE_S3_BUCKET?.trim() ?? "";
  const accessKeyId = env.OBJECT_STORAGE_S3_ACCESS_KEY?.trim() ?? "";
  const secretAccessKey = env.OBJECT_STORAGE_S3_SECRET_KEY?.trim() ?? "";
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new StorageError("storage_unconfigured");
  }
  return {
    endpoint: env.OBJECT_STORAGE_S3_ENDPOINT?.trim() || undefined,
    region: env.OBJECT_STORAGE_S3_REGION?.trim() || "auto",
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: env.OBJECT_STORAGE_S3_FORCE_PATH_STYLE === "true",
    signedUrlTtlSeconds: Number(env.OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS ?? 60) || 60,
  };
}
