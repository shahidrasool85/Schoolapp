import { safeRelativeNext } from "@schoolapp/domain";

export { safeRelativeNext };

export function tenantLoginPath(next?: string | string[]): string {
  const safe = safeRelativeNext(next);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}
