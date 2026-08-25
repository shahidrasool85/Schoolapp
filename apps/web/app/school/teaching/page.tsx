"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataTable, EmptyState, LoadingState, PageError, PageHeader, StatCard, StatusBadge } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

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
  const [items, setItems] = useState<Progress[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ assignments: Progress[] }>("/api/v1/learning/dashboard")
      .then((body) => setItems(body.assignments))
      .catch((err: Error) => setError(userFacingError(err, "Could not load teaching progress.")));
  }, []);

  if (error) return <PageError title="Teaching unavailable" description={error} />;
  if (!items) return <LoadingState label="Loading teaching…" />;

  const awaiting = items.reduce((sum, row) => sum + row.awaitingMarking, 0);

  return (
    <>
      <PageHeader
        title="My Teaching"
        description="Create learning work, track submissions, and mark returned work."
        actions={
          <Link className="button" href="/school/teaching/assignments/new">
            Create work
          </Link>
        }
      />
      <div className="stat-grid">
        <StatCard label="Assignments" value={items.length} href="/school/teaching/assignments" />
        <StatCard label="Awaiting marking" value={awaiting} href="/school/teaching/submissions" />
      </div>
      <h2>Progress</h2>
      {items.length === 0 ? (
        <EmptyState
          title="No published assignments yet"
          description="Create learning work for your classes to start tracking submissions."
          action={<Link href="/school/teaching/assignments/new">Create work</Link>}
        />
      ) : (
        <DataTable
          headers={
            <>
              <th>Assignment</th>
              <th>Assigned</th>
              <th>Submitted</th>
              <th>Not submitted</th>
              <th>Marked</th>
              <th>Awaiting marking</th>
            </>
          }
        >
          {items.map((row) => (
            <tr key={row.assignmentId}>
              <td>
                <Link href={`/school/teaching/assignments/${row.assignmentId}`}>{row.title}</Link>
                <div className="muted">
                  {row.subjectName ?? row.workTypeName} · <StatusBadge status={row.status} />
                </div>
              </td>
              <td>{row.assigned}</td>
              <td>{row.submitted}</td>
              <td>{row.notSubmitted}</td>
              <td>{row.marked}</td>
              <td>{row.awaitingMarking}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
