import type { Context } from "hono";
import { z } from "zod";
import {
  AppError,
  assertNotRateLimited,
  assertPublicFormPayloadSize,
  computeCompleteness,
  createCaptchaFromEnv,
  createContinuationToken,
  declarationSnapshot,
  defaultPublicFormRateLimiter,
  hashClientIp,
  hashContinuationToken,
  trustedClientIp,
  isAdmissionsFormType,
  isAllowedAdmissionsUpload,
  mapAnswersToCanonical,
  pgErrorToAppError,
  publicFormRateLimitKey,
  sanitizePlainText,
  validatePublicAnswers,
  type FormFieldDefinition,
} from "@schoolapp/core";
import { defaultObjectStorage } from "@schoolapp/storage";
import type { ApiEnv, SchoolappApi } from "../types";
import { requestedOrganisationId } from "../auth-middleware";

const captcha = createCaptchaFromEnv();

function requireSchoolHostOrg(c: Context<ApiEnv>): {
  organisationId: string;
  slug: string;
  name: string;
  hostname: string;
  port: string | null;
} {
  const host = c.get("tenantHost");
  if (host.kind !== "school") {
    throw new AppError(404, "not_found", "Not found");
  }
  const header = requestedOrganisationId(c);
  if (header && header !== host.organisationId) {
    throw new AppError(403, "org_host_mismatch", "Organisation header does not match this school host");
  }
  return {
    organisationId: host.organisationId,
    slug: host.slug,
    name: host.name,
    hostname: host.hostname,
    port: host.port,
  };
}

function clientIp(c: Context<ApiEnv>): string | null {
  return trustedClientIp({
    trustProxy: c.get("config").trustProxy,
    forwardedFor: c.req.header("x-forwarded-for"),
    realIp: c.req.header("x-real-ip"),
  });
}

function mapPublicFields(payload: {
  sections?: Array<{ sectionKey?: string; fields?: Array<Record<string, unknown>> }>;
}): FormFieldDefinition[] {
  const fields: FormFieldDefinition[] = [];
  for (const section of payload.sections ?? []) {
    for (const field of section.fields ?? []) {
      fields.push({
        fieldKey: String(field.fieldKey),
        fieldKind: field.fieldKind === "canonical" ? "canonical" : "custom",
        canonicalKey: (field.canonicalKey as FormFieldDefinition["canonicalKey"]) ?? null,
        questionType: field.questionType as FormFieldDefinition["questionType"],
        label: String(field.label),
        helperText: field.helperText ? String(field.helperText) : null,
        required: Boolean(field.required),
        enabled: true,
        sortOrder: Number(field.sortOrder ?? 0),
        sectionKey: String(section.sectionKey ?? ""),
        options: Array.isArray(field.options) ? (field.options as FormFieldDefinition["options"]) : [],
        documentPurpose: (field.documentPurpose as FormFieldDefinition["documentPurpose"]) ?? null,
      });
    }
  }
  return fields;
}

const submitSchema = z.object({
  answers: z.record(z.unknown()),
  source: z.string().max(80).optional(),
  campaignCode: z.string().max(80).optional(),
  continuationToken: z.string().max(200).optional(),
  publicId: z.string().uuid().optional(),
  idempotencyKey: z.string().max(120).optional(),
  captchaToken: z.string().max(4000).optional(),
  draft: z.boolean().optional(),
});

