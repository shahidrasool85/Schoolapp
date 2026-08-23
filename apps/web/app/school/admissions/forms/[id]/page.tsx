"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../../lib/api";

type FormDetail = {
  form: {
    id: string;
    name: string;
    slug: string;
    formType: string;
    status: string;
    successText: string | null;
    privacyNoticeText: string | null;
  };
  sections: Array<{
    sectionKey: string;
    title: string;
    enabled: boolean;
    fields: Array<{ fieldKey: string; label: string; required: boolean; enabled: boolean; questionType: string }>;
  }>;
};

export default function AdmissionsFormDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<FormDetail | null>(null);
  const [share, setShare] = useState<{ publicUrl: string; embedCode: string; qrSvg: string | null } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const [detail, shareBody] = await Promise.all([
      api<FormDetail>(`/api/v1/admissions/forms/${params.id}`),
      api<{ publicUrl: string; embedCode: string; qrSvg: string | null }>(`/api/v1/admissions/forms/${params.id}/share`),
    ]);
    setData(detail);
    setShare(shareBody);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.id]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/admissions/forms/${params.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: form.get("name"),
        slug: form.get("slug"),
        successText: form.get("successText"),
        privacyNoticeText: form.get("privacyNoticeText"),
      }),
    });
    setMessage("Form saved.");
    await load();
  }

  async function publish(path: "publish" | "unpublish") {
    await api(`/api/v1/admissions/forms/${params.id}/${path}`, { method: "POST", body: "{}" });
    setMessage(path === "publish" ? "Published." : "Unpublished.");
    await load();
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>{data.form.name}</h1>
      <p className="muted">
        {data.form.formType} · {data.form.status}
      </p>
      {message ? <p>{message}</p> : null}
      <form className="card stack" onSubmit={save}>
        <label>
          Name
          <input name="name" defaultValue={data.form.name} required />
        </label>
        <label>
          Slug
          <input name="slug" defaultValue={data.form.slug} required />
        </label>
        <label>
          Success text
          <textarea name="successText" defaultValue={data.form.successText ?? ""} />
        </label>
        <label>
          Privacy notice text
          <textarea name="privacyNoticeText" defaultValue={data.form.privacyNoticeText ?? ""} />
        </label>
        <button type="submit">Save</button>
      </form>
      <div className="toolbar">
        <button type="button" onClick={() => void publish("publish")}>Publish</button>
        <button type="button" className="secondary" onClick={() => void publish("unpublish")}>Unpublish</button>
        <button
          type="button"
          className="secondary"
          onClick={() => void api(`/api/v1/admissions/forms/${params.id}/duplicate`, { method: "POST", body: "{}" }).then((body) => {
            window.location.href = `/school/admissions/forms/${(body as { form: { id: string } }).form.id}`;
          })}
        >
          Duplicate
        </button>
      </div>
      {share ? (
        <section className="card">
          <h2>Share</h2>
          <p>
            Public URL: <code>{share.publicUrl}</code>
          </p>
          <button type="button" className="secondary" onClick={() => void navigator.clipboard.writeText(share.publicUrl)}>
            Copy link
          </button>
          <pre style={{ whiteSpace: "pre-wrap" }}>{share.embedCode}</pre>
          <button type="button" className="secondary" onClick={() => void navigator.clipboard.writeText(share.embedCode)}>
            Copy embed code
          </button>
          {share.qrSvg ? (
            <div
              dangerouslySetInnerHTML={{ __html: share.qrSvg }}
              style={{ width: 180 }}
              aria-label="QR code for the public form"
            />
          ) : (
            <p className="muted">Publish the form to generate a QR code.</p>
          )}
        </section>
      ) : null}
      <h2>Sections</h2>
      {data.sections.map((section) => (
        <section key={section.sectionKey} className="card">
          <h3>{section.title}</h3>
          <ul>
            {section.fields.map((field) => (
              <li key={field.fieldKey}>
                {field.label} ({field.questionType}
                {field.required ? ", required" : ""}
                {field.enabled ? "" : ", hidden"})
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
