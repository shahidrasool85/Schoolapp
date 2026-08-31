"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "../../../../../lib/api";
import { isoWeekRange, startOfIsoWeek } from "../../../../../lib/dates";

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

export default function ParentChildTimetablePage() {
  const params = useParams<{ id: string }>();
  const [from, setFrom] = useState(() => startOfIsoWeek("2026-09-07"));
  const [items, setItems] = useState<Occurrence[]>([]);
  const [error, setError] = useState("");

  async function load(nextFrom = from) {
    if (!params.id) return;
    const week = isoWeekRange(nextFrom);
    const body = await api<{ occurrences: Occurrence[] }>(
      `/api/v1/parent/children/${params.id}/timetable?week=${week.from}&from=${week.from}`,
    );
    setItems(body.occurrences);
  }

  useEffect(() => {
    load().catch((err: Error) => {
      setError(err instanceof ApiError && err.status === 404 ? "This timetable is not available." : err.message);
    });
  }, [params.id]);

  return (
    <>
      <p>
        <Link href={`/parent/children/${params.id}`}>Back to child</Link>
      </p>
      <h1>Timetable</h1>
      <form
        className="toolbar"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          load().catch((err: Error) => setError(err.message));
        }}
      >
        <label>
          Week commencing
          <input type="date" value={from} onChange={(event) => setFrom(startOfIsoWeek(event.target.value))} />
        </label>
        <button type="submit">Show week</button>
      </form>
      {error ? <p className="error">{error}</p> : null}
      {items.length === 0 && !error ? <p>No lessons in this week.</p> : null}
      {items.length > 0 ? (
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
      ) : null}
    </>
  );
}
