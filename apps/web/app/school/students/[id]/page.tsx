"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api";

type Detail = {
  student: {
    id: string;
    legalName: string;
    admissionNumber: string | null;
    enrolmentStatus: string;
    currentYearGroupName: string | null;
    currentFormClassName: string | null;
  };
  enrolments: Array<{
    id: string;
    academicYearName: string | null;
    yearGroupName: string | null;
    status: string;
    isPrimary: boolean;
    placementKind: string;
    startedOn: string;
    endedOn: string | null;
  }>;
  classMemberships: Array<{
    id: string;
    className: string;
    classType: string;
    startedOn: string;
    endedOn: string | null;
  }>;
  guardians: Array<{
    id: string;
    guardianFullName: string | null;
    guardianEmail: string | null;
    relationship: string;
    hasParentalResponsibility: boolean;
    endedOn: string | null;
  }>;
  attendanceSummary: {
    sessionsPossible: number;
    sessionsPresent: number;
    authorisedAbsence: number;
    unauthorisedAbsence: number;
    late: number;
    attendancePercentage: number | null;
  } | null;
  portalAccess: {
    enabled: boolean;
    source: string;
    hasLoginAlias?: boolean;
    alias?: string | null;
  };
};

type Option = { id: string; name: string };

type AttendanceHistory = {
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
    sessionName: string | null;
    codeName: string | null;
    category: string | null;
    className: string | null;
  }>;
};

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [attendance, setAttendance] = useState<AttendanceHistory | null>(null);
  const [years, setYears] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [classes, setClasses] = useState<Option[]>([]);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState("");

  async function load() {
    const [detail, yr, yg, cl] = await Promise.all([
      api<Detail>(`/api/v1/students/${params.id}`),
      api<{ academicYears: Option[] }>("/api/v1/academic-years"),
      api<{ yearGroups: Option[] }>("/api/v1/year-groups"),
      api<{ classes: Option[] }>("/api/v1/classes"),
    ]);
    setData(detail);
    setYears(yr.academicYears);
    setGroups(yg.yearGroups);
    setClasses(cl.classes);
    if (detail.attendanceSummary) {
      const history = await api<AttendanceHistory>(`/api/v1/attendance/students/${params.id}`);
      setAttendance(history);
    } else {
      setAttendance(null);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.id]);

  async function enrol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/students/${params.id}/enrolments`, {
      method: "POST",
      body: JSON.stringify({
        academicYearId: form.get("academicYearId"),
        yearGroupId: form.get("yearGroupId"),
        classId: form.get("classId") || undefined,
        placementKind: form.get("placementKind") || "primary",
      }),
    });
    await load();
  }

  async function addGuardian(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const created = await api<{ invitationToken?: string | null }>(
      `/api/v1/students/${params.id}/guardians`,
      {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          fullName: form.get("fullName"),
          relationship: form.get("relationship") || "other",
          hasParentalResponsibility: form.get("hasParentalResponsibility") === "on",
        }),
      },
    );
    setInvite(created.invitationToken ?? "");
    event.currentTarget.reset();
    await load();
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>{data.student.legalName}</h1>
      <p className="muted">
        {data.student.currentYearGroupName ?? "No current year group"} ·{" "}
        {data.student.currentFormClassName ?? "No form class"} · {data.student.enrolmentStatus}
      </p>
      <p>
        Student portal: {data.portalAccess.enabled ? "enabled" : "disabled"}
        {data.portalAccess.hasLoginAlias ? ` · login alias ${data.portalAccess.alias}` : ""}
      </p>
      {data.attendanceSummary ? (
        <div className="cards">
          <div className="card"><span>Attendance</span><strong>{data.attendanceSummary.attendancePercentage ?? "—"}{data.attendanceSummary.attendancePercentage != null ? "%" : ""}</strong></div>
          <div className="card"><span>Possible sessions</span><strong>{data.attendanceSummary.sessionsPossible}</strong></div>
          <div className="card"><span>Present</span><strong>{data.attendanceSummary.sessionsPresent}</strong></div>
          <div className="card"><span>Unauthorised</span><strong>{data.attendanceSummary.unauthorisedAbsence}</strong></div>
        </div>
      ) : null}
      {attendance && attendance.marks.length > 0 ? (
        <>
          <h2>Attendance history</h2>
          <table>
            <thead>
              <tr><th>Date</th><th>Session</th><th>Mark</th><th>Class</th></tr>
            </thead>
            <tbody>
              {attendance.marks.slice(0, 24).map((row) => (
                <tr key={row.id}>
                  <td>{row.date}</td>
                  <td>{row.sessionName}</td>
                  <td>{row.codeName}</td>
                  <td>{row.className ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h2>Enrolment history</h2>
      <table>
        <thead>
          <tr><th>Year</th><th>Year group</th><th>Kind</th><th>From</th><th>To</th><th>Status</th></tr>
        </thead>
        <tbody>
          {data.enrolments.map((row) => (
            <tr key={row.id}>
              <td>{row.academicYearName}</td>
              <td>{row.yearGroupName}</td>
              <td>{row.placementKind}{row.isPrimary ? " (primary)" : ""}</td>
              <td>{row.startedOn}</td>
              <td>{row.endedOn ?? "current"}</td>
              <td>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="card form-grid" onSubmit={enrol}>
        <label>
          Academic year
          <select name="academicYearId" required>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </label>
        <label>
          Year group
          <select name="yearGroupId" required>
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
        <label>
          Placement
          <select name="placementKind">
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
            <option value="exceptional">Exceptional</option>
          </select>
        </label>
        <div><button type="submit">Add / move enrolment</button></div>
      </form>

      <h2>Class memberships</h2>
      <table>
        <thead>
          <tr><th>Class</th><th>Type</th><th>From</th><th>To</th></tr>
        </thead>
        <tbody>
          {data.classMemberships.map((row) => (
            <tr key={row.id}>
              <td>{row.className}</td>
              <td>{row.classType}</td>
              <td>{row.startedOn}</td>
              <td>{row.endedOn ?? "current"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Parents / guardians</h2>
      <table>
        <thead>
          <tr><th>Name</th><th>Email</th><th>Relationship</th><th>PR</th><th>Status</th></tr>
        </thead>
        <tbody>
          {data.guardians.map((row) => (
            <tr key={row.id}>
              <td>{row.guardianFullName}</td>
              <td>{row.guardianEmail}</td>
              <td>{row.relationship}</td>
              <td>{row.hasParentalResponsibility ? "Yes" : "No"}</td>
              <td>{row.endedOn ?? "current"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="card form-grid" onSubmit={addGuardian}>
        <label>Name<input name="fullName" required /></label>
        <label>Email<input name="email" type="email" required /></label>
        <label>Relationship<input name="relationship" defaultValue="mother" /></label>
        <label style={{ alignItems: "center" }}>
          Parental responsibility
          <input name="hasParentalResponsibility" type="checkbox" />
        </label>
        <div><button type="submit">Invite / link parent</button></div>
      </form>
      {invite ? (
        <p>
          Invitation token (share once): <code>{invite}</code>
        </p>
      ) : null}
    </>
  );
}
