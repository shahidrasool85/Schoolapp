"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, PageError, PageHeader, StatusBadge } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

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
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ conversations: Conversation[] }>("/api/v1/parent/messages")
      .then((body) => setItems(body.conversations))
      .catch((err: Error) => setError(userFacingError(err, "Could not load messages.")));
  }, []);

  if (error) return <PageError title="Messages unavailable" description={error} />;

  return (
    <>
      <PageHeader
        title="Messages"
        description="Conversations about your children with school staff. School-wide notices stay under Notices."
        actions={
          <Link className="button" href="/parent/messages/new">
            New message
          </Link>
        }
      />
      {(items ?? []).length === 0 ? (
        <EmptyState
          title="No messages yet"
          description="When you or the school start a conversation, it will appear here."
          action={<Link href="/parent/messages/new">New message</Link>}
        />
      ) : (
        <div className="thread-list">
          {(items ?? []).map((item) => (
            <Link
              className={`thread-item${item.unreadCount > 0 ? " unread" : ""}`}
              href={`/parent/messages/${item.id}`}
              key={item.id}
            >
              <strong>
                {item.unreadCount > 0 ? <span aria-label="Unread">Unread · </span> : null}
                {item.subject}
              </strong>
              <span className="muted">
                {item.pupilName ?? "School"}
                {item.participants[0]?.fullName ? ` · ${item.participants[0].fullName}` : ""}
                {item.lastMessageAt ? ` · ${new Date(item.lastMessageAt).toLocaleString("en-GB")}` : ""}
              </span>
              <span>{item.lastMessagePreview || "No messages yet"}</span>
              <StatusBadge status={item.status} />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
