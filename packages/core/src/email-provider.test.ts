import { describe, expect, it } from "vitest";
import {
  classifyProviderError,
  createEmailDeliveryProvider,
  emailConfigFromEnv,
  EmailDeliveryError,
  FakeEmailProvider,
  formatAddress,
  liveEmailSendingEnabled,
  mailOutboxCanRetry,
  LogEmailProvider,
  parseSafeEmailAddress,
  platformFromAddress,
  redactActionUrls,
  redactEmailError,
  sanitizeEmailSendInput,
  sanitizeMailHeaderValue,
} from "./email-provider.js";

describe("email provider abstraction", () => {
  it("defaults to disabled live sending until SMTP is configured", () => {
    const config = emailConfigFromEnv({
      EMAIL_PROVIDER: "none",
      EMAIL_DELIVERY_MODE: "log",
    });
    expect(liveEmailSendingEnabled(config)).toBe(false);
    const provider = createEmailDeliveryProvider(config);
    expect(provider.key).toBe("log");
  });

  it("fails closed when email env is absent or live SMTP is incomplete", () => {
    const missing = emailConfigFromEnv({});
    expect(missing.providerKey).toBe("none");
    expect(missing.deliveryMode).toBe("log");
    expect(liveEmailSendingEnabled(missing)).toBe(false);
    expect(createEmailDeliveryProvider(missing).key).toBe("log");

    const liveWithoutHost = emailConfigFromEnv({
      EMAIL_PROVIDER: "smtp",
      EMAIL_DELIVERY_MODE: "live",
      EMAIL_FROM_ADDRESS: "notifications@luvlearn.example",
    });
    expect(liveEmailSendingEnabled(liveWithoutHost)).toBe(false);
    expect(createEmailDeliveryProvider(liveWithoutHost).key).toBe("log");
  });

  it("uses the fake provider in test delivery mode", () => {
    const config = emailConfigFromEnv({ EMAIL_DELIVERY_MODE: "test", EMAIL_PROVIDER: "smtp" });
    const provider = createEmailDeliveryProvider(config);
    expect(provider).toBeInstanceOf(FakeEmailProvider);
  });

  it("does not enable live SMTP without a from address and host", () => {
    const config = emailConfigFromEnv({
      EMAIL_PROVIDER: "smtp",
      EMAIL_DELIVERY_MODE: "live",
      SMTP_HOST: "smtp.example.test",
    });
    expect(liveEmailSendingEnabled(config)).toBe(false);
  });

  it("enables live SMTP when host and from address are set", () => {
    const config = emailConfigFromEnv({
      EMAIL_PROVIDER: "smtp",
      EMAIL_DELIVERY_MODE: "live",
      EMAIL_FROM_ADDRESS: "notifications@luvlearn.example",
      SMTP_HOST: "smtp.example.test",
      SMTP_USERNAME: "user",
      SMTP_PASSWORD: "secret",
    });
    expect(liveEmailSendingEnabled(config)).toBe(true);
    const provider = createEmailDeliveryProvider(config);
    expect(provider.key).toBe("smtp");
  });

  it("records fake sends and classifies forced failures", async () => {
    const fake = new FakeEmailProvider();
    await fake.send({
      to: { address: "a@example.com" },
      from: { address: "n@example.com", name: "Kingswood School via LuvLearn" },
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });
    expect(fake.sent).toHaveLength(1);
    fake.failNext = new EmailDeliveryError("retryable", "provider_timeout", "timeout");
    await expect(
      fake.send({
        to: { address: "a@example.com" },
        from: { address: "n@example.com" },
        subject: "Hello",
        html: "<p>Hi</p>",
        text: "Hi",
      }),
    ).rejects.toMatchObject({ retryable: true, code: "provider_timeout" });
  });

  it("classifies invalid recipients as permanent and timeouts as retryable", () => {
    expect(classifyProviderError({ message: "User unknown", responseCode: 550 }).kind).toBe("permanent");
    expect(classifyProviderError({ message: "ETIMEDOUT", code: "ETIMEDOUT" }).kind).toBe("retryable");
    expect(classifyProviderError({ message: "rate limited", responseCode: 429 }).kind).toBe("retryable");
  });

  it("redacts tokens and addresses from errors and log bodies", () => {
    expect(redactActionUrls("https://x.test/invite?token=secret123")).toContain("token=redacted");
    expect(redactEmailError("fail for parent@school.test token=abc")).not.toContain("parent@school.test");
    expect(redactEmailError("fail for parent@school.test token=abc")).not.toContain("abc");
    expect(redactEmailError("smtp fail https://school.test/invite?token=secret123")).not.toContain("secret123");
    expect(redactEmailError("smtp fail https://school.test/invite?token=secret123")).not.toContain("https://");
  });

  it("only marks invite/reset failures retryable while they are still queued", () => {
    expect(mailOutboxCanRetry("queued", "staff_invite")).toBe(true);
    expect(mailOutboxCanRetry("failed", "staff_invite")).toBe(false);
    expect(mailOutboxCanRetry("failed", "password_reset")).toBe(false);
    expect(mailOutboxCanRetry("failed", "admissions_application_received")).toBe(true);
    expect(mailOutboxCanRetry("cancelled", "admissions_application_received")).toBe(false);
  });

  it("uses a sanitizable From fallback when EMAIL_FROM_ADDRESS is unset", () => {
    const from = platformFromAddress(emailConfigFromEnv({}), "Kingswood School");
    expect(from.address).toBe("notifications@luvlearn.test");
    expect(parseSafeEmailAddress(from.address)).toBe(from.address);
    expect(() =>
      sanitizeEmailSendInput({
        to: { address: "parent@example.com" },
        from,
        subject: "Invite",
        html: "<p>Hi</p>",
        text: "Hi",
      }),
    ).not.toThrow();
  });

  it("does not send live SMTP from the log-mode fallback address", () => {
    const liveMissing = emailConfigFromEnv({
      EMAIL_PROVIDER: "smtp",
      EMAIL_DELIVERY_MODE: "live",
      SMTP_HOST: "smtp.example.test",
    });
    expect(liveEmailSendingEnabled(liveMissing)).toBe(false);
    expect(createEmailDeliveryProvider(liveMissing).key).toBe("log");
    expect(() => platformFromAddress(liveMissing)).toThrow(EmailDeliveryError);

    const liveInvalid = emailConfigFromEnv({
      EMAIL_PROVIDER: "smtp",
      EMAIL_DELIVERY_MODE: "live",
      EMAIL_FROM_ADDRESS: "not-an-email",
      SMTP_HOST: "smtp.example.test",
    });
    expect(parseSafeEmailAddress(liveInvalid.fromAddress)).toBeNull();
    expect(liveEmailSendingEnabled(liveInvalid)).toBe(false);
    expect(createEmailDeliveryProvider(liveInvalid).key).toBe("log");
    expect(() => platformFromAddress(liveInvalid)).toThrow(/EMAIL_FROM_ADDRESS/);

    const liveDisplay = emailConfigFromEnv({
      EMAIL_PROVIDER: "smtp",
      EMAIL_DELIVERY_MODE: "live",
      EMAIL_FROM_ADDRESS: "LuvLearn <notifications@luvlearn.example>",
      SMTP_HOST: "smtp.example.test",
    });
    expect(platformFromAddress(liveDisplay).address).toBe("notifications@luvlearn.example");
    expect(liveEmailSendingEnabled(liveDisplay)).toBe(true);
  });

  it("formats school-aware from names on the platform domain", () => {
    const from = platformFromAddress(
      emailConfigFromEnv({
        EMAIL_FROM_ADDRESS: "notifications@luvlearn.example",
        EMAIL_FROM_NAME: "LuvLearn",
      }),
      "Kingswood School",
    );
    expect(from.address).toBe("notifications@luvlearn.example");
    expect(from.name).toBe("Kingswood School via LuvLearn");
    expect(formatAddress(from)).toContain("Kingswood School via LuvLearn");
  });

  it("strips CR/LF from tenant names, subjects, and invalid reply-to values", () => {
    const injected = "Kingswood\r\nBcc: stolen@evil.test";
    expect(sanitizeMailHeaderValue(injected)).not.toMatch(/\r|\n/);
    expect(formatAddress({ address: "n@example.com", name: injected })).not.toMatch(/\r|\n/);
    expect(parseSafeEmailAddress("office@school.test\r\nBcc: stolen@evil.test")).toBeNull();
    expect(parseSafeEmailAddress("not-an-email")).toBeNull();
    expect(parseSafeEmailAddress("office@school.test")).toBe("office@school.test");
    const safe = sanitizeEmailSendInput({
      to: { address: "parent@example.com", name: "Pat\r\nCc: other@x.test" },
      from: { address: "notifications@luvlearn.example", name: injected },
      replyTo: "office@school.test\nBcc: stolen@evil.test",
      subject: "Hello\r\nBcc: stolen@evil.test",
      html: "<p>Hi</p>",
      text: "Hi",
      headers: {
        Bcc: "stolen@evil.test",
        "X-LuvLearn-Purpose": "staff_invite",
      },
    });
    expect(safe.subject).not.toMatch(/\r|\n/);
    expect(safe.from.name).not.toMatch(/\r|\n/);
    expect(safe.replyTo).toBeNull();
    expect(safe.headers).not.toHaveProperty("Bcc");
    expect(safe.headers?.["X-LuvLearn-Purpose"]).toBe("staff_invite");
    expect(() =>
      sanitizeEmailSendInput({
        to: { address: "not-an-email" },
        from: { address: "notifications@luvlearn.example" },
        subject: "Hello",
        html: "<p>Hi</p>",
        text: "Hi",
      }),
    ).toThrow(/Invalid email address/);
  });

  it("log provider never throws for local development", async () => {
    const log = new LogEmailProvider();
    const result = await log.send({
      to: { address: "a@example.com" },
      from: { address: "n@example.com" },
      subject: "Test",
      html: "<p>https://x.test/reset-password?token=live</p>",
      text: "https://x.test/reset-password?token=live",
    });
    expect(result.messageId).toMatch(/^log_/);
    expect(log.sent[0]?.text).toContain("token=redacted");
  });
});
