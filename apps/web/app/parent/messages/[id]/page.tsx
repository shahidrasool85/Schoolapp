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
  attachments: Attachment[];
};
type Conversation = {
  id: string;
  subject: string;
  status: string;
  pupilName: string | null;
  canReply: boolean;
  participants: Array<{ fullName: string | null }>;
};

export default function ParentConversationPage() {
  const params = useParams<{ id: string }>();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const [detail, history] = await Promise.all([
      api<{ conversation: Conversation }>(`/api/v1/parent/messages/${params.id}`),
      api<{ messages: Message[] }>(`/api/v1/parent/messages/${params.id}/messages`),
    ]);
    setConversation(detail.conversation);
    setMessages(history.messages);
    await api(`/api/v1/parent/messages/${params.id}/read`, { method: "POST", body: "{}" });
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const sent = await api<{ message: Message }>(`/api/v1/parent/messages/${params.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: String(data.get("body") || "") }),
      });
      const file = data.get("file");
      if (file instanceof File && file.size > 0) {
        const upload = new FormData();
        upload.append("file", file);
        await api(`/api/v1/parent/messages/${params.id}/messages/${sent.message.id}/attachments`, {
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

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!conversation) return <p>Loading…</p>;

  return (
    <>
      <h1>{conversation.subject}</h1>
      <p className="muted">
        {conversation.pupilName ?? "School"}
        {conversation.participants[0]?.fullName ? ` · ${conversation.participants[0].fullName}` : ""}
        {` · ${conversation.status}`}
      </p>
      {conversation.status === "closed" ? (
        <p role="status">This conversation is closed. You can still read it, but new replies are not allowed.</p>
      ) : null}
      <p>
        <button
          type="button"
          onClick={() =>
            api(`/api/v1/parent/messages/${params.id}/archive`, { method: "POST", body: "{}" })
              .catch((err: Error) => setError(err.message))
          }
        >
          Archive
        </button>
      </p>
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
                onClick={() =>
                  downloadAuthenticated(file.downloadPath, file.originalFilename).catch((err: Error) => setError(err.message))
                }
              >
                Download {file.originalFilename}
              </button>
            ))}
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
