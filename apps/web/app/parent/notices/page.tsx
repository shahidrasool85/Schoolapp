"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Notice = {
  id: string;
  title: string;
  priority: string;
  publishedAt: string | null;
  acknowledgementRequired: boolean;
  readAt: string | null;
  acknowledgedAt: string | null;
};

export default function ParentNoticesPage() {
  const [items, setItems] = useState<Notice[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ announcements: Notice[] }>("/api/v1/parent/announcements")
      .then((body) => setItems(body.announcements))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Notices</h1>
      {items.length === 0 ? <p>No notices for your family right now.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <Link className="card" href={`/parent/notices/${item.id}`} key={item.id}>
            <strong>{item.title}</strong>
            <span className="muted">
              {item.priority}
              {item.acknowledgementRequired ? " · acknowledgement required" : ""}
              {item.readAt ? " · read" : " · unread"}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
