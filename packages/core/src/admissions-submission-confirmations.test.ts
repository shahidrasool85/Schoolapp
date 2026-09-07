import { describe, expect, it } from "vitest";
import {
  SubmissionConfirmationValidationError,
  renderSubmissionConfirmation,
  sampleSubmissionConfirmationData,
  systemDefaultConfirmation,
  templateUsesReferencePlaceholder,
  validateOrganisationSubmissionConfirmation,
} from "./admissions-submission-confirmations.js";

describe("admissions submission confirmations", () => {
  it("renders the built-in enquiry default when no override exists", () => {
    const rendered = renderSubmissionConfirmation({
      templateKey: "admissions_enquiry_submission_confirmation",
      schoolName: "Kingswood School",
      data: { enquiryReference: "ENQ-2026-0004" },
    });
    expect(rendered.heading).toBe("Thank you");
    expect(rendered.message).toBe("We have received your submission.");
    expect(rendered.additionalMessage).toBeNull();
    expect(rendered.button).toBeNull();
    expect(rendered.source).toBe("system");
    expect(rendered.showSystemReference).toBe(true);
    expect(rendered.referenceLabel).toBe("Enquiry reference");
    expect(rendered.reference).toBe("ENQ-2026-0004");
  });

  it("renders the built-in application default when no override exists", () => {
    const rendered = renderSubmissionConfirmation({
      templateKey: "admissions_application_submission_confirmation",
      schoolName: "Kingswood School",
      data: { applicationReference: "APP-2026-0008", childName: "Maya Cole" },
    });
    expect(rendered.heading).toBe("Thank you");
    expect(rendered.message).toBe("We have received your application.");
    expect(rendered.referenceLabel).toBe("Application reference");
    expect(rendered.reference).toBe("APP-2026-0008");
    expect(rendered.showSystemReference).toBe(true);
  });

  it("renders a custom enquiry confirmation and keeps the real reference", () => {
    const rendered = renderSubmissionConfirmation({
      templateKey: "admissions_enquiry_submission_confirmation",
      schoolName: "Kingswood School",
      override: {
        templateKey: "admissions_enquiry_submission_confirmation",
        heading: "Thank you for your enquiry",
        message: "We have received your enquiry at {{school_name}}.",
        additionalMessage: "You can download our latest prospectus while you wait.",
        buttonLabel: "View school brochure",
        buttonUrl: "https://kingswoodschool.co.uk/school-brochure/",
      },
      data: { enquiryReference: "ENQ-2026-0004" },
    });
    expect(rendered.heading).toBe("Thank you for your enquiry");
    expect(rendered.message).toBe("We have received your enquiry at Kingswood School.");
    expect(rendered.additionalMessage).toBe("You can download our latest prospectus while you wait.");
    expect(rendered.button).toEqual({
      label: "View school brochure",
      url: "https://kingswoodschool.co.uk/school-brochure/",
    });
    expect(rendered.source).toBe("custom");
    expect(rendered.showSystemReference).toBe(true);
    expect(rendered.reference).toBe("ENQ-2026-0004");
  });

  it("renders application merge fields and omits the system reference when the placeholder is used", () => {
    const rendered = renderSubmissionConfirmation({
      templateKey: "admissions_application_submission_confirmation",
      schoolName: "Kingswood School",
      override: {
        templateKey: "admissions_application_submission_confirmation",
        heading: "Thank you for your application",
        message: "We have received {{pupil_first_name}}'s application {{application_reference}}.",
        additionalMessage: "We will contact you if we need any further information.",
        buttonLabel: null,
        buttonUrl: null,
      },
      data: { applicationReference: "APP-2026-0012", childName: "Maya Cole" },
    });
    expect(rendered.message).toBe("We have received Maya's application APP-2026-0012.");
    expect(rendered.showSystemReference).toBe(false);
    expect(rendered.reference).toBe("APP-2026-0012");
  });

  it("still exposes the real reference when the admin omits the placeholder", () => {
    const enquiry = validateOrganisationSubmissionConfirmation({
      templateKey: "admissions_enquiry_submission_confirmation",
      heading: "Thanks",
      message: "We will be in touch.",
    });
    expect(templateUsesReferencePlaceholder(enquiry)).toBe(false);
    const rendered = renderSubmissionConfirmation({
      templateKey: "admissions_enquiry_submission_confirmation",
      schoolName: "Kingswood School",
      override: enquiry,
      data: { enquiryReference: "ENQ-2026-0099" },
    });
    expect(rendered.showSystemReference).toBe(true);
    expect(rendered.reference).toBe("ENQ-2026-0099");
    expect(rendered.message).not.toContain("ENQ-2026-0099");
  });

  it("rejects unknown placeholders, HTML, and unsafe URLs", () => {
    expect(() =>
      validateOrganisationSubmissionConfirmation({
        templateKey: "admissions_enquiry_submission_confirmation",
        heading: "Thanks",
        message: "Allergy {{medical_notes}}",
      }),
    ).toThrow(SubmissionConfirmationValidationError);

    expect(() =>
      validateOrganisationSubmissionConfirmation({
        templateKey: "admissions_enquiry_submission_confirmation",
        heading: "Thanks",
        message: "Hi <script>alert(1)</script>",
      }),
    ).toThrow(/HTML or scripts/i);

    expect(() =>
      validateOrganisationSubmissionConfirmation({
        templateKey: "admissions_enquiry_submission_confirmation",
        heading: "Thanks",
        message: "Hello",
        buttonLabel: "Open",
        buttonUrl: "javascript:alert(1)",
      }),
    ).toThrow(/http or https/i);

    expect(() =>
      validateOrganisationSubmissionConfirmation({
        templateKey: "admissions_application_submission_confirmation",
        heading: "Thanks",
        message: "DOB {{date_of_birth}}",
      }),
    ).toThrow(/unsupported field/i);
  });

  it("accepts a valid https CTA and sample preview values", () => {
    const saved = validateOrganisationSubmissionConfirmation({
      templateKey: "admissions_enquiry_submission_confirmation",
      heading: "Thank you for your enquiry",
      message: "Hello {{school_name}}.",
      buttonLabel: "Visit school website",
      buttonUrl: "https://kingswoodschool.co.uk/",
    });
    const sample = sampleSubmissionConfirmationData(
      "admissions_enquiry_submission_confirmation",
      "Kingswood School",
    );
    const rendered = renderSubmissionConfirmation({
      templateKey: "admissions_enquiry_submission_confirmation",
      schoolName: "Kingswood School",
      override: saved,
      data: sample,
    });
    expect(rendered.button?.url).toBe("https://kingswoodschool.co.uk/");
    expect(rendered.reference).toBe("ENQ-2026-0001");
    expect(rendered.message).toBe("Hello Kingswood School.");
  });

  it("falls back to the system default when a stored override is corrupt", () => {
    const rendered = renderSubmissionConfirmation({
      templateKey: "admissions_enquiry_submission_confirmation",
      schoolName: "Kingswood School",
      override: {
        templateKey: "admissions_enquiry_submission_confirmation",
        heading: "Broken {{unknown_field}}",
        message: "Broken",
        additionalMessage: null,
        buttonLabel: null,
        buttonUrl: null,
      },
      data: { enquiryReference: "ENQ-2026-0004" },
    });
    expect(rendered.source).toBe("system");
    expect(rendered.heading).toBe("Thank you");
    expect(rendered.message).toBe("We have received your submission.");
    expect(rendered.reference).toBe("ENQ-2026-0004");
  });

  it("uses form success copy only when no organisation override exists", () => {
    const custom = renderSubmissionConfirmation({
      templateKey: "admissions_enquiry_submission_confirmation",
      schoolName: "Kingswood School",
      formSuccessTitle: "Form heading",
      formSuccessText: "Form message",
      override: {
        templateKey: "admissions_enquiry_submission_confirmation",
        heading: "Org heading",
        message: "Org message",
        additionalMessage: null,
        buttonLabel: null,
        buttonUrl: null,
      },
      data: { enquiryReference: "ENQ-2026-0004" },
    });
    expect(custom.heading).toBe("Org heading");
    const fallback = renderSubmissionConfirmation({
      templateKey: "admissions_enquiry_submission_confirmation",
      schoolName: "Kingswood School",
      formSuccessTitle: "Form heading",
      formSuccessText: "Form message",
      data: { enquiryReference: "ENQ-2026-0004" },
    });
    expect(fallback.heading).toBe("Form heading");
    expect(fallback.message).toBe("Form message");
    expect(fallback.source).toBe("system");
    expect(systemDefaultConfirmation("admissions_enquiry_submission_confirmation", "School", {
      enquiryReference: "ENQ-1",
    }).heading).toBe("Thank you");
  });
});
