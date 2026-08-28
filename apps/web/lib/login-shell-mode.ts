import type { PublicTenant } from "./tenant";

export type LoginHostKind = "platform" | "school" | "unknown";
export type LoginShellMode = "school" | "platform" | "loading" | "unknown";

/**
 * Maps SSR hostname classification plus the public tenant lookup to a login shell.
 * Unknown production subdomains stay unknown (not platform).
 */
export function loginShellMode(
  tenant: PublicTenant | { kind: "unknown" } | null,
  initialHostKind: LoginHostKind,
): LoginShellMode {
  if (tenant?.kind === "unknown" || (tenant === null && initialHostKind === "unknown")) {
    return "unknown";
  }
  if (tenant?.kind === "school") return "school";
  if (tenant === null && initialHostKind === "school") return "loading";
  return "platform";
}
