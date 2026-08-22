import type pg from "pg";
import { z } from "zod";
import {
  ADMISSIONS_DOCUMENT_PURPOSES,
  ADMISSIONS_FORM_TYPES,
  ADMISSIONS_QUESTION_TYPES,
} from "@schoolapp/domain";
import {
  AppError,
  auditSafeFormAfter,
  buildEmbedCode,
  buildPublicFormUrl,
  canManageAdmissionsCampaigns,
  canManageAdmissionsForms,
  canReadAdmissionsCampaigns,
  canReadAdmissionsForms,
  canReadPublicSubmissions,
  defaultFormTemplate,
  isCanonicalFieldKey,
  normalizeCampaignCode,
  normalizeCustomFieldKey,
  normalizeFormSlug,
  publicFormEmbedPath,
  publicFormPath,
  qrSvg,
  sanitizeHelperText,
  sanitizePlainText,
  writeAudit,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import { mapAdmissionsCampaign, mapAdmissionsForm, mapFormSubmission } from "../serialize";

const formSchema = z.object({
  formType: z.enum(ADMISSIONS_FORM_TYPES),
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(80).optional(),
  description: z.string().max(2000).optional(),
  successTitle: z.string().max(120).optional(),
  successText: z.string().max(4000).optional(),
  privacyNoticeUrl: z.string().max(2000).optional(),
  privacyNoticeText: z.string().max(8000).optional(),
  opensAt: z.string().datetime().optional().nullable(),
  closesAt: z.string().datetime().optional().nullable(),
  allowedAcademicYearIds: z.array(z.string().uuid()).optional(),
  allowedYearGroupIds: z.array(z.string().uuid()).optional(),
});

const fieldSchema = z.object({
  fieldKey: z.string().min(1).max(80).optional(),
  fieldKind: z.enum(["canonical", "custom"]),
  canonicalKey: z.string().max(80).optional().nullable(),
  questionType: z.enum(ADMISSIONS_QUESTION_TYPES),
  label: z.string().min(1).max(200),
  helperText: z.string().max(2000).optional().nullable(),
  required: z.boolean().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  options: z.array(z.object({ value: z.string().min(1).max(80), label: z.string().min(1).max(120) })).optional(),
  documentPurpose: z.enum(ADMISSIONS_DOCUMENT_PURPOSES).optional().nullable(),
});

const sectionSchema = z.object({
  sectionKey: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  helperText: z.string().max(2000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
  fields: z.array(fieldSchema),
});

const campaignSchema = z.object({
  publicCode: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  enabled: z.boolean().optional(),
});

const FORM_SQL = `
  select f.*,
         (select count(*)::int from admissions_form_submissions s
           where s.form_id = f.id and s.organisation_id = f.organisation_id) as submissions_count
  from admissions_forms f
  where f.organisation_id = $1
`;

async function loadForm(client: pg.PoolClient, orgId: string, id: string) {
  const listed = await client.query(`${FORM_SQL} and f.id = $2`, [orgId, id]);
  if (!listed.rows[0]) throw new AppError(404, "not_found", "Not found");
  return listed.rows[0] as Record<string, unknown>;
}

async function replaceFormDefinition(
  client: pg.PoolClient,
  orgId: string,
  formId: string,
  sections: z.infer<typeof sectionSchema>[],
) {
  await client.query("delete from admissions_form_sections where form_id = $1 and organisation_id = $2", [
    formId,
    orgId,
  ]);
  for (const [sectionIndex, section] of sections.entries()) {
    const sectionKey = sanitizePlainText(section.sectionKey, 80).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    const inserted = await client.query<{ id: string }>(
      `insert into admissions_form_sections (
         organisation_id, form_id, section_key, title, helper_text, sort_order, enabled
       ) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        orgId,
        formId,
        sectionKey,
        sanitizePlainText(section.title, 120),
        sanitizeHelperText(section.helperText, 2000) || null,
        section.sortOrder ?? sectionIndex,
        section.enabled ?? true,
      ],
    );
    for (const [fieldIndex, field] of section.fields.entries()) {
      const canonical = field.canonicalKey && isCanonicalFieldKey(field.canonicalKey) ? field.canonicalKey : null;
      const fieldKey =
        field.fieldKind === "canonical" && canonical
          ? canonical
          : normalizeCustomFieldKey(field.fieldKey ?? field.label);
      await client.query(
        `insert into admissions_form_fields (
           organisation_id, form_id, section_id, field_key, field_kind, canonical_key,
           question_type, label, helper_text, required, enabled, sort_order, options, document_purpose
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
        [
          orgId,
          formId,
          inserted.rows[0]!.id,
          fieldKey,
          field.fieldKind,
          canonical,
          field.questionType,
          sanitizePlainText(field.label, 200),
          sanitizeHelperText(field.helperText, 2000) || null,
          field.required ?? false,
          field.enabled ?? true,
          field.sortOrder ?? fieldIndex,
          JSON.stringify(
            (field.options ?? []).map((option) => ({
              value: sanitizePlainText(option.value, 80),
              label: sanitizePlainText(option.label, 120),
            })),
          ),
          field.documentPurpose ?? null,
        ],
      );
    }
  }
}

async function insertTemplate(
  client: pg.PoolClient,
  orgId: string,
  formId: string,
  formType: z.infer<typeof formSchema>["formType"],
) {
  const template = defaultFormTemplate(formType);
  await replaceFormDefinition(
    client,
    orgId,
    formId,
    template.map((section) => ({
      sectionKey: section.sectionKey,
      title: section.title,
      helperText: section.helperText,
      sortOrder: section.sortOrder,
      enabled: section.enabled,
      fields: section.fields.map((field) => ({
        fieldKey: field.fieldKey,
        fieldKind: field.fieldKind,
        canonicalKey: field.canonicalKey,
        questionType: field.questionType,
        label: field.label,
        helperText: field.helperText,
        required: field.required,
        enabled: field.enabled,
        sortOrder: field.sortOrder,
        options: field.options,
        documentPurpose: field.documentPurpose,
      })),
    })),
  );
}

async function loadDefinition(client: pg.PoolClient, orgId: string, formId: string) {
  const sections = await client.query(
    `select id, section_key, title, helper_text, sort_order, enabled
     from admissions_form_sections
     where form_id = $1 and organisation_id = $2
     order by sort_order, title`,
    [formId, orgId],
  );
  const fields = await client.query(
    `select id, section_id, field_key, field_kind, canonical_key, question_type, label, helper_text,
            required, enabled, sort_order, options, document_purpose
     from admissions_form_fields
     where form_id = $1 and organisation_id = $2
     order by sort_order, label`,
    [formId, orgId],
  );
  return sections.rows.map((section) => ({
    id: section.id,
    sectionKey: section.section_key,
    title: section.title,
    helperText: section.helper_text,
    sortOrder: section.sort_order,
    enabled: section.enabled,
    fields: fields.rows
      .filter((field) => field.section_id === section.id)
      .map((field) => ({
        id: field.id,
        fieldKey: field.field_key,
        fieldKind: field.field_kind,
        canonicalKey: field.canonical_key,
        questionType: field.question_type,
        label: field.label,
        helperText: field.helper_text,
        required: field.required,
        enabled: field.enabled,
        sortOrder: field.sort_order,
        options: field.options,
        documentPurpose: field.document_purpose,
      })),
  }));
}

function sharePayload(
  form: Record<string, unknown>,
  host: { hostname: string; port: string | null; slug: string },
  platformDomain: string,
) {
  const formType = String(form.form_type) as (typeof ADMISSIONS_FORM_TYPES)[number];
  const slug = String(form.slug);
  const publicUrl = buildPublicFormUrl({
    slug,
    formType,
    schoolSlug: host.slug,
    platformDomain,
    hostname: host.hostname,
    port: host.port,
    protocol: platformDomain === "localhost" ? "http" : "https",
  });
  const embedUrl = publicUrl.replace(publicFormPath(formType, slug), publicFormEmbedPath(formType, slug));
  return {
    publicUrl,
    embedUrl,
    publicPath: publicFormPath(formType, slug),
    embedCode: buildEmbedCode(embedUrl, `${form.name} form`),
  };
}

export function registerAdmissionsFormRoutes(app: SchoolappApi) {
  app.get("/admissions/forms", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadAdmissionsForms(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const rows = await client.query(`${FORM_SQL} order by f.updated_at desc`, [orgId]);
      return c.json({ forms: rows.rows.map(mapAdmissionsForm) });
    }),
  );

  app.post("/admissions/forms", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageAdmissionsForms(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = formSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid form payload");
      const slug = normalizeFormSlug(parsed.data.slug ?? parsed.data.name);
      const inserted = await client.query<{ id: string }>(
        `insert into admissions_forms (
           organisation_id, slug, form_type, name, description, success_title, success_text,
           privacy_notice_url, privacy_notice_text, opens_at, closes_at,
           allowed_academic_year_ids, allowed_year_group_ids, created_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         returning id`,
        [
          orgId,
          slug,
          parsed.data.formType,
          sanitizePlainText(parsed.data.name, 120),
          sanitizeHelperText(parsed.data.description, 2000) || null,
          sanitizePlainText(parsed.data.successTitle ?? "Thank you", 120),
          sanitizeHelperText(parsed.data.successText ?? "We have received your submission.", 4000),
          parsed.data.privacyNoticeUrl ? sanitizePlainText(parsed.data.privacyNoticeUrl, 2000) : null,
          sanitizeHelperText(parsed.data.privacyNoticeText, 8000) || null,
          parsed.data.opensAt ?? null,
          parsed.data.closesAt ?? null,
          parsed.data.allowedAcademicYearIds ?? [],
          parsed.data.allowedYearGroupIds ?? [],
          userId,
        ],
      );
      await insertTemplate(client, orgId, inserted.rows[0]!.id, parsed.data.formType);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.form.created",
        entityType: "admissions_form",
        entityId: inserted.rows[0]!.id,
        after: auditSafeFormAfter({
          formId: inserted.rows[0]!.id,
          formType: parsed.data.formType,
          slug,
        }),
      });
      const form = await loadForm(client, orgId, inserted.rows[0]!.id);
      return c.json({ form: mapAdmissionsForm(form), sections: await loadDefinition(client, orgId, form.id as string) }, 201);
    }),
  );

  app.get("/admissions/forms/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadAdmissionsForms(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const form = await loadForm(client, orgId, uuidRouteParam(c, "id"));
      return c.json({ form: mapAdmissionsForm(form), sections: await loadDefinition(client, orgId, String(form.id)) });
    }),
  );

  app.patch("/admissions/forms/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageAdmissionsForms(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      const parsed = formSchema.partial().safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid form payload");
      const current = await loadForm(client, orgId, id);
      const slug = parsed.data.slug ? normalizeFormSlug(parsed.data.slug) : String(current.slug);
      await client.query(
        `update admissions_forms
         set slug = $3,
             form_type = coalesce($4, form_type),
             name = coalesce($5, name),
             description = coalesce($6, description),
             success_title = coalesce($7, success_title),
             success_text = coalesce($8, success_text),
             privacy_notice_url = coalesce($9, privacy_notice_url),
             privacy_notice_text = coalesce($10, privacy_notice_text),
             opens_at = coalesce($11, opens_at),
             closes_at = coalesce($12, closes_at),
             allowed_academic_year_ids = coalesce($13, allowed_academic_year_ids),
             allowed_year_group_ids = coalesce($14, allowed_year_group_ids)
         where id = $1 and organisation_id = $2`,
        [
          id,
          orgId,
          slug,
          parsed.data.formType ?? null,
          parsed.data.name ? sanitizePlainText(parsed.data.name, 120) : null,
          parsed.data.description != null ? sanitizeHelperText(parsed.data.description, 2000) : null,
          parsed.data.successTitle ? sanitizePlainText(parsed.data.successTitle, 120) : null,
          parsed.data.successText != null ? sanitizeHelperText(parsed.data.successText, 4000) : null,
          parsed.data.privacyNoticeUrl != null ? sanitizePlainText(parsed.data.privacyNoticeUrl, 2000) : null,
          parsed.data.privacyNoticeText != null ? sanitizeHelperText(parsed.data.privacyNoticeText, 8000) : null,
          parsed.data.opensAt ?? null,
          parsed.data.closesAt ?? null,
          parsed.data.allowedAcademicYearIds ?? null,
          parsed.data.allowedYearGroupIds ?? null,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.form.changed",
        entityType: "admissions_form",
        entityId: id,
        after: auditSafeFormAfter({ formId: id, formType: String(parsed.data.formType ?? current.form_type), slug }),
      });
      const form = await loadForm(client, orgId, id);
      return c.json({ form: mapAdmissionsForm(form), sections: await loadDefinition(client, orgId, id) });
    }),
  );

  app.put("/admissions/forms/:id/definition", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageAdmissionsForms(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      await loadForm(client, orgId, id);
      const parsed = z.object({ sections: z.array(sectionSchema).min(1) }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid form definition");
      await replaceFormDefinition(client, orgId, id, parsed.data.sections);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.form.changed",
        entityType: "admissions_form",
        entityId: id,
        after: { formId: id, sections: parsed.data.sections.length },
      });
      return c.json({ form: mapAdmissionsForm(await loadForm(client, orgId, id)), sections: await loadDefinition(client, orgId, id) });
    }),
  );

  app.post("/admissions/forms/:id/publish", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageAdmissionsForms(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      const fields = await client.query(
        `select count(*)::int as n from admissions_form_fields
         where form_id = $1 and organisation_id = $2 and enabled`,
        [id, orgId],
      );
      if (!fields.rows[0]?.n) throw new AppError(400, "validation_failed", "Publish requires at least one enabled field");
      await client.query(
        `update admissions_forms
         set status = 'published', published_at = now(), unpublished_at = null
         where id = $1 and organisation_id = $2`,
        [id, orgId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.form.published",
        entityType: "admissions_form",
        entityId: id,
        after: { formId: id, status: "published" },
      });
      return c.json({ form: mapAdmissionsForm(await loadForm(client, orgId, id)) });
    }),
  );

  app.post("/admissions/forms/:id/unpublish", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageAdmissionsForms(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      await loadForm(client, orgId, id);
      await client.query(
        `update admissions_forms
         set status = 'unpublished', unpublished_at = now()
         where id = $1 and organisation_id = $2`,
        [id, orgId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.form.unpublished",
        entityType: "admissions_form",
        entityId: id,
        after: { formId: id, status: "unpublished" },
      });
      return c.json({ form: mapAdmissionsForm(await loadForm(client, orgId, id)) });
    }),
  );

  app.post("/admissions/forms/:id/duplicate", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageAdmissionsForms(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      const current = await loadForm(client, orgId, id);
      const slug = normalizeFormSlug(`${String(current.slug)}-copy`);
      const inserted = await client.query<{ id: string }>(
        `insert into admissions_forms (
           organisation_id, slug, form_type, name, description, success_title, success_text,
           privacy_notice_url, privacy_notice_text, allowed_academic_year_ids, allowed_year_group_ids,
           created_by, status
         )
         select organisation_id, $3, form_type, name || ' (copy)', description, success_title, success_text,
                privacy_notice_url, privacy_notice_text, allowed_academic_year_ids, allowed_year_group_ids,
                $4, 'draft'
         from admissions_forms where id = $1 and organisation_id = $2
         returning id`,
        [id, orgId, slug, userId],
      );
      const sections = await loadDefinition(client, orgId, id);
      await replaceFormDefinition(client, orgId, inserted.rows[0]!.id, sections);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.form.created",
        entityType: "admissions_form",
        entityId: inserted.rows[0]!.id,
        after: { duplicatedFrom: id, slug },
      });
      const form = await loadForm(client, orgId, inserted.rows[0]!.id);
      return c.json({ form: mapAdmissionsForm(form), sections: await loadDefinition(client, orgId, String(form.id)) }, 201);
    }),
  );

  app.get("/admissions/forms/:id/share", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadAdmissionsForms(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const form = await loadForm(client, orgId, uuidRouteParam(c, "id"));
      const host = c.get("tenantHost");
      const schoolSlug = host.kind === "school" ? host.slug : String((await client.query<{ slug: string }>("select slug from organisations where id = $1", [orgId])).rows[0]?.slug ?? "school");
      const share = sharePayload(form, {
        hostname: host.kind === "school" ? host.hostname : schoolPublicFallback(schoolSlug, c.get("config").platformDomain),
        port: host.kind === "school" ? host.port : null,
        slug: schoolSlug,
      }, c.get("config").platformDomain);
      const svg = form.status === "published" ? await qrSvg(share.publicUrl) : null;
      return c.json({ ...share, qrSvg: svg, status: form.status });
    }),
  );

  app.get("/admissions/forms/:id/submissions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadPublicSubmissions(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      await loadForm(client, orgId, id);
      const rows = await client.query(
        `select s.id, s.public_id, s.form_id, f.name as form_name, s.form_type, s.completeness_status,
                s.enquiry_id, e.reference as enquiry_reference, s.application_id, a.reference as application_reference,
                s.campaign_id, c.label as campaign_label, s.source_code, s.submitted_at, s.created_at
         from admissions_form_submissions s
         join admissions_forms f on f.id = s.form_id
         left join admissions_enquiries e on e.id = s.enquiry_id
         left join admissions_applications a on a.id = s.application_id
         left join admissions_campaigns c on c.id = s.campaign_id
         where s.form_id = $1 and s.organisation_id = $2
         order by s.created_at desc`,
        [id, orgId],
      );
      return c.json({ submissions: rows.rows.map((row) => mapFormSubmission(row)) });
    }),
  );

  app.get("/admissions/form-submissions/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadPublicSubmissions(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      const row = await client.query(
        `select s.*, f.name as form_name, e.reference as enquiry_reference,
                a.reference as application_reference, c.label as campaign_label
         from admissions_form_submissions s
         join admissions_forms f on f.id = s.form_id
         left join admissions_enquiries e on e.id = s.enquiry_id
         left join admissions_applications a on a.id = s.application_id
         left join admissions_campaigns c on c.id = s.campaign_id
         where s.id = $1 and s.organisation_id = $2`,
        [id, orgId],
      );
      if (!row.rows[0]) throw new AppError(404, "not_found", "Not found");
      return c.json({ submission: mapFormSubmission(row.rows[0], { includeAnswers: true }) });
    }),
  );

  app.get("/admissions/campaigns", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadAdmissionsCampaigns(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const rows = await client.query(
        `select c.*,
                (select count(*)::int from admissions_form_submissions s
                  where s.campaign_id = c.id and s.organisation_id = c.organisation_id) as submissions_count
         from admissions_campaigns c
         where c.organisation_id = $1
         order by c.label`,
        [orgId],
      );
      return c.json({ campaigns: rows.rows.map(mapAdmissionsCampaign) });
    }),
  );

  app.post("/admissions/campaigns", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageAdmissionsCampaigns(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = campaignSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid campaign payload");
      const inserted = await client.query(
        `insert into admissions_campaigns (organisation_id, public_code, label, description, enabled)
         values ($1,$2,$3,$4,$5)
         returning *`,
        [
          orgId,
          normalizeCampaignCode(parsed.data.publicCode),
          sanitizePlainText(parsed.data.label, 80),
          sanitizeHelperText(parsed.data.description, 400) || null,
          parsed.data.enabled ?? true,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.campaign.created",
        entityType: "admissions_campaign",
        entityId: inserted.rows[0]!.id,
        after: { publicCode: inserted.rows[0]!.public_code },
      });
      return c.json({ campaign: mapAdmissionsCampaign(inserted.rows[0]!) }, 201);
    }),
  );

  app.patch("/admissions/campaigns/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageAdmissionsCampaigns(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      const parsed = campaignSchema.partial().safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid campaign payload");
      const updated = await client.query(
        `update admissions_campaigns
         set public_code = coalesce($3, public_code),
             label = coalesce($4, label),
             description = coalesce($5, description),
             enabled = coalesce($6, enabled)
         where id = $1 and organisation_id = $2
         returning *`,
        [
          id,
          orgId,
          parsed.data.publicCode ? normalizeCampaignCode(parsed.data.publicCode) : null,
          parsed.data.label ? sanitizePlainText(parsed.data.label, 80) : null,
          parsed.data.description != null ? sanitizeHelperText(parsed.data.description, 400) : null,
          parsed.data.enabled ?? null,
        ],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.campaign.updated",
        entityType: "admissions_campaign",
        entityId: id,
        after: { publicCode: updated.rows[0].public_code },
      });
      return c.json({ campaign: mapAdmissionsCampaign(updated.rows[0]) });
    }),
  );

  app.get("/admissions/sources", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canReadAdmissionsCampaigns(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const rows = await client.query(
        `select coalesce(c.label, s.source_code, 'unattributed') as label,
                coalesce(c.public_code, s.source_code) as code,
                count(*)::int as submissions
         from admissions_form_submissions s
         left join admissions_campaigns c on c.id = s.campaign_id
         where s.organisation_id = $1 and s.completeness_status <> 'draft'
         group by 1, 2
         order by submissions desc, label`,
        [orgId],
      );
      return c.json({ sources: rows.rows });
    }),
  );
}

function schoolPublicFallback(slug: string, platformDomain: string): string {
  return `${slug}.${platformDomain}`;
}
