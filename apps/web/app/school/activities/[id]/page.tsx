"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, downloadAuthenticated } from "../../../../lib/api";

type Bundle = {
  activity: {
    id: string;
    title: string;
    status: string;
    startsAt: string;
    endsAt: string;
    location: string | null;
    capacity: number | null;
    consentRequired: boolean;
    parentNotes: string | null;
    staffNotes: string | null;
    activityTypeName: string | null;
    responseDeadlineAt: string | null;
  };
  summary: {
    eligible: number;
    pending: number;
    consented: number;
    declined: number;
    confirmed: number;
    waitlisted: number;
    availableSpaces: number | null;
  };
  staff: Array<{ staffUserId: string; fullName: string | null; staffRole: string }>;
  documents: Array<{ id: string; title: string; visibility: string; downloadPath: string | null; originalFilename: string | null }>;
  consentClauses: Array<{ title: string; wording: string }>;
  updates: Array<{ id: string; body: string; parentVisible: boolean; studentVisible: boolean; publishedAt: string | null }>;
  canPublish?: boolean;
  canManageParticipants?: boolean;
  canManageResponses?: boolean;
};

type Eligible = {
  studentProfileId: string;
  legalName: string;
  className: string | null;
  consentResponse: string;
  registrationStatus: string | null;
  paymentStatus?: string | null;
};

type Participant = {
  studentProfileId: string;
  legalName: string | null;
  registrationStatus: string;
  waitingListPosition: number | null;
  paymentStatus?: string | null;
};

type Safety = {
  liveMedical: boolean;
  participants: Array<{
    studentProfileId: string;
    legalName: string;
    allergies?: string | null;
    medication?: string | null;
    dietaryRequirements?: string | null;
    medicalConditions?: string | null;
    emergencyContacts: Array<{ name: string; relationship: string; email: string | null }>;
  }>;
};

