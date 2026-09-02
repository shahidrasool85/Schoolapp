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

const HEADER_BREAKS = /[\r\n\u0000-\u001F\u007F]/g;
const EMAIL_ADDRESS_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function sanitizeMailHeaderValue(value: string, max = 200): string {
  return value.replace(HEADER_BREAKS, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function parseSafeEmailAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = sanitizeMailHeaderValue(value, 254).trim();
  const display = cleaned.match(/^([^<>@]*)<([^<>]+)>$/);
  const candidate = (display?.[2] ?? cleaned).replace(/[<>"]/g, "").trim();
  if (
    !EMAIL_ADDRESS_PATTERN.test(candidate) ||
    candidate.length > 254 ||
    candidate.includes("..") ||
    candidate.startsWith(".") ||
    candidate.includes("@.")
  ) {
    return null;
  }
  return candidate;
}

export function requireSafeEmailAddress(
  value: string,
  code: string = "invalid_recipient",
): string {
  const parsed = parseSafeEmailAddress(value);
  if (!parsed) {
    throw new EmailDeliveryError("permanent", code, "Invalid email address");
  }
  return parsed;
}

export function sanitizeEmailSendInput(input: EmailSendInput): EmailSendInput {
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(input.headers ?? {})) {
    if (!/^X-LuvLearn-[A-Za-z0-9-]+$/.test(key)) continue;
    headers[key] = sanitizeMailHeaderValue(headerValue, 120);
  }
  return {
    to: {
      address: requireSafeEmailAddress(input.to.address),
      name: input.to.name ? sanitizeMailHeaderValue(input.to.name, 120) : null,
    },
    from: {
      address: requireSafeEmailAddress(input.from.address, "provider_unconfigured"),
      name: input.from.name ? sanitizeMailHeaderValue(input.from.name, 160) : null,
    },
    replyTo: parseSafeEmailAddress(input.replyTo ?? null),
    subject: sanitizeMailHeaderValue(input.subject, 200),
    html: input.html,
    text: input.text,
    headers,
  };
}

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
      host: parsed?.host ?? (env.SMTP_HOST?.trim() || null),
      port: parsed?.port ?? (Number(env.SMTP_PORT ?? 587) || 587),
      secure: parsed?.secure ?? env.SMTP_SECURE === "true",
      username: parsed?.username ?? (env.SMTP_USERNAME?.trim() || null),
      password: parsed?.password ?? (env.SMTP_PASSWORD?.trim() || null),
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
  if (!config.smtp.host || !parseSafeEmailAddress(config.fromAddress)) {
    return new LogEmailProvider();
  }
  return new SmtpEmailProvider(config);
}

export function mailOutboxCanRetry(status: string, purpose: string): boolean {
  if (status === "queued") return true;
  return (
    status === "failed" &&
    (purpose === "admissions_application_received" || purpose === "admissions_status_update")
  );
}

export function liveEmailSendingEnabled(config: EmailRuntimeConfig): boolean {
  return (
    config.deliveryMode === "live" &&
    config.providerKey === "smtp" &&
    Boolean(config.smtp.host && parseSafeEmailAddress(config.fromAddress))
  );
}

export class LogEmailProvider implements EmailDeliveryProvider {
  readonly key = "log";
  readonly canSend = true;
  readonly sent: EmailSendInput[] = [];

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const safe = sanitizeEmailSendInput(input);
    this.sent.push(redactLoggedEmail(safe));
    const messageId = `log_${Date.now().toString(36)}`;
    if (process.env.VITEST !== "true") {
      console.info("email:log", {
        to: safe.to.address,
        subject: safe.subject,
        from: safe.from.address,
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
    this.canSend = Boolean(config.smtp.host && parseSafeEmailAddress(config.fromAddress));
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
      const safe = sanitizeEmailSendInput(input);
      const info = await transport.sendMail({
        from: formatAddress(safe.from),
        to: formatAddress(safe.to),
        replyTo: safe.replyTo || undefined,
        subject: safe.subject,
        text: safe.text,
        html: safe.html,
        headers: safe.headers,
      });
      return { messageId: info.messageId ?? null };
    } catch (error) {
      throw classifyProviderError(error);
    }
  }
}

export function formatAddress(input: EmailAddress): string {
  const address = requireSafeEmailAddress(input.address);
  const name = input.name ? sanitizeMailHeaderValue(input.name, 120) : "";
  if (!name) return address;
  return `"${name.replace(/"/g, "")}" <${address}>`;
}

/** Valid fallback used only when EMAIL_FROM_ADDRESS is unset in log/none/test mode. */
export const LOG_MODE_FROM_ADDRESS = "notifications@luvlearn.test";

export function platformFromAddress(
  config: EmailRuntimeConfig,
  schoolName?: string | null,
): EmailAddress {
  const configured = parseSafeEmailAddress(config.fromAddress);
  if (!configured && config.deliveryMode === "live") {
    throw new EmailDeliveryError(
      "retryable",
      "provider_unconfigured",
      "EMAIL_FROM_ADDRESS is missing or invalid",
    );
  }
  const address = configured ?? LOG_MODE_FROM_ADDRESS;
  const school = schoolName ? sanitizeMailHeaderValue(schoolName, 120) : "";
  const name = school ? `${school} via ${sanitizeMailHeaderValue(config.fromName, 80)}` : config.fromName;
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
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
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
  if (purpose === "finance_invoice_issued") return "finance_invoice_issued";
  if (purpose === "finance_payment_received") return "finance_payment_received";
  if (purpose === "finance_payment_reminder") return "finance_payment_reminder";
  if (purpose === "finance_refund_issued") return "finance_refund_issued";
  return "account_invitation";
}

export function assertEnvHasNoLoggedSecrets(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if (SECRET_ENV_KEYS.has(key)) {
      throw new Error("email_secret_log_forbidden");
    }
  }
}
