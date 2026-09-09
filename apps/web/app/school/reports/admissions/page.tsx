"use client";

import { FormEvent, useEffect, useState } from "react";
import { Alert, DataTable, FilterBar, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../components/ui";
import { api, downloadAuthenticated } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { formatDate } from "../../../../lib/dates";

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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");

  async function load(range?: { from: string; to: string }) {
    const query = range?.from && range.to ? `from=${range.from}&to=${range.to}` : "";
    const result = await api<{ pupils: Row[]; from: string; to: string }>(
      `/api/v1/reports/admissions${query ? `?${query}` : ""}`,
    );
    setRows(result.pupils);
    setFrom(result.from);
    setTo(result.to);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load admissions report.")));
  }, []);

  function onFilter(event: FormEvent) {
    event.preventDefault();
    load({ from, to }).catch((err: Error) => setError(userFacingError(err, "Could not load admissions report.")));
  }

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
                `/api/v1/reports/admissions?from=${from}&to=${to}&format=csv`,
                "admissions-enrolment.csv",
              ).catch((err: Error) => setError(userFacingError(err, "Could not download CSV.")))
            }
          >
            Download CSV
          </button>
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <FilterBar onSubmit={onFilter} actions={<button className="button secondary" type="submit">Apply</button>}>
        <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </FilterBar>
      <DataTable
        headers={
          <>
            <th>Pupil</th>
            <th>Status</th>
            <th>Year</th>
            <th>Admitted</th>
            <th>Left</th>
            <th>Joiner in period</th>
            <th>Leaver in period</th>
            <th>Previous school</th>
          </>
        }
      >
        {rows.map((row) => (
          <tr key={row.studentProfileId}>
            <td>{row.legalName}</td>
            <td><StatusBadge status={row.enrolmentStatus} /></td>
            <td>{row.yearGroup ?? "—"}</td>
            <td>{formatDate(row.dateOfAdmission) || "—"}</td>
            <td>{formatDate(row.dateOfLeaving) || "—"}</td>
            <td>{row.admittedInPeriod ? "Yes" : "No"}</td>
            <td>{row.leftInPeriod ? "Yes" : "No"}</td>
            <td>{row.previousSchool ?? "—"}</td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
