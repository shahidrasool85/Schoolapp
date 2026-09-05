import type { EmailTemplateKey } from "@schoolapp/domain";

export type TransactionalBranding = {
  schoolName: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
};

export type EmailButton = {
  label: string;
  url: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

const DEFAULT_PRIMARY = "#2B78C9";
const NAVY = "#122C4A";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeEmailText(value: unknown, max = 400): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<\/?[^>]+>/g, "")
    .trim()
    .slice(0, max);
}

export function fixturePreviewData(template: EmailTemplateKey): Record<string, string> {
  if (template === "password_reset") {
    return {
      recipientName: "Alex Example",
      schoolName: "Kingswood School",
      actionUrl: "https://kingswood.example.test/reset-password?token=preview",
      expiresLabel: "1 hour",
    };
  }
  if (template === "admissions_enquiry_received") {
    return {
      recipientName: "Jordan Example",
      schoolName: "Kingswood School",
      enquiryReference: "ENQ-1001",
    };
  }
  if (template === "admissions_application_received") {
    return {
      recipientName: "Sarah Example",
      schoolName: "Kingswood School",
      childName: "Maya Example",
      applicationReference: "APP-1001",
      intendedEntry: "Year 3 — 2026/27",
    };
  }
  if (template === "admissions_status_update") {
    return {
      recipientName: "Sarah Example",
      schoolName: "Kingswood School",
      childName: "Maya Example",
      applicationReference: "APP-1001",
      statusLabel: "Under review",
    };
  }
  if (
    template === "finance_invoice_issued" ||
    template === "finance_payment_received" ||
    template === "finance_payment_reminder" ||
    template === "finance_refund_issued"
  ) {
    return {
      recipientName: "Pat Example",
      schoolName: "Kingswood School",
      documentLabel: template === "finance_invoice_issued" ? "invoice" : template === "finance_refund_issued" ? "refund" : "receipt",
      actionUrl: "https://kingswood.example.test/parent/finance",
    };
  }
  return {
    recipientName: "Alex Example",
    schoolName: "Kingswood School",
    purposeLabel: "join Kingswood School as a staff member",
    actionUrl: "https://kingswood.example.test/invite?token=preview",
    expiresLabel: "14 days",
  };
}

export function renderAccountInvitation(input: {
  branding: TransactionalBranding;
  recipientName?: string | null;
  purposeLabel: string;
  actionUrl: string;
  expiresLabel: string;
}): RenderedEmail {
  const school = safeEmailText(input.branding.schoolName, 160) || "School";
  const name = safeEmailText(input.recipientName, 120) || "there";
  const purpose = safeEmailText(input.purposeLabel, 200);
  const expires = safeEmailText(input.expiresLabel, 40);
  return renderShell({
    branding: input.branding,
    subject: `You have been invited to ${school}`,
    heading: `${school}`,
    preheader: `Invitation to ${school}`,
    greeting: `Hello ${name},`,
    paragraphs: [
      `You have been invited to ${purpose}.`,
      "Use the button below to finish setting up your account. This link can be used once.",
      `This invitation expires in ${expires}.`,
    ],
    button: { label: "Activate account", url: input.actionUrl },
    footerNote: "If you were not expecting this invitation, you can ignore this email.",
  });
}

export function renderPasswordReset(input: {
  branding: TransactionalBranding;
  recipientName?: string | null;
  actionUrl: string;
  expiresLabel: string;
}): RenderedEmail {
  const school = safeEmailText(input.branding.schoolName, 160) || "LuvLearn";
  const name = safeEmailText(input.recipientName, 120);
  const expires = safeEmailText(input.expiresLabel, 40);
  return renderShell({
    branding: input.branding,
    subject: "Password reset requested",
    heading: "Reset your password",
    preheader: `Password reset for ${school}`,
    greeting: name ? `Hello ${name},` : "Hello,",
    paragraphs: [
      `A password reset was requested for your ${school} account.`,
      `This link expires in ${expires} and can be used once.`,
    ],
    button: { label: "Reset password", url: input.actionUrl },
    footerNote: "If you didn't request this, you can ignore this email.",
  });
}

export function renderAdmissionsEnquiryReceived(input: {
  branding: TransactionalBranding;
  recipientName?: string | null;
}): RenderedEmail {
  const school = safeEmailText(input.branding.schoolName, 160) || "School";
  const name = safeEmailText(input.recipientName, 120) || "Parent/Guardian";
  return renderShell({
    branding: input.branding,
    subject: `Thank you for your enquiry – ${school}`,
    heading: "Enquiry received",
    preheader: `We have received your enquiry to ${school}`,
    greeting: `Dear ${name},`,
    paragraphs: [
      `Thank you for contacting ${school}.`,
      "We have received your enquiry and a member of our team will get back to you shortly.",
    ],
    signoff: `Kind regards,\n${school}`,
  });
}

