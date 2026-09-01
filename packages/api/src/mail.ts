import type { Context } from "hono";
import {
  OutboxMailProvider,
  originForHostname,
  schoolInviteUrl,
  schoolPublicOrigin,
  type EmailDeliveryProvider,
  type EmailRuntimeConfig,
  type MailMessage,
  type MailProvider,
} from "@schoolapp/core";
import type { ApiEnv } from "./types";
import { deliverQueuedMail } from "./email-delivery";

export function mailOf(c: Context<ApiEnv>): MailProvider {
  const config = c.get("config");
  if (config.mailProvider) {
    return wrapMailProvider(config.mailProvider, async () => undefined);
  }
  const inner = new OutboxMailProvider(async (message) => {
    const id = await enqueueTransactionalEmail(c, message);
    if (id) {
      await deliverQueuedMail(config, { id }).catch(() => undefined);
    }
  });
  return wrapMailProvider(inner, async () => undefined);
}

function wrapMailProvider(
  inner: MailProvider,
  afterEnqueue: () => Promise<void>,
): MailProvider {
  return {
    async send(message: MailMessage) {
      try {
        await inner.send(message);
        await afterEnqueue();
      } catch (error) {
        if (error instanceof Error && error.message === "mail_password_forbidden") throw error;
        console.error("mail_enqueue_or_delivery_failed", {
          purpose: message.purpose,
          templateKey: message.templateKey,
        });
      }
    },
  };
}

export async function enqueueTransactionalEmail(
  c: Context<ApiEnv>,
  message: MailMessage,
): Promise<string | null> {
  const result = await c.get("config").pools.app.query<{ enqueue_transactional_email: string }>(
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
  return result.rows[0]?.enqueue_transactional_email ?? null;
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

export function appOriginOf(c: Context<ApiEnv>): string {
  const host = c.get("tenantHost");
  const config = c.get("config");
  if (host.kind === "school") {
    return schoolPublicOrigin(host.slug, config.platformDomain, { port: host.port });
  }
  const local = config.platformDomain === "localhost";
  return originForHostname({
    hostname: config.platformDomain,
    port: host.port ?? (local ? "3000" : null),
    protocol: local ? "http" : "https",
  });
}

export function absoluteAppPath(c: Context<ApiEnv>, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${appOriginOf(c)}${path.startsWith("/") ? path : `/${path}`}`;
}

export function schoolInviteAbsoluteUrl(
  c: Context<ApiEnv>,
  slug: string,
  token: string,
): string {
  return schoolInviteUrl(slug, c.get("config").platformDomain, token, {
    port: c.get("tenantHost").port,
  });
}

export function emailRuntimeOf(c: Context<ApiEnv>): EmailRuntimeConfig | undefined {
  return c.get("config").email;
}

export function emailDeliveryOf(c: Context<ApiEnv>): EmailDeliveryProvider | undefined {
  return c.get("config").emailDeliveryProvider;
}
