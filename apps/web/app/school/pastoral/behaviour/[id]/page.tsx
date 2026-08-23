"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../../lib/api";

type Detail = {
  incident: {
    id: string;
    studentLegalName: string | null;
    occurredAt: string;
    categoryName: string | null;
    locationName: string | null;
    description: string;
    severity: string;
    actionTaken: string | null;
    status: string;
    parentContactSummary: string | null;
  };
  actions: Array<{ id: string; categoryName: string | null; status: string; actionOn: string }>;
};

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  function load() {
    api<Detail>(`/api/v1/behaviour/incidents/${params.id}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, [params.id]);

  async function onStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/behaviour/incidents/${params.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: form.get("status") }),
    });
    load();
  }

  async function onContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/behaviour/incidents/${params.id}/parent-contact`, {
      method: "POST",
      body: JSON.stringify({ summary: form.get("summary") }),
    });
    event.currentTarget.reset();
    load();
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>{data.incident.studentLegalName}</h1>
      <p className="muted">
        {data.incident.categoryName} · {data.incident.severity} · {data.incident.status}
        {data.incident.locationName ? ` · ${data.incident.locationName}` : ""}
      </p>
      <p>{data.incident.description}</p>
      {data.incident.actionTaken ? <p>Action taken: {data.incident.actionTaken}</p> : null}
      <form className="toolbar" onSubmit={onStatus}>
        <select name="status" defaultValue={data.incident.status}>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <button type="submit">Update status</button>
      </form>
      <h2>Parent contact</h2>
      {data.incident.parentContactSummary ? <p>{data.incident.parentContactSummary}</p> : null}
      <form onSubmit={onContact}>
        <label>
          Public-safe summary
          <input name="summary" required maxLength={500} />
        </label>
        <button type="submit">Record parent contact</button>
      </form>
      <h2>Actions</h2>
      {data.actions.length === 0 ? <p className="muted">No actions recorded.</p> : (
        <ul>
          {data.actions.map((action) => (
            <li key={action.id}>
              {action.categoryName} · {action.status} · {action.actionOn}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
