import {
  admissionsApplicationReceivedMail,
  admissionsEnquiryReceivedMail,
  admissionsStatusEmailMail,
  type CanonicalSnapshot,
  type OrganisationEmailTemplateOverride,
} from "@schoolapp/core";
import {
  admissionsStatusEmailTemplateKeyForStatus,
  formatStatusLabel,
  formatUkNumericDate,
  type AdmissionsStatusEmailTemplateKey,
  type CustomizableEmailTemplateKey,
} from "@schoolapp/domain";
import type { Context } from "hono";
import type { ApiEnv } from "./types";
import { enqueueAckMail } from "./mail";
import { loadOrganisationEmailTemplateOverride } from "./email-template-overrides";
import { loadAutomaticEmailSendEnabled } from "./email-template-attachments";

export function applicantContact(canonical: CanonicalSnapshot): { email: string; name: string } | null {
  const guardians = canonical.guardians ?? [];
  const primary = guardians.find((row) => row.primaryContact && row.email) ?? guardians.find((row) => row.email);
  if (!primary?.email) return null;
  return { email: primary.email, name: primary.fullName || "Parent/Guardian" };
}

export function childDisplayName(canonical: CanonicalSnapshot): string {
  return canonical.child?.preferredName?.trim() || canonical.child?.legalName?.trim() || "your child";
}

export function intendedEntryLabel(
  canonical: CanonicalSnapshot,
  years: Array<{ id: string; name: string }>,
  groups: Array<{ id: string; name: string }>,
): string | null {
  const yearName = years.find((row) => row.id === canonical.child?.intendedAcademicYearId)?.name;
  const groupName = groups.find((row) => row.id === canonical.child?.intendedYearGroupId)?.name;
  if (groupName && yearName) return `${groupName} — ${yearName}`;
  return groupName || yearName || null;
}

export async function queueAdmissionsFormAck(
  c: Context<ApiEnv>,
  input: {
    organisationId: string;
    organisationName: string;
    result: Record<string, unknown>;
    canonical: CanonicalSnapshot;
    years?: Array<{ id: string; name: string }>;
    groups?: Array<{ id: string; name: string }>;
    draft?: boolean;
  },
): Promise<void> {
  if (input.draft) return;
  const formType = String(input.result.formType ?? "");
  if (formType === "enquiry") {
    await queueAdmissionsEnquiryAck(c, input);
    return;
  }
  if (formType === "application") {
    await queueAdmissionsApplicationAck(c, input);
  }
}

export async function queueAdmissionsEnquiryAck(
  c: Context<ApiEnv>,
  input: {
    organisationId: string;
    organisationName: string;
    result: Record<string, unknown>;
    canonical: CanonicalSnapshot;
    draft?: boolean;
  },
): Promise<void> {
  if (input.draft) return;
  if (String(input.result.formType ?? "") !== "enquiry") return;
  const enquiryId = String(input.result.enquiryId ?? "");
  const enquiryReference = String(input.result.enquiryReference ?? "");
  if (!enquiryId) return;
  const contact = applicantContact(input.canonical);
  if (!contact) return;
  const extras = await loadAckRenderContext(c, input.organisationId, "admissions_enquiry_received");
  await enqueueAckMail(
    c,
    admissionsEnquiryReceivedMail({
      organisationId: input.organisationId,
      organisationName: input.organisationName,
      toEmail: contact.email,
      toName: contact.name,
      enquiryId,
      enquiryReference: enquiryReference || null,
      schoolContactEmail: extras.schoolContactEmail,
      override: extras.override,
    }),
  );
}

