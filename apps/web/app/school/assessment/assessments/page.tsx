"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Assessment = {
  id: string;
  title: string;
  status: string;
  assessmentDate: string;
  subjectName: string | null;
  yearGroupName: string | null;
  assessmentTypeName: string | null;
};

type Context = {
  subjects: Array<{ id: string; name: string }>;
  yearGroups: Array<{ id: string; name: string }>;
  classes: Array<{ id: string; name: string }>;
};

export default function AssessmentsListPage() {
  const [items, setItems] = useState<Assessment[]>([]);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState("");

  async function load(query = "") {
    const [list, context] = await Promise.all([
      api<{ assessments: Assessment[] }>(`/api/v1/assessments${query}`),
      api<Context>("/api/v1/assessments/context"),
    ]);
    setItems(list.assessments);
    setCtx(context);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const key of ["status", "classId", "subjectId", "yearGroupId"]) {
      const value = String(form.get(key) || "");
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    await load(qs ? `?${qs}` : "");
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="toolbar">
        <h1>Assessments</h1>
        <Link href="/school/assessment/assessments/new">Create assessment</Link>
      </div>
      <form className="toolbar" onSubmit={filter}>
        <label>
          Status
          <select name="status" defaultValue="">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="open">Open</option>
            <option value="completed">Completed</option>
            <option value="reviewed">Reviewed</option>
            <option value="published">Published</option>
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
        <label>
          Year group
          <select name="yearGroupId" defaultValue="">
            <option value="">All</option>
            {(ctx?.yearGroups ?? []).map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
        <div><button type="submit">Filter</button></div>
      </form>
      {items.length === 0 ? <p className="muted">No assessments match these filters.</p> : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td><Link href={`/school/assessment/assessments/${row.id}`}>{row.title}</Link></td>
                <td>{row.assessmentTypeName}{row.subjectName ? ` · ${row.subjectName}` : ""}{row.yearGroupName ? ` · ${row.yearGroupName}` : ""}</td>
                <td>{row.assessmentDate}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
