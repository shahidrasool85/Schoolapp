import {
  admissionsApplicationReceivedMail,
  admissionsEnquiryReceivedMail,
  type CanonicalSnapshot,
  type OrganisationEmailTemplateOverride,
} from "@schoolapp/core";
import type { Context } from "hono";
import type { ApiEnv } from "./types";
import { enqueueAckMail } from "./mail";
import { loadOrganisationEmailTemplateOverride } from "./email-template-overrides";

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
  templateKey: "admissions_enquiry_received" | "admissions_application_received",
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
