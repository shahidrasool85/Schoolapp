"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Incident = {
  id: string;
  studentLegalName: string | null;
  occurredAt: string;
  categoryName: string | null;
  severity: string;
  status: string;
};

export default function BehaviourListPage() {
  const [items, setItems] = useState<Incident[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");

  function load(nextStatus = status, nextSeverity = severity) {
    const query = new URLSearchParams();
    if (nextStatus) query.set("status", nextStatus);
    if (nextSeverity) query.set("severity", nextSeverity);
    api<{ incidents: Incident[] }>(`/api/v1/behaviour/incidents${query.size ? `?${query}` : ""}`)
      .then((body) => setItems(body.incidents))
      .catch((err: Error) => setError(err.message));
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

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="toolbar">
        <h1>Behaviour</h1>
        <Link href="/school/pastoral/behaviour/new">Record incident</Link>
      </div>
      <form className="toolbar" onSubmit={onFilter}>
        <select name="status" defaultValue={status}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select name="severity" defaultValue={severity}>
          <option value="">All severities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <button type="submit">Filter</button>
      </form>
      {items.length === 0 ? <p>No incidents yet.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <Link className="card" href={`/school/pastoral/behaviour/${item.id}`} key={item.id}>
            <strong>{item.studentLegalName ?? "Pupil"}</strong>
            <span className="muted">
              {item.categoryName} · {item.severity} · {item.status}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
