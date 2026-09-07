import { z } from "zod";
import {
  DEFAULT_BRAND_ACCENT,
  DEFAULT_BRAND_PRIMARY,
  EMAIL_TEMPLATE_KEYS,
  HEX_COLOR_PATTERN,
  ONBOARDING_STEPS,
  PERMISSIONS,
  SCHOOL_SETTINGS_PROFILE_READ_PERMISSIONS,
  isAdmissionsStatusEmailTemplateKey,
  isCustomizableEmailTemplateKey,
  publicBrandingAssetUrl,
  isOnboardingStep,
} from "@schoolapp/domain";
import {
  AppError,
  AUTOMATIC_EMAIL_TEMPLATE_CATALOG,
  EmailAttachmentError,
  EmailTemplateValidationError,
  assertAnyPermission,
  assertPermission,
  assertTransactionalEmailAttachmentSet,
  attachmentSizeRejectionMessage,
  automaticEmailCatalogItem,
  evaluateReadiness,
  fixturePreviewData,
  isIsoCurrency,
  mailOutboxCanRetry,
  pgErrorToAppError,
  presentPlatformEmailAttachmentLimits,
  presentSchoolOnboarding,
  renderTransactionalEmail,
  resolveAutomaticEmailSendEnabled,
  sampleMergeData,
  sanitizeEmailAttachmentFilename,
  tooManyAttachmentsMessage,
  validateOrganisationEmailTemplate,
  writeAudit,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { withSchoolActor } from "../school-context";
import { deliverQueuedMail } from "../email-delivery";
import {
  loadAutomaticEmailAttachmentViews,
  loadAutomaticEmailSettings,
  loadShowSchoolLogo,
} from "../email-template-attachments";
import { loadPlatformEmailAttachmentLimits, emailCapabilitiesFromRuntime } from "../platform-email-attachment-limits";
import {
  insertPendingObject,
  profileForDomain,
  putAndActivateObject,
  readUploadedFile,
  runUpload,
  storageErrorToAppError,
  storageOf,
  scannerOf,
} from "../file-service";
import { assertBrandingImageDimensions, validateUpload } from "@schoolapp/storage";

const profileSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  legalName: z.string().max(200).nullable().optional(),
  schoolCode: z.string().max(40).nullable().optional(),
  timezone: z.string().min(1).max(64).optional(),
  locale: z.string().min(2).max(16).optional(),
  defaultCurrency: z.string().length(3).optional(),
  contactTelephone: z.string().max(40).nullable().optional(),
  contactEmail: z.string().email().nullable().optional().or(z.literal("")),
  website: z.string().max(200).nullable().optional(),
  addressLine1: z.string().max(120).nullable().optional(),
  addressLine2: z.string().max(120).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  postcode: z.string().max(20).nullable().optional(),
});

const brandingSchema = z.object({
  tagline: z.string().max(160).nullable().optional(),
  primaryColour: z.string().regex(HEX_COLOR_PATTERN).nullable().optional(),
  accentColour: z.string().regex(HEX_COLOR_PATTERN).nullable().optional(),
});

const progressSchema = z.object({
  currentStep: z.enum(ONBOARDING_STEPS).optional(),
  completedSteps: z.array(z.enum(ONBOARDING_STEPS)).optional(),
  markComplete: z.boolean().optional(),
  markReady: z.boolean().optional(),
});

const preferenceSchema = z.object({
  dismissAutomatic: z.literal(true),
});

const templateWriteSchema = z.object({
  enabled: z.boolean().optional(),
  sendEnabled: z.boolean().optional(),
  subject: z.string(),
  heading: z.string(),
  greeting: z.string(),
  body: z.string(),
  signoff: z.string(),
});

const templatePreviewSchema = z.object({
  enabled: z.boolean().optional(),
  subject: z.string().optional(),
  heading: z.string().optional(),
  greeting: z.string().optional(),
  body: z.string().optional(),
  signoff: z.string().optional(),
  showSchoolLogo: z.boolean().optional(),
});

const templatePresentationSchema = z.object({
  showSchoolLogo: z.boolean().optional(),
  sendEnabled: z.boolean().optional(),
}).refine((value) => value.showSchoolLogo !== undefined || value.sendEnabled !== undefined, {
  message: "Nothing to update",
});

function publicBrandingUrls(
  hasLogo: boolean,
  hasHero: boolean,
  versions?: { logo?: string | null; hero?: string | null },
) {
  return {
    logoUrl: hasLogo ? publicBrandingAssetUrl("logo", versions?.logo) : null,
    heroImageUrl: hasHero ? publicBrandingAssetUrl("hero", versions?.hero) : null,
  };
}

