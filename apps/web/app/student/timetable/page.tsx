"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Occurrence = {
  date: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  className: string;
  subjectName: string | null;
  roomName: string | null;
  status: string;
  note: string | null;
  teachers: Array<{ fullName: string }>;
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function StudentTimetablePage() {
  const [from, setFrom] = useState("2026-09-07");
  const [items, setItems] = useState<Occurrence[]>([]);
  const [error, setError] = useState("");

  async function load(nextFrom = from) {
    const to = addDays(nextFrom, 6);
    const body = await api<{ occurrences: Occurrence[] }>(`/api/v1/student/timetable?from=${nextFrom}&to=${to}`);
    setItems(body.occurrences);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  return (
    <>
      <h1>My Timetable</h1>
      <form
        className="toolbar"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          load().catch((err: Error) => setError(err.message));
        }}
      >
        <label>
          Week starting
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <button type="submit">Show week</button>
      </form>
      {error ? <p className="error">{error}</p> : null}
      {items.length === 0 ? (
        <p>No lessons in this week.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Subject</th>
              <th>Teacher</th>
              <th>Room</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((lesson) => (
              <tr key={`${lesson.date}-${lesson.startsAt}-${lesson.className}`}>
                <td>
                  {DAYS[lesson.weekday - 1]} {lesson.date} {lesson.startsAt.slice(0, 5)}–{lesson.endsAt.slice(0, 5)}
                </td>
                <td>{lesson.subjectName ?? lesson.className}</td>
                <td>{lesson.teachers.map((teacher) => teacher.fullName).join(", ") || "—"}</td>
                <td>{lesson.roomName ?? "—"}</td>
                <td>
                  {lesson.status}
                  {lesson.note ? ` — ${lesson.note}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
