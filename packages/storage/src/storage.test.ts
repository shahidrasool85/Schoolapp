import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemObjectStorage } from "./filesystem.js";
import { S3CompatibleObjectStorage, type S3CompatibleOps } from "./s3.js";
import { UnconfiguredObjectStorage } from "./unconfigured.js";
import { StorageError } from "./errors.js";
import { sanitizeOriginalFilename } from "./filenames.js";
import { assertSafeObjectKey, buildObjectKey, organisationIdFromKey } from "./keys.js";
import { sha256Hex } from "./checksum.js";
import { NoopFileScanner } from "./scanner.js";
import { detectFileKind, fileProfile, validateUpload } from "./validation.js";
import { assertBrandingImageDimensions, assertProfilePhotoDimensions, readRasterImageSize } from "./image-size.js";
import { createObjectStorageFromEnv } from "./factory.js";
import {
  PRODUCTION_FILESYSTEM_ROOT_MESSAGE,
  StorageConfigError,
  resolveFilesystemRoot,
} from "./filesystem-root.js";

const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);
const JPEG_TINY = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb004300100b0c0e0c0a100e0d0e1211101318281a181616183123251d283a333d3c3933383740485c4e404457453738506d51575f626768673e4d71797064785c656763ffd9",
  "hex",
);
const PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF\n");
const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("word/document.xml extra bytes for office zip sniff"),
]);

const tmpDirs: string[] = [];

async function tempStorage() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "schoolapp-fs-"));
  tmpDirs.push(rootDir);
  return new FilesystemObjectStorage({ rootDir });
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("filename sanitisation", () => {
  it("strips paths, control characters, and reserved names", () => {
    expect(sanitizeOriginalFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeOriginalFilename("report\u0000.pdf")).toBe("report.pdf");
    expect(sanitizeOriginalFilename("CON.txt")).toBe("document");
    expect(sanitizeOriginalFilename("<script>hi.pdf")).toBe("_script_hi.pdf");
    expect(sanitizeOriginalFilename("a".repeat(400)).length).toBeLessThanOrEqual(180);
  });
});

