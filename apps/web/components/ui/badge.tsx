import type { ReactNode } from "react";
import { formatStatusLabel, statusTone, type StatusTone } from "@schoolapp/domain";

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="muted">—</span>;
  return <Badge tone={statusTone(status)}>{formatStatusLabel(status)}</Badge>;
}
