import { describe, expect, it } from "vitest";
import {
  EmailTemplateValidationError,
  firstNameFromDisplayName,
  renderCustomEmailTemplate,
  renderEmailTemplate,
  renderTransactionalEmail,
  validateOrganisationEmailTemplate,
} from "./index.js";

const branding = { schoolName: "Kingswood School", logoUrl: "https://kingswood.example.test/logo.png" };

const enquiryOverride = {
  templateKey: "admissions_enquiry_received" as const,
  enabled: true,
  subject: "Thanks {{school_name}}",
  heading: "We have your enquiry",
  greeting: "Dear {{recipient_first_name}},",
  body: "Reference {{enquiry_reference}}.\nWrite to {{school_contact_email}}.",
  signoff: "Kind regards,\n{{school_name}}",
};

describe("organisation email template overrides", () => {
  it("renders the built-in enquiry template when no override exists", () => {
    const rendered = renderTransactionalEmail(
      "admissions_enquiry_received",
      { recipientName: "Jordan Rivera" },
      branding,
      null,
    );
    expect(rendered.subject).toBe("Thank you for your enquiry – Kingswood School");
    expect(rendered.text).toContain("Dear Jordan Rivera,");
    expect(rendered.text).toContain("Thank you for contacting Kingswood School.");
    expect(rendered.html).toContain("Powered by LuvLearn");
  });

  it("renders the built-in application template when no override exists", () => {
    const rendered = renderTransactionalEmail(
      "admissions_application_received",
      {
        recipientName: "Sarah Example",
        childName: "Maya Example",
        applicationReference: "APP-1001",
        intendedEntry: "Year 3 — 2026/27",
      },
      branding,
      null,
    );
    expect(rendered.subject).toContain("Application received");
    expect(rendered.text).toContain("Maya Example");
    expect(rendered.text).toContain("APP-1001");
  });

  it("uses a custom enquiry override and keeps the branded shell", () => {
    const rendered = renderCustomEmailTemplate(
      enquiryOverride,
      {
        recipientName: "Jordan Rivera",
        enquiryReference: "ENQ-1001",
        schoolContactEmail: "admissions@kingswood.example.test",
      },
      branding,
    );
    expect(rendered.subject).toBe("Thanks Kingswood School");
    expect(rendered.text).toContain("Dear Jordan,");
    expect(rendered.text).toContain("Reference ENQ-1001.");
    expect(rendered.text).toContain("admissions@kingswood.example.test");
    expect(rendered.html).toContain("We have your enquiry");
    expect(rendered.html).toContain("Powered by LuvLearn");
    expect(rendered.html).toContain("Kingswood School");
  });

  it("keeps custom wording when the logo is omitted", () => {
    const rendered = renderCustomEmailTemplate(
      enquiryOverride,
      {
        recipientName: "Jordan Rivera",
        enquiryReference: "ENQ-1001",
        schoolContactEmail: "admissions@kingswood.example.test",
      },
      { schoolName: "Kingswood School" },
    );
    expect(rendered.subject).toBe("Thanks Kingswood School");
    expect(rendered.html).not.toContain("<img");
    expect(rendered.html).toContain("We have your enquiry");
    expect(rendered.html).toContain("Kingswood School");
    expect(rendered.html).toContain("Powered by LuvLearn");
  });

  it("falls back to the built-in template when the override is disabled or corrupt", () => {
    const disabled = renderTransactionalEmail(
      "admissions_enquiry_received",
      { recipientName: "Jordan Rivera" },
      branding,
      { ...enquiryOverride, enabled: false },
    );
    expect(disabled.subject).toBe("Thank you for your enquiry – Kingswood School");
    const corrupt = renderTransactionalEmail(
      "admissions_enquiry_received",
      { recipientName: "Jordan Rivera" },
      branding,
      { ...enquiryOverride, body: "Hello {{unknown_field}}" },
    );
    expect(corrupt.subject).toBe("Thank you for your enquiry – Kingswood School");
  });

  it("rejects unsupported and malformed placeholders", () => {
    expect(() =>
      validateOrganisationEmailTemplate({
        ...enquiryOverride,
        body: "Allergy {{medical_notes}}",
      }),
    ).toThrow(EmailTemplateValidationError);
    expect(() =>
      validateOrganisationEmailTemplate({
        ...enquiryOverride,
        body: "Hello {{school_name",
      }),
    ).toThrow(/malformed placeholder/i);
    expect(() =>
      validateOrganisationEmailTemplate({
        ...enquiryOverride,
        body: "Hello {{School Name}}",
      }),
    ).toThrow(/malformed placeholder/i);
  });

  it("rejects HTML and script injection", () => {
    expect(() =>
      validateOrganisationEmailTemplate({
        ...enquiryOverride,
        body: "Hello <script>alert(1)</script>",
      }),
    ).toThrow(/HTML or scripts/);
    expect(() =>
      validateOrganisationEmailTemplate({
        ...enquiryOverride,
        subject: "Hi <b>there</b>",
      }),
    ).toThrow(/HTML or scripts/);
  });

  it("escapes merge values that contain markup", () => {
    const rendered = renderCustomEmailTemplate(
      enquiryOverride,
      {
        recipientName: "<script>alert(1)</script>Jordan",
        enquiryReference: "ENQ-9",
        schoolContactEmail: "admissions@kingswood.example.test",
      },
      branding,
    );
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("Jordan");
  });

  it("requires subject and body", () => {
    expect(() => validateOrganisationEmailTemplate({ ...enquiryOverride, subject: "  " })).toThrow(/Subject is required/);
    expect(() => validateOrganisationEmailTemplate({ ...enquiryOverride, body: "" })).toThrow(/Body is required/);
  });

  it("does not treat invitation templates as customisable", () => {
    expect(() =>
      validateOrganisationEmailTemplate({
        templateKey: "account_invitation",
        subject: "Hello",
        heading: "Hello",
        greeting: "Hello",
        body: "Hello",
        signoff: "Bye",
      }),
    ).toThrow(/cannot be customised/);
    const invite = renderTransactionalEmail(
      "account_invitation",
      {
        recipientName: "Alex",
        purposeLabel: "join the school",
        actionUrl: "https://kingswood.example.test/invite?token=once",
        expiresLabel: "14 days",
      },
      branding,
      enquiryOverride,
    );
    expect(invite.html).toContain("Activate account");
  });

  it("takes the first name from a display name", () => {
    expect(firstNameFromDisplayName("Jordan Rivera")).toBe("Jordan");
    expect(firstNameFromDisplayName("")).toBe("");
  });

  it("renders application overrides with pupil first name", () => {
    const rendered = renderCustomEmailTemplate(
      {
        templateKey: "admissions_application_received",
        enabled: true,
        subject: "{{school_name}} application {{application_reference}}",
        heading: "Application received",
        greeting: "Hello {{recipient_first_name}},",
        body: "Thank you for applying for {{pupil_first_name}}.\nEntry: {{intended_entry}}",
        signoff: "Regards\n{{school_name}}",
      },
      {
        recipientName: "Sarah Example",
        childName: "Maya Example",
        applicationReference: "APP-1001",
        intendedEntry: "Year 3 — 2026/27",
      },
      branding,
    );
    expect(rendered.subject).toBe("Kingswood School application APP-1001");
    expect(rendered.text).toContain("Thank you for applying for Maya.");
    expect(rendered.text).toContain("Year 3 — 2026/27");
    expect(rendered.text).toContain("Hello Sarah,");
  });

  it("keeps built-in application rendering unchanged through the override layer", () => {
    const direct = renderEmailTemplate(
      "admissions_application_received",
      {
        recipientName: "Sarah Example",
        childName: "Maya Example",
        applicationReference: "APP-1001",
        intendedEntry: "Year 3 — 2026/27",
      },
      branding,
    );
    const viaLayer = renderTransactionalEmail(
      "admissions_application_received",
      {
        recipientName: "Sarah Example",
        childName: "Maya Example",
        applicationReference: "APP-1001",
        intendedEntry: "Year 3 — 2026/27",
      },
      branding,
    );
    expect(viaLayer).toEqual(direct);
  });
});
