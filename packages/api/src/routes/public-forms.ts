import type { Context } from "hono";
import { z } from "zod";
import {
  AppError,
  assertNotRateLimited,
  assertPublicFormPayloadSize,
  computeCompleteness,
  createCaptchaFromEnv,
  createContinuationToken,
  createPublicSubmissionConfirmationToken,
  declarationSnapshot,
  defaultPublicFormRateLimiter,
  hashClientIp,
  hashContinuationToken,
  PUBLIC_SUBMISSION_CONFIRMATION_TTL_MS,
  trustedClientIp,
  isAdmissionsFormType,
  mapAnswersToCanonical,
  pgErrorToAppError,
  publicFormRateLimitKey,
  sanitizePlainText,
  validatePublicAnswers,
  verifyPublicSubmissionConfirmationToken,
  type CanonicalSnapshot,
  type FormFieldDefinition,
} from "@schoolapp/core";
import type { ApiEnv, SchoolappApi } from "../types";
import { requestedOrganisationId } from "../auth-middleware";
import { queueAdmissionsFormAck, childDisplayName } from "../admissions-mail";
import { presentPublicSubmissionConfirmation, loadPublicSubmissionConfirmationRecord } from "../admissions-submission-confirmations";
import {
  readUploadedFile,
  scannerOf,
  storageErrorToAppError,
  storageOf,
  validateBytes,
  assertPublicFormFileAnswers,
} from "../file-service";

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

function emptyToUndefined(value: unknown) {
  return value === "" || value === null ? undefined : value;
}

const submitSchema = z.object({
  answers: z.record(z.unknown()),
  source: z.preprocess(emptyToUndefined, z.string().max(80).optional()),
  campaignCode: z.preprocess(emptyToUndefined, z.string().max(80).optional()),
  continuationToken: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
  publicId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  idempotencyKey: z.preprocess(emptyToUndefined, z.string().max(120).optional()),
  captchaToken: z.preprocess(emptyToUndefined, z.string().max(4000).optional()),
  draft: z.boolean().optional(),
});

function publicSubmitSchemaError(error: z.ZodError): AppError {
  const key = String(error.issues[0]?.path[0] ?? "");
  if (key === "answers") {
    return new AppError(400, "validation_failed", "The form answers could not be read");
  }
  if (key === "publicId" || key === "continuationToken") {
    return new AppError(
      400,
      "validation_failed",
      "This saved draft could not be continued. Start the form again or use the continuation link.",
    );
  }
  if (key === "idempotencyKey") {
    return new AppError(400, "validation_failed", "The submission could not be verified. Please try again.");
  }
  return new AppError(400, "validation_failed", "The submission could not be read");
}

function publicFormPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const payload = raw as Record<string, unknown>;
  const org = payload.organisation;
  if (!org || typeof org !== "object" || Array.isArray(org)) return payload;
  const { id: _id, ...safeOrg } = org as Record<string, unknown>;
  void _id;
  return { ...payload, organisation: safeOrg };
}

function isReplayedSubmission(result: Record<string, unknown>): boolean {
  return result.replayed === true || result.replayed === "true";
}

