"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, downloadAuthenticated } from "../../../../lib/api";

type Attachment = { id: string; originalFilename: string; downloadPath: string };
type Message = {
  id: string;
  senderName: string | null;
  body: string;
  sentAt: string;
  redacted: boolean;
  messageType: string;
  attachments: Attachment[];
};
type Conversation = {
  id: string;
  subject: string;
  status: string;
  pupilName: string | null;
  canReply: boolean;
  canManage: boolean;
  canModerate: boolean;
  isParticipant: boolean;
  participants: Array<{ fullName: string | null; kind: string }>;
};

export default function StaffConversationPage() {
  const params = useParams<{ id: string }>();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const [detail, history] = await Promise.all([
      api<{ conversation: Conversation }>(`/api/v1/messages/conversations/${params.id}`),
      api<{ messages: Message[] }>(`/api/v1/messages/conversations/${params.id}/messages`),
    ]);
    setConversation(detail.conversation);
    setMessages(history.messages);
    await api(`/api/v1/messages/conversations/${params.id}/read`, { method: "POST", body: "{}" });
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = String(data.get("body") || "");
    const file = data.get("file");
    try {
      const sent = await api<{ message: Message }>(`/api/v1/messages/conversations/${params.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      if (file instanceof File && file.size > 0) {
        const upload = new FormData();
        upload.append("file", file);
        await api(`/api/v1/messages/conversations/${params.id}/messages/${sent.message.id}/attachments`, {
          method: "POST",
          body: upload,
        });
      }
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the message");
    }
  }

  async function closeThread() {
    await api(`/api/v1/messages/conversations/${params.id}/close`, { method: "POST", body: "{}" });
    setNotice("Conversation closed.");
    await load();
  }

  async function reopenThread() {
    await api(`/api/v1/messages/conversations/${params.id}/reopen`, { method: "POST", body: "{}" });
    setNotice("Conversation reopened.");
    await load();
  }

  async function redact(messageId: string) {
    await api(`/api/v1/messages/conversations/${params.id}/messages/${messageId}/redact`, {
      method: "POST",
      body: "{}",
    });
    await load();
  }

  async function archiveThread() {
    await api(`/api/v1/messages/conversations/${params.id}/archive`, { method: "POST", body: "{}" });
    setNotice("Conversation archived in your inbox.");
    await load();
  }

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!conversation) return <p>Loading…</p>;

  return (
    <>
      <h1>{conversation.subject}</h1>
      <p className="muted">
        {conversation.pupilName ?? "No linked pupil"} · {conversation.status}
        {conversation.participants.length
          ? ` · ${conversation.participants.map((item) => item.fullName).filter(Boolean).join(", ")}`
          : ""}
      </p>
      {conversation.status === "closed" ? (
        <p role="status">This conversation is closed. New replies are not allowed unless a member of staff reopens it.</p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {conversation.canManage ? (
        <p>
          {conversation.status === "open" ? (
            <button type="button" onClick={() => closeThread().catch((err: Error) => setError(err.message))}>
              Close conversation
            </button>
          ) : (
            <button type="button" onClick={() => reopenThread().catch((err: Error) => setError(err.message))}>
              Reopen conversation
            </button>
          )}
          {conversation.isParticipant ? (
            <>
              {" "}
              <button type="button" onClick={() => archiveThread().catch((err: Error) => setError(err.message))}>
                Archive
              </button>
            </>
          ) : null}
        </p>
      ) : conversation.isParticipant ? (
        <p>
          <button type="button" onClick={() => archiveThread().catch((err: Error) => setError(err.message))}>
            Archive
          </button>
        </p>
      ) : null}
      <ol style={{ listStyle: "none", padding: 0 }}>
        {messages.map((item) => (
          <li key={item.id} className="card">
            <strong>{item.senderName ?? "School"}</strong>
            <span className="muted"> {new Date(item.sentAt).toLocaleString()}</span>
            <p>{item.body}</p>
            {item.attachments.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => downloadAuthenticated(file.downloadPath, file.originalFilename).catch((err: Error) => setError(err.message))}
              >
                Download {file.originalFilename}
              </button>
            ))}
            {conversation.canModerate && !item.redacted && item.messageType === "user" ? (
              <button type="button" onClick={() => redact(item.id).catch((err: Error) => setError(err.message))}>
                Redact message
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {conversation.canReply ? (
        <form onSubmit={send}>
          <label htmlFor="body">Reply</label>
          <textarea id="body" name="body" rows={5} required maxLength={8000} />
          <label htmlFor="file">Attachment (optional)</label>
          <input id="file" name="file" type="file" />
          <button type="submit">Send</button>
        </form>
      ) : (
        <p>You cannot reply to this conversation.</p>
      )}
    </>
  );
}
