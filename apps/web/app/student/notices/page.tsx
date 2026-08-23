"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Notice = {
  id: string;
  title: string;
  priority: string;
  acknowledgementRequired: boolean;
  readAt: string | null;
};

export default function StudentNoticesPage() {
  const [items, setItems] = useState<Notice[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ announcements: Notice[] }>("/api/v1/student/announcements")
      .then((body) => setItems(body.announcements))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Notices</h1>
      {items.length === 0 ? <p>No notices for you right now.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <Link className="card" href={`/student/notices/${item.id}`} key={item.id}>
            <strong>{item.title}</strong>
            <span className="muted">
              {item.priority}
              {item.acknowledgementRequired ? " · please acknowledge" : ""}
              {item.readAt ? " · read" : " · new"}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
