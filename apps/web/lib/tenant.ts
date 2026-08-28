import { ApiError, api } from "./api";
import type { PublicLoginBranding } from "./login-branding";
import type { Membership } from "./portal";

export type PublicTenant =
  | {
      kind: "platform";
      platformDomain: string;
      hostname: string;
      organisation: null;
    }
  | {
      kind: "school";
      platformDomain: string;
      hostname: string;
      source: "subdomain" | "custom_domain";
      organisation: {
        id: string;
        slug: string;
        name: string;
        branding?: PublicLoginBranding | null;
      };
    };

export async function loadPublicTenant(): Promise<PublicTenant | { kind: "unknown" }> {
  try {
    return await api<PublicTenant>("/api/v1/public/tenant", { orgId: null });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === "tenant_not_found")) {
      return { kind: "unknown" };
    }
    throw error;
  }
}

export function schoolOrigin(slug: string, platformDomain: string): string {
  const host = `${slug}.${platformDomain}`;
  const local = platformDomain === "localhost";
  if (typeof window === "undefined") {
    return local ? `http://${host}:3000` : `https://${host}`;
  }
  const protocol = window.location.protocol;
  const portPart = local && window.location.port ? `:${window.location.port}` : "";
  return `${protocol}//${host}${portPart}`;
}

export function membershipForHost(
  memberships: Membership[],
  tenant: PublicTenant | { kind: "unknown" },
): Membership | null {
  if (tenant.kind !== "school") return null;
  return (
    memberships.find(
      (membership) =>
        membership.status === "active" && membership.organisationId === tenant.organisation.id,
    ) ?? null
  );
}

export function switchSchoolLocation(slug: string, platformDomain: string, path: string): void {
  window.location.assign(`${schoolOrigin(slug, platformDomain)}${path}`);
}