function issueConfirmationToken(
  secret: string,
  organisationId: string,
  formType: string,
  slug: string,
  result: Record<string, unknown>,
): string | null {
  const publicId = typeof result.publicId === "string" ? result.publicId : "";
  if (!secret || !publicId) return null;
  const submittedAtMs = result.submittedAt ? Date.parse(String(result.submittedAt)) : Date.now();
  const issuedAt = Number.isFinite(submittedAtMs) ? submittedAtMs : Date.now();
  return createPublicSubmissionConfirmationToken(secret, {
    organisationId,
    publicId,
    formType,
    slug,
    expiresAt: Math.floor((issuedAt + PUBLIC_SUBMISSION_CONFIRMATION_TTL_MS) / 1000),
  });
}

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
      const payload = publicFormPayload(result.rows[0]?.get_published_admissions_form);
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

  app.get("/public/admissions/forms/:formType/:slug/confirmation/:token", async (c) => {
    const school = requireSchoolHostOrg(c);
    const formType = c.req.param("formType") ?? "";
    const slug = c.req.param("slug") ?? "";
    const token = c.req.param("token") ?? "";
    if (!isAdmissionsFormType(formType) || !token) {
      throw new AppError(404, "not_found", "This confirmation is no longer available");
    }
    const ipHash = hashClientIp(clientIp(c));
    assertNotRateLimited(
      defaultPublicFormRateLimiter.consume(
        publicFormRateLimitKey({ organisationId: school.organisationId, formId: `${formType}:${slug}`, ipHash, action: "read" }),
        60,
        60_000,
      ),
    );
    const verified = verifyPublicSubmissionConfirmationToken(c.get("config").authSecret, token);
    if (!verified.ok) {
      throw new AppError(404, "not_found", "This confirmation is no longer available");
    }
    if (
      verified.claims.organisationId !== school.organisationId ||
      verified.claims.formType !== formType ||
      verified.claims.slug !== slug
    ) {
      throw new AppError(404, "not_found", "This confirmation is no longer available");
    }
    const record = await loadPublicSubmissionConfirmationRecord(
      c.get("config").pools.app,
      school.organisationId,
      formType,
      slug,
      verified.claims.publicId,
    );
    if (!record) {
      throw new AppError(404, "not_found", "This confirmation is no longer available");
    }
    const confirmation = await presentPublicSubmissionConfirmation({
      pool: c.get("config").pools.app,
      organisationId: school.organisationId,
      organisationName: school.name,
      formType,
      result: {
        enquiryReference: record.enquiryReference,
        applicationReference: record.applicationReference,
      },
      childName: record.childFirstName,
      formSuccessTitle: record.formSuccessTitle,
      formSuccessText: record.formSuccessText,
    });
    return c.json({
      confirmation,
      organisation: { name: record.organisation.name },
      branding: {
        primaryColor: record.branding.primaryColor ?? undefined,
        tagline: record.branding.tagline ?? undefined,
        hasLogo: record.branding.hasLogo,
        logoUrl: record.branding.logoUrl,
      },
    });
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
    if (!parsed.success) throw publicSubmitSchemaError(parsed.error);

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
      const answers = validatePublicAnswers(fields, parsed.data.answers, {
        draft: parsed.data.draft,
        countryCode: String((definition.organisation as { countryCode?: string } | undefined)?.countryCode ?? "GB"),
      });
      const canonical = mapAnswersToCanonical(fields, answers) as CanonicalSnapshot;
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

      await assertPublicFormFileAnswers(c.get("config").pools.app, {
        organisationId: school.organisationId,
        tokenHash,
        publicId: parsed.data.publicId,
        answers,
        fields,
        draft: Boolean(parsed.data.draft),
      });

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
      const replayed = isReplayedSubmission(result);
      if (!parsed.data.draft && replayed && result.publicId) {
        const replayedRow = await loadPublicSubmissionConfirmationRecord(
          c.get("config").pools.app,
          school.organisationId,
          formType,
          slug,
          String(result.publicId),
        );
        if (replayedRow?.enquiryReference) result.enquiryReference = replayedRow.enquiryReference;
        if (replayedRow?.applicationReference) result.applicationReference = replayedRow.applicationReference;
        if (replayedRow?.submittedAt) result.submittedAt = replayedRow.submittedAt;
      }
      if (!parsed.data.draft && !replayed) {
        const years = Array.isArray(definition.academicYears)
          ? (definition.academicYears as Array<{ id: string; name: string }>)
          : [];
        const groups = Array.isArray(definition.yearGroups)
          ? (definition.yearGroups as Array<{ id: string; name: string }>)
          : [];
        await queueAdmissionsFormAck(c, {
          organisationId: school.organisationId,
          organisationName: school.name,
          result,
          canonical,
          years,
          groups,
          draft: false,
        }).catch(() => undefined);
      }
      const confirmation = parsed.data.draft
        ? null
        : await presentPublicSubmissionConfirmation({
            pool: c.get("config").pools.app,
            organisationId: school.organisationId,
            organisationName: school.name,
            formType,
            result,
            childName: childDisplayName(canonical),
            formSuccessTitle: formMeta.successTitle ? String(formMeta.successTitle) : null,
            formSuccessText: formMeta.successText ? String(formMeta.successText) : null,
          }).catch(() => undefined);
      const confirmationToken =
        parsed.data.draft || !result.publicId
          ? null
          : issueConfirmationToken(c.get("config").authSecret, school.organisationId, formType, slug, result);
      return c.json(
        {
          submission: {
            publicId: result.publicId,
            completeness: result.completeness,
            formType: result.formType,
            enquiryReference: result.enquiryReference ?? null,
            applicationReference: result.applicationReference ?? null,
            continuationToken: issuedToken ?? (parsed.data.draft ? parsed.data.continuationToken : undefined) ?? null,
            confirmationToken,
            replayed,
            ...(confirmation ? { confirmation } : {}),
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

    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      throw new AppError(400, "validation_failed", "A file upload is required");
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
      const upload = await readUploadedFile(c);
      const continuationToken = upload.fields.continuationToken ?? "";
      const publicId = upload.fields.publicId ?? "";
      const fieldKey = upload.fields.fieldKey ?? "";
      if (!continuationToken || !publicId || !fieldKey) {
        throw new AppError(400, "validation_failed", "Invalid document payload");
      }
      const validated = validateBytes({
        filename: upload.filename,
        mime: upload.mime,
        bytes: upload.bytes,
        domain: "admissions_form",
      });
      const storage = storageOf(c);
      if (!storage.isConfigured()) {
        throw new AppError(503, "storage_unconfigured", "File storage is not configured");
      }
      const inserted = await c.get("config").pools.app.query<{
        register_public_form_document: { id: string; submissionId: string; storedObjectId: string; storageKey: string };
      }>(`select register_public_form_document($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
        school.organisationId,
        formType,
        slug,
        hashContinuationToken(continuationToken),
        publicId,
        fieldKey,
        validated.originalFilename,
        validated.storedContentType,
        validated.byteSize,
        "",
        storage.backend,
      ]);
      const registered = inserted.rows[0]!.register_public_form_document;
      try {
        const put = await storage.putObject({
          key: registered.storageKey,
          body: upload.bytes,
          contentType: validated.storedContentType,
        });
        const scan = await scannerOf(c).scan({
          bytes: upload.bytes,
          filename: validated.originalFilename,
          contentType: validated.storedContentType,
        });
        if (scan.status === "rejected") {
          throw new AppError(400, "unsupported_file_type", "This file type is not allowed");
        }
        await c.get("config").pools.app.query(
          `select complete_public_form_document($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            school.organisationId,
            hashContinuationToken(continuationToken),
            publicId,
            registered.id,
            put.checksumSha256,
            put.byteSize,
            validated.storedContentType,
            scan.status,
          ],
        );
      } catch (error) {
        const rejected = await c.get("config").pools.app.query<{
          reject_public_form_document: { id?: string; storageKey?: string };
        }>(`select reject_public_form_document($1,$2)`, [school.organisationId, registered.id]);
        const storageKey = rejected.rows[0]?.reject_public_form_document?.storageKey;
        if (storageKey) {
          await storage.deleteObject(storageKey).catch(() => undefined);
        }
        if (error instanceof AppError) throw error;
        throw pgErrorToAppError(error) ?? storageErrorToAppError(error);
      }
      return c.json(
        {
          document: {
            id: registered.id,
            filename: validated.originalFilename,
            contentType: validated.storedContentType,
            byteSize: validated.byteSize,
            fieldKey,
            binaryUploadAvailable: true,
          },
        },
        201,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw pgErrorToAppError(error) ?? storageErrorToAppError(error);
    }
  });

  app.delete("/public/admissions/forms/:formType/:slug/documents/:documentId", async (c) => {
    const school = requireSchoolHostOrg(c);
    const formType = c.req.param("formType") ?? "";
    const slug = c.req.param("slug") ?? "";
    if (!isAdmissionsFormType(formType)) throw new AppError(404, "not_found", "Not found");
    const documentId = c.req.param("documentId") ?? "";
    const continuationToken = c.req.query("continuationToken") ?? "";
    const publicId = c.req.query("publicId") ?? "";
    if (!continuationToken || !publicId) throw new AppError(404, "not_found", "Not found");
    try {
      const deleted = await c.get("config").pools.app.query<{
        delete_public_form_document: { id: string; storageKey: string; storedObjectId: string };
      }>(`select delete_public_form_document($1,$2,$3,$4)`, [
        school.organisationId,
        hashContinuationToken(continuationToken),
        publicId,
        documentId,
      ]);
      const row = deleted.rows[0]?.delete_public_form_document;
      if (row?.storageKey) {
        await storageOf(c).deleteObject(row.storageKey).catch(() => undefined);
      }
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw pgErrorToAppError(error) ?? error;
    }
  });
}
