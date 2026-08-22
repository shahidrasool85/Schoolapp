"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "../../../../../lib/api";

type Row = {
  id: string;
  title: string;
  dueAt: string | null;
  workTypeName: string | null;
  subjectName: string | null;
  parentStatus?: string;
  submission: { status: string };
  mark: { score: number | null; feedback: string | null } | null;
};

export default function ParentChildLearningPage() {
  const params = useParams<{ id: string }>();
  const [items, setItems] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    setLoaded(false);
    setError("");
    setItems([]);
    api<{ assignments: Row[] }>(`/api/v1/parent/children/${params.id}/assignments`)
      .then((body) => {
        if (cancelled) return;
        setItems(body.assignments);
        setError("");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err instanceof ApiError && err.status === 404 ? "Learning is not available." : err.message);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (error) return <p className="error">{error}</p>;
  if (!loaded) return <p>Loading…</p>;

  return (
    <>
      <h1>Learning</h1>
      <p className="muted">Assignments and homework for this child. Parents cannot submit work here.</p>
      {items.length === 0 ? <p className="muted">No assigned learning work yet.</p> : (
        <table>
          <thead>
            <tr><th>Work</th><th>Due</th><th>Status</th><th>Feedback</th></tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/parent/children/${params.id}/learning/${row.id}`}>{row.title}</Link>
                  <div className="muted">{row.subjectName ?? row.workTypeName}</div>
                </td>
                <td>{row.dueAt ? new Date(row.dueAt).toLocaleString() : "—"}</td>
                <td>{(row.parentStatus ?? row.submission.status).replaceAll("_", " ")}</td>
                <td>{row.mark ? (row.mark.score != null ? String(row.mark.score) : "Available") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
