"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataTable, EmptyState, LoadingState, PageError, PageHeader } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type AssignedClass = {
  id: string;
  name: string;
  classType: string;
  yearGroupName: string | null;
  academicYearName: string | null;
  pupilCount: number;
};

export default function MyClassesPage() {
  const [classes, setClasses] = useState<AssignedClass[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ classes: AssignedClass[] }>("/api/v1/my-classes")
      .then((body) => setClasses(body.classes))
      .catch((err: unknown) => setError(userFacingError(err, "Could not load your classes.")));
  }, []);

  if (error) return <PageError title="Could not open My Classes" description={error} />;
  if (!classes) return <LoadingState label="Loading your classes…" />;

  return (
    <>
      <PageHeader
        title="My Classes"
        description="Classes you are assigned to. Open a class to see current pupils and their contact details."
      />
      {classes.length === 0 ? (
        <EmptyState
          title="No assigned classes"
          description="You will see classes here once you are assigned as a teacher or covering today’s lesson."
        />
      ) : (
        <DataTable
          headers={
            <>
              <th>Class</th>
              <th>Year group</th>
              <th>Year</th>
              <th>Pupils</th>
            </>
          }
        >
          {classes.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/school/my-classes/${row.id}`}>{row.name}</Link>
                <div className="muted">{row.classType}</div>
              </td>
              <td>{row.yearGroupName ?? "—"}</td>
              <td>{row.academicYearName ?? "—"}</td>
              <td>{row.pupilCount}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
