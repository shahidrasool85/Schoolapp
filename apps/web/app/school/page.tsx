"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Dashboard = {
  currentAcademicYear: { id: string; name: string; startsOn: string; endsOn: string } | null;
  counts: {
    students: number;
    staff: number;
    parents: number;
    classes: number;
    yearGroups: number;
    subjects: number;
  };
};

export default function SchoolDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Dashboard>("/api/v1/dashboard")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>Dashboard</h1>
      <p className="muted">
        Current academic year: {data.currentAcademicYear?.name ?? "not set"}
      </p>
      <div className="cards">
        <div className="card"><span>Students</span><strong>{data.counts.students}</strong></div>
        <div className="card"><span>Staff</span><strong>{data.counts.staff}</strong></div>
        <div className="card"><span>Parents</span><strong>{data.counts.parents}</strong></div>
        <div className="card"><span>Year groups</span><strong>{data.counts.yearGroups}</strong></div>
        <div className="card"><span>Classes</span><strong>{data.counts.classes}</strong></div>
        <div className="card"><span>Subjects</span><strong>{data.counts.subjects}</strong></div>
      </div>
      <div className="banner" style={{ marginTop: 16 }}>
        Phase 2 covers people and school structure. Attendance, homework, results, AI learning,
        and mobile apps are later phases.
      </div>
    </>
  );
}
