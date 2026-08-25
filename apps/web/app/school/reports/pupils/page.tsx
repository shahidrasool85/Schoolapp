"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Alert,
  DataTable,
  EmptyState,
  FilterBar,
  LoadingState,
  PageError,
  PageHeader,
  SearchInput,
  StatusBadge,
} from "../../../../components/ui";
import { api, downloadAuthenticated } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Row = {
  studentProfileId: string;
  legalName: string;
  admissionNumber: string | null;
  yearGroup: string | null;
  className: string | null;
  enrolmentStatus: string;
  dateOfAdmission: string | null;
  onRoll: boolean;
};

export default function PupilRollReportPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  async function load(q = search) {
    const result = await api<{ pupils: Row[] }>(`/api/v1/reports/pupils?q=${encodeURIComponent(q)}`);
    setRows(result.pupils);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load pupil roll.")));
  }, []);

  if (error && rows.length === 0) return <PageError title="Pupil roll unavailable" description={error} />;
  if (!error && rows.length === 0 && search === "") return <LoadingState label="Loading pupil roll…" />;

  return (
    <>
      <PageHeader
        title="Pupil roll"
        description="Canonical enrolments as of today. CSV download is audited."
        breadcrumbs={[{ href: "/school/reports", label: "Reports" }, { label: "Pupils" }]}
        actions={
          <button
            className="button"
            type="button"
            onClick={() =>
              downloadAuthenticated("/api/v1/reports/pupils?format=csv", "pupil-roll.csv").catch((err: Error) =>
                setError(userFacingError(err, "Could not download CSV.")),
              )
            }
          >
            Download CSV
          </button>
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <FilterBar
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        actions={<button className="button secondary" type="submit">Search</button>}
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Name or admission number" />
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title="No pupils match" />
      ) : (
        <DataTable
          headers={
            <>
              <th>Pupil</th>
              <th>Admission no.</th>
              <th>Year</th>
              <th>Class</th>
              <th>Status</th>
              <th>On roll</th>
            </>
          }
        >
          {rows.map((row) => (
            <tr key={row.studentProfileId}>
              <td><Link href={`/school/students/${row.studentProfileId}`}>{row.legalName}</Link></td>
              <td>{row.admissionNumber ?? "—"}</td>
              <td>{row.yearGroup ?? "—"}</td>
              <td>{row.className ?? "—"}</td>
              <td><StatusBadge status={row.enrolmentStatus} /></td>
              <td>{row.onRoll ? "Yes" : "No"}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
