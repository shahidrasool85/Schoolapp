import { inflateSync, deflateSync } from "node:zlib";

export const PDF_PAGE_WIDTH = 595.28;
export const PDF_PAGE_HEIGHT = 841.89;
export const PDF_MARGIN_LEFT = 48;
export const PDF_MARGIN_RIGHT = 48;
export const PDF_MARGIN_TOP = 36;
export const PDF_MARGIN_BOTTOM = 52;

export const DEFAULT_FINANCE_ACCENT = "#4A90C7";

export type PdfRgb = { r: number; g: number; b: number };
export type PdfFont = "regular" | "bold";

export type FinancePdfLogo = {
  bytes: Uint8Array;
  contentType?: string | null;
};

type ImageXObject = {
  name: string;
  width: number;
  height: number;
  dict: Buffer;
};

const WINANSI_FROM_UNICODE: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

const UNICODE_FROM_WINANSI: Record<number, number> = Object.fromEntries(
  Object.entries(WINANSI_FROM_UNICODE).map(([unicode, win]) => [win, Number(unicode)]),
);

export function encodeWinAnsiBytes(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0) ?? 63;
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      bytes.push(0x20);
      continue;
    }
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }
    if (code >= 0xa0 && code <= 0xff) {
      bytes.push(code);
      continue;
    }
    const mapped = WINANSI_FROM_UNICODE[code];
    if (mapped != null) {
      bytes.push(mapped);
      continue;
    }
    if (code === 0x00a0) {
      bytes.push(0x20);
      continue;
    }
    bytes.push(0x3f);
  }
  return bytes;
}

export function pdfStringLiteral(text: string): string {
  const bytes = encodeWinAnsiBytes(text);
  let out = "(";
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      out += `\\${String.fromCharCode(byte)}`;
    } else if (byte < 0x20 || byte > 0x7e) {
      out += `\\${byte.toString(8).padStart(3, "0")}`;
    } else {
      out += String.fromCharCode(byte);
    }
  }
  return `${out})`;
}

export function decodeWinAnsiByte(byte: number): string {
  if (byte < 0x80) return String.fromCharCode(byte);
  if (byte >= 0xa0 && byte <= 0xff) return String.fromCharCode(byte);
  const unicode = UNICODE_FROM_WINANSI[byte];
  return unicode != null ? String.fromCodePoint(unicode) : "?";
}

export function decodePdfStringLiteral(literal: string): string {
  let i = 0;
  let out = "";
  while (i < literal.length) {
    const ch = literal[i]!;
    if (ch !== "\\") {
      out += decodeWinAnsiByte(ch.charCodeAt(0) & 0xff);
      i += 1;
      continue;
    }
    const next = literal[i + 1];
    if (next === "n") {
      out += "\n";
      i += 2;
      continue;
    }
    if (next === "r") {
      out += "\r";
      i += 2;
      continue;
    }
    if (next === "t") {
      out += "\t";
      i += 2;
      continue;
    }
    if (next === "(" || next === ")" || next === "\\") {
      out += next;
      i += 2;
      continue;
    }
    if (next && next >= "0" && next <= "7") {
      let oct = next;
      i += 2;
      while (oct.length < 3 && i < literal.length && literal[i]! >= "0" && literal[i]! <= "7") {
        oct += literal[i]!;
        i += 1;
      }
      out += decodeWinAnsiByte(parseInt(oct, 8) & 0xff);
      continue;
    }
    i += 2;
  }
  return out;
}

export function extractPdfText(bytes: Uint8Array): string {
  const source = Buffer.from(bytes).toString("latin1");
  const parts: string[] = [];
  const re = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  for (const match of source.matchAll(re)) {
    const literal = match[0].slice(1, match[0].lastIndexOf(")"));
    parts.push(decodePdfStringLiteral(literal));
  }
  return parts.join("\n");
}

export function parseHexColor(value: string | null | undefined, fallback = DEFAULT_FINANCE_ACCENT): PdfRgb {
  const raw = (value ?? "").trim();
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
    };
  }
  return parseHexColor(fallback, "#4A90C7");
}

export function isPrintSafeAccent(value: string | null | undefined): boolean {
  const raw = (value ?? "").trim();
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return false;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance >= 0.18 && luminance <= 0.72;
}

export function resolveFinanceAccent(primary?: string | null, accent?: string | null): string {
  if (isPrintSafeAccent(accent)) return accent!.startsWith("#") ? accent! : `#${accent}`;
  if (isPrintSafeAccent(primary)) return primary!.startsWith("#") ? primary! : `#${primary}`;
  return DEFAULT_FINANCE_ACCENT;
}

function pdfColor(color: PdfRgb): string {
  return `${color.r.toFixed(3)} ${color.g.toFixed(3)} ${color.b.toFixed(3)}`;
}

const HELVETICA_WIDTHS: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
  "@": 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, "[": 278,
  "\\": 278, "]": 278, "^": 469, _: 556, "`": 333, a: 556, b: 556, c: 500, d: 556,
  e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556,
  o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500,
  y: 500, z: 500, "{": 334, "|": 260, "}": 334, "~": 584,
};

