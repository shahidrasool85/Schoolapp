"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type ClassRow = { id: string; name: string; yearGroupName: string | null };

export default function AttendanceRegistersPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ classes: ClassRow[] }>("/api/v1/attendance/my-classes")
      .then((body) => setClasses(body.classes))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>My registers</h1>
      <p className="muted">Select a class to take or review the AM/PM register.</p>
      <table>
        <thead>
          <tr><th>Class</th><th>Year group</th><th></th></tr>
        </thead>
        <tbody>
          {classes.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{row.yearGroupName ?? "—"}</td>
              <td><Link href={`/school/attendance/registers/${row.id}`}>Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
