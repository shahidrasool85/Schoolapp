"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Conversation = {
  id: string;
  subject: string;
  status: string;
  pupilName: string | null;
  lastMessagePreview: string;
  lastMessageAt: string;
  unreadCount: number;
  participants: Array<{ fullName: string | null; kind: string }>;
};

export default function StaffMessagesPage() {
  const [folder, setFolder] = useState("inbox");
  const [items, setItems] = useState<Conversation[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  async function load(nextFolder = folder, query = q) {
    const params = new URLSearchParams({ folder: nextFolder });
    if (query) params.set("q", query);
    const body = await api<{ conversations: Conversation[] }>(`/api/v1/messages/conversations?${params}`);
    setItems(body.conversations);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextFolder = params.get("folder") || "inbox";
    setFolder(nextFolder);
    load(nextFolder, "").catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function searchConversations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await load(folder, q).catch((err: Error) => setError(err.message));
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="toolbar">
        <h1>Messages</h1>
        <Link href="/school/messages/new">New conversation</Link>
      </div>
      <p className="muted">Conversational messages with parents and staff. School-wide notices stay in Communications.</p>
      <nav aria-label="Message folders">
        <button type="button" onClick={() => { setFolder("inbox"); load("inbox", q).catch((err: Error) => setError(err.message)); }}>Inbox</button>
        {" · "}
        <button type="button" onClick={() => { setFolder("all"); load("all", q).catch((err: Error) => setError(err.message)); }}>All</button>
        {" · "}
        <button type="button" onClick={() => { setFolder("archived"); load("archived", q).catch((err: Error) => setError(err.message)); }}>Archived</button>
      </nav>
      <form onSubmit={searchConversations} style={{ margin: "1rem 0" }}>
        <label htmlFor="message-search">Search</label>
        <input
          id="message-search"
          name="q"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Pupil, subject or participant"
        />
        <button type="submit">Search</button>
      </form>
      {items.length === 0 ? <p>No conversations in this folder.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <Link className="card" href={`/school/messages/${item.id}`} key={item.id}>
            <strong>
              {item.unreadCount > 0 ? <span aria-label="Unread">Unread · </span> : null}
              {item.subject}
            </strong>
            <span className="muted">
              {item.pupilName ?? "No linked pupil"}
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
