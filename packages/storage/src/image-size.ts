import { StorageError } from "./errors.js";
import type { DetectedFileKind } from "./types.js";

export type RasterImageSize = {
  width: number;
  height: number;
};

export type BrandingImagePurpose = "logo" | "hero";

const BRANDING_LIMITS: Record<BrandingImagePurpose, { minWidth: number; minHeight: number; maxWidth: number; maxHeight: number }> =
  {
    logo: { minWidth: 32, minHeight: 32, maxWidth: 4096, maxHeight: 4096 },
    hero: { minWidth: 200, minHeight: 120, maxWidth: 6000, maxHeight: 4000 },
  };

function readU32BE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null;
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function readU16BE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 2 > bytes.length) return null;
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function pngSize(bytes: Uint8Array): RasterImageSize | null {
  if (bytes.length < 24 || !asciiAt(bytes, 12, "IHDR")) return null;
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  if (!width || !height) return null;
  return { width, height };
}

function jpegSize(bytes: Uint8Array): RasterImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = readU16BE(bytes, offset + 2);
    if (!length || length < 2) return null;
    const sof =
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc9 ||
      marker === 0xca;
    if (sof) {
      const height = readU16BE(bytes, offset + 5);
      const width = readU16BE(bytes, offset + 7);
      if (!width || !height) return null;
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): RasterImageSize | null {
  if (bytes.length < 30 || !asciiAt(bytes, 0, "RIFF") || !asciiAt(bytes, 8, "WEBP")) return null;
  if (asciiAt(bytes, 12, "VP8X") && bytes.length >= 30) {
    const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    return { width, height };
  }
  if (asciiAt(bytes, 12, "VP8 ") && bytes.length >= 30) {
    const width = readU16BE(bytes, 26);
    const height = readU16BE(bytes, 28);
    if (!width || !height) return null;
    return { width: width & 0x3fff, height: height & 0x3fff };
  }
  if (asciiAt(bytes, 12, "VP8L") && bytes.length >= 25) {
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function readRasterImageSize(
  bytes: Uint8Array,
  kind: DetectedFileKind,
): RasterImageSize | null {
  if (kind === "png") return pngSize(bytes);
  if (kind === "jpeg") return jpegSize(bytes);
  if (kind === "webp") return webpSize(bytes);
  return null;
}

export function assertBrandingImageDimensions(input: {
  bytes: Uint8Array;
  kind: DetectedFileKind;
  purpose: BrandingImagePurpose;
}): RasterImageSize {
  const size = readRasterImageSize(input.bytes, input.kind);
  if (!size) {
    throw new StorageError("unsupported_file_type", "This image could not be read");
  }
  const limits = BRANDING_LIMITS[input.purpose];
  if (
    size.width < limits.minWidth ||
    size.height < limits.minHeight ||
    size.width > limits.maxWidth ||
    size.height > limits.maxHeight
  ) {
    throw new StorageError(
      "unsupported_file_type",
      input.purpose === "logo"
        ? "Logo images must be between 32×32 and 4096×4096 pixels"
        : "Cover images must be between 200×120 and 6000×4000 pixels",
    );
  }
  return size;
}

export { BRANDING_LIMITS };
