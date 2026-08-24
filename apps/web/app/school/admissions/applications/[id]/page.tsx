"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, downloadAuthenticated } from "../../../../../lib/api";

type Canonical = {
  child?: {
    legalName?: string;
    preferredName?: string;
    dateOfBirth?: string;
    gender?: string;
    address?: { line1?: string; line2?: string; town?: string; postcode?: string };
    intendedAcademicYearId?: string;
    intendedYearGroupId?: string;
    proposedStartDate?: string;
    currentSchool?: string;
    previousSchool?: string;
  };
  guardians?: Array<{
    fullName?: string;
    relationship?: string;
    parentalResponsibility?: boolean;
    email?: string;
    phone?: string;
    primaryContact?: boolean;
    address?: { line1?: string; line2?: string; town?: string; postcode?: string };
  }>;
  previousEducation?: {
    schoolName?: string;
    startDate?: string;
    endDate?: string;
    reportDetails?: string;
  };
  emergency?: {
    fullName?: string;
    relationship?: string;
    telephone?: string;
    authorisedCollection?: boolean;
  };
  medical?: {
    allergies?: string;
    conditions?: string;
    medication?: string;
    dietary?: string;
    sendNotes?: string;
  };
  notes?: string;
};

type Detail = {
  application: {
    id: string;
    reference: string;
    status: string;
    pupilLegalName: string;
    pupilPreferredName: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    addressTown: string | null;
    addressPostcode: string | null;
    intendedAcademicYearId: string | null;
    intendedAcademicYearName: string | null;
    intendedYearGroupId: string | null;
    intendedYearGroupName: string | null;
    intendedEntryDate: string | null;
    previousSchool: string | null;
    currentSchool: string | null;
    internalNotes: string | null;
    convertedStudentProfileId: string | null;
    completenessStatus: string | null;
    source: string | null;
    publicFormName: string | null;
    campaignLabel: string | null;
    submittedAt: string | null;
    extraFields: { canonical?: Canonical } | null;
  };
  formSubmission?: {
    answers: Record<string, unknown>;
    canonicalSnapshot?: Canonical;
    declarationSnapshot?: {
      capturedAt?: string;
      privacyNoticeText?: string | null;
      declarations?: Array<{ fieldKey: string; label: string; accepted: boolean }>;
    } | null;
    sourceCode?: string | null;
    campaignLabel?: string | null;
    formName?: string | null;
    completenessStatus?: string;
    submittedAt?: string | null;
  } | null;
  contacts: Array<{
    id: string;
    fullName: string;
    email: string | null;
    telephone: string | null;
    relationship: string;
    isPrimary: boolean;
    hasParentalResponsibility: boolean;
    isEmergency: boolean;
    authorisedCollection: boolean;
    addressLine1: string | null;
    addressLine2: string | null;
    addressTown: string | null;
    addressPostcode: string | null;
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
  documents?: Array<{
    id: string;
    fieldKey: string;
    purpose: string;
    filename: string;
    contentType: string | null;
    byteSize: number | null;
    createdAt: string;
    status: string | null;
    downloadPath: string | null;
  }>;
};

type Option = { id: string; name: string };

const STATUSES = [
  "enquiry", "draft", "submitted", "under_review", "information_required",
  "assessment_pending", "assessment_completed", "waiting_list", "offer_pending",
  "offer_made", "accepted", "deferred", "rejected", "withdrawn", "enrolled",
];

function display(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    const items = value.map((item) => display(item)).filter((item) => item !== "—");
    return items.join("; ") || "—";
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (rec.line1 || rec.town || rec.postcode) {
      return [rec.line1, rec.line2, rec.town, rec.postcode].filter(Boolean).join(", ") || "—";
    }
    if (rec.fullName || rec.filename) {
      return [rec.fullName ?? rec.filename, rec.email, rec.phone ?? rec.telephone, rec.relationship, rec.purpose]
        .filter(Boolean)
        .join(" · ");
    }
    const parts = Object.entries(rec)
      .filter(([, item]) => item != null && item !== "")
      .map(([key, item]) => `${key}: ${display(item)}`);
    return parts.join(", ") || "—";
  }
  return String(value);
}

