"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Announcement = {
  id: string;
  title: string;
  status: string;
  priority: string;
  publishedAt: string | null;
  pinned: boolean;
};

export default function StaffAnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ announcements: Announcement[] }>("/api/v1/announcements")
      .then((body) => setItems(body.announcements))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="toolbar">
        <h1>Announcements</h1>
        <Link href="/school/communications/announcements/new">New announcement</Link>
      </div>
      {items.length === 0 ? <p>No announcements yet.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <Link className="card" href={`/school/communications/announcements/${item.id}`} key={item.id}>
            <strong>{item.pinned ? "Pinned · " : ""}{item.title}</strong>
            <span className="muted">
              {item.status} · {item.priority}
              {item.publishedAt ? ` · ${new Date(item.publishedAt).toLocaleString()}` : ""}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
