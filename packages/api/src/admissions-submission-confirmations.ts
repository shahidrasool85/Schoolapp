import {
  isSubmissionConfirmationKey,
  submissionConfirmationKeyForFormType,
  type SubmissionConfirmationKey,
} from "@schoolapp/domain";
import {
  renderSubmissionConfirmation,
  systemDefaultConfirmation,
  type OrganisationSubmissionConfirmation,
  type RenderedSubmissionConfirmation,
} from "@schoolapp/core";

type Queryable = {
  query: <T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

type ConfirmationRow = {
  template_key: string;
  heading: string;
  message_text: string;
  additional_message: string | null;
  button_label: string | null;
  button_url: string | null;
  updated_at?: string;
};

export async function loadOrganisationSubmissionConfirmation(
  pool: Queryable,
  organisationId: string | null | undefined,
  templateKey: string,
): Promise<OrganisationSubmissionConfirmation | null> {
  if (!organisationId || !isSubmissionConfirmationKey(templateKey)) return null;
  try {
    const result = await pool.query<ConfirmationRow>(
      "select * from get_organisation_admissions_submission_confirmation($1, $2)",
      [organisationId, templateKey],
    );
    const row = result.rows[0];
    if (!row) return null;
    return mapConfirmationRow(row);
  } catch {
    return null;
  }
}

export function mapConfirmationRow(row: ConfirmationRow): OrganisationSubmissionConfirmation | null {
  if (!isSubmissionConfirmationKey(row.template_key)) return null;
  return {
    templateKey: row.template_key as SubmissionConfirmationKey,
    heading: String(row.heading ?? ""),
    message: String(row.message_text ?? ""),
    additionalMessage: row.additional_message ? String(row.additional_message) : null,
    buttonLabel: row.button_label ? String(row.button_label) : null,
    buttonUrl: row.button_url ? String(row.button_url) : null,
  };
}

export async function presentPublicSubmissionConfirmation(input: {
  pool: Queryable;
  organisationId: string;
  organisationName: string;
  formType: string;
  result: Record<string, unknown>;
  childName?: string | null;
  formSuccessTitle?: string | null;
  formSuccessText?: string | null;
}): Promise<RenderedSubmissionConfirmation> {
  const key = submissionConfirmationKeyForFormType(input.formType);
  const data = {
    schoolName: input.organisationName,
    enquiryReference: input.result.enquiryReference ? String(input.result.enquiryReference) : null,
    applicationReference: input.result.applicationReference
      ? String(input.result.applicationReference)
      : null,
    childName: input.childName ?? null,
  };
  if (!key) {
    return systemDefaultConfirmation(
      "admissions_enquiry_submission_confirmation",
      input.organisationName,
      data,
    );
  }
  try {
    const stored = await input.pool.query<ConfirmationRow>(
      "select * from get_organisation_admissions_submission_confirmation($1, $2)",
      [input.organisationId, key],
    );
    const override = stored.rows[0] ? mapConfirmationRow(stored.rows[0]) : null;
    return renderSubmissionConfirmation({
      templateKey: key,
      override,
      schoolName: input.organisationName,
      data,
      formSuccessTitle: input.formSuccessTitle,
      formSuccessText: input.formSuccessText,
    });
  } catch {
    return systemDefaultConfirmation(key, input.organisationName, data);
  }
}
