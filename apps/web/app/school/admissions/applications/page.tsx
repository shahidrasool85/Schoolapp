"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";

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
  const [applications, setApplications] = useState<Application[]>([]);
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
    load().catch((err: Error) => setError(err.message));
  }, [query]);

  return (
    <>
      <div className="toolbar">
        <h1>Applications</h1>
        <Link href="/school/admissions/applications/new">
          <button type="button">+ New application</button>
        </Link>
      </div>
      <p className="muted">
        Public form submissions and staff-entered applications use the same admissions record.
        Use <Link href="/school/admissions/forms">Forms</Link> to share the school’s public application.
      </p>
      <div className="toolbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or reference" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
        </select>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Pupil</th>
            <th>Intake</th>
            <th>Year group</th>
            <th>Source</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {applications.map((row) => (
            <tr key={row.id}>
              <td><Link href={`/school/admissions/applications/${row.id}`}>{row.reference}</Link></td>
              <td>{row.pupilLegalName}</td>
              <td>{row.intendedAcademicYearName ?? "—"}</td>
              <td>{row.intendedYearGroupName ?? "—"}</td>
              <td>{row.publicFormName ?? row.source ?? "—"}</td>
              <td>{row.status.replaceAll("_", " ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
