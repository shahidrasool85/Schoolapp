export const ADMISSIONS_SETTINGS_PATH = "/school/settings/admissions";

export const SUBMISSION_CONFIRMATION_KEYS = [
  "admissions_enquiry_submission_confirmation",
  "admissions_application_submission_confirmation",
] as const;

export type SubmissionConfirmationKey = (typeof SUBMISSION_CONFIRMATION_KEYS)[number];

export function isSubmissionConfirmationKey(
  value: string | null | undefined,
): value is SubmissionConfirmationKey {
  return (SUBMISSION_CONFIRMATION_KEYS as readonly string[]).includes(value ?? "");
}

export function submissionConfirmationEditorHref(templateKey: SubmissionConfirmationKey): string {
  return `${ADMISSIONS_SETTINGS_PATH}?template=${templateKey}`;
}

export function submissionConfirmationKind(
  templateKey: SubmissionConfirmationKey,
): "enquiry" | "application" {
  return templateKey === "admissions_enquiry_submission_confirmation" ? "enquiry" : "application";
}

export function submissionConfirmationKeyForFormType(
  formType: string,
): SubmissionConfirmationKey | null {
  if (formType === "enquiry") return "admissions_enquiry_submission_confirmation";
  if (formType === "application") return "admissions_application_submission_confirmation";
  return null;
}
