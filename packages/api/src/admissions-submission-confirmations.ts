import {
  isSubmissionConfirmationKey,
  submissionConfirmationKeyForFormType,
  type SubmissionConfirmationKey,
} from "@schoolapp/domain";
import {
  renderSubmissionConfirmation,
  systemDefaultConfirmation,
  authoritativeReference,
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
  const referenceKey = key ?? "admissions_enquiry_submission_confirmation";
  const liveReference = authoritativeReference(referenceKey, data, { allowSampleFallback: false });
  if (!key) {
    return systemDefaultConfirmation(referenceKey, input.organisationName, data, liveReference);
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
      allowSampleFallback: false,
    });
  } catch {
    return systemDefaultConfirmation(key, input.organisationName, data, liveReference);
  }
}

export type PublicSubmissionConfirmationRecord = {
  formType: string;
  slug: string;
  enquiryReference: string | null;
  applicationReference: string | null;
  childFirstName: string | null;
  formSuccessTitle: string | null;
  formSuccessText: string | null;
  submittedAt: string | null;
  organisation: { name: string; slug?: string };
  branding: {
    primaryColor?: string | null;
    tagline?: string | null;
    hasLogo?: boolean;
    logoUrl?: string | null;
  };
};

export async function loadPublicSubmissionConfirmationRecord(
  pool: Queryable,
  organisationId: string,
  formType: string,
  slug: string,
  publicId: string,
): Promise<PublicSubmissionConfirmationRecord | null> {
  try {
    const result = await pool.query<{ get_public_admissions_submission_confirmation: Record<string, unknown> }>(
      "select get_public_admissions_submission_confirmation($1, $2, $3, $4)",
      [organisationId, formType, slug, publicId],
    );
    const payload = result.rows[0]?.get_public_admissions_submission_confirmation;
    if (!payload || typeof payload !== "object") return null;
    const organisation = (payload.organisation ?? {}) as Record<string, unknown>;
    const branding = (payload.branding ?? {}) as Record<string, unknown>;
    return {
      formType: String(payload.formType ?? formType),
      slug: String(payload.slug ?? slug),
      enquiryReference: payload.enquiryReference ? String(payload.enquiryReference) : null,
      applicationReference: payload.applicationReference ? String(payload.applicationReference) : null,
      childFirstName: payload.childFirstName ? String(payload.childFirstName) : null,
      formSuccessTitle: payload.formSuccessTitle ? String(payload.formSuccessTitle) : null,
      formSuccessText: payload.formSuccessText ? String(payload.formSuccessText) : null,
      submittedAt: payload.submittedAt ? String(payload.submittedAt) : null,
      organisation: { name: String(organisation.name ?? ""), slug: organisation.slug ? String(organisation.slug) : undefined },
      branding: {
        primaryColor: branding.primaryColor ? String(branding.primaryColor) : null,
        tagline: branding.tagline ? String(branding.tagline) : null,
        hasLogo: Boolean(branding.hasLogo),
        logoUrl: branding.logoUrl ? String(branding.logoUrl) : null,
      },
    };
  } catch {
    return null;
  }
}
