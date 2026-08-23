"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../../lib/api";
import { PublicAdmissionsForm } from "../../../../../lib/public-admissions-form";

type FormOption = {
  id: string;
  name: string;
  slug: string;
  formType: string;
  status: string;
};

export default function NewApplicationPage() {
  const router = useRouter();
  const [forms, setForms] = useState<FormOption[]>([]);
  const [formId, setFormId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ forms: FormOption[] }>("/api/v1/admissions/forms")
      .then((body) => {
        const published = body.forms.filter(
          (form) => form.formType === "application" && form.status === "published",
        );
        setForms(published);
        setFormId(published[0]?.id ?? "");
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const selected = forms.find((form) => form.id === formId);

  return (
    <>
      <div className="toolbar">
        <h1>New application</h1>
        <Link href="/school/admissions/applications">Back to applications</Link>
      </div>
      <p className="muted">
        Record a telephone, walk-in, paper or assisted application on the same form used by
        families. The result is a normal admissions application, not a separate staff schema.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {forms.length === 0 ? (
        <div className="card">
          <p>No published application form is available.</p>
          <p className="muted">
            Publish an application form under <Link href="/school/admissions/forms">Admissions → Forms</Link>,
            then return here.
          </p>
        </div>
      ) : (
        <>
          <label>
            Application form
            <select value={formId} onChange={(event) => setFormId(event.target.value)}>
              {forms.map((form) => (
                <option key={form.id} value={form.id}>{form.name}</option>
              ))}
            </select>
          </label>
          {selected ? (
            <PublicAdmissionsForm
              key={selected.id}
              mode="staff"
              formId={selected.id}
              formType="application"
              slug={selected.slug}
              onCreated={(result) => {
                if (result.applicationId) {
                  router.push(`/school/admissions/applications/${result.applicationId}`);
                }
              }}
            />
          ) : null}
        </>
      )}
    </>
  );
}
