"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  DataTable,
  EmptyState,
  FilterBar,
  LoadingState,
  PageError,
  PageHeader,
  SearchInput,
  StatusBadge,
} from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Issue = {
  ruleKey: string;
  severity: string;
  entityType: string;
  entityId: string | null;
  message: string;
  field: string | null;
  pupilName: string | null;
  fixPath: string | null;
};

type Payload = {
  asOf: string;
  counts: { errorCount: number; warningCount: number; informationCount: number };
  issues: Issue[];
};

export default function DataQualityPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    const result = await api<Payload>("/api/v1/statutory/data-quality");
    setData(result);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load data quality.")));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.issues.filter((issue) => {
      if (severity && issue.severity !== severity) return false;
      if (search && !`${issue.message} ${issue.pupilName ?? ""}`.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [data, severity, search]);

  async function revalidate() {
    setError("");
    setMessage("");
    try {
      await api("/api/v1/statutory/validate", { method: "POST" });
      await load();
      setMessage("Validation refreshed against live records.");
    } catch (err) {
      setError(userFacingError(err, "Could not re-run validation."));
    }
  }

  if (error && !data) return <PageError title="Data quality unavailable" description={error} />;
  if (!data) return <LoadingState label="Checking statutory data…" />;

  return (
    <>
      <PageHeader
        title="Data quality"
        description="Issues point at the canonical pupil or school record. Fix live data, then create a census snapshot."
        breadcrumbs={[
          { href: "/school/statutory", label: "Statutory data" },
          { label: "Data quality" },
        ]}
        actions={
          <button className="button" type="button" onClick={() => void revalidate()}>
            Re-run validation
          </button>
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}
      <div className="stat-grid">
        <div className="stat-card"><span>Errors</span><strong>{data.counts.errorCount}</strong></div>
        <div className="stat-card"><span>Warnings</span><strong>{data.counts.warningCount}</strong></div>
        <div className="stat-card"><span>Information</span><strong>{data.counts.informationCount}</strong></div>
      </div>
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search pupils or messages" />
        <label>
          Severity
          <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option value="">All</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="information">Information</option>
          </select>
        </label>
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title="No matching issues" description="Adjust filters or re-run validation after editing records." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Severity</th>
              <th>Category</th>
              <th>Record</th>
              <th>Issue</th>
              <th></th>
            </>
          }
        >
          {rows.map((issue, index) => (
            <tr key={`${issue.ruleKey}-${issue.entityId ?? "school"}-${index}`}>
              <td>
                <StatusBadge status={issue.severity} />
              </td>
              <td><Badge>{issue.entityType}</Badge></td>
              <td>{issue.pupilName ?? "School"}</td>
              <td>{issue.message}</td>
              <td>
                {issue.fixPath ? (
                  <Link href={issue.fixPath}>{issue.entityId ? "Open pupil" : "Open profile"}</Link>
                ) : null}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
