"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../../../../lib/api";

type Entry = { id: string; className: string | null; weekday: number; startsAt: string; subjectName: string | null };
type Staff = { id: string; fullName?: string; name?: string };
type Cover = {
  id: string;
  date: string;
  originalStaffName: string | null;
  coveringStaffName: string | null;
  reason: string | null;
};
type Exception = { id: string; date: string; exceptionType: string; note: string | null };

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function CoverPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [covers, setCovers] = useState<Cover[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const [entryBody, staffBody, coverBody, exceptionBody] = await Promise.all([
      api<{ entries: Entry[] }>("/api/v1/timetable/entries"),
      api<{ staff: Staff[] }>("/api/v1/staff"),
      api<{ covers: Cover[] }>("/api/v1/timetable/covers?from=2026-09-01&to=2026-12-18"),
      api<{ exceptions: Exception[] }>("/api/v1/timetable/exceptions?from=2026-09-01&to=2026-12-18"),
    ]);
    setEntries(entryBody.entries);
    setStaff(staffBody.staff);
    setCovers(coverBody.covers);
    setExceptions(exceptionBody.exceptions);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function assignCover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/v1/timetable/covers", {
        method: "POST",
        body: JSON.stringify({
          timetableEntryId: String(form.get("timetableEntryId") ?? ""),
          date: String(form.get("date") ?? ""),
          coveringStaffProfileId: String(form.get("coveringStaffProfileId") ?? ""),
          reason: String(form.get("reason") ?? "") || null,
        }),
      });
      setMessage("Cover assigned. The permanent timetable was not changed.");
      event.currentTarget.reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }

  async function recordException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/v1/timetable/exceptions", {
        method: "POST",
        body: JSON.stringify({
          timetableEntryId: String(form.get("timetableEntryId") ?? "") || null,
          date: String(form.get("date") ?? ""),
          exceptionType: String(form.get("exceptionType") ?? "cancelled"),
          parentVisibleNote: String(form.get("parentVisibleNote") ?? "") || null,
        }),
      });
      setMessage("Change recorded against this date only.");
      event.currentTarget.reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }

  return (
    <>
      <h1>Cover / Changes</h1>
      <p className="muted">Cover and exceptions apply to a specific date. They do not rewrite the recurring timetable.</p>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p>{message}</p> : null}
      <form className="card form-grid" onSubmit={assignCover}>
        <h2>Assign cover</h2>
        <label>
          Lesson
          <select name="timetableEntryId" required>
            <option value="">Select lesson</option>
            {entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {DAYS[entry.weekday - 1]} {entry.startsAt.slice(0, 5)} {entry.className} {entry.subjectName ?? ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input name="date" type="date" required defaultValue="2026-09-07" />
        </label>
        <label>
          Covering teacher
          <select name="coveringStaffProfileId" required>
            <option value="">Select staff</option>
            {staff.map((item) => (
              <option key={item.id} value={item.id}>
                {item.fullName ?? item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reason
          <input name="reason" placeholder="Illness, training…" />
        </label>
        <div>
          <button type="submit">Assign cover</button>
        </div>
      </form>
      <form className="card form-grid" onSubmit={recordException}>
        <h2>Record a change</h2>
        <label>
          Lesson
          <select name="timetableEntryId">
            <option value="">Whole-school closure</option>
            {entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {DAYS[entry.weekday - 1]} {entry.startsAt.slice(0, 5)} {entry.className}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input name="date" type="date" required defaultValue="2026-09-11" />
        </label>
        <label>
          Type
          <select name="exceptionType" defaultValue="cancelled">
            <option value="cancelled">Cancelled</option>
            <option value="room_changed">Room changed</option>
            <option value="teacher_changed">Teacher changed</option>
            <option value="replacement">Replacement</option>
            <option value="school_closure">School closure</option>
            <option value="special_activity">Special activity</option>
          </select>
        </label>
        <label>
          Parent-visible note
          <input name="parentVisibleNote" placeholder="Shown on parent/student timetables" />
        </label>
        <div>
          <button type="submit">Save change</button>
        </div>
      </form>
      <h2>Recent cover</h2>
      {covers.length === 0 ? <p>No cover assignments in the autumn term.</p> : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Original</th>
              <th>Covering</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {covers.map((cover) => (
              <tr key={cover.id}>
                <td>{cover.date}</td>
                <td>{cover.originalStaffName}</td>
                <td>{cover.coveringStaffName}</td>
                <td>{cover.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Recent changes</h2>
      {exceptions.length === 0 ? <p>No date-specific changes recorded.</p> : (
        <ul>
          {exceptions.map((item) => (
            <li key={item.id}>
              {item.date} · {item.exceptionType}
              {item.note ? ` — ${item.note}` : ""}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
