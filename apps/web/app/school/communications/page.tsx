"use client";

import Link from "next/link";

export default function CommunicationsPage() {
  return (
    <>
      <h1>Communications</h1>
      <p className="muted">School announcements and the shared calendar.</p>
      <div className="cards">
        <Link className="card" href="/school/communications/announcements">
          <strong>Announcements</strong>
          <p>Draft, target, schedule, and publish notices.</p>
        </Link>
        <Link className="card" href="/school/communications/calendar">
          <strong>Calendar</strong>
          <p>School events, holidays, trips, and meetings.</p>
        </Link>
      </div>
    </>
  );
}
