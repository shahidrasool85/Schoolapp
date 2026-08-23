"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Concern = {
  id: string;
  studentLegalName: string | null;
  concernOn: string;
  categoryName: string | null;
  priority: string;
  status: string;
  summary: string;
};

export default function PastoralConcernsPage() {
  const [items, setItems] = useState<Concern[]>([]);
  const [error, setError] = useState("");

  function load(status = "", priority = "") {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (priority) query.set("priority", priority);
    api<{ concerns: Concern[] }>(`/api/v1/pastoral/concerns${query.size ? `?${query}` : ""}`)
      .then((body) => setItems(body.concerns))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  function onFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    load(String(form.get("status") ?? ""), String(form.get("priority") ?? ""));
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="toolbar">
        <h1>Pastoral</h1>
        <Link href="/school/pastoral/concerns/new">Raise concern</Link>
      </div>
      <form className="toolbar" onSubmit={onFilter}>
        <select name="status">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="monitoring">Monitoring</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select name="priority">
          <option value="">All priorities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <button type="submit">Filter</button>
      </form>
      {items.length === 0 ? <p>No pastoral concerns yet.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <Link className="card" href={`/school/pastoral/concerns/${item.id}`} key={item.id}>
            <strong>{item.studentLegalName ?? "Pupil"}</strong>
            <span className="muted">
              {item.categoryName} · {item.priority} · {item.status}
            </span>
            <p>{item.summary}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
