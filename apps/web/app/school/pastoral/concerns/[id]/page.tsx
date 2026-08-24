"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, downloadAuthenticated } from "../../../../../lib/api";

type Detail = {
  concern: {
    studentLegalName: string | null;
    categoryName: string | null;
    priority: string;
    status: string;
    summary: string;
    detailedNotes: string | null;
    attendanceRelated: boolean;
  };
  interventions: Array<{
    id: string;
    interventionType: string;
    actionOn: string;
    outcome: string | null;
    nextReviewOn: string | null;
  }>;
  attachments?: Array<{
    id: string;
    filename: string | null;
    title: string | null;
    downloadPath: string | null;
  }>;
};

export default function PastoralConcernDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  function load() {
    api<Detail>(`/api/v1/pastoral/concerns/${params.id}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, [params.id]);

  async function onIntervention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const me = await api<{ user: { id: string } }>("/api/v1/me");
    await api(`/api/v1/pastoral/concerns/${params.id}/interventions`, {
      method: "POST",
      body: JSON.stringify({
        interventionType: form.get("interventionType"),
        responsibleStaffUserId: me.user.id,
        actionOn: form.get("actionOn"),
        outcome: form.get("outcome") || undefined,
        nextReviewOn: form.get("nextReviewOn") || undefined,
      }),
    });
    event.currentTarget.reset();
    load();
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>{data.concern.studentLegalName}</h1>
      <p className="muted">
        {data.concern.categoryName} · {data.concern.priority} · {data.concern.status}
        {data.concern.attendanceRelated ? " · attendance-related" : ""}
      </p>
      <p>{data.concern.summary}</p>
      {data.concern.detailedNotes ? <p>{data.concern.detailedNotes}</p> : null}
      <h2>Attachments</h2>
      {(data.attachments ?? []).length === 0 ? <p className="muted">No attachments.</p> : (
        <ul>
          {(data.attachments ?? []).map((file) => (
            <li key={file.id}>
              {file.title ?? file.filename ?? "Attachment"}
              {file.downloadPath ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      downloadAuthenticated(file.downloadPath!, file.filename ?? file.title ?? "attachment").catch(
                        (err: Error) => setError(err.message),
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
      )}
      <form
        className="card form-grid"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          await api(`/api/v1/pastoral/concerns/${params.id}/attachments`, { method: "POST", body: new FormData(form) });
          form.reset();
          load();
        }}
      >
        <label>Title<input name="title" /></label>
        <label>File<input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.docx" /></label>
        <div><button type="submit">Upload attachment</button></div>
      </form>
      <h2>Interventions</h2>
      {data.interventions.length === 0 ? <p className="muted">No interventions yet.</p> : (
        <ul>
          {data.interventions.map((item) => (
            <li key={item.id}>
              {item.interventionType} · {item.actionOn}
              {item.outcome ? ` · ${item.outcome}` : ""}
              {item.nextReviewOn ? ` · review ${item.nextReviewOn}` : ""}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onIntervention}>
        <label>
          Action
          <select name="interventionType" required>
            <option value="pupil_meeting">Meeting with pupil</option>
            <option value="parent_meeting">Parent meeting</option>
            <option value="parent_contact">Parent contact</option>
            <option value="mentoring">Mentoring</option>
            <option value="support_plan">Support plan</option>
            <option value="internal_referral">Internal referral</option>
            <option value="review">Review</option>
          </select>
        </label>
        <label>
          Date
          <input name="actionOn" type="date" required />
        </label>
        <label>
          Outcome
          <textarea name="outcome" rows={3} />
        </label>
        <label>
          Next review
          <input name="nextReviewOn" type="date" />
        </label>
        <button type="submit">Add intervention</button>
      </form>
    </>
  );
}
