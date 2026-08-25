"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, FilterBar, PageError, PageHeader, SearchInput, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Application = {
  id: string;
  reference: string;
  status: string;
  pupilLegalName: string;
  intendedYearGroupName: string | null;
  intendedAcademicYearName: string | null;
  applicationDate: string | null;
  source: string | null;
  publicFormName?: string | null;
};

const STATUSES = [
  "enquiry", "draft", "submitted", "under_review", "information_required",
  "assessment_pending", "assessment_completed", "waiting_list", "offer_pending",
  "offer_made", "accepted", "deferred", "rejected", "withdrawn", "enrolled",
];

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [status, q]);

  async function load() {
    const list = await api<{ applications: Application[] }>(`/api/v1/admissions/applications${query}`);
    setApplications(list.applications);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setStatus(params.get("status") ?? "");
  }, []);

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load applications.")));
  }, [query]);

  return (
    <>
      <PageHeader
        title="Applications"
        description="Public form submissions and staff-entered applications use the same admissions record."
        breadcrumbs={[
          { href: "/school/admissions", label: "Admissions" },
          { label: "Applications" },
        ]}
        actions={
          <Link className="button" href="/school/admissions/applications/new">
            New application
          </Link>
        }
      />
      <FilterBar>
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Search name or reference"
          label="Search"
        />
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </FilterBar>
      {error ? <PageError description={error} /> : null}
      {applications && applications.length === 0 ? (
        <EmptyState
          title="No applications match"
          description="Try another status or search, or record a new application."
          action={<Link href="/school/admissions/applications/new">New application</Link>}
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Pupil</th>
                <th>Date</th>
                <th>Year group</th>
                <th>Source</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(applications ?? []).map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link href={`/school/admissions/applications/${row.id}`}>{row.reference}</Link>
                  </td>
                  <td>{row.pupilLegalName}</td>
                  <td>{row.applicationDate ?? row.intendedAcademicYearName ?? "—"}</td>
                  <td>{row.intendedYearGroupName ?? "—"}</td>
                  <td>{row.publicFormName ?? row.source ?? "—"}</td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
