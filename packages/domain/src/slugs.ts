/**
 * SaaS school slug / subdomain rules.
 * Organisation UUID remains the canonical identity; slug is routing identity only.
 *
 * Keep RESERVED_SUBDOMAINS in sync with packages/db/migrations/0014_phase5_saas_tenancy.sql.
 */

export const SLUG_MIN_LENGTH = 2;
export const SLUG_MAX_LENGTH = 63;

/** DNS-safe ASCII label: lowercase letters, digits, internal hyphens. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const RESERVED_SUBDOMAINS = [
  "www",
  "app",
  "api",
  "admin",
  "platform",
  "login",
  "auth",
  "support",
  "help",
  "status",
  "mail",
  "email",
  "smtp",
  "cdn",
  "assets",
  "static",
  "docs",
  "localhost",
  "local",
  "localdomain",
  "intranet",
  "internal",
  "private",
  "host",
  "ns",
  "ns1",
  "ns2",
  "mx",
  "ftp",
  "sftp",
  "ssh",
  "vpn",
  "imap",
  "pop",
  "pop3",
  "webmail",
  "autoconfig",
  "autodiscover",
  "mta-sts",
  "test",
  "testing",
  "staging",
  "stage",
  "prod",
  "production",
  "preview",
  "beta",
  "alpha",
  "demo",
  "dev",
  "development",
  "ci",
  "qa",
  "root",
  "null",
  "undefined",
  "default",
  "wildcard",
  "wss",
  "ws",
  "graphql",
  "grpc",
  "webhook",
  "webhooks",
  "oauth",
  "sso",
  "identity",
  "accounts",
  "account",
  "billing",
  "pay",
  "payments",
  "signup",
  "register",
  "onboarding",
  "superadmin",
  "administrator",
  "origin",
  "edge",
  "gateway",
  "proxy",
  "nginx",
  "plesk",
  "server",
  "mobile",
  "schools",
  "school",
  "tenant",
  "tenants",
  "org",
  "orgs",
] as const;

export const RESERVED_SUBDOMAIN_SET: ReadonlySet<string> = new Set(RESERVED_SUBDOMAINS);

export type SlugValidationError =
  | "empty"
  | "too_short"
  | "too_long"
  | "malformed"
  | "reserved"
  | "punycode"
  | "consecutive_hyphens";

export function normalizeSlugInput(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isReservedSubdomain(slug: string): boolean {
  return RESERVED_SUBDOMAIN_SET.has(normalizeSlugInput(slug));
}

export function validateOrganisationSlug(
  raw: string,
): { ok: true; slug: string } | { ok: false; error: SlugValidationError } {
  const slug = normalizeSlugInput(raw);
  if (!slug) return { ok: false, error: "empty" };
  if (slug.length < SLUG_MIN_LENGTH) return { ok: false, error: "too_short" };
  if (slug.length > SLUG_MAX_LENGTH) return { ok: false, error: "too_long" };
  if (slug.startsWith("xn--")) return { ok: false, error: "punycode" };
  if (slug.includes("--")) return { ok: false, error: "consecutive_hyphens" };
  if (!SLUG_PATTERN.test(slug)) return { ok: false, error: "malformed" };
  if (isReservedSubdomain(slug)) return { ok: false, error: "reserved" };
  return { ok: true, slug };
}

export function slugValidationMessage(error: SlugValidationError): string {
  switch (error) {
    case "reserved":
      return "This subdomain is reserved for the platform";
    case "punycode":
      return "Internationalised (punycode) slugs are not allowed";
    case "consecutive_hyphens":
      return "School slugs cannot contain consecutive hyphens";
    case "malformed":
    case "empty":
    case "too_short":
    case "too_long":
      return "School slugs must be 2–63 lowercase DNS labels (letters, digits, hyphens)";
    default:
      return "Invalid school slug";
  }
}
