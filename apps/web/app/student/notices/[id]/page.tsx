"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Notice = {
  title: string;
  body: string;
  acknowledgementRequired: boolean;
  acknowledgedAt: string | null;
};

export default function StudentNoticeDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Notice | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const body = await api<{ announcement: Notice }>(`/api/v1/student/announcements/${params.id}`);
    setData(body.announcement);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>{data.title}</h1>
      <p>{data.body}</p>
      {data.acknowledgementRequired && !data.acknowledgedAt ? (
        <button
          type="button"
          onClick={() =>
            api(`/api/v1/student/announcements/${params.id}/acknowledge`, { method: "POST", body: "{}" })
              .then(load)
              .catch((err: Error) => setError(err.message))
          }
        >
          Acknowledge
        </button>
      ) : null}
      {data.acknowledgedAt ? <p className="muted">Acknowledged</p> : null}
    </>
  );
}
