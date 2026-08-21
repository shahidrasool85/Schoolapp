"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Attendance = {
  summary: {
    sessionsPossible: number;
    sessionsPresent: number;
    authorisedAbsence: number;
    unauthorisedAbsence: number;
    late: number;
    attendancePercentage: number | null;
  };
  marks: Array<{
    id: string;
    date: string;
    sessionName: string;
    codeName: string;
    lateMinutes: number | null;
  }>;
};

export default function StudentAttendancePage() {
  const [data, setData] = useState<Attendance | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Attendance>("/api/v1/student/attendance")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>My attendance</h1>
      <div className="cards">
        <div className="card">
          <span>Attendance</span>
          <strong>
            {data.summary.attendancePercentage ?? "—"}
            {data.summary.attendancePercentage != null ? "%" : ""}
          </strong>
        </div>
        <div className="card"><span>Present</span><strong>{data.summary.sessionsPresent}</strong></div>
        <div className="card"><span>Possible</span><strong>{data.summary.sessionsPossible}</strong></div>
      </div>
      <table>
        <thead>
          <tr><th>Date</th><th>Session</th><th>Mark</th></tr>
        </thead>
        <tbody>
          {data.marks.map((row) => (
            <tr key={row.id}>
              <td>{row.date}</td>
              <td>{row.sessionName}</td>
              <td>{row.codeName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
