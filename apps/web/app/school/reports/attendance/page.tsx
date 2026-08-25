"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Alert,
  DataTable,
  FilterBar,
  LoadingState,
  PageError,
  PageHeader,
} from "../../../../components/ui";
import { api, downloadAuthenticated } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Row = {
  studentProfileId: string;
  legalName: string;
  yearGroup: string | null;
  className: string | null;
  sessionsPossible: number;
  sessionsPresent: number;
  authorisedAbsence: number;
  unauthorisedAbsence: number;
  late: number;
  attendancePercentage: number | null;
};

export default function AttendanceReportPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [from, setFrom] = useState("2026-09-01");
  const [to, setTo] = useState("2026-09-12");
  const [error, setError] = useState("");

  async function load(range = { from, to }) {
    const result = await api<{ pupils: Row[] }>(
      `/api/v1/reports/attendance?from=${range.from}&to=${range.to}`,
    );
    setRows(result.pupils);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load attendance report.")));
  }, []);

  function onFilter(event: FormEvent) {
    event.preventDefault();
    load().catch((err: Error) => setError(userFacingError(err, "Could not load attendance report.")));
  }

  if (error && !rows) return <PageError title="Attendance report unavailable" description={error} />;
  if (!rows) return <LoadingState label="Summarising attendance…" />;

  return (
    <>
      <PageHeader
        title="Attendance summary"
        description="Uses existing registers. Sessions before admission or after leaving are excluded. Late counts as present."
        breadcrumbs={[{ href: "/school/reports", label: "Reports" }, { label: "Attendance" }]}
        actions={
          <button
            className="button"
            type="button"
            onClick={() =>
              downloadAuthenticated(
                `/api/v1/reports/attendance?from=${from}&to=${to}&format=csv`,
                "attendance-summary.csv",
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
            <th>Year</th>
            <th>Class</th>
            <th>Possible</th>
            <th>Present</th>
            <th>Auth.</th>
            <th>Unauth.</th>
            <th>Late</th>
            <th>%</th>
          </>
        }
      >
        {rows.map((row) => (
          <tr key={row.studentProfileId}>
            <td>{row.legalName}</td>
            <td>{row.yearGroup ?? "—"}</td>
            <td>{row.className ?? "—"}</td>
            <td>{row.sessionsPossible}</td>
            <td>{row.sessionsPresent}</td>
            <td>{row.authorisedAbsence}</td>
            <td>{row.unauthorisedAbsence}</td>
            <td>{row.late}</td>
            <td>{row.attendancePercentage ?? "—"}</td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
