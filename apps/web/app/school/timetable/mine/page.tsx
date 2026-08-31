"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Alert, EmptyState, FilterBar, PageHeader, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { isoWeekRange, startOfIsoWeek } from "../../../../lib/dates";
import { userFacingError } from "../../../../lib/errors";

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
  const [from, setFrom] = useState(() => startOfIsoWeek("2026-09-07"));
  const [items, setItems] = useState<Occurrence[]>([]);
  const [error, setError] = useState("");
  const [registerError, setRegisterError] = useState("");

  async function load(nextFrom = from) {
    const week = isoWeekRange(nextFrom);
    const body = await api<{ occurrences: Occurrence[] }>(
      `/api/v1/timetable/occurrences?week=${week.from}&from=${week.from}&to=${week.to}&mine=true&includeCancelled=true`,
    );
    setItems(body.occurrences);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load your timetable.")));
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
      <PageHeader title="My Timetable" description="Your assigned lessons for the selected week, with quick attendance and learning links." />
      <FilterBar
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          load().catch((err: Error) => setError(userFacingError(err)));
        }}
        actions={<button type="submit">Show week</button>}
      >
        <label htmlFor="timetable-week">
          Week commencing
          <input
            id="timetable-week"
            type="date"
            value={from}
            onChange={(event) => setFrom(startOfIsoWeek(event.target.value))}
          />
        </label>
      </FilterBar>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {registerError ? <Alert tone="danger">{registerError}</Alert> : null}
      {items.length === 0 ? (
        <EmptyState
          title="No lessons this week"
          description="Nothing is assigned to you for this week. Try another week or open the school timetable."
          action={<Link href="/school/timetable/schedule">School timetable</Link>}
        />
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
                    <article key={`${lesson.entryId}-${lesson.date}`} className="lesson-card">
                      <div className="lesson-time">
                        {lesson.startsAt.slice(0, 5)}–{lesson.endsAt.slice(0, 5)}
                      </div>
                      <div>
                        <strong>
                          {lesson.subjectName ?? "Lesson"} · {lesson.className}
                        </strong>
                        <p className="muted">
                          {lesson.roomName ?? "No room"}
                          {lesson.covered ? " · Cover" : ""}
                        </p>
                      </div>
                      {lesson.status === "cancelled" ? (
                        <StatusBadge status="cancelled" />
                      ) : (
                        <div className="page-header-actions">
                          <button
                            type="button"
                            onClick={() =>
                              takeAttendance(lesson.entryId, lesson.date).catch((err: Error) =>
                                setRegisterError(userFacingError(err)),
                              )
                            }
                          >
                            Take attendance
                          </button>
                          <Link className="button secondary" href={`/school/teaching/assignments?classId=${lesson.classId}`}>
                            Learning
                          </Link>
                        </div>
                      )}
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
