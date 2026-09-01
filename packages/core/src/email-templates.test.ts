import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  fixturePreviewData,
  renderEmailTemplate,
} from "./email-templates.js";

const branding = { schoolName: "Kingswood School", logoUrl: "https://kingswood.example.test/logo.png" };

describe("transactional email templates", () => {
  it("escapes tenant-supplied text and never interpolates raw HTML", () => {
    const rendered = renderEmailTemplate(
      "admissions_application_received",
      {
        recipientName: '<img src=x onerror=alert(1)>',
        childName: "<script>alert(1)</script>Maya",
        applicationReference: "APP-9",
        intendedEntry: "Year 3 — 2026/27",
      },
      branding,
    );
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<img src=x");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.text).toContain("Maya");
    expect(rendered.subject).toContain("Kingswood School");
  });

  it("renders invitation html and plain text with a one-time link", () => {
    const rendered = renderEmailTemplate(
      "account_invitation",
      {
        recipientName: "Alex",
        purposeLabel: "join Kingswood School as a staff member",
        actionUrl: "https://kingswood.example.test/invite?token=once",
        expiresLabel: "14 days",
      },
      branding,
    );
    expect(rendered.html).toContain("Activate account");
    expect(rendered.html).toContain("https://kingswood.example.test/invite?token=once");
    expect(rendered.text).toContain("https://kingswood.example.test/invite?token=once");
    expect(rendered.text).toContain("14 days");
    expect(rendered.html).toContain("Powered by LuvLearn");
  });

  it("renders password reset with ignore wording and no account enumeration copy", () => {
    const rendered = renderEmailTemplate(
      "password_reset",
      fixturePreviewData("password_reset"),
      branding,
    );
    expect(rendered.subject).toBe("Password reset requested");
    expect(rendered.text.toLowerCase()).toContain("if you didn't request this");
    expect(rendered.html).toContain("Reset password");
  });

  it("keeps admissions acknowledgement free of medical and identity details", () => {
    const rendered = renderEmailTemplate(
      "admissions_application_received",
      fixturePreviewData("admissions_application_received"),
      branding,
    );
    expect(rendered.subject).toContain("Application received");
    expect(rendered.text).toContain("APP-1001");
    expect(rendered.text.toLowerCase()).not.toContain("allerg");
    expect(rendered.text.toLowerCase()).not.toContain("date of birth");
    expect(rendered.text.toLowerCase()).not.toContain("postcode");
    expect(rendered.html).toContain("Year 3");
  });

  it("renders the status-update foundation template", () => {
    const rendered = renderEmailTemplate(
      "admissions_status_update",
      fixturePreviewData("admissions_status_update"),
      branding,
    );
    expect(rendered.text).toContain("Under review");
    expect(escapeHtml("<b>x</b>")).toBe("&lt;b&gt;x&lt;/b&gt;");
  });
});
