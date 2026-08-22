"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Assessment = {
  id: string;
  title: string;
  status: string;
  subjectName: string | null;
  yearGroupName: string | null;
};

export default function ResultsIndexPage() {
  const [items, setItems] = useState<Assessment[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ assessments: Assessment[] }>("/api/v1/assessments")
      .then((body) => setItems(body.assessments.filter((row) => ["open", "completed", "reviewed"].includes(row.status))))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Results</h1>
      <p className="muted">Open an assessment to enter a class grid of scores, grades, and comments.</p>
      {items.length === 0 ? <p className="muted">No assessments are currently open for result entry.</p> : (
        <table>
          <thead>
            <tr><th>Assessment</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td>{row.title}<div className="muted">{row.subjectName} · {row.yearGroupName}</div></td>
                <td>{row.status}</td>
                <td><Link href={`/school/assessment/assessments/${row.id}/results`}>Enter results</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