describe("object keys", () => {
  it("builds tenant-aware UUID keys without original filenames", () => {
    const key = buildObjectKey({
      organisationId: "11111111-1111-4111-8111-111111111111",
      domain: "student_document",
      ownerId: "22222222-2222-4222-8222-222222222222",
      objectId: "33333333-3333-4333-8333-333333333333",
    });
    expect(key).toBe(
      "org/11111111-1111-4111-8111-111111111111/students/documents/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333",
    );
    expect(key.includes("Alice")).toBe(false);
    expect(organisationIdFromKey(key)).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("rejects path traversal and PII-like key injection", () => {
    expect(() => assertSafeObjectKey("org/x/../secret")).toThrow(StorageError);
    expect(() => assertSafeObjectKey("/etc/passwd")).toThrow(StorageError);
    expect(() =>
      buildObjectKey({
        organisationId: "not-a-uuid",
        domain: "safeguarding",
        ownerId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toThrow(StorageError);
  });
});

describe("content validation", () => {
  const profile = fileProfile("admissions");

  it("accepts PDF/JPEG/PNG matching magic bytes", () => {
    expect(detectFileKind(PDF, "letter.pdf")).toBe("pdf");
    expect(validateUpload({ filename: "letter.pdf", declaredMime: "application/pdf", bytes: PDF, profile }).kind).toBe(
      "pdf",
    );
    expect(validateUpload({ filename: "photo.jpg", declaredMime: "image/jpeg", bytes: JPEG_TINY, profile }).kind).toBe(
      "jpeg",
    );
    expect(validateUpload({ filename: "photo.png", declaredMime: "image/png", bytes: PNG_1X1, profile }).kind).toBe(
      "png",
    );
  });

  it("rejects oversized files, executables, HTML, SVG, and MIME spoofing", () => {
    const tiny = fileProfile("admissions", { ...fileLimitsStub(), admissions: 8 });
    expect(() =>
      validateUpload({ filename: "a.pdf", declaredMime: "application/pdf", bytes: PDF, profile: tiny }),
    ).toThrow(/too large/i);
    expect(() =>
      validateUpload({
        filename: "payload.exe",
        declaredMime: "application/pdf",
        bytes: Buffer.from("MZ"),
        profile,
      }),
    ).toThrow(StorageError);
    expect(() =>
      validateUpload({
        filename: "note.html",
        declaredMime: "text/html",
        bytes: Buffer.from("<html><script>alert(1)</script>"),
        profile: fileProfile("student_document"),
      }),
    ).toThrow(StorageError);
    expect(() =>
      validateUpload({
        filename: "icon.svg",
        declaredMime: "image/svg+xml",
        bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
        profile,
      }),
    ).toThrow(StorageError);
    expect(() =>
      validateUpload({
        filename: "letter.pdf",
        declaredMime: "application/pdf",
        bytes: Buffer.from("MZ executable"),
        profile,
      }),
    ).toThrow(StorageError);
  });

  it("rejects SVG and oversized files for the branding profile", () => {
    const branding = fileProfile("branding");
    expect(() =>
      validateUpload({
        filename: "logo.svg",
        declaredMime: "image/svg+xml",
        bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
        profile: branding,
      }),
    ).toThrow(StorageError);
    const huge = new Uint8Array(5 * 1024 * 1024 + 12);
    huge.set(PNG_1X1, 0);
    expect(() =>
      validateUpload({
        filename: "logo.png",
        declaredMime: "image/png",
        bytes: huge,
        profile: branding,
      }),
    ).toThrow(/too large/i);
  });

  it("accepts JPEG/PNG/WebP for profile photos and rejects other types", () => {
    const profile = fileProfile("profile_photo");
    expect(
      validateUpload({
        filename: "me.png",
        declaredMime: "image/png",
        bytes: PNG_1X1,
        profile,
      }).kind,
    ).toBe("png");
    expect(() =>
      validateUpload({
        filename: "me.pdf",
        declaredMime: "application/pdf",
        bytes: PDF,
        profile,
      }),
    ).toThrow(StorageError);
  });

  it("accepts DOCX zip signatures for learning uploads", () => {
    const result = validateUpload({
      filename: "worksheet.docx",
      declaredMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: DOCX,
      profile: fileProfile("learning_resource"),
    });
    expect(result.kind).toBe("docx");
  });
});

describe("branding image dimensions", () => {
  function pngHeader(width: number, height: number): Uint8Array {
    const bytes = Uint8Array.from(PNG_1X1);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
  }

  it("reads PNG dimensions and enforces logo/cover limits", () => {
    expect(readRasterImageSize(PNG_1X1, "png")).toEqual({ width: 1, height: 1 });
    expect(() =>
      assertBrandingImageDimensions({ bytes: PNG_1X1, kind: "png", purpose: "logo" }),
    ).toThrow(/32/);
    expect(() =>
      assertBrandingImageDimensions({ bytes: pngHeader(64, 64), kind: "png", purpose: "logo" }),
    ).not.toThrow();
    expect(() =>
      assertBrandingImageDimensions({ bytes: pngHeader(80, 80), kind: "png", purpose: "hero" }),
    ).toThrow(/200/);
    expect(() =>
      assertBrandingImageDimensions({ bytes: pngHeader(8000, 800), kind: "png", purpose: "hero" }),
    ).toThrow(/6000/);
    expect(() => assertProfilePhotoDimensions({ bytes: PNG_1X1, kind: "png" })).toThrow(/32/);
    expect(() => assertProfilePhotoDimensions({ bytes: pngHeader(64, 64), kind: "png" })).not.toThrow();
  });
});

describe("filesystem adapter", () => {
  it("puts, gets, heads, and deletes objects", async () => {
    const storage = await tempStorage();
    const key = buildObjectKey({
      organisationId: "11111111-1111-4111-8111-111111111111",
      domain: "learning_resource",
      ownerId: "22222222-2222-4222-8222-222222222222",
    });
    const put = await storage.putObject({ key, body: PDF, contentType: "application/pdf" });
    expect(put.checksumSha256).toBe(sha256Hex(PDF));
    expect(await storage.objectExists(key)).toBe(true);
    const got = await storage.getObject(key);
    expect(Buffer.from(got!.body).equals(PDF)).toBe(true);
    await storage.deleteObject(key);
    expect(await storage.getObject(key)).toBeNull();
  });

  it("refuses unknown and traversing keys", async () => {
    const storage = await tempStorage();
    await expect(storage.getObject("missing/key")).rejects.toBeInstanceOf(StorageError);
    await expect(storage.putObject({ key: "../escape", body: PDF, contentType: "application/pdf" })).rejects.toBeInstanceOf(
      StorageError,
    );
  });

  it("does not issue signed URLs", async () => {
    const storage = await tempStorage();
    expect(await storage.createSignedDownloadUrl({ key: "org/x", expiresInSeconds: 30 })).toBeNull();
  });
});

describe("S3 adapter with test double", () => {
  it("stores and signs through the injected client", async () => {
    const objects = new Map<string, { body: Uint8Array; contentType: string }>();
    const ops: S3CompatibleOps = {
      async putObject(input) {
        objects.set(`${input.bucket}:${input.key}`, { body: input.body, contentType: input.contentType });
      },
      async getObject(input) {
        const row = objects.get(`${input.bucket}:${input.key}`);
        return row ? { body: row.body, contentType: row.contentType, contentLength: row.body.byteLength } : null;
      },
      async deleteObject(input) {
        objects.delete(`${input.bucket}:${input.key}`);
      },
      async headObject(input) {
        const row = objects.get(`${input.bucket}:${input.key}`);
        return row ? { contentType: row.contentType, contentLength: row.body.byteLength } : null;
      },
      async signGetObject() {
        return "https://example.test/signed-get";
      },
      async signPutObject() {
        return "https://example.test/signed-put";
      },
    };
    const storage = new S3CompatibleObjectStorage(ops, { bucket: "schoolapp-files" });
    const key = buildObjectKey({
      organisationId: "11111111-1111-4111-8111-111111111111",
      domain: "safeguarding",
      ownerId: "22222222-2222-4222-8222-222222222222",
    });
    await storage.putObject({ key, body: PDF, contentType: "application/pdf" });
    const got = await storage.getObject(key);
    expect(Buffer.from(got!.body).equals(PDF)).toBe(true);
    const signed = await storage.createSignedDownloadUrl({ key, expiresInSeconds: 60 });
    expect(signed?.url).toBe("https://example.test/signed-get");
    const intent = await storage.createUploadIntent({
      organisationId: "11111111-1111-4111-8111-111111111111",
      key,
      contentType: "application/pdf",
    });
    expect(intent.uploadUrl).toBe("https://example.test/signed-put");
    await storage.deleteObject(key);
    expect(await storage.objectExists(key)).toBe(false);
  });
});

describe("unconfigured adapter and scanner", () => {
  it("does not claim to store bytes", async () => {
    const storage = new UnconfiguredObjectStorage();
    expect(storage.isConfigured()).toBe(false);
    await expect(storage.putObject({ key: "org/x", body: PDF, contentType: "application/pdf" })).rejects.toBeInstanceOf(
      StorageError,
    );
  });

  it("noop scanner reports unscanned, never clean", async () => {
    const verdict = await new NoopFileScanner().scan({
      bytes: PDF,
      filename: "a.pdf",
      contentType: "application/pdf",
    });
    expect(verdict.status).toBe("unscanned");
    expect(verdict.status).not.toBe("clean");
  });
});

describe("factory", () => {
  it("defaults to filesystem and never prints credentials", () => {
    const storage = createObjectStorageFromEnv({
      OBJECT_STORAGE_DRIVER: "filesystem",
      OBJECT_STORAGE_FS_ROOT: os.tmpdir(),
    });
    expect(storage.backend).toBe("filesystem");
    expect(storage.isConfigured()).toBe(true);
  });
});

describe("production filesystem root", () => {
  const safeRoot = "/var/lib/schoolapp-object-storage";
  const deployCwd = path.join(os.tmpdir(), "schoolapp-fake-httpdocs");

  it("rejects production filesystem storage when the root is missing", () => {
    expect(() =>
      resolveFilesystemRoot({
        NODE_ENV: "production",
        OBJECT_STORAGE_DRIVER: "filesystem",
      }),
    ).toThrow(StorageConfigError);
    expect(() =>
      createObjectStorageFromEnv({
        NODE_ENV: "production",
        OBJECT_STORAGE_DRIVER: "filesystem",
      }),
    ).toThrow(PRODUCTION_FILESYSTEM_ROOT_MESSAGE);
  });

  it("rejects production filesystem storage when the root is blank or relative", () => {
    expect(() =>
      resolveFilesystemRoot({
        NODE_ENV: "production",
        OBJECT_STORAGE_FS_ROOT: "   ",
      }),
    ).toThrow(PRODUCTION_FILESYSTEM_ROOT_MESSAGE);
    expect(() =>
      resolveFilesystemRoot({
        NODE_ENV: "production",
        OBJECT_STORAGE_FS_ROOT: ".data/object-storage",
      }),
    ).toThrow(PRODUCTION_FILESYSTEM_ROOT_MESSAGE);
  });

  it("rejects production filesystem storage under temp or deploy trees", () => {
    const cases: Array<{ root: string; cwd?: string }> = [
      { root: os.tmpdir() },
      { root: path.join(os.tmpdir(), "schoolapp-object-storage") },
      { root: "/tmp/schoolapp-object-storage" },
      { root: "/var/tmp/schoolapp-object-storage" },
      { root: process.cwd() },
      { root: path.join(process.cwd(), ".data", "object-storage") },
      { root: path.join(process.cwd(), ".next") },
      { root: path.join(process.cwd(), "public") },
      {
        root: path.join(process.cwd(), ".data", "object-storage"),
        cwd: path.join(process.cwd(), "apps", "web"),
      },
      { root: path.join(deployCwd, "uploads"), cwd: path.join(deployCwd, "apps", "web") },
    ];
    for (const { root, cwd } of cases) {
      expect(() =>
        resolveFilesystemRoot({ NODE_ENV: "production", OBJECT_STORAGE_FS_ROOT: root }, { cwd }),
      ).toThrow(PRODUCTION_FILESYSTEM_ROOT_MESSAGE);
    }
  });

  it("does not include the configured path or secrets in the production error", () => {
    try {
      resolveFilesystemRoot({
        NODE_ENV: "production",
        OBJECT_STORAGE_FS_ROOT: "/tmp/secret-bucket-name",
        OBJECT_STORAGE_S3_SECRET_KEY: "super-secret",
      });
      throw new Error("expected StorageConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageConfigError);
      expect((error as Error).message).toBe(PRODUCTION_FILESYSTEM_ROOT_MESSAGE);
      expect((error as Error).message).not.toContain("secret");
      expect((error as Error).message).not.toContain("/tmp");
    }
  });

  it("keeps development and test defaults usable", () => {
    const fromMissing = resolveFilesystemRoot({ NODE_ENV: "test" }, { tmpdir: os.tmpdir() });
    expect(fromMissing).toBe(path.join(os.tmpdir(), "schoolapp-object-storage"));
    const fromRelative = resolveFilesystemRoot(
      { NODE_ENV: "development", OBJECT_STORAGE_FS_ROOT: ".data/object-storage" },
      { cwd: process.cwd() },
    );
    expect(fromRelative).toBe(path.resolve(process.cwd(), ".data/object-storage"));
    const storage = createObjectStorageFromEnv({
      NODE_ENV: "test",
      OBJECT_STORAGE_DRIVER: "filesystem",
    });
    expect(storage).toBeInstanceOf(FilesystemObjectStorage);
    expect(storage.backend).toBe("filesystem");
  });

  it("accepts an explicit persistent production filesystem root", () => {
    const root = resolveFilesystemRoot({
      NODE_ENV: "production",
      OBJECT_STORAGE_DRIVER: "filesystem",
      OBJECT_STORAGE_FS_ROOT: safeRoot,
    });
    expect(root).toBe(path.resolve(safeRoot));
    const storage = createObjectStorageFromEnv({
      NODE_ENV: "production",
      OBJECT_STORAGE_DRIVER: "filesystem",
      OBJECT_STORAGE_FS_ROOT: safeRoot,
    });
    expect(storage).toBeInstanceOf(FilesystemObjectStorage);
    expect((storage as FilesystemObjectStorage).rootDir).toBe(path.resolve(safeRoot));
  });
});

function fileLimitsStub() {
  return {
    admissions: 8 * 1024 * 1024,
    student_document: 10 * 1024 * 1024,
    learning_resource: 20 * 1024 * 1024,
    learning_submission: 20 * 1024 * 1024,
    pastoral: 10 * 1024 * 1024,
    safeguarding: 15 * 1024 * 1024,
    activity: 10 * 1024 * 1024,
    message: 10 * 1024 * 1024,
    branding: 5 * 1024 * 1024,
    profile_photo: 2 * 1024 * 1024,
  };
}
