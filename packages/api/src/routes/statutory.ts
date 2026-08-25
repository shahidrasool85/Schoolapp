import { z } from "zod";
import { PERMISSIONS } from "@schoolapp/domain";
import {
  AppError,
  ADMISSIONS_ENROLMENT_COLUMNS,
  ATTENDANCE_SUMMARY_COLUMNS,
  CENSUS_SNAPSHOT_COLUMNS,
  CENSUS_SNAPSHOT_SCHEMA_VERSION,
  PUPIL_ROLL_COLUMNS,
  SEND_EXPORT_COLUMNS,
  assertCanCreateCensus,
  assertCanExportCensus,
  assertCanFinaliseCensus,
  assertCanManagePupilStatutory,
  assertCanManageStatutory,
  assertCanReadPupilStatutory,
  assertCanReadSendReport,
  assertCanReadStatutory,
  assertCanValidateStatutory,
  auditSafeStatutoryAfter,
  canCreateReportExport,
  canReadAdmissionsReport,
  canReadAttendanceReport,
  canReadPupilRollReport,
  canReadPupilStatutory,
  canReadSendReport,
  canReadStatutory,
  canReadStudentProfile,
  censusIsImmutable,
  censusMayExport,
  censusMayFinalise,
  censusMayRegenerate,
  censusXmlPreview,
  countIssues,
  fsmEligibleOnDate,
  groupAttendanceSummaries,
  isOnRollOnDate,
  leftDuringPeriod,
  loadLiveStatutoryPupils,
  loadSchoolStatutoryRecord,
  loadSnapshotPupils,
  loadSnapshotSchool,
  loadStatutoryCodeLookup,
  mapOperationalSendToStatutory,
  normaliseUpn,
  pupilToSnapshotRow,
  splitLegalName,
  summariseStatutoryAttendance,
  toCsv,
  validateEstablishmentNumber,
  validateLocalAuthorityNumber,
  validateStatutory,
  validateUrn,
  validateUpn,
  wasAdmittedDuringPeriod,
  writeAudit,
  type PupilStatutoryRecord,
  type StatutoryIssue,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import { mapCensusRun, mapStatutoryIssue } from "../serialize";

const censusCreateSchema = z.object({
  academicYearId: z.string().uuid(),
  censusType: z.enum(["autumn", "spring", "summer"]),
  censusDate: z.string().date(),
});

const schoolProfileSchema = z.object({
  statutoryName: z.string().max(200).nullable().optional(),
  establishmentNumber: z.string().max(4).nullable().optional(),
  localAuthorityNumber: z.string().max(3).nullable().optional(),
  urn: z.string().max(6).nullable().optional(),
  schoolPhase: z.string().max(8).nullable().optional(),
  establishmentType: z.string().max(8).nullable().optional(),
  establishmentStatus: z.string().max(8).nullable().optional(),
  addressLine1: z.string().max(120).nullable().optional(),
  addressLine2: z.string().max(120).nullable().optional(),
  addressTown: z.string().max(80).nullable().optional(),
  addressPostcode: z.string().max(16).nullable().optional(),
  telephone: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  timezone: z.string().max(64).nullable().optional(),
  defaultCensusType: z.enum(["autumn", "spring", "summer"]).optional(),
});

const pupilStatutorySchema = z.object({
  legalSurname: z.string().max(80).nullable().optional(),
  legalForename: z.string().max(80).nullable().optional(),
  middleNames: z.string().max(120).nullable().optional(),
  sex: z.enum(["M", "F"]).nullable().optional(),
  upn: z.string().max(13).nullable().optional(),
  formerUpn: z.string().max(13).nullable().optional(),
  ethnicityCode: z.string().max(16).nullable().optional(),
  languageCode: z.string().max(16).nullable().optional(),
  enrolmentStatusCode: z.enum(["C", "G", "M", "S", "F"]).nullable().optional(),
  dateOfAdmission: z.string().date().nullable().optional(),
  dateOfLeaving: z.string().date().nullable().optional(),
  leavingReasonCode: z.string().max(8).nullable().optional(),
  previousSchoolName: z.string().max(160).nullable().optional(),
  sendProvisionCode: z.enum(["N", "K", "E"]).nullable().optional(),
  lookedAfterStatus: z.enum(["none", "looked_after", "previously_looked_after"]).optional(),
  serviceChild: z.boolean().nullable().optional(),
});

const fsmSchema = z.object({
  startedOn: z.string().date(),
  endedOn: z.string().date().nullable().optional(),
});

function csvFile(filename: string, body: string) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function xmlFile(filename: string, body: string) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function wantsCsv(c: { req: { query: (name: string) => string | undefined } }) {
  return (c.req.query("format") ?? "").toLowerCase() === "csv";
}

function issueFixPath(issue: StatutoryIssue): string | null {
  if (issue.entityType === "school" || issue.entityType === "attendance") {
    return "/school/settings/statutory";
  }
  if (issue.entityId) {
    return `/school/students/${issue.entityId}#statutory`;
  }
  return "/school/statutory/data-quality";
}

function mapPupilStatutory(pupil: PupilStatutoryRecord, asOf: string) {
  const send = mapOperationalSendToStatutory({
    sendProvisionCode: pupil.sendProvisionCode,
    sendNotes: pupil.sendNotes,
  });
  return {
    studentProfileId: pupil.studentProfileId,
    admissionNumber: pupil.admissionNumber,
    legalName: pupil.legalName,
    preferredName: pupil.preferredName,
    legalSurname: pupil.legalSurname,
    legalForename: pupil.legalForename,
    middleNames: pupil.middleNames,
    dateOfBirth: pupil.dateOfBirth,
    sex: pupil.sex,
    upn: pupil.upn,
    formerUpn: pupil.formerUpn,
    ethnicityCode: pupil.ethnicityCode,
    languageCode: pupil.languageCode,
    enrolmentStatus: pupil.enrolmentStatus,
    enrolmentStatusCode: pupil.enrolmentStatusCode,
    dateOfAdmission: pupil.dateOfAdmission,
    dateOfLeaving: pupil.dateOfLeaving,
    leavingReasonCode: pupil.leavingReasonCode,
    previousSchoolName: pupil.previousSchoolName,
    yearGroupCode: pupil.yearGroupCode,
    yearGroupName: pupil.yearGroupName,
    className: pupil.className,
    sendProvisionCode: pupil.sendProvisionCode,
    sendClassificationIncomplete: send.incomplete,
    lookedAfterStatus: pupil.lookedAfterStatus,
    serviceChild: pupil.serviceChild,
    fsmEligibleOnDate: fsmEligibleOnDate(pupil.fsmPeriods, asOf),
    fsmPeriods: pupil.fsmPeriods,
    onRoll: isOnRollOnDate(
      {
        enrolmentStatus: pupil.enrolmentStatus,
        dateOfAdmission: pupil.dateOfAdmission,
        dateOfLeaving: pupil.dateOfLeaving,
        enrolments: pupil.enrolments,
      },
      asOf,
    ),
  };
}

async function persistLiveIssues(
  client: Parameters<Parameters<typeof withSchoolActor>[1]>[0]["client"],
  organisationId: string,
  issues: StatutoryIssue[],
) {
  await client.query(
    `delete from census_validation_issues
     where organisation_id = $1 and source = 'live' and census_run_id is null`,
    [organisationId],
  );
  for (const issue of issues) {
    await client.query(
      `insert into census_validation_issues (
         organisation_id, source, rule_key, severity, entity_type, entity_id, field, message, metadata
       ) values ($1, 'live', $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        organisationId,
        issue.ruleKey,
        issue.severity,
        issue.entityType,
        issue.entityId,
        issue.field,
        issue.message,
        JSON.stringify(issue.metadata),
      ],
    );
  }
}

async function recordExport(
  client: Parameters<Parameters<typeof withSchoolActor>[1]>[0]["client"],
  input: {
    organisationId: string;
    actorUserId: string;
    exportKind: string;
    format: "csv" | "xml";
    rowCount: number;
    censusRunId?: string | null;
    snapshotVersion?: number | null;
    filters?: Record<string, unknown>;
  },
) {
  await client.query(
    `insert into data_exports (
       organisation_id, export_kind, format, census_run_id, snapshot_version, row_count, filters, created_by
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      input.organisationId,
      input.exportKind,
      input.format,
      input.censusRunId ?? null,
      input.snapshotVersion ?? null,
      input.rowCount,
      JSON.stringify(input.filters ?? {}),
      input.actorUserId,
    ],
  );
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "statutory.export.created",
    entityType: "data_export",
    entityId: input.censusRunId ?? null,
    after: auditSafeStatutoryAfter({
      action: "export",
      exportKind: input.exportKind,
      format: input.format,
      version: input.snapshotVersion ?? null,
    }),
  });
}

