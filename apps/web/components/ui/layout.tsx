import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
}: {
  title: string;
  description?: ReactNode;
  breadcrumbs?: Array<{ href?: string; label: string }>;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb">
            <ol className="breadcrumbs">
              {breadcrumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`}>
                  {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : crumb.label}
                  {index < breadcrumbs.length - 1 ? " / " : null}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}

export function Card({
  children,
  className = "",
  href,
}: {
  children: ReactNode;
  className?: string;
  href?: string;
}) {
  if (href) {
    return (
      <Link className={`card ${className}`.trim()} href={href}>
        {children}
      </Link>
    );
  }
  return <section className={`card ${className}`.trim()}>{children}</section>;
}

export function StatCard({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: ReactNode;
  href?: string;
  hint?: string;
}) {
  const body = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <p className="muted">{hint}</p> : null}
    </>
  );
  if (href) {
    return (
      <Link className="stat-card" href={href}>
        {body}
      </Link>
    );
  }
  return <div className="stat-card">{body}</div>;
}

export function SectionCard({
  id,
  title,
  description,
  actions,
  children,
}: {
  id?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="section-card">
      {title || actions ? (
        <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
          <div>
            {title ? <h2 style={{ margin: 0 }}>{title}</h2> : null}
            {description ? <p className="muted">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
