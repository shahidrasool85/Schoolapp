"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { EmptyState, FilterBar, PageError, PageHeader, SearchInput, StatusBadge, Tabs } from "../../../components/ui";
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
  participants: Array<{ fullName: string | null; kind: string }>;
};

export default function StaffMessagesPage() {
  const [folder, setFolder] = useState("inbox");
  const [items, setItems] = useState<Conversation[] | null>(null);
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
    load(nextFolder, "").catch((err: Error) => setError(userFacingError(err, "Could not load messages.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function searchConversations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await load(folder, q).catch((err: Error) => setError(userFacingError(err, "Could not search messages.")));
  }

  function openFolder(nextFolder: string) {
    setFolder(nextFolder);
    const url = nextFolder === "inbox" ? "/school/messages" : `/school/messages?folder=${nextFolder}`;
    window.history.replaceState({}, "", url);
    load(nextFolder, q).catch((err: Error) => setError(userFacingError(err, "Could not load messages.")));
  }

  if (error) return <PageError title="Messages unavailable" description={error} />;

  return (
    <>
      <PageHeader
        title="Messages"
        description="Private conversations with parents and staff. School-wide notices stay in Communications."
        actions={
          <Link className="button" href="/school/messages/new">
            New conversation
          </Link>
        }
      />
      <Tabs>
        <button type="button" className={folder === "inbox" ? "active" : undefined} onClick={() => openFolder("inbox")}>
          Inbox
        </button>
        <button type="button" className={folder === "all" ? "active" : undefined} onClick={() => openFolder("all")}>
          All
        </button>
        <button type="button" className={folder === "archived" ? "active" : undefined} onClick={() => openFolder("archived")}>
          Archived
        </button>
      </Tabs>
      <FilterBar onSubmit={searchConversations} actions={<button type="submit">Search</button>}>
        <SearchInput
          id="message-search"
          value={q}
          onChange={setQ}
          placeholder="Pupil, subject or participant"
        />
      </FilterBar>
      {(items ?? []).length === 0 ? (
        <EmptyState
          title="No conversations in this folder"
          description="Start a conversation from a pupil record or the new message screen."
          action={<Link href="/school/messages/new">New conversation</Link>}
        />
      ) : (
        <div className="thread-list">
          {(items ?? []).map((item) => (
            <Link
              className={`thread-item${item.unreadCount > 0 ? " unread" : ""}`}
              href={`/school/messages/${item.id}`}
              key={item.id}
            >
              <strong>
                {item.unreadCount > 0 ? <span aria-label="Unread">Unread · </span> : null}
                {item.subject}
              </strong>
              <span className="muted">
                {item.pupilName ?? "No linked pupil"}
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
