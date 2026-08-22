"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

type ClassRow = {
  id: string;
  name: string;
  yearGroupName: string | null;
};

export default function AttendanceHomePage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [error, setError] = useState("");
  const [canSchool, setCanSchool] = useState(false);

  useEffect(() => {
    Promise.all([
      api<{ permissions: string[] }>("/api/v1/me"),
      api<{ classes: ClassRow[] }>("/api/v1/attendance/my-classes"),
    ])
      .then(([me, body]) => {
        setCanSchool(
          me.permissions.some((key) =>
            ["attendance.record.read", "attendance.record.manage", "attendance.record.correct"].includes(key),
          ),
        );
        setClasses(body.classes);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Attendance</h1>
      <p className="muted">Take today’s register for assigned classes, or review school-wide marks.</p>
      <div className="cards">
        <Link href="/school/attendance/registers" className="card">
          <span>My registers</span>
          <strong>{classes.length}</strong>
        </Link>
        {canSchool ? (
          <Link href="/school/attendance/school" className="card">
            <span>School attendance</span>
            <strong>View</strong>
          </Link>
        ) : null}
      </div>
      <h2>My classes</h2>
      {classes.length === 0 ? <p className="muted">No assigned classes for this date.</p> : (
        <table>
          <thead>
            <tr><th>Class</th><th>Year group</th><th></th></tr>
          </thead>
          <tbody>
            {classes.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.yearGroupName ?? "—"}</td>
                <td><Link href={`/school/attendance/registers/${row.id}`}>Open register</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
