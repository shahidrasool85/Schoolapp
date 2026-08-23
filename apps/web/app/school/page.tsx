"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

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
];

export default function SchoolDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Dashboard>("/api/v1/dashboard")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>Dashboard</h1>
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
