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
  const [form, setForm] = useState({
    codeId: "",
    reason: "",
    note: "",
    lateMinutes: "",
  });

  useEffect(() => {
    let cancelled = false;
    setMark(null);
    setError("");
    setMessage("");
    setForm({ codeId: "", reason: "", note: "", lateMinutes: "" });
    Promise.all([
      api<{ mark: Mark }>(`/api/v1/attendance/marks/${params.id}`),
      api<{ codes: Code[] }>("/api/v1/attendance/codes"),
      api<{ revisions: Revision[] }>(`/api/v1/attendance/marks/${params.id}/revisions`).catch(() => ({ revisions: [] })),
    ])
      .then(([detail, codeBody, rev]) => {
        if (cancelled) return;
        setMark(detail.mark);
        setCodes(codeBody.codes);
        setRevisions(rev.revisions);
        setForm({
          codeId: detail.mark.codeId,
          reason: detail.mark.reason ?? "",
          note: detail.mark.note ?? "",
          lateMinutes: detail.mark.lateMinutes != null ? String(detail.mark.lateMinutes) : "",
        });
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mark) return;
    await api(`/api/v1/attendance/marks/${mark.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        codeId: form.codeId,
        reason: form.reason || null,
        note: form.note || null,
        lateMinutes: form.lateMinutes ? Number(form.lateMinutes) : null,
      }),
    });
    setMessage("Correction saved.");
    const [detail, rev] = await Promise.all([
      api<{ mark: Mark }>(`/api/v1/attendance/marks/${mark.id}`),
      api<{ revisions: Revision[] }>(`/api/v1/attendance/marks/${mark.id}/revisions`).catch(() => ({ revisions: [] })),
    ]);
    setMark(detail.mark);
    setRevisions(rev.revisions);
    setForm({
      codeId: detail.mark.codeId,
      reason: detail.mark.reason ?? "",
      note: detail.mark.note ?? "",
      lateMinutes: detail.mark.lateMinutes != null ? String(detail.mark.lateMinutes) : "",
    });
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
      <form key={mark.id} className="card form-grid" onSubmit={(event) => save(event).catch((err: Error) => setError(err.message))}>
        <label>
          Code
          <select
            name="codeId"
            value={form.codeId}
            onChange={(event) => setForm((current) => ({ ...current, codeId: event.target.value }))}
          >
            {codes.map((code) => <option key={code.id} value={code.id}>{code.name}</option>)}
          </select>
        </label>
        <label>
          Late minutes
          <input
            name="lateMinutes"
            type="number"
            min={0}
            max={180}
            value={form.lateMinutes}
            onChange={(event) => setForm((current) => ({ ...current, lateMinutes: event.target.value }))}
          />
        </label>
        <label>
          Reason
          <input
            name="reason"
            value={form.reason}
            onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
          />
        </label>
        <label>
          Internal note
          <textarea
            name="note"
            value={form.note}
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
          />
        </label>
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
