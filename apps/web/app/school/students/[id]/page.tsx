"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
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
  behaviourSummary: { incidentCount: number; openIncidents: number; positiveCount: number } | null;
  pastoralSummary: { openCount: number; latestPriority: string | null } | null;
};

type Option = { id: string; name: string };

type LearningHistory = {
  items: Array<{
    assignmentId: string;
    title: string;
    dueAt: string | null;
    workTypeName: string | null;
    subjectName: string | null;
    submissionStatus: string;
    submittedAt: string | null;
    mark: { score: number | null; feedback: string | null } | null;
  }>;
};

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
  const [learning, setLearning] = useState<LearningHistory | null>(null);
  const [learningStatus, setLearningStatus] = useState<"loading" | "ready" | "error">("loading");
  const [academic, setAcademic] = useState<{
    results: Array<{
      assessmentTitle: string | null;
      subjectName: string | null;
      assessmentDate: string | null;
      percentage: number | null;
      gradeLabel: string | null;
      teacherJudgement: string | null;
      releasedToStudent: boolean;
      releasedToParent: boolean;
    }>;
    targets: Array<{ subjectName: string | null; targetLabel: string | null; baselineLabel: string | null }>;
    reports: Array<{ reportingPeriodName: string | null; status: string }>;
  } | null>(null);
  const [academicStatus, setAcademicStatus] = useState<"loading" | "ready" | "error">("loading");
  const [behaviour, setBehaviour] = useState<{
    incidents: Array<{ id: string; occurredAt: string; categoryName: string | null; severity: string; status: string }>;
    positives: Array<{ id: string; occurredOn: string; categoryName: string | null }>;
  } | null>(null);
  const [pastoral, setPastoral] = useState<{
    concerns: Array<{ id: string; concernOn: string; categoryName: string | null; priority: string; status: string; summary: string }>;
  } | null>(null);
  const [safeguardingLink, setSafeguardingLink] = useState(false);
  const [years, setYears] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [classes, setClasses] = useState<Option[]>([]);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState("");
  const loadSeq = useRef(0);

  async function load() {
    const seq = ++loadSeq.current;
    const studentId = params.id;
    const [detail, yr, yg, cl] = await Promise.all([
      api<Detail>(`/api/v1/students/${studentId}`),
      api<{ academicYears: Option[] }>("/api/v1/academic-years"),
      api<{ yearGroups: Option[] }>("/api/v1/year-groups"),
      api<{ classes: Option[] }>("/api/v1/classes"),
    ]);
    if (seq !== loadSeq.current) return;
    setData(detail);
    setYears(yr.academicYears);
    setGroups(yg.yearGroups);
    setClasses(cl.classes);
    if (detail.attendanceSummary) {
      try {
        const history = await api<AttendanceHistory>(`/api/v1/attendance/students/${studentId}`);
        if (seq !== loadSeq.current) return;
        setAttendance(history);
      } catch {
        if (seq !== loadSeq.current) return;
        setAttendance(null);
      }
    } else {
      setAttendance(null);
    }
    try {
      const learningHistory = await api<LearningHistory>(`/api/v1/students/${studentId}/learning`);
      if (seq !== loadSeq.current) return;
      setLearning(learningHistory);
      setLearningStatus("ready");
    } catch {
      if (seq !== loadSeq.current) return;
      setLearning(null);
      setLearningStatus("error");
    }
    try {
      const behaviourHistory = await api<{
        incidents: Array<{ id: string; occurredAt: string; categoryName: string | null; severity: string; status: string }>;
        positives: Array<{ id: string; occurredOn: string; categoryName: string | null }>;
      }>(`/api/v1/students/${studentId}/behaviour`);
      if (seq !== loadSeq.current) return;
      setBehaviour(behaviourHistory);
    } catch {
      if (seq !== loadSeq.current) return;
      setBehaviour(null);
    }
    try {
      const pastoralHistory = await api<{
        concerns: Array<{ id: string; concernOn: string; categoryName: string | null; priority: string; status: string; summary: string }>;
      }>(`/api/v1/students/${studentId}/pastoral`);
      if (seq !== loadSeq.current) return;
      setPastoral(pastoralHistory);
    } catch {
      if (seq !== loadSeq.current) return;
      setPastoral(null);
    }
    try {
      await api(`/api/v1/students/${studentId}/safeguarding`);
      if (seq !== loadSeq.current) return;
      setSafeguardingLink(true);
    } catch {
      if (seq !== loadSeq.current) return;
      setSafeguardingLink(false);
    }
    try {
      const academicHistory = await api<{
        results: Array<{
          assessmentTitle: string | null;
          subjectName: string | null;
          assessmentDate: string | null;
          percentage: number | null;
          gradeLabel: string | null;
          teacherJudgement: string | null;
          releasedToStudent: boolean;
          releasedToParent: boolean;
        }>;
        targets: Array<{ subjectName: string | null; targetLabel: string | null; baselineLabel: string | null }>;
        reports: Array<{ reportingPeriodName: string | null; status: string }>;
      }>(`/api/v1/students/${studentId}/academic`);
      if (seq !== loadSeq.current) return;
      setAcademic(academicHistory);
      setAcademicStatus("ready");
    } catch {
      if (seq !== loadSeq.current) return;
      setAcademic(null);
      setAcademicStatus("error");
    }
  }

  useEffect(() => {
    setData(null);
    setAttendance(null);
    setLearning(null);
    setLearningStatus("loading");
    setAcademic(null);
    setAcademicStatus("loading");
    setBehaviour(null);
    setPastoral(null);
    setSafeguardingLink(false);
    setError("");
    setInvite("");
    load().catch((err: Error) => setError(err.message));
    return () => {
      loadSeq.current += 1;
    };
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

      <h2>Learning</h2>
      {learningStatus === "loading" ? (
        <p className="muted">Loading learning history…</p>
      ) : learningStatus === "error" ? (
        <p className="muted">Unable to load learning history.</p>
      ) : learning && learning.items.length > 0 ? (
        <table>
          <thead>
            <tr><th>Work</th><th>Due</th><th>Status</th><th>Feedback</th></tr>
          </thead>
          <tbody>
            {learning.items.map((row) => (
              <tr key={row.assignmentId}>
                <td>
                  {row.title}
                  <div className="muted">{row.subjectName ?? row.workTypeName}</div>
                </td>
                <td>{row.dueAt ? new Date(row.dueAt).toLocaleString() : "—"}</td>
                <td>{row.submissionStatus.replaceAll("_", " ")}</td>
                <td>{row.mark?.score != null ? String(row.mark.score) : row.mark?.feedback ? "Feedback" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No assigned learning work recorded for this pupil.</p>
      )}

      <h2>Academic / Results</h2>
      {academicStatus === "loading" ? (
        <p className="muted">Loading formal assessment history…</p>
      ) : academicStatus === "error" ? (
        <p className="muted">Unable to load formal assessment history.</p>
      ) : academic && academic.results.length > 0 ? (
        <table>
          <thead>
            <tr><th>Assessment</th><th>Date</th><th>Result</th><th>Release</th></tr>
          </thead>
          <tbody>
            {academic.results.map((row, index) => (
              <tr key={`${row.assessmentTitle}-${index}`}>
                <td>
                  {row.assessmentTitle}
                  <div className="muted">{row.subjectName}</div>
                </td>
                <td>{row.assessmentDate ?? "—"}</td>
                <td>
                  {row.gradeLabel ?? row.teacherJudgement ?? (row.percentage != null ? `${row.percentage}%` : "—")}
                </td>
                <td>
                  {row.releasedToStudent ? "student" : "—"}
                  {row.releasedToParent ? " / parent" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No formal assessment results recorded for this pupil.</p>
      )}
      {data.behaviourSummary ? (
        <div className="cards">
          <div className="card"><span>Behaviour incidents</span><strong>{data.behaviourSummary.incidentCount}</strong></div>
          <div className="card"><span>Open incidents</span><strong>{data.behaviourSummary.openIncidents}</strong></div>
          <div className="card"><span>Achievements</span><strong>{data.behaviourSummary.positiveCount}</strong></div>
        </div>
      ) : null}
      {behaviour && (behaviour.incidents.length > 0 || behaviour.positives.length > 0) ? (
        <>
          <h2>Behaviour</h2>
          <table>
            <thead>
              <tr><th>When</th><th>Category</th><th>Severity</th><th>Status</th></tr>
            </thead>
            <tbody>
              {behaviour.incidents.slice(0, 12).map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.occurredAt).toLocaleString()}</td>
                  <td>{row.categoryName}</td>
                  <td>{row.severity}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {data.pastoralSummary ? (
        <>
          <h2>Pastoral</h2>
          <p className="muted">
            Open concerns: {data.pastoralSummary.openCount}
            {data.pastoralSummary.latestPriority ? ` · latest priority ${data.pastoralSummary.latestPriority}` : ""}
          </p>
          {pastoral && pastoral.concerns.length > 0 ? (
            <ul>
              {pastoral.concerns.map((row) => (
                <li key={row.id}>
                  {row.concernOn} · {row.categoryName} · {row.priority} · {row.status} — {row.summary}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {safeguardingLink ? (
        <p>
          <a href={`/school/safeguarding?studentId=${data.student.id}`}>Open safeguarding records</a>
        </p>
      ) : null}

      {academic && academic.targets.length > 0 ? (
        <>
          <h3>Targets</h3>
          <table>
            <thead>
              <tr><th>Subject</th><th>Target</th><th>Baseline</th></tr>
            </thead>
            <tbody>
              {academic.targets.map((row, index) => (
                <tr key={`${row.subjectName}-${index}`}>
                  <td>{row.subjectName}</td>
                  <td>{row.targetLabel ?? "—"}</td>
                  <td>{row.baselineLabel ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {academic && academic.reports.length > 0 ? (
        <>
          <h3>Reports</h3>
          <table>
            <thead>
              <tr><th>Period</th><th>Status</th></tr>
            </thead>
            <tbody>
              {academic.reports.map((row, index) => (
                <tr key={`${row.reportingPeriodName}-${index}`}>
                  <td>{row.reportingPeriodName}</td>
                  <td>{row.status}</td>
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
