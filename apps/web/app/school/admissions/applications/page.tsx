"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";

type Application = {
  id: string;
  reference: string;
  status: string;
  pupilLegalName: string;
  intendedYearGroupName: string | null;
  intendedAcademicYearName: string | null;
  applicationDate: string | null;
};

type Option = { id: string; name: string };

const STATUSES = [
  "enquiry", "draft", "submitted", "under_review", "information_required",
  "assessment_pending", "assessment_completed", "waiting_list", "offer_pending",
  "offer_made", "accepted", "deferred", "rejected", "withdrawn", "enrolled",
];

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [years, setYears] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [status, q]);

  async function load() {
    const [list, yr, yg] = await Promise.all([
      api<{ applications: Application[] }>(`/api/v1/admissions/applications${query}`),
      api<{ academicYears: Option[] }>("/api/v1/academic-years"),
      api<{ yearGroups: Option[] }>("/api/v1/year-groups"),
    ]);
    setApplications(list.applications);
    setYears(yr.academicYears);
    setGroups(yg.yearGroups);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setStatus(params.get("status") ?? "");
  }, []);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [query]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/v1/admissions/applications", {
        method: "POST",
        body: JSON.stringify({
          pupilLegalName: form.get("pupilLegalName"),
          dateOfBirth: form.get("dateOfBirth") || undefined,
          intendedAcademicYearId: form.get("intendedAcademicYearId") || undefined,
          intendedYearGroupId: form.get("intendedYearGroupId") || undefined,
          previousSchool: form.get("previousSchool") || undefined,
          contacts: form.get("guardianFullName")
            ? [{
                fullName: form.get("guardianFullName"),
                email: form.get("guardianEmail") || undefined,
                telephone: form.get("guardianTelephone") || undefined,
                relationship: form.get("relationship") || "other",
                isPrimary: true,
                hasParentalResponsibility: true,
              }]
            : undefined,
        }),
      });
      event.currentTarget.reset();
      setMessage("Application created.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create application");
    }
  }

  return (
    <>
      <div className="toolbar">
        <h1>Applications</h1>
      </div>
      <form className="card form-grid" onSubmit={onSubmit}>
        <label>Pupil name<input name="pupilLegalName" required /></label>
        <label>Date of birth<input name="dateOfBirth" type="date" /></label>
        <label>
          Academic year
          <select name="intendedAcademicYearId">
            <option value="">Select</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </label>
        <label>
          Year group
          <select name="intendedYearGroupId">
            <option value="">Select</option>
            {groups.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </label>
        <label>Previous / current school<input name="previousSchool" /></label>
        <label>Parent / guardian name<input name="guardianFullName" /></label>
        <label>Email<input name="guardianEmail" type="email" /></label>
        <label>Telephone<input name="guardianTelephone" /></label>
        <div><button type="submit">Add application</button></div>
      </form>
      <div className="toolbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or reference" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
        </select>
      </div>
      {message ? <p>{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Pupil</th>
            <th>Intake</th>
            <th>Year group</th>
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
              <td>{row.status.replaceAll("_", " ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
