"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Assignment = {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  workTypeName: string | null;
  subjectName: string | null;
  progress: {
    assigned: number;
    submitted: number;
    notSubmitted: number;
    marked: number;
    awaitingMarking: number;
  };
};

type Context = {
  subjects: Array<{ id: string; name: string }>;
  classes: Array<{ id: string; name: string }>;
};

export default function AssignmentsPage() {
  const [items, setItems] = useState<Assignment[]>([]);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState("");

  async function load(query = "") {
    const [list, context] = await Promise.all([
      api<{ assignments: Assignment[] }>(`/api/v1/learning/assignments${query}`),
      api<Context>("/api/v1/learning/context"),
    ]);
    setItems(list.assignments);
    setCtx(context);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    const status = String(form.get("status") || "");
    const classId = String(form.get("classId") || "");
    const subjectId = String(form.get("subjectId") || "");
    if (status) params.set("status", status);
    if (classId) params.set("classId", classId);
    if (subjectId) params.set("subjectId", subjectId);
    const qs = params.toString();
    await load(qs ? `?${qs}` : "");
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="toolbar">
        <h1>Assignments</h1>
        <Link href="/school/teaching/assignments/new">Create work</Link>
      </div>
      <form className="toolbar" onSubmit={filter}>
        <label>
          Status
          <select name="status" defaultValue="">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="closed">Closed</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label>
          Class
          <select name="classId" defaultValue="">
            <option value="">All</option>
            {(ctx?.classes ?? []).map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
        <label>
          Subject
          <select name="subjectId" defaultValue="">
            <option value="">All</option>
            {(ctx?.subjects ?? []).map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
        <div><button type="submit">Filter</button></div>
      </form>
      {items.length === 0 ? <p className="muted">No assignments match these filters.</p> : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Status</th>
              <th>Due</th>
              <th>Assigned</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td><Link href={`/school/teaching/assignments/${row.id}`}>{row.title}</Link></td>
                <td>{row.workTypeName}{row.subjectName ? ` · ${row.subjectName}` : ""}</td>
                <td>{row.status}</td>
                <td>{row.dueAt ? new Date(row.dueAt).toLocaleString() : "—"}</td>
                <td>{row.progress.assigned}</td>
                <td>{row.progress.submitted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
