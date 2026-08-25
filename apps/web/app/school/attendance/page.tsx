"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataTable, EmptyState, LoadingState, PageError, PageHeader, StatCard } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type ClassRow = {
  id: string;
  name: string;
  yearGroupName: string | null;
};

export default function AttendanceHomePage() {
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
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
      .catch((err: Error) => setError(userFacingError(err, "Could not load attendance.")));
  }, []);

  if (error) return <PageError title="Attendance unavailable" description={error} />;
  if (!classes) return <LoadingState label="Loading registers…" />;

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Take today’s register for assigned classes, or review school-wide marks."
      />
      <div className="stat-grid">
        <StatCard label="My registers" value={classes.length} href="/school/attendance/registers" />
        {canSchool ? <StatCard label="School attendance" value="Open" href="/school/attendance/school" /> : null}
      </div>
      <h2>My classes</h2>
      {classes.length === 0 ? (
        <EmptyState title="No assigned classes" description="Classes assigned to you for this date will appear here." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Class</th>
              <th>Year group</th>
              <th></th>
            </>
          }
        >
          {classes.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{row.yearGroupName ?? "—"}</td>
              <td>
                <Link href={`/school/attendance/registers/${row.id}`}>Open register</Link>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
