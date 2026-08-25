"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  Alert,
  DataTable,
  EmptyState,
  PageError,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { usePermissions } from "../../../../lib/use-permissions";

type CensusRun = {
  id: string;
  academicYearName: string | null;
  censusType: string;
  censusDate: string;
  status: string;
  currentSnapshotVersion: number;
  errorCount: number;
  warningCount: number;
};

type Year = { id: string; name: string; isCurrent?: boolean };

export default function CensusListPage() {
  const permissions = usePermissions();
  const [runs, setRuns] = useState<CensusRun[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const [census, academic] = await Promise.all([
      api<{ censusRuns: CensusRun[] }>("/api/v1/statutory/census"),
      api<{ academicYears: Year[] }>("/api/v1/academic-years"),
    ]);
    setRuns(census.censusRuns);
    setYears(academic.academicYears);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load census runs.")));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    try {
      const created = await api<{ censusRun: CensusRun }>("/api/v1/statutory/census", {
        method: "POST",
        body: JSON.stringify({
          academicYearId: form.get("academicYearId"),
          censusType: form.get("censusType"),
          censusDate: form.get("censusDate"),
        }),
      });
      formEl.reset();
      window.location.href = `/school/statutory/census/${created.censusRun.id}`;
    } catch (err) {
      setError(userFacingError(err, "Could not create census run."));
    }
  }

  if (error && runs.length === 0 && years.length === 0) {
    return <PageError title="Census unavailable" description={error} />;
  }

  return (
    <>
      <PageHeader
        title="School Census workspace"
        description="Create a snapshot of census-relevant values. Later live edits do not change an exported snapshot. This is not a live DfE submission."
        breadcrumbs={[
          { href: "/school/statutory", label: "Statutory data" },
          { label: "Census" },
        ]}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}
      {permissions.ready && permissions.has("statutory.census.create") ? (
      <SectionCard title="New census run" description="Choose the collection date. A snapshot is generated as a separate step.">
        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            Academic year
            <select
              name="academicYearId"
              required
              key={years.find((year) => year.isCurrent)?.id ?? years[0]?.id ?? "none"}
              defaultValue={years.find((year) => year.isCurrent)?.id ?? years[0]?.id}
            >
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Census type
            <select name="censusType" defaultValue="autumn">
              <option value="autumn">Autumn</option>
              <option value="spring">Spring</option>
              <option value="summer">Summer</option>
            </select>
          </label>
          <label>
            Census date
            <input name="censusDate" type="date" required defaultValue="2026-10-01" />
          </label>
          <button className="button" type="submit">
            Create draft
          </button>
        </form>
      </SectionCard>
      ) : permissions.ready ? (
        <Alert tone="info">You can inspect census runs. Creating a snapshot requires statutory.census.create.</Alert>
      ) : null}
      {runs.length === 0 ? (
        <EmptyState title="No census runs yet" description="Create a draft for the current academic year." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Date</th>
              <th>Type</th>
              <th>Year</th>
              <th>Status</th>
              <th>Version</th>
              <th>Errors</th>
              <th></th>
            </>
          }
        >
          {runs.map((run) => (
            <tr key={run.id}>
              <td>{String(run.censusDate).slice(0, 10)}</td>
              <td>{run.censusType}</td>
              <td>{run.academicYearName}</td>
              <td><StatusBadge status={run.status} /></td>
              <td>{run.currentSnapshotVersion}</td>
              <td>{run.errorCount}</td>
              <td><Link href={`/school/statutory/census/${run.id}`}>Open</Link></td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
