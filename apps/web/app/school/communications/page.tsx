"use client";

import Link from "next/link";

export default function CommunicationsPage() {
  return (
    <>
      <h1>Communications</h1>
      <p className="muted">School-wide notices and the calendar. Private parent conversations live under Messages.</p>
      <div className="cards">
        <Link className="card" href="/school/communications/announcements">
          <strong>Notices</strong>
          <p>Broadcast announcements to families, staff, or students. These are not private messages.</p>
        </Link>
        <Link className="card" href="/school/communications/calendar">
          <strong>Calendar</strong>
          <p>School events, holidays, trips, and meetings.</p>
        </Link>
        <Link className="card" href="/school/messages">
          <strong>Messages</strong>
          <p>Private conversations with a parent or colleague about a pupil.</p>
        </Link>
      </div>
    </>
  );
}
