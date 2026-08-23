"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../../lib/api";

type Enquiry = {
  id: string;
  reference: string;
  status: string;
  pupilLegalName: string;
  pupilPreferredName: string | null;
  dateOfBirth: string | null;
  intendedAcademicYearName: string | null;
  intendedYearGroupName: string | null;
  guardianFullName: string;
  guardianEmail: string | null;
  guardianTelephone: string | null;
  enquiryDate: string;
  source: string | null;
  notes: string | null;
  convertedApplicationId: string | null;
};

export default function EnquiryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [enquiry, setEnquiry] = useState<Enquiry | null>(null);
  const [submission, setSubmission] = useState<{ answers: Record<string, unknown>; sourceCode?: string } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const body = await api<{ enquiry: Enquiry; formSubmission?: { answers: Record<string, unknown>; sourceCode?: string } | null }>(
      `/api/v1/admissions/enquiries/${params.id}`,
    );
    setEnquiry(body.enquiry);
    setSubmission(body.formSubmission ?? null);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.id]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/admissions/enquiries/${params.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: form.get("status"),
        notes: form.get("notes") || undefined,
        source: form.get("source") || undefined,
      }),
    });
    setMessage("Enquiry updated.");
    await load();
  }

  async function convert() {
    setError("");
    try {
      const body = await api<{ application: { id: string } }>(
        `/api/v1/admissions/enquiries/${params.id}/convert`,
        { method: "POST", body: "{}" },
      );
      router.push(`/school/admissions/applications/${body.application.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not convert enquiry");
    }
  }

  if (error && !enquiry) return <p className="error">{error}</p>;
  if (!enquiry) return <p>Loading…</p>;

  return (
    <>
      <h1>{enquiry.reference}</h1>
      <p className="muted">{enquiry.pupilLegalName} · {enquiry.status}</p>
      <dl className="profile-list">
        <div><dt>Date of birth</dt><dd>{enquiry.dateOfBirth ?? "—"}</dd></div>
        <div><dt>Intended year</dt><dd>{enquiry.intendedAcademicYearName ?? "—"}</dd></div>
        <div><dt>Year group</dt><dd>{enquiry.intendedYearGroupName ?? "—"}</dd></div>
        <div><dt>Guardian</dt><dd>{enquiry.guardianFullName}</dd></div>
        <div><dt>Email</dt><dd>{enquiry.guardianEmail ?? "—"}</dd></div>
        <div><dt>Telephone</dt><dd>{enquiry.guardianTelephone ?? "—"}</dd></div>
        <div><dt>Enquiry date</dt><dd>{enquiry.enquiryDate}</dd></div>
      </dl>
      <form className="card form-grid" onSubmit={save}>
        <label>
          Status
          <select name="status" defaultValue={enquiry.status}>
            {["open", "contacted", "converted", "closed", "withdrawn"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>Source<input name="source" defaultValue={enquiry.source ?? ""} /></label>
        <label>Notes<textarea name="notes" rows={3} defaultValue={enquiry.notes ?? ""} /></label>
        <div><button type="submit">Save</button></div>
      </form>
      {enquiry.convertedApplicationId ? (
        <p>
          Converted to application.{" "}
          <a href={`/school/admissions/applications/${enquiry.convertedApplicationId}`}>Open application</a>
        </p>
      ) : (
        <p>
          <button type="button" onClick={convert}>Start application from this enquiry</button>
        </p>
      )}
      {submission ? (
        <section className="card">
          <h2>Public form answers</h2>
          <p className="muted">Source: {submission.sourceCode ?? "staff or unattributed"}</p>
          <dl className="profile-list">
            {Object.entries(submission.answers).map(([key, value]) => (
              <div key={key}>
                <dt>{key.replaceAll("_", " ").replaceAll(".", " / ")}</dt>
                <dd>{typeof value === "boolean" ? (value ? "Yes" : "No") : value == null || value === "" ? "—" : String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <p className="muted">This enquiry was entered by staff, not a public form.</p>
      )}
      {message ? <p>{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </>
  );
}