export function registerOnboardingRoutes(app: SchoolappApi) {
  app.get("/onboarding", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [
        PERMISSIONS.ONBOARDING_READ,
        PERMISSIONS.ONBOARDING_MANAGE,
        PERMISSIONS.ORG_SETTINGS_READ,
      ]);
      await client.query(
        `insert into organisation_setup_progress (organisation_id)
         values ($1)
         on conflict (organisation_id) do nothing`,
        [orgId],
      );
      const progress = await client.query<{
        current_step: string;
        completed_steps: string[];
        completed_at: string | null;
        ready_marked_at: string | null;
      }>(
        `select current_step, completed_steps, completed_at::text, ready_marked_at::text
         from organisation_setup_progress where organisation_id = $1`,
        [orgId],
      );
      const counts = await loadReadinessCounts(client, orgId);
      const readiness = evaluateReadiness(counts);
      const row = progress.rows[0];
      const dismissed = await loadAutomaticOnboardingDismissed(client, orgId, actor.userId);
      return c.json(
        presentSchoolOnboarding({
          schoolName: counts.schoolName,
          currentStep: row?.current_step ?? "school_details",
          completedSteps: row?.completed_steps ?? [],
          completedAt: row?.completed_at ?? null,
          readyMarkedAt: row?.ready_marked_at ?? null,
          readiness: {
            ready: readiness.ready,
            items: readiness.items,
          },
          automaticOnboardingDismissed: dismissed,
          canManageSetup: actor.permissions.has(PERMISSIONS.ONBOARDING_MANAGE),
        }),
      );
    }),
  );

  app.patch("/onboarding/progress", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ONBOARDING_MANAGE);
      const parsed = progressSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid onboarding payload");
      const completed = (parsed.data.completedSteps ?? []).filter(isOnboardingStep);
      if (parsed.data.markComplete === true) {
        const readiness = evaluateReadiness(await loadReadinessCounts(client, orgId));
        if (!readiness.ready) {
          throw new AppError(
            400,
            "setup_not_ready",
            "Required setup is not complete yet. You can keep using the school and finish later.",
          );
        }
      }
      await client.query(
        `insert into organisation_setup_progress (organisation_id, current_step, completed_steps, updated_by)
         values ($1, $2, $3, $4)
         on conflict (organisation_id) do update set
           current_step = coalesce($2, organisation_setup_progress.current_step),
           completed_steps = case when $5 then $3 else organisation_setup_progress.completed_steps end,
           completed_at = case
             when $6 then now()
             else organisation_setup_progress.completed_at
           end,
           ready_marked_at = case
             when $7 then now()
             else organisation_setup_progress.ready_marked_at
           end,
           updated_by = $4`,
        [
          orgId,
          parsed.data.currentStep ?? "school_details",
          completed,
          userId,
          parsed.data.completedSteps !== undefined,
          parsed.data.markComplete === true,
          parsed.data.markReady === true,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "onboarding.progress.updated",
        entityType: "organisation_setup_progress",
        entityId: orgId,
        after: parsed.data,
      });
      return c.json({ ok: true });
    }),
  );

  app.patch("/onboarding/preference", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ONBOARDING_MANAGE);
      const parsed = preferenceSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid onboarding preference");
      await client.query(
        `insert into organisation_onboarding_preferences (
           organisation_id, user_id, automatic_onboarding_dismissed_at
         ) values ($1, $2, now())
         on conflict (organisation_id, user_id) do update set
           automatic_onboarding_dismissed_at = now()`,
        [orgId, userId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "onboarding.automatic_dismissed",
        entityType: "organisation_onboarding_preferences",
        entityId: orgId,
        after: { dismissedAutomatic: true },
      });
      return c.json({ ok: true, automaticOnboardingDismissed: true });
    }),
  );

  app.get("/onboarding/profile", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, SCHOOL_SETTINGS_PROFILE_READ_PERMISSIONS);
      const row = await client.query(
        `select o.id, o.slug, o.name, o.legal_name, o.school_code, o.timezone, o.country_code, o.status,
                s.locale, s.default_currency, s.contact_telephone, s.contact_email, s.website,
                s.address_line_1, s.address_line_2, s.city, s.postcode,
                s.tagline, s.primary_colour, s.accent_colour,
                s.logo_object_id, s.hero_object_id
         from organisations o
         join organisation_settings s on s.organisation_id = o.id
         where o.id = $1`,
        [orgId],
      );
      if (!row.rows[0]) throw new AppError(404, "not_found", "Not found");
      return c.json({ profile: mapSchoolProfile(row.rows[0]) });
    }),
  );

  app.patch("/onboarding/profile", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const parsed = profileSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid school profile");
      if (parsed.data.defaultCurrency && !isIsoCurrency(parsed.data.defaultCurrency.toUpperCase())) {
        throw new AppError(400, "validation_failed", "Currency must be a 3-letter ISO code");
      }
      await client.query(
        `update organisations
         set name = coalesce($2, name),
             legal_name = case when $3 then $4 else legal_name end,
             school_code = case when $5 then $6 else school_code end,
             timezone = coalesce($7, timezone)
         where id = $1`,
        [
          orgId,
          parsed.data.name ?? null,
          parsed.data.legalName !== undefined,
          parsed.data.legalName || null,
          parsed.data.schoolCode !== undefined,
          parsed.data.schoolCode || null,
          parsed.data.timezone ?? null,
        ],
      );
      await client.query(
        `update organisation_settings
         set locale = coalesce($2, locale),
             default_currency = coalesce($3, default_currency),
             contact_telephone = case when $4 then $5 else contact_telephone end,
             contact_email = case when $6 then $7 else contact_email end,
             website = case when $8 then $9 else website end,
             address_line_1 = case when $10 then $11 else address_line_1 end,
             address_line_2 = case when $12 then $13 else address_line_2 end,
             city = case when $14 then $15 else city end,
             postcode = case when $16 then $17 else postcode end
         where organisation_id = $1`,
        [
          orgId,
          parsed.data.locale ?? null,
          parsed.data.defaultCurrency?.toUpperCase() ?? null,
          parsed.data.contactTelephone !== undefined,
          parsed.data.contactTelephone || null,
          parsed.data.contactEmail !== undefined,
          parsed.data.contactEmail || null,
          parsed.data.website !== undefined,
          parsed.data.website || null,
          parsed.data.addressLine1 !== undefined,
          parsed.data.addressLine1 || null,
          parsed.data.addressLine2 !== undefined,
          parsed.data.addressLine2 || null,
          parsed.data.city !== undefined,
          parsed.data.city || null,
          parsed.data.postcode !== undefined,
          parsed.data.postcode || null,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "org.profile.updated",
        entityType: "organisation",
        entityId: orgId,
        after: { name: parsed.data.name ?? undefined },
      });
      return c.json({ ok: true });
    }),
  );

  app.patch("/onboarding/branding", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const parsed = brandingSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid branding payload");
      await client.query(
        `update organisation_settings
         set tagline = case when $2 then $3 else tagline end,
             primary_colour = case when $4 then $5 else primary_colour end,
             accent_colour = case when $6 then $7 else accent_colour end
         where organisation_id = $1`,
        [
          orgId,
          parsed.data.tagline !== undefined,
          parsed.data.tagline || null,
          parsed.data.primaryColour !== undefined,
          parsed.data.primaryColour || null,
          parsed.data.accentColour !== undefined,
          parsed.data.accentColour || null,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "org.branding.updated",
        entityType: "organisation",
        entityId: orgId,
        after: {
          tagline: parsed.data.tagline ?? undefined,
          primaryColour: parsed.data.primaryColour ?? undefined,
        },
      });
      return c.json({
        branding: {
          tagline: parsed.data.tagline ?? null,
          primaryColor: parsed.data.primaryColour ?? DEFAULT_BRAND_PRIMARY,
          accentColor: parsed.data.accentColour ?? DEFAULT_BRAND_ACCENT,
          ...publicBrandingUrls(false, false),
        },
      });
    }),
  );

  app.post("/onboarding/branding/:kind", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const kind = c.req.param("kind");
      if (kind !== "logo" && kind !== "hero") {
        throw new AppError(404, "not_found", "Not found");
      }
      const uploaded = await readUploadedFile(c);
      const profile = profileForDomain("branding");
      let validated;
      try {
        validated = validateUpload({
          filename: uploaded.filename,
          declaredMime: uploaded.mime,
          bytes: uploaded.bytes,
          profile,
        });
        assertBrandingImageDimensions({
          bytes: uploaded.bytes,
          kind: validated.kind,
          purpose: kind,
        });
      } catch (error) {
        throw storageErrorToAppError(error);
      }
      const stored = await runUpload(storageOf(c), async (track) => {
        const pending = await insertPendingObject(client, {
          organisationId: orgId,
          domain: "branding",
          ownerRecordId: orgId,
          storage: storageOf(c),
          validated,
          uploadedBy: userId,
        });
        track(pending.storageKey);
        await putAndActivateObject(client, storageOf(c), scannerOf(c), {
          organisationId: orgId,
          objectId: pending.id,
          storageKey: pending.storageKey,
          bytes: uploaded.bytes,
          contentType: validated.storedContentType,
          filename: validated.originalFilename,
          actorUserId: userId,
          domain: "branding",
        });
        const column = kind === "logo" ? "logo_object_id" : "hero_object_id";
        await client.query(
          `update organisation_settings set ${column} = $2 where organisation_id = $1`,
          [orgId, pending.id],
        );
        return pending;
      });
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "org.branding.upload",
        entityType: "stored_object",
        entityId: stored.id,
        after: { kind },
      });
      return c.json({ ok: true, kind, objectId: stored.id }, 201);
    }),
  );

  app.delete("/onboarding/branding/:kind", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const kind = c.req.param("kind");
      if (kind !== "logo" && kind !== "hero") {
        throw new AppError(404, "not_found", "Not found");
      }
      const column = kind === "logo" ? "logo_object_id" : "hero_object_id";
      await client.query(
        `update organisation_settings set ${column} = null where organisation_id = $1`,
        [orgId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "org.branding.removed",
        entityType: "organisation",
        entityId: orgId,
        after: { kind },
      });
      return c.json({ ok: true, kind });
    }),
  );

  app.get("/onboarding/mail", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [PERMISSIONS.ONBOARDING_MANAGE, PERMISSIONS.ORG_SETTINGS_MANAGE]);
      const rows = await client.query(
        `select id, purpose, template_key, to_email, to_name, subject, body_text, created_at,
                status, provider_key, provider_message_id, attempt_count, sent_at,
                last_error_code, last_error_redacted, idempotency_key
         from mail_outbox
         where organisation_id = $1
         order by created_at desc
         limit 50`,
        [orgId],
      );
      return c.json({
        messages: rows.rows.map((row) => ({
          id: row.id,
          purpose: row.purpose,
          templateKey: row.template_key,
          toEmail: row.to_email,
          toName: row.to_name,
          subject: row.subject,
          bodyText: String(row.body_text ?? "").replace(/([?&]token=)[^&\s]+/gi, "$1redacted"),
          createdAt: row.created_at,
          status: row.status,
          providerKey: row.provider_key,
          providerMessageId: row.provider_message_id,
          attemptCount: row.attempt_count,
          sentAt: row.sent_at,
          lastErrorCode: row.last_error_code,
          lastError: row.last_error_redacted,
          canRetry: mailOutboxCanRetry(String(row.status), String(row.purpose)),
        })),
      });
    }),
  );

  app.post("/onboarding/mail/:id/retry", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [PERMISSIONS.ONBOARDING_MANAGE, PERMISSIONS.ORG_SETTINGS_MANAGE]);
      const id = c.req.param("id");
      const requeued = await client.query<{ requeue_mail_outbox_message: boolean }>(
        "select requeue_mail_outbox_message($1, $2)",
        [orgId, id],
      );
      if (!requeued.rows[0]?.requeue_mail_outbox_message) {
        throw new AppError(404, "not_found", "This message cannot be retried");
      }
      await deliverQueuedMail(c.get("config"), { id }).catch(() => undefined);
      const row = await client.query<{ status: string; last_error_code: string | null }>(
        "select status, last_error_code from mail_outbox where id = $1 and organisation_id = $2",
        [id, orgId],
      );
      return c.json({
        id,
        status: row.rows[0]?.status ?? "queued",
        lastErrorCode: row.rows[0]?.last_error_code ?? null,
      });
    }),
  );

  app.get("/onboarding/mail/preview", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, [PERMISSIONS.ONBOARDING_MANAGE, PERMISSIONS.ORG_SETTINGS_MANAGE]);
      const requested = String(c.req.query("template") ?? "account_invitation");
      const template = (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(requested)
        ? (requested as (typeof EMAIL_TEMPLATE_KEYS)[number])
        : "account_invitation";
      const branding = await loadMailBranding(client, orgId);
      const override = isCustomizableEmailTemplateKey(template)
        ? await loadStoredTemplate(client, orgId, template)
        : null;
      const sample = isCustomizableEmailTemplateKey(template)
        ? sampleMergeData(template, branding, branding.schoolContactEmail)
        : fixturePreviewData(template);
      const rendered = renderTransactionalEmail(template, sample, branding, override);
      return c.json({
        template,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        fixture: true,
      });
    }),
  );

  app.get("/onboarding/mail/templates", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const stored = await client.query<{
        template_key: string;
        enabled: boolean;
        updated_at: string;
      }>(
        `select template_key, enabled, updated_at
           from organisation_transactional_email_templates
          where organisation_id = $1`,
        [orgId],
      );
      const settings = await client.query<{
        template_key: string;
        send_enabled: boolean;
      }>(
        `select template_key, send_enabled
           from organisation_transactional_email_settings
          where organisation_id = $1`,
        [orgId],
      );
      const byKey = new Map(stored.rows.map((row) => [row.template_key, row]));
      const settingsByKey = new Map(settings.rows.map((row) => [row.template_key, row]));
      return c.json({
        templates: AUTOMATIC_EMAIL_TEMPLATE_CATALOG.map((item) => {
          const row = byKey.get(item.key);
          const sendEnabled = resolveAutomaticEmailSendEnabled(
            item.key,
            settingsByKey.get(item.key)?.send_enabled,
          );
          return {
            key: item.key,
            name: item.name,
            description: item.description,
            kind: item.kind,
            enabled: row ? row.enabled : true,
            sendEnabled,
            source: row && row.enabled ? "custom" : "system",
            customised: Boolean(row),
            updatedAt: row?.updated_at ?? null,
            availableFields: item.mergeFields,
          };
        }),
        attachmentLimits: presentPlatformEmailAttachmentLimits(
          await loadPlatformEmailAttachmentLimits(client, emailCapabilitiesFromRuntime(c.get("config").email)),
          emailCapabilitiesFromRuntime(c.get("config").email),
        ),
      });
    }),
  );

  app.get("/onboarding/mail/templates/:key", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const key = requireCustomizableKey(c.req.param("key") ?? "");
      const item = automaticEmailCatalogItem(key);
      const stored = await loadStoredTemplateRow(client, orgId, key);
      const current = stored ?? item.defaults;
      const presentation = await loadTemplatePresentation(
        client,
        orgId,
        key,
        emailCapabilitiesFromRuntime(c.get("config").email),
      );
      return c.json({
        template: presentStoredTemplate(
          item,
          current,
          stored?.updatedAt ?? null,
          Boolean(stored),
          presentation,
        ),
      });
    }),
  );

  app.put("/onboarding/mail/templates/:key", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const key = requireCustomizableKey(c.req.param("key") ?? "");
      const parsed = templateWriteSchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid email template");
      }
      let validated;
      try {
        validated = validateOrganisationEmailTemplate({ templateKey: key, ...parsed.data });
      } catch (error) {
        if (error instanceof EmailTemplateValidationError) {
          throw new AppError(400, "validation_failed", error.message);
        }
        throw error;
      }
      const saved = await client.query<{
        enabled: boolean;
        subject: string;
        heading: string;
        greeting: string;
        body_text: string;
        signoff: string;
        updated_at: string;
      }>(
        `insert into organisation_transactional_email_templates (
           organisation_id, template_key, enabled, subject, heading, greeting, body_text, signoff, updated_by_user_id
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (organisation_id, template_key) do update set
           enabled = excluded.enabled,
           subject = excluded.subject,
           heading = excluded.heading,
           greeting = excluded.greeting,
           body_text = excluded.body_text,
           signoff = excluded.signoff,
           updated_by_user_id = excluded.updated_by_user_id
         returning enabled, subject, heading, greeting, body_text, signoff, updated_at`,
        [
          orgId,
          key,
          validated.enabled,
          validated.subject,
          validated.heading,
          validated.greeting,
          validated.body,
          validated.signoff,
          userId,
        ],
      );
      if (isAdmissionsStatusEmailTemplateKey(key) && parsed.data.sendEnabled !== undefined) {
        await upsertEmailTemplateSettings(client, orgId, key, userId, undefined, parsed.data.sendEnabled);
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "org.email_template.updated",
        entityType: "organisation_transactional_email_template",
        entityId: orgId,
        after: {
          templateKey: key,
          enabled: validated.enabled,
          customised: true,
          ...(isAdmissionsStatusEmailTemplateKey(key) && parsed.data.sendEnabled !== undefined
            ? { sendEnabled: parsed.data.sendEnabled }
            : {}),
        },
      });
      const item = automaticEmailCatalogItem(key);
      const row = saved.rows[0]!;
      const presentation = await loadTemplatePresentation(
        client,
        orgId,
        key,
        emailCapabilitiesFromRuntime(c.get("config").email),
      );
      return c.json({
        template: presentStoredTemplate(
          item,
          {
            templateKey: key,
            enabled: row.enabled,
            subject: row.subject,
            heading: row.heading,
            greeting: row.greeting,
            body: row.body_text,
            signoff: row.signoff,
          },
          row.updated_at,
          true,
          presentation,
        ),
      });
    }),
  );

  app.post("/onboarding/mail/templates/:key/preview", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const key = requireCustomizableKey(c.req.param("key") ?? "");
      const parsed = templatePreviewSchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid email template preview");
      }
      const item = automaticEmailCatalogItem(key);
      const stored = await loadStoredTemplate(client, orgId, key);
      const draft = {
        ...item.defaults,
        ...(stored ?? {}),
        ...Object.fromEntries(
          Object.entries(parsed.data).filter(([, value]) => value !== undefined),
        ),
        templateKey: key,
      };
      let validated;
      try {
        validated = validateOrganisationEmailTemplate(draft);
      } catch (error) {
        if (error instanceof EmailTemplateValidationError) {
          throw new AppError(400, "validation_failed", error.message);
        }
        throw error;
      }
      const branding = await loadMailBranding(client, orgId);
      const showSchoolLogo =
        parsed.data.showSchoolLogo ?? (await loadShowSchoolLogo(client, orgId, key));
      const sample = sampleMergeData(key, branding, branding.schoolContactEmail);
      const rendered = renderTransactionalEmail(
        key,
        sample,
        { ...branding, logoUrl: showSchoolLogo ? branding.logoUrl : null },
        { ...validated, enabled: true },
      );
      const capabilities = emailCapabilitiesFromRuntime(c.get("config").email);
      const limits = await loadPlatformEmailAttachmentLimits(client, capabilities);
      const attachments = await loadAutomaticEmailAttachmentViews(client, orgId, key, limits, capabilities);
      return c.json({
        template: key,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        fixture: true,
        queued: false,
        showSchoolLogo,
        attachmentLimits: presentPlatformEmailAttachmentLimits(limits, capabilities),
        attachments: attachments.map((item) => ({
          filename: item.filename,
          contentType: item.contentType,
          byteSize: item.byteSize,
          kindLabel: item.kindLabel,
          sizeLabel: item.sizeLabel,
          overLimit: item.overLimit,
        })),
      });
    }),
  );

  app.delete("/onboarding/mail/templates/:key", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const key = requireCustomizableKey(c.req.param("key") ?? "");
      await client.query(
        `delete from organisation_transactional_email_templates
          where organisation_id = $1 and template_key = $2`,
        [orgId, key],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "org.email_template.reset",
        entityType: "organisation_transactional_email_template",
        entityId: orgId,
        after: { templateKey: key, resetToDefault: true },
      });
      const item = automaticEmailCatalogItem(key);
      const presentation = await loadTemplatePresentation(
        client,
        orgId,
        key,
        emailCapabilitiesFromRuntime(c.get("config").email),
      );
      return c.json({
        template: presentStoredTemplate(item, item.defaults, null, false, presentation),
      });
    }),
  );

  app.put("/onboarding/mail/templates/:key/presentation", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const key = requireCustomizableKey(c.req.param("key") ?? "");
      const parsed = templatePresentationSchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid email presentation");
      }
      await upsertEmailTemplateSettings(
        client,
        orgId,
        key,
        userId,
        parsed.data.showSchoolLogo,
        isAdmissionsStatusEmailTemplateKey(key) ? parsed.data.sendEnabled : undefined,
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action:
          parsed.data.sendEnabled !== undefined && parsed.data.showSchoolLogo === undefined
            ? "org.email_template.send_enabled_changed"
            : "org.email_template.logo_visibility_changed",
        entityType: "organisation_transactional_email_settings",
        entityId: orgId,
        after: {
          templateKey: key,
          ...(parsed.data.showSchoolLogo !== undefined ? { showSchoolLogo: parsed.data.showSchoolLogo } : {}),
          ...(parsed.data.sendEnabled !== undefined ? { sendEnabled: parsed.data.sendEnabled } : {}),
        },
      });
      const item = automaticEmailCatalogItem(key);
      const stored = await loadStoredTemplateRow(client, orgId, key);
      const presentation = await loadTemplatePresentation(
        client,
        orgId,
        key,
        emailCapabilitiesFromRuntime(c.get("config").email),
      );
      return c.json({
        template: presentStoredTemplate(
          item,
          stored ?? item.defaults,
          stored?.updatedAt ?? null,
          Boolean(stored),
          presentation,
        ),
      });
    }),
  );

  app.post("/onboarding/mail/templates/:key/attachments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const key = requireCustomizableKey(c.req.param("key") ?? "");
      const capabilities = emailCapabilitiesFromRuntime(c.get("config").email);
      const limits = await loadPlatformEmailAttachmentLimits(client, capabilities);
      const uploaded = await readUploadedFile(c);
      if (uploaded.bytes.byteLength > limits.maxBytesPerFile) {
        throw new AppError(
          400,
          "file_too_large",
          attachmentSizeRejectionMessage(
            uploaded.filename,
            uploaded.bytes.byteLength,
            limits.maxBytesPerFile,
            capabilities,
          ),
        );
      }
      const profile = {
        ...profileForDomain("transactional_email"),
        maxBytes: limits.maxBytesPerFile,
      };
      let validated;
      try {
        validated = validateUpload({
          filename: uploaded.filename,
          declaredMime: uploaded.mime,
          bytes: uploaded.bytes,
          profile,
        });
      } catch (error) {
        throw storageErrorToAppError(error);
      }
      if (validated.byteSize > limits.maxBytesPerFile) {
        throw new AppError(
          400,
          "file_too_large",
          attachmentSizeRejectionMessage(
            validated.originalFilename,
            validated.byteSize,
            limits.maxBytesPerFile,
            capabilities,
          ),
        );
      }
      const settingsId = await upsertEmailTemplateSettings(client, orgId, key, userId);
      const existing = await loadAutomaticEmailAttachmentViews(client, orgId, key, limits, capabilities);
      if (existing.length >= limits.maxCount) {
        throw new AppError(400, "attachment_limit_exceeded", tooManyAttachmentsMessage(limits.maxCount));
      }
      try {
        assertTransactionalEmailAttachmentSet(
          [
            ...existing.map((item) => ({
              filename: item.filename,
              contentType: item.contentType,
              byteSize: item.byteSize,
            })),
            {
              filename: validated.originalFilename,
              contentType: validated.storedContentType,
              byteSize: validated.byteSize,
            },
          ],
          limits,
          capabilities,
        );
      } catch (error) {
        if (error instanceof EmailAttachmentError) {
          throw new AppError(400, error.code, error.message);
        }
        throw error;
      }
      const displayFilename = sanitizeEmailAttachmentFilename(
        validated.originalFilename,
        validated.storedContentType,
      );
      const sortOrder = existing.length;
      const stored = await runUpload(storageOf(c), async (track) => {
        const pending = await insertPendingObject(client, {
          organisationId: orgId,
          domain: "transactional_email",
          ownerRecordId: settingsId,
          storage: storageOf(c),
          validated,
          uploadedBy: userId,
        });
        track(pending.storageKey);
        await putAndActivateObject(client, storageOf(c), scannerOf(c), {
          organisationId: orgId,
          objectId: pending.id,
          storageKey: pending.storageKey,
          bytes: uploaded.bytes,
          contentType: validated.storedContentType,
          filename: displayFilename,
          actorUserId: userId,
          domain: "transactional_email",
        });
        const attached = await client.query<{ id: string }>(
          `insert into organisation_transactional_email_template_attachments (
             organisation_id, template_key, stored_object_id, display_filename, sort_order, created_by_user_id
           ) values ($1, $2, $3, $4, $5, $6)
           returning id`,
          [orgId, key, pending.id, displayFilename, sortOrder, userId],
        );
        return { objectId: pending.id, attachmentId: attached.rows[0]!.id };
      });
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "org.email_template.attachment_added",
        entityType: "organisation_transactional_email_template_attachment",
        entityId: stored.attachmentId,
        after: {
          templateKey: key,
          storedObjectId: stored.objectId,
          filename: displayFilename,
          contentType: validated.storedContentType,
          byteSize: validated.byteSize,
        },
      });
      const item = automaticEmailCatalogItem(key);
      const wording = await loadStoredTemplateRow(client, orgId, key);
      const presentation = await loadTemplatePresentation(
        client,
        orgId,
        key,
        emailCapabilitiesFromRuntime(c.get("config").email),
      );
      return c.json(
        {
          template: presentStoredTemplate(
            item,
            wording ?? item.defaults,
            wording?.updatedAt ?? null,
            Boolean(wording),
            presentation,
          ),
        },
        201,
      );
    }),
  );

  app.delete("/onboarding/mail/templates/:key/attachments/:attachmentId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_SETTINGS_MANAGE);
      const key = requireCustomizableKey(c.req.param("key") ?? "");
      const attachmentId = c.req.param("attachmentId") ?? "";
      const found = await client.query<{
        id: string;
        stored_object_id: string;
        display_filename: string;
      }>(
        `select id, stored_object_id, display_filename
           from organisation_transactional_email_template_attachments
          where id = $1 and organisation_id = $2 and template_key = $3`,
        [attachmentId, orgId, key],
      );
      const row = found.rows[0];
      if (!row) {
        throw new AppError(404, "not_found", "Not found");
      }
      await client.query(
        `delete from organisation_transactional_email_template_attachments
          where id = $1 and organisation_id = $2`,
        [row.id, orgId],
      );
      const remaining = await client.query<{ n: string }>(
        `select count(*)::int as n
           from organisation_transactional_email_template_attachments
          where stored_object_id = $1`,
        [row.stored_object_id],
      );
      if (Number(remaining.rows[0]?.n ?? 0) === 0) {
        const object = await client.query<{ storage_key: string }>(
          `update stored_objects
              set status = 'deleted', deleted_at = now()
            where id = $1
              and organisation_id = $2
              and domain = 'transactional_email'
          returning storage_key`,
          [row.stored_object_id, orgId],
        );
        const storageKey = object.rows[0]?.storage_key;
        if (storageKey) {
          await storageOf(c).deleteObject(storageKey).catch(() => undefined);
        }
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "org.email_template.attachment_removed",
        entityType: "organisation_transactional_email_template_attachment",
        entityId: row.id,
        after: {
          templateKey: key,
          storedObjectId: row.stored_object_id,
          filename: row.display_filename,
        },
      });
      const item = automaticEmailCatalogItem(key);
      const wording = await loadStoredTemplateRow(client, orgId, key);
      const presentation = await loadTemplatePresentation(
        client,
        orgId,
        key,
        emailCapabilitiesFromRuntime(c.get("config").email),
      );
      return c.json({
        template: presentStoredTemplate(
          item,
          wording ?? item.defaults,
          wording?.updatedAt ?? null,
          Boolean(wording),
          presentation,
        ),
      });
    }),
  );
}

