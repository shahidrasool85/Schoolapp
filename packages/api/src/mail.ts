import type { Context } from "hono";
import { OutboxMailProvider, type MailProvider } from "@schoolapp/core";
import type { ApiEnv } from "./types";

export function mailOf(c: Context<ApiEnv>): MailProvider {
  const config = c.get("config");
  if (config.mailProvider) return config.mailProvider;
  return new OutboxMailProvider(async (message) => {
    await config.pools.app.query(
      "select enqueue_mail_message($1, $2, $3, $4, $5, $6, $7::jsonb)",
      [
        message.organisationId,
        message.purpose,
        message.toEmail,
        message.toName ?? null,
        message.subject,
        message.textBody,
        JSON.stringify(message.metadata ?? {}),
      ],
    );
  });
}

export function inviteAcceptPath(token: string): string {
  return `/invite?token=${encodeURIComponent(token)}`;
}

export function resetPasswordPath(token: string): string {
  return `/reset-password?token=${encodeURIComponent(token)}`;
}

export function activatePath(token: string): string {
  return `/activate?token=${encodeURIComponent(token)}`;
}
