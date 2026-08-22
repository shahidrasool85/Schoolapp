"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "../../../../../../lib/api";

type Detail = {
  assignment: {
    title: string;
    description: string | null;
    dueAt: string | null;
    workTypeName: string | null;
    subjectName: string | null;
    createdByName: string | null;
    submission: { status: string; submittedAt: string | null };
    mark: { score: number | null; maximumMarks: number | null; feedback: string | null } | null;
    resources: Array<{ id: string; title: string; url: string | null }>;
  };
};

export default function ParentChildAssignmentPage() {
  const params = useParams<{ id: string; assignmentId: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    api<Detail>(`/api/v1/parent/children/${params.id}/assignments/${params.assignmentId}`)
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err instanceof ApiError && err.status === 404 ? "Not found." : err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.id, params.assignmentId]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;
  const a = data.assignment;

  return (
    <>
      <h1>{a.title}</h1>
      <p className="muted">
        {a.subjectName ?? a.workTypeName}
        {a.createdByName ? ` · ${a.createdByName}` : ""}
        {a.dueAt ? ` · due ${new Date(a.dueAt).toLocaleString()}` : ""}
      </p>
      <p>Status: {a.submission.status.replaceAll("_", " ")}</p>
      <h2>Instructions</h2>
      <p>{a.description || "No instructions."}</p>
      {a.resources.length > 0 ? (
        <>
          <h2>Resources</h2>
          <ul>
            {a.resources.map((resource) => (
              <li key={resource.id}>
                {resource.url ? <a href={resource.url}>{resource.title}</a> : resource.title}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {a.mark ? (
        <>
          <h2>Teacher feedback</h2>
          <p>
            {a.mark.score != null
              ? `Mark: ${a.mark.score}${a.mark.maximumMarks != null ? ` / ${a.mark.maximumMarks}` : ""}`
              : "Feedback available"}
          </p>
          <p>{a.mark.feedback || "No written comments."}</p>
        </>
      ) : (
        <p className="muted">Marks and written feedback appear here only after the teacher releases them to parents.</p>
      )}
    </>
  );
}
