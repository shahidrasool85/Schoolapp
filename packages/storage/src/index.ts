export type {
  StorageBackend,
  StoredObjectDomain,
  FileSensitivity,
  StoredObjectStatus,
  ScanStatus,
  DetectedFileKind,
  ObjectMeta,
  PutObjectInput,
  PutObjectResult,
  GetObjectResult,
  CreateUploadIntentInput,
  UploadIntent,
  SignedDownloadUrl,
  StorageHealth,
  ObjectStoragePort,
  ScanVerdict,
  FileScanner,
  FileProfileName,
  FileProfile,
  StorageErrorCode,
} from "./types.js";
export type { ValidatedUpload } from "./validation.js";

export { StorageError, userFacingStorageMessage } from "./errors.js";
export {
  sanitizeOriginalFilename,
  filenameExtension,
  isUnsafeDisplayFilename,
} from "./filenames.js";
export {
  assertUuid,
  assertSafeObjectKey,
  organisationIdFromKey,
  buildObjectKey,
  newObjectId,
} from "./keys.js";
export { sha256Hex } from "./checksum.js";
export { NoopFileScanner, createFileScannerFromEnv } from "./scanner.js";
export {
  detectFileKind,
  sniffDeclaredMime,
  fileLimitsFromEnv,
  fileProfile,
  validateUpload,
  contentDispositionFor,
  downloadCacheControl,
  DEFAULT_FILE_MAX_BYTES,
} from "./validation.js";
export {
  readRasterImageSize,
  assertBrandingImageDimensions,
  assertProfilePhotoDimensions,
  BRANDING_LIMITS,
  PROFILE_PHOTO_LIMITS,
  type RasterImageSize,
  type BrandingImagePurpose,
} from "./image-size.js";
export { FilesystemObjectStorage, defaultFilesystemRoot } from "./filesystem.js";
export {
  resolveFilesystemRoot,
  StorageConfigError,
  PRODUCTION_FILESYSTEM_ROOT_MESSAGE,
  isProductionRuntime,
} from "./filesystem-root.js";
export {
  S3CompatibleObjectStorage,
  AwsSdkS3Ops,
  createS3ClientFromConfig,
  s3ConfigFromEnv,
  type S3StorageConfig,
  type S3CompatibleOps,
} from "./s3.js";
export { UnconfiguredObjectStorage } from "./unconfigured.js";
export { createObjectStorageFromEnv, storageDriverFromEnv } from "./factory.js";

import { UnconfiguredObjectStorage } from "./unconfigured.js";
import type { ObjectStoragePort } from "./types.js";

export const defaultObjectStorage: ObjectStoragePort = new UnconfiguredObjectStorage();
