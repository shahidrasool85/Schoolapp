import type { EmailTemplateKey, MailPurpose } from "@schoolapp/domain";
import { purposeToTemplateKey } from "./email-provider.js";
import {
  renderAccountInvitation,
  renderAdmissionsApplicationReceived,
  renderAdmissionsStatusUpdate,
  renderFinanceNotice,
  renderPasswordReset,
  type TransactionalBranding,
} from "./email-templates.js";

export type MailMessage = {
  organisationId: string | null;
  purpose: MailPurpose;
  templateKey: EmailTemplateKey;
  toEmail: string;
  toName?: string | null;
  subject: string;
  textBody: string;
  htmlBody: string;
  actionUrl?: string | null;
  replyTo?: string | null;
  idempotencyKey?: string | null;
  fromName?: string | null;
  templateData?: Record<string, string | null>;
  metadata?: Record<string, unknown>;
};

export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}

export class NoopMailProvider implements MailProvider {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    assertNoPasswordInMail(message);
    this.sent.push(message);
  }
}

export class OutboxMailProvider implements MailProvider {
  constructor(
    private readonly enqueue: (message: MailMessage) => Promise<void>,
  ) {}

  async send(message: MailMessage): Promise<void> {
    assertNoPasswordInMail(message);
    await this.enqueue(sanitizeMailForOutbox(message));
  }
}

const PASSWORD_LEAK = /(?:password|passwd|pwd)\s*[:=]\s*(?!https?:|\/)[^\s]+/i;

export function assertNoPasswordInMail(message: MailMessage): void {
  const haystack = `${message.subject}\n${message.textBody}\n${message.htmlBody ?? ""}\n${JSON.stringify(message.metadata ?? {})}`;
  if (PASSWORD_LEAK.test(haystack)) {
    throw new Error("mail_password_forbidden");
  }
}

