"use client";

import Link from "next/link";
import { Card, PageHeader } from "../../../components/ui";

export default function CommunicationsPage() {
  return (
    <>
      <PageHeader
        title="Communications"
        description="School-wide notices and the calendar. Private parent conversations live under Messages."
      />
      <div className="cards">
        <Card href="/school/communications/announcements">
          <strong>Notices</strong>
          <p>Broadcast announcements to families, staff, or students. These are not private messages.</p>
        </Card>
        <Card href="/school/communications/calendar">
          <strong>Calendar</strong>
          <p>School events, holidays, trips, and meetings.</p>
        </Card>
        <Card href="/school/messages">
          <strong>Messages</strong>
          <p>Private conversations with a parent or colleague about a pupil.</p>
        </Card>
      </div>
    </>
  );
}
