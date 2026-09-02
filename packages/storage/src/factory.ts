import { FilesystemObjectStorage } from "./filesystem.js";
import { resolveFilesystemRoot } from "./filesystem-root.js";
import { AwsSdkS3Ops, S3CompatibleObjectStorage, createS3ClientFromConfig, s3ConfigFromEnv } from "./s3.js";
import { UnconfiguredObjectStorage } from "./unconfigured.js";
import type { ObjectStoragePort, StorageBackend } from "./types.js";

export function storageDriverFromEnv(env: NodeJS.ProcessEnv = process.env): StorageBackend {
  const raw = (env.OBJECT_STORAGE_DRIVER ?? "filesystem").trim().toLowerCase();
  if (raw === "s3") return "s3";
  if (raw === "unconfigured") return "unconfigured";
  return "filesystem";
}

export function createObjectStorageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStoragePort {
  const driver = storageDriverFromEnv(env);
  if (driver === "unconfigured") {
    return new UnconfiguredObjectStorage();
  }
  if (driver === "s3") {
    const config = s3ConfigFromEnv(env);
    const client = createS3ClientFromConfig(config);
    return new S3CompatibleObjectStorage(new AwsSdkS3Ops(client), config);
  }
  return new FilesystemObjectStorage({ rootDir: resolveFilesystemRoot(env) });
}
