"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Conversation = {
  id: string;
  subject: string;
  status: string;
  pupilName: string | null;
  lastMessagePreview: string;
  lastMessageAt: string;
  unreadCount: number;
  participants: Array<{ fullName: string | null }>;
};

export default function ParentMessagesPage() {
  const [items, setItems] = useState<Conversation[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ conversations: Conversation[] }>("/api/v1/parent/messages")
      .then((body) => setItems(body.conversations))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="toolbar">
        <h1>Messages</h1>
        <Link href="/parent/messages/new">New message</Link>
      </div>
      <p className="muted">Conversations about your children with school staff. School-wide notices stay under Notices.</p>
      {items.length === 0 ? <p>No messages yet.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <Link className="card" href={`/parent/messages/${item.id}`} key={item.id}>
            <strong>
              {item.unreadCount > 0 ? <span aria-label="Unread">Unread · </span> : null}
              {item.subject}
            </strong>
            <span className="muted">
              {item.pupilName ?? "School"}
              {item.participants[0]?.fullName ? ` · ${item.participants[0].fullName}` : ""}
              {` · ${item.status}`}
              {item.lastMessageAt ? ` · ${new Date(item.lastMessageAt).toLocaleString()}` : ""}
            </span>
            <span>{item.lastMessagePreview || "No messages yet"}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
