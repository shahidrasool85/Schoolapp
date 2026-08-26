"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, downloadAuthenticated } from "../../../../lib/api";
import { Alert, DataTable, EmptyState, LoadingState, PageError, PersonSummary, StatCard, StatusBadge, Tabs } from "../../../../components/ui";
import { userFacingError } from "../../../../lib/errors";
import type { ComingLater, PortalChild } from "../../../../lib/portal";

type Detail = {
  child: PortalChild;
  sections: Record<string, ComingLater>;
};

type DocumentRow = {
  id: string;
  filename: string;
  title: string | null;
  documentType: string | null;
  downloadPath: string | null;
};

type Attendance = {
  summary: {
    sessionsPossible: number;
    sessionsPresent: number;
    authorisedAbsence: number;
    unauthorisedAbsence: number;
    late: number;
    attendancePercentage: number | null;
  };
  marks: Array<{
    id: string;
    date: string;
    sessionName: string;
    codeName: string;
    category: string;
    lateMinutes: number | null;
    parentNote: string | null;
  }>;
};

export default function ParentChildDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [error, setError] = useState("");
  const [attendanceError, setAttendanceError] = useState("");

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    setData(null);
    setAttendance(null);
    setAttendanceError("");
    setError("");
    api<Detail>(`/api/v1/parent/children/${params.id}`)
      .then((detail) => {
        if (cancelled) return;
        setData(detail);
        setError("");
        return api<Attendance>(`/api/v1/parent/children/${params.id}/attendance`)
          .then((history) => {
            if (!cancelled) setAttendance(history);
          })
          .catch((err: Error) => {
            if (!cancelled) {
              setAttendanceError("Attendance is not available.");
            }
          })
          .then(() =>
            api<{ documents: DocumentRow[] }>(`/api/v1/parent/children/${params.id}/documents`)
              .then((body) => {
                if (!cancelled) setDocuments(body.documents);
              })
              .catch(() => {
                if (!cancelled) setDocuments([]);
              }),
          );
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err instanceof ApiError && err.status === 404 ? "Child not found." : userFacingError(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (error && !data) return <PageError title="Child unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading child…" />;

  const child = data.child;
  const id = params.id;

  return (
    <>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <PersonSummary
        name={child.displayName}
        meta={`${child.school.name}${child.currentYearGroupName ? ` · ${child.currentYearGroupName}` : ""}${
          child.currentFormClassName ? ` · ${child.currentFormClassName}` : ""
        }`}
      />
      <Tabs>
        <Link href={`/parent/children/${id}`} aria-current="page">
          Overview
        </Link>
        <Link href={`/parent/children/${id}/timetable`}>Timetable</Link>
        <Link href={`/parent/children/${id}/learning`}>Learning</Link>
        <Link href={`/parent/children/${id}/engagement`}>Rewards</Link>
        <Link href={`/parent/children/${id}/competitions`}>Competitions</Link>
        <Link href={`/parent/children/${id}/results`}>Results</Link>
        <Link href={`/parent/children/${id}/reports`}>Reports</Link>
        <Link href="/parent/activities">Activities</Link>
        <Link href="/parent/payments">Payments</Link>
        <Link href="/parent/messages">Messages</Link>
      </Tabs>
      <div className="card">
        <dl className="profile-list">
          <div>
            <dt>Legal name</dt>
            <dd>{child.legalName}</dd>
          </div>
          <div>
            <dt>Preferred name</dt>
            <dd>{child.preferredName ?? "—"}</dd>
          </div>
          <div>
            <dt>Date of birth</dt>
            <dd>{child.dateOfBirth ?? "—"}</dd>
          </div>
          <div>
            <dt>Academic year</dt>
            <dd>{child.currentAcademicYearName ?? "—"}</dd>
          </div>
          <div>
            <dt>Year group</dt>
            <dd>{child.currentYearGroupName ?? "—"}</dd>
          </div>
          <div>
            <dt>Form / class</dt>
            <dd>{child.currentFormClassName ?? "—"}</dd>
          </div>
          <div>
            <dt>House</dt>
            <dd>{child.houseName ?? "—"}</dd>
          </div>
          <div>
            <dt>Enrolment</dt>
            <dd>
              <StatusBadge status={child.enrolmentStatus} />
            </dd>
          </div>
          {child.guardianship ? (
            <div>
              <dt>Your relationship</dt>
              <dd>
                {child.guardianship.relationship}
                {child.guardianship.hasParentalResponsibility ? " · parental responsibility" : ""}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
      <h2>Timetable</h2>
      <p>
        <Link href={`/parent/children/${id}/timetable`}>View this week's lessons</Link>
      </p>
      <h2 id="attendance">Attendance</h2>
      {attendanceError ? (
        <Alert tone="info">{attendanceError}</Alert>
      ) : attendance ? (
        <>
          <div className="stat-grid">
            <StatCard
              label="Attendance"
              value={`${attendance.summary.attendancePercentage ?? "—"}${attendance.summary.attendancePercentage != null ? "%" : ""}`}
            />
            <StatCard label="Present" value={attendance.summary.sessionsPresent} />
            <StatCard label="Possible" value={attendance.summary.sessionsPossible} />
          </div>
          {attendance.marks.length === 0 ? (
            <EmptyState title="No attendance marks yet" description="When the school records attendance, it will appear here." />
          ) : (
            <DataTable
              headers={
                <>
                  <th>Date</th>
                  <th>Session</th>
                  <th>Mark</th>
                  <th>Note</th>
                </>
              }
            >
              {attendance.marks.map((row) => (
                <tr key={row.id}>
                  <td>{row.date}</td>
                  <td>{row.sessionName}</td>
                  <td>
                    <StatusBadge status={row.codeName} />
                  </td>
                  <td>{row.parentNote ?? "—"}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </>
      ) : (
        <LoadingState label="Loading attendance…" />
      )}
      <h2>Learning</h2>
      <p>
        <Link href={`/parent/children/${id}/learning`}>View assignments and homework</Link>
        {" · "}
        <Link href={`/parent/children/${id}/engagement`}>Rewards, achievements and practice</Link>
      </p>
      <h2>Activities</h2>
      <p>
        <Link href={`/parent/activities`}>Trips, clubs, and consent responses</Link>
      </p>
      <h2>Documents</h2>
      {documents.length === 0 ? (
        <p className="muted">No documents have been shared with you.</p>
      ) : (
        <ul>
          {documents.map((doc) => (
            <li key={doc.id}>
              {doc.title ?? doc.filename}
              {doc.documentType ? ` · ${doc.documentType.replaceAll("_", " ")}` : ""}
              {doc.downloadPath ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      downloadAuthenticated(doc.downloadPath!, doc.filename).catch((err: Error) =>
                        setError(userFacingError(err)),
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
      <h2>Results and reports</h2>
      <p>
        <Link href={`/parent/children/${id}/results`}>Released assessment results</Link>
        {" · "}
        <Link href={`/parent/children/${id}/reports`}>Published reports</Link>
      </p>
    </>
  );
}
