"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, StatusBadge } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

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
    let cancelled = false;
    setLoaded(false);
    setError("");
    setItems([]);
    api<{ assignments: PupilAssignment[] }>(`/api/v1/student/assignments${qs}`)
      .then((body) => {
        if (cancelled) return;
        setItems(body.assignments);
        setError("");
      })
      .catch((err: Error) => {
        if (!cancelled) setError(userFacingError(err, "Could not load your learning."));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bucket]);

  if (error) return <PageError title="Learning unavailable" description={error} />;
  if (!loaded) return <LoadingState label="Loading learning…" />;

  return (
    <>
      <PageHeader title={title} description="Assigned work, due dates, and feedback from your teachers." />
      {items.length === 0 ? (
        <EmptyState title="Nothing here yet" description="When your teacher assigns work, it will appear in this list." />
      ) : (
        <div className="stack">
          {items.map((row) => (
            <Link key={row.id} className="card" href={`/student/learning/assignments/${row.id}`}>
              <strong>{row.title}</strong>
              <p>
                {row.subjectName ?? row.workTypeName}
                {row.dueAt ? ` · due ${new Date(row.dueAt).toLocaleString()}` : ""}
              </p>
              <p className="muted">
                <StatusBadge status={row.submission.status} />
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
