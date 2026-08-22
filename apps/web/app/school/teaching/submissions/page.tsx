"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Row = {
  id: string;
  assignmentId: string;
  title: string;
  dueAt: string | null;
  workTypeName: string | null;
  subjectName: string | null;
  studentLegalName: string;
  status: string;
  submittedAt: string | null;
  marked: boolean;
};

export default function SubmissionsPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [error, setError] = useState("");

  async function load(query = "") {
    const body = await api<{ submissions: Row[] }>(`/api/v1/learning/submissions${query}`);
    setItems(body.submissions);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    const status = String(form.get("status") || "");
    if (status) params.set("status", status);
    const qs = params.toString();
    await load(qs ? `?${qs}` : "");
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Submissions / Marking</h1>
      <form className="toolbar" onSubmit={filter}>
        <label>
          Status
          <select name="status" defaultValue="">
            <option value="">All</option>
            <option value="submitted">Submitted</option>
            <option value="returned">Returned</option>
            <option value="resubmission_requested">Resubmission requested</option>
            <option value="completed">Completed</option>
            <option value="in_progress">In progress</option>
          </select>
        </label>
        <div><button type="submit">Filter</button></div>
      </form>
      {items.length === 0 ? <p className="muted">No submissions yet.</p> : (
        <table>
          <thead>
            <tr><th>Pupil</th><th>Assignment</th><th>Status</th><th>Submitted</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td>{row.studentLegalName}</td>
                <td>{row.title}</td>
                <td>{row.status}{row.marked ? " · marked" : ""}</td>
                <td>{row.submittedAt ? new Date(row.submittedAt).toLocaleString() : "—"}</td>
                <td><Link href={`/school/teaching/submissions/${row.id}`}>Mark</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
