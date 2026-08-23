"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";

type Enquiry = {
  id: string;
  reference: string;
  status: string;
  pupilLegalName: string;
  dateOfBirth: string | null;
  intendedYearGroupName: string | null;
  guardianFullName: string;
  guardianEmail: string | null;
  enquiryDate: string;
};

type Option = { id: string; name: string };

export default function EnquiriesPage() {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setStatus(params.get("status") ?? "");
  }, []);

  async function load() {
    const [list, yr, yg] = await Promise.all([
      api<{ enquiries: Enquiry[] }>(`/api/v1/admissions/enquiries${query}`),
      api<{ academicYears: Option[] }>("/api/v1/academic-years"),
      api<{ yearGroups: Option[] }>("/api/v1/year-groups"),
    ]);
    setEnquiries(list.enquiries);
    setYears(yr.academicYears);
    setGroups(yg.yearGroups);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [query]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/v1/admissions/enquiries", {
        method: "POST",
        body: JSON.stringify({
          pupilLegalName: form.get("pupilLegalName"),
          dateOfBirth: form.get("dateOfBirth") || undefined,
          intendedAcademicYearId: form.get("intendedAcademicYearId") || undefined,
          intendedYearGroupId: form.get("intendedYearGroupId") || undefined,
          guardianFullName: form.get("guardianFullName"),
          guardianEmail: form.get("guardianEmail") || undefined,
          guardianTelephone: form.get("guardianTelephone") || undefined,
          source: form.get("source") || undefined,
          notes: form.get("notes") || undefined,
        }),
      });
      event.currentTarget.reset();
      setMessage("Enquiry recorded.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create enquiry");
    }
  }

  return (
    <>
      <div className="toolbar">
        <h1>Enquiries</h1>
      </div>
      <p className="muted">
        Record a telephone, walk-in or email enquiry here. Public enquiry forms use the same
        Enquiries list — families do not create a separate record. Convert an enquiry to start
        an application without retyping pupil and guardian details.
      </p>
      <p className="muted">
        Public forms live under <Link href="/school/admissions/forms">Admissions → Forms</Link>.
      </p>
      <form className="card form-grid" onSubmit={onSubmit}>
        <label>Pupil name<input name="pupilLegalName" required /></label>
        <label>Date of birth<input name="dateOfBirth" type="date" /></label>
        <label>
          Intended academic year
          <select name="intendedAcademicYearId">
            <option value="">Select</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </label>
        <label>
          Intended year group
          <select name="intendedYearGroupId">
            <option value="">Select</option>
            {groups.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </label>
        <label>Parent / guardian name<input name="guardianFullName" required /></label>
        <label>Email<input name="guardianEmail" type="email" /></label>
        <label>Telephone<input name="guardianTelephone" /></label>
        <label>Source<input name="source" placeholder="Open day, website, referral" /></label>
        <label>Notes<textarea name="notes" rows={2} /></label>
        <div><button type="submit">Add enquiry</button></div>
      </form>
      <div className="toolbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, reference" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {["open", "contacted", "converted", "closed", "withdrawn"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      {message ? <p>{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Pupil</th>
            <th>Guardian</th>
            <th>Year group</th>
            <th>Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {enquiries.map((row) => (
            <tr key={row.id}>
              <td><Link href={`/school/admissions/enquiries/${row.id}`}>{row.reference}</Link></td>
              <td>{row.pupilLegalName}</td>
              <td>{row.guardianFullName}</td>
              <td>{row.intendedYearGroupName ?? "—"}</td>
              <td>{row.enquiryDate}</td>
              <td>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
