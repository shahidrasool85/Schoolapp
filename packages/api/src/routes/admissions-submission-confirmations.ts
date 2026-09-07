import { z } from "zod";
import {
  PERMISSIONS,
  isSubmissionConfirmationKey,
  publicBrandingAssetUrl,
  type SubmissionConfirmationKey,
} from "@schoolapp/domain";
import {
  AppError,
  SUBMISSION_CONFIRMATION_CATALOG,
  SubmissionConfirmationValidationError,
  assertPermission,
  renderSubmissionConfirmation,
  sampleSubmissionConfirmationData,
  submissionConfirmationCatalogItem,
  validateOrganisationSubmissionConfirmation,
  writeAudit,
  type OrganisationSubmissionConfirmation,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { withSchoolActor } from "../school-context";
import { mapConfirmationRow } from "../admissions-submission-confirmations";

const writeSchema = z.object({
  heading: z.string(),
  message: z.string(),
  additionalMessage: z.string().nullable().optional(),
  buttonLabel: z.string().nullable().optional(),
  buttonUrl: z.string().nullable().optional(),
});

const previewSchema = writeSchema.partial();

type SqlClient = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

type StoredRow = {
  template_key: string;
  heading: string;
  message_text: string;
  additional_message: string | null;
  button_label: string | null;
  button_url: string | null;
  updated_at: string;
};

function requireConfirmationKey(value: string): SubmissionConfirmationKey {
  if (!isSubmissionConfirmationKey(value)) {
    throw new AppError(400, "validation_failed", "This confirmation page cannot be customised.");
  }
  return value;
}

function presentTemplate(
  key: SubmissionConfirmationKey,
  current: OrganisationSubmissionConfirmation,
  updatedAt: string | null,
  customised: boolean,
) {
  const item = submissionConfirmationCatalogItem(key);
  return {
    key,
    name: item.name,
    description: item.description,
    heading: current.heading,
    message: current.message,
    additionalMessage: current.additionalMessage,
    buttonLabel: current.buttonLabel,
    buttonUrl: current.buttonUrl,
    source: customised ? "custom" : "system",
    customised,
    updatedAt,
    availableFields: item.mergeFields,
    sampleReference: item.sampleReference,
    referenceLabel: item.referenceLabel,
  };
}

async function loadStoredRow(client: SqlClient, orgId: string, key: SubmissionConfirmationKey) {
  const stored = await client.query<StoredRow>(
    `select template_key, heading, message_text, additional_message, button_label, button_url, updated_at
       from organisation_admissions_submission_confirmations
      where organisation_id = $1 and template_key = $2`,
    [orgId, key],
  );
  return stored.rows[0] ?? null;
}

async function loadPublicBranding(client: SqlClient, orgId: string) {
  const branding = await client.query<{
    organisation_name: string;
    primary_colour: string | null;
    has_logo: boolean;
    logo_version: string | null;
  }>("select * from get_public_school_branding($1)", [orgId]);
  const row = branding.rows[0];
  return {
    schoolName: String(row?.organisation_name ?? "School"),
    primaryColor: row?.primary_colour ?? null,
    logoUrl: row?.has_logo ? publicBrandingAssetUrl("logo", row.logo_version) : null,
  };
}

export function registerAdmissionsSubmissionConfirmationRoutes(app: SchoolappApi) {
  app.get("/onboarding/admissions/submission-confirmations", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const stored = await client.query<{
        template_key: string;
        updated_at: string;
      }>(
        `select template_key, updated_at
           from organisation_admissions_submission_confirmations
          where organisation_id = $1`,
        [orgId],
      );
      const byKey = new Map(stored.rows.map((row) => [row.template_key, row]));
      return c.json({
        templates: SUBMISSION_CONFIRMATION_CATALOG.map((item) => {
          const row = byKey.get(item.key);
          return {
            key: item.key,
            name: item.name,
            description: item.description,
            source: row ? "custom" : "system",
            customised: Boolean(row),
            updatedAt: row?.updated_at ?? null,
            availableFields: item.mergeFields,
            sampleReference: item.sampleReference,
            referenceLabel: item.referenceLabel,
          };
        }),
      });
    }),
  );

  app.get("/onboarding/admissions/submission-confirmations/:key", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const key = requireConfirmationKey(c.req.param("key") ?? "");
      const item = submissionConfirmationCatalogItem(key);
      const stored = await loadStoredRow(client, orgId, key);
      const current = stored ? mapConfirmationRow(stored) ?? item.defaults : item.defaults;
      return c.json({
        template: presentTemplate(key, current, stored?.updated_at ?? null, Boolean(stored)),
      });
    }),
  );

  app.put("/onboarding/admissions/submission-confirmations/:key", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const key = requireConfirmationKey(c.req.param("key") ?? "");
      const parsed = writeSchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid submission confirmation");
      }
      let validated: OrganisationSubmissionConfirmation;
      try {
        validated = validateOrganisationSubmissionConfirmation({ templateKey: key, ...parsed.data });
      } catch (error) {
        if (error instanceof SubmissionConfirmationValidationError) {
          throw new AppError(400, "validation_failed", error.message);
        }
        throw error;
      }
      const saved = await client.query<StoredRow>(
        `insert into organisation_admissions_submission_confirmations (
           organisation_id, template_key, heading, message_text, additional_message,
           button_label, button_url, updated_by_user_id
         ) values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (organisation_id, template_key) do update set
           heading = excluded.heading,
           message_text = excluded.message_text,
           additional_message = excluded.additional_message,
           button_label = excluded.button_label,
           button_url = excluded.button_url,
           updated_by_user_id = excluded.updated_by_user_id
         returning template_key, heading, message_text, additional_message, button_label, button_url, updated_at`,
        [
          orgId,
          key,
          validated.heading,
          validated.message,
          validated.additionalMessage,
          validated.buttonLabel,
          validated.buttonUrl,
          userId,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "org.admissions_submission_confirmation.updated",
        entityType: "organisation_admissions_submission_confirmation",
        entityId: orgId,
        after: { templateKey: key, source: "custom" },
      });
      const row = saved.rows[0]!;
      return c.json({
        template: presentTemplate(key, mapConfirmationRow(row)!, row.updated_at, true),
      });
    }),
  );

  app.post("/onboarding/admissions/submission-confirmations/:key/preview", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const key = requireConfirmationKey(c.req.param("key") ?? "");
      const parsed = previewSchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid submission confirmation preview");
      }
      const item = submissionConfirmationCatalogItem(key);
      const stored = await loadStoredRow(client, orgId, key);
      const current = stored ? mapConfirmationRow(stored) ?? item.defaults : item.defaults;
      const draft = {
        ...item.defaults,
        ...current,
        ...Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined)),
        templateKey: key,
      };
      let validated: OrganisationSubmissionConfirmation;
      try {
        validated = validateOrganisationSubmissionConfirmation(draft);
      } catch (error) {
        if (error instanceof SubmissionConfirmationValidationError) {
          throw new AppError(400, "validation_failed", error.message);
        }
        throw error;
      }
      const branding = await loadPublicBranding(client, orgId);
      const sample = sampleSubmissionConfirmationData(key, branding.schoolName);
      const confirmation = renderSubmissionConfirmation({
        templateKey: key,
        override: { ...validated },
        schoolName: branding.schoolName,
        data: sample,
      });
      return c.json({
        template: key,
        fixture: true,
        queued: false,
        confirmation,
        branding,
      });
    }),
  );

  app.delete("/onboarding/admissions/submission-confirmations/:key", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const key = requireConfirmationKey(c.req.param("key") ?? "");
      await client.query(
        `delete from organisation_admissions_submission_confirmations
          where organisation_id = $1 and template_key = $2`,
        [orgId, key],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "org.admissions_submission_confirmation.reset",
        entityType: "organisation_admissions_submission_confirmation",
        entityId: orgId,
        after: { templateKey: key, source: "system" },
      });
      const item = submissionConfirmationCatalogItem(key);
      return c.json({
        template: presentTemplate(key, item.defaults, null, false),
      });
    }),
  );
}
