"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../../lib/api";

type Result = {
  assessmentTitle: string | null;
  subjectName: string | null;
  assessmentDate: string | null;
  percentage: number | null;
  gradeLabel: string | null;
  teacherJudgement: string | null;
  comment: string | null;
};

type Progress = {
  subjectId: string;
  subjectName: string | null;
  latest?: { gradeLabel: string | null; percentage: number | null } | null;
  previous?: { gradeLabel: string | null; percentage: number | null } | null;
  trend?: { kind: string; delta: number | null; direction: string | null };
};

export default function ParentChildResultsPage() {
  const params = useParams<{ id: string }>();
  const [results, setResults] = useState<Result[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<{ results: Result[] }>(`/api/v1/parent/children/${params.id}/results`),
      api<{ progress: Progress[] }>(`/api/v1/parent/children/${params.id}/progress`),
    ])
      .then(([list, prog]) => {
        setResults(list.results);
        setProgress(prog.progress);
      })
      .catch((err: Error) => setError(err.message));
  }, [params.id]);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <p><Link href={`/parent/children/${params.id}`}>Back to child</Link></p>
      <h1>Released results</h1>
      {results.length === 0 ? <p className="muted">No released formal results yet.</p> : (
        <table>
          <thead>
            <tr><th>Assessment</th><th>Date</th><th>Result</th><th>Comment</th></tr>
          </thead>
          <tbody>
            {results.map((row, index) => (
              <tr key={`${row.assessmentTitle}-${index}`}>
                <td>{row.assessmentTitle}<div className="muted">{row.subjectName}</div></td>
                <td>{row.assessmentDate}</td>
                <td>{row.gradeLabel ?? row.teacherJudgement ?? (row.percentage != null ? `${row.percentage}%` : "—")}</td>
                <td>{row.comment ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Subject progress</h2>
      {progress.length === 0 ? <p className="muted">No released subject progress yet.</p> : (
        <table>
          <thead>
            <tr><th>Subject</th><th>Latest</th><th>Previous</th><th>Trend</th></tr>
          </thead>
          <tbody>
            {progress.map((row) => (
              <tr key={row.subjectId}>
                <td>{row.subjectName}</td>
                <td>{row.latest?.gradeLabel ?? (row.latest?.percentage != null ? `${row.latest.percentage}%` : "—")}</td>
                <td>{row.previous?.gradeLabel ?? (row.previous?.percentage != null ? `${row.previous.percentage}%` : "—")}</td>
                <td>{row.trend?.kind === "unavailable" ? "—" : `${row.trend?.direction ?? ""} ${row.trend?.delta ?? ""}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
