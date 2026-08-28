import type { ReactNode } from "react";
import { IconEmpty } from "../icons";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <IconEmpty className="login-persona-icon" />
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function Alert({
  tone = "warning",
  children,
}: {
  tone?: "warning" | "danger" | "success" | "info";
  children: ReactNode;
}) {
  return (
    <div className={`alert alert-${tone}`} role="alert">
      {children}
    </div>
  );
}

export function InviteTokenAlert({
  token,
  href,
  kind = "invitation",
}: {
  token: string;
  href?: string;
  kind?: "invitation" | "activation";
}) {
  const path =
    href ??
    (kind === "activation"
      ? `/activate?token=${encodeURIComponent(token)}`
      : `/invite?token=${encodeURIComponent(token)}`);
  const label = kind === "activation" ? "Open activation link" : "Open invitation link";
  return (
    <Alert tone="info">
      <p>
        One-time {kind === "activation" ? "activation" : "invitation"} — open the link now. It will not be shown
        again.
      </p>
      <p>
        <a href={path}>{label}</a>
      </p>
      <code className="invite-token">{token}</code>
    </Alert>
  );
}

export function PageError({
  title = "Something went wrong",
  description,
  action,
}: {
  title?: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-error" role="alert">
      <h1>{title}</h1>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div className="skeleton" aria-hidden="true">
        <div className="skeleton-card" />
        <div className="skeleton-line" />
        <div className="skeleton-line" style={{ width: "60%" }} />
      </div>
      <p>{label}</p>
    </div>
  );
}

export function SkeletonBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className={index === 0 ? "skeleton-card" : "skeleton-line"} />
      ))}
    </div>
  );
}
