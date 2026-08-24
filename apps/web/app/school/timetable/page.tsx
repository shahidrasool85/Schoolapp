"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Occurrence = {
  entryId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  className: string;
  subjectName: string | null;
  roomName: string | null;
  status: string;
  covered: boolean;
  teachers: Array<{ fullName: string; isCover: boolean }>;
};

type Overview = {
  today: string;
  week: { from: string; to: string };
  counts: { lessonsThisWeek: number; coversThisWeek: number; rooms: number };
  todayLessons: Occurrence[];
};

export default function TimetableOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Overview>("/api/v1/timetable/overview")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>Timetable</h1>
      <p className="muted">
        Week {data.week.from} to {data.week.to}
      </p>
      <div className="cards">
        <Link className="card" href="/school/timetable/schedule">
          <span>Lessons this week</span>
          <strong>{data.counts.lessonsThisWeek}</strong>
        </Link>
        <Link className="card" href="/school/timetable/cover">
          <span>Cover this week</span>
          <strong>{data.counts.coversThisWeek}</strong>
        </Link>
        <Link className="card" href="/school/timetable/rooms">
          <span>Rooms</span>
          <strong>{data.counts.rooms}</strong>
        </Link>
      </div>
      <h2>Today</h2>
      {data.todayLessons.length === 0 ? (
        <p>No lessons are scheduled for today. Open the timetable to view a school week.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Class</th>
              <th>Subject</th>
              <th>Room</th>
              <th>Teacher</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.todayLessons.map((lesson) => (
              <tr key={`${lesson.entryId}-${lesson.date}`}>
                <td>
                  {lesson.startsAt.slice(0, 5)}–{lesson.endsAt.slice(0, 5)}
                </td>
                <td>{lesson.className}</td>
                <td>{lesson.subjectName ?? lesson.status}</td>
                <td>{lesson.roomName ?? "—"}</td>
                <td>{lesson.teachers.map((teacher) => teacher.fullName).join(", ") || "—"}</td>
                <td>{lesson.covered ? "Cover" : lesson.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>
        <Link href="/school/timetable/school-day">School day / periods</Link>
        {" · "}
        <Link href="/school/timetable/schedule">Class / teacher / room views</Link>
        {" · "}
        <Link href="/school/timetable/mine">My Timetable</Link>
      </p>
    </>
  );
}
