"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../../lib/api";

type SessionType = { id: string; key: string; name: string };
type Code = { id: string; code: string; name: string; category: string };
type Pupil = {
  studentProfileId: string;
  legalName: string;
  mark: { codeId: string; lateMinutes: number | null; reason: string | null } | null;
};
type Draft = Record<string, { codeId: string; lateMinutes: string; reason: string }>;

export default function ClassRegisterPage() {
  const params = useParams<{ classId: string }>();
  const [date, setDate] = useState("");
  const [sessions, setSessions] = useState<SessionType[]>([]);
  const [sessionTypeId, setSessionTypeId] = useState("");
  const [codes, setCodes] = useState<Code[]>([]);
  const [pupils, setPupils] = useState<Pupil[]>([]);
  const [className, setClassName] = useState("Register");
  const [draft, setDraft] = useState<Draft>({});
  const [loadedDate, setLoadedDate] = useState("");
  const [loadedSessionTypeId, setLoadedSessionTypeId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const loadSeq = useRef(0);

  async function load(nextDate = date, nextSession = sessionTypeId) {
    const seq = ++loadSeq.current;
    const [sessionBody, codeBody, classesBody] = await Promise.all([
      api<{ sessionTypes: SessionType[] }>("/api/v1/attendance/session-types"),
      api<{ codes: Code[] }>("/api/v1/attendance/codes"),
      api<{ suggestedDate?: string }>("/api/v1/attendance/my-classes"),
    ]);
    if (seq !== loadSeq.current) return;
    setSessions(sessionBody.sessionTypes);
    setCodes(codeBody.codes);
    const session = nextSession || sessionBody.sessionTypes[0]?.id || "";
    if (seq !== loadSeq.current) return;
    setSessionTypeId(session);
    if (!session) return;
    const useDate = nextDate || classesBody.suggestedDate || "";
    if (!useDate) return;
    if (seq !== loadSeq.current) return;
    setDate(useDate);
    const register = await api<{
      class: { name: string };
      pupils: Pupil[];
    }>(`/api/v1/attendance/registers?classId=${params.classId}&date=${useDate}&sessionTypeId=${session}`);
    if (seq !== loadSeq.current) return;
    setClassName(register.class.name);
    setPupils(register.pupils);
    const nextDraft: Draft = {};
    for (const pupil of register.pupils) {
      nextDraft[pupil.studentProfileId] = {
        codeId: pupil.mark?.codeId ?? "",
        lateMinutes: pupil.mark?.lateMinutes != null ? String(pupil.mark.lateMinutes) : "",
        reason: pupil.mark?.reason ?? "",
      };
    }
    setDraft(nextDraft);
    setLoadedDate(useDate);
    setLoadedSessionTypeId(session);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
    return () => {
      loadSeq.current += 1;
    };
  }, [params.classId]);

  async function reload(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    await load(date, sessionTypeId);
  }

  function assertLoadedRegister() {
    if (!loadedDate || !loadedSessionTypeId) {
      throw new Error("Load a register before saving.");
    }
    if (date !== loadedDate || sessionTypeId !== loadedSessionTypeId) {
      throw new Error("Load this date and session before saving.");
    }
  }

  function marksFromDraft() {
    return Object.entries(draft)
      .filter(([, value]) => value.codeId)
      .map(([studentProfileId, value]) => ({
        studentProfileId,
        codeId: value.codeId,
        lateMinutes: value.lateMinutes ? Number(value.lateMinutes) : null,
        reason: value.reason || null,
      }));
  }

  async function markAllPresent() {
    setError("");
    setMessage("");
    assertLoadedRegister();
    await api("/api/v1/attendance/registers", {
      method: "PUT",
      body: JSON.stringify({
        classId: params.classId,
        date: loadedDate,
        sessionTypeId: loadedSessionTypeId,
        markAllPresent: true,
        marks: marksFromDraft(),
      }),
    });
    setMessage("Register saved.");
    await load(loadedDate, loadedSessionTypeId);
  }

  async function save() {
    setError("");
    setMessage("");
    assertLoadedRegister();
    await api("/api/v1/attendance/registers", {
      method: "PUT",
      body: JSON.stringify({
        classId: params.classId,
        date: loadedDate,
        sessionTypeId: loadedSessionTypeId,
        marks: marksFromDraft(),
      }),
    });
    setMessage("Register saved.");
    await load(loadedDate, loadedSessionTypeId);
  }

  const canSave = Boolean(loadedDate) && date === loadedDate && sessionTypeId === loadedSessionTypeId;

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>{className} register</h1>
      <form className="card form-grid" onSubmit={(event) => reload(event).catch((err: Error) => setError(err.message))}>
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
      {!canSave ? <p className="muted">Load this date and session before taking the register.</p> : null}
      <div className="toolbar">
        <button type="button" disabled={!canSave} onClick={() => markAllPresent().catch((err: Error) => setError(err.message))}>
          Mark all present
        </button>
        <button type="button" className="secondary" disabled={!canSave} onClick={() => save().catch((err: Error) => setError(err.message))}>
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
                      setDraft((current) => {
                        const previous = current[pupil.studentProfileId] ?? { codeId: "", lateMinutes: "", reason: "" };
                        return {
                          ...current,
                          [pupil.studentProfileId]: { ...previous, codeId: e.target.value },
                        };
                      })
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
                      setDraft((current) => {
                        const previous = current[pupil.studentProfileId] ?? { codeId: "", lateMinutes: "", reason: "" };
                        return {
                          ...current,
                          [pupil.studentProfileId]: { ...previous, lateMinutes: e.target.value },
                        };
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    value={value.reason}
                    onChange={(e) =>
                      setDraft((current) => {
                        const previous = current[pupil.studentProfileId] ?? { codeId: "", lateMinutes: "", reason: "" };
                        return {
                          ...current,
                          [pupil.studentProfileId]: { ...previous, reason: e.target.value },
                        };
                      })
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