function requireCustomizableKey(value: string) {
  if (!isCustomizableEmailTemplateKey(value)) {
    throw new AppError(404, "not_found", "Not found");
  }
  return value;
}

type SqlClient = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

async function loadMailBranding(client: SqlClient, orgId: string) {
  const branding = await client.query<{
    organisation_name: string;
    primary_colour: string | null;
    has_logo: boolean;
    logo_version: string | null;
  }>("select * from get_public_school_branding($1)", [orgId]);
  const contact = await client.query<{ contact_email: string | null }>(
    "select contact_email from organisation_settings where organisation_id = $1",
    [orgId],
  );
  const row = branding.rows[0];
  return {
    schoolName: String(row?.organisation_name ?? "School"),
    primaryColor: row?.primary_colour ?? null,
    logoUrl: row?.has_logo ? publicBrandingAssetUrl("logo", row.logo_version) : null,
    schoolContactEmail: contact.rows[0]?.contact_email ?? null,
  };
}

async function loadStoredTemplateRow(client: SqlClient, orgId: string, key: string) {
  const stored = await client.query<{
    template_key: string;
    enabled: boolean;
    subject: string;
    heading: string;
    greeting: string;
    body_text: string;
    signoff: string;
    updated_at: string;
  }>(
    `select template_key, enabled, subject, heading, greeting, body_text, signoff, updated_at
       from organisation_transactional_email_templates
      where organisation_id = $1 and template_key = $2`,
    [orgId, key],
  );
  const row = stored.rows[0];
  if (!row || !isCustomizableEmailTemplateKey(row.template_key)) return null;
  return {
    templateKey: row.template_key,
    enabled: row.enabled,
    subject: row.subject,
    heading: row.heading,
    greeting: row.greeting,
    body: row.body_text,
    signoff: row.signoff,
    updatedAt: row.updated_at,
  };
}

