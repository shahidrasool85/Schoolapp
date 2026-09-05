import { describe, expect, it } from "vitest";
import { fittedImageSize } from "./finance-pdf.js";
import {
  financePayerDisplayName,
  freezeDocumentTemplate,
  presentTuitionLineDescription,
  resolveFinanceLogoObjectId,
  DEFAULT_FINANCE_DOCUMENT_TEMPLATE,
} from "./finance-document-template.js";

describe("finance document presentation", () => {
  it("strips a printed Family prefix without changing other names", () => {
    expect(financePayerDisplayName({ billToName: "Shahid Rasool", familyName: "Family — Shahid Rasool" })).toBe(
      "Shahid Rasool",
    );
    expect(financePayerDisplayName({ familyName: "Family — Shahid Rasool" })).toBe("Shahid Rasool");
    expect(financePayerDisplayName({ familyName: "Family – Amina Rasool" })).toBe("Amina Rasool");
    expect(financePayerDisplayName({ billToName: "Pat Parent" })).toBe("Pat Parent");
    expect(financePayerDisplayName({})).toBe("Account holder");
  });

  it("rewrites only auto-generated tuition descriptions", () => {
    expect(
      presentTuitionLineDescription({
        kind: "tuition",
        description: "Shahid Rasool tuition",
        pupilName: "Shahid Rasool",
        classOrYear: "Year 3",
      }),
    ).toBe("Tuition fees – Year 3");
    expect(
      presentTuitionLineDescription({
        kind: "tuition",
        description: "Shahid Rasool tuition",
        pupilName: "Shahid Rasool",
      }),
    ).toBe("Tuition fees");
    expect(
      presentTuitionLineDescription({
        kind: "tuition",
        description: "Music lesson package",
        pupilName: "Shahid Rasool",
        classOrYear: "Year 3",
      }),
    ).toBe("Music lesson package");
    expect(
      presentTuitionLineDescription({
        kind: "trip",
        description: "Shahid Rasool tuition",
        pupilName: "Shahid Rasool",
        classOrYear: "Year 3",
      }),
    ).toBe("Shahid Rasool tuition");
  });

  it("falls back through finance then school logos", () => {
    expect(resolveFinanceLogoObjectId({ logoMode: "none", financeLogoObjectId: "fin", schoolLogoObjectId: "sch" })).toBeNull();
    expect(resolveFinanceLogoObjectId({ logoMode: "finance", financeLogoObjectId: "fin", schoolLogoObjectId: "sch" })).toBe("fin");
    expect(resolveFinanceLogoObjectId({ logoMode: "finance", financeLogoObjectId: null, schoolLogoObjectId: "sch" })).toBe("sch");
    expect(resolveFinanceLogoObjectId({ logoMode: "school", financeLogoObjectId: "fin", schoolLogoObjectId: "sch" })).toBe("sch");
  });

  it("freezes missing template keys to the original defaults, not later live settings", () => {
    expect(freezeDocumentTemplate({ schoolName: "Legacy" })).toEqual(DEFAULT_FINANCE_DOCUMENT_TEMPLATE);
    expect(
      freezeDocumentTemplate({
        documentTemplate: { showAddress: false, logoMode: "none" },
      }).showAddress,
    ).toBe(false);
  });

  it("uses contain-style scaling and will enlarge a small crest to the box", () => {
    expect(fittedImageSize({ width: 32, height: 48 }, 168, 72)).toEqual({ width: 48, height: 72 });
    expect(fittedImageSize({ width: 400, height: 100 }, 168, 72)).toEqual({ width: 168, height: 42 });
  });
});
