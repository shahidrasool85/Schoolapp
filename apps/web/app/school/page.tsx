"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { staffPersonaLabel } from "../../lib/portal";

type Lesson = {
  entryId: string;
  startsAt: string;
  endsAt: string;
  className: string;
  subjectName: string | null;
  roomName: string | null;
  covered: boolean;
  status: string;
};

type Dashboard = {
  currentAcademicYear: { id: string; name: string; startsOn: string; endsOn: string } | null;
  counts: {
    students: number;
    staff: number;
    parents: number;
    classes: number;
    yearGroups: number;
    subjects: number;
  };
};

const LINKS = [
  { href: "/school/admissions", title: "Admissions", text: "Enquiries, applications, offers and enrolment." },
  { href: "/school/students", title: "Pupils", text: "Pupil records, guardians and enrolments." },
  { href: "/school/attendance/registers", title: "Attendance", text: "Open today's registers and save marks." },
  { href: "/school/teaching", title: "Teaching & Learning", text: "Assignments, homework and marking." },
  { href: "/school/assessment", title: "Assessment & Progress", text: "Formal results and published reports." },
  { href: "/school/communications", title: "Communications", text: "Notices and the school calendar." },
  { href: "/school/timetable", title: "Timetable", text: "School day, rooms, class and teacher schedules." },
  { href: "/school/finance", title: "Finance / Payments", text: "Charges, outstanding balances, refunds and receipts." },
];

export default function SchoolDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [coversToday, setCoversToday] = useState(0);
  const [persona, setPersona] = useState<{ fullName: string; label: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ user: { fullName: string }; roleKeys: string[] }>("/api/v1/me")
      .then((me) =>
        setPersona({
          fullName: me.user.fullName,
          label: staffPersonaLabel(me.roleKeys),
        }),
      )
      .catch(() => setPersona(null));
    api<Dashboard>("/api/v1/dashboard")
      .then(setData)
      .catch((err: Error) => setError(err.message));
    api<{ lessons: Lesson[]; coversToday: number }>("/api/v1/dashboard/timetable")
      .then((body) => {
        setLessons(body.lessons);
        setCoversToday(body.coversToday);
      })
      .catch(() => setLessons([]));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>Dashboard</h1>
      {persona ? (
        <p className="muted">
          {persona.fullName} · {persona.label}
        </p>
      ) : null}
      <p className="muted">
        Current academic year: {data.currentAcademicYear?.name ?? "not set"}
      </p>
      <div className="cards">
        <Link className="card" href="/school/students"><span>Pupils</span><strong>{data.counts.students}</strong></Link>
        <Link className="card" href="/school/staff"><span>Staff</span><strong>{data.counts.staff}</strong></Link>
        <Link className="card" href="/school/parents"><span>Parents / guardians</span><strong>{data.counts.parents}</strong></Link>
        <Link className="card" href="/school/year-groups"><span>Year groups</span><strong>{data.counts.yearGroups}</strong></Link>
        <Link className="card" href="/school/classes"><span>Classes</span><strong>{data.counts.classes}</strong></Link>
        <Link className="card" href="/school/subjects"><span>Subjects</span><strong>{data.counts.subjects}</strong></Link>
      </div>
      <h2>Today's lessons</h2>
      {lessons === null ? (
        <p>Loading…</p>
      ) : lessons.length === 0 ? (
        <p>No lessons scheduled for today. Open the timetable to view a school week.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Class</th>
              <th>Subject</th>
              <th>Room</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((lesson) => (
              <tr key={`${lesson.entryId}-${lesson.startsAt}`}>
                <td>
                  {lesson.startsAt.slice(0, 5)}–{lesson.endsAt.slice(0, 5)}
                </td>
                <td>{lesson.className}</td>
                <td>{lesson.subjectName ?? "—"}</td>
                <td>{lesson.roomName ?? "—"}</td>
                <td>
                  {lesson.covered ? "Cover · " : ""}
                  <Link href="/school/timetable/mine">Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {coversToday > 0 ? <p className="muted">{coversToday} cover assignment(s) today.</p> : null}
      <h2>Start here</h2>
      <div className="cards">
        {LINKS.map((link) => (
          <Link key={link.href} className="card" href={link.href}>
            <strong>{link.title}</strong>
            <p>{link.text}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
