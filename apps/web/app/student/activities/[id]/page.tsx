"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, downloadAuthenticated } from "../../../../lib/api";

type Detail = {
  activity: {
    id: string;
    title: string;
    description: string | null;
    startsAt: string;
    location: string | null;
    parentNotes: string | null;
    studentSignupEnabled: boolean;
    consentRequired: boolean;
    status: string;
  };
  documents: Array<{ id: string; title: string; downloadPath: string | null; originalFilename: string | null }>;
  child: {
    registrationStatus: string | null;
    waitingListPosition: number | null;
  };
};

export default function StudentActivityDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const body = await api<Detail>(`/api/v1/student/activities/${params.id}`);
    setData(body);
  }

  useEffect(() => {
    if (!params.id) return;
    load().catch((err: Error) => setError(err.message));
  }, [params.id]);

  async function signup() {
    setError("");
    const result = await api<{ registrationStatus: string }>(`/api/v1/student/activities/${params.id}/signup`, {
      method: "POST",
      body: "{}",
    });
    setMessage(
      result.registrationStatus === "waitlisted"
        ? "This activity is full. You have been added to the waiting list."
        : `Signed up. Status: ${result.registrationStatus}.`,
    );
    await load();
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <h1>{data.activity.title}</h1>
      <p className="muted">
        {new Date(data.activity.startsAt).toLocaleString()}
        {data.activity.location ? ` · ${data.activity.location}` : ""}
      </p>
      <p>Your place: <strong>{data.child.registrationStatus ?? "not signed up"}</strong></p>
      {data.activity.parentNotes ? <p>{data.activity.parentNotes}</p> : null}
      {data.activity.description ? <p>{data.activity.description}</p> : null}
      <h2>Documents</h2>
      {data.documents.length === 0 ? <p className="muted">No student-visible documents.</p> : (
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
      {data.activity.studentSignupEnabled && !data.activity.consentRequired && data.activity.status === "published" ? (
        data.child.registrationStatus && data.child.registrationStatus !== "withdrawn" ? (
          <button
            type="button"
            className="secondary"
            onClick={() =>
              api(`/api/v1/student/activities/${params.id}/withdraw`, { method: "POST", body: "{}" })
                .then(() => {
                  setMessage("You have withdrawn from this activity.");
                  return load();
                })
                .catch((err: Error) => setError(err.message))
            }
          >
            Withdraw
          </button>
        ) : (
          <button type="button" onClick={() => signup().catch((err: Error) => setError(err.message))}>Sign up</button>
        )
      ) : null}
    </>
  );
}
