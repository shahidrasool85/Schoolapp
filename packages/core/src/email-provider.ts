import type { EmailTemplateKey } from "@schoolapp/domain";
import type { MailPurpose } from "@schoolapp/domain";

export type EmailAddress = {
  address: string;
  name?: string | null;
};

export type EmailSendInput = {
  to: EmailAddress;
  from: EmailAddress;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export type EmailSendResult = {
  messageId?: string | null;
};

export type EmailDeliveryErrorKind = "retryable" | "permanent";

export class EmailDeliveryError extends Error {
  readonly kind: EmailDeliveryErrorKind;
  readonly code: string;
  readonly retryable: boolean;

  constructor(kind: EmailDeliveryErrorKind, code: string, message: string) {
    super(message);
    this.name = "EmailDeliveryError";
    this.kind = kind;
    this.code = code;
    this.retryable = kind === "retryable";
  }
}

export interface EmailDeliveryProvider {
  readonly key: string;
  readonly canSend: boolean;
  send(input: EmailSendInput): Promise<EmailSendResult>;
}

export type EmailDeliveryMode = "log" | "test" | "live";
export type EmailProviderKey = "none" | "log" | "smtp";

export type EmailRuntimeConfig = {
  providerKey: EmailProviderKey;
  deliveryMode: EmailDeliveryMode;
  fromAddress: string | null;
  fromName: string;
  replyToFallback: string | null;
  smtp: {
    host: string | null;
    port: number;
    secure: boolean;
    username: string | null;
    password: string | null;
  };
};

const SECRET_ENV_KEYS = new Set([
  "SMTP_PASSWORD",
  "SMTP_USERNAME",
  "SMTP_URL",
  "EMAIL_SMTP_PASSWORD",
]);

export function emailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmailRuntimeConfig {
  const provider = (env.EMAIL_PROVIDER ?? "none").trim().toLowerCase();
  const providerKey: EmailProviderKey = provider === "smtp" ? "smtp" : provider === "log" ? "log" : "none";
  const mode = (env.EMAIL_DELIVERY_MODE ?? (providerKey === "none" ? "log" : "log")).trim().toLowerCase();
  const deliveryMode: EmailDeliveryMode = mode === "live" ? "live" : mode === "test" ? "test" : "log";
  const smtpUrl = env.SMTP_URL?.trim() || null;
  const parsed = smtpUrl ? parseSmtpUrl(smtpUrl) : null;
  return {
    providerKey,
    deliveryMode,
    fromAddress: env.EMAIL_FROM_ADDRESS?.trim() || null,
    fromName: env.EMAIL_FROM_NAME?.trim() || "LuvLearn",
    replyToFallback: env.EMAIL_REPLY_TO?.trim() || null,
    smtp: {
      host: parsed?.host ?? env.SMTP_HOST?.trim() || null,
      port: parsed?.port ?? Number(env.SMTP_PORT ?? 587) || 587,
      secure: parsed?.secure ?? env.SMTP_SECURE === "true",
      username: parsed?.username ?? env.SMTP_USERNAME?.trim() || null,
      password: parsed?.password ?? env.SMTP_PASSWORD?.trim() || null,
    },
  };
}

export function parseSmtpUrl(raw: string): {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
} | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "smtp:" && url.protocol !== "smtps:") return null;
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "smtps:" ? 465 : 587,
      secure: url.protocol === "smtps:" || url.port === "465",
      username: url.username ? decodeURIComponent(url.username) : null,
      password: url.password ? decodeURIComponent(url.password) : null,
    };
  } catch {
    return null;
  }
}

export function createEmailDeliveryProvider(
  config: EmailRuntimeConfig,
  options: { fake?: FakeEmailProvider } = {},
): EmailDeliveryProvider {
  if (options.fake) return options.fake;
  if (config.deliveryMode === "test") return new FakeEmailProvider();
  if (config.deliveryMode !== "live" || config.providerKey !== "smtp") {
    return new LogEmailProvider();
  }
  if (!config.smtp.host || !config.fromAddress) {
    return new LogEmailProvider();
  }
  return new SmtpEmailProvider(config);
}

export function liveEmailSendingEnabled(config: EmailRuntimeConfig): boolean {
  return (
    config.deliveryMode === "live" &&
    config.providerKey === "smtp" &&
    Boolean(config.smtp.host && config.fromAddress)
  );
}

export class LogEmailProvider implements EmailDeliveryProvider {
  readonly key = "log";
  readonly canSend = true;
  readonly sent: EmailSendInput[] = [];

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    this.sent.push(redactLoggedEmail(input));
    const messageId = `log_${Date.now().toString(36)}`;
    if (process.env.VITEST !== "true") {
      console.info("email:log", {
        to: input.to.address,
        subject: input.subject,
        from: input.from.address,
        messageId,
      });
    }
    return { messageId };
  }
}

export class FakeEmailProvider implements EmailDeliveryProvider {
  readonly key = "fake";
  readonly canSend = true;
  readonly sent: EmailSendInput[] = [];
  failNext: EmailDeliveryError | null = null;
  failMatching: ((input: EmailSendInput) => EmailDeliveryError | null) | null = null;

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const forced = this.failNext ?? this.failMatching?.(input) ?? null;
    this.failNext = null;
    if (forced) throw forced;
    this.sent.push(input);
    return { messageId: `fake_${this.sent.length}` };
  }
}