function formatAddress(parts: Array<string | null | undefined>): string {
  const cleaned = parts.map((part) => part?.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(", ") : "—";
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{display(value)}</dd>
    </div>
  );
}

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
      .filter((contact) => !contact.isEmergency && form.get(`link-${contact.id}`) === "on")
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
    setMessage(`Converted to pupil ${body.studentProfileId}.`);
    await load();
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;
  const app = data.application;
  const snapshot = data.formSubmission?.canonicalSnapshot ?? app.extraFields?.canonical ?? {};
  const child = snapshot.child ?? {};
  const guardians = data.contacts.filter((contact) => !contact.isEmergency);
  const emergencies = data.contacts.filter((contact) => contact.isEmergency);
  const answers = data.formSubmission?.answers ?? {};
  const customAnswers = Object.entries(answers).filter(([key]) => {
    return !key.includes(".") && key !== "guardians" && !key.startsWith("declaration");
  });

  return (
    <>
      <h1>{app.reference}</h1>
      <p className="muted">{app.pupilLegalName} · {app.status.replaceAll("_", " ")}</p>

      <h2>Application record</h2>
      <dl className="profile-list">
        <Field label="Pupil legal name" value={app.pupilLegalName} />
        <Field label="Preferred name" value={app.pupilPreferredName ?? child.preferredName} />
        <Field label="Date of birth" value={app.dateOfBirth ?? child.dateOfBirth} />
        <Field label="Gender" value={app.gender ?? child.gender} />
        <Field label="Intake" value={app.intendedAcademicYearName} />
        <Field label="Year group" value={app.intendedYearGroupName} />
        <Field label="Proposed start" value={app.intendedEntryDate ?? child.proposedStartDate} />
        <Field
          label="Address"
          value={formatAddress([
            app.addressLine1 ?? child.address?.line1,
            app.addressLine2 ?? child.address?.line2,
            app.addressTown ?? child.address?.town,
            app.addressPostcode ?? child.address?.postcode,
          ])}
        />
        <Field label="Current school" value={app.currentSchool ?? child.currentSchool} />
        <Field label="Previous school" value={app.previousSchool ?? child.previousSchool} />
        <Field label="Form used" value={data.formSubmission?.formName ?? app.publicFormName} />
        <Field label="Submitted" value={data.formSubmission?.submittedAt ?? app.submittedAt} />
        <Field label="Source / campaign" value={data.formSubmission?.campaignLabel ?? app.campaignLabel ?? app.source} />
        <Field label="Completeness" value={app.completenessStatus ?? data.formSubmission?.completenessStatus} />
        <div>
          <dt>Enrolled pupil</dt>
          <dd>
            {app.convertedStudentProfileId
              ? <a href={`/school/students/${app.convertedStudentProfileId}`}>Open pupil record</a>
              : "Not enrolled"}
          </dd>
        </div>
      </dl>

      <h2>Parents / guardians</h2>
      {guardians.length === 0 ? <p className="muted">No parents or guardians recorded.</p> : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Telephone</th>
              <th>Relationship</th>
              <th>Primary</th>
              <th>Parental responsibility</th>
              <th>Address</th>
              <th>Portal user</th>
            </tr>
          </thead>
          <tbody>
            {guardians.map((contact) => (
              <tr key={contact.id}>
                <td>{contact.fullName}</td>
                <td>{contact.email ?? "—"}</td>
                <td>{contact.telephone ?? "—"}</td>
                <td>{contact.relationship}</td>
                <td>{contact.isPrimary ? "Yes" : "No"}</td>
                <td>{contact.hasParentalResponsibility ? "Yes" : "No"}</td>
                <td>{formatAddress([contact.addressLine1, contact.addressLine2, contact.addressTown, contact.addressPostcode])}</td>
                <td>{contact.userId ? "Existing identity" : "No portal user yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Documents</h2>
      {(data.documents ?? []).length === 0 ? (
        <p className="muted">No uploaded documents.</p>
      ) : (
        <table>
          <thead>
            <tr><th>File</th><th>Type / question</th><th>Uploaded</th><th>Size</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {(data.documents ?? []).map((doc) => (
              <tr key={doc.id}>
                <td>{doc.filename}</td>
                <td>{doc.fieldKey} · {doc.purpose}</td>
                <td>{doc.createdAt ? new Date(doc.createdAt).toLocaleString() : "—"}</td>
                <td>{doc.byteSize ? `${Math.round(doc.byteSize / 1024)} KB` : "—"}</td>
                <td>{doc.status ?? "—"}</td>
                <td>
                  {doc.downloadPath ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        downloadAuthenticated(doc.downloadPath!, doc.filename).catch((err: Error) => setError(err.message))
                      }
                    >
                      Download
                    </button>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Previous education</h2>
      <dl className="profile-list">
        <Field label="School" value={snapshot.previousEducation?.schoolName ?? app.previousSchool ?? app.currentSchool} />
        <Field label="From" value={snapshot.previousEducation?.startDate} />
        <Field label="To" value={snapshot.previousEducation?.endDate} />
        <Field label="Report / reference" value={snapshot.previousEducation?.reportDetails} />
      </dl>

      <h2>Medical and additional needs</h2>
      <p className="muted">Visible to authorised admissions staff only. This is not shown on parent or student portals.</p>
      <dl className="profile-list">
        <Field label="Allergies" value={snapshot.medical?.allergies} />
        <Field label="Medical conditions" value={snapshot.medical?.conditions} />
        <Field label="Medication" value={snapshot.medical?.medication} />
        <Field label="Dietary requirements" value={snapshot.medical?.dietary} />
        <Field label="SEND / additional needs" value={snapshot.medical?.sendNotes} />
      </dl>

      <h2>Emergency contacts and collection</h2>
      {emergencies.length === 0 && !snapshot.emergency?.fullName ? (
        <p className="muted">No emergency contacts recorded.</p>
      ) : (
        <dl className="profile-list">
          {(emergencies.length ? emergencies : [{
            id: "snapshot",
            fullName: snapshot.emergency?.fullName ?? "—",
            relationship: snapshot.emergency?.relationship ?? "—",
            telephone: snapshot.emergency?.telephone ?? null,
            authorisedCollection: Boolean(snapshot.emergency?.authorisedCollection),
          }]).map((contact) => (
            <div key={contact.id}>
              <dt>{contact.fullName}</dt>
              <dd>
                {contact.relationship}
                {contact.telephone ? ` · ${contact.telephone}` : ""}
                {" · "}
                {contact.authorisedCollection ? "Authorised to collect" : "Not authorised to collect"}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {customAnswers.length > 0 ? (
        <>
          <h2>Application-specific answers</h2>
          <dl className="profile-list">
            {customAnswers.map(([key, value]) => (
              <Field key={key} label={key.replaceAll("_", " ")} value={typeof value === "boolean" ? value : value} />
            ))}
          </dl>
        </>
      ) : null}

      {snapshot.notes ? (
        <>
          <h2>Applicant notes</h2>
          <p>{snapshot.notes}</p>
        </>
      ) : null}
      {app.internalNotes ? (
        <>
          <h2>Internal notes</h2>
          <p>{app.internalNotes}</p>
        </>
      ) : null}

      {data.formSubmission?.declarationSnapshot ? (
        <>
          <h2>Declarations</h2>
          <ul>
            {(data.formSubmission.declarationSnapshot.declarations ?? []).map((item) => (
              <li key={item.fieldKey}>
                {item.label}: {item.accepted ? "accepted" : "not accepted"}
              </li>
            ))}
          </ul>
          {data.formSubmission.declarationSnapshot.capturedAt ? (
            <p className="muted">Captured {data.formSubmission.declarationSnapshot.capturedAt}</p>
          ) : null}
        </>
      ) : null}

      <h2>Status</h2>
      {app.status === "enrolled" ? (
        <p className="muted">Enrolled. Status can no longer be changed here; the original application is retained as history.</p>
      ) : (
        <form className="card form-grid" onSubmit={changeStatus}>
          <label>
            New status
            <select name="status" key={app.status} defaultValue={app.status}>
              {STATUSES.filter((s) => s !== "enrolled").map((s) => (
                <option key={s} value={s}>{s.replaceAll("_", " ")}</option>
              ))}
            </select>
          </label>
          <label>Reason / note<input name="reason" /></label>
          <div><button type="submit">Change status</button></div>
        </form>
      )}
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
          <h2>Convert to enrolled pupil</h2>
          <p className="muted">
            This creates or reuses the live pupil record. The application stays as admissions history.
            Parent portal access is not granted unless you tick it below.
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
            {guardians.map((contact) => (
              <label key={contact.id}>
                <span>
                  <input type="checkbox" name={`link-${contact.id}`} defaultChecked={Boolean(contact.email)} />
                  Create guardianship for {contact.fullName}
                </span>
                <span>
                  <input type="checkbox" name={`portal-${contact.id}`} />
                  Enable parent portal access
                </span>
              </label>
            ))}
            <div>
              <button type="submit" disabled={Boolean(app.convertedStudentProfileId)}>
                {app.convertedStudentProfileId ? "Already converted" : "Enrol pupil"}
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
