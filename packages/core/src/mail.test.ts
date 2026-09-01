import { describe, expect, it } from "vitest";
import {
  assertNoPasswordInMail,
  NoopMailProvider,
  passwordResetMail,
  sanitizeMailMetadata,
  staffInviteMail,
} from "./mail.js";

describe("mail provider", () => {
  it("records local messages without a remote provider", async () => {
    const mail = new NoopMailProvider();
    await mail.send(
      staffInviteMail({
        organisationId: "org",
        organisationName: "Riverside",
        toEmail: "a@example.com",
        toName: "Alex",
        acceptPath: "/invite?token=abc",
      }),
    );
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.textBody).not.toMatch(/password\s*[:=]/i);
    expect(mail.sent[0]?.htmlBody).toContain("Activate account");
    expect(mail.sent[0]?.templateKey).toBe("account_invitation");
  });

  it("refuses messages that include passwords", () => {
    expect(() =>
      assertNoPasswordInMail({
        organisationId: null,
        purpose: "password_reset",
        templateKey: "password_reset",
        toEmail: "a@example.com",
        subject: "Reset",
        textBody: "Your password: hunter2",
        htmlBody: "<p>Your password: hunter2</p>",
      }),
    ).toThrow("mail_password_forbidden");
  });

  it("keeps reset mail token-only in the live body, not metadata", () => {
    const message = passwordResetMail({
      organisationId: "org",
      toEmail: "a@example.com",
      resetPath: "/reset-password?token=deadbeef",
    });
    expect(message.textBody).toContain("/reset-password?token=deadbeef");
    expect(message.actionUrl).toContain("deadbeef");
    expect(message.textBody.toLowerCase()).not.toContain("password:");
    expect(JSON.stringify(message.metadata)).not.toContain("deadbeef");
  });

  it("strips token-bearing keys from stored metadata", () => {
    expect(
      sanitizeMailMetadata({
        acceptPath: "/invite?token=secret",
        hasActionLink: true,
        note: "ok",
      }),
    ).toEqual({ hasActionLink: true, note: "ok" });
  });
});
