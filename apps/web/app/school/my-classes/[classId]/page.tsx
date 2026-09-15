"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { DataTable, EmptyState, LoadingState, PageError, PageHeader } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type ClassDetail = {
  class: {
    id: string;
    name: string;
    classType: string;
    yearGroupName: string | null;
    academicYearName: string | null;
  };
  pupils: Array<{ studentProfileId: string; legalName: string }>;
};

export default function MyClassPage() {
  const params = useParams<{ classId: string }>();
  const [data, setData] = useState<ClassDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<ClassDetail>(`/api/v1/my-classes/${params.classId}`)
      .then(setData)
      .catch((err: unknown) => setError(userFacingError(err, "Could not load this class.")));
  }, [params.classId]);

  if (error) return <PageError title="Class not found" description={error} />;
  if (!data) return <LoadingState label="Loading class…" />;

  return (
    <>
      <PageHeader
        title={data.class.name}
        description={`${data.class.yearGroupName ?? "Year group"} · ${data.class.academicYearName ?? "Academic year"} · ${data.class.classType}`}
      />
      <p className="muted">
        <Link href="/school/my-classes">Back to My Classes</Link>
      </p>
      {data.pupils.length === 0 ? (
        <EmptyState title="No current pupils" description="There are no current members in this class." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Pupil</th>
            </>
          }
        >
          {data.pupils.map((pupil) => (
            <tr key={pupil.studentProfileId}>
              <td>
                <Link href={`/school/students/${pupil.studentProfileId}`}>{pupil.legalName}</Link>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