export function registerPublicFormRoutes(app: SchoolappApi) {
  app.get("/public/admissions/forms/:formType/:slug", async (c) => {
    const school = requireSchoolHostOrg(c);
    const formType = c.req.param("formType") ?? "";
    const slug = c.req.param("slug") ?? "";
    if (!isAdmissionsFormType(formType)) throw new AppError(404, "not_found", "Not found");
    const ipHash = hashClientIp(clientIp(c));
    assertNotRateLimited(
      defaultPublicFormRateLimiter.consume(
        publicFormRateLimitKey({ organisationId: school.organisationId, formId: `${formType}:${slug}`, ipHash, action: "read" }),
        60,
        60_000,
      ),
    );
    try {
      const result = await c.get("config").pools.app.query<{ get_published_admissions_form: unknown }>(
        "select get_published_admissions_form($1, $2, $3)",
        [school.organisationId, formType, slug],
      );
      const payload = result.rows[0]?.get_published_admissions_form;
      if (!payload) throw new AppError(404, "not_found", "Not found");
      return c.json(payload);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.get("/public/admissions/forms/:formType/:slug/draft", async (c) => {
    const school = requireSchoolHostOrg(c);
    const formType = c.req.param("formType") ?? "";
    const slug = c.req.param("slug") ?? "";
    const token = c.req.query("token") ?? "";
    if (!isAdmissionsFormType(formType) || !token) throw new AppError(404, "not_found", "Not found");
    try {
      const result = await c.get("config").pools.app.query<{ get_public_admissions_draft: unknown }>(
        "select get_public_admissions_draft($1, $2, $3, $4)",
        [school.organisationId, formType, slug, hashContinuationToken(token)],
      );
      return c.json(result.rows[0]?.get_public_admissions_draft ?? {});
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.post("/public/admissions/forms/:formType/:slug/submissions", async (c) => {
    const school = requireSchoolHostOrg(c);
    const formType = c.req.param("formType") ?? "";
    const slug = c.req.param("slug") ?? "";
    if (!isAdmissionsFormType(formType)) throw new AppError(404, "not_found", "Not found");

    const raw = await c.req.text();
    assertPublicFormPayloadSize({ contentLength: c.req.header("content-length"), bodyText: raw });
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new AppError(400, "validation_failed", "Invalid JSON");
    }
    const parsed = submitSchema.safeParse(json);
    if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid submission payload");

    const ipHash = hashClientIp(clientIp(c));
    assertNotRateLimited(
      defaultPublicFormRateLimiter.consume(
        publicFormRateLimitKey({
          organisationId: school.organisationId,
          formId: `${formType}:${slug}`,
          ipHash,
          action: parsed.data.draft ? "draft" : "submit",
        }),
        parsed.data.draft ? 20 : 8,
        10 * 60_000,
      ),
    );
    if (captcha.isRequired()) {
      const ok = await captcha.verify({ token: parsed.data.captchaToken, remoteIp: clientIp(c), action: "admissions_form" });
      if (!ok) throw new AppError(400, "validation_failed", "Bot protection check failed");
    }

    try {
      const published = await c.get("config").pools.app.query<{ get_published_admissions_form: Record<string, unknown> }>(
        "select get_published_admissions_form($1, $2, $3)",
        [school.organisationId, formType, slug],
      );
      const definition = published.rows[0]?.get_published_admissions_form;
      if (!definition) throw new AppError(404, "not_found", "Not found");
      const fields = mapPublicFields(definition as { sections?: Array<{ fields?: Array<Record<string, unknown>> }> });
      const answers = validatePublicAnswers(fields, parsed.data.answers, { draft: parsed.data.draft });
      const canonical = mapAnswersToCanonical(fields, answers);
      const completeness = computeCompleteness({ draft: Boolean(parsed.data.draft), fields, answers });
      const formMeta = definition.form as Record<string, unknown>;
      const declaration = parsed.data.draft
        ? null
        : declarationSnapshot({
            fields,
            answers,
            privacyNoticeText: formMeta.privacyNoticeText ? String(formMeta.privacyNoticeText) : null,
            privacyNoticeUrl: formMeta.privacyNoticeUrl ? String(formMeta.privacyNoticeUrl) : null,
          });

      let tokenHash = parsed.data.continuationToken ? hashContinuationToken(parsed.data.continuationToken) : null;
      let issuedToken: string | undefined;
      if (parsed.data.draft && !tokenHash) {
        const created = createContinuationToken();
        tokenHash = created.hash;
        issuedToken = created.token;
      }

      const submitted = await c.get("config").pools.app.query<{ submit_public_admissions_form: Record<string, unknown> }>(
        `select submit_public_admissions_form(
           $1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14
         )`,
        [
          school.organisationId,
          formType,
          slug,
          JSON.stringify(answers),
          JSON.stringify(canonical),
          declaration ? JSON.stringify(declaration) : null,
          parsed.data.campaignCode ? sanitizePlainText(parsed.data.campaignCode, 80).toLowerCase() : parsed.data.source ?? null,
          parsed.data.source ? sanitizePlainText(parsed.data.source, 80).toLowerCase() : null,
          Boolean(parsed.data.draft),
          tokenHash,
          parsed.data.publicId ?? null,
          ipHash,
          parsed.data.idempotencyKey ? hashContinuationToken(parsed.data.idempotencyKey) : null,
          completeness,
        ],
      );
      const result = submitted.rows[0]!.submit_public_admissions_form;
      return c.json(
        {
          submission: {
            publicId: result.publicId,
            completeness: result.completeness,
            formType: result.formType,
            enquiryReference: result.enquiryReference ?? null,
            applicationReference: result.applicationReference ?? null,
            continuationToken: issuedToken ?? (parsed.data.draft ? parsed.data.continuationToken : undefined) ?? null,
          },
        },
        parsed.data.draft ? 200 : 201,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw pgErrorToAppError(error) ?? error;
    }
  });

  app.post("/public/admissions/forms/:formType/:slug/documents", async (c) => {
    const school = requireSchoolHostOrg(c);
    const formType = c.req.param("formType") ?? "";
    const slug = c.req.param("slug") ?? "";
    if (!isAdmissionsFormType(formType)) throw new AppError(404, "not_found", "Not found");
    const raw = await c.req.text();
    assertPublicFormPayloadSize({ contentLength: c.req.header("content-length"), bodyText: raw, maxBytes: 16 * 1024 });
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new AppError(400, "validation_failed", "Invalid JSON");
    }
    const parsed = z
      .object({
        continuationToken: z.string().min(16).max(200),
        publicId: z.string().uuid(),
        fieldKey: z.string().min(1).max(80),
        filename: z.string().min(1).max(120),
        contentType: z.string().min(1).max(120),
        byteSize: z.number().int().positive(),
      })
      .safeParse(json);
    if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid document payload");
    if (!isAllowedAdmissionsUpload(parsed.data)) {
      throw new AppError(400, "validation_failed", "File type or size is not allowed");
    }

    const ipHash = hashClientIp(clientIp(c));
    assertNotRateLimited(
      defaultPublicFormRateLimiter.consume(
        publicFormRateLimitKey({
          organisationId: school.organisationId,
          formId: `${formType}:${slug}`,
          ipHash,
          action: "document",
        }),
        20,
        10 * 60_000,
      ),
    );

    try {
      const inserted = await c.get("config").pools.app.query<{ register_public_form_document: { id: string; submissionId: string; storageKey: string } }>(
        `select register_public_form_document($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          school.organisationId,
          formType,
          slug,
          hashContinuationToken(parsed.data.continuationToken),
          parsed.data.publicId,
          parsed.data.fieldKey,
          parsed.data.filename,
          parsed.data.contentType,
          parsed.data.byteSize,
          "",
          defaultObjectStorage.backend,
        ],
      );
      const registered = inserted.rows[0]!.register_public_form_document;
      return c.json({
        document: {
          id: registered.id,
          storageKey: registered.storageKey,
          binaryUploadAvailable: defaultObjectStorage.isConfigured(),
        },
      }, 201);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw pgErrorToAppError(error) ?? error;
    }
  });
}
