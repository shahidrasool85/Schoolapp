import type { Context, Next } from "hono";
import { AppError } from "@schoolapp/core";
import {
  bindOrganisationHint,
  classifyHostname,
  parseHostHeader,
  selectRequestHost,
} from "@schoolapp/core";
import type { ApiEnv } from "./types";
import { requestedOrganisationId } from "./auth-middleware";

export type ResolvedTenantHost =
  | {
      kind: "platform";
      hostname: string;
      port: string | null;
      organisationId: null;
      slug: null;
      name: null;
      source: null;
    }
  | {
      kind: "school";
      hostname: string;
      port: string | null;
      organisationId: string;
      slug: string;
      name: string;
      source: "subdomain" | "custom_domain";
    }
  | {
      kind: "unknown";
      hostname: string;
      port: string | null;
      organisationId: null;
      slug: null;
      name: null;
      source: null;
    }
  | {
      kind: "invalid";
      hostname: null;
      port: null;
      organisationId: null;
      slug: null;
      name: null;
      source: null;
    };

const OPEN_UNKNOWN_PATHS = new Set(["/api/v1/health", "/api/v1/public/tenant"]);

export async function resolveTenantFromRequest(
  c: Context<ApiEnv>,
): Promise<ResolvedTenantHost> {
  const config = c.get("config");
  const rawHost = selectRequestHost({
    host: c.req.header("host"),
    forwardedHost: c.req.header("x-forwarded-host"),
    trustProxy: config.trustProxy,
    platformDomain: config.platformDomain,
  });
  if (!rawHost) {
    return {
      kind: "platform",
      hostname: "localhost",
      port: null,
      organisationId: null,
      slug: null,
      name: null,
      source: null,
    };
  }
  const parsed = parseHostHeader(rawHost);
  if (!parsed) {
    return {
      kind: "invalid",
      hostname: null,
      port: null,
      organisationId: null,
      slug: null,
      name: null,
      source: null,
    };
  }

  const classified = classifyHostname(parsed.hostname, config.platformDomain);
  if (classified.kind === "invalid") {
    return {
      kind: "invalid",
      hostname: null,
      port: null,
      organisationId: null,
      slug: null,
      name: null,
      source: null,
    };
  }
  if (classified.kind === "platform" || classified.kind === "reserved") {
    return {
      kind: "platform",
      hostname: parsed.hostname,
      port: parsed.port,
      organisationId: null,
      slug: null,
      name: null,
      source: null,
    };
  }
  if (classified.kind === "school_subdomain") {
    const found = await config.pools.app.query<{
      organisation_id: string;
      slug: string;
      name: string;
    }>("select * from lookup_active_organisation_by_slug($1)", [classified.slug]);
    const row = found.rows[0];
    if (!row) {
      return {
        kind: "unknown",
        hostname: parsed.hostname,
        port: parsed.port,
        organisationId: null,
        slug: null,
        name: null,
        source: null,
      };
    }
    return {
      kind: "school",
      hostname: parsed.hostname,
      port: parsed.port,
      organisationId: row.organisation_id,
      slug: row.slug,
      name: row.name,
      source: "subdomain",
    };
  }
  if (classified.kind === "unknown_subdomain") {
    return {
      kind: "unknown",
      hostname: parsed.hostname,
      port: parsed.port,
      organisationId: null,
      slug: null,
      name: null,
      source: null,
    };
  }

  const custom = await config.pools.app.query<{
    organisation_id: string;
    slug: string;
    name: string;
    hostname: string;
  }>("select * from lookup_active_organisation_by_hostname($1)", [classified.hostname]);
  const row = custom.rows[0];
  if (!row) {
    return {
      kind: "unknown",
      hostname: parsed.hostname,
      port: parsed.port,
      organisationId: null,
      slug: null,
      name: null,
      source: null,
    };
  }
  return {
    kind: "school",
    hostname: parsed.hostname,
    port: parsed.port,
    organisationId: row.organisation_id,
    slug: row.slug,
    name: row.name,
    source: "custom_domain",
  };
}

export async function tenantResolver(c: Context<ApiEnv>, next: Next) {
  const resolved = await resolveTenantFromRequest(c);
  c.set("tenantHost", resolved);
  c.header("Vary", "Host, X-Organisation-Id, Authorization");
  c.header("Cache-Control", "private, no-store");

  const path = c.req.path;
  if (resolved.kind === "invalid" && path !== "/api/v1/health" && path !== "/health") {
    throw new AppError(400, "validation_failed", "Invalid Host header");
  }
  if (
    resolved.kind === "unknown" &&
    !OPEN_UNKNOWN_PATHS.has(path) &&
    path !== "/health" &&
    path !== "/public/tenant"
  ) {
    throw new AppError(404, "tenant_not_found", "Not found");
  }
  await next();
}

export function boundOrganisationId(c: Context<ApiEnv>): string | null {
  const host = c.get("tenantHost");
  const bound = bindOrganisationHint({
    hostKind:
      host.kind === "school"
        ? "school"
        : host.kind === "platform"
          ? "platform"
          : host.kind === "unknown"
            ? "unknown"
            : "invalid",
    hostOrganisationId: host.organisationId,
    headerOrganisationId: requestedOrganisationId(c),
  });
  if (!bound.ok) {
    if (bound.reason === "org_host_mismatch") {
      throw new AppError(
        403,
        "org_host_mismatch",
        "Organisation header does not match this school host",
      );
    }
    if (bound.reason === "invalid_host") {
      throw new AppError(400, "validation_failed", "Invalid Host header");
    }
    throw new AppError(404, "tenant_not_found", "Not found");
  }
  return bound.organisationId;
}

export function requireBoundOrganisationId(c: Context<ApiEnv>): string {
  const orgId = boundOrganisationId(c);
  if (!orgId) {
    throw new AppError(400, "org_context_required", "X-Organisation-Id is required");
  }
  return orgId;
}

export function requirePlatformHost(c: Context<ApiEnv>): void {
  const host = c.get("tenantHost");
  if (host.kind === "invalid") {
    throw new AppError(400, "validation_failed", "Invalid Host header");
  }
  if (host.kind !== "platform") {
    throw new AppError(404, "not_found", "Not found");
  }
}

export function publicTenantPayload(c: Context<ApiEnv>) {
  const host = c.get("tenantHost");
  const config = c.get("config");
  if (host.kind === "school") {
    return {
      kind: "school" as const,
      platformDomain: config.platformDomain,
      hostname: host.hostname,
      source: host.source,
      organisation: {
        id: host.organisationId,
        slug: host.slug,
        name: host.name,
      },
    };
  }
  if (host.kind === "platform") {
    return {
      kind: "platform" as const,
      platformDomain: config.platformDomain,
      hostname: host.hostname,
      source: null,
      organisation: null,
    };
  }
  return {
    kind: "unknown" as const,
    platformDomain: config.platformDomain,
    hostname: host.hostname,
    source: null,
    organisation: null,
  };
}

export function assertCustomHostnameAllowed(
  hostname: string,
  platformDomain: string,
): void {
  const parsed = parseHostHeader(hostname);
  if (!parsed || parsed.port) {
    throw new AppError(400, "validation_failed", "Hostname is not a valid DNS name");
  }
  const classified = classifyHostname(parsed.hostname, platformDomain);
  if (classified.kind !== "custom") {
    throw new AppError(
      400,
      "validation_failed",
      "Custom domains cannot use the platform domain, localhost, or a reserved name",
    );
  }
}
