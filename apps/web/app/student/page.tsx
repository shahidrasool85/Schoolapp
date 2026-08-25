"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ComingLaterCard } from "../../components/coming-later";
import { EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatCard } from "../../components/ui";
import { api } from "../../lib/api";
import { optionalApi, userFacingError } from "../../lib/errors";
import type { ComingLater, PortalChild, PortalSchool } from "../../lib/portal";

type Lesson = {
  startsAt: string;
  endsAt: string;
  subjectName: string | null;
  className: string;
  roomName: string | null;
  status: string;
};

type Assignment = {
  id: string;
  title: string;
  dueAt: string | null;
  status?: string;
  submissionStatus?: string;
};

type Notice = { id: string; title: string };

type Dashboard = {
  student: PortalChild;
  school: PortalSchool;
  welcome: { title: string; message: string };
  sections: Record<string, ComingLater>;
  timetable?: { today: Lesson[]; nextLesson: Lesson | null };
  notifications: { unreadCount: number };
};

export default function StudentHomePage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Dashboard>("/api/v1/student/dashboard")
      .then(setData)
      .catch((err: Error) => setError(userFacingError(err, "Could not load your home page.")));
    optionalApi<{ assignments: Assignment[] }>("/api/v1/student/assignments")
      .then((body) => setAssignments(body?.assignments ?? []))
      .catch(() => setAssignments([]));
    optionalApi<{ announcements: Notice[] }>("/api/v1/student/announcements")
      .then((body) => setNotices(body?.announcements ?? []))
      .catch(() => setNotices([]));
  }, []);

  if (error) return <PageError title="Home unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading your day…" />;

  const due = (assignments ?? []).filter((item) => item.dueAt).slice(0, 4);
  const today = data.timetable?.today ?? [];

  return (
    <>
      <PageHeader
        title={data.welcome.title}
        description={`${data.welcome.message} · ${data.student.currentYearGroupName ?? "Year group not set"}${
          data.student.currentFormClassName ? ` · ${data.student.currentFormClassName}` : ""
        }`}
      />
      <div className="stat-grid">
        <StatCard
          label="Next lesson"
          value={
            data.timetable?.nextLesson
              ? data.timetable.nextLesson.subjectName ?? data.timetable.nextLesson.className
              : today.length
                ? `${today.length} today`
                : "None"
          }
          hint={
            data.timetable?.nextLesson ? data.timetable.nextLesson.startsAt.slice(0, 5) : "Open your timetable"
          }
          href="/student/timetable"
        />
        <StatCard label="Homework due" value={due.length} href="/student/learning/due" />
        <StatCard label="Notices" value={(notices ?? []).length} href="/student/notices" />
        <StatCard
          label="Notifications"
          value={data.notifications.unreadCount}
          href="/student/notifications"
        />
      </div>
      <div className="dash-grid" style={{ marginTop: "1rem" }}>
        <SectionCard title="Today's timetable" actions={<Link href="/student/timetable">Full week</Link>}>
          {today.length === 0 ? (
            <EmptyState
              title="No lessons today"
              description="When the school day has lessons, they will show here."
              action={<Link href="/student/timetable">View timetable</Link>}
            />
          ) : (
            <div className="lesson-cards">
              {today.map((lesson) => (
                <article key={`${lesson.className}-${lesson.startsAt}`} className="lesson-card">
                  <div className="lesson-time">
                    {lesson.startsAt.slice(0, 5)}–{lesson.endsAt.slice(0, 5)}
                  </div>
                  <div>
                    <strong>{lesson.subjectName ?? lesson.className}</strong>
                    <p className="muted">{lesson.roomName ?? "Room TBC"}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </SectionCard>
        <div className="stack">
          <SectionCard title="Homework & assignments" actions={<Link href="/student/learning">My learning</Link>}>
            {due.length === 0 ? (
              <EmptyState title="Nothing due right now" description="Assigned work will appear here when teachers publish it." />
            ) : (
              <ul className="queue-list">
                {due.map((item) => (
                  <li key={item.id}>
                    <Link href={`/student/learning/assignments/${item.id}`}>
                      <strong>{item.title}</strong>
                      <span className="muted">
                        {item.dueAt ? `Due ${new Date(item.dueAt).toLocaleString("en-GB")}` : "Assigned"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Notices" actions={<Link href="/student/notices">All notices</Link>}>
            {(notices ?? []).length === 0 ? (
              <EmptyState title="No notices" description="School announcements for you will appear here." />
            ) : (
              <ul className="queue-list">
                {(notices ?? []).slice(0, 4).map((item) => (
                  <li key={item.id}>
                    <Link href={`/student/notices/${item.id}`}>
                      <strong>{item.title}</strong>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
      <div className="cards student-tiles" style={{ marginTop: "1rem" }}>
        <Link className="card" href="/student/results">
          <strong>Results & feedback</strong>
          <p className="muted">Released results and published reports.</p>
        </Link>
        <Link className="card" href="/student/activities">
          <strong>Activities</strong>
          <p className="muted">Clubs, trips and school events.</p>
        </Link>
        <Link className="card" href="/student/calendar">
          <strong>Calendar</strong>
          <p className="muted">Your school events.</p>
        </Link>
        <ComingLaterCard title="Challenges" message={data.sections.challenges?.message} />
      </div>
    </>
  );
}
