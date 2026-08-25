"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { EmptyState, FilterBar, PageError, PageHeader, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Incident = {
  id: string;
  studentLegalName: string | null;
  occurredAt: string;
  categoryName: string | null;
  severity: string;
  status: string;
};

export default function BehaviourListPage() {
  const [items, setItems] = useState<Incident[] | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");

  function load(nextStatus = status, nextSeverity = severity) {
    const query = new URLSearchParams();
    if (nextStatus) query.set("status", nextStatus);
    if (nextSeverity) query.set("severity", nextSeverity);
    api<{ incidents: Incident[] }>(`/api/v1/behaviour/incidents${query.size ? `?${query}` : ""}`)
      .then((body) => setItems(body.incidents))
      .catch((err: Error) => setError(userFacingError(err, "Could not load behaviour records.")));
  }

  useEffect(() => {
    load();
  }, []);

  function onFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextStatus = String(form.get("status") ?? "");
    const nextSeverity = String(form.get("severity") ?? "");
    setStatus(nextStatus);
    setSeverity(nextSeverity);
    load(nextStatus, nextSeverity);
  }

  if (error) return <PageError title="Behaviour unavailable" description={error} />;

  return (
    <>
      <PageHeader
        title="Behaviour"
        description="Incidents, actions, and follow-up. Safeguarding concerns stay in the restricted safeguarding area."
        actions={
          <Link className="button" href="/school/pastoral/behaviour/new">
            Record incident
          </Link>
        }
      />
      <FilterBar onSubmit={onFilter} actions={<button type="submit">Filter</button>}>
        <label htmlFor="behaviour-status">
          Status
          <select id="behaviour-status" name="status" defaultValue={status}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label htmlFor="behaviour-severity">
          Severity
          <select id="behaviour-severity" name="severity" defaultValue={severity}>
            <option value="">All severities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      </FilterBar>
      {items && items.length === 0 ? (
        <EmptyState title="No incidents yet" description="Recorded incidents for pupils you can access will appear here." />
      ) : null}
      <div className="cards">
        {(items ?? []).map((item) => (
          <Link className="card" href={`/school/pastoral/behaviour/${item.id}`} key={item.id}>
            <strong>{item.studentLegalName ?? "Pupil"}</strong>
            <span className="muted">
              {item.categoryName} · <StatusBadge status={item.severity} /> · <StatusBadge status={item.status} />
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
