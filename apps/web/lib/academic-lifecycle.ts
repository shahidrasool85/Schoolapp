export type AcademicStatus = "active" | "archived";

export type AcademicLifecycle = {
  canDelete: boolean;
  canArchive: boolean;
  canRestore: boolean;
  reasons: string[];
  usage: Array<{ key: string; label: string; count: number }>;
};

export function includeArchivedQuery(showArchived: boolean): string {
  return showArchived ? "?includeArchived=true" : "";
}
