"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../lib/api";

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
      .catch((err: Error) => setError(err.message));
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
    search().catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>School attendance</h1>
      <form className="card form-grid" onSubmit={search}>
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>
          Session
          <select value={sessionTypeId} onChange={(e) => setSessionTypeId(e.target.value)}>
            <option value="">All</option>
            {sessions.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>
          Year group
          <select value={yearGroupId} onChange={(e) => setYearGroupId(e.target.value)}>
            <option value="">All</option>
            {groups.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>
          Class
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All</option>
            {classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>
          Code
          <select value={codeId} onChange={(e) => setCodeId(e.target.value)}>
            <option value="">All</option>
            {codes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <div><button type="submit">Filter</button></div>
      </form>
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Pupil</th><th>Session</th><th>Mark</th><th>Recorded by</th><th>Corrected by</th><th></th>
          </tr>
        </thead>
        <tbody>
          {marks.map((row) => (
            <tr key={row.id}>
              <td>{row.date}</td>
              <td><Link href={`/school/students/${row.studentProfileId}`}>{row.studentLegalName}</Link></td>
              <td>{row.sessionName}</td>
              <td>{row.codeName}</td>
              <td>{row.recordedByName ?? "—"}</td>
              <td>{row.lastCorrectedByName ?? "—"}</td>
              <td><Link href={`/school/attendance/marks/${row.id}`}>Correct</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
