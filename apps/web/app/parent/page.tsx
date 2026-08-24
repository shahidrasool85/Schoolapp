"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { PortalChild, PortalSchool } from "../../lib/portal";

type NextLesson = {
  studentId: string;
  displayName: string;
  nextLesson: {
    date: string;
    startsAt: string;
    subjectName: string | null;
    className: string;
    status: string;
  } | null;
};

type Dashboard = {
  school: PortalSchool;
  children: PortalChild[];
  upcoming?: { available: boolean; items?: NextLesson[] };
  notifications: { unreadCount: number };
};

export default function ParentDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Dashboard>("/api/v1/parent/dashboard")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>My Children</h1>
      <p className="muted">{data.school.name}</p>
      {data.children.length === 0 ? (
        <div className="card">
          <p>No children are available for this school in the parent portal.</p>
        </div>
      ) : (
        <div className="cards">
          {data.children.map((child) => (
            <div className="card" key={child.id}>
              <Link className="child-card" href={`/parent/children/${child.id}`}>
                <strong>{child.displayName}</strong>
                <span>{child.currentYearGroupName ?? "Year group not set"}</span>
                <span>{child.currentFormClassName ?? "No form class"}</span>
              </Link>
              <p>
                <Link href={`/parent/children/${child.id}`}>Profile</Link>
                {" · "}
                <Link href={`/parent/children/${child.id}/timetable`}>Timetable</Link>
                {" · "}
                <Link href={`/parent/children/${child.id}#attendance`}>Attendance</Link>
                {" · "}
                <Link href={`/parent/children/${child.id}/learning`}>Learning</Link>
                {" · "}
                <Link href={`/parent/children/${child.id}/results`}>Results</Link>
                {" · "}
                <Link href={`/parent/children/${child.id}/reports`}>Reports</Link>
              </p>
            </div>
          ))}
        </div>
      )}
      {data.upcoming?.items?.some((item) => item.nextLesson) ? (
        <>
          <h2>Next lessons</h2>
          <ul>
            {data.upcoming.items.map((item) =>
              item.nextLesson ? (
                <li key={item.studentId}>
                  {item.displayName}: {item.nextLesson.subjectName ?? item.nextLesson.className}{" "}
                  {item.nextLesson.date} {item.nextLesson.startsAt.slice(0, 5)}
                </li>
              ) : null,
            )}
          </ul>
        </>
      ) : null}
      <h2>This week</h2>
      <div className="cards">
        <Link className="card" href="/parent/notices">
          <strong>Notices</strong>
          <p>School announcements for your family.</p>
        </Link>
        <Link className="card" href="/parent/calendar">
          <strong>Calendar</strong>
          <p>Events for your authorised children.</p>
        </Link>
        <Link className="card" href="/parent/notifications">
          <strong>Notifications</strong>
          <p>
            {data.notifications.unreadCount === 0
              ? "No unread notifications."
              : `${data.notifications.unreadCount} unread`}
          </p>
        </Link>
      </div>
    </>
  );
}
