"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { formatDateTime } from "../../../../lib/dates";

type FormRow = {
  id: string;
  name: string;
  formType: string;
  status: string;
  opensAt: string | null;
  closesAt: string | null;
  submissionsCount: number;
  slug: string;
};

export default function AdmissionsFormsPage() {
  const [forms, setForms] = useState<FormRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const body = await api<{ forms: FormRow[] }>("/api/v1/admissions/forms");
    setForms(body.forms);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    try {
      const created = await api<{ form: { id: string } }>("/api/v1/admissions/forms", {
        method: "POST",
        body: JSON.stringify({
          formType: form.get("formType"),
          name: form.get("name"),
          slug: form.get("slug") || undefined,
        }),
      });
      window.location.href = `/school/admissions/forms/${created.form.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create this form.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <h1>Admissions forms</h1>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <form className="card form-grid" onSubmit={create}>
        <label>
          Name
          <input name="name" required />
        </label>
        <label>
          Type
          <select name="formType" defaultValue="enquiry">
            <option value="enquiry">Enquiry</option>
            <option value="application">Application</option>
            <option value="open_day">Open day</option>
            <option value="waiting_list">Waiting list</option>
            <option value="scholarship">Scholarship</option>
            <option value="sixth_form">Sixth form</option>
            <option value="nursery">Nursery</option>
          </select>
        </label>
        <label>
          Slug
          <input name="slug" placeholder="year-3-enquiry" />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create form"}
        </button>
      </form>
      {forms === null ? (
        <p className="muted">Loading forms…</p>
      ) : (
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
            <th>Open / close</th>
            <th>Submissions</th>
          </tr>
        </thead>
        <tbody>
          {forms.map((form) => (
            <tr key={form.id}>
              <td>
                <Link href={`/school/admissions/forms/${form.id}`}>{form.name}</Link>
              </td>
              <td>{form.formType}</td>
              <td>{form.status}</td>
              <td>
                {form.opensAt ? formatDateTime(form.opensAt) : "—"} / {form.closesAt ? formatDateTime(form.closesAt) : "—"}
              </td>
              <td>{form.submissionsCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      )}
    </>
  );
}
