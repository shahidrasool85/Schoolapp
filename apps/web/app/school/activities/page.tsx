"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Activity = {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  activityTypeName: string | null;
  activityTypeKey: string | null;
  location: string | null;
  capacity: number | null;
};

export default function StaffActivitiesPage() {
  const [items, setItems] = useState<Activity[]>([]);
  const [error, setError] = useState("");

  async function load(query = "") {
    const body = await api<{ activities: Activity[] }>(`/api/v1/activities${query}`);
    setItems(body.activities);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get("type");
    load(type ? `?type=${encodeURIComponent(type)}` : "").catch((err: Error) => setError(err.message));
  }, []);

  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    const status = String(form.get("status") || "");
    const type = String(form.get("type") || "");
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    const qs = params.toString();
    await load(qs ? `?${qs}` : "");
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="toolbar">
        <h1>Activities</h1>
        <Link href="/school/activities/new">Create activity</Link>
      </div>
      <form className="toolbar" onSubmit={filter}>
        <label>
          Status
          <select name="status" defaultValue="">
            <option value="">Active</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="closed">Closed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label>
          Type
          <select name="type" defaultValue="">
            <option value="">All types</option>
            <option value="trips">Trips & visits</option>
            <option value="trip">Trip</option>
            <option value="visit">Visit</option>
            <option value="residential">Residential</option>
            <option value="club">Club</option>
            <option value="after_school">After-school</option>
            <option value="sports_fixture">Sports fixture</option>
            <option value="workshop">Workshop</option>
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>
      {items.length === 0 ? <p>No activities in this view.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <Link className="card" href={`/school/activities/${item.id}`} key={item.id}>
            <strong>{item.title}</strong>
            <span className="muted">
              {item.activityTypeName ?? "Activity"} · {item.status} · {new Date(item.startsAt).toLocaleString()}
              {item.location ? ` · ${item.location}` : ""}
              {item.capacity != null ? ` · capacity ${item.capacity}` : ""}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
