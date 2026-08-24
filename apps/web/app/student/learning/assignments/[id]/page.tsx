"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, downloadAuthenticated } from "../../../../../lib/api";

type Detail = {
  assignment: {
    id: string;
    title: string;
    description: string | null;
    workTypeName: string | null;
    subjectName: string | null;
    createdByName: string | null;
    dueAt: string | null;
    assignedAt: string | null;
    submissionRequired: boolean;
    maximumMarks: number | null;
    resources: Array<{ id: string; title: string; resourceKind: string; url: string | null; downloadPath?: string | null; originalFilename?: string | null }>;
    submission: {
      status: string;
      submittedAt: string | null;
      textResponse: string | null;
      comment: string | null;
      attachments?: Array<{ id: string; filename: string; downloadPath: string | null }>;
    };
    mark: { score: number | null; maximumMarks: number | null; feedback: string | null; markedAt: string | null } | null;
  };
};

export default function StudentAssignmentPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const loadSeq = useRef(0);

  async function load() {
    const seq = ++loadSeq.current;
    try {
      const body = await api<Detail>(`/api/v1/student/assignments/${params.id}`);
      if (seq !== loadSeq.current) return;
      setData(body);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      throw err;
    }
  }

  useEffect(() => {
    setData(null);
    setError("");
    setSaved("");
    load().catch((err: Error) => setError(err.message));
    return () => {
      loadSeq.current += 1;
    };
  }, [params.id]);

  async function onSubmit(event: FormEvent<HTMLFormElement>, submit: boolean) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/student/assignments/${params.id}/submissions`, {
      method: "POST",
      body: JSON.stringify({
        textResponse: form.get("textResponse") || null,
        comment: form.get("comment") || null,
        submit,
      }),
    });
    setSaved(submit ? "Submitted" : "Saved");
    await load();
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;
  const a = data.assignment;
  const canSubmit = ["not_started", "in_progress", "resubmission_requested"].includes(a.submission.status);

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      <h1>{a.title}</h1>
      <p className="muted">
        {a.subjectName ?? a.workTypeName}
        {a.createdByName ? ` · ${a.createdByName}` : ""}
        {a.dueAt ? ` · due ${new Date(a.dueAt).toLocaleString()}` : ""}
      </p>
      <p>Status: {a.submission.status.replaceAll("_", " ")}</p>
      <h2>Instructions</h2>
      <p>{a.description || "No instructions."}</p>
      {a.resources.length > 0 ? (
        <>
          <h2>Resources</h2>
          <ul>
            {a.resources.map((resource) => (
              <li key={resource.id}>
                {resource.downloadPath ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      downloadAuthenticated(
                        resource.downloadPath!,
                        resource.originalFilename ?? resource.title,
                      ).catch((err: Error) => setError(err.message))
                    }
                  >
                    {resource.title}
                  </button>
                ) : resource.url ? (
                  <a href={resource.url}>{resource.title}</a>
                ) : (
                  resource.title
                )}{" "}
                ({resource.resourceKind})
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {a.mark ? (
        <>
          <h2>Feedback</h2>
          <p>
            {a.mark.score != null ? `Mark: ${a.mark.score}${a.mark.maximumMarks != null ? ` / ${a.mark.maximumMarks}` : ""}` : "Returned"}
          </p>
          <p>{a.mark.feedback || "No written comments."}</p>
        </>
      ) : null}
      <h2>Your work</h2>
      {(a.submission.attachments ?? []).length > 0 ? (
        <ul>
          {a.submission.attachments!.map((file) => (
            <li key={file.id}>
              {file.filename}
              {file.downloadPath ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      downloadAuthenticated(file.downloadPath!, file.filename).catch((err: Error) => setError(err.message))
                    }
                  >
                    Download
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canSubmit ? (
        <form className="card form-grid" onSubmit={(event) => onSubmit(event, true)}>
          <label className="span-2">
            Response
            <textarea name="textResponse" rows={6} defaultValue={a.submission.textResponse ?? ""} />
          </label>
          <label className="span-2">
            Comment
            <textarea name="comment" rows={2} defaultValue={a.submission.comment ?? ""} />
          </label>
          <div className="toolbar">
            <button type="submit">Submit</button>
            <button className="secondary" type="button" onClick={(event) => {
              const form = (event.currentTarget as HTMLButtonElement).form;
              if (form) onSubmit({ preventDefault() {}, currentTarget: form } as FormEvent<HTMLFormElement>, false);
            }}>
              Save draft
            </button>
          </div>
        </form>
      ) : (
        <p>{a.submission.textResponse || "Submitted."}</p>
      )}
      {canSubmit ? (
        <form
          className="card form-grid"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const payload = new FormData(form);
            setSaved("Uploading…");
            try {
              await api(`/api/v1/student/assignments/${params.id}/attachments`, { method: "POST", body: payload });
              form.reset();
              setSaved("File attached");
              await load();
            } catch (err) {
              setSaved("");
              setError(err instanceof Error ? err.message : "Upload failed");
            }
          }}
        >
          <label className="span-2">
            Attachment
            <input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.txt" />
          </label>
          <div><button type="submit">Upload attachment</button></div>
        </form>
      ) : null}
      {saved ? <p>{saved}</p> : null}
    </>
  );
}