async function loadStoredTemplate(client: SqlClient, orgId: string, key: string) {
  const row = await loadStoredTemplateRow(client, orgId, key);
  if (!row) return null;
  return {
    templateKey: row.templateKey,
    enabled: row.enabled,
    subject: row.subject,
    heading: row.heading,
    greeting: row.greeting,
    body: row.body,
    signoff: row.signoff,
  };
}

function presentStoredTemplate(
  item: (typeof AUTOMATIC_EMAIL_TEMPLATE_CATALOG)[number],
  current: {
    templateKey: string;
    enabled: boolean;
    subject: string;
    heading: string;
    greeting: string;
    body: string;
    signoff: string;
  },
  updatedAt: string | null,
  customised: boolean,
  presentation: {
    showSchoolLogo: boolean;
    sendEnabled: boolean;
    attachments: Awaited<ReturnType<typeof loadAutomaticEmailAttachmentViews>>;
    attachmentLimits: Awaited<ReturnType<typeof loadPlatformEmailAttachmentLimits>>;
    capabilities: ReturnType<typeof emailCapabilitiesFromRuntime>;
  },
) {
  const limits = presentPlatformEmailAttachmentLimits(
    presentation.attachmentLimits,
    presentation.capabilities,
  );
  return {
    key: item.key,
    name: item.name,
    description: item.description,
    kind: item.kind,
    enabled: current.enabled,
    sendEnabled: presentation.sendEnabled,
    source: customised && current.enabled ? "custom" : "system",
    customised,
    updatedAt,
    subject: current.subject,
    heading: current.heading,
    greeting: current.greeting,
    body: current.body,
    signoff: current.signoff,
    defaults: item.defaults,
    availableFields: item.mergeFields,
    showSchoolLogo: presentation.showSchoolLogo,
    attachmentLimits: limits,
    attachments: presentation.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      byteSize: attachment.byteSize,
      kindLabel: attachment.kindLabel,
      sizeLabel: attachment.sizeLabel,
      overLimit: attachment.overLimit,
      overLimitReason: attachment.overLimitReason,
    })),
  };
}

