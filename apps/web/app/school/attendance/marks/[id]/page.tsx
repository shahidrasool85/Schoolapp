"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../../lib/api";

type Mark = {
  id: string;
  date: string;
  studentLegalName: string | null;
  codeId: string;
  codeName: string | null;
  reason: string | null;
  note: string | null;
  lateMinutes: number | null;
  recordedByName: string | null;
  lastCorrectedByName: string | null;
};
type Code = { id: string; name: string };
type Revision = {
  id: string;
  codeName: string;
  reason: string | null;
  recordedByName: string | null;
  supersededByName: string | null;
  supersededAt: string;
};

export default function AttendanceMarkPage() {
  const params = useParams<{ id: string }>();
  const [mark, setMark] = useState<Mark | null>(null);
  const [codes, setCodes] = useState<Code[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const [detail, codeBody, rev] = await Promise.all([
      api<{ mark: Mark }>(`/api/v1/attendance/marks/${params.id}`),
      api<{ codes: Code[] }>("/api/v1/attendance/codes"),
      api<{ revisions: Revision[] }>(`/api/v1/attendance/marks/${params.id}/revisions`).catch(() => ({ revisions: [] })),
    ]);
    setMark(detail.mark);
    setCodes(codeBody.codes);
    setRevisions(rev.revisions);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.id]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/attendance/marks/${params.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        codeId: form.get("codeId"),
        reason: form.get("reason") || null,
        note: form.get("note") || null,
        lateMinutes: form.get("lateMinutes") ? Number(form.get("lateMinutes")) : null,
      }),
    });
    setMessage("Correction saved.");
    await load();
  }

  if (error) return <p className="error">{error}</p>;
  if (!mark) return <p>Loading…</p>;

  return (
    <>
      <h1>Correct attendance</h1>
      <p className="muted">
        {mark.studentLegalName} · {mark.date} · {mark.codeName}
      </p>
      <p className="muted">
        Recorded by {mark.recordedByName ?? "—"}
        {mark.lastCorrectedByName ? ` · last corrected by ${mark.lastCorrectedByName}` : ""}
      </p>
      <form className="card form-grid" onSubmit={save}>
        <label>
          Code
          <select name="codeId" defaultValue={mark.codeId}>
            {codes.map((code) => <option key={code.id} value={code.id}>{code.name}</option>)}
          </select>
        </label>
        <label>Late minutes<input name="lateMinutes" type="number" min={0} max={180} defaultValue={mark.lateMinutes ?? ""} /></label>
        <label>Reason<input name="reason" defaultValue={mark.reason ?? ""} /></label>
        <label>Internal note<textarea name="note" defaultValue={mark.note ?? ""} /></label>
        <div><button type="submit">Save correction</button></div>
      </form>
      {message ? <p>{message}</p> : null}
      <h2>History</h2>
      <table>
        <thead>
          <tr><th>Previous mark</th><th>Reason</th><th>Recorded by</th><th>Superseded by</th><th>When</th></tr>
        </thead>
        <tbody>
          {revisions.map((row) => (
            <tr key={row.id}>
              <td>{row.codeName}</td>
              <td>{row.reason ?? "—"}</td>
              <td>{row.recordedByName ?? "—"}</td>
              <td>{row.supersededByName ?? "—"}</td>
              <td>{row.supersededAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