export async function queueAdmissionsApplicationAck(
  c: Context<ApiEnv>,
  input: {
    organisationId: string;
    organisationName: string;
    result: Record<string, unknown>;
    canonical: CanonicalSnapshot;
    years?: Array<{ id: string; name: string }>;
    groups?: Array<{ id: string; name: string }>;
    draft?: boolean;
  },
): Promise<void> {
  if (input.draft) return;
  if (String(input.result.formType ?? "") !== "application") return;
  const applicationId = String(input.result.applicationId ?? "");
  const applicationReference = String(input.result.applicationReference ?? "");
  if (!applicationId || !applicationReference) return;
  const contact = applicantContact(input.canonical);
  if (!contact) return;
  const extras = await loadAckRenderContext(c, input.organisationId, "admissions_application_received");
  await enqueueAckMail(
    c,
    admissionsApplicationReceivedMail({
      organisationId: input.organisationId,
      organisationName: input.organisationName,
      toEmail: contact.email,
      toName: contact.name,
      childName: childDisplayName(input.canonical),
      applicationReference,
      intendedEntry: intendedEntryLabel(input.canonical, input.years ?? [], input.groups ?? []),
      applicationId,
      schoolContactEmail: extras.schoolContactEmail,
      override: extras.override,
    }),
  );
}

async function loadAckRenderContext(
  c: Context<ApiEnv>,
  organisationId: string,
  templateKey: CustomizableEmailTemplateKey,
): Promise<{
  schoolContactEmail: string | null;
  override: OrganisationEmailTemplateOverride | null;
}> {
  try {
    const pool = c.get("config").pools.app;
    const context = await pool.query<{ contact_email: string | null }>(
      "select contact_email from get_transactional_mail_context($1)",
      [organisationId],
    );
    const override = await loadOrganisationEmailTemplateOverride(pool, organisationId, templateKey);
    return {
      schoolContactEmail: context.rows[0]?.contact_email ?? null,
      override,
    };
  } catch {
    return { schoolContactEmail: null, override: null };
  }
}

