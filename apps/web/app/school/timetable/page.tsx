"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataTable, EmptyState, LoadingState, PageError, PageHeader, StatCard, StatusBadge } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

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
      .catch((err: Error) => setError(userFacingError(err, "Could not load the timetable overview.")));
  }, []);

  if (error) return <PageError title="Timetable unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading timetable…" />;

  return (
    <>
      <PageHeader
        title="Timetable"
        description={`Week ${data.week.from} to ${data.week.to}`}
        actions={
          <>
            <Link className="button secondary" href="/school/timetable/mine">
              My Timetable
            </Link>
            <Link className="button" href="/school/timetable/schedule">
              Full timetable
            </Link>
          </>
        }
      />
      <div className="stat-grid">
        <StatCard label="Lessons this week" value={data.counts.lessonsThisWeek} href="/school/timetable/schedule" />
        <StatCard label="Cover this week" value={data.counts.coversThisWeek} href="/school/timetable/cover" />
        <StatCard label="Rooms" value={data.counts.rooms} href="/school/timetable/rooms" />
      </div>
      <h2>Today</h2>
      {data.todayLessons.length === 0 ? (
        <EmptyState
          title="No lessons scheduled today"
          description="Open the timetable to view a school week."
          action={<Link href="/school/timetable/schedule">View timetable</Link>}
        />
      ) : (
        <DataTable
          headers={
            <>
              <th>Time</th>
              <th>Class</th>
              <th>Subject</th>
              <th>Room</th>
              <th>Teacher</th>
              <th>Status</th>
            </>
          }
        >
          {data.todayLessons.map((lesson) => (
            <tr key={`${lesson.entryId}-${lesson.date}`}>
              <td>
                {lesson.startsAt.slice(0, 5)}–{lesson.endsAt.slice(0, 5)}
              </td>
              <td>{lesson.className}</td>
              <td>{lesson.subjectName ?? "—"}</td>
              <td>{lesson.roomName ?? "—"}</td>
              <td>{lesson.teachers.map((teacher) => teacher.fullName).join(", ") || "—"}</td>
              <td>
                <StatusBadge status={lesson.covered ? "Cover" : lesson.status} />
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
