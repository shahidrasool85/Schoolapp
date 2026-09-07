import {
  EmailAttachmentError,
  EmailDeliveryError,
  createEmailDeliveryProvider,
  emailProviderCapabilitiesFromHost,
  liveEmailSendingEnabled,
  platformFromAddress,
  purposeToTemplateKey,
  redactEmailError,
  renderTransactionalEmail,
  sanitizeEmailSendInput,
  schoolPublicOrigin,
  type EmailDeliveryProvider,
  type EmailRuntimeConfig,
  type MailMessage,
  type TransactionalBranding,
} from "@schoolapp/core";
import { isCustomizableEmailTemplateKey } from "@schoolapp/domain";
import type { ApiConfig } from "./types";
import { loadOrganisationEmailTemplateOverride } from "./email-template-overrides";
import {
  emailAttachmentErrorToDeliveryError,
  loadSendAttachments,
  loadShowSchoolLogo,
} from "./email-template-attachments";

type ClaimedMail = {
  id: string;
  organisation_id: string | null;
  purpose: string;
  template_key: string | null;
  to_email: string;
  to_name: string | null;
  subject: string;
  body_text: string;
  metadata: Record<string, unknown> | null;
  action_url: string | null;
  reply_to: string | null;
  from_address: string | null;
  from_name: string | null;
  attempt_count: number;
  max_attempts: number;
};

export function emailProviderForConfig(config: ApiConfig): EmailDeliveryProvider {
  if (config.emailDeliveryProvider) return config.emailDeliveryProvider;
  return createEmailDeliveryProvider(config.email ?? { ...defaultEmailConfig() });
}

function defaultEmailConfig(): EmailRuntimeConfig {
  return {
    providerKey: "none",
    deliveryMode: "log",
    fromAddress: null,
    fromName: "LuvLearn",
    replyToFallback: null,
    smtp: { host: null, port: 587, secure: false, username: null, password: null },
  };
}

export async function deliverQueuedMail(
  config: ApiConfig,
  options: { limit?: number; id?: string } = {},
): Promise<{ processed: number; sent: number; failed: number }> {
  const provider = emailProviderForConfig(config);
  const email = config.email ?? defaultEmailConfig();
  const claimed = options.id
    ? await config.pools.app.query<ClaimedMail>("select * from claim_mail_outbox_message($1)", [options.id])
    : await config.pools.app.query<ClaimedMail>("select * from claim_mail_outbox_messages($1)", [
        options.limit ?? 10,
      ]);
  let sent = 0;
  let failed = 0;
  for (const row of claimed.rows) {
    try {
      if (email.deliveryMode === "live" && !liveEmailSendingEnabled(email) && provider.key !== "fake") {
        await config.pools.app.query("select fail_mail_outbox_send($1, $2, $3, $4)", [
          row.id,
          true,
          "provider_unconfigured",
          "Transactional email is queued until SMTP is configured",
        ]);
        failed += 1;
        continue;
      }
      const branding = await loadBranding(config, row.organisation_id);
      const sendInput = await buildSendInput(config, row, email, branding);
      const result = await provider.send(sendInput);
      await config.pools.app.query("select complete_mail_outbox_send($1, $2, $3)", [
        row.id,
        provider.key,
        result.messageId ?? null,
      ]);
      sent += 1;
    } catch (error) {
      const classified =
        error instanceof EmailDeliveryError
          ? error
          : error instanceof EmailAttachmentError
            ? emailAttachmentErrorToDeliveryError(error)
            : new EmailDeliveryError("retryable", "provider_error", String(error));
      // Log/none first-deploy must not permanently burn invite/reset action_url.
      const retryable =
        classified.retryable ||
        (email.deliveryMode !== "live" && classified.code === "provider_unconfigured");
      await config.pools.app.query("select fail_mail_outbox_send($1, $2, $3, $4)", [
        row.id,
        retryable,
        classified.code,
        redactEmailError(classified.message),
      ]);
      failed += 1;
    }
  }
  return { processed: claimed.rows.length, sent, failed };
}

async function loadBranding(
  config: ApiConfig,
  organisationId: string | null,
): Promise<TransactionalBranding & { replyTo?: string | null; slug?: string | null }> {
  if (!organisationId) {
    return { schoolName: "LuvLearn" };
  }
  const row = await config.pools.app.query<{
    organisation_name: string;
    organisation_slug: string;
    contact_email: string | null;
    primary_colour: string | null;
    has_logo: boolean;
    logo_version: string | null;
  }>("select * from get_transactional_mail_context($1)", [organisationId]);
  const found = row.rows[0];
  if (!found) return { schoolName: "School" };
  const origin = schoolPublicOrigin(found.organisation_slug, config.platformDomain);
  return {
    schoolName: found.organisation_name,
    primaryColor: found.primary_colour,
    logoUrl: found.has_logo
      ? `${origin}/api/v1/public/branding/logo${found.logo_version ? `?v=${found.logo_version}` : ""}`
      : null,
    replyTo: found.contact_email,
    slug: found.organisation_slug,
  };
}

async function buildSendInput(
  config: ApiConfig,
  row: ClaimedMail,
  email: EmailRuntimeConfig,
  branding: TransactionalBranding & { replyTo?: string | null; slug?: string | null },
) {
  const templateKey =
    (row.template_key as MailMessage["templateKey"]) ??
    purposeToTemplateKey(row.purpose as MailMessage["purpose"]);
  const metadata = row.metadata ?? {};
  const templateData: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") templateData[key] = value;
  }
  if (row.to_name) templateData.recipientName = row.to_name;
  if (row.action_url) templateData.actionUrl = row.action_url;
  if (branding.replyTo && !templateData.schoolContactEmail) {
    templateData.schoolContactEmail = branding.replyTo;
  }
  const override = await loadOrganisationEmailTemplateOverride(
    config.pools.app,
    row.organisation_id,
    templateKey,
  );
  const showSchoolLogo = isCustomizableEmailTemplateKey(templateKey)
    ? await loadShowSchoolLogo(config.pools.app, row.organisation_id, templateKey)
    : true;
  const rendered = renderTransactionalEmail(
    templateKey,
    templateData,
    {
      schoolName: branding.schoolName,
      logoUrl: showSchoolLogo ? branding.logoUrl : null,
      primaryColor: branding.primaryColor,
    },
    override,
  );
  const attachments = await loadSendAttachments({
    pool: config.pools.app,
    storage: config.storage,
    organisationId: row.organisation_id,
    templateKey,
    capabilities: emailProviderCapabilitiesFromHost(email.smtp.host),
  });
  const from = platformFromAddress(email, branding.schoolName);
  const subject = isCustomizableEmailTemplateKey(templateKey)
    ? rendered.subject
    : row.subject || rendered.subject;
  return sanitizeEmailSendInput(
    {
      to: { address: row.to_email, name: row.to_name },
      from,
      replyTo: row.reply_to || branding.replyTo || email.replyToFallback,
      subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        "X-LuvLearn-Template": templateKey,
        "X-LuvLearn-Purpose": row.purpose,
      },
      attachments,
    },
    emailProviderCapabilitiesFromHost(email.smtp.host),
  );
}
