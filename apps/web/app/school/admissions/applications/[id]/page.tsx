"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../../lib/api";

type Detail = {
  application: {
    id: string;
    reference: string;
    status: string;
    pupilLegalName: string;
    dateOfBirth: string | null;
    intendedAcademicYearId: string | null;
    intendedAcademicYearName: string | null;
    intendedYearGroupId: string | null;
    intendedYearGroupName: string | null;
    previousSchool: string | null;
    internalNotes: string | null;
    convertedStudentProfileId: string | null;
  };
  contacts: Array<{
    id: string;
    fullName: string;
    email: string | null;
    telephone: string | null;
    relationship: string;
    isPrimary: boolean;
    userId: string | null;
  }>;
  history: Array<{
    id: string;
    previousStatus: string | null;
    newStatus: string;
    reason: string | null;
    actorName: string | null;
    createdAt: string;
  }>;
  assessments: Array<{ id: string; assessmentType: string; status: string; scheduledAt: string | null }>;
  offers: Array<{ id: string; status: string; offerMadeOn: string; responseDeadline: string | null }>;
};

type Option = { id: string; name: string };

const STATUSES = [
  "enquiry", "draft", "submitted", "under_review", "information_required",
  "assessment_pending", "assessment_completed", "waiting_list", "offer_pending",
  "offer_made", "accepted", "deferred", "rejected", "withdrawn", "enrolled",
];

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [years, setYears] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [classes, setClasses] = useState<Option[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const [detail, yr, yg, cl] = await Promise.all([
      api<Detail>(`/api/v1/admissions/applications/${params.id}`),
      api<{ academicYears: Option[] }>("/api/v1/academic-years"),
      api<{ yearGroups: Option[] }>("/api/v1/year-groups"),
      api<{ classes: Option[] }>("/api/v1/classes"),
    ]);
    setData(detail);
    setYears(yr.academicYears);
    setGroups(yg.yearGroups);
    setClasses(cl.classes);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.id]);

  async function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/admissions/applications/${params.id}/status`, {
      method: "POST",
      body: JSON.stringify({
        status: form.get("status"),
        reason: form.get("reason") || undefined,
      }),
    });
    setMessage("Status updated.");
    await load();
  }

  async function addAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scheduled = form.get("scheduledAt");
    await api(`/api/v1/admissions/applications/${params.id}/assessments`, {
      method: "POST",
      body: JSON.stringify({
        assessmentType: form.get("assessmentType"),
        scheduledAt: scheduled ? new Date(String(scheduled)).toISOString() : undefined,
        notes: form.get("notes") || undefined,
      }),
    });
    event.currentTarget.reset();
    setMessage("Assessment scheduled.");
    await load();
  }

  async function waitlist() {
    await api(`/api/v1/admissions/applications/${params.id}/waiting-list`, {
      method: "POST",
      body: "{}",
    });
    setMessage("Placed on waiting list.");
    await load();
  }

  async function makeOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/admissions/applications/${params.id}/offers`, {
      method: "POST",
      body: JSON.stringify({
        offeredAcademicYearId: form.get("offeredAcademicYearId") || undefined,
        offeredYearGroupId: form.get("offeredYearGroupId") || undefined,
        intendedStartDate: form.get("intendedStartDate") || undefined,
        responseDeadline: form.get("responseDeadline") || undefined,
      }),
    });
    setMessage("Offer recorded.");
    await load();
  }

  async function enrol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const guardianLinks = data?.contacts
      .filter((contact) => form.get(`link-${contact.id}`) === "on")
      .map((contact) => ({
        contactId: contact.id,
        portalAccess: form.get(`portal-${contact.id}`) === "on",
      }));
    const body = await api<{ studentProfileId: string }>(
      `/api/v1/admissions/applications/${params.id}/enrol`,
      {
        method: "POST",
        body: JSON.stringify({
          academicYearId: form.get("academicYearId") || undefined,
          yearGroupId: form.get("yearGroupId") || undefined,
          classId: form.get("classId") || undefined,
          admissionNumber: form.get("admissionNumber") || undefined,
          guardianLinks,
        }),
      },
    );
    setMessage(`Converted to student ${body.studentProfileId}.`);
    await load();
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;
  const app = data.application;

  return (
    <>
      <h1>{app.reference}</h1>
      <p className="muted">{app.pupilLegalName} · {app.status.replaceAll("_", " ")}</p>
      <dl className="profile-list">
        <div><dt>Date of birth</dt><dd>{app.dateOfBirth ?? "—"}</dd></div>
        <div><dt>Intake</dt><dd>{app.intendedAcademicYearName ?? "—"}</dd></div>
        <div><dt>Year group</dt><dd>{app.intendedYearGroupName ?? "—"}</dd></div>
        <div><dt>Previous school</dt><dd>{app.previousSchool ?? "—"}</dd></div>
        <div>
          <dt>Converted student</dt>
          <dd>
            {app.convertedStudentProfileId
              ? <a href={`/school/students/${app.convertedStudentProfileId}`}>Open student</a>
              : "Not enrolled"}
          </dd>
        </div>
      </dl>

      <h2>Contacts</h2>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Telephone</th><th>Relationship</th><th>User</th></tr></thead>
        <tbody>
          {data.contacts.map((contact) => (
            <tr key={contact.id}>
              <td>{contact.fullName}</td>
              <td>{contact.email ?? "—"}</td>
              <td>{contact.telephone ?? "—"}</td>
              <td>{contact.relationship}</td>
              <td>{contact.userId ? "Existing identity" : "No portal user yet"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Status</h2>
      <form className="card form-grid" onSubmit={changeStatus}>
        <label>
          New status
          <select name="status" key={app.status} defaultValue={app.status}>
            {STATUSES.map((s) => (
              <option key={s} value={s} disabled={s === "enrolled"}>{s.replaceAll("_", " ")}</option>
            ))}
          </select>
        </label>
        <label>Reason / note<input name="reason" /></label>
        <div><button type="submit">Change status</button></div>
      </form>
      <p>
        <button type="button" className="secondary" onClick={() => waitlist().catch((err: Error) => setError(err.message))}>
          Place on waiting list
        </button>
      </p>

      <h2>Assessment / interview</h2>
      <form className="card form-grid" onSubmit={(e) => addAssessment(e).catch((err: Error) => setError(err.message))}>
        <label>
          Type
          <select name="assessmentType">
            <option value="admissions_interview">Admissions interview</option>
            <option value="academic_assessment">Academic assessment</option>
            <option value="school_visit">School visit</option>
            <option value="eleven_plus">11+ assessment</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>Scheduled<input name="scheduledAt" type="datetime-local" /></label>
        <label>Notes<input name="notes" /></label>
        <div><button type="submit">Schedule</button></div>
      </form>
      <ul>
        {data.assessments.map((item) => (
          <li key={item.id}>{item.assessmentType.replaceAll("_", " ")} · {item.status} · {item.scheduledAt ?? "unscheduled"}</li>
        ))}
      </ul>

      <h2>Offer</h2>
      <form className="card form-grid" onSubmit={(e) => makeOffer(e).catch((err: Error) => setError(err.message))}>
        <label>
          Offered year
          <select name="offeredAcademicYearId" defaultValue={app.intendedAcademicYearId ?? ""}>
            <option value="">Select</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </label>
        <label>
          Offered year group
          <select name="offeredYearGroupId" defaultValue={app.intendedYearGroupId ?? ""}>
            <option value="">Select</option>
            {groups.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </label>
        <label>Start date<input name="intendedStartDate" type="date" /></label>
        <label>Response deadline<input name="responseDeadline" type="date" /></label>
        <div><button type="submit">Make offer</button></div>
      </form>
      <ul>
        {data.offers.map((offer) => (
          <li key={offer.id}>{offer.status} · made {offer.offerMadeOn} · deadline {offer.responseDeadline ?? "—"}</li>
        ))}
      </ul>

      {app.status === "accepted" || app.status === "enrolled" ? (
        <>
          <h2>Convert to enrolled student</h2>
          <p className="muted">
            This creates the canonical student record. Application contacts do not receive portal
            access unless you tick it below.
          </p>
          <form className="card stack" onSubmit={(e) => enrol(e).catch((err: Error) => setError(err.message))}>
            <div className="form-grid">
              <label>
                Academic year
                <select name="academicYearId" defaultValue={app.intendedAcademicYearId ?? ""}>
                  <option value="">Select</option>
                  {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                </select>
              </label>
              <label>
                Year group
                <select name="yearGroupId" defaultValue={app.intendedYearGroupId ?? ""}>
                  <option value="">Select</option>
                  {groups.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                </select>
              </label>
              <label>
                Form class
                <select name="classId">
                  <option value="">None</option>
                  {classes.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                </select>
              </label>
              <label>Admission number<input name="admissionNumber" /></label>
            </div>
            {data.contacts.map((contact) => (
              <label key={contact.id}>
                <span>
                  <input type="checkbox" name={`link-${contact.id}`} defaultChecked={Boolean(contact.email)} />
                  Create guardianship for {contact.fullName}
                </span>
                <span>
                  <input type="checkbox" name={`portal-${contact.id}`} />
                  Grant parent portal access
                </span>
              </label>
            ))}
            <div>
              <button type="submit" disabled={Boolean(app.convertedStudentProfileId)}>
                {app.convertedStudentProfileId ? "Already converted" : "Enrol student"}
              </button>
            </div>
          </form>
        </>
      ) : null}

      <h2>History</h2>
      <table>
        <thead><tr><th>When</th><th>From</th><th>To</th><th>Actor</th><th>Reason</th></tr></thead>
        <tbody>
          {data.history.map((row) => (
            <tr key={row.id}>
              <td>{row.createdAt}</td>
              <td>{row.previousStatus ?? "—"}</td>
              <td>{row.newStatus}</td>
              <td>{row.actorName ?? "—"}</td>
              <td>{row.reason ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {message ? <p>{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </>
  );
}
