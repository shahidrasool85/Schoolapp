export type NavHref = {
  pathname: string;
  query: Record<string, string>;
};

export function parseNavHref(href: string): NavHref {
  const queryIndex = href.indexOf("?");
  if (queryIndex === -1) return { pathname: href || "/", query: {} };
  const pathname = href.slice(0, queryIndex) || "/";
  const query: Record<string, string> = {};
  const params = new URLSearchParams(href.slice(queryIndex + 1));
  for (const [key, value] of params.entries()) {
    query[key] = value;
  }
  return { pathname, query };
}

export function navHrefSpecificity(href: string): number {
  const parsed = parseNavHref(href);
  return parsed.pathname.length * 10 + Object.keys(parsed.query).length;
}

function querySatisfied(required: Record<string, string>, search: string): boolean {
  if (Object.keys(required).length === 0) return true;
  const current = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return Object.entries(required).every(([key, value]) => current.get(key) === value);
}

export function navHrefMatches(
  pathname: string,
  search: string,
  href: string,
  exact = false,
): boolean {
  const target = parseNavHref(href);
  const pathMatches =
    pathname === target.pathname || (!exact && pathname.startsWith(`${target.pathname}/`));
  if (!pathMatches) return false;
  return querySatisfied(target.query, search);
}

/**
 * Active-nav matching for sidebar links.
 * A more specific sibling (longer path or extra query) wins so parent and child
 * are never highlighted together, and query folders such as `?folder=archived`
 * do not also mark the inbox item.
 */
export function isActiveNavHref(
  pathname: string,
  search: string,
  href: string,
  exact = false,
  siblingHrefs: string[] = [],
): boolean {
  if (!navHrefMatches(pathname, search, href, exact)) return false;
  const self = navHrefSpecificity(href);
  return !siblingHrefs.some((sibling) => {
    if (sibling === href) return false;
    if (!navHrefMatches(pathname, search, sibling, false)) return false;
    return navHrefSpecificity(sibling) > self;
  });
}

export function isNavSectionOpen(
  pathname: string,
  search: string,
  href: string,
  childHrefs: string[] = [],
): boolean {
  const target = parseNavHref(href);
  if (pathname === target.pathname || pathname.startsWith(`${target.pathname}/`)) return true;
  return childHrefs.some((child) => navHrefMatches(pathname, search, child, false));
}

const SCHOOL_WIDE_PUPIL_PERMISSIONS = [
  "students.profiles.read",
  "students.profiles.manage",
] as const;

/**
 * Presentation-only dashboard variant. Authorisation remains permission checks
 * on each API the dashboard calls; this only chooses which blocks to attempt.
 */
export function staffDashboardKind(
  permissions: readonly string[],
): "operational" | "teacher" {
  const set = new Set(permissions);
  const schoolWide = SCHOOL_WIDE_PUPIL_PERMISSIONS.some((key) => set.has(key));
  const assignedOnly = set.has("students.profiles.read_assigned") && !schoolWide;
  return assignedOnly ? "teacher" : "operational";
}

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

const SUCCESS_STATUSES = new Set([
  "accepted",
  "active",
  "complete",
  "completed",
  "confirmed",
  "enrolled",
  "marked",
  "paid",
  "present",
  "published",
  "ready",
  "released",
  "resolved",
  "success",
  "submitted",
  "waived",
  "exported",
]);

const WARNING_STATUSES = new Set([
  "assessment_pending",
  "awaiting_marking",
  "awaiting_review",
  "draft",
  "information_required",
  "in_progress",
  "late",
  "offer_pending",
  "pending",
  "review",
  "scheduled",
  "submitted_pending",
  "under_review",
  "waiting",
  "waiting_list",
  "validating",
  "superseded",
]);

const DANGER_STATUSES = new Set([
  "cancelled",
  "closed_unsuccessful",
  "failed",
  "overdue",
  "rejected",
  "unauthorised",
  "unpaid",
  "withdrawn",
]);

const INFO_STATUSES = new Set([
  "authorised",
  "made",
  "offer_made",
  "open",
  "processing",
  "reopened",
  "information",
]);

const NEUTRAL_STATUSES = new Set([
  "archived",
  "closed",
  "enquiry",
  "inactive",
  "not_marked",
]);

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  const key = status.trim().toLowerCase().replaceAll(" ", "_");
  if (SUCCESS_STATUSES.has(key)) return "success";
  if (DANGER_STATUSES.has(key)) return "danger";
  if (WARNING_STATUSES.has(key)) return "warning";
  if (INFO_STATUSES.has(key)) return "info";
  if (NEUTRAL_STATUSES.has(key)) return "neutral";
  if (key.includes("overdue") || key.includes("reject") || key.includes("cancel")) return "danger";
  if (key.includes("pending") || key.includes("wait") || key.includes("draft")) return "warning";
  if (key.includes("paid") || key.includes("publish") || key.includes("complete")) return "success";
  return "neutral";
}

export function formatStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  const spaced = status.replaceAll("_", " ").trim();
  if (!spaced) return status;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function hasAnyPermission(
  permissions: readonly string[],
  required: readonly string[],
): boolean {
  const set = new Set(permissions);
  return required.some((key) => set.has(key));
}

export function hasPermissionPrefix(permissions: readonly string[], prefix: string): boolean {
  return permissions.some((key) => key.startsWith(prefix));
}
