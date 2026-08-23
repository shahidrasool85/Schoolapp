"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../../lib/api";

type Event = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  eventTypeName: string | null;
  targets: Array<{ targetType: string; className: string | null }>;
};

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Event | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const body = await api<{ event: Event }>(`/api/v1/calendar/events/${params.id}`);
    setData(body.event);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>{data.title}</h1>
      <p className="muted">
        {data.eventTypeName} · {data.status} · {new Date(data.startsAt).toLocaleString()} –{" "}
        {new Date(data.endsAt).toLocaleString()}
      </p>
      {data.location ? <p>{data.location}</p> : null}
      {data.description ? <p>{data.description}</p> : null}
      <p className="muted">
        Audience: {data.targets.map((t) => t.className || t.targetType).join(", ") || "none"}
      </p>
      {data.status === "draft" || data.status === "scheduled" ? (
        <button
          type="button"
          onClick={() =>
            api(`/api/v1/calendar/events/${params.id}/publish`, { method: "POST", body: "{}" })
              .then(load)
              .catch((err: Error) => setError(err.message))
          }
        >
          Publish
        </button>
      ) : null}
    </>
  );
}
