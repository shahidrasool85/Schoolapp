"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ConfirmationDialog, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../components/ui";
import { Button } from "../../../../components/ui/button";
import { api, downloadAuthenticated } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

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
  const [confirmArchive, setConfirmArchive] = useState(false);

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
    load().catch((err: Error) => setError(userFacingError(err, "Could not load this conversation.")));
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
      setError(userFacingError(err, "Could not send the message"));
    }
  }

  if (error) return <PageError title="Conversation unavailable" description={error} />;
  if (!conversation) return <LoadingState label="Loading conversation…" />;

  return (
    <>
      <PageHeader
        title={conversation.subject}
        description={`${conversation.pupilName ?? "School"}${
          conversation.participants[0]?.fullName ? ` · ${conversation.participants[0].fullName}` : ""
        }`}
        breadcrumbs={[
          { href: "/parent/messages", label: "Messages" },
          { label: conversation.subject },
        ]}
        actions={
          <>
            <StatusBadge status={conversation.status} />
            <Button type="button" variant="secondary" onClick={() => setConfirmArchive(true)}>
              Archive
            </Button>
          </>
        }
      />
      {conversation.status === "closed" ? (
        <p className="alert alert-info" role="status">
          This conversation is closed. You can still read it, but new replies are not allowed.
        </p>
      ) : null}
      <ol className="stack" style={{ listStyle: "none", padding: 0 }}>
        {messages.map((item) => (
          <li key={item.id} className="message-bubble">
            <strong>{item.senderName ?? "School"}</strong>
            <span className="muted"> {new Date(item.sentAt).toLocaleString("en-GB")}</span>
            <p>{item.body}</p>
            {item.attachments.map((file) => (
              <Button
                key={file.id}
                type="button"
                variant="secondary"
                onClick={() =>
                  downloadAuthenticated(file.downloadPath, file.originalFilename).catch((err: Error) =>
                    setError(userFacingError(err)),
                  )
                }
              >
                Download {file.originalFilename}
              </Button>
            ))}
          </li>
        ))}
      </ol>
      {conversation.canReply ? (
        <form className="card form-grid" onSubmit={send}>
          <label className="span-2" htmlFor="body">
            Reply
            <textarea id="body" name="body" rows={5} required maxLength={8000} />
          </label>
          <label htmlFor="file">
            Attachment (optional)
            <input id="file" name="file" type="file" />
          </label>
          <div className="form-actions span-2">
            <button type="submit">Send</button>
          </div>
        </form>
      ) : (
        <p className="muted">You cannot reply to this conversation.</p>
      )}
      <ConfirmationDialog
        open={confirmArchive}
        title="Archive this conversation?"
        description="It will move out of your inbox. You can still find it later if needed."
        confirmLabel="Archive"
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => {
          api(`/api/v1/parent/messages/${params.id}/archive`, { method: "POST", body: "{}" })
            .then(() => setConfirmArchive(false))
            .catch((err: Error) => setError(userFacingError(err)));
        }}
      />
    </>
  );
}
