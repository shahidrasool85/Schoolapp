"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, downloadAuthenticated } from "../../../../lib/api";

type Detail = {
  activity: {
    id: string;
    title: string;
    description: string | null;
    startsAt: string;
    endsAt: string;
    location: string | null;
    parentNotes: string | null;
    responseDeadlineAt: string | null;
    consentRequired: boolean;
    status: string;
    cancelReason: string | null;
  };
  consentClauses: Array<{ title: string; wording: string; required: boolean }>;
  documents: Array<{ id: string; title: string; downloadPath: string | null; originalFilename: string | null }>;
  updates: Array<{ id: string; body: string; publishedAt: string | null }>;
  child: {
    studentProfileId: string;
    consentResponse: string;
    registrationStatus: string | null;
    waitingListPosition: number | null;
    paymentStatus?: string | null;
  };
};

export default function ParentActivityDetailPage() {
  const params = useParams<{ activityId: string }>();
  const search = useSearchParams();
  const studentId = search.get("studentId");
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    if (!studentId) {
      setError("Select a child from the activities list.");
      return;
    }
    const body = await api<Detail>(`/api/v1/parent/children/${studentId}/activities/${params.activityId}`);
    setData(body);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.activityId, studentId]);

  async function respond(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!studentId || !data) return;
    const form = new FormData(event.currentTarget);
    setError("");
    setMessage("");
    if (form.get("confirm") !== "on") {
      setError("Tick the confirmation box to record this response.");
      return;
    }
    try {
      const comment = String(form.get("comment") ?? "").trim();
      const result = await api<{ registrationStatus: string }>(
        `/api/v1/parent/children/${studentId}/activities/${params.activityId}/respond`,
        {
          method: "POST",
          body: JSON.stringify({
            response: form.get("response"),
            comment: comment || undefined,
            emergencyMedicalAcknowledged: form.get("emergency") === "on",
            confirm: true,
          }),
        },
      );
      setMessage(
        result.registrationStatus === "waitlisted"
          ? "This activity is full. Your child has been placed on the waiting list."
          : `Response saved. Place status: ${result.registrationStatus}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the response.");
    }
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  const statusLabel =
    data.child.registrationStatus === "waitlisted"
      ? `Waiting list (${data.child.waitingListPosition ?? "—"})`
      : data.child.registrationStatus ?? data.child.consentResponse;

  return (
    <>
      {error ? <p role="alert" className="error">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <h1>{data.activity.title}</h1>
      <p className="muted">
        {new Date(data.activity.startsAt).toLocaleString()} – {new Date(data.activity.endsAt).toLocaleString()}
        {data.activity.location ? ` · ${data.activity.location}` : ""}
      </p>
      {data.activity.status === "cancelled" ? (
        <p role="status" className="error">
          This activity has been cancelled.
          {data.activity.cancelReason ? ` ${data.activity.cancelReason}` : ""}
        </p>
      ) : null}
      <p>
        Status: <strong>{statusLabel}</strong>
        {data.child.consentResponse === "pending" &&
        data.activity.consentRequired &&
        ["published", "closed"].includes(data.activity.status)
          ? " · response needed"
          : ""}
      </p>
      {data.child.paymentStatus && data.child.paymentStatus !== "not_required" ? (
        <p>
          Payment: <strong>{data.child.paymentStatus}</strong>
          {data.child.paymentStatus === "outstanding" ? " · open Payments to pay" : ""}
        </p>
      ) : null}
      {data.activity.parentNotes ? <p>{data.activity.parentNotes}</p> : null}
      {data.activity.description ? <p>{data.activity.description}</p> : null}
      {data.activity.responseDeadlineAt ? (
        <p>Response deadline: {new Date(data.activity.responseDeadlineAt).toLocaleString()}</p>
      ) : null}
      {data.updates?.length ? (
        <>
          <h2>Updates</h2>
          {data.updates.map((update) => (
            <section className="card" key={update.id}>
              <p>{update.body}</p>
              {update.publishedAt ? <p className="muted">{new Date(update.publishedAt).toLocaleString()}</p> : null}
            </section>
          ))}
        </>
      ) : null}
      <h2>Documents</h2>
      {data.documents.length === 0 ? <p className="muted">No parent-visible documents.</p> : (
        <ul>
          {data.documents.map((doc) => (
            <li key={doc.id}>
              {doc.title}
              {doc.downloadPath ? (
                <>
                  {" "}
                  <button type="button" className="secondary" onClick={() => downloadAuthenticated(doc.downloadPath!, doc.originalFilename ?? "document.pdf")}>Download</button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {data.activity.consentRequired && ["published", "closed"].includes(data.activity.status) ? (
        <>
          <h2>Consent</h2>
          {data.consentClauses.map((clause) => (
            <section className="card" key={clause.title}>
              <h3>{clause.title}</h3>
              <p>{clause.wording}</p>
            </section>
          ))}
          <form className="card form-grid" onSubmit={respond}>
            <fieldset>
              <legend>Your response</legend>
              <label><input type="radio" name="response" value="consented" required /> I consent / accept</label>
              <label><input type="radio" name="response" value="declined" /> I decline</label>
              {data.child.consentResponse === "consented" ? (
                <label><input type="radio" name="response" value="withdrawn" /> Withdraw previous consent</label>
              ) : null}
            </fieldset>
            <label><input type="checkbox" name="emergency" /> I confirm emergency/medical information held by the school is up to date for this activity</label>
            <label>
              <input type="checkbox" name="confirm" required /> I have read the wording above and confirm this response
            </label>
            <label>Comment (optional)<textarea name="comment" rows={2} /></label>
            <button type="submit">Confirm response</button>
          </form>
        </>
      ) : null}
    </>
  );
}
