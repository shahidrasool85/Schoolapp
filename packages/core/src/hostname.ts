import { domainToASCII } from "node:url";
import { isReservedSubdomain, validateOrganisationSlug } from "@schoolapp/domain";

export type ParsedHost = {
  hostname: string;
  port: string | null;
};

export type HostClassification =
  | { kind: "invalid" }
  | { kind: "platform"; hostname: string }
  | { kind: "reserved"; hostname: string; label: string }
  | { kind: "school_subdomain"; hostname: string; slug: string }
  | { kind: "custom"; hostname: string }
  | { kind: "unknown_subdomain"; hostname: string; label: string };

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HOSTNAME_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizePlatformDomain(raw: string | null | undefined): string {
  const parsed = parseHostHeader(raw ?? "localhost");
  return parsed?.hostname ?? "localhost";
}

export function parseHostHeader(raw: string | null | undefined): ParsedHost | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (
    /[\s\\/\0]/.test(trimmed) ||
    trimmed.includes("@") ||
    trimmed.includes(",") ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  ) {
    return null;
  }

  let hostname: string;
  let port: string | null = null;

  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end < 2) return null;
    hostname = trimmed.slice(1, end);
    const rest = trimmed.slice(end + 1);
    if (rest) {
      if (!rest.startsWith(":")) return null;
      port = rest.slice(1);
    }
  } else {
    const colon = trimmed.lastIndexOf(":");
    if (colon > 0 && /^\d{1,5}$/.test(trimmed.slice(colon + 1))) {
      hostname = trimmed.slice(0, colon);
      port = trimmed.slice(colon + 1);
    } else {
      hostname = trimmed;
    }
  }

  if (port !== null) {
    const n = Number(port);
    if (!/^\d{1,5}$/.test(port) || n < 1 || n > 65535) return null;
  }

  hostname = hostname.trim().toLowerCase();
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  if (!hostname) return null;

  if (hostname.includes(":")) {
    if (!isIpv6(hostname)) return null;
    return { hostname, port };
  }

  if (IPV4_RE.test(hostname)) {
    return isIpv4(hostname) ? { hostname, port } : null;
  }

  let ascii: string;
  try {
    ascii = domainToASCII(hostname);
  } catch {
    return null;
  }
  if (!ascii) return null;
  ascii = ascii.toLowerCase();
  if (ascii.endsWith(".")) ascii = ascii.slice(0, -1);
  if (!isDnsHostname(ascii)) return null;
  return { hostname: ascii, port };
}

export function selectRequestHost(input: {
  host: string | null | undefined;
  forwardedHost: string | null | undefined;
  trustProxy: boolean;
  platformDomain: string;
}): string | null {
  const connectionHost = input.host ?? null;
  if (!input.trustProxy) {
    return connectionHost;
  }
  const forwarded = firstForwardedHost(input.forwardedHost);
  if (!forwarded) {
    return connectionHost;
  }
  // Only honour X-Forwarded-Host when the immediate Host is a proxy/origin
  // terminator (IP, localhost, platform apex, or reserved platform label).
  // If the connection already presents a school or unknown public host, use it
  // so a client cannot override a real Host with a spoofed forwarded header.
  const parsedConnection = parseHostHeader(connectionHost);
  if (!parsedConnection) {
    return forwarded;
  }
  const classified = classifyHostname(parsedConnection.hostname, input.platformDomain);
  if (
    classified.kind === "platform" ||
    classified.kind === "reserved" ||
    classified.kind === "invalid"
  ) {
    return forwarded;
  }
  return connectionHost;
}

export function firstForwardedHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  return first || null;
}

export function classifyHostname(
  hostname: string,
  platformDomain: string,
): HostClassification {
  const platform = normalizePlatformDomain(platformDomain);
  if (!hostname) return { kind: "invalid" };
  if (isIpAddress(hostname)) return { kind: "platform", hostname };

  if (hostname === platform || hostname === `www.${platform}`) {
    return { kind: "platform", hostname };
  }

  const suffix = `.${platform}`;
  if (hostname.endsWith(suffix)) {
    const prefix = hostname.slice(0, -suffix.length);
    if (!prefix || prefix.includes(".")) {
      return { kind: "unknown_subdomain", hostname, label: prefix };
    }
    if (isReservedSubdomain(prefix)) {
      return { kind: "reserved", hostname, label: prefix };
    }
    const slug = validateOrganisationSlug(prefix);
    if (!slug.ok) {
      return { kind: "unknown_subdomain", hostname, label: prefix };
    }
    return { kind: "school_subdomain", hostname, slug: slug.slug };
  }

  return { kind: "custom", hostname };
}

export function schoolPublicHostname(
  slug: string,
  platformDomain: string,
): string {
  return `${slug}.${normalizePlatformDomain(platformDomain)}`;
}

export function originForHostname(input: {
  hostname: string;
  port: string | null;
  protocol: "http" | "https";
}): string {
  const portPart =
    input.port &&
    !(input.protocol === "http" && input.port === "80") &&
    !(input.protocol === "https" && input.port === "443")
      ? `:${input.port}`
      : "";
  return `${input.protocol}://${formatHostname(input.hostname)}${portPart}`;
}

export function formatHostname(hostname: string): string {
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}

function isDnsHostname(hostname: string): boolean {
  if (hostname.length < 1 || hostname.length > 253) return false;
  const labels = hostname.split(".");
  if (labels.some((label) => !HOSTNAME_LABEL_RE.test(label))) return false;
  return true;
}

function isIpv4(hostname: string): boolean {
  if (!IPV4_RE.test(hostname)) return false;
  return hostname.split(".").every((part) => {
    const n = Number(part);
    return n >= 0 && n <= 255 && String(n) === part;
  });
}

function isIpv6(hostname: string): boolean {
  return hostname.includes(":") && !hostname.includes("%");
}

function isIpAddress(hostname: string): boolean {
  return isIpv4(hostname) || isIpv6(hostname);
}
