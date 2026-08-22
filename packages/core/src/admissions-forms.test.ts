import { describe, expect, it } from "vitest";
import {
  buildEmbedCode,
  buildPublicFormUrl,
  computeCompleteness,
  createContinuationToken,
  defaultFormTemplate,
  hashContinuationToken,
  mapAnswersToCanonical,
  normalizeCustomFieldKey,
  normalizeFormSlug,
  publicFormIsAccepting,
  sanitizePlainText,
  validatePublicAnswers,
} from "./admissions-forms.js";
import { MemoryRateLimiter, assertPublicFormPayloadSize } from "./public-forms-security.js";
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

  it("builds public URLs, embed code, and hashed continuation tokens", () => {
    const url = buildPublicFormUrl({
      slug: "year-3-enquiry",
      formType: "enquiry",
      schoolSlug: "greenwood",
      platformDomain: "localhost",
      campaignCode: "facebook",
    });
    expect(url).toContain("greenwood.localhost/admissions/enquiry/year-3-enquiry");
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

  it("rate limits and rejects oversized payloads", () => {
    const limiter = new MemoryRateLimiter();
    expect(limiter.consume("k", 1, 60_000).allowed).toBe(true);
    expect(limiter.consume("k", 1, 60_000).allowed).toBe(false);
    expect(() => assertPublicFormPayloadSize({ contentLength: "999999" })).toThrow(AppError);
  });
});
