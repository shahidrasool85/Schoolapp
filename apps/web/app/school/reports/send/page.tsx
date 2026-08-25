"use client";

import { useEffect, useState } from "react";
import { Alert, DataTable, EmptyState, LoadingState, PageError, PageHeader } from "../../../../components/ui";
import { api, downloadAuthenticated } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Row = {
  studentProfileId: string;
  legalName: string;
  yearGroup: string | null;
  sendProvision: string | null;
  hasAdditionalNeedsRecord: boolean;
};

export default function SendReportPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ pupils: Row[] }>("/api/v1/reports/send")
      .then((result) => setRows(result.pupils))
      .catch((err: Error) => setError(userFacingError(err, "Could not load SEND report.")));
  }, []);

  if (error && !rows) return <PageError title="SEND report unavailable" description={error} />;
  if (!rows) return <LoadingState label="Loading SEND report…" />;

  return (
    <>
      <PageHeader
        title="SEND / additional needs"
        description="Statutory provision codes mapped from classified SEND data. Medical narrative is not exported."
        breadcrumbs={[{ href: "/school/reports", label: "Reports" }, { label: "SEND" }]}
        actions={
          <button
            className="button"
            type="button"
            onClick={() =>
              downloadAuthenticated("/api/v1/reports/send?format=csv", "send-additional-needs.csv").catch(
                (err: Error) => setError(userFacingError(err, "Could not download CSV.")),
              )
            }
          >
            Download CSV
          </button>
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {rows.length === 0 ? (
        <EmptyState title="No classified SEND records" description="Pupils with K or E provision, or operational notes awaiting classification, appear here." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Pupil</th>
              <th>Year</th>
              <th>Provision</th>
              <th>Additional needs record</th>
            </>
          }
        >
          {rows.map((row) => (
            <tr key={row.studentProfileId}>
              <td>{row.legalName}</td>
              <td>{row.yearGroup ?? "—"}</td>
              <td>{row.sendProvision ?? "Unclassified"}</td>
              <td>{row.hasAdditionalNeedsRecord ? "Yes" : "No"}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
