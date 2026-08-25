"use client";

import { useEffect, useState } from "react";
import { Alert, DataTable, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../components/ui";
import { api, downloadAuthenticated } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Row = {
  studentProfileId: string;
  legalName: string;
  enrolmentStatus: string;
  yearGroup: string | null;
  dateOfAdmission: string | null;
  dateOfLeaving: string | null;
  leavingReason: string | null;
  previousSchool: string | null;
  admittedInPeriod: boolean;
  leftInPeriod: boolean;
};

export default function AdmissionsReportPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ pupils: Row[] }>("/api/v1/reports/admissions?from=2026-09-01&to=2027-07-31")
      .then((result) => setRows(result.pupils))
      .catch((err: Error) => setError(userFacingError(err, "Could not load admissions report.")));
  }, []);

  if (error && !rows) return <PageError title="Admissions report unavailable" description={error} />;
  if (!rows) return <LoadingState label="Loading admissions report…" />;

  return (
    <>
      <PageHeader
        title="Admissions / enrolment"
        description="Joiners and leavers from canonical pupil and enrolment dates."
        breadcrumbs={[{ href: "/school/reports", label: "Reports" }, { label: "Admissions" }]}
        actions={
          <button
            className="button"
            type="button"
            onClick={() =>
              downloadAuthenticated(
                "/api/v1/reports/admissions?from=2026-09-01&to=2027-07-31&format=csv",
                "admissions-enrolment.csv",
              ).catch((err: Error) => setError(userFacingError(err, "Could not download CSV.")))
            }
          >
            Download CSV
          </button>
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <DataTable
        headers={
          <>
            <th>Pupil</th>
            <th>Status</th>
            <th>Year</th>
            <th>Admitted</th>
            <th>Left</th>
            <th>Previous school</th>
          </>
        }
      >
        {rows.map((row) => (
          <tr key={row.studentProfileId}>
            <td>{row.legalName}</td>
            <td><StatusBadge status={row.enrolmentStatus} /></td>
            <td>{row.yearGroup ?? "—"}</td>
            <td>{row.dateOfAdmission ?? "—"}</td>
            <td>{row.dateOfLeaving ?? "—"}</td>
            <td>{row.previousSchool ?? "—"}</td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
