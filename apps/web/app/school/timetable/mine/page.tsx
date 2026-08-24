"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Occurrence = {
  entryId: string;
  date: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  classId: string;
  className: string;
  subjectName: string | null;
  roomName: string | null;
  status: string;
  covered: boolean;
  teachers: Array<{ fullName: string; isCover: boolean }>;
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function MyTimetablePage() {
  const [from, setFrom] = useState("2026-09-07");
  const [items, setItems] = useState<Occurrence[]>([]);
  const [error, setError] = useState("");
  const [registerError, setRegisterError] = useState("");

  async function load(nextFrom = from) {
    const to = addDays(nextFrom, 6);
    const body = await api<{ occurrences: Occurrence[] }>(
      `/api/v1/timetable/occurrences?from=${nextFrom}&to=${to}&mine=true&includeCancelled=true`,
    );
    setItems(body.occurrences);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function takeAttendance(entryId: string, date: string) {
    setRegisterError("");
    const body = await api<{ registerPath: string }>("/api/v1/timetable/occurrences/attendance-register", {
      method: "POST",
      body: JSON.stringify({ entryId, date }),
    });
    window.location.href = body.registerPath;
  }

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
      {registerError ? <p className="error">{registerError}</p> : null}
      {items.length === 0 ? (
        <p>No lessons assigned to you in this week.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Class</th>
              <th>Subject</th>
              <th>Room</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((lesson) => (
              <tr key={`${lesson.entryId}-${lesson.date}`}>
                <td>
                  {DAYS[lesson.weekday - 1]} {lesson.startsAt.slice(0, 5)}–{lesson.endsAt.slice(0, 5)}
                </td>
                <td>{lesson.className}</td>
                <td>{lesson.subjectName ?? "—"}</td>
                <td>{lesson.roomName ?? "—"}</td>
                <td>{lesson.covered ? "Cover" : lesson.status}</td>
                <td>
                  {lesson.status === "cancelled" ? null : (
                    <>
                      <Link href={`/school/classes?classId=${lesson.classId}`}>View class</Link>
                      {" · "}
                      <button
                        type="button"
                        onClick={() =>
                          takeAttendance(lesson.entryId, lesson.date).catch((err: Error) => setRegisterError(err.message))
                        }
                      >
                        Take attendance
                      </button>
                      {" · "}
                      <Link href={`/school/teaching/assignments?classId=${lesson.classId}`}>Learning</Link>
                    </>
                  )}
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
