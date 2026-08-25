"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Alert, ConfirmationDialog, EmptyState, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../components/ui";
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
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<"close" | "archive" | "redact" | null>(null);
  const [redactId, setRedactId] = useState<string | null>(null);

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
    load().catch((err: Error) => setLoadError(userFacingError(err, "Could not load this conversation.")));
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
      setActionError("");
      await load();
    } catch (err) {
      setActionError(userFacingError(err, "Could not send the message"));
    }
  }

  async function closeThread() {
    await api(`/api/v1/messages/conversations/${params.id}/close`, { method: "POST", body: "{}" });
    setNotice("Conversation closed.");
    setConfirm(null);
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
    setConfirm(null);
    setRedactId(null);
    await load();
  }

  async function archiveThread() {
    await api(`/api/v1/messages/conversations/${params.id}/archive`, { method: "POST", body: "{}" });
    setNotice("Conversation archived in your inbox.");
    setConfirm(null);
    await load();
  }

  if (loadError) return <PageError title="Conversation unavailable" description={loadError} />;
  if (!conversation) return <LoadingState label="Loading conversation…" />;

  return (
    <>
      <PageHeader
        title={conversation.subject}
        description={`${conversation.pupilName ?? "No linked pupil"}${
          conversation.participants.length
            ? ` · ${conversation.participants.map((item) => item.fullName).filter(Boolean).join(", ")}`
            : ""
        }`}
        breadcrumbs={[
          { href: "/school/messages", label: "Messages" },
          { label: conversation.subject },
        ]}
        actions={
          <>
            <StatusBadge status={conversation.status} />
            {conversation.canManage && conversation.status === "open" ? (
              <Button type="button" variant="secondary" onClick={() => setConfirm("close")}>
                Close conversation
              </Button>
            ) : null}
            {conversation.canManage && conversation.status !== "open" ? (
              <Button type="button" variant="secondary" onClick={() => reopenThread().catch((err: Error) => setActionError(userFacingError(err)))}>
                Reopen
              </Button>
            ) : null}
            {conversation.isParticipant ? (
              <Button type="button" variant="ghost" onClick={() => setConfirm("archive")}>
                Archive
              </Button>
            ) : null}
          </>
        }
      />
      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
      {conversation.status === "closed" ? (
        <p className="alert alert-info" role="status">
          This conversation is closed. New replies are not allowed unless a member of staff reopens it.
        </p>
      ) : null}
      {notice ? <p role="status" className="alert alert-success">{notice}</p> : null}
      {messages.length === 0 ? <EmptyState title="No messages yet" description="Replies will appear in this thread." /> : null}
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
                    setActionError(userFacingError(err)),
                  )
                }
              >
                Download {file.originalFilename}
              </Button>
            ))}
            {conversation.canModerate && !item.redacted && item.messageType === "user" ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setRedactId(item.id);
                  setConfirm("redact");
                }}
              >
                Redact message
              </Button>
            ) : null}
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
      <p>
        <Link href="/school/messages">Back to inbox</Link>
      </p>
      <ConfirmationDialog
        open={confirm === "close"}
        title="Close this conversation?"
        description="Parents will not be able to reply until a member of staff reopens it."
        confirmLabel="Close conversation"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={() => closeThread().catch((err: Error) => setActionError(userFacingError(err)))}
      />
      <ConfirmationDialog
        open={confirm === "archive"}
        title="Archive this conversation?"
        description="It will move to your archived folder. You can still open it later."
        confirmLabel="Archive"
        onClose={() => setConfirm(null)}
        onConfirm={() => archiveThread().catch((err: Error) => setActionError(userFacingError(err)))}
      />
      <ConfirmationDialog
        open={confirm === "redact"}
        title="Redact this message?"
        description="The original text is hidden from participants. The history remains for authorised staff."
        confirmLabel="Redact"
        danger
        onClose={() => {
          setConfirm(null);
          setRedactId(null);
        }}
        onConfirm={() =>
          redactId ? redact(redactId).catch((err: Error) => setActionError(userFacingError(err))) : undefined
        }
      />
    </>
  );
}
