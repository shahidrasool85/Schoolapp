"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Alert, DataTable, EmptyState, FilterBar, PageHeader, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Mark = {
  id: string;
  date: string;
  studentLegalName: string | null;
  studentProfileId: string;
  sessionName: string | null;
  codeName: string | null;
  category: string | null;
  recordedByName: string | null;
  lastCorrectedByName: string | null;
};

type SessionType = { id: string; name: string };
type YearGroup = { id: string; name: string };
type ClassRow = { id: string; name: string };
type Code = { id: string; name: string; category: string };

export default function SchoolAttendancePage() {
  const [date, setDate] = useState("");
  const [sessionTypeId, setSessionTypeId] = useState("");
  const [yearGroupId, setYearGroupId] = useState("");
  const [classId, setClassId] = useState("");
  const [codeId, setCodeId] = useState("");
  const [sessions, setSessions] = useState<SessionType[]>([]);
  const [groups, setGroups] = useState<YearGroup[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [codes, setCodes] = useState<Code[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<{ sessionTypes: SessionType[] }>("/api/v1/attendance/session-types"),
      api<{ yearGroups: YearGroup[] }>("/api/v1/year-groups"),
      api<{ classes: ClassRow[] }>("/api/v1/classes"),
      api<{ codes: Code[] }>("/api/v1/attendance/codes"),
    ])
      .then(([st, yg, cl, cd]) => {
        setSessions(st.sessionTypes);
        setGroups(yg.yearGroups);
        setClasses(cl.classes);
        setCodes(cd.codes);
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not load attendance filters.")));
  }, []);

  async function search(event?: FormEvent) {
    event?.preventDefault();
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (sessionTypeId) params.set("sessionTypeId", sessionTypeId);
    if (yearGroupId) params.set("yearGroupId", yearGroupId);
    if (classId) params.set("classId", classId);
    if (codeId) params.set("codeId", codeId);
    const body = await api<{ marks: Mark[] }>(`/api/v1/attendance/marks?${params.toString()}`);
    setMarks(body.marks);
  }

  useEffect(() => {
    search().catch((err: Error) => setError(userFacingError(err, "Could not load attendance marks.")));
  }, []);

  return (
    <>
      <PageHeader title="School attendance" description="Review and correct marks across classes you are authorised to see." />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <FilterBar onSubmit={(event) => search(event).catch((err: Error) => setError(userFacingError(err)))} actions={<button type="submit">Filter</button>}>
        <label htmlFor="attendance-date">
          Date
          <input id="attendance-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label htmlFor="attendance-session">
          Session
          <select id="attendance-session" value={sessionTypeId} onChange={(e) => setSessionTypeId(e.target.value)}>
            <option value="">All</option>
            {sessions.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="attendance-year-group">
          Year group
          <select id="attendance-year-group" value={yearGroupId} onChange={(e) => setYearGroupId(e.target.value)}>
            <option value="">All</option>
            {groups.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="attendance-class">
          Class
          <select id="attendance-class" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All</option>
            {classes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="attendance-code">
          Code
          <select id="attendance-code" value={codeId} onChange={(e) => setCodeId(e.target.value)}>
            <option value="">All</option>
            {codes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
      </FilterBar>
      {marks.length === 0 ? (
        <EmptyState title="No marks in this view" description="Try another date, class, or attendance code." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Date</th>
              <th>Pupil</th>
              <th>Session</th>
              <th>Mark</th>
              <th>Recorded by</th>
              <th>Corrected by</th>
              <th></th>
            </>
          }
        >
          {marks.map((row) => (
            <tr key={row.id}>
              <td>{row.date}</td>
              <td>
                <Link href={`/school/students/${row.studentProfileId}`}>{row.studentLegalName}</Link>
              </td>
              <td>{row.sessionName}</td>
              <td>
                <StatusBadge status={row.codeName} />
              </td>
              <td>{row.recordedByName ?? "—"}</td>
              <td>{row.lastCorrectedByName ?? "—"}</td>
              <td>
                <Link href={`/school/attendance/marks/${row.id}`}>Correct</Link>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