async function loadTemplatePresentation(
  client: SqlClient,
  orgId: string,
  key: Parameters<typeof loadAutomaticEmailAttachmentViews>[2],
  capabilities: ReturnType<typeof emailCapabilitiesFromRuntime>,
) {
  const attachmentLimits = await loadPlatformEmailAttachmentLimits(client, capabilities);
  const settings = await loadAutomaticEmailSettings(client, orgId, key);
  return {
    showSchoolLogo: settings.showSchoolLogo,
    sendEnabled: resolveAutomaticEmailSendEnabled(key, settings.sendEnabled),
    attachments: await loadAutomaticEmailAttachmentViews(client, orgId, key, attachmentLimits, capabilities),
    attachmentLimits,
    capabilities,
  };
}

async function upsertEmailTemplateSettings(
  client: SqlClient,
  orgId: string,
  key: string,
  userId: string,
  showSchoolLogo?: boolean,
  sendEnabled?: boolean,
): Promise<string> {
  const saved = await client.query<{ id: string }>(
    `insert into organisation_transactional_email_settings (
       organisation_id, template_key, show_school_logo, send_enabled, updated_by_user_id
     ) values ($1, $2, coalesce($3, true), coalesce($4, false), $5)
     on conflict (organisation_id, template_key) do update set
       show_school_logo = coalesce($3, organisation_transactional_email_settings.show_school_logo),
       send_enabled = coalesce($4, organisation_transactional_email_settings.send_enabled),
       updated_by_user_id = excluded.updated_by_user_id
     returning id`,
    [orgId, key, showSchoolLogo ?? null, sendEnabled ?? null, userId],
  );
  return saved.rows[0]!.id;
}

