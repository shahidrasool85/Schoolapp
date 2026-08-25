"use client";

import { useEffect, useState } from "react";
import { DataTable, EmptyState, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Row = {
  id: string;
  exportKind: string;
  format: string;
  rowCount: number;
  snapshotVersion: number | null;
  createdAt: string;
};

export default function ExportHistoryPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ exports: Row[] }>("/api/v1/reports/exports")
      .then((result) => setRows(result.exports))
      .catch((err: Error) => setError(userFacingError(err, "Could not load export history.")));
  }, []);

  if (error) return <PageError title="Export history unavailable" description={error} />;
  if (!rows) return <LoadingState label="Loading exports…" />;

  return (
    <>
      <PageHeader
        title="Exports"
        description="Audit of statutory and report downloads. File contents are not stored in audit JSON."
        breadcrumbs={[{ href: "/school/reports", label: "Reports" }, { label: "Exports" }]}
      />
      {rows.length === 0 ? (
        <EmptyState title="No exports yet" description="CSV downloads from reports and census appear here." />
      ) : (
        <DataTable
          headers={
            <>
              <th>When</th>
              <th>Kind</th>
              <th>Format</th>
              <th>Rows</th>
              <th>Snapshot</th>
            </>
          }
        >
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.createdAt).toLocaleString("en-GB")}</td>
              <td>{row.exportKind}</td>
              <td><StatusBadge status={row.format} /></td>
              <td>{row.rowCount}</td>
              <td>{row.snapshotVersion ?? "—"}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
