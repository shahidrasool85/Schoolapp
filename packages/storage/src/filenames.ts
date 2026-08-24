const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
const MAX_FILENAME_LENGTH = 180;

export function sanitizeOriginalFilename(input: string | null | undefined): string {
  const raw = (input ?? "").normalize("NFC").replace(CONTROL_CHARS, "");
  const trimmed = raw.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  const withoutDots = trimmed.replace(/^\.+/, "").replace(/[<>:"|?*]+/g, "_");
  const collapsed = withoutDots.replace(/\s+/g, " ").trim();
  let name = collapsed.slice(0, MAX_FILENAME_LENGTH);
  if (!name || name === "." || name === ".." || WINDOWS_RESERVED.test(name)) {
    name = "document";
  }
  if (name.includes("\u0000") || name.includes("%00")) {
    name = "document";
  }
  return name;
}

export function filenameExtension(filename: string): string {
  const safe = sanitizeOriginalFilename(filename);
  const index = safe.lastIndexOf(".");
  if (index <= 0 || index === safe.length - 1) return "";
  return safe.slice(index + 1).toLowerCase();
}

export function isUnsafeDisplayFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.includes("<") ||
    lower.includes(">") ||
    lower.includes("javascript:") ||
    CONTROL_CHARS.test(filename)
  );
}
