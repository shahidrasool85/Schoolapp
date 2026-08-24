import { describe, expect, it } from "vitest";
import {
  buildEmbedCode,
  buildPublicFormUrl,
  computeCompleteness,
  createContinuationToken,
  defaultFormTemplate,
  formTypeFromPublicKind,
  hashContinuationToken,
  publicFormPath,
  mapAnswersToCanonical,
  normalizeCustomFieldKey,
  normalizeFormSlug,
  publicFormIsAccepting,
  isSafeHttpUrl,
  safePrivacyNoticeUrl,
  sanitizePlainText,
  validatePublicAnswers,
} from "./admissions-forms.js";
import { MemoryRateLimiter, assertPublicFormPayloadSize, trustedClientIp } from "./public-forms-security.js";
import { AppError } from "./errors.js";

describe("admissions forms", () => {
  it("sanitizes helper text and rejects executable markup", () => {
    expect(sanitizePlainText("<script>alert(1)</script>Hello")).toBe("alert(1)Hello");
    expect(sanitizePlainText("javascript:alert(1)")).toBe("alert(1)");
  });

  it("validates required and custom questions", () => {
    const fields = defaultFormTemplate("enquiry").flatMap((section) => section.fields);
    expect(() =>
      validatePublicAnswers(fields, {
        "child.legal_name": "Maya Cole",
        "child.date_of_birth": "2018-01-01",
        "child.intended_academic_year_id": "not-a-uuid",
      }),
    ).toThrow(/required|invalid/i);

    const year = "11111111-1111-1111-1111-111111111111";
    const group = "22222222-2222-2222-2222-222222222222";
    const answers = validatePublicAnswers(fields, {
      "child.legal_name": "Maya Cole",
      "child.preferred_name": "Maya",
      "child.date_of_birth": "2018-01-01",
      "child.intended_academic_year_id": year,
      "child.intended_year_group_id": group,
      "guardian.full_name": "Priya Cole",
      "guardian.relationship": "mother",
      "guardian.email": "priya@example.com",
      "guardian.phone": "01234 567890",
      "enquiry.notes": "Please send dates",
    });
    const canonical = mapAnswersToCanonical(fields, answers);
    expect(canonical.child?.legalName).toBe("Maya Cole");
    expect(canonical.guardians?.[0]?.email).toBe("priya@example.com");
    expect(computeCompleteness({ draft: false, fields, answers })).toBe("complete");
  });

  it("accepts a browser-shaped application payload with an unused second guardian row", () => {
    const fields = defaultFormTemplate("application").flatMap((section) => section.fields);
    const year = "11111111-1111-1111-1111-111111111111";
    const group = "22222222-2222-2222-2222-222222222222";
    const answers = validatePublicAnswers(fields, {
      "child.legal_name": "Noah Patel",
      "child.preferred_name": "",
      "child.date_of_birth": "2017-05-05",
      "child.gender": "",
      "child.address": { line1: "", line2: "", town: "", postcode: "" },
      "child.intended_academic_year_id": year,
      "child.intended_year_group_id": group,
      "child.proposed_start_date": "",
      "child.current_school": "",
      "child.previous_school": "",
      guardians: [
        {
          fullName: "Anita Patel",
          email: "anita@example.com",
          phone: "",
          relationship: "mother",
          parentalResponsibility: true,
          primaryContact: true,
        },
        {
          fullName: "",
          email: "",
          phone: "",
          relationship: "",
          parentalResponsibility: false,
          primaryContact: false,
        },
      ],
      "previous_education.school_name": "",
      "previous_education.start_date": "",
      "previous_education.end_date": "",
      "previous_education.report_details": "",
      "medical.allergies": "",
      "medical.conditions": "",
      "medical.medication": "",
      "medical.dietary": "",
      "medical.send_notes": "",
      "emergency.full_name": "",
      "emergency.relationship": "",
      "emergency.telephone": "",
      "emergency.authorised_collection": false,
      "application.notes": "",
      declaration_privacy: true,
    });
    expect(answers.guardians).toHaveLength(1);
    try {
      validatePublicAnswers(fields, {
        "child.legal_name": "Noah Patel",
        "child.date_of_birth": "not-a-date",
        "child.intended_academic_year_id": year,
        "child.intended_year_group_id": group,
        guardians: [{ fullName: "Anita Patel", email: "anita@example.com" }],
        declaration_privacy: true,
      });
      throw new Error("expected validation failure");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).message).toMatch(/date/i);
      expect((err as AppError).details?.fieldKey).toBe("child.date_of_birth");
      expect((err as AppError).details?.sectionKey).toBe("child");
    }
  });

  it("maps multiple guardians and keeps completeness separate from draft", () => {
    const fields = defaultFormTemplate("application").flatMap((section) => section.fields);
    const year = "11111111-1111-1111-1111-111111111111";
    const group = "22222222-2222-2222-2222-222222222222";
    const answers = validatePublicAnswers(fields, {
      "child.legal_name": "Noah Patel",
      "child.date_of_birth": "2017-05-05",
      "child.intended_academic_year_id": year,
      "child.intended_year_group_id": group,
      guardians: [
        { fullName: "Anita Patel", email: "anita@example.com", primaryContact: true, parentalResponsibility: true },
        { fullName: "Ravi Patel", email: "ravi@example.com", relationship: "father" },
      ],
      declaration_privacy: true,
    });
    const canonical = mapAnswersToCanonical(fields, answers);
    expect(canonical.guardians).toHaveLength(2);
    expect(computeCompleteness({ draft: true, fields, answers })).toBe("draft");
  });

  it("treats required file answers as incomplete until a bound documentId is present", () => {
    const fields = [
      {
        fieldKey: "supporting_evidence",
        fieldKind: "custom" as const,
        canonicalKey: null,
        questionType: "file" as const,
        label: "Evidence",
        helperText: null,
        required: true,
        enabled: true,
        sortOrder: 1,
        sectionKey: "evidence",
        options: [],
        documentPurpose: null,
      },
    ];
    expect(
      computeCompleteness({
        draft: false,
        fields,
        answers: { supporting_evidence: { filename: "report.pdf", contentType: "application/pdf", byteSize: 12 } },
      }),
    ).toBe("missing_documents");
    expect(
      computeCompleteness({
        draft: false,
        fields,
        answers: {
          supporting_evidence: {
            documentId: "11111111-1111-4111-8111-111111111111",
            filename: "report.pdf",
          },
        },
      }),
    ).toBe("complete");
    expect(() =>
      validatePublicAnswers(fields, {
        supporting_evidence: { filename: "report.pdf", contentType: "application/pdf", byteSize: 12 },
      }),
    ).toThrow(/uploaded/i);
  });

  it("builds public URLs, embed code, and hashed continuation tokens", () => {
    const url = buildPublicFormUrl({
      slug: "year-3-enquiry",
      formType: "enquiry",
      schoolSlug: "greenwood",
      platformDomain: "localhost",
      campaignCode: "facebook",
    });
    expect(url).toContain("greenwood.localhost/admissions/enquiry/year-3-enquiry");
    expect(publicFormPath("open_day", "summer")).toBe("/admissions/open_day/summer");
    expect(formTypeFromPublicKind("apply")).toBe("application");
    expect(formTypeFromPublicKind("open_day")).toBe("open_day");
    expect(url).toContain("source=facebook");
    expect(buildEmbedCode(url, 'Greenwood "Enquiry"')).toContain("<iframe");
    expect(buildEmbedCode(url, 'Greenwood "Enquiry"')).not.toContain('Greenwood "Enquiry"');
    const token = createContinuationToken();
    expect(hashContinuationToken(token.token)).toBe(token.hash);
    expect(normalizeFormSlug("Year 3 Enquiry")).toBe("year-3-enquiry");
  });

  it("normalizes dotted custom keys used by the application template", () => {
    expect(normalizeCustomFieldKey("declaration.privacy")).toBe("declaration_privacy");
    expect(
      defaultFormTemplate("application")
        .flatMap((section) => section.fields)
        .some((field) => field.fieldKey === "declaration_privacy"),
    ).toBe(true);
  });

  it("fails closed for unpublished or expired forms", () => {
    expect(publicFormIsAccepting({ status: "draft", opensAt: null, closesAt: null })).toBe(false);
    expect(
      publicFormIsAccepting({
        status: "published",
        opensAt: null,
        closesAt: "2020-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(publicFormIsAccepting({ status: "published", opensAt: null, closesAt: null })).toBe(true);
  });

  it("rejects unsafe privacy notice URLs and ignores untrusted forwarding headers", () => {
    expect(isSafeHttpUrl("https://greenwood.example/privacy")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("file:///etc/passwd")).toBe(false);
    expect(() => safePrivacyNoticeUrl("javascript:alert(1)")).toThrow(/http or https/i);
    expect(trustedClientIp({ trustProxy: false, forwardedFor: "1.2.3.4" })).toBeNull();
    expect(trustedClientIp({ trustProxy: true, forwardedFor: "1.2.3.4, 10.0.0.1" })).toBe("1.2.3.4");
  });

  it("rate limits and rejects oversized payloads", () => {
    const limiter = new MemoryRateLimiter();
    expect(limiter.consume("k", 1, 60_000).allowed).toBe(true);
    expect(limiter.consume("k", 1, 60_000).allowed).toBe(false);
    expect(() => assertPublicFormPayloadSize({ contentLength: "999999" })).toThrow(AppError);
  });
});
