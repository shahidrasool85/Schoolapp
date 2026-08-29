import { z } from "zod";
import {
  DEFAULT_BRAND_ACCENT,
  DEFAULT_BRAND_PRIMARY,
  HEX_COLOR_PATTERN,
  ONBOARDING_STEPS,
  PERMISSIONS,
  publicBrandingAssetUrl,
  isOnboardingStep,
} from "@schoolapp/domain";
import {
  AppError,
  assertAnyPermission,
  assertPermission,
  evaluateReadiness,
  isIsoCurrency,
  presentSchoolOnboarding,
  pgErrorToAppError,
  writeAudit,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { withSchoolActor } from "../school-context";
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
      assertAnyPermission(actor, [PERMISSIONS.ORG_SETTINGS_READ, PERMISSIONS.ONBOARDING_READ]);
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
        `select id, purpose, to_email, to_name, subject, body_text, created_at
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
          toEmail: row.to_email,
          toName: row.to_name,
          subject: row.subject,
          bodyText: row.body_text,
          createdAt: row.created_at,
        })),
      });
    }),
  );
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
    academicYears: await q("select count(*)::int as n from academic_years where organisation_id = $1"),
    terms: await q("select count(*)::int as n from terms where organisation_id = $1"),
    yearGroups: await q("select count(*)::int as n from year_groups where organisation_id = $1"),
    classes: await q("select count(*)::int as n from classes where organisation_id = $1"),
    subjects: await q("select count(*)::int as n from subjects where organisation_id = $1"),
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
