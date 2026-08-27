import type { MailPurpose } from "@schoolapp/domain";

export type MailMessage = {
  organisationId: string | null;
  purpose: MailPurpose;
  toEmail: string;
  toName?: string | null;
  subject: string;
  textBody: string;
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
    await this.enqueue(message);
  }
}

const PASSWORD_LEAK = /password\s*[:=]|passwd\s*[:=]|pwd\s*[:=]/i;

export function assertNoPasswordInMail(message: MailMessage): void {
  const haystack = `${message.subject}\n${message.textBody}\n${JSON.stringify(message.metadata ?? {})}`;
  if (PASSWORD_LEAK.test(haystack)) {
    throw new Error("mail_password_forbidden");
  }
}

export function staffInviteMail(input: {
  organisationId: string;
  organisationName: string;
  toEmail: string;
  toName: string;
  acceptPath: string;
}): MailMessage {
  return {
    organisationId: input.organisationId,
    purpose: "staff_invite",
    toEmail: input.toEmail,
    toName: input.toName,
    subject: `You have been invited to ${input.organisationName}`,
    textBody: [
      `Hello ${input.toName},`,
      "",
      `You have been invited to join ${input.organisationName} on Schoolapp.`,
      `Open this link to create your password: ${input.acceptPath}`,
      "",
      "This invitation expires and can only be used once.",
    ].join("\n"),
    metadata: { acceptPath: input.acceptPath },
  };
}

export function parentInviteMail(input: {
  organisationId: string;
  organisationName: string;
  toEmail: string;
  toName: string;
  acceptPath: string;
}): MailMessage {
  return {
    organisationId: input.organisationId,
    purpose: "parent_invite",
    toEmail: input.toEmail,
    toName: input.toName,
    subject: `Parent Portal invitation for ${input.organisationName}`,
    textBody: [
      `Hello ${input.toName},`,
      "",
      `You have been invited to the Parent Portal for ${input.organisationName}.`,
      `Open this link to create your password: ${input.acceptPath}`,
      "",
      "This invitation expires and can only be used once.",
    ].join("\n"),
    metadata: { acceptPath: input.acceptPath },
  };
}

export function passwordResetMail(input: {
  organisationId: string | null;
  toEmail: string;
  toName?: string | null;
  resetPath: string;
}): MailMessage {
  return {
    organisationId: input.organisationId,
    purpose: "password_reset",
    toEmail: input.toEmail,
    toName: input.toName ?? null,
    subject: "Reset your Schoolapp password",
    textBody: [
      "A password reset was requested for this account.",
      `Open this link to choose a new password: ${input.resetPath}`,
      "",
      "If you did not request this, you can ignore this message.",
    ].join("\n"),
    metadata: { resetPath: input.resetPath },
  };
}

export function studentActivationMail(input: {
  organisationId: string;
  organisationName: string;
  toEmail: string;
  toName: string;
  activatePath: string;
}): MailMessage {
  return {
    organisationId: input.organisationId,
    purpose: "student_activation",
    toEmail: input.toEmail,
    toName: input.toName,
    subject: `Activate your ${input.organisationName} student login`,
    textBody: [
      `Hello ${input.toName},`,
      "",
      `Activate your student login for ${input.organisationName}: ${input.activatePath}`,
      "",
      "This link expires and can only be used once.",
    ].join("\n"),
    metadata: { activatePath: input.activatePath },
  };
}
