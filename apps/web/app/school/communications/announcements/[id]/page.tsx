"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../../lib/api";

type Detail = {
  announcement: {
    id: string;
    title: string;
    body: string;
    status: string;
    priority: string;
    acknowledgementRequired: boolean;
    createdByName: string | null;
    receipts?: { recipients: number; read: number; unread: number; acknowledged: number; outstandingAcknowledgements: number };
    targets: Array<{ targetType: string; className: string | null; yearGroupName: string | null }>;
  };
};

export default function AnnouncementDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail["announcement"] | null>(null);
  const [receipts, setReceipts] = useState<Detail["announcement"]["receipts"]>();
  const [error, setError] = useState("");

  async function load() {
    const body = await api<Detail>(`/api/v1/announcements/${params.id}`);
    setData(body.announcement);
    setReceipts(body.announcement.receipts);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.id]);

  async function publish() {
    await api(`/api/v1/announcements/${params.id}/publish`, { method: "POST", body: "{}" });
    await load();
  }

  async function archive() {
    await api(`/api/v1/announcements/${params.id}/archive`, { method: "POST", body: "{}" });
    await load();
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>{data.title}</h1>
      <p className="muted">
        {data.status} · {data.priority}
        {data.createdByName ? ` · ${data.createdByName}` : ""}
      </p>
      <p>{data.body}</p>
      <p className="muted">
        Audience: {data.targets.map((t) => t.className || t.yearGroupName || t.targetType).join(", ") || "none"}
      </p>
      {receipts ? (
        <div className="card">
          <strong>Read / acknowledgement</strong>
          <p>
            {receipts.recipients} recipients · {receipts.read} read · {receipts.unread} unread
            {data.acknowledgementRequired
              ? ` · ${receipts.acknowledged} acknowledged · ${receipts.outstandingAcknowledgements} outstanding`
              : ""}
          </p>
        </div>
      ) : null}
      <div className="toolbar">
        {data.status === "draft" || data.status === "scheduled" ? (
          <button type="button" onClick={() => publish().catch((err: Error) => setError(err.message))}>
            Publish
          </button>
        ) : null}
        {data.status !== "archived" ? (
          <button className="secondary" type="button" onClick={() => archive().catch((err: Error) => setError(err.message))}>
            Archive
          </button>
        ) : null}
      </div>
    </>
  );
}
