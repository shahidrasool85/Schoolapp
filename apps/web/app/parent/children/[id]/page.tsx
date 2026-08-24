"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "../../../../lib/api";
import { ComingLaterCard } from "../../../../components/coming-later";
import type { ComingLater, PortalChild } from "../../../../lib/portal";

type Detail = {
  child: PortalChild;
  sections: Record<string, ComingLater>;
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

const SECTION_LABELS: Array<{ key: string; title: string }> = [
  { key: "attendance", title: "Attendance" },
  { key: "achievements", title: "Achievements" },
  { key: "activities", title: "Activities" },
  { key: "competitions", title: "Competitions" },
];

export default function ParentChildDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [attendance, setAttendance] = useState<Attendance | null>(null);
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
              setAttendanceError(
                err instanceof ApiError && err.status === 404 ? "Attendance is not available." : err.message,
              );
            }
          });
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err instanceof ApiError && err.status === 404 ? "Child not found." : err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  const child = data.child;

  return (
    <>
      <h1>{child.displayName}</h1>
      <p className="muted">{child.school.name}</p>
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
            <dd>{child.enrolmentStatus}</dd>
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
        <Link href={`/parent/children/${params.id}/timetable`}>View this week's lessons</Link>
      </p>
      <h2 id="attendance">Attendance</h2>
      {attendanceError ? (
        <p className="error">{attendanceError}</p>
      ) : attendance ? (
        <>
          <div className="cards">
            <div className="card"><span>Attendance</span><strong>{attendance.summary.attendancePercentage ?? "—"}{attendance.summary.attendancePercentage != null ? "%" : ""}</strong></div>
            <div className="card"><span>Present</span><strong>{attendance.summary.sessionsPresent}</strong></div>
            <div className="card"><span>Possible</span><strong>{attendance.summary.sessionsPossible}</strong></div>
          </div>
          <table>
            <thead>
              <tr><th>Date</th><th>Session</th><th>Mark</th><th>Note</th></tr>
            </thead>
            <tbody>
              {attendance.marks.map((row) => (
                <tr key={row.id}>
                  <td>{row.date}</td>
                  <td>{row.sessionName}</td>
                  <td>{row.codeName}</td>
                  <td>{row.parentNote ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted">Loading attendance…</p>
      )}
      <h2>Learning</h2>
      <p>
        <Link href={`/parent/children/${params.id}/learning`}>View assignments and homework</Link>
      </p>
      <h2>Results and reports</h2>
      <p>
        <Link href={`/parent/children/${params.id}/results`}>Released assessment results</Link>
        {" · "}
        <Link href={`/parent/children/${params.id}/reports`}>Published reports</Link>
      </p>
      <h2>Coming later</h2>
      <div className="cards">
        {SECTION_LABELS.filter((section) => section.key !== "attendance").map((section) => (
          <ComingLaterCard
            key={section.key}
            title={section.title}
            message={data.sections[section.key]?.message ?? "Coming in a later phase."}
          />
        ))}
      </div>
    </>
  );
}
