import { describe, expect, it } from "vitest";
import {
  classifyProviderError,
  createEmailDeliveryProvider,
  emailConfigFromEnv,
  EmailDeliveryError,
  FakeEmailProvider,
  formatAddress,
  liveEmailSendingEnabled,
  LogEmailProvider,
  platformFromAddress,
  redactActionUrls,
  redactEmailError,
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
