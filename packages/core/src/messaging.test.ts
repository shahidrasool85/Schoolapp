import { describe, expect, it } from "vitest";
import {
  conversationAllowsReplies,
  displayMessageBody,
  messagePreview,
  messagingNotificationBody,
  relatedDomainLabel,
  sanitizeMessageBody,
} from "./messaging.js";

describe("messaging copy and sanitisation", () => {
  it("strips HTML and control characters from bodies", () => {
    expect(sanitizeMessageBody("<script>alert(1)</script>Hello")).toBe("alert(1)Hello");
    expect(sanitizeMessageBody("Line 1\nLine 2")).toBe("Line 1\nLine 2");
    expect(sanitizeMessageBody("a".repeat(9000)).length).toBe(8000);
  });

  it("builds a short preview and redacted placeholder", () => {
    expect(messagePreview("Please bring the reading book tomorrow.")).toBe(
      "Please bring the reading book tomorrow.",
    );
    expect(messagePreview("x".repeat(200)).endsWith("…")).toBe(true);
    expect(messagePreview("secret", true)).toBe("Message removed by authorised staff");
    expect(displayMessageBody({ body: "secret", redactedAt: new Date() })).toBe(
      "Message removed by authorised staff",
    );
  });

  it("keeps notification bodies free of message text", () => {
    expect(messagingNotificationBody("Greenwood Academy")).toBe(
      "You have a new message from Greenwood Academy.",
    );
    expect(messagingNotificationBody("<b>Oak</b>")).toBe("You have a new message from Oak.");
  });

  it("blocks replies on closed or restricted threads", () => {
    expect(conversationAllowsReplies({ status: "open", repliesRestricted: false })).toBe(true);
    expect(conversationAllowsReplies({ status: "closed", repliesRestricted: false })).toBe(false);
    expect(conversationAllowsReplies({ status: "open", repliesRestricted: true })).toBe(false);
  });

  it("maps related domains to parent-safe labels without record details", () => {
    expect(relatedDomainLabel("school_charge")).toBe("Payment");
    expect(relatedDomainLabel("safeguarding")).toBeNull();
  });
});
