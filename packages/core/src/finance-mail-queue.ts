import type pg from "pg";
import type { MailMessage } from "./mail.js";

export async function enqueueOutboxMail(client: pg.PoolClient, message: MailMessage): Promise<void> {
  try {
    await client.query(
      `select enqueue_transactional_email(
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13
       )`,
      [
        message.organisationId,
        message.purpose,
        message.templateKey,
        message.toEmail,
        message.toName ?? null,
        message.subject,
        message.textBody,
        JSON.stringify({
          ...(message.metadata ?? {}),
          ...(message.templateData ?? {}),
        }),
        message.idempotencyKey ?? null,
        message.actionUrl ?? null,
        message.replyTo ?? null,
        null,
        message.fromName ?? null,
      ],
    );
  } catch {
    // Finance mutations must succeed even if mail enqueue fails.
  }
}
