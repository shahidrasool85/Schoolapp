export type AcademicStatus = "active" | "archived";

export type AcademicLifecycle = {
  canDelete: boolean;
  canArchive: boolean;
  canRestore: boolean;
  reasons: string[];
  usage: Array<{ key: string; label: string; count: number }>;
  message?: string;
};

export function includeArchivedQuery(showArchived: boolean): string {
  return showArchived ? "?includeArchived=true" : "";
}

export function lifecycleConfirmDescription(
  mode: "delete" | "archive" | "restore",
  lifecycle: AcademicLifecycle,
  copies: { restore: string; unused: string; blocked: string },
): string {
  if (mode === "restore") return copies.restore;
  if (mode === "delete") return lifecycle.message || copies.unused;
  return lifecycle.message || copies.blocked;
}