type Queryable = {
  query: <T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

export type PendingAdmissionsStatusEmail = {
  organisationId: string;
  organisationName: string;
  applicationId: string;
  historyId: string;
  templateKey: AdmissionsStatusEmailTemplateKey;
  toEmail: string;
  toName: string;
  childName: string;
  applicationReference: string;
  intendedEntry: string | null;
  statusLabel: string;
  assessmentDate: string | null;
  offerDeadline: string | null;
};

export async function prepareAdmissionsStatusEmail(
  client: Queryable,
  input: {
    organisationId: string;
    applicationId: string;
    fromStatus: string;
    application: Record<string, unknown>;
  },
): Promise<PendingAdmissionsStatusEmail | null> {
  try {
    const toStatus = String(input.application.status ?? "");
    if (!toStatus || toStatus === input.fromStatus) return null;
    const templateKey = admissionsStatusEmailTemplateKeyForStatus(toStatus);
    if (!templateKey) return null;
    const sendEnabled = await loadAutomaticEmailSendEnabled(client, input.organisationId, templateKey);
    if (!sendEnabled) return null;
    const contact = await loadPrimaryApplicationContact(client, input.organisationId, input.applicationId);
    if (!contact) {
      console.info("admissions_status_email_skipped", {
        organisationId: input.organisationId,
        applicationId: input.applicationId,
        templateKey,
        reason: "missing_recipient",
      });
      return null;
    }
    const history = await client.query<{ id: string }>(
      `select id
         from admissions_application_status_history
        where application_id = $1
          and organisation_id = $2
          and new_status = $3
        order by created_at desc, id desc
        limit 1`,
      [input.applicationId, input.organisationId, toStatus],
    );
    const historyId = history.rows[0]?.id;
    if (!historyId) return null;
    const organisationName = await loadOrganisationName(client, input.organisationId);
    return {
      organisationId: input.organisationId,
      organisationName,
      applicationId: input.applicationId,
      historyId,
      templateKey,
      toEmail: contact.email,
      toName: contact.name,
      childName:
        String(input.application.pupil_preferred_name ?? "").trim() ||
        String(input.application.pupil_legal_name ?? "").trim() ||
        "your child",
      applicationReference: String(input.application.reference ?? ""),
      intendedEntry: intendedEntryFromApplication(input.application),
      statusLabel: formatStatusLabel(toStatus),
      assessmentDate:
        templateKey === "admissions_status_assessment_pending"
          ? await loadAssessmentDate(client, input.organisationId, input.applicationId)
          : null,
      offerDeadline:
        templateKey === "admissions_status_offer_made"
          ? await loadOfferDeadline(client, input.organisationId, input.applicationId)
          : null,
    };
  } catch {
    console.error("admissions_status_email_prepare_failed", {
      organisationId: input.organisationId,
      applicationId: input.applicationId,
    });
    return null;
  }
}

export async function queuePreparedAdmissionsStatusEmail(
  c: Context<ApiEnv>,
  pending: PendingAdmissionsStatusEmail | null | undefined,
): Promise<void> {
  if (!pending) return;
  try {
    const extras = await loadAckRenderContext(c, pending.organisationId, pending.templateKey);
    await enqueueAckMail(
      c,
      admissionsStatusEmailMail({
        organisationId: pending.organisationId,
        organisationName: pending.organisationName,
        toEmail: pending.toEmail,
        toName: pending.toName,
        childName: pending.childName,
        applicationReference: pending.applicationReference,
        intendedEntry: pending.intendedEntry,
        statusLabel: pending.statusLabel,
        assessmentDate: pending.assessmentDate,
        offerDeadline: pending.offerDeadline,
        schoolContactEmail: extras.schoolContactEmail,
        applicationId: pending.applicationId,
        historyId: pending.historyId,
        templateKey: pending.templateKey,
        override: extras.override,
      }),
    );
  } catch {
    console.error("admissions_status_email_enqueue_failed", {
      organisationId: pending.organisationId,
      applicationId: pending.applicationId,
      templateKey: pending.templateKey,
    });
  }
}

function intendedEntryFromApplication(application: Record<string, unknown>): string | null {
  const yearName = String(application.intended_academic_year_name ?? "").trim();
  const groupName = String(application.intended_year_group_name ?? "").trim();
  if (groupName && yearName) return `${groupName} — ${yearName}`;
  return groupName || yearName || null;
}

async function loadOrganisationName(client: Queryable, organisationId: string): Promise<string> {
  const row = await client.query<{ name: string }>("select name from organisations where id = $1", [
    organisationId,
  ]);
  return String(row.rows[0]?.name ?? "School");
}

async function loadPrimaryApplicationContact(
  client: Queryable,
  organisationId: string,
  applicationId: string,
): Promise<{ email: string; name: string } | null> {
  const rows = await client.query<{ full_name: string; email: string }>(
    `select full_name, email::text as email
       from admissions_application_contacts
      where application_id = $1
        and organisation_id = $2
        and email is not null
        and length(trim(email::text)) > 0
      order by is_primary desc, full_name, id
      limit 1`,
    [applicationId, organisationId],
  );
  const row = rows.rows[0];
  if (!row?.email) return null;
  return { email: row.email, name: row.full_name || "Parent/Guardian" };
}

async function loadAssessmentDate(
  client: Queryable,
  organisationId: string,
  applicationId: string,
): Promise<string | null> {
  const rows = await client.query<{ scheduled_on: string | null }>(
    `select scheduled_at::date::text as scheduled_on
       from admissions_assessments
      where application_id = $1
        and organisation_id = $2
        and scheduled_at is not null
      order by case when status = 'scheduled' then 0 else 1 end, scheduled_at desc
      limit 1`,
    [applicationId, organisationId],
  );
  const value = rows.rows[0]?.scheduled_on;
  return value ? formatUkNumericDate(value) : null;
}

async function loadOfferDeadline(
  client: Queryable,
  organisationId: string,
  applicationId: string,
): Promise<string | null> {
  const rows = await client.query<{ response_deadline: string | null }>(
    `select response_deadline::text as response_deadline
       from admissions_offers
      where application_id = $1
        and organisation_id = $2
        and status = 'made'
      order by created_at desc, id desc
      limit 1`,
    [applicationId, organisationId],
  );
  const value = rows.rows[0]?.response_deadline;
  return value ? formatUkNumericDate(value) : null;
}
