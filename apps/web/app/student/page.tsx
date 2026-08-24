"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { ComingLaterCard } from "../../components/coming-later";
import type { ComingLater, PortalChild, PortalSchool } from "../../lib/portal";

type Lesson = {
  startsAt: string;
  endsAt: string;
  subjectName: string | null;
  className: string;
  roomName: string | null;
  status: string;
};

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
  const [error, setError] = useState("");

  useEffect(() => {
    api<Dashboard>("/api/v1/student/dashboard")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>{data.welcome.title}</h1>
      <p className="muted">{data.welcome.message}</p>
      <div className="card">
        <p>
          <strong>{data.student.displayName}</strong>
        </p>
        <p>{data.school.name}</p>
        <p>
          {data.student.currentYearGroupName ?? "Year group not set"}
          {data.student.currentFormClassName ? ` · ${data.student.currentFormClassName}` : ""}
        </p>
      </div>
      <div className="cards student-tiles">
        <Link className="card" href="/student/timetable">
          <strong>My Timetable</strong>
          <p>
            {data.timetable?.nextLesson
              ? `Next: ${data.timetable.nextLesson.subjectName ?? data.timetable.nextLesson.className} ${data.timetable.nextLesson.startsAt.slice(0, 5)}`
              : data.timetable?.today.length
                ? `${data.timetable.today.length} lessons today`
                : "See this week's lessons."}
          </p>
        </Link>
        <Link className="card" href="/student/attendance">
          <strong>Attendance</strong>
          <p>See your AM and PM marks.</p>
        </Link>
        <Link className="card" href="/student/learning">
          <strong>My Learning</strong>
          <p>Assigned work, due dates and feedback.</p>
        </Link>
        <Link className="card" href="/student/notices">
          <strong>Notices</strong>
          <p>School announcements for you.</p>
        </Link>
        <Link className="card" href="/student/calendar">
          <strong>Calendar</strong>
          <p>Your school events.</p>
        </Link>
        <Link className="card" href="/student/results">
          <strong>Results</strong>
          <p>Released formal results and published reports.</p>
        </Link>
        <ComingLaterCard title="Challenges" message={data.sections.challenges?.message} />
        <ComingLaterCard title="Achievements" message={data.sections.achievements?.message} />
        <Link className="card" href="/student/notifications">
          <strong>Notifications</strong>
          <p>
            {data.notifications.unreadCount === 0
              ? "Nothing new right now."
              : `${data.notifications.unreadCount} new`}
          </p>
        </Link>
      </div>
    </>
  );
}
