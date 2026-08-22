"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Report = {
  id: string;
  studentLegalName: string | null;
  reportingPeriodName: string | null;
  status: string;
};

export default function ReportsListPage() {
  const [items, setItems] = useState<Report[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ reports: Report[] }>("/api/v1/reports")
      .then((body) => setItems(body.reports))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="toolbar">
        <h1>Reports</h1>
        <Link href="/school/assessment/reports/new">Create report</Link>
      </div>
      {items.length === 0 ? <p className="muted">No progress reports yet.</p> : (
        <table>
          <thead>
            <tr><th>Pupil</th><th>Period</th><th>Status</th></tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td><Link href={`/school/assessment/reports/${row.id}`}>{row.studentLegalName}</Link></td>
                <td>{row.reportingPeriodName}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
