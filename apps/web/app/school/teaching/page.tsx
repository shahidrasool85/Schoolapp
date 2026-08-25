"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Progress = {
  assignmentId: string;
  title: string;
  status: string;
  dueAt: string | null;
  workTypeName: string | null;
  subjectName: string | null;
  assigned: number;
  submitted: number;
  notSubmitted: number;
  marked: number;
  awaitingMarking: number;
};

export default function TeachingHomePage() {
  const [items, setItems] = useState<Progress[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ assignments: Progress[] }>("/api/v1/learning/dashboard")
      .then((body) => setItems(body.assignments))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>My Teaching</h1>
      <p className="muted">Create learning work, track submissions, and mark returned work.</p>
      <div className="stat-grid">
        <Link href="/school/teaching/assignments/new" className="stat-card">
          <span>Create work</span>
          <strong>New</strong>
        </Link>
        <Link href="/school/teaching/assignments" className="stat-card">
          <span>Assignments</span>
          <strong>{items.length}</strong>
        </Link>
        <Link href="/school/teaching/submissions" className="stat-card">
          <span>Submissions / Marking</span>
          <strong>Open</strong>
        </Link>
      </div>
      <h2>Progress</h2>
      {items.length === 0 ? <p className="muted">No published assignments yet.</p> : (
        <table>
          <thead>
            <tr>
              <th>Assignment</th>
              <th>Assigned</th>
              <th>Submitted</th>
              <th>Not submitted</th>
              <th>Marked</th>
              <th>Awaiting marking</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.assignmentId}>
                <td>
                  <Link href={`/school/teaching/assignments/${row.assignmentId}`}>{row.title}</Link>
                  <div className="muted">{row.subjectName ?? row.workTypeName} · {row.status}</div>
                </td>
                <td>{row.assigned}</td>
                <td>{row.submitted}</td>
                <td>{row.notSubmitted}</td>
                <td>{row.marked}</td>
                <td>{row.awaitingMarking}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
