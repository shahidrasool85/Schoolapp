"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Event = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  eventTypeName: string | null;
  related: Array<{ studentDisplayName: string | null; className: string | null; yearGroupName: string | null }>;
};

export default function ParentCalendarPage() {
  const [items, setItems] = useState<Event[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ events: Event[] }>("/api/v1/parent/calendar/events")
      .then((body) => setItems(body.events))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Family calendar</h1>
      {items.length === 0 ? <p>No upcoming family events.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <div className="card" key={item.id}>
            <strong>{item.title}</strong>
            <span className="muted">
              {item.eventTypeName} · {new Date(item.startsAt).toLocaleString()}
              {item.location ? ` · ${item.location}` : ""}
            </span>
            {item.related.length > 0 ? (
              <span>
                {item.related
                  .map((row) => [row.studentDisplayName, row.className, row.yearGroupName].filter(Boolean).join(" · "))
                  .join("; ")}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
