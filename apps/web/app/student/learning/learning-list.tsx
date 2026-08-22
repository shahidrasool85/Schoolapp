"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

export type PupilAssignment = {
  id: string;
  title: string;
  dueAt: string | null;
  workTypeName: string | null;
  subjectName: string | null;
  createdByName: string | null;
  buckets: string[];
  submission: { status: string; submittedAt: string | null };
  mark: { score: number | null; feedback: string | null } | null;
};

export function StudentLearningList({
  title,
  bucket,
}: {
  title: string;
  bucket?: string;
}) {
  const [items, setItems] = useState<PupilAssignment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const qs = bucket ? `?bucket=${bucket}` : "";
    setLoaded(false);
    setError("");
    setItems([]);
    api<{ assignments: PupilAssignment[] }>(`/api/v1/student/assignments${qs}`)
      .then((body) => {
        setItems(body.assignments);
        setError("");
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoaded(true));
  }, [bucket]);

  if (error) return <p className="error">{error}</p>;
  if (!loaded) return <p>Loading…</p>;

  return (
    <>
      <h1>{title}</h1>
      {items.length === 0 ? <p className="muted">Nothing here yet.</p> : (
        <div className="stack">
          {items.map((row) => (
            <Link key={row.id} className="card" href={`/student/learning/assignments/${row.id}`}>
              <strong>{row.title}</strong>
              <p>
                {row.subjectName ?? row.workTypeName}
                {row.dueAt ? ` · due ${new Date(row.dueAt).toLocaleString()}` : ""}
              </p>
              <p className="muted">{row.submission.status.replaceAll("_", " ")}</p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
