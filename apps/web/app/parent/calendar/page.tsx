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

type Activity = {
  id: string;
  title: string;
  startsAt: string;
  location: string | null;
  activityTypeName: string | null;
  source: string;
};

export default function ParentCalendarPage() {
  const [items, setItems] = useState<Event[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ events: Event[]; activities?: Activity[] }>("/api/v1/parent/calendar/events")
      .then((body) => {
        setItems(body.events);
        setActivities(body.activities ?? []);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Family calendar</h1>
      {items.length === 0 && activities.length === 0 ? <p>No upcoming family events.</p> : null}
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
        {activities.map((item) => (
          <div className="card" key={`activity-${item.id}-${item.startsAt}`}>
            <strong>{item.title}</strong>
            <span className="muted">
              {item.activityTypeName} · activity · {new Date(item.startsAt).toLocaleString()}
              {item.location ? ` · ${item.location}` : ""}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
