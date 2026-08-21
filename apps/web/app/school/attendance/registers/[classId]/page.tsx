"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../../lib/api";

type SessionType = { id: string; key: string; name: string };
type Code = { id: string; code: string; name: string; category: string };
type Pupil = {
  studentProfileId: string;
  legalName: string;
  mark: { codeId: string; lateMinutes: number | null; reason: string | null } | null;
};

export default function ClassRegisterPage() {
  const params = useParams<{ classId: string }>();
  const [date, setDate] = useState("");
  const [sessions, setSessions] = useState<SessionType[]>([]);
  const [sessionTypeId, setSessionTypeId] = useState("");
  const [codes, setCodes] = useState<Code[]>([]);
  const [pupils, setPupils] = useState<Pupil[]>([]);
  const [className, setClassName] = useState("Register");
  const [draft, setDraft] = useState<Record<string, { codeId: string; lateMinutes: string; reason: string }>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load(nextDate = date, nextSession = sessionTypeId) {
    const [sessionBody, codeBody, classesBody] = await Promise.all([
      api<{ sessionTypes: SessionType[] }>("/api/v1/attendance/session-types"),
      api<{ codes: Code[] }>("/api/v1/attendance/codes"),
      api<{ suggestedDate?: string }>("/api/v1/attendance/my-classes"),
    ]);
    setSessions(sessionBody.sessionTypes);
    setCodes(codeBody.codes);
    const session = nextSession || sessionBody.sessionTypes[0]?.id || "";
    setSessionTypeId(session);
    if (!session) return;
    const useDate = nextDate || classesBody.suggestedDate || "";
    if (!useDate) return;
    if (useDate !== date) setDate(useDate);
    const register = await api<{
      class: { name: string };
      pupils: Pupil[];
    }>(`/api/v1/attendance/registers?classId=${params.classId}&date=${useDate}&sessionTypeId=${session}`);
    setClassName(register.class.name);
    setPupils(register.pupils);
    const nextDraft: Record<string, { codeId: string; lateMinutes: string; reason: string }> = {};
    for (const pupil of register.pupils) {
      nextDraft[pupil.studentProfileId] = {
        codeId: pupil.mark?.codeId ?? "",
        lateMinutes: pupil.mark?.lateMinutes != null ? String(pupil.mark.lateMinutes) : "",
        reason: pupil.mark?.reason ?? "",
      };
    }
    setDraft(nextDraft);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.classId]);

  async function reload(event: FormEvent) {
    event.preventDefault();
    setError("");
    await load(date, sessionTypeId);
  }

  async function markAllPresent() {
    setError("");
    setMessage("");
    await api("/api/v1/attendance/registers", {
      method: "PUT",
      body: JSON.stringify({
        classId: params.classId,
        date,
        sessionTypeId,
        markAllPresent: true,
        marks: Object.entries(draft)
          .filter(([, value]) => value.codeId)
          .map(([studentProfileId, value]) => ({
            studentProfileId,
            codeId: value.codeId,
            lateMinutes: value.lateMinutes ? Number(value.lateMinutes) : null,
            reason: value.reason || null,
          })),
      }),
    });
    setMessage("Register saved.");
    await load(date, sessionTypeId);
  }

  async function save() {
    setError("");
    setMessage("");
    await api("/api/v1/attendance/registers", {
      method: "PUT",
      body: JSON.stringify({
        classId: params.classId,
        date,
        sessionTypeId,
        marks: Object.entries(draft)
          .filter(([, value]) => value.codeId)
          .map(([studentProfileId, value]) => ({
            studentProfileId,
            codeId: value.codeId,
            lateMinutes: value.lateMinutes ? Number(value.lateMinutes) : null,
            reason: value.reason || null,
          })),
      }),
    });
    setMessage("Register saved.");
    await load(date, sessionTypeId);
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>{className} register</h1>
      <form className="card form-grid" onSubmit={reload}>
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>
          Session
          <select value={sessionTypeId} onChange={(e) => setSessionTypeId(e.target.value)}>
            {sessions.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
        <div><button type="submit">Load</button></div>
      </form>
      <div className="toolbar">
        <button type="button" onClick={() => markAllPresent().catch((err: Error) => setError(err.message))}>
          Mark all present
        </button>
        <button type="button" className="secondary" onClick={() => save().catch((err: Error) => setError(err.message))}>
          Save exceptions
        </button>
      </div>
      {message ? <p>{message}</p> : null}
      <table>
        <thead>
          <tr><th>Pupil</th><th>Mark</th><th>Late minutes</th><th>Reason</th></tr>
        </thead>
        <tbody>
          {pupils.map((pupil) => {
            const value = draft[pupil.studentProfileId] ?? { codeId: "", lateMinutes: "", reason: "" };
            return (
              <tr key={pupil.studentProfileId}>
                <td>{pupil.legalName}</td>
                <td>
                  <select
                    value={value.codeId}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        [pupil.studentProfileId]: { ...value, codeId: e.target.value },
                      }))
                    }
                  >
                    <option value="">Not marked</option>
                    {codes.map((code) => (
                      <option key={code.id} value={code.id}>{code.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={value.lateMinutes}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        [pupil.studentProfileId]: { ...value, lateMinutes: e.target.value },
                      }))
                    }
                  />
                </td>
                <td>
                  <input
                    value={value.reason}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        [pupil.studentProfileId]: { ...value, reason: e.target.value },
                      }))
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
