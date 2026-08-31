"use client";

import { FormEvent, useEffect, useState } from "react";
import { Alert, EmptyState, FilterBar, PageHeader, StatusBadge } from "../../../components/ui";
import { api } from "../../../lib/api";
import { isoWeekRange, startOfIsoWeek } from "../../../lib/dates";
import { userFacingError } from "../../../lib/errors";

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
  const [from, setFrom] = useState(() => startOfIsoWeek("2026-09-07"));
  const [items, setItems] = useState<Occurrence[]>([]);
  const [error, setError] = useState("");

  async function load(nextFrom = from) {
    const week = isoWeekRange(nextFrom);
    const body = await api<{ occurrences: Occurrence[] }>(
      `/api/v1/student/timetable?week=${week.from}&from=${week.from}`,
    );
    setItems(body.occurrences);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load your timetable.")));
  }, []);

  return (
    <>
      <PageHeader title="My Timetable" description="Your lessons for the selected week." />
      <FilterBar
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          load().catch((err: Error) => setError(userFacingError(err)));
        }}
        actions={<button type="submit">Show week</button>}
      >
        <label htmlFor="student-week">
          Week commencing
          <input
            id="student-week"
            type="date"
            value={from}
            onChange={(event) => setFrom(startOfIsoWeek(event.target.value))}
          />
        </label>
      </FilterBar>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {items.length === 0 ? (
        <EmptyState title="No lessons this week" description="When the school publishes your timetable, lessons will appear here." />
      ) : (
        <div className="stack">
          {DAYS.map((day, index) => {
            const dayItems = items.filter((lesson) => lesson.weekday === index + 1);
            if (dayItems.length === 0) return null;
            return (
              <section key={day} className="section-card">
                <h2>{day}</h2>
                <div className="lesson-cards">
                  {dayItems.map((lesson) => (
                    <article key={`${lesson.date}-${lesson.startsAt}-${lesson.className}`} className="lesson-card">
                      <div className="lesson-time">
                        {lesson.startsAt.slice(0, 5)}–{lesson.endsAt.slice(0, 5)}
                      </div>
                      <div>
                        <strong>{lesson.subjectName ?? lesson.className}</strong>
                        <p className="muted">
                          {lesson.teachers.map((teacher) => teacher.fullName).join(", ") || "Teacher TBC"}
                          {lesson.roomName ? ` · ${lesson.roomName}` : ""}
                        </p>
                      </div>
                      <StatusBadge status={lesson.status} />
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