export default function StaffActivityDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Bundle | null>(null);
  const [eligible, setEligible] = useState<Eligible[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [safety, setSafety] = useState<Safety | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const [bundle, elig, parts] = await Promise.all([
      api<Bundle>(`/api/v1/activities/${params.id}`),
      api<{ eligible: Eligible[] }>(`/api/v1/activities/${params.id}/eligible`),
      api<{ participants: Participant[] }>(`/api/v1/activities/${params.id}/participants`),
    ]);
    setData(bundle);
    setEligible(elig.eligible);
    setParticipants(parts.participants);
    try {
      const summary = await api<Safety>(`/api/v1/activities/${params.id}/safety-summary`);
      setSafety(summary);
    } catch {
      setSafety(null);
    }
  }

  useEffect(() => {
    if (!params.id) return;
    load().catch((err: Error) => setError(err.message));
  }, [params.id]);

  async function action(path: string, body?: unknown) {
    setError("");
    setMessage("");
    try {
      await api(path, { method: "POST", body: body ? JSON.stringify(body) : "{}" });
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete that action.");
      return false;
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const payload = new FormData(form);
    try {
      await api(`/api/v1/activities/${params.id}/documents`, { method: "POST", body: payload });
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not attach the document.");
    }
  }

  async function offline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const studentId = String(form.get("studentProfileId"));
    const ok = await action(`/api/v1/activities/${params.id}/participants/${studentId}/offline-response`, {
      response: form.get("response"),
      staffNote: form.get("staffNote") || "Recorded from paper / phone consent.",
      confirm: true,
    });
    if (ok) setMessage("Offline response recorded as staff-entered.");
  }

  async function addParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await action(`/api/v1/activities/${params.id}/participants`, {
      studentProfileId: form.get("studentProfileId"),
    });
    if (ok) {
      event.currentTarget.reset();
      setMessage("Participant added.");
    }
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;
  const activity = data.activity;
  const addable = eligible.filter((row) => {
    const place = participants.find((item) => item.studentProfileId === row.studentProfileId);
    return !place || place.registrationStatus === "withdrawn";
  });

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p>{message}</p> : null}
      <div className="toolbar">
        <h1>{activity.title}</h1>
        <span className="muted">{activity.activityTypeName} · {activity.status}</span>
      </div>
      <p className="muted">
        {new Date(activity.startsAt).toLocaleString()} – {new Date(activity.endsAt).toLocaleString()}
        {activity.location ? ` · ${activity.location}` : ""}
        {activity.capacity != null ? ` · capacity ${activity.capacity}` : " · unlimited"}
      </p>
      {activity.parentNotes ? <p>{activity.parentNotes}</p> : null}
      {activity.staffNotes ? <p className="muted">Internal: {activity.staffNotes}</p> : null}
      <div className="cards">
        <div className="card"><span>Eligible</span><strong>{data.summary.eligible}</strong></div>
        <div className="card"><span>Pending</span><strong>{data.summary.pending}</strong></div>
        <div className="card"><span>Consented</span><strong>{data.summary.consented}</strong></div>
        <div className="card"><span>Confirmed</span><strong>{data.summary.confirmed}</strong></div>
        <div className="card"><span>Waiting list</span><strong>{data.summary.waitlisted}</strong></div>
        <div className="card"><span>Spaces</span><strong>{data.summary.availableSpaces ?? "—"}</strong></div>
      </div>
      <div className="toolbar">
        {data.canPublish && activity.status === "draft" ? <button type="button" onClick={() => action(`/api/v1/activities/${activity.id}/publish`)}>Publish</button> : null}
        {data.canPublish && activity.status === "published" ? <button type="button" className="secondary" onClick={() => action(`/api/v1/activities/${activity.id}/close`)}>Close</button> : null}
        {data.canPublish && (activity.status === "published" || activity.status === "closed") ? (
          <button type="button" className="secondary" onClick={() => action(`/api/v1/activities/${activity.id}/complete`)}>Mark completed</button>
        ) : null}
        {data.canPublish && (activity.status === "published" || activity.status === "closed") ? (
          <button type="button" className="secondary" onClick={() => action(`/api/v1/activities/${activity.id}/cancel`, { reason: "Cancelled from staff UI" })}>Cancel activity</button>
        ) : null}
        {data.canPublish && (activity.status === "completed" || activity.status === "cancelled") ? (
          <button type="button" className="secondary" onClick={() => action(`/api/v1/activities/${activity.id}/archive`)}>Archive</button>
        ) : null}
        <a
          className="secondary"
          href="#export"
          onClick={(event) => {
            event.preventDefault();
            downloadAuthenticated(`/api/v1/activities/${activity.id}/participants.csv`, "participants.csv").catch((err: Error) => setError(err.message));
          }}
        >
          Export CSV
        </a>
      </div>
      <h2>Consent wording</h2>
      {data.consentClauses.map((clause) => (
        <div className="card" key={clause.title}>
          <strong>{clause.title}</strong>
          <p>{clause.wording}</p>
        </div>
      ))}
      <h2>Updates</h2>
      {!(data.updates?.length) ? <p className="muted">No parent or student updates yet.</p> : (
        <ul>
          {data.updates.map((update) => (
            <li key={update.id}>
              {update.body}
              <span className="muted">
                {" "}
                · {update.parentVisible ? "parents" : "not parents"}
                {update.studentVisible ? " · students" : ""}
                {update.publishedAt ? ` · ${new Date(update.publishedAt).toLocaleString()}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h2>Documents</h2>
      <ul>
        {data.documents.map((doc) => (
          <li key={doc.id}>
            {doc.title} · {doc.visibility.replaceAll("_", " ")}
            {doc.downloadPath ? (
              <>
                {" "}
                <button type="button" className="secondary" onClick={() => downloadAuthenticated(doc.downloadPath!, doc.originalFilename ?? "document.pdf")}>Download</button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <form className="card form-grid" onSubmit={upload}>
        <label>Title<input name="title" required /></label>
        <label>
          Visibility
          <select name="visibility" defaultValue="staff_and_parents">
            <option value="staff">Staff only</option>
            <option value="staff_and_parents">Staff and parents</option>
            <option value="staff_parents_and_student">Staff, parents and students</option>
          </select>
        </label>
        <label>File<input name="file" type="file" required /></label>
        <button type="submit">Attach document</button>
      </form>
      <h2>Responses / participants</h2>
      <table>
        <thead>
          <tr><th>Pupil</th><th>Class</th><th>Consent</th><th>Place</th><th>Payment</th></tr>
        </thead>
        <tbody>
          {eligible.map((row) => (
            <tr key={row.studentProfileId}>
              <td>{row.legalName}</td>
              <td>{row.className ?? "—"}</td>
              <td>{row.consentResponse}</td>
              <td>
                {row.registrationStatus ?? "—"}
                {data.canManageParticipants &&
                row.registrationStatus &&
                row.registrationStatus !== "withdrawn" &&
                ["draft", "published", "closed"].includes(activity.status) ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => action(`/api/v1/activities/${activity.id}/participants/${row.studentProfileId}/withdraw`)}
                    >
                      Withdraw
                    </button>
                  </>
                ) : null}
              </td>
              <td>{row.paymentStatus ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Waiting list</h2>
      {participants.filter((row) => row.registrationStatus === "waitlisted").length === 0 ? (
        <p className="muted">No pupils on the waiting list.</p>
      ) : (
        <ul>
          {participants
            .filter((row) => row.registrationStatus === "waitlisted")
            .map((row) => (
              <li key={row.studentProfileId}>
                {row.waitingListPosition}. {row.legalName}{" "}
                {data.canManageParticipants ? (
                  <button type="button" className="secondary" onClick={() => action(`/api/v1/activities/${activity.id}/participants/${row.studentProfileId}/promote`)}>Promote</button>
                ) : null}
              </li>
            ))}
        </ul>
      )}
      {data.canManageParticipants && ["draft", "published", "closed"].includes(activity.status) && addable.length > 0 ? (
        <>
          <h2>Add participant</h2>
          <form className="card form-grid" onSubmit={addParticipant}>
            <label>
              Pupil
              <select name="studentProfileId" required>
                {addable.map((row) => (
                  <option key={row.studentProfileId} value={row.studentProfileId}>{row.legalName}</option>
                ))}
              </select>
            </label>
            <button type="submit">Add pupil</button>
          </form>
        </>
      ) : null}
      {data.canManageResponses ? (
        <>
      <h2>Record offline consent</h2>
      <p className="muted">Use this only for paper, phone, or in-person responses. It is stored as staff-entered, not as a parent portal consent.</p>
      <form className="card form-grid" onSubmit={offline}>
        <label>
          Pupil
          <select name="studentProfileId" required>
            {eligible.map((row) => (
              <option key={row.studentProfileId} value={row.studentProfileId}>{row.legalName}</option>
            ))}
          </select>
        </label>
        <label>
          Response
          <select name="response" defaultValue="consented">
            <option value="consented">Consented</option>
            <option value="declined">Declined</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </label>
        <label>Staff note<input name="staffNote" defaultValue="Paper / phone consent recorded by staff." /></label>
        <button type="submit">Save offline response</button>
      </form>
        </>
      ) : null}
      <h2>Parent-safe update</h2>
      <form
        className="card form-grid"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const ok = await action(`/api/v1/activities/${activity.id}/updates`, {
            body: form.get("body"),
            parentVisible: true,
            studentVisible: form.get("studentVisible") === "on",
          });
          if (ok) {
            event.currentTarget.reset();
            setMessage("Update published to parents.");
          }
        }}
      >
        <label>Update<textarea name="body" rows={3} required placeholder="Departure time changed / bring a coat" /></label>
        <label><input name="studentVisible" type="checkbox" /> Also visible to students</label>
        <button type="submit">Publish update</button>
      </form>
      <h2>Safety summary</h2>
      <p className="muted">
        Live pupil medical and emergency information for confirmed participants. Safeguarding records are never included.
        {safety?.liveMedical ? " This is live data, not a stored trip snapshot." : ""}
      </p>
      {!safety ? (
        <p className="muted">Not authorised for the activity safety summary, or there are no confirmed participants.</p>
      ) : safety.participants.length === 0 ? (
        <p className="muted">No confirmed participants yet.</p>
      ) : (
        <div className="cards">
          {safety.participants.map((row) => (
            <div className="card" key={row.studentProfileId}>
              <strong>{row.legalName}</strong>
              {row.allergies ? <p>Allergy: {row.allergies}</p> : null}
              {row.medication ? <p>Medication: {row.medication}</p> : null}
              {row.dietaryRequirements ? <p>Dietary: {row.dietaryRequirements}</p> : null}
              {row.medicalConditions ? <p>Medical: {row.medicalConditions}</p> : null}
              {row.emergencyContacts.map((contact) => (
                <p key={`${contact.name}-${contact.relationship}`} className="muted">
                  Emergency: {contact.name} ({contact.relationship})
                  {contact.email ? ` · ${contact.email}` : ""}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
