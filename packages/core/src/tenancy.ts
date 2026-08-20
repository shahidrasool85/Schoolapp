/**
 * Bind hostname tenancy to the X-Organisation-Id hint.
 * Hostname (after server-side resolution) is routing identity.
 * Organisation UUID + membership/RLS remain authority.
 * The header is never trusted on its own.
 */

export type BoundOrganisation =
  | { ok: true; organisationId: string | null; source: "platform_header" | "hostname" | "none" }
  | { ok: false; reason: "org_host_mismatch" | "tenant_not_found" | "invalid_host" };

export function bindOrganisationHint(input: {
  hostKind: "platform" | "school" | "unknown" | "invalid";
  hostOrganisationId: string | null;
  headerOrganisationId: string | null;
}): BoundOrganisation {
  if (input.hostKind === "invalid") {
    return { ok: false, reason: "invalid_host" };
  }
  if (input.hostKind === "unknown") {
    return { ok: false, reason: "tenant_not_found" };
  }
  if (input.hostKind === "school") {
    if (!input.hostOrganisationId) {
      return { ok: false, reason: "tenant_not_found" };
    }
    if (input.headerOrganisationId && input.headerOrganisationId !== input.hostOrganisationId) {
      return { ok: false, reason: "org_host_mismatch" };
    }
    return { ok: true, organisationId: input.hostOrganisationId, source: "hostname" };
  }
  return {
    ok: true,
    organisationId: input.headerOrganisationId,
    source: input.headerOrganisationId ? "platform_header" : "none",
  };
}

export function headerMatchesHostSlug(input: {
  hostSlug: string | null;
  requestedSlug: string | null;
}): boolean {
  if (!input.hostSlug || !input.requestedSlug) return true;
  return input.hostSlug === input.requestedSlug.trim().toLowerCase();
}