function brandingVersionFromId(id: unknown): string | null {
  if (typeof id !== "string" || !id) return null;
  const compact = id.replace(/-/g, "");
  return compact.slice(0, 16) || null;
}

function mapSchoolProfile(row: Record<string, unknown>) {
  const hasLogo = Boolean(row.logo_object_id);
  const hasHero = Boolean(row.hero_object_id);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    legalName: row.legal_name,
    schoolCode: row.school_code,
    timezone: row.timezone,
    countryCode: row.country_code,
    status: row.status,
    locale: row.locale,
    defaultCurrency: row.default_currency ?? "GBP",
    contactTelephone: row.contact_telephone,
    contactEmail: row.contact_email,
    website: row.website,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2,
    city: row.city,
    postcode: row.postcode,
    branding: {
      tagline: row.tagline,
      primaryColor: row.primary_colour ?? DEFAULT_BRAND_PRIMARY,
      accentColor: row.accent_colour ?? DEFAULT_BRAND_ACCENT,
      ...publicBrandingUrls(hasLogo, hasHero, {
        logo: brandingVersionFromId(row.logo_object_id),
        hero: brandingVersionFromId(row.hero_object_id),
      }),
    },
  };
}

async function loadReadinessCounts(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  orgId: string,
) {
  const q = async (sql: string) => {
    const result = await client.query(sql, [orgId]);
    return Number(result.rows[0]?.n ?? 0);
  };
  const org = await client.query(
    `select o.name, o.timezone, s.tagline, s.primary_colour, s.logo_object_id
     from organisations o
     join organisation_settings s on s.organisation_id = o.id
     where o.id = $1`,
    [orgId],
  );
  const row = org.rows[0] ?? {};
  const statutory = await client.query(
    `select 1 as n from organisation_statutory_profiles where organisation_id = $1 limit 1`,
    [orgId],
  );
  const portal = await client.query(
    `select 1 as n from student_portal_policies where organisation_id = $1 limit 1`,
    [orgId],
  );
  return {
    schoolName: String(row.name ?? "").trim(),
    hasName: Boolean(String(row.name ?? "").trim()),
    hasTimezone: Boolean(String(row.timezone ?? "").trim()),
    academicYears: await q(
      "select count(*)::int as n from academic_years where organisation_id = $1 and status = 'active'",
    ),
    terms: await q("select count(*)::int as n from terms where organisation_id = $1"),
    yearGroups: await q(
      "select count(*)::int as n from year_groups where organisation_id = $1 and status = 'active'",
    ),
    classes: await q("select count(*)::int as n from classes where organisation_id = $1 and status = 'active'"),
    subjects: await q("select count(*)::int as n from subjects where organisation_id = $1 and status = 'active'"),
    schoolDayProfiles: await q(
      "select count(*)::int as n from school_day_profiles where organisation_id = $1",
    ),
    rooms: await q("select count(*)::int as n from rooms where organisation_id = $1"),
    staff: await q("select count(*)::int as n from staff_profiles where organisation_id = $1"),
    pupils: await q("select count(*)::int as n from student_profiles where organisation_id = $1"),
    parentAccounts: await q(
      `select count(distinct guardian_user_id)::int as n
       from guardianships where organisation_id = $1 and (ended_on is null or ended_on >= current_date)`,
    ),
    studentPortalConfigured: Boolean(portal.rows[0]),
    timetableEntries: await q("select count(*)::int as n from timetable_entries where organisation_id = $1"),
    statutoryProfile: Boolean(statutory.rows[0]),
    hasBranding: Boolean(row.tagline || row.primary_colour || row.logo_object_id),
  };
}

async function loadAutomaticOnboardingDismissed(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  orgId: string,
  userId: string,
): Promise<boolean> {
  const result = await client.query(
    `select automatic_onboarding_dismissed_at
     from organisation_onboarding_preferences
     where organisation_id = $1 and user_id = $2`,
    [orgId, userId],
  );
  return Boolean(result.rows[0]?.automatic_onboarding_dismissed_at);
}

export { pgErrorToAppError };
