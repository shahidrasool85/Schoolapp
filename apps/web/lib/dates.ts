const DATE_TZ = "Europe/London";

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (isDateOnly(trimmed.slice(0, 10)) && (trimmed.length === 10 || trimmed.endsWith("T00:00:00.000Z"))) {
    const [year, month, day] = trimmed.slice(0, 10).split("-").map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day));
    if (Number.isNaN(date.getTime())) return trimmed;
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: DATE_TZ,
  }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (isDateOnly(trimmed)) return formatDate(trimmed);
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DATE_TZ,
  }).format(date);
}

export function displayValue(value: unknown, empty = "Not provided"): string {
  if (value == null || value === "") return empty;
  return String(value);
}
