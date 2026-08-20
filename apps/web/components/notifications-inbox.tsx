"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { InboxNotification } from "../lib/portal";

export default function NotificationsInbox() {
  const [items, setItems] = useState<InboxNotification[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState("");

  async function load() {
    const body = await api<{ notifications: InboxNotification[]; unreadCount: number }>(
      "/api/v1/notifications",
    );
    setItems(body.notifications);
    setUnreadCount(body.unreadCount);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function markRead(id: string) {
    setError("");
    try {
      await api(`/api/v1/notifications/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ read: true }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update notification");
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!items) return <p>Loading…</p>;

  return (
    <>
      <p className="muted">
        {unreadCount === 0
          ? "You are up to date."
          : `${unreadCount} unread ${unreadCount === 1 ? "notification" : "notifications"}.`}
      </p>
      {items.length === 0 ? (
        <div className="card">
          <p className="muted">No notifications yet. School messages will appear here.</p>
        </div>
      ) : (
        <div className="stack">
          {items.map((item) => (
            <article className={`card notice ${item.readAt ? "read" : "unread"}`} key={item.id}>
              <header className="toolbar">
                <strong>{item.title}</strong>
                <span className="muted">{new Date(item.createdAt).toLocaleString("en-GB")}</span>
              </header>
              <p>{item.body}</p>
              {!item.readAt ? (
                <button type="button" className="secondary" onClick={() => markRead(item.id)}>
                  Mark as read
                </button>
              ) : (
                <p className="muted">Read</p>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
