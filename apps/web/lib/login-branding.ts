export type PublicLoginBranding = {
  primaryColor?: string | null;
  logoUrl?: string | null;
  heroImageUrl?: string | null;
  tagline?: string | null;
};

export type ResolvedLoginBranding = {
  organisationName: string;
  domainLabel: string | null;
  tagline: string | null;
  primaryColor: string;
  logoUrl: string | null;
  heroImageUrl: string | null;
};

export const DEFAULT_LOGIN_PRIMARY = "#122C4A";
export const DEFAULT_LOGIN_ACCENT = "#2B78C9";

/**
 * Display-only login branding. Tenant authority still comes from hostname
 * resolution, not from the school name, logo, or colours.
 *
 * Current public tenant payload includes display-only branding
 * (`primaryColor`, `logoUrl`, `heroImageUrl`, `tagline`) plus organisation
 * name / slug / hostname. Tenant authority still comes from hostname
 * resolution, not from the school name, logo, or colours.
 */
export function resolveLoginBranding(input: {
  organisationName?: string | null;
  hostname?: string | null;
  branding?: PublicLoginBranding | null;
  fallbackName?: string;
}): ResolvedLoginBranding {
  return {
    organisationName: input.organisationName?.trim() || input.fallbackName || "School portal",
    domainLabel: displayHostname(input.hostname),
    tagline: trimToNull(input.branding?.tagline),
    primaryColor: safeHexColor(input.branding?.primaryColor) ?? DEFAULT_LOGIN_PRIMARY,
    logoUrl: safeHttpUrl(input.branding?.logoUrl),
    heroImageUrl: safeHttpUrl(input.branding?.heroImageUrl),
  };
}

export function displayHostname(hostname?: string | null): string | null {
  const value = hostname?.trim().toLowerCase();
  if (!value || value === "localhost" || value === "127.0.0.1") return null;
  return value;
}

function trimToNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function safeHexColor(value?: string | null): string | null {
  if (!value) return null;
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : null;
}

function safeHttpUrl(value?: string | null): string | null {
  if (!value) return null;
  if (/^\/api\/v1\/public\/branding\/(logo|hero)(\?[A-Za-z0-9_=&-]*)?$/.test(value)) {
    return value;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