export function sanitizeMailMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (/token|acceptpath|resetpath|activatepath|actionurl|password/i.test(key)) continue;
    if (typeof value === "string") {
      out[key] = value.replace(/([?&]token=)[^&\s]+/gi, "$1redacted").slice(0, 200);
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

export function sanitizeMailForOutbox(message: MailMessage): MailMessage {
  return {
    ...message,
    metadata: sanitizeMailMetadata(message.metadata),
    templateData: sanitizeTemplateData(message.templateData),
  };
}

function sanitizeTemplateData(
  data?: Record<string, string | null>,
): Record<string, string | null> | undefined {
  if (!data) return data;
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(data)) {
    if (/token|actionurl/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function brandingOf(organisationName: string, extra?: TransactionalBranding): TransactionalBranding {
  return {
    schoolName: organisationName,
    logoUrl: extra?.logoUrl ?? null,
    primaryColor: extra?.primaryColor ?? null,
  };
}

export function staffInviteMail(input: {
  organisationId: string;
  organisationName: string;
  toEmail: string;
  toName: string;
  acceptPath: string;
  invitationId?: string | null;
  branding?: TransactionalBranding;
}): MailMessage {
  const rendered = renderAccountInvitation({
    branding: brandingOf(input.organisationName, input.branding),
    recipientName: input.toName,
    purposeLabel: `join ${input.organisationName} as a staff member`,
    actionUrl: input.acceptPath,
    expiresLabel: "14 days",
  });
  return {
    organisationId: input.organisationId,
    purpose: "staff_invite",
    templateKey: "account_invitation",
    toEmail: input.toEmail,
    toName: input.toName,
    subject: rendered.subject,
    textBody: rendered.text,
    htmlBody: rendered.html,
    actionUrl: input.acceptPath,
    idempotencyKey: input.invitationId ? `staff_invite:${input.invitationId}` : null,
    templateData: {
      recipientName: input.toName,
      purposeLabel: `join ${input.organisationName} as a staff member`,
      expiresLabel: "14 days",
    },
    metadata: { hasActionLink: true },
  };
}

export function parentInviteMail(input: {
  organisationId: string;
  organisationName: string;
  toEmail: string;
  toName: string;
  acceptPath: string;
  invitationId?: string | null;
  branding?: TransactionalBranding;
}): MailMessage {
  const rendered = renderAccountInvitation({
    branding: brandingOf(input.organisationName, input.branding),
    recipientName: input.toName,
    purposeLabel: `the Parent Portal for ${input.organisationName}`,
    actionUrl: input.acceptPath,
    expiresLabel: "14 days",
  });
  return {
    organisationId: input.organisationId,
    purpose: "parent_invite",
    templateKey: "account_invitation",
    toEmail: input.toEmail,
    toName: input.toName,
    subject: rendered.subject,
    textBody: rendered.text,
    htmlBody: rendered.html,
    actionUrl: input.acceptPath,
    idempotencyKey: input.invitationId ? `parent_invite:${input.invitationId}` : null,
    templateData: {
      recipientName: input.toName,
      purposeLabel: `the Parent Portal for ${input.organisationName}`,
      expiresLabel: "14 days",
    },
    metadata: { hasActionLink: true },
  };
}

export function passwordResetMail(input: {
  organisationId: string | null;
  organisationName?: string | null;
  toEmail: string;
  toName?: string | null;
  resetPath: string;
  tokenFingerprint?: string | null;
  branding?: TransactionalBranding;
}): MailMessage {
  const school = input.organisationName?.trim() || "LuvLearn";
  const rendered = renderPasswordReset({
    branding: brandingOf(school, input.branding),
    recipientName: input.toName,
    actionUrl: input.resetPath,
    expiresLabel: "1 hour",
  });
  return {
    organisationId: input.organisationId,
    purpose: "password_reset",
    templateKey: "password_reset",
    toEmail: input.toEmail,
    toName: input.toName ?? null,
    subject: rendered.subject,
    textBody: rendered.text,
    htmlBody: rendered.html,
    actionUrl: input.resetPath,
    idempotencyKey: input.tokenFingerprint ? `password_reset:${input.tokenFingerprint}` : null,
    templateData: {
      recipientName: input.toName ?? null,
      expiresLabel: "1 hour",
    },
    metadata: { hasActionLink: true },
  };
}

export function studentActivationMail(input: {
  organisationId: string;
  organisationName: string;
  toEmail: string;
  toName: string;
  activatePath: string;
  branding?: TransactionalBranding;
}): MailMessage {
  const rendered = renderAccountInvitation({
    branding: brandingOf(input.organisationName, input.branding),
    recipientName: input.toName,
    purposeLabel: `activate your student login for ${input.organisationName}`,
    actionUrl: input.activatePath,
    expiresLabel: "7 days",
  });
  return {
    organisationId: input.organisationId,
    purpose: "student_activation",
    templateKey: "account_invitation",
    toEmail: input.toEmail,
    toName: input.toName,
    subject: rendered.subject,
    textBody: rendered.text,
    htmlBody: rendered.html,
    actionUrl: input.activatePath,
    templateData: {
      recipientName: input.toName,
      purposeLabel: `activate your student login for ${input.organisationName}`,
      expiresLabel: "7 days",
    },
    metadata: { hasActionLink: true },
  };
}

export function admissionsApplicationReceivedMail(input: {
  organisationId: string;
  organisationName: string;
  toEmail: string;
  toName?: string | null;
  childName: string;
  applicationReference: string;
  intendedEntry?: string | null;
  applicationId: string;
  branding?: TransactionalBranding;
  replyTo?: string | null;
}): MailMessage {
  const rendered = renderAdmissionsApplicationReceived({
    branding: brandingOf(input.organisationName, input.branding),
    recipientName: input.toName,
    childName: input.childName,
    applicationReference: input.applicationReference,
    intendedEntry: input.intendedEntry,
  });
  return {
    organisationId: input.organisationId,
    purpose: "admissions_application_received",
    templateKey: "admissions_application_received",
    toEmail: input.toEmail,
    toName: input.toName ?? null,
    subject: rendered.subject,
    textBody: rendered.text,
    htmlBody: rendered.html,
    replyTo: input.replyTo ?? null,
    idempotencyKey: `admissions.application_received:${input.applicationId}`,
    templateData: {
      recipientName: input.toName ?? null,
      childName: input.childName,
      applicationReference: input.applicationReference,
      intendedEntry: input.intendedEntry ?? null,
    },
    metadata: {
      applicationId: input.applicationId,
      applicationReference: input.applicationReference,
    },
  };
}

export function admissionsStatusUpdateMail(input: {
  organisationId: string;
  organisationName: string;
  toEmail: string;
  toName?: string | null;
  childName: string;
  applicationReference: string;
  statusLabel: string;
  applicationId: string;
  eventKey: string;
  branding?: TransactionalBranding;
  replyTo?: string | null;
}): MailMessage {
  const rendered = renderAdmissionsStatusUpdate({
    branding: brandingOf(input.organisationName, input.branding),
    recipientName: input.toName,
    childName: input.childName,
    applicationReference: input.applicationReference,
    statusLabel: input.statusLabel,
  });
  return {
    organisationId: input.organisationId,
    purpose: "admissions_status_update",
    templateKey: "admissions_status_update",
    toEmail: input.toEmail,
    toName: input.toName ?? null,
    subject: rendered.subject,
    textBody: rendered.text,
    htmlBody: rendered.html,
    replyTo: input.replyTo ?? null,
    idempotencyKey: `admissions.status_update:${input.applicationId}:${input.eventKey}`,
    templateData: {
      recipientName: input.toName ?? null,
      childName: input.childName,
      applicationReference: input.applicationReference,
      statusLabel: input.statusLabel,
    },
    metadata: {
      applicationId: input.applicationId,
      applicationReference: input.applicationReference,
    },
  };
}

export function financeInvoiceIssuedMail(input: {
  organisationId: string;
  organisationName: string;
  toEmail: string;
  toName?: string | null;
  invoiceId: string;
  portalPath: string;
  branding?: TransactionalBranding;
}): MailMessage {
  const rendered = renderFinanceNotice({
    branding: brandingOf(input.organisationName, input.branding),
    recipientName: input.toName,
    documentLabel: "invoice",
    actionUrl: input.portalPath,
    heading: "Invoice available",
    subject: `${input.organisationName} — An invoice is available`,
    paragraphs: [
      `An invoice is available in your ${input.organisationName} portal.`,
      "Sign in to view the amount due and download a copy. This email does not include sensitive pupil details.",
    ],
  });
  return {
    organisationId: input.organisationId,
    purpose: "finance_invoice_issued",
    templateKey: "finance_invoice_issued",
    toEmail: input.toEmail,
    toName: input.toName ?? null,
    subject: rendered.subject,
    textBody: rendered.text,
    htmlBody: rendered.html,
    actionUrl: input.portalPath,
    idempotencyKey: `finance.invoice_issued:${input.invoiceId}`,
    templateData: { recipientName: input.toName ?? null, actionUrl: input.portalPath },
    metadata: { invoiceId: input.invoiceId, hasActionLink: true },
  };
}

export function financePaymentReceivedMail(input: {
  organisationId: string;
  organisationName: string;
  toEmail: string;
  toName?: string | null;
  paymentId: string;
  portalPath: string;
  branding?: TransactionalBranding;
}): MailMessage {
  const rendered = renderFinanceNotice({
    branding: brandingOf(input.organisationName, input.branding),
    recipientName: input.toName,
    documentLabel: "receipt",
    actionUrl: input.portalPath,
    heading: "Payment received",
    subject: `${input.organisationName} — Payment received`,
    paragraphs: [
      `A payment has been recorded and a receipt is available in your ${input.organisationName} portal.`,
      "Sign in to download the receipt. This email does not include card details or sensitive pupil information.",
    ],
  });
  return {
    organisationId: input.organisationId,
    purpose: "finance_payment_received",
    templateKey: "finance_payment_received",
    toEmail: input.toEmail,
    toName: input.toName ?? null,
    subject: rendered.subject,
    textBody: rendered.text,
    htmlBody: rendered.html,
    actionUrl: input.portalPath,
    idempotencyKey: `finance.payment_received:${input.paymentId}`,
    templateData: { recipientName: input.toName ?? null, actionUrl: input.portalPath },
    metadata: { paymentId: input.paymentId, hasActionLink: true },
  };
}

export function financeRefundIssuedMail(input: {
  organisationId: string;
  organisationName: string;
  toEmail: string;
  toName?: string | null;
  creditId: string;
  portalPath: string;
  branding?: TransactionalBranding;
}): MailMessage {
  const rendered = renderFinanceNotice({
    branding: brandingOf(input.organisationName, input.branding),
    recipientName: input.toName,
    documentLabel: "refund",
    actionUrl: input.portalPath,
    heading: "Refund recorded",
    subject: `${input.organisationName} — Refund recorded`,
    paragraphs: [
      `A refund or credit has been recorded on your ${input.organisationName} family account.`,
      "Sign in to the portal to view the updated balance. Historical receipts are unchanged.",
    ],
  });
  return {
    organisationId: input.organisationId,
    purpose: "finance_refund_issued",
    templateKey: "finance_refund_issued",
    toEmail: input.toEmail,
    toName: input.toName ?? null,
    subject: rendered.subject,
    textBody: rendered.text,
    htmlBody: rendered.html,
    actionUrl: input.portalPath,
    idempotencyKey: `finance.refund_issued:${input.creditId}`,
    templateData: { recipientName: input.toName ?? null, actionUrl: input.portalPath },
    metadata: { creditId: input.creditId, hasActionLink: true },
  };
}

export function templateKeyForMessage(message: MailMessage): EmailTemplateKey {
  return message.templateKey ?? purposeToTemplateKey(message.purpose);
}
