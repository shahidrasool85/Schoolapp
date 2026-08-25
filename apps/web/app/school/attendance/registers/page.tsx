"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataTable, EmptyState, LoadingState, PageError, PageHeader } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type ClassRow = { id: string; name: string; yearGroupName: string | null };

export default function AttendanceRegistersPage() {
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ classes: ClassRow[] }>("/api/v1/attendance/my-classes")
      .then((body) => setClasses(body.classes))
      .catch((err: Error) => setError(userFacingError(err, "Could not load your registers.")));
  }, []);

  if (error) return <PageError title="Registers unavailable" description={error} />;
  if (!classes) return <LoadingState label="Loading registers…" />;

  return (
    <>
      <PageHeader title="My registers" description="Select a class to take or review the AM/PM register." />
      {classes.length === 0 ? (
        <EmptyState title="No assigned classes" description="When a class is assigned to you, it will appear here." />
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
                <Link href={`/school/attendance/registers/${row.id}`}>Open</Link>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
