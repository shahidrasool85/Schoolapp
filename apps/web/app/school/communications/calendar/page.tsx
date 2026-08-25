"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Event = {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  eventTypeName: string | null;
  location: string | null;
};

type Activity = {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  location: string | null;
  activityTypeName: string | null;
};

export default function StaffCalendarPage() {
  const [items, setItems] = useState<Event[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [mine, setMine] = useState(false);
  const [error, setError] = useState("");

  async function load(onlyMine = mine) {
    const qs = onlyMine ? "?mine=true" : "";
    const body = await api<{ events: Event[]; activities?: Activity[] }>(`/api/v1/calendar/events${qs}`);
    setItems(body.events);
    setActivities(body.activities ?? []);
  }

  useEffect(() => {
    load(false).catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="toolbar">
        <h1>Calendar</h1>
        <Link href="/school/communications/calendar/new">New event</Link>
      </div>
      <div className="toolbar">
        <button
          className={mine ? undefined : "secondary"}
          type="button"
          onClick={() => {
            setMine(false);
            load(false).catch((err: Error) => setError(err.message));
          }}
        >
          School calendar
        </button>
        <button
          className={mine ? "secondary" : undefined}
          type="button"
          onClick={() => {
            setMine(true);
            load(true).catch((err: Error) => setError(err.message));
          }}
        >
          My relevant events
        </button>
      </div>
      {items.length === 0 && activities.length === 0 ? <p>No events in this view.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <Link className="card" href={`/school/communications/calendar/${item.id}`} key={item.id}>
            <strong>{item.title}</strong>
            <span className="muted">
              {item.eventTypeName ?? "Event"} · {item.status} · {new Date(item.startsAt).toLocaleString()}
              {item.location ? ` · ${item.location}` : ""}
            </span>
          </Link>
        ))}
        {activities.map((item) => (
          <Link className="card" href={`/school/activities/${item.id}`} key={`activity-${item.id}-${item.startsAt}`}>
            <strong>{item.title}</strong>
            <span className="muted">
              {item.activityTypeName ?? "Activity"} · activity · {item.status} · {new Date(item.startsAt).toLocaleString()}
              {item.location ? ` · ${item.location}` : ""}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