export function textWidth(text: string, fontSize: number, font: PdfFont = "regular"): number {
  const factor = font === "bold" ? 1.08 : 1;
  let width = 0;
  for (const char of text) {
    width += (HELVETICA_WIDTHS[char] ?? 500) * factor;
  }
  return (width * fontSize) / 1000;
}

export function wrapText(text: string, maxWidth: number, fontSize: number, font: PdfFont = "regular"): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (textWidth(next, fontSize, font) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (textWidth(word, fontSize, font) <= maxWidth) {
      current = word;
      continue;
    }
    let chunk = "";
    for (const ch of word) {
      const candidate = chunk + ch;
      if (textWidth(candidate, fontSize, font) <= maxWidth) {
        chunk = candidate;
      } else {
        if (chunk) lines.push(chunk);
        chunk = ch;
      }
    }
    current = chunk;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterPng(inflated: Buffer, width: number, height: number, bpp: number): Buffer {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let src = 0;
  let dest = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src]!;
    src += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[src + x]!;
      const left = x >= bpp ? out[dest + x - bpp]! : 0;
      const up = y > 0 ? out[dest + x - stride]! : 0;
      const upLeft = y > 0 && x >= bpp ? out[dest + x - stride - bpp]! : 0;
      let value = raw;
      if (filter === 1) value = (raw + left) & 255;
      else if (filter === 2) value = (raw + up) & 255;
      else if (filter === 3) value = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) value = (raw + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error("unsupported_png_filter");
      out[dest + x] = value;
    }
    src += stride;
    dest += stride;
  }
  return out;
}