export class SmtpEmailProvider implements EmailDeliveryProvider {
  readonly key = "smtp";
  readonly canSend: boolean;

  constructor(private readonly config: EmailRuntimeConfig) {
    this.canSend = Boolean(config.smtp.host && config.fromAddress);
  }

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    if (!this.canSend) {
      throw new EmailDeliveryError("permanent", "provider_unconfigured", "SMTP is not configured");
    }
    let createTransport: typeof import("nodemailer")["createTransport"];
    try {
      const imported = await import("nodemailer");
      const mod = (imported as { default?: typeof import("nodemailer") }).default ?? imported;
      createTransport = mod.createTransport;
    } catch {
      throw new EmailDeliveryError(
        "permanent",
        "smtp_unavailable",
        "The SMTP adapter is not installed",
      );
    }
    const transport = createTransport({
      host: this.config.smtp.host ?? undefined,
      port: this.config.smtp.port,
      secure: this.config.smtp.secure,
      auth:
        this.config.smtp.username && this.config.smtp.password
          ? { user: this.config.smtp.username, pass: this.config.smtp.password }
          : undefined,
    });
    try {
      const info = await transport.sendMail({
        from: formatAddress(input.from),
        to: formatAddress(input.to),
        replyTo: input.replyTo || undefined,
        subject: input.subject,
        text: input.text,
        html: input.html,
        headers: input.headers,
      });
      return { messageId: info.messageId ?? null };
    } catch (error) {
      throw classifyProviderError(error);
    }
  }
}

export function formatAddress(input: EmailAddress): string {
  const name = input.name?.trim();
  if (!name) return input.address;
  const safe = name.replace(/[\r\n<>"]/g, "");
  return `"${safe}" <${input.address}>`;
}

export function platformFromAddress(
  config: EmailRuntimeConfig,
  schoolName?: string | null,
): EmailAddress {
  const address = config.fromAddress || "notifications@localhost";
  const school = schoolName?.trim();
  const name = school ? `${school} via ${config.fromName}` : config.fromName;
  return { address, name };
}

export function classifyProviderError(error: unknown): EmailDeliveryError {
  const message = error instanceof Error ? error.message : String(error ?? "Delivery failed");
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const responseCode =
    error && typeof error === "object" && "responseCode" in error
      ? Number((error as { responseCode?: unknown }).responseCode)
      : NaN;
  const haystack = `${code} ${message}`.toLowerCase();
  if (
    haystack.includes("etimedout") ||
    haystack.includes("econnreset") ||
    haystack.includes("econnrefused") ||
    haystack.includes("socket") ||
    haystack.includes("timeout") ||
    haystack.includes("429") ||
    haystack.includes("rate") ||
    (Number.isFinite(responseCode) && responseCode >= 400 && responseCode < 500 && responseCode !== 422 && responseCode !== 400)
  ) {
    if (responseCode === 550 || responseCode === 551 || responseCode === 553 || responseCode === 554) {
      return new EmailDeliveryError("permanent", "invalid_recipient", redactEmailError(message));
    }
    if (Number.isFinite(responseCode) && responseCode >= 500) {
      return new EmailDeliveryError("retryable", "provider_unavailable", redactEmailError(message));
    }
    return new EmailDeliveryError("retryable", code || "provider_timeout", redactEmailError(message));
  }
  if (
    haystack.includes("invalid recipient") ||
    haystack.includes("user unknown") ||
    haystack.includes("mailbox unavailable") ||
    haystack.includes("no such user") ||
    responseCode === 550 ||
    responseCode === 551 ||
    responseCode === 553
  ) {
    return new EmailDeliveryError("permanent", "invalid_recipient", redactEmailError(message));
  }
  if (Number.isFinite(responseCode) && responseCode >= 500) {
    return new EmailDeliveryError("retryable", "provider_unavailable", redactEmailError(message));
  }
  if (Number.isFinite(responseCode) && responseCode >= 400) {
    return new EmailDeliveryError("permanent", "provider_rejected", redactEmailError(message));
  }
  return new EmailDeliveryError("retryable", code || "provider_error", redactEmailError(message));
}

export function redactEmailError(message: string): string {
  return message
    .replace(/token=[^&\s]+/gi, "token=redacted")
    .replace(/pass(?:word)?[=:]\s*\S+/gi, "password=redacted")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[address]")
    .slice(0, 300);
}

export function redactLoggedEmail(input: EmailSendInput): EmailSendInput {
  return {
    ...input,
    html: redactActionUrls(input.html),
    text: redactActionUrls(input.text),
    headers: input.headers,
  };
}

export function redactActionUrls(value: string): string {
  return value.replace(/([?&]token=)[^&\s"'<>]+/gi, "$1redacted");
}

export function purposeToTemplateKey(purpose: MailPurpose): EmailTemplateKey {
  if (purpose === "password_reset") return "password_reset";
  if (purpose === "admissions_application_received") return "admissions_application_received";
  if (purpose === "admissions_status_update") return "admissions_status_update";
  return "account_invitation";
}

export function assertEnvHasNoLoggedSecrets(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if (SECRET_ENV_KEYS.has(key)) {
      throw new Error("email_secret_log_forbidden");
    }
  }
}