export function renderAdmissionsApplicationReceived(input: {
  branding: TransactionalBranding;
  recipientName?: string | null;
  childName: string;
  applicationReference: string;
  intendedEntry?: string | null;
}): RenderedEmail {
  const school = safeEmailText(input.branding.schoolName, 160) || "School";
  const name = safeEmailText(input.recipientName, 120) || "Parent/Guardian";
  const child = safeEmailText(input.childName, 120) || "your child";
  const reference = safeEmailText(input.applicationReference, 40);
  const entry = safeEmailText(input.intendedEntry, 80);
  const paragraphs = [
    `Thank you for applying to ${school} for ${child}.`,
    `Application reference: ${reference}`,
  ];
  if (entry) paragraphs.push(`Intended entry: ${entry}`);
  paragraphs.push("We have received your application.");
  paragraphs.push("The admissions team will contact you if further information is required.");
  return renderShell({
    branding: input.branding,
    subject: `${school} — Application received`,
    heading: "Application received",
    preheader: `We have received your application to ${school}`,
    greeting: `Hello ${name},`,
    paragraphs,
    signoff: `Regards\n${school} Admissions`,
  });
}

export function renderAdmissionsStatusUpdate(input: {
  branding: TransactionalBranding;
  recipientName?: string | null;
  childName: string;
  applicationReference: string;
  statusLabel: string;
}): RenderedEmail {
  const school = safeEmailText(input.branding.schoolName, 160) || "School";
  const name = safeEmailText(input.recipientName, 120) || "Parent/Guardian";
  const child = safeEmailText(input.childName, 120) || "your child";
  const reference = safeEmailText(input.applicationReference, 40);
  const status = safeEmailText(input.statusLabel, 80) || "updated";
  return renderShell({
    branding: input.branding,
    subject: `${school} — Application update`,
    heading: "Application update",
    preheader: `An update on your application to ${school}`,
    greeting: `Hello ${name},`,
    paragraphs: [
      `There is an update on the application for ${child}.`,
      `Application reference: ${reference}`,
      `Status: ${status}`,
      "Please sign in to the school portal if you have been given access, or wait to hear from the admissions team.",
    ],
    signoff: `Regards\n${school} Admissions`,
  });
}

export function renderFinanceNotice(input: {
  branding: TransactionalBranding;
  recipientName?: string | null;
  documentLabel: string;
  actionUrl: string;
  heading: string;
  subject: string;
  paragraphs: string[];
}): RenderedEmail {
  const school = safeEmailText(input.branding.schoolName, 160) || "School";
  const name = safeEmailText(input.recipientName, 120) || "Parent/Guardian";
  return renderShell({
    branding: input.branding,
    subject: input.subject.replace("{school}", school),
    heading: input.heading,
    preheader: input.paragraphs[0] ?? `${school} finance`,
    greeting: `Hello ${name},`,
    paragraphs: input.paragraphs,
    button: { label: "Open parent portal", url: input.actionUrl },
    signoff: `Regards\n${school}`,
  });
}

export function renderEmailTemplate(
  template: EmailTemplateKey,
  data: Record<string, string | null | undefined>,
  branding: TransactionalBranding,
): RenderedEmail {
  if (template === "password_reset") {
    return renderPasswordReset({
      branding,
      recipientName: data.recipientName,
      actionUrl: data.actionUrl || "#",
      expiresLabel: data.expiresLabel || "1 hour",
    });
  }
  if (template === "admissions_enquiry_received") {
    return renderAdmissionsEnquiryReceived({
      branding,
      recipientName: data.recipientName,
    });
  }
  if (template === "admissions_application_received") {
    return renderAdmissionsApplicationReceived({
      branding,
      recipientName: data.recipientName,
      childName: data.childName || "your child",
      applicationReference: data.applicationReference || "",
      intendedEntry: data.intendedEntry,
    });
  }
  if (template === "admissions_status_update") {
    return renderAdmissionsStatusUpdate({
      branding,
      recipientName: data.recipientName,
      childName: data.childName || "your child",
      applicationReference: data.applicationReference || "",
      statusLabel: data.statusLabel || "updated",
    });
  }
  if (template === "finance_invoice_issued") {
    const school = safeEmailText(branding.schoolName, 160) || "School";
    return renderFinanceNotice({
      branding,
      recipientName: data.recipientName,
      documentLabel: "invoice",
      actionUrl: data.actionUrl || "#",
      heading: "Invoice available",
      subject: `${school} — An invoice is available`,
      paragraphs: [
        `An invoice is available in your ${school} portal.`,
        "Sign in to view the amount due and download a copy. This email does not include sensitive pupil details.",
      ],
    });
  }
  if (template === "finance_payment_received") {
    const school = safeEmailText(branding.schoolName, 160) || "School";
    return renderFinanceNotice({
      branding,
      recipientName: data.recipientName,
      documentLabel: "receipt",
      actionUrl: data.actionUrl || "#",
      heading: "Payment received",
      subject: `${school} — Payment received`,
      paragraphs: [
        `A payment has been recorded and a receipt is available in your ${school} portal.`,
        "Sign in to download the receipt. This email does not include card details or sensitive pupil information.",
      ],
    });
  }
  if (template === "finance_payment_reminder") {
    const school = safeEmailText(branding.schoolName, 160) || "School";
    return renderFinanceNotice({
      branding,
      recipientName: data.recipientName,
      documentLabel: "invoice",
      actionUrl: data.actionUrl || "#",
      heading: "Payment reminder",
      subject: `${school} — Payment reminder`,
      paragraphs: [
        `A reminder is available for a school invoice in your ${school} portal.`,
        "Sign in to review the balance and pay if a payment option is offered.",
      ],
    });
  }
  if (template === "finance_refund_issued") {
    const school = safeEmailText(branding.schoolName, 160) || "School";
    return renderFinanceNotice({
      branding,
      recipientName: data.recipientName,
      documentLabel: "refund",
      actionUrl: data.actionUrl || "#",
      heading: "Refund recorded",
      subject: `${school} — Refund recorded`,
      paragraphs: [
        `A refund or credit has been recorded on your ${school} family account.`,
        "Sign in to the portal to view the updated balance. Historical receipts are unchanged.",
      ],
    });
  }
  return renderAccountInvitation({
    branding,
    recipientName: data.recipientName,
    purposeLabel: data.purposeLabel || `join ${branding.schoolName}`,
    actionUrl: data.actionUrl || "#",
    expiresLabel: data.expiresLabel || "14 days",
  });
}

