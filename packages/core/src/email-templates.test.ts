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
    expect(rendered.html).not.toContain("onerror=");
    expect(rendered.html).toContain("alert(1)Maya");
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

  it("does not honour javascript or header-breaking action URLs or school names", () => {
    const rendered = renderEmailTemplate(
      "account_invitation",
      {
        recipientName: "Alex",
        purposeLabel: "join the school",
        actionUrl: "javascript:alert(1)",
        expiresLabel: "14 days",
      },
      { schoolName: "Kingswood\r\nBcc: stolen@evil.test" },
    );
    expect(rendered.html).not.toContain("javascript:");
    expect(rendered.html).toContain('href="#"');
    expect(rendered.subject).not.toMatch(/\r|\n/);
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

  it("renders enquiry acknowledgement with school branding and no sensitive notes", () => {
    const rendered = renderEmailTemplate(
      "admissions_enquiry_received",
      {
        ...fixturePreviewData("admissions_enquiry_received"),
        recipientName: '<img src=x onerror=alert(1)>Jordan',
      },
      branding,
    );
    expect(rendered.subject).toBe("Thank you for your enquiry – Kingswood School");
    expect(rendered.text).toContain("Dear Jordan,");
    expect(rendered.text).toContain("Thank you for contacting Kingswood School.");
    expect(rendered.text).toContain("We have received your enquiry and a member of our team will get back to you shortly.");
    expect(rendered.text).toContain("Kind regards,");
    expect(rendered.html).not.toContain("<img src=x");
    expect(rendered.html).not.toContain("onerror=");
    expect(rendered.text.toLowerCase()).not.toContain("allerg");
    expect(rendered.text.toLowerCase()).not.toContain("date of birth");
    expect(rendered.text.toLowerCase()).not.toContain("please send dates");
    expect(rendered.text.toLowerCase()).not.toContain("medical");
    expect(rendered.text.toLowerCase()).not.toContain("safeguard");
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

  it("renders finance notices with a portal link and without sensitive pupil details", () => {
    const invoice = renderEmailTemplate(
      "finance_invoice_issued",
      {
        recipientName: "Pat Parent",
        actionUrl: "https://kingswood.example.test/parent/finance",
      },
      branding,
    );
    expect(invoice.subject).toContain("invoice is available");
    expect(invoice.text).toContain("An invoice is available in your Kingswood School portal");
    expect(invoice.text.toLowerCase()).not.toContain("date of birth");
    expect(invoice.text.toLowerCase()).not.toContain("card");
    expect(invoice.html).toContain("/parent/finance");
    const receipt = renderEmailTemplate("finance_payment_received", fixturePreviewData("finance_payment_received"), branding);
    expect(receipt.text.toLowerCase()).toContain("receipt is available");
  });
});
