import { describe, expect, it } from "vitest";
import {
  ADMISSIONS_SETTINGS_PATH,
  SUBMISSION_CONFIRMATION_KEYS,
  isSubmissionConfirmationKey,
  submissionConfirmationEditorHref,
  submissionConfirmationKeyForFormType,
  submissionConfirmationKind,
} from "@schoolapp/domain";

describe("admissions submission confirmation settings", () => {
  it("keeps website confirmation keys separate from automatic emails", () => {
    expect(ADMISSIONS_SETTINGS_PATH).toBe("/school/settings/admissions");
    expect([...SUBMISSION_CONFIRMATION_KEYS]).toEqual([
      "admissions_enquiry_submission_confirmation",
      "admissions_application_submission_confirmation",
    ]);
    expect(isSubmissionConfirmationKey("admissions_enquiry_received")).toBe(false);
    expect(isSubmissionConfirmationKey("admissions_enquiry_submission_confirmation")).toBe(true);
    expect(submissionConfirmationKind("admissions_enquiry_submission_confirmation")).toBe("enquiry");
    expect(submissionConfirmationKind("admissions_application_submission_confirmation")).toBe(
      "application",
    );
    expect(submissionConfirmationKeyForFormType("enquiry")).toBe(
      "admissions_enquiry_submission_confirmation",
    );
    expect(submissionConfirmationKeyForFormType("application")).toBe(
      "admissions_application_submission_confirmation",
    );
    expect(submissionConfirmationKeyForFormType("open_day")).toBeNull();
    expect(
      submissionConfirmationEditorHref("admissions_enquiry_submission_confirmation"),
    ).toBe("/school/settings/admissions?template=admissions_enquiry_submission_confirmation");
  });
});
