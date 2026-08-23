"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api";

type Detail = {
  concern: {
    studentLegalName: string | null;
    categoryName: string | null;
    status: string;
    factualDescription: string;
    immediateActionTaken: string | null;
    assignedSafeguardingLeadName: string | null;
  };
  chronology: Array<{
    id: string;
    occurredAt: string;
    entryType: string;
    factualNote: string;
    actionOutcome: string | null;
    actorName: string | null;
    superseded: boolean;
  }>;
};

export default function SafeguardingDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  function load() {
    api<Detail>(`/api/v1/safeguarding/concerns/${params.id}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, [params.id]);

  async function onChronology(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/safeguarding/concerns/${params.id}/chronology`, {
      method: "POST",
      body: JSON.stringify({
        occurredAt: new Date(String(form.get("occurredAt"))).toISOString(),
        entryType: form.get("entryType"),
        factualNote: form.get("factualNote"),
        actionOutcome: form.get("actionOutcome") || undefined,
      }),
    });
    event.currentTarget.reset();
    load();
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>Safeguarding · {data.concern.studentLegalName}</h1>
      <p className="muted">
        {data.concern.categoryName} · {data.concern.status}
        {data.concern.assignedSafeguardingLeadName ? ` · DSL ${data.concern.assignedSafeguardingLeadName}` : ""}
      </p>
      <p>{data.concern.factualDescription}</p>
      {data.concern.immediateActionTaken ? <p>Immediate action: {data.concern.immediateActionTaken}</p> : null}
      <h2>Chronology</h2>
      <ul>
        {data.chronology.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.entryType}</strong> · {new Date(entry.occurredAt).toLocaleString()}
            {entry.superseded ? " · superseded" : ""}
            <div>{entry.factualNote}</div>
            {entry.actionOutcome ? <div className="muted">{entry.actionOutcome}</div> : null}
            <div className="muted">{entry.actorName}</div>
          </li>
        ))}
      </ul>
      <form onSubmit={onChronology}>
        <label>
          Date / time
          <input name="occurredAt" type="datetime-local" required />
        </label>
        <label>
          Entry type
          <select name="entryType" required>
            <option value="note">Note</option>
            <option value="action">Action</option>
            <option value="decision">Decision</option>
            <option value="contact">Contact</option>
            <option value="review">Review</option>
            <option value="amendment">Amendment</option>
          </select>
        </label>
        <label>
          Factual note
          <textarea name="factualNote" required rows={4} />
        </label>
        <label>
          Action / outcome
          <textarea name="actionOutcome" rows={2} />
        </label>
        <button type="submit">Add chronology entry</button>
      </form>
    </>
  );
}