function renderShell(input: {
  branding: TransactionalBranding;
  subject: string;
  heading: string;
  preheader: string;
  greeting: string;
  paragraphs: string[];
  button?: EmailButton;
  footerNote?: string;
  signoff?: string;
}): RenderedEmail {
  const school = safeEmailText(input.branding.schoolName, 160) || "School";
  const color = safeHex(input.branding.primaryColor) ?? DEFAULT_PRIMARY;
  const logo = safeHttpUrl(input.branding.logoUrl);
  const textParagraphs = input.paragraphs.map((p) => safeEmailText(p, 800));
  const greeting = safeEmailText(input.greeting, 80);
  const heading = safeEmailText(input.heading, 120);
  const footerNote = input.footerNote ? safeEmailText(input.footerNote, 240) : "";
  const signoff = input.signoff ? safeEmailText(input.signoff, 160) : `Regards\n${school}`;
  const button = input.    button
      ? { label: safeEmailText(input.button.label, 40), url: safeHttpUrl(input.button.url) ?? "#" }
      : null;

  const htmlParts = [
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(input.subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:#f4f6f8;color:${NAVY};font-family:'Segoe UI',Arial,sans-serif;">`,
    `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(input.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px;">`,
    `<tr><td align="center">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d7dee6;border-radius:12px;overflow:hidden;">`,
    `<tr><td style="padding:24px 28px 8px;border-bottom:1px solid #e8eef5;">`,
    logo
      ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(school)}" width="160" style="max-width:160px;height:auto;display:block;margin-bottom:12px;">`
      : "",
    `<p style="margin:0;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:${color};font-weight:700;">${escapeHtml(school)}</p>`,
    `<h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;color:${NAVY};">${escapeHtml(heading)}</h1>`,
    `</td></tr>`,
    `<tr><td style="padding:24px 28px 8px;">`,
    `<p style="margin:0 0 16px;font-size:16px;">${escapeHtml(greeting)}</p>`,
    ...textParagraphs.map(
      (p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;">${escapeHtml(p)}</p>`,
    ),
    button
      ? `<p style="margin:24px 0;"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:650;">${escapeHtml(button.label)}</a></p>`
      : "",
    button
      ? `<p style="margin:0 0 14px;font-size:13px;color:#5c6b7a;word-break:break-all;">If the button does not work, copy this link:<br>${escapeHtml(button.url)}</p>`
      : "",
    ...signoff.split("\n").map(
      (line, index) =>
        `<p style="margin:${index === 0 ? "20px" : "0"} 0 0;font-size:15px;">${escapeHtml(line)}</p>`,
    ),
    footerNote ? `<p style="margin:20px 0 0;font-size:13px;color:#5c6b7a;">${escapeHtml(footerNote)}</p>` : "",
    `</td></tr>`,
    `<tr><td style="padding:16px 28px 24px;color:#5c6b7a;font-size:12px;">Powered by LuvLearn</td></tr>`,
    `</table></td></tr></table></body></html>`,
  ];

  const textLines = [
    school,
    heading,
    "",
    greeting,
    "",
    ...textParagraphs,
    "",
    ...(button ? [button.label, button.url, ""] : []),
    signoff,
    ...(footerNote ? ["", footerNote] : []),
    "",
    "Powered by LuvLearn",
  ];

  return {
    subject: stripHeaderBreaks(input.subject).slice(0, 200),
    html: htmlParts.join(""),
    text: textLines.join("\n"),
  };
}

function stripHeaderBreaks(value: string): string {
  return value.replace(/[\r\n\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function safeHex(value?: string | null): string | null {
  if (!value) return null;
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : null;
}

function safeHttpUrl(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