function pngToRgb(bytes: Uint8Array): { width: number; height: number; rgb: Buffer } | null {
  if (bytes.length < 24) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) if (bytes[i] !== sig[i]) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idats: Buffer[] = [];
  let palette: Buffer | null = null;
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const data = Buffer.from(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0 || !idats.length) return null;
  const bpp = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : colorType === 4 ? 2 : colorType === 3 ? 1 : 0;
  if (!bpp) return null;
  if (colorType === 3 && !palette) return null;
  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(idats));
  } catch {
    return null;
  }
  let pixels: Buffer;
  try {
    pixels = unfilterPng(inflated, width, height, bpp);
  } catch {
    return null;
  }
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 255;
    if (colorType === 2) {
      r = pixels[i * 3]!;
      g = pixels[i * 3 + 1]!;
      b = pixels[i * 3 + 2]!;
    } else if (colorType === 6) {
      r = pixels[i * 4]!;
      g = pixels[i * 4 + 1]!;
      b = pixels[i * 4 + 2]!;
      a = pixels[i * 4 + 3]!;
    } else if (colorType === 0) {
      r = g = b = pixels[i]!;
    } else if (colorType === 4) {
      r = g = b = pixels[i * 2]!;
      a = pixels[i * 2 + 1]!;
    } else if (colorType === 3) {
      const index = pixels[i]! * 3;
      r = palette![index]!;
      g = palette![index + 1]!;
      b = palette![index + 2]!;
    }
    const dest = i * 3;
    rgb[dest] = Math.round((r * a + 255 * (255 - a)) / 255);
    rgb[dest + 1] = Math.round((g * a + 255 * (255 - a)) / 255);
    rgb[dest + 2] = Math.round((b * a + 255 * (255 - a)) / 255);
  }
  return { width, height, rgb };
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
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
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2) return null;
    const sof = marker === 0xc0 || marker === 0xc1 || marker === 0xc2;
    if (sof) {
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      if (!width || !height) return null;
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

function embedImage(bytes: Uint8Array, contentType?: string | null): { width: number; height: number; dict: string; stream: Buffer } | null {
  const jpeg = contentType?.includes("jpeg") || contentType?.includes("jpg") || (bytes[0] === 0xff && bytes[1] === 0xd8);
  if (jpeg) {
    const size = jpegSize(bytes);
    if (!size) return null;
    const stream = Buffer.from(bytes);
    const dict = `<< /Type /XObject /Subtype /Image /Width ${size.width} /Height ${size.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${stream.length} >>`;
    return { ...size, dict, stream };
  }
  const png = pngToRgb(bytes);
  if (!png) return null;
  const stream = deflateSync(png.rgb);
  const dict = `<< /Type /XObject /Subtype /Image /Width ${png.width} /Height ${png.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${stream.length} >>`;
  return { width: png.width, height: png.height, dict, stream };
}

export class PdfBuilder {
  private pages: string[][] = [[]];
  private images: ImageXObject[] = [];
  private imageByKey = new Map<string, ImageXObject>();

  get pageCount(): number {
    return this.pages.length;
  }

  get currentPageIndex(): number {
    return this.pages.length - 1;
  }

  addPage(): void {
    this.pages.push([]);
  }

  private op(command: string): void {
    this.pages[this.pages.length - 1]!.push(command);
  }

  prepend(commands: string[]): void {
    this.pages[this.pages.length - 1]!.unshift(...commands);
  }

  appendToPage(index: number, commands: string[]): void {
    this.pages[index]?.push(...commands);
  }

  capturePageOps(fn: () => void): string[] {
    const startPages = this.pages.length;
    const startLen = this.pages[startPages - 1]!.length;
    fn();
    if (this.pages.length !== startPages) {
      throw new Error("footer_capture_started_page");
    }
    return this.pages[startPages - 1]!.splice(startLen);
  }

  fillRect(x: number, y: number, w: number, h: number, color: PdfRgb): void {
    this.op(`${pdfColor(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  strokeRect(x: number, y: number, w: number, h: number, color: PdfRgb, width = 0.6): void {
    this.op(`q ${width.toFixed(2)} w ${pdfColor(color)} RG ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S Q`);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: PdfRgb, width = 0.6): void {
    this.op(`q ${width.toFixed(2)} w ${pdfColor(color)} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`);
  }

  text(input: {
    text: string;
    x: number;
    y: number;
    size: number;
    font?: PdfFont;
    color?: PdfRgb;
  }): void {
    const font = input.font === "bold" ? "F2" : "F1";
    const color = input.color ?? { r: 0.12, g: 0.14, b: 0.18 };
    this.op(
      `BT /${font} ${input.size} Tf ${pdfColor(color)} rg ${input.x.toFixed(2)} ${input.y.toFixed(2)} Td ${pdfStringLiteral(input.text)} Tj ET`,
    );
  }

  registerLogo(logo: FinancePdfLogo | null | undefined): ImageXObject | null {
    if (!logo?.bytes?.byteLength) return null;
    const key = `${logo.contentType ?? ""}:${logo.bytes.byteLength}:${Buffer.from(logo.bytes.subarray(0, 32)).toString("hex")}`;
    const existing = this.imageByKey.get(key);
    if (existing) return existing;
    const embedded = embedImage(logo.bytes, logo.contentType);
    if (!embedded) return null;
    const name = `Im${this.images.length + 1}`;
    const stream = Buffer.concat([
      Buffer.from(`${embedded.dict}\nstream\n`),
      embedded.stream,
      Buffer.from("\nendstream"),
    ]);
    const image = { name, width: embedded.width, height: embedded.height, dict: stream };
    this.images.push(image);
    this.imageByKey.set(key, image);
    return image;
  }

  drawImage(image: ImageXObject, x: number, y: number, w: number, h: number): void {
    this.op(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${image.name} Do Q`);
  }

  build(): Uint8Array {
    const objects: Buffer[] = [];
    const add = (body: Buffer | string) => {
      objects.push(typeof body === "string" ? Buffer.from(body, "latin1") : body);
      return objects.length;
    };
    const catalogNum = add("<< /Type /Catalog /Pages 2 0 R >>");
    add("placeholder-pages");
    const regularFont = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const boldFont = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const imageNums = this.images.map((image) => add(image.dict));
    const pageNums: number[] = [];
    const contentNums: number[] = [];
    for (const page of this.pages) {
      const stream = Buffer.from(`${page.join("\n")}\n`, "latin1");
      contentNums.push(
        add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from("\nendstream")])),
      );
      pageNums.push(add("placeholder-page"));
    }
    const imageRes = this.images
      .map((image, index) => `/${image.name} ${imageNums[index]} 0 R`)
      .join(" ");
    const xobjects = imageRes ? `/XObject << ${imageRes} >>` : "";
    for (let i = 0; i < pageNums.length; i += 1) {
      objects[pageNums[i]! - 1] = Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Contents ${contentNums[i]} 0 R /Resources << /Font << /F1 ${regularFont} 0 R /F2 ${boldFont} 0 R >> ${xobjects} >> >>`,
        "latin1",
      );
    }
    objects[1] = Buffer.from(
      `<< /Type /Pages /Kids [${pageNums.map((num) => `${num} 0 R`).join(" ")}] /Count ${pageNums.length} >>`,
      "latin1",
    );
    void catalogNum;
    const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
    const offsets = [0];
    let offset = chunks[0]!.length;
    for (let i = 0; i < objects.length; i += 1) {
      offsets.push(offset);
      const obj = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), objects[i]!, Buffer.from("\nendobj\n")]);
      chunks.push(obj);
      offset += obj.length;
    }
    const xref = offset;
    let xrefTable = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const pos of offsets.slice(1)) {
      xrefTable += `${String(pos).padStart(10, "0")} 00000 n \n`;
    }
    xrefTable += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    chunks.push(Buffer.from(xrefTable, "latin1"));
    return Buffer.concat(chunks);
  }
}

export function fittedImageSize(
  image: { width: number; height: number },
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (image.width <= 0 || image.height <= 0) return { width: maxWidth, height: maxHeight };
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  return { width: image.width * scale, height: image.height * scale };
}
