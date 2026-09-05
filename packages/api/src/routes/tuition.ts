import { z } from "zod";
import { PERMISSIONS, STATEMENT_PERIOD_PRESETS } from "@schoolapp/domain";
import {
  AppError,
  assertPermission,
  assertTuitionRead,
  canManageBillingRuns,
  canManageDiscounts,
  canManageFeeSchedules,
  canManageFinanceSettings,
  canManageInvoices,
  canRecordOffline,
  loadOrganisationPaymentProviderPublic,
  setOrganisationStripeEnabled,
  testOrganisationStripeConnection,
  upsertOrganisationStripeConfig,
  confirmBillingRun,
  createDiscountRule,
  createFeeSchedule,
  createInvoiceCredit,
  createPupilConcession,
  createStaffChildLink,
  deleteFeeSchedule,
  endFeeSchedule,
  generateFeeScheduleCharges,
  listArrears,
  listBillingAccounts,
  listBillingRuns,
  listDiscountRules,
  listFeeSchedules,
  listFinanceReceipts,
  listInvoicePayments,
  listInvoices,
  listStaffChildLinks,
  loadAccountStatement,
  loadBillingAccount,
  loadBillingRun,
  loadFamilyStatementDocument,
  loadFeeSchedule,
  loadFinanceSettings,
  loadInvoice,
  loadPupilFeeProfile,
  loadTuitionDashboard,
  parentAuthorisedAccountIds,
  previewBillingRun,
  recordInvoicePayment,
  renderFamilyStatementZip,
  renderInvoicePdfBytes,
  renderReceiptPdfBytes,
  renderStatementPdfBytes,
  reverseInvoicePayment,
  revokeStaffChildLink,
  setFinanceDocumentLogo,
  renderFinanceDocumentPreviewPdf,
  updateDiscountRule,
  updateFeeSchedule,
  updateFinanceSettings,
  upsertPupilFeeProfile,
  voidInvoice,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { paymentRuntime, publicOriginFromRequest } from "../payments-context";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import { storageOf, scannerOf, readUploadedFile, insertPendingObject, putAndActivateObject, runUpload, profileForDomain, storageErrorToAppError } from "../file-service";
import { assertBrandingImageDimensions, validateUpload } from "@schoolapp/storage";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function registerTuitionRoutes(app: SchoolappApi) {
  app.get("/finance/settings", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json({ settings: await loadFinanceSettings(client, orgId) });
    }),
  );

  app.patch("/finance/settings", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageFinanceSettings(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          tuitionEnabled: z.boolean().optional(),
          defaultBillingFrequency: z.enum(["monthly", "termly", "annual", "custom"]).optional(),
          currency: z.string().regex(/^[A-Z]{3}$/).optional(),
          invoicePrefix: z.string().trim().min(1).max(12).optional(),
          paymentDueDays: z.number().int().min(0).max(365).optional(),
          gracePeriodDays: z.number().int().min(0).max(90).optional(),
          defaultAcademicYearId: z.string().uuid().nullable().optional(),
          paymentInstructions: z.string().max(4000).nullable().optional(),
          invoiceFooter: z.string().max(4000).nullable().optional(),
          parentsCanViewInvoices: z.boolean().optional(),
          parentsCanViewBalances: z.boolean().optional(),
          discountStackingMode: z.enum(["stack", "highest", "priority"]).optional(),
          siblingOrderMode: z.enum(["oldest_first", "youngest_first", "year_group", "explicit"]).optional(),
          midPeriodJoinPolicy: z.enum(["full", "prorate", "manual"]).optional(),
          midPeriodLeavePolicy: z.enum(["full", "prorate", "manual"]).optional(),
          monthlyInstalmentCount: z.number().int().min(1).max(12).optional(),
          receiptPrefix: z.string().trim().min(1).max(12).optional(),
          studentsCanViewFinance: z.boolean().optional(),
          financeEmail: z.string().trim().max(200).nullable().optional(),
          bankName: z.string().trim().max(120).nullable().optional(),
          bankAccountName: z.string().trim().max(120).nullable().optional(),
          bankAccountNumber: z.string().trim().max(20).nullable().optional(),
          bankSortCode: z.string().trim().max(12).nullable().optional(),
          vatEnabled: z.boolean().optional(),
          vatRegistrationNumber: z.string().trim().max(40).nullable().optional(),
          vatRatePercent: z.number().min(0).max(100).optional(),
          vatRateBps: z.number().int().min(0).max(10000).optional(),
          vatPricesInclusive: z.boolean().optional(),
          documentLogoMode: z.enum(["school", "finance", "none"]).optional(),
          documentShowSchoolName: z.boolean().optional(),
          documentShowLegalName: z.boolean().optional(),
          documentShowAddress: z.boolean().optional(),
          documentShowPhone: z.boolean().optional(),
          documentShowEmail: z.boolean().optional(),
          documentShowWebsite: z.boolean().optional(),
          documentShowVatNumber: z.boolean().optional(),
          documentFooterShowContact: z.boolean().optional(),
          documentFooterShowLegal: z.boolean().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid finance settings");
      return c.json({
        settings: await updateFinanceSettings(client, { organisationId: orgId, actorUserId: userId, patch: parsed.data }),
      });
    }),
  );

  app.get("/finance/settings/logo", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canManageFinanceSettings(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const settings = await loadFinanceSettings(client, orgId);
      if (!settings.financeLogoObjectId) throw new AppError(404, "not_found", "No finance logo");
      const row = await client.query<{ storage_key: string; content_type: string; original_filename: string }>(
        `select storage_key, content_type, original_filename from stored_objects
          where id = $1 and organisation_id = $2 and domain = 'branding' and status = 'active' and deleted_at is null`,
        [settings.financeLogoObjectId, orgId],
      );
      if (!row.rows[0]) throw new AppError(404, "not_found", "No finance logo");
      const got = await storageOf(c).getObject(row.rows[0].storage_key);
      if (!got?.body) throw new AppError(404, "not_found", "No finance logo");
      return new Response(Buffer.from(got.body), {
        headers: {
          "Content-Type": row.rows[0].content_type || "image/png",
          "Cache-Control": "no-store",
        },
      });
    }),
  );

  app.post("/finance/settings/logo", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageFinanceSettings(actor)) throw new AppError(403, "forbidden", "Missing permission");
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
          purpose: "logo",
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
        await setFinanceDocumentLogo(client, { organisationId: orgId, actorUserId: userId, objectId: pending.id });
        return pending;
      });
      return c.json({ settings: await loadFinanceSettings(client, orgId), objectId: stored.id }, 201);
    }),
  );

  app.delete("/finance/settings/logo", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageFinanceSettings(actor)) throw new AppError(403, "forbidden", "Missing permission");
      return c.json({
        settings: await setFinanceDocumentLogo(client, { organisationId: orgId, actorUserId: userId, objectId: null }),
      });
    }),
  );

  app.get("/finance/documents/preview/:kind", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canManageFinanceSettings(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const kind = c.req.param("kind");
      if (kind !== "invoice" && kind !== "receipt") throw new AppError(404, "not_found", "Not found");
      const pdf = await renderFinanceDocumentPreviewPdf(client, orgId, kind, { objectStore: storageOf(c) });
      return new Response(Buffer.from(pdf.bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${pdf.filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }),
  );

  app.get("/finance/payment-provider", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json({
        paymentProvider: await loadOrganisationPaymentProviderPublic(client, orgId, publicOriginFromRequest(c)),
      });
    }),
  );

  app.put("/finance/payment-provider", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageFinanceSettings(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          mode: z.enum(["test", "live"]).optional(),
          secretKey: z.string().trim().min(10).max(255).optional(),
          webhookSecret: z.string().trim().min(10).max(255).optional(),
          enabled: z.boolean().optional(),
          providerAccountId: z.string().trim().min(1).max(120).nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid payment provider configuration");
      return c.json({
        paymentProvider: await upsertOrganisationStripeConfig(client, {
          organisationId: orgId,
          actorUserId: userId,
          origin: publicOriginFromRequest(c),
          ...parsed.data,
        }),
      });
    }),
  );

  app.post("/finance/payment-provider/test", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageFinanceSettings(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const tested = await testOrganisationStripeConnection(client, {
        organisationId: orgId,
        actorUserId: userId,
        runtime: paymentRuntime(c),
        origin: publicOriginFromRequest(c),
      });
      return c.json({
        result: tested.result,
        paymentProvider: tested.paymentProvider,
      });
    }),
  );

  app.post("/finance/payment-provider/enable", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageFinanceSettings(actor)) throw new AppError(403, "forbidden", "Missing permission");
      return c.json({
        paymentProvider: await setOrganisationStripeEnabled(client, {
          organisationId: orgId,
          actorUserId: userId,
          enabled: true,
          origin: publicOriginFromRequest(c),
        }),
      });
    }),
  );

  app.post("/finance/payment-provider/disable", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageFinanceSettings(actor)) throw new AppError(403, "forbidden", "Missing permission");
      return c.json({
        paymentProvider: await setOrganisationStripeEnabled(client, {
          organisationId: orgId,
          actorUserId: userId,
          enabled: false,
          origin: publicOriginFromRequest(c),
        }),
      });
    }),
  );

  app.get("/finance/dashboard", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.FINANCE_REPORTS_READ);
      return c.json(await loadTuitionDashboard(client, orgId));
    }),
  );

  app.get("/finance/fee-schedules", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json({
        schedules: await listFeeSchedules(client, orgId, c.req.query("academicYearId") || undefined),
      });
    }),
  );

  app.post("/finance/fee-schedules", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageFeeSchedules(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          name: z.string().trim().min(1).max(120),
          academicYearId: z.string().uuid(),
          yearGroupId: z.string().uuid().nullable().optional(),
          classId: z.string().uuid().nullable().optional(),
          amountMinor: z.number().int().min(0).optional(),
          annualAmountMinor: z.number().int().min(0).nullable().optional(),
          billingFrequency: z.enum(["monthly", "termly", "annual", "custom"]),
          instalmentCount: z.number().int().min(1).max(24).nullable().optional(),
          effectiveFrom: dateSchema,
          effectiveUntil: dateSchema.nullable().optional(),
          description: z.string().max(4000).nullable().optional(),
          instalments: z
            .array(
              z.object({
                sequence: z.number().int().min(1),
                label: z.string().trim().min(1).max(80),
                dueOn: dateSchema.nullable().optional(),
                amountMinor: z.number().int().min(0),
              }),
            )
            .optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", feeScheduleValidationMessage(parsed.error));
      }
      const schedule = await createFeeSchedule(client, {
        organisationId: orgId,
        actorUserId: userId,
        ...parsed.data,
      });
      return c.json({ schedule }, 201);
    }),
  );

  app.patch("/finance/fee-schedules/:scheduleId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageFeeSchedules(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          name: z.string().trim().min(1).max(120).optional(),
          amountMinor: z.number().int().min(0).optional(),
          annualAmountMinor: z.number().int().min(0).nullable().optional(),
          billingFrequency: z.enum(["monthly", "termly", "annual", "custom"]).optional(),
          instalmentCount: z.number().int().min(1).max(24).nullable().optional(),
          effectiveFrom: dateSchema.optional(),
          effectiveUntil: dateSchema.nullable().optional(),
          isActive: z.boolean().optional(),
          description: z.string().max(4000).nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid fee schedule");
      return c.json({
        schedule: await updateFeeSchedule(client, {
          organisationId: orgId,
          actorUserId: userId,
          scheduleId: uuidRouteParam(c, "scheduleId"),
          ...parsed.data,
        }),
      });
    }),
  );

  app.get("/finance/fee-schedules/:scheduleId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json(await loadFeeSchedule(client, orgId, uuidRouteParam(c, "scheduleId")));
    }),
  );

  app.delete("/finance/fee-schedules/:scheduleId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageFeeSchedules(actor)) throw new AppError(403, "forbidden", "Missing permission");
      return c.json(
        await deleteFeeSchedule(client, {
          organisationId: orgId,
          actorUserId: userId,
          scheduleId: uuidRouteParam(c, "scheduleId"),
        }),
      );
    }),
  );

  app.post("/finance/fee-schedules/:scheduleId/end", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageFeeSchedules(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z.object({ effectiveUntil: dateSchema }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Choose an end date");
      return c.json({
        schedule: await endFeeSchedule(client, {
          organisationId: orgId,
          actorUserId: userId,
          scheduleId: uuidRouteParam(c, "scheduleId"),
          effectiveUntil: parsed.data.effectiveUntil,
        }),
      });
    }),
  );

  app.post("/finance/fee-schedules/:scheduleId/generate", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageBillingRuns(actor) && !canManageFeeSchedules(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const parsed = z
        .object({
          periodStart: dateSchema,
          periodEnd: dateSchema,
          dueOn: dateSchema.nullable().optional(),
          instalmentNumber: z.number().int().min(1).max(24).nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid charge generation");
      const preview = await generateFeeScheduleCharges(client, {
        organisationId: orgId,
        actorUserId: userId,
        scheduleId: uuidRouteParam(c, "scheduleId"),
        ...parsed.data,
      });
      c.header("Deprecation", "true");
      return c.json({
        ...preview,
        deprecated: true,
        issuesInvoices: false,
        message:
          "This endpoint is deprecated and preview-only. Confirm the billing run separately to issue invoices.",
      });
    }),
  );

  app.get("/finance/discount-rules", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json({ rules: await listDiscountRules(client, orgId) });
    }),
  );

  app.post("/finance/discount-rules", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageDiscounts(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          kind: z.enum([
            "sibling",
            "staff_child",
            "scholarship",
            "bursary",
            "early_payment",
            "promotional",
            "individual",
            "other",
          ]),
          name: z.string().trim().min(1).max(120),
          amountType: z.enum(["percent", "fixed"]),
          percentBps: z.number().int().min(0).max(10000).nullable().optional(),
          amountMinor: z.number().int().min(0).nullable().optional(),
          stackingPriority: z.number().int().optional(),
          exclusiveGroup: z.string().trim().min(1).max(40).nullable().optional(),
          staffScope: z.enum(["all_staff", "teachers", "selected_roles"]).nullable().optional(),
          staffRoleKeys: z.array(z.string()).optional(),
          description: z.string().max(4000).nullable().optional(),
          effectiveFrom: dateSchema.nullable().optional(),
          effectiveUntil: dateSchema.nullable().optional(),
          tiers: z
            .array(
              z.object({
                siblingPosition: z.number().int().min(1),
                amountType: z.enum(["percent", "fixed"]),
                percentBps: z.number().int().min(0).max(10000).nullable().optional(),
                amountMinor: z.number().int().min(0).nullable().optional(),
              }),
            )
            .optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid discount rule");
      return c.json(
        { rule: await createDiscountRule(client, { organisationId: orgId, actorUserId: userId, ...parsed.data }) },
        201,
      );
    }),
  );

  app.patch("/finance/discount-rules/:ruleId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageDiscounts(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          name: z.string().trim().min(1).max(120).optional(),
          isActive: z.boolean().optional(),
          stackingPriority: z.number().int().optional(),
          exclusiveGroup: z.string().nullable().optional(),
          percentBps: z.number().int().min(0).max(10000).nullable().optional(),
          amountMinor: z.number().int().min(0).nullable().optional(),
          description: z.string().max(4000).nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid discount rule");
      return c.json({
        rule: await updateDiscountRule(client, {
          organisationId: orgId,
          actorUserId: userId,
          ruleId: uuidRouteParam(c, "ruleId"),
          ...parsed.data,
        }),
      });
    }),
  );

  app.get("/finance/staff-child-links", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json({ links: await listStaffChildLinks(client, orgId) });
    }),
  );

  app.post("/finance/staff-child-links", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageDiscounts(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          staffUserId: z.string().uuid(),
          studentProfileId: z.string().uuid(),
          effectiveFrom: dateSchema.nullable().optional(),
          effectiveUntil: dateSchema.nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid staff-child link");
      return c.json(
        {
          link: await createStaffChildLink(client, {
            organisationId: orgId,
            actorUserId: userId,
            ...parsed.data,
          }),
        },
        201,
      );
    }),
  );

  app.post("/finance/staff-child-links/:linkId/revoke", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageDiscounts(actor)) throw new AppError(403, "forbidden", "Missing permission");
      return c.json({
        link: await revokeStaffChildLink(client, {
          organisationId: orgId,
          actorUserId: userId,
          linkId: uuidRouteParam(c, "linkId"),
        }),
      });
    }),
  );

  app.get("/finance/pupils/:studentId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      const asOf = c.req.query("asOf");
      if (asOf && !dateSchema.safeParse(asOf).success) {
        throw new AppError(400, "validation_failed", "asOf must be a date in YYYY-MM-DD format.");
      }
      return c.json(await loadPupilFeeProfile(client, orgId, uuidRouteParam(c, "studentId"), { asOf }));
    }),
  );

  app.patch("/finance/pupils/:studentId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageFeeSchedules(actor) && !canManageDiscounts(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const parsed = z
        .object({
          academicYearId: z.string().uuid().nullable().optional(),
          feeScheduleId: z.string().uuid().nullable().optional(),
          overrideAmountMinor: z.number().int().min(0).nullable().optional(),
          overrideBillingFrequency: z.enum(["monthly", "termly", "annual", "custom"]).nullable().optional(),
          siblingPriority: z.number().int().min(1).nullable().optional(),
          notes: z.string().max(4000).nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid pupil fee profile");
      return c.json({
        profile: await upsertPupilFeeProfile(client, {
          organisationId: orgId,
          actorUserId: userId,
          studentProfileId: uuidRouteParam(c, "studentId"),
          ...parsed.data,
        }),
      });
    }),
  );

  app.post("/finance/pupils/:studentId/concessions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageDiscounts(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          kind: z.enum(["scholarship", "bursary", "early_payment", "promotional", "individual", "other"]),
          name: z.string().trim().min(1).max(120),
          amountType: z.enum(["percent", "fixed"]),
          percentBps: z.number().int().min(0).max(10000).nullable().optional(),
          amountMinor: z.number().int().min(0).nullable().optional(),
          reason: z.string().trim().min(1).max(1000),
          stackingPriority: z.number().int().optional(),
          exclusiveGroup: z.string().nullable().optional(),
          discountRuleId: z.string().uuid().nullable().optional(),
          effectiveFrom: dateSchema.nullable().optional(),
          effectiveUntil: dateSchema.nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid concession");
      return c.json(
        {
          concession: await createPupilConcession(client, {
            organisationId: orgId,
            actorUserId: userId,
            studentProfileId: uuidRouteParam(c, "studentId"),
            ...parsed.data,
          }),
        },
        201,
      );
    }),
  );

  app.get("/finance/accounts", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json({ accounts: await listBillingAccounts(client, orgId) });
    }),
  );

  app.get("/finance/accounts/:accountId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json(await loadBillingAccount(client, orgId, uuidRouteParam(c, "accountId")));
    }),
  );

  app.get("/finance/accounts/:accountId/statement", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      const from = c.req.query("from") ?? "2000-01-01";
      const to = c.req.query("to") ?? new Date().toISOString().slice(0, 10);
      return c.json(await loadAccountStatement(client, orgId, uuidRouteParam(c, "accountId"), from, to));
    }),
  );

  app.get("/finance/invoices", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json({
        invoices: await listInvoices(client, orgId, {
          status: c.req.query("status") || undefined,
          billingAccountId: c.req.query("billingAccountId") || undefined,
          studentId: c.req.query("studentId") || undefined,
        }),
      });
    }),
  );

  app.get("/finance/invoices/:invoiceId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json(await loadInvoice(client, orgId, uuidRouteParam(c, "invoiceId")));
    }),
  );

  app.get("/finance/invoices/:invoiceId/pdf", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      const pdf = await renderInvoicePdfBytes(client, orgId, uuidRouteParam(c, "invoiceId"), {
        objectStore: storageOf(c),
      });
      return new Response(Buffer.from(pdf.bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdf.filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }),
  );

  app.get("/finance/receipts", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json({
        receipts: await listFinanceReceipts(client, orgId, {
          invoiceId: c.req.query("invoiceId") || undefined,
          billingAccountId: c.req.query("billingAccountId") || undefined,
        }),
      });
    }),
  );

  app.get("/finance/receipts/:receiptId/pdf", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      const pdf = await renderReceiptPdfBytes(client, orgId, uuidRouteParam(c, "receiptId"), {
        objectStore: storageOf(c),
      });
      return new Response(Buffer.from(pdf.bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdf.filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }),
  );

  app.get("/finance/payments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json({ payments: await listInvoicePayments(client, orgId) });
    }),
  );

  app.get("/finance/statements", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      const accountId = c.req.query("billingAccountId");
      if (!accountId) throw new AppError(400, "validation_failed", "Choose a family account");
      const preset = (c.req.query("preset") ?? "current_academic_year") as (typeof STATEMENT_PERIOD_PRESETS)[number];
      if (!STATEMENT_PERIOD_PRESETS.includes(preset)) {
        throw new AppError(400, "validation_failed", "Unknown statement period");
      }
      const loaded = await loadFamilyStatementDocument(client, orgId, {
        accountIds: [accountId],
        preset,
        today: new Date().toISOString().slice(0, 10),
        customFrom: c.req.query("from") ?? null,
        customTo: c.req.query("to") ?? null,
      });
      if (c.req.query("format") === "zip") {
        const zip = await renderFamilyStatementZip(
          client,
          orgId,
          {
            accountIds: [accountId],
            preset,
            today: new Date().toISOString().slice(0, 10),
            customFrom: c.req.query("from") ?? null,
            customTo: c.req.query("to") ?? null,
          },
          { objectStore: storageOf(c) },
        );
        return new Response(Buffer.from(zip.bytes), {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${zip.filename}"`,
            "Cache-Control": "no-store",
          },
        });
      }
      if (c.req.query("format") === "pdf") {
        const pdf = await renderStatementPdfBytes(client, orgId, loaded.document, { objectStore: storageOf(c) });
        return new Response(Buffer.from(pdf.bytes), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${pdf.filename}"`,
            "Cache-Control": "no-store",
          },
        });
      }
      return c.json(loaded);
    }),
  );

  app.post("/finance/invoices/:invoiceId/payments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canRecordOffline(actor) && !canManageInvoices(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const parsed = z
        .object({
          amountMinor: z.number().int().positive(),
          method: z.enum(["card", "bank_transfer", "cash", "cheque", "direct_debit", "other"]),
          receivedOn: dateSchema.optional(),
          externalReference: z.string().max(80).nullable().optional(),
          note: z.string().max(2000).nullable().optional(),
          idempotencyKey: z.string().min(8).max(120).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid payment");
      return c.json(
        {
          payment: await recordInvoicePayment(client, {
            organisationId: orgId,
            actorUserId: userId,
            invoiceId: uuidRouteParam(c, "invoiceId"),
            ...parsed.data,
          }),
        },
        201,
      );
    }),
  );

  app.post("/finance/invoice-payments/:paymentId/reverse", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageInvoices(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z.object({ reason: z.string().trim().min(1).max(1000) }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "A reason is required");
      return c.json({
        payment: await reverseInvoicePayment(client, {
          organisationId: orgId,
          actorUserId: userId,
          paymentId: uuidRouteParam(c, "paymentId"),
          reason: parsed.data.reason,
        }),
      });
    }),
  );

  app.post("/finance/invoices/:invoiceId/credits", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageInvoices(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const invoice = await loadInvoice(client, orgId, uuidRouteParam(c, "invoiceId"));
      const parsed = z
        .object({
          kind: z.enum(["credit_note", "account_credit", "overpayment", "adjustment", "refund"]),
          amountMinor: z.number().int().positive(),
          reason: z.string().trim().min(1).max(1000),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid credit");
      return c.json(
        {
          credit: await createInvoiceCredit(client, {
            organisationId: orgId,
            actorUserId: userId,
            billingAccountId: String(invoice.invoice.billingAccountId),
            invoiceId: String(invoice.invoice.id),
            ...parsed.data,
          }),
        },
        201,
      );
    }),
  );

  app.post("/finance/invoices/:invoiceId/void", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageInvoices(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z.object({ reason: z.string().trim().min(1).max(1000) }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "A reason is required");
      return c.json({
        invoice: await voidInvoice(client, {
          organisationId: orgId,
          actorUserId: userId,
          invoiceId: uuidRouteParam(c, "invoiceId"),
          reason: parsed.data.reason,
        }),
      });
    }),
  );

  app.get("/finance/billing-runs", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json({ runs: await listBillingRuns(client, orgId) });
    }),
  );

  app.post("/finance/billing-runs/preview", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageBillingRuns(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = z
        .object({
          academicYearId: z.string().uuid(),
          frequency: z.enum(["monthly", "termly", "annual", "custom"]),
          periodStart: dateSchema,
          periodEnd: dateSchema,
          dueOn: dateSchema.nullable().optional(),
          instalmentNumber: z.number().int().min(1).nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid billing run");
      return c.json(
        await previewBillingRun(client, { organisationId: orgId, actorUserId: userId, ...parsed.data }),
        201,
      );
    }),
  );

  app.get("/finance/billing-runs/:runId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json(await loadBillingRun(client, orgId, uuidRouteParam(c, "runId")));
    }),
  );

  app.post("/finance/billing-runs/:runId/confirm", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageBillingRuns(actor)) throw new AppError(403, "forbidden", "Missing permission");
      return c.json(
        await confirmBillingRun(client, {
          organisationId: orgId,
          actorUserId: userId,
          billingRunId: uuidRouteParam(c, "runId"),
        }),
      );
    }),
  );

  app.get("/finance/arrears", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertTuitionRead(actor);
      return c.json({ items: await listArrears(client, orgId, c.req.query("bucket") || undefined) });
    }),
  );
}

function feeScheduleValidationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "The fee schedule is invalid.";
  const field = String(issue.path[0] ?? "");
  const labels: Record<string, string> = {
    name: "Name",
    academicYearId: "Academic year",
    yearGroupId: "Year group",
    amountMinor: "Amount per instalment",
    annualAmountMinor: "Annual tuition fee",
    billingFrequency: "Frequency",
    instalmentCount: "Instalments per year",
    effectiveFrom: "Effective from",
  };
  const label = labels[field];
  if (field === "academicYearId") return "Select an academic year.";
  if (field === "amountMinor") return "Enter a valid amount per instalment in pounds, such as 600.00.";
  if (field === "annualAmountMinor") return "Enter a valid annual tuition fee in pounds, such as 6000.00.";
  if (field === "instalmentCount") return "Instalments per year must be a whole number between 1 and 24.";
  if (field === "effectiveFrom") return "Effective from must be a valid date.";
  if (field === "billingFrequency") return "Select a billing frequency.";
  if (label && (issue.code === "too_small" || issue.code === "invalid_type")) return `${label} is required.`;
  if (label) return `${label} is invalid.`;
  return "The fee schedule is invalid.";
}
