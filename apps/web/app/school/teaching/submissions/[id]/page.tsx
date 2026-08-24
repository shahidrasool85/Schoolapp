"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, downloadAuthenticated } from "../../../../../lib/api";

type Detail = {
  submission: {
    id: string;
    assignmentId: string;
    studentLegalName: string | null;
    status: string;
    textResponse: string | null;
    comment: string | null;
    assignmentTitle: string;
    assignmentDescription: string | null;
    teacherNotes: string | null;
    maximumMarks: number | null;
    revisions: Array<{
      id: string;
      revisionNumber: number;
      textResponse: string | null;
      comment: string | null;
      submittedAt: string;
      attachments?: Array<{ id: string; filename: string; downloadPath: string | null }>;
    }>;
    mark: {
      score: number | null;
      maximumMarks: number | null;
      feedback: string | null;
      releasedToStudent: boolean;
      releasedToParent: boolean;
      resubmissionRequested: boolean;
      markedByName: string | null;
    } | null;
  };
};

export default function MarkSubmissionPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const loadSeq = useRef(0);

  async function load() {
    const seq = ++loadSeq.current;
    try {
      const body = await api<Detail>(`/api/v1/learning/submissions/${params.id}`);
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/learning/submissions/${params.id}/marks`, {
      method: "POST",
      body: JSON.stringify({
        score: form.get("score") ? Number(form.get("score")) : null,
        feedback: form.get("feedback") || null,
        releasedToStudent: form.get("releasedToStudent") === "on",
        releasedToParent: form.get("releasedToParent") === "on",
        resubmissionRequested: form.get("resubmissionRequested") === "on",
        status:
          form.get("resubmissionRequested") === "on"
            ? "resubmission_requested"
            : form.get("status") === "resubmission_requested"
              ? "returned"
              : form.get("status"),
      }),
    });
    setSaved("Saved");
    await load();
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;
  const s = data.submission;

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      <h1>Mark: {s.studentLegalName}</h1>
      <p className="muted">{s.assignmentTitle} · {s.status}</p>
      <h2>Work</h2>
      <p>{s.textResponse || "No text submitted."}</p>
      {s.comment ? <p className="muted">Pupil comment: {s.comment}</p> : null}
      {s.teacherNotes ? <p className="muted">Private notes: {s.teacherNotes}</p> : null}
      <h2>Revisions</h2>
      <ul>
        {s.revisions.map((rev) => (
          <li key={rev.id}>
            #{rev.revisionNumber} · {new Date(rev.submittedAt).toLocaleString()}
            {rev.attachments && rev.attachments.length > 0 ? (
              <ul>
                {rev.attachments.map((file) => (
                  <li key={file.id}>
                    {file.filename}
                    {file.downloadPath ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            downloadAuthenticated(file.downloadPath!, file.filename).catch((err: Error) =>
                              setError(err.message),
                            )
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
          </li>
        ))}
      </ul>
      <form className="card form-grid" onSubmit={onSubmit}>
        <label>
          Score
          <input name="score" type="number" min={0} step="0.5" defaultValue={s.mark?.score ?? ""} />
        </label>
        <label>
          Status
          <select name="status" defaultValue={s.mark?.resubmissionRequested ? "resubmission_requested" : s.status}>
            <option value="returned">Returned</option>
            <option value="completed">Completed</option>
            <option value="resubmission_requested">Resubmission requested</option>
          </select>
        </label>
        <label className="span-2">
          Feedback
          <textarea name="feedback" rows={4} defaultValue={s.mark?.feedback ?? ""} />
        </label>
        <label style={{ alignItems: "center" }}>
          Release to pupil
          <input name="releasedToStudent" type="checkbox" defaultChecked={s.mark?.releasedToStudent} />
        </label>
        <label style={{ alignItems: "center" }}>
          Release to parent
          <input name="releasedToParent" type="checkbox" defaultChecked={s.mark?.releasedToParent} />
        </label>
        <label style={{ alignItems: "center" }}>
          Request resubmission
          <input name="resubmissionRequested" type="checkbox" defaultChecked={s.mark?.resubmissionRequested} />
        </label>
        <div><button type="submit">Save mark</button></div>
      </form>
      {saved ? <p>{saved}</p> : null}
    </>
  );
}
