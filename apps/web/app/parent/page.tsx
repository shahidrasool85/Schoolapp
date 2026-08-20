"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { ComingLaterCard } from "../../components/coming-later";
import type { ComingLater, PortalChild, PortalSchool } from "../../lib/portal";

type Dashboard = {
  school: PortalSchool;
  children: PortalChild[];
  upcoming: ComingLater;
  recentActivity: ComingLater;
  notifications: { unreadCount: number; preview: ComingLater };
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
            <Link className="card child-card" href={`/parent/children/${child.id}`} key={child.id}>
              <strong>{child.displayName}</strong>
              <span>{child.currentYearGroupName ?? "Year group not set"}</span>
              <span>{child.currentFormClassName ?? "No form class"}</span>
              <span className="muted">{child.school.name}</span>
            </Link>
          ))}
        </div>
      )}
      <h2>This week</h2>
      <div className="cards">
        <ComingLaterCard title="Upcoming" message={data.upcoming.message} />
        <ComingLaterCard title="Recent activity" message={data.recentActivity.message} />
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
