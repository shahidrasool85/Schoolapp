"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Event = {
  id: string;
  title: string;
  startsAt: string;
  location: string | null;
  eventTypeName: string | null;
};

export default function StudentCalendarPage() {
  const [items, setItems] = useState<Event[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ events: Event[] }>("/api/v1/student/calendar/events")
      .then((body) => setItems(body.events))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Calendar</h1>
      {items.length === 0 ? <p>No school events for you right now.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <div className="card" key={item.id}>
            <strong>{item.title}</strong>
            <span className="muted">
              {item.eventTypeName} · {new Date(item.startsAt).toLocaleString()}
              {item.location ? ` · ${item.location}` : ""}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
