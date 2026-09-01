import {
  admissionsApplicationReceivedMail,
  type CanonicalSnapshot,
} from "@schoolapp/core";
import type { Context } from "hono";
import type { ApiEnv } from "./types";
import { mailOf } from "./mail";

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
  await mailOf(c).send(
    admissionsApplicationReceivedMail({
      organisationId: input.organisationId,
      organisationName: input.organisationName,
      toEmail: contact.email,
      toName: contact.name,
      childName: childDisplayName(input.canonical),
      applicationReference,
      intendedEntry: intendedEntryLabel(input.canonical, input.years ?? [], input.groups ?? []),
      applicationId,
    }),
  );
}