export function registerStatutoryRoutes(app: SchoolappApi) {
  app.get("/statutory/codes", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor }) => {
      if (!canReadStatutory(actor) && !canReadPupilStatutory(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const version = c.req.query("version") ?? undefined;
      const lookup = await loadStatutoryCodeLookup(client, version);
      const catalogues = [...lookup.byCatalogue.entries()].map(([catalogue, codes]) => ({
        catalogue,
        codes: [...codes.values()].map((row) => ({ code: row.code, name: row.name, sortOrder: row.sortOrder })),
      }));
      return c.json({ version: lookup.version, catalogues });
    }),
  );

  app.get("/statutory/overview", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertCanReadStatutory(actor);
      const asOf = c.req.query("asOf") ?? new Date().toISOString().slice(0, 10);
      const school = await loadSchoolStatutoryRecord(client, orgId);
      const pupils = await loadLiveStatutoryPupils(client, orgId);
      const lookup = await loadStatutoryCodeLookup(client);
      const issues = validateStatutory({
        asOf,
        school,
        pupils,
        codeLookup: lookup,
        attendanceConfig: {
          activeSessionCount: school.activeSessionCount,
          unmappedCodeCount: school.unmappedCodeCount,
        },
      });
      const counts = countIssues(issues);
      const onRoll = pupils.filter((pupil) =>
        isOnRollOnDate(
          {
            enrolmentStatus: pupil.enrolmentStatus,
            dateOfAdmission: pupil.dateOfAdmission,
            dateOfLeaving: pupil.dateOfLeaving,
            enrolments: pupil.enrolments,
          },
          asOf,
        ),
      );
      const sendCount = pupils.filter((pupil) => pupil.sendProvisionCode === "K" || pupil.sendProvisionCode === "E").length;
      const census = await client.query<{ count: string }>(
        `select count(*)::text as count from census_runs where organisation_id = $1 and status not in ('archived')`,
        [orgId],
      );
      const exports = await client.query<{ count: string }>(
        `select count(*)::text as count from data_exports where organisation_id = $1`,
        [orgId],
      );
      return c.json({
        asOf,
        dataQuality: counts,
        onRollCount: onRoll.length,
        pupilCount: pupils.length,
        sendCount,
        censusRunCount: Number(census.rows[0]?.count ?? 0),
        exportCount: Number(exports.rows[0]?.count ?? 0),
        schoolProfileComplete: Boolean(school.statutoryName && school.establishmentNumber && school.localAuthorityNumber),
      });
    }),
  );

  app.get("/statutory/profile", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertCanReadStatutory(actor);
      const school = await loadSchoolStatutoryRecord(client, orgId);
      const row = await client.query(
        `select * from organisation_statutory_profiles where organisation_id = $1`,
        [orgId],
      );
      return c.json({
        profile: {
          statutoryName: school.statutoryName,
          establishmentNumber: school.establishmentNumber,
          localAuthorityNumber: school.localAuthorityNumber,
          urn: school.urn,
          schoolPhase: school.schoolPhase,
          establishmentType: school.establishmentType,
          establishmentStatus: school.establishmentStatus,
          addressLine1: school.addressLine1,
          addressLine2: row.rows[0]?.address_line2 ?? null,
          addressTown: school.addressTown,
          addressPostcode: school.addressPostcode,
          telephone: row.rows[0]?.telephone ?? null,
          email: row.rows[0]?.email ?? null,
          timezone: school.timezone,
          defaultCensusType: row.rows[0]?.default_census_type ?? "autumn",
          codeSetVersion: row.rows[0]?.code_set_version ?? "2025-2026",
        },
      });
    }),
  );

  app.patch("/statutory/profile", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanManageStatutory(actor);
      const parsed = schoolProfileSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid statutory profile");
      const data = parsed.data;
      if (data.establishmentNumber !== undefined && !validateEstablishmentNumber(data.establishmentNumber)) {
        throw new AppError(400, "validation_failed", "Establishment number must be four digits");
      }
      if (data.localAuthorityNumber !== undefined && !validateLocalAuthorityNumber(data.localAuthorityNumber)) {
        throw new AppError(400, "validation_failed", "Local authority number must be three digits");
      }
      if (data.urn !== undefined && !validateUrn(data.urn)) {
        throw new AppError(400, "validation_failed", "URN must be six digits");
      }
      await client.query(
        `insert into organisation_statutory_profiles (
           organisation_id, statutory_name, establishment_number, local_authority_number, urn,
           school_phase, establishment_type, establishment_status, address_line1, address_line2,
           address_town, address_postcode, telephone, email, timezone, default_census_type, updated_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         on conflict (organisation_id) do update set
           statutory_name = coalesce(excluded.statutory_name, organisation_statutory_profiles.statutory_name),
           establishment_number = coalesce(excluded.establishment_number, organisation_statutory_profiles.establishment_number),
           local_authority_number = coalesce(excluded.local_authority_number, organisation_statutory_profiles.local_authority_number),
           urn = coalesce(excluded.urn, organisation_statutory_profiles.urn),
           school_phase = coalesce(excluded.school_phase, organisation_statutory_profiles.school_phase),
           establishment_type = coalesce(excluded.establishment_type, organisation_statutory_profiles.establishment_type),
           establishment_status = coalesce(excluded.establishment_status, organisation_statutory_profiles.establishment_status),
           address_line1 = coalesce(excluded.address_line1, organisation_statutory_profiles.address_line1),
           address_line2 = coalesce(excluded.address_line2, organisation_statutory_profiles.address_line2),
           address_town = coalesce(excluded.address_town, organisation_statutory_profiles.address_town),
           address_postcode = coalesce(excluded.address_postcode, organisation_statutory_profiles.address_postcode),
           telephone = coalesce(excluded.telephone, organisation_statutory_profiles.telephone),
           email = coalesce(excluded.email, organisation_statutory_profiles.email),
           timezone = coalesce(excluded.timezone, organisation_statutory_profiles.timezone),
           default_census_type = coalesce(excluded.default_census_type, organisation_statutory_profiles.default_census_type),
           updated_by = excluded.updated_by`,
        [
          orgId,
          data.statutoryName ?? null,
          data.establishmentNumber ?? null,
          data.localAuthorityNumber ?? null,
          data.urn ?? null,
          data.schoolPhase ?? null,
          data.establishmentType ?? null,
          data.establishmentStatus ?? null,
          data.addressLine1 ?? null,
          data.addressLine2 ?? null,
          data.addressTown ?? null,
          data.addressPostcode ?? null,
          data.telephone ?? null,
          data.email || null,
          data.timezone ?? null,
          data.defaultCensusType ?? null,
          userId,
        ],
      );
      if (data.urn) {
        await client.query(
          `insert into organisation_identifiers (organisation_id, system, identifier)
           values ($1, 'urn', $2)
           on conflict (organisation_id, system) do update set identifier = excluded.identifier`,
          [orgId, data.urn],
        );
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "statutory.school_profile.updated",
        entityType: "organisation_statutory_profile",
        entityId: orgId,
        after: auditSafeStatutoryAfter({ action: "school_profile_updated" }),
      });
      return c.json({ ok: true });
    }),
  );

  app.get("/statutory/data-quality", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertCanReadStatutory(actor);
      const asOf = c.req.query("asOf") ?? new Date().toISOString().slice(0, 10);
      const school = await loadSchoolStatutoryRecord(client, orgId);
      const pupils = await loadLiveStatutoryPupils(client, orgId);
      const lookup = await loadStatutoryCodeLookup(client);
      const issues = validateStatutory({
        asOf,
        school,
        pupils,
        codeLookup: lookup,
        attendanceConfig: {
          activeSessionCount: school.activeSessionCount,
          unmappedCodeCount: school.unmappedCodeCount,
        },
      });
      const byId = new Map(pupils.map((pupil) => [pupil.studentProfileId, pupil.legalName]));
      return c.json({
        asOf,
        counts: countIssues(issues),
        issues: issues.map((issue) =>
          mapStatutoryIssue({
            ...issue,
            pupilName: issue.entityId ? byId.get(issue.entityId) ?? null : null,
            fixPath: issueFixPath(issue),
          }),
        ),
      });
    }),
  );

  app.post("/statutory/validate", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanValidateStatutory(actor);
      const asOf = c.req.query("asOf") ?? new Date().toISOString().slice(0, 10);
      const school = await loadSchoolStatutoryRecord(client, orgId);
      const pupils = await loadLiveStatutoryPupils(client, orgId);
      const lookup = await loadStatutoryCodeLookup(client);
      const issues = validateStatutory({
        asOf,
        school,
        pupils,
        codeLookup: lookup,
        attendanceConfig: {
          activeSessionCount: school.activeSessionCount,
          unmappedCodeCount: school.unmappedCodeCount,
        },
      });
      await persistLiveIssues(client, orgId, issues);
      const counts = countIssues(issues);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "statutory.validation.ran",
        entityType: "statutory_validation",
        after: auditSafeStatutoryAfter({ action: "validate_live", counts }),
      });
      return c.json({ asOf, counts, issueCount: issues.length });
    }),
  );

  app.get("/students/:id/statutory", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanReadPupilStatutory(actor);
      const id = uuidRouteParam(c, "id");
      const allowed = await canReadStudentProfile(client, userId, orgId, id, actor.permissions);
      if (!allowed) throw new AppError(404, "not_found", "Not found");
      const pupils = await loadLiveStatutoryPupils(client, orgId, id);
      const pupil = pupils[0];
      if (!pupil) throw new AppError(404, "not_found", "Not found");
      const asOf = c.req.query("asOf") ?? new Date().toISOString().slice(0, 10);
      const lookup = await loadStatutoryCodeLookup(client);
      const school = await loadSchoolStatutoryRecord(client, orgId);
      const issues = validateStatutory({
        asOf,
        school,
        pupils: [pupil],
        codeLookup: lookup,
      }).filter((issue) => issue.entityId === id);
      return c.json({
        statutory: mapPupilStatutory(pupil, asOf),
        issues: issues.map((issue) => mapStatutoryIssue({ ...issue, fixPath: issueFixPath(issue) })),
      });
    }),
  );

  app.patch("/students/:id/statutory", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanManagePupilStatutory(actor);
      const id = uuidRouteParam(c, "id");
      const existing = await client.query(`select id from student_profiles where id = $1 and organisation_id = $2`, [
        id,
        orgId,
      ]);
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const parsed = pupilStatutorySchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid statutory pupil payload");
      const data = parsed.data;
      if (data.upn) {
        if (!validateUpn(data.upn).ok) {
          throw new AppError(400, "validation_failed", "UPN format is invalid");
        }
      }
      if (data.formerUpn) {
        if (!validateUpn(data.formerUpn).ok) {
          throw new AppError(400, "validation_failed", "Former UPN format is invalid");
        }
      }
      const current = await client.query<{ legal_name: string }>(
        `select legal_name from student_profiles where id = $1 and organisation_id = $2`,
        [id, orgId],
      );
      const split = splitLegalName(current.rows[0]?.legal_name ?? "");
      await client.query(
        `insert into student_statutory_profiles (
           student_profile_id, organisation_id, legal_surname, legal_forename, middle_names, sex,
           upn, former_upn, ethnicity_code, language_code, enrolment_status_code, date_of_admission,
           date_of_leaving, leaving_reason_code, previous_school_name, send_provision_code,
           looked_after_status, service_child, updated_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         on conflict (student_profile_id) do update set
           legal_surname = coalesce(excluded.legal_surname, student_statutory_profiles.legal_surname),
           legal_forename = coalesce(excluded.legal_forename, student_statutory_profiles.legal_forename),
           middle_names = coalesce(excluded.middle_names, student_statutory_profiles.middle_names),
           sex = coalesce(excluded.sex, student_statutory_profiles.sex),
           upn = case when $20 then excluded.upn else student_statutory_profiles.upn end,
           former_upn = coalesce(excluded.former_upn, student_statutory_profiles.former_upn),
           ethnicity_code = coalesce(excluded.ethnicity_code, student_statutory_profiles.ethnicity_code),
           language_code = coalesce(excluded.language_code, student_statutory_profiles.language_code),
           enrolment_status_code = coalesce(excluded.enrolment_status_code, student_statutory_profiles.enrolment_status_code),
           date_of_admission = coalesce(excluded.date_of_admission, student_statutory_profiles.date_of_admission),
           date_of_leaving = case when $21 then excluded.date_of_leaving else student_statutory_profiles.date_of_leaving end,
           leaving_reason_code = coalesce(excluded.leaving_reason_code, student_statutory_profiles.leaving_reason_code),
           previous_school_name = coalesce(excluded.previous_school_name, student_statutory_profiles.previous_school_name),
           send_provision_code = coalesce(excluded.send_provision_code, student_statutory_profiles.send_provision_code),
           looked_after_status = coalesce(excluded.looked_after_status, student_statutory_profiles.looked_after_status),
           service_child = coalesce(excluded.service_child, student_statutory_profiles.service_child),
           updated_by = excluded.updated_by`,
        [
          id,
          orgId,
          data.legalSurname ?? split.legalSurname,
          data.legalForename ?? split.legalForename,
          data.middleNames ?? split.middleNames,
          data.sex ?? null,
          normaliseUpn(data.upn ?? null),
          normaliseUpn(data.formerUpn ?? null),
          data.ethnicityCode ?? null,
          data.languageCode ?? null,
          data.enrolmentStatusCode ?? null,
          data.dateOfAdmission ?? null,
          data.dateOfLeaving ?? null,
          data.leavingReasonCode ?? null,
          data.previousSchoolName ?? null,
          data.sendProvisionCode ?? null,
          data.lookedAfterStatus ?? "none",
          data.serviceChild ?? null,
          userId,
          data.upn !== undefined,
          data.dateOfLeaving !== undefined,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "statutory.pupil.updated",
        entityType: "student_statutory_profile",
        entityId: id,
        after: auditSafeStatutoryAfter({ action: "pupil_statutory_updated", entityId: id }),
      });
      const pupils = await loadLiveStatutoryPupils(client, orgId, id);
      return c.json({ statutory: mapPupilStatutory(pupils[0]!, new Date().toISOString().slice(0, 10)) });
    }),
  );

  app.post("/students/:id/statutory/fsm", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanManagePupilStatutory(actor);
      const id = uuidRouteParam(c, "id");
      const parsed = fsmSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid FSM period");
      const exists = await client.query(`select id from student_profiles where id = $1 and organisation_id = $2`, [
        id,
        orgId,
      ]);
      if (!exists.rows[0]) throw new AppError(404, "not_found", "Not found");
      const inserted = await client.query<{ id: string }>(
        `insert into student_fsm_periods (organisation_id, student_profile_id, started_on, ended_on, created_by)
         values ($1, $2, $3, $4, $5) returning id`,
        [orgId, id, parsed.data.startedOn, parsed.data.endedOn ?? null, userId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "statutory.fsm.created",
        entityType: "student_fsm_period",
        entityId: inserted.rows[0]!.id,
        after: auditSafeStatutoryAfter({ action: "fsm_period_created", entityId: id }),
      });
      return c.json({ id: inserted.rows[0]!.id }, 201);
    }),
  );

  app.get("/statutory/census", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertCanReadStatutory(actor);
      const rows = await client.query(
        `select cr.*, ay.name as academic_year_name
         from census_runs cr
         join academic_years ay on ay.id = cr.academic_year_id
         where cr.organisation_id = $1
         order by cr.census_date desc, cr.created_at desc`,
        [orgId],
      );
      return c.json({ censusRuns: rows.rows.map((row) => mapCensusRun(row)) });
    }),
  );

  app.post("/statutory/census", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanCreateCensus(actor);
      const parsed = censusCreateSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid census run");
      const year = await client.query(
        `select id from academic_years where id = $1 and organisation_id = $2`,
        [parsed.data.academicYearId, orgId],
      );
      if (!year.rows[0]) throw new AppError(404, "not_found", "Not found");
      const inserted = await client.query(
        `insert into census_runs (
           organisation_id, academic_year_id, census_type, census_date, created_by
         ) values ($1,$2,$3,$4,$5)
         returning *`,
        [orgId, parsed.data.academicYearId, parsed.data.censusType, parsed.data.censusDate, userId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "statutory.census.created",
        entityType: "census_run",
        entityId: inserted.rows[0]!.id,
        after: auditSafeStatutoryAfter({ action: "census_created", status: "draft" }),
      });
      return c.json({ censusRun: mapCensusRun(inserted.rows[0]!) }, 201);
    }),
  );

  app.get("/statutory/census/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertCanReadStatutory(actor);
      const id = uuidRouteParam(c, "id");
      const run = await client.query(
        `select cr.*, ay.name as academic_year_name
         from census_runs cr
         join academic_years ay on ay.id = cr.academic_year_id
         where cr.id = $1 and cr.organisation_id = $2`,
        [id, orgId],
      );
      if (!run.rows[0]) throw new AppError(404, "not_found", "Not found");
      const version = Number(run.rows[0].current_snapshot_version);
      const school = version > 0 ? await loadSnapshotSchool(client, orgId, id, version) : null;
      const pupils = version > 0 ? await loadSnapshotPupils(client, orgId, id, version) : [];
      const issues = await client.query(
        `select rule_key, severity, entity_type, entity_id, field, message, metadata
         from census_validation_issues
         where organisation_id = $1 and census_run_id = $2 and snapshot_version = $3
         order by severity, rule_key`,
        [orgId, id, version],
      );
      return c.json({
        censusRun: mapCensusRun(run.rows[0]),
        school,
        pupils: pupils.map((pupil) => mapPupilStatutory(pupil, String(run.rows[0].census_date))),
        issues: issues.rows.map((row) =>
          mapStatutoryIssue({
            ruleKey: String(row.rule_key),
            severity: String(row.severity),
            entityType: String(row.entity_type),
            entityId: row.entity_id ? String(row.entity_id) : null,
            field: row.field ? String(row.field) : null,
            message: String(row.message),
            metadata: (row.metadata ?? {}) as Record<string, unknown>,
          }),
        ),
      });
    }),
  );

  app.post("/statutory/census/:id/snapshot", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanCreateCensus(actor);
      const id = uuidRouteParam(c, "id");
      const run = await client.query(`select * from census_runs where id = $1 and organisation_id = $2`, [id, orgId]);
      if (!run.rows[0]) throw new AppError(404, "not_found", "Not found");
      if (!censusMayRegenerate(String(run.rows[0].status))) {
        throw new AppError(409, "conflict", "This census snapshot can no longer be regenerated");
      }
      const asOf = String(run.rows[0].census_date).slice(0, 10);
      const school = await loadSchoolStatutoryRecord(client, orgId);
      const pupils = await loadLiveStatutoryPupils(client, orgId);
      const version = Number(run.rows[0].current_snapshot_version) + 1;
      await client.query(
        `insert into census_snapshot_schools (
           organisation_id, census_run_id, snapshot_version, statutory_name, establishment_number,
           local_authority_number, urn, school_phase, establishment_type, establishment_status,
           address_line1, address_town, address_postcode, timezone, payload
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
        [
          orgId,
          id,
          version,
          school.statutoryName,
          school.establishmentNumber,
          school.localAuthorityNumber,
          school.urn,
          school.schoolPhase,
          school.establishmentType,
          school.establishmentStatus,
          school.addressLine1,
          school.addressTown,
          school.addressPostcode,
          school.timezone,
          JSON.stringify({ schemaVersion: CENSUS_SNAPSHOT_SCHEMA_VERSION }),
        ],
      );
      for (const pupil of pupils) {
        const snap = pupilToSnapshotRow(pupil, asOf);
        await client.query(
          `insert into census_snapshot_pupils (
             organisation_id, census_run_id, snapshot_version, student_profile_id, admission_number,
             upn, former_upn, legal_surname, legal_forename, middle_names, preferred_name, date_of_birth,
             sex, ethnicity_code, language_code, enrolment_status_code, year_group_code, class_name,
             date_of_admission, date_of_leaving, leaving_reason_code, send_provision_code, fsm_eligible,
             looked_after_status, service_child, on_roll, payload
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb)`,
          [
            orgId,
            id,
            version,
            snap.studentProfileId,
            snap.admissionNumber,
            snap.upn,
            snap.formerUpn,
            snap.legalSurname,
            snap.legalForename,
            snap.middleNames,
            snap.preferredName,
            snap.dateOfBirth,
            snap.sex,
            snap.ethnicityCode,
            snap.languageCode,
            snap.enrolmentStatusCode,
            snap.yearGroupCode,
            snap.className,
            snap.dateOfAdmission,
            snap.dateOfLeaving,
            snap.leavingReasonCode,
            snap.sendProvisionCode,
            snap.fsmEligible,
            snap.lookedAfterStatus,
            snap.serviceChild,
            snap.onRoll,
            JSON.stringify(snap.payload),
          ],
        );
      }
      await client.query(
        `update census_runs
         set current_snapshot_version = $3, snapshot_schema_version = $4, status = 'draft'
         where id = $1 and organisation_id = $2`,
        [id, orgId, version, CENSUS_SNAPSHOT_SCHEMA_VERSION],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "statutory.census.snapshot",
        entityType: "census_run",
        entityId: id,
        after: auditSafeStatutoryAfter({ action: "snapshot_generated", version, status: "draft" }),
      });
      return c.json({ snapshotVersion: version, pupilCount: pupils.length, schemaVersion: CENSUS_SNAPSHOT_SCHEMA_VERSION });
    }),
  );

  app.post("/statutory/census/:id/validate", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanValidateStatutory(actor);
      const id = uuidRouteParam(c, "id");
      const run = await client.query(`select * from census_runs where id = $1 and organisation_id = $2`, [id, orgId]);
      if (!run.rows[0]) throw new AppError(404, "not_found", "Not found");
      const version = Number(run.rows[0].current_snapshot_version);
      if (version < 1) throw new AppError(409, "conflict", "Generate a snapshot before validating");
      const asOf = String(run.rows[0].census_date).slice(0, 10);
      const school = await loadSnapshotSchool(client, orgId, id, version);
      const pupils = await loadSnapshotPupils(client, orgId, id, version);
      const lookup = await loadStatutoryCodeLookup(client, String(run.rows[0].code_set_version));
      if (!school) throw new AppError(409, "conflict", "Snapshot school data is missing");
      await client.query(
        `update census_runs set status = 'validating' where id = $1 and organisation_id = $2`,
        [id, orgId],
      );
      const issues = validateStatutory({ asOf, school, pupils, codeLookup: lookup });
      await client.query(
        `delete from census_validation_issues where organisation_id = $1 and census_run_id = $2 and snapshot_version = $3`,
        [orgId, id, version],
      );
      for (const issue of issues) {
        await client.query(
          `insert into census_validation_issues (
             organisation_id, census_run_id, snapshot_version, source, rule_key, severity,
             entity_type, entity_id, field, message, metadata
           ) values ($1,$2,$3,'snapshot',$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [
            orgId,
            id,
            version,
            issue.ruleKey,
            issue.severity,
            issue.entityType,
            issue.entityId,
            issue.field,
            issue.message,
            JSON.stringify(issue.metadata),
          ],
        );
      }
      const counts = countIssues(issues);
      await client.query(
        `update census_runs
         set status = 'draft', error_count = $3, warning_count = $4, information_count = $5
         where id = $1 and organisation_id = $2`,
        [id, orgId, counts.errorCount, counts.warningCount, counts.informationCount],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "statutory.census.validated",
        entityType: "census_run",
        entityId: id,
        after: auditSafeStatutoryAfter({ action: "validate_snapshot", version, counts }),
      });
      return c.json({ snapshotVersion: version, counts });
    }),
  );

  app.post("/statutory/census/:id/finalise", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanFinaliseCensus(actor);
      const id = uuidRouteParam(c, "id");
      const run = await client.query(`select * from census_runs where id = $1 and organisation_id = $2`, [id, orgId]);
      if (!run.rows[0]) throw new AppError(404, "not_found", "Not found");
      if (!censusMayFinalise(String(run.rows[0].status))) {
        throw new AppError(409, "conflict", "This census cannot be finalised");
      }
      if (Number(run.rows[0].current_snapshot_version) < 1) {
        throw new AppError(409, "conflict", "Generate a snapshot before finalising");
      }
      if (Number(run.rows[0].error_count) > 0) {
        throw new AppError(409, "conflict", "Resolve snapshot errors before finalising");
      }
      await client.query(
        `update census_runs
         set status = 'ready', finalised_at = now(), finalised_by = $3
         where id = $1 and organisation_id = $2`,
        [id, orgId, userId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "statutory.census.finalised",
        entityType: "census_run",
        entityId: id,
        after: auditSafeStatutoryAfter({
          action: "finalised",
          status: "ready",
          version: Number(run.rows[0].current_snapshot_version),
        }),
      });
      return c.json({ ok: true, status: "ready" });
    }),
  );

  app.post("/statutory/census/:id/export", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanExportCensus(actor);
      const id = uuidRouteParam(c, "id");
      const format = (c.req.query("format") ?? "csv").toLowerCase();
      const run = await client.query(
        `select cr.*, ay.name as academic_year_name
         from census_runs cr
         join academic_years ay on ay.id = cr.academic_year_id
         where cr.id = $1 and cr.organisation_id = $2`,
        [id, orgId],
      );
      if (!run.rows[0]) throw new AppError(404, "not_found", "Not found");
      if (!censusMayExport(String(run.rows[0].status))) {
        throw new AppError(409, "conflict", "Finalise the census before exporting");
      }
      const version = Number(run.rows[0].current_snapshot_version);
      const school = await loadSnapshotSchool(client, orgId, id, version);
      const pupils = await loadSnapshotPupils(client, orgId, id, version);
      if (!school) throw new AppError(409, "conflict", "Snapshot is missing");
      if (String(run.rows[0].status) === "ready") {
        await client.query(
          `update census_runs set status = 'exported', exported_at = now(), exported_by = $3
           where id = $1 and organisation_id = $2`,
          [id, orgId, userId],
        );
      }
      const asOf = String(run.rows[0].census_date).slice(0, 10);
      await recordExport(client, {
        organisationId: orgId,
        actorUserId: userId,
        exportKind: format === "xml" ? "census_ready" : "census_snapshot",
        format: format === "xml" ? "xml" : "csv",
        rowCount: pupils.length,
        censusRunId: id,
        snapshotVersion: version,
      });
      if (format === "xml") {
        const xml = censusXmlPreview(
          {
            statutoryName: school.statutoryName,
            localAuthorityNumber: school.localAuthorityNumber,
            establishmentNumber: school.establishmentNumber,
            urn: school.urn,
            censusType: String(run.rows[0].census_type),
            censusDate: asOf,
            snapshotVersion: version,
            schemaVersion: CENSUS_SNAPSHOT_SCHEMA_VERSION,
          },
          pupils.map((pupil) => {
            const snap = pupilToSnapshotRow(pupil, asOf);
            return {
              admissionNumber: snap.admissionNumber,
              upn: snap.upn,
              legalSurname: snap.legalSurname,
              legalForename: snap.legalForename,
              middleNames: snap.middleNames,
              dateOfBirth: snap.dateOfBirth,
              sex: snap.sex,
              ethnicity: snap.ethnicityCode,
              language: snap.languageCode,
              enrolmentStatus: snap.enrolmentStatusCode,
              yearGroup: snap.yearGroupCode,
              className: snap.className,
              dateOfAdmission: snap.dateOfAdmission,
              sendProvision: snap.sendProvisionCode,
              fsmEligible: snap.fsmEligible,
              onRoll: snap.onRoll,
            };
          }),
        );
        return xmlFile(`census-preview-${asOf}-v${version}.xml`, xml);
      }
      const csv = toCsv(
        CENSUS_SNAPSHOT_COLUMNS,
        pupils.map((pupil) => {
          const snap = pupilToSnapshotRow(pupil, asOf);
          return [
            snap.admissionNumber,
            snap.upn,
            snap.legalSurname,
            snap.legalForename,
            snap.middleNames,
            snap.preferredName,
            snap.dateOfBirth,
            snap.sex,
            snap.ethnicityCode,
            snap.languageCode,
            snap.enrolmentStatusCode,
            snap.yearGroupCode,
            snap.className,
            snap.dateOfAdmission,
            snap.dateOfLeaving,
            snap.sendProvisionCode,
            snap.fsmEligible,
            snap.lookedAfterStatus,
            snap.serviceChild,
            snap.onRoll,
          ];
        }),
      );
      return csvFile(`census-snapshot-${asOf}-v${version}.csv`, csv);
    }),
  );

  app.post("/statutory/census/:id/supersede", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanFinaliseCensus(actor);
      const id = uuidRouteParam(c, "id");
      const run = await client.query(`select id, status from census_runs where id = $1 and organisation_id = $2`, [
        id,
        orgId,
      ]);
      if (!run.rows[0]) throw new AppError(404, "not_found", "Not found");
      if (!censusIsImmutable(String(run.rows[0].status)) && String(run.rows[0].status) !== "ready") {
        throw new AppError(409, "conflict", "Only ready or exported census runs can be superseded");
      }
      await client.query(`update census_runs set status = 'superseded' where id = $1 and organisation_id = $2`, [
        id,
        orgId,
      ]);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "statutory.census.superseded",
        entityType: "census_run",
        entityId: id,
        after: auditSafeStatutoryAfter({ action: "superseded", status: "superseded" }),
      });
      return c.json({ ok: true, status: "superseded" });
    }),
  );

  app.post("/statutory/census/:id/archive", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanFinaliseCensus(actor);
      const id = uuidRouteParam(c, "id");
      const run = await client.query(`select id from census_runs where id = $1 and organisation_id = $2`, [id, orgId]);
      if (!run.rows[0]) throw new AppError(404, "not_found", "Not found");
      await client.query(`update census_runs set status = 'archived' where id = $1 and organisation_id = $2`, [
        id,
        orgId,
      ]);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "statutory.census.archived",
        entityType: "census_run",
        entityId: id,
        after: auditSafeStatutoryAfter({ action: "archived", status: "archived" }),
      });
      return c.json({ ok: true, status: "archived" });
    }),
  );

  app.get("/reports/pupils", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canReadPupilRollReport(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const asOf = c.req.query("asOf") ?? new Date().toISOString().slice(0, 10);
      const search = (c.req.query("q") ?? "").trim().toLowerCase();
      const yearGroupId = c.req.query("yearGroupId");
      const status = c.req.query("status");
      const pupils = (await loadLiveStatutoryPupils(client, orgId)).filter((pupil) => {
        if (yearGroupId && pupil.yearGroupId !== yearGroupId) return false;
        if (status && pupil.enrolmentStatus !== status) return false;
        if (search && !`${pupil.legalName} ${pupil.admissionNumber ?? ""}`.toLowerCase().includes(search)) return false;
        return true;
      });
      const rows = pupils.map((pupil) => {
        const onRoll = isOnRollOnDate(
          {
            enrolmentStatus: pupil.enrolmentStatus,
            dateOfAdmission: pupil.dateOfAdmission,
            dateOfLeaving: pupil.dateOfLeaving,
            enrolments: pupil.enrolments,
          },
          asOf,
        );
        return {
          admissionNumber: pupil.admissionNumber,
          legalSurname: pupil.legalSurname,
          legalForename: pupil.legalForename,
          preferredName: pupil.preferredName,
          dateOfBirth: pupil.dateOfBirth,
          sex: pupil.sex,
          yearGroup: pupil.yearGroupCode,
          className: pupil.className,
          enrolmentStatus: pupil.enrolmentStatus,
          dateOfAdmission: pupil.dateOfAdmission,
          dateOfLeaving: pupil.dateOfLeaving,
          onRoll,
          studentProfileId: pupil.studentProfileId,
          legalName: pupil.legalName,
        };
      });
      if (wantsCsv(c)) {
        if (!canCreateReportExport(actor)) throw new AppError(403, "forbidden", "Missing permission");
        await recordExport(client, {
          organisationId: orgId,
          actorUserId: userId,
          exportKind: "pupil_roll",
          format: "csv",
          rowCount: rows.length,
          filters: { asOf, yearGroupId, status, q: search },
        });
        return csvFile(
          `pupil-roll-${asOf}.csv`,
          toCsv(
            PUPIL_ROLL_COLUMNS,
            rows.map((row) => [
              row.admissionNumber,
              row.legalSurname,
              row.legalForename,
              row.preferredName,
              row.dateOfBirth,
              row.sex,
              row.yearGroup,
              row.className,
              row.enrolmentStatus,
              row.dateOfAdmission,
              row.dateOfLeaving,
              row.onRoll,
            ]),
          ),
        );
      }
      return c.json({ asOf, pupils: rows });
    }),
  );

  app.get("/reports/attendance", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canReadAttendanceReport(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const from = c.req.query("from") ?? "2026-09-01";
      const to = c.req.query("to") ?? new Date().toISOString().slice(0, 10);
      const yearGroupId = c.req.query("yearGroupId");
      const classId = c.req.query("classId");
      const pupils = await loadLiveStatutoryPupils(client, orgId);
      const marks = await client.query<{
        student_profile_id: string;
        mark_date: string;
        category: string;
        statutory_category: string | null;
        class_id: string | null;
        year_group_id: string | null;
      }>(
        `select am.student_profile_id, am.mark_date::text, ac.category, ac.statutory_category,
                am.class_id, am.year_group_id
         from attendance_marks am
         join attendance_codes ac on ac.id = am.attendance_code_id
         where am.organisation_id = $1 and am.mark_date between $2 and $3`,
        [orgId, from, to],
      );
      const byPupil = new Map<string, typeof marks.rows>();
      for (const mark of marks.rows) {
        const list = byPupil.get(mark.student_profile_id) ?? [];
        list.push(mark);
        byPupil.set(mark.student_profile_id, list);
      }
      const pupilRows = pupils
        .filter((pupil) => !yearGroupId || pupil.yearGroupId === yearGroupId)
        .filter((pupil) => !classId || pupil.classId === classId)
        .map((pupil) => {
          const summary = summariseStatutoryAttendance(
            {
              enrolmentStatus: pupil.enrolmentStatus,
              dateOfAdmission: pupil.dateOfAdmission,
              dateOfLeaving: pupil.dateOfLeaving,
              enrolments: pupil.enrolments,
            },
            (byPupil.get(pupil.studentProfileId) ?? []).map((mark) => ({
              markDate: mark.mark_date,
              category: mark.category,
              statutoryCategory: mark.statutory_category,
            })),
          );
          return {
            studentProfileId: pupil.studentProfileId,
            admissionNumber: pupil.admissionNumber,
            legalName: pupil.legalName,
            yearGroup: pupil.yearGroupCode,
            yearGroupName: pupil.yearGroupName,
            className: pupil.className,
            classId: pupil.classId,
            yearGroupId: pupil.yearGroupId,
            ...summary,
          };
        });
      const yearGroups = groupAttendanceSummaries(
        pupilRows
          .filter((row) => row.yearGroupId)
          .map((row) => ({
            groupKey: row.yearGroupId!,
            groupLabel: row.yearGroupName ?? row.yearGroup ?? "Year group",
            summary: {
              sessionsPossible: row.sessionsPossible,
              sessionsPresent: row.sessionsPresent,
              authorisedAbsence: row.authorisedAbsence,
              unauthorisedAbsence: row.unauthorisedAbsence,
              late: row.late,
              notRequired: row.notRequired,
              attendancePercentage: row.attendancePercentage,
            },
          })),
      );
      const classes = groupAttendanceSummaries(
        pupilRows
          .filter((row) => row.classId)
          .map((row) => ({
            groupKey: row.classId!,
            groupLabel: row.className ?? "Class",
            summary: {
              sessionsPossible: row.sessionsPossible,
              sessionsPresent: row.sessionsPresent,
              authorisedAbsence: row.authorisedAbsence,
              unauthorisedAbsence: row.unauthorisedAbsence,
              late: row.late,
              notRequired: row.notRequired,
              attendancePercentage: row.attendancePercentage,
            },
          })),
      );
      if (wantsCsv(c)) {
        if (!canCreateReportExport(actor)) throw new AppError(403, "forbidden", "Missing permission");
        await recordExport(client, {
          organisationId: orgId,
          actorUserId: userId,
          exportKind: "attendance_summary",
          format: "csv",
          rowCount: pupilRows.length,
          filters: { from, to, yearGroupId, classId },
        });
        return csvFile(
          `attendance-summary-${from}-to-${to}.csv`,
          toCsv(
            ATTENDANCE_SUMMARY_COLUMNS,
            pupilRows.map((row) => [
              row.admissionNumber,
              row.legalName,
              row.yearGroup,
              row.className,
              row.sessionsPossible,
              row.sessionsPresent,
              row.authorisedAbsence,
              row.unauthorisedAbsence,
              row.late,
              row.attendancePercentage,
            ]),
          ),
        );
      }
      return c.json({ from, to, pupils: pupilRows, yearGroups, classes });
    }),
  );

  app.get("/reports/admissions", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canReadAdmissionsReport(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const from = c.req.query("from") ?? "2026-09-01";
      const to = c.req.query("to") ?? "2027-07-31";
      const pupils = await loadLiveStatutoryPupils(client, orgId);
      const rows = pupils.map((pupil) => ({
        studentProfileId: pupil.studentProfileId,
        admissionNumber: pupil.admissionNumber,
        legalName: pupil.legalName,
        enrolmentStatus: pupil.enrolmentStatus,
        yearGroup: pupil.yearGroupCode,
        dateOfAdmission: pupil.dateOfAdmission,
        dateOfLeaving: pupil.dateOfLeaving,
        leavingReason: pupil.leavingReasonCode,
        previousSchool: pupil.previousSchoolName,
        admittedInPeriod: wasAdmittedDuringPeriod(
          {
            enrolmentStatus: pupil.enrolmentStatus,
            dateOfAdmission: pupil.dateOfAdmission,
            dateOfLeaving: pupil.dateOfLeaving,
            enrolments: pupil.enrolments,
          },
          from,
          to,
        ),
        leftInPeriod: leftDuringPeriod(
          {
            enrolmentStatus: pupil.enrolmentStatus,
            dateOfAdmission: pupil.dateOfAdmission,
            dateOfLeaving: pupil.dateOfLeaving,
            enrolments: pupil.enrolments,
          },
          from,
          to,
        ),
      }));
      if (wantsCsv(c)) {
        if (!canCreateReportExport(actor)) throw new AppError(403, "forbidden", "Missing permission");
        await recordExport(client, {
          organisationId: orgId,
          actorUserId: userId,
          exportKind: "admissions_enrolment",
          format: "csv",
          rowCount: rows.length,
          filters: { from, to },
        });
        return csvFile(
          `admissions-enrolment-${from}-to-${to}.csv`,
          toCsv(
            ADMISSIONS_ENROLMENT_COLUMNS,
            rows.map((row) => [
              row.admissionNumber,
              row.legalName,
              row.enrolmentStatus,
              row.yearGroup,
              row.dateOfAdmission,
              row.dateOfLeaving,
              row.leavingReason,
              row.previousSchool,
            ]),
          ),
        );
      }
      return c.json({ from, to, pupils: rows });
    }),
  );

  app.get("/reports/send", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertCanReadSendReport(actor);
      const pupils = await loadLiveStatutoryPupils(client, orgId);
      const rows = pupils
        .filter((pupil) => pupil.sendProvisionCode === "K" || pupil.sendProvisionCode === "E" || pupil.sendNotes)
        .map((pupil) => ({
          studentProfileId: pupil.studentProfileId,
          admissionNumber: pupil.admissionNumber,
          legalName: pupil.legalName,
          yearGroup: pupil.yearGroupCode,
          sendProvision: pupil.sendProvisionCode,
          hasAdditionalNeedsRecord: Boolean(pupil.sendNotes),
        }));
      if (wantsCsv(c)) {
        if (!canCreateReportExport(actor) || !canReadSendReport(actor)) {
          throw new AppError(403, "forbidden", "Missing permission");
        }
        await recordExport(client, {
          organisationId: orgId,
          actorUserId: userId,
          exportKind: "send_additional_needs",
          format: "csv",
          rowCount: rows.length,
        });
        return csvFile(
          "send-additional-needs.csv",
          toCsv(
            SEND_EXPORT_COLUMNS,
            rows.map((row) => [
              row.admissionNumber,
              row.legalName,
              row.yearGroup,
              row.sendProvision,
              row.hasAdditionalNeedsRecord,
            ]),
          ),
        );
      }
      return c.json({ pupils: rows });
    }),
  );

  app.get("/reports/exports", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canCreateReportExport(actor) && !actor.permissions.has(PERMISSIONS.STATUTORY_READ)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const rows = await client.query(
        `select id, export_kind, format, census_run_id, snapshot_version, row_count, created_at
         from data_exports
         where organisation_id = $1
         order by created_at desc
         limit 100`,
        [orgId],
      );
      return c.json({
        exports: rows.rows.map((row) => ({
          id: row.id,
          exportKind: row.export_kind,
          format: row.format,
          censusRunId: row.census_run_id,
          snapshotVersion: row.snapshot_version,
          rowCount: row.row_count,
          createdAt: row.created_at,
        })),
      });
    }),
  );
}
