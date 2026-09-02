import { z } from "zod";
import {
  NON_TEACHING_EVENT_TYPE_KEYS,
  PERMISSIONS,
  SYSTEM_YEAR_GROUP_DELETE_REASON,
  isAcademicRecordStatus,
  isSystemYearGroup,
  parseSubjectCreateInput,
  parseSubjectUpdateInput,
  rejectClearCurrentAcademicYear,
  rejectSetArchivedAcademicYearCurrent,
  resolveCreatedAcademicYearCurrent,
  termKeyFromName,
  uniqueTermKey,
  validateClosureRange,
  validateTermDates,
} from "@schoolapp/domain";
import {
  AppError,
  assertAnyPermission,
  assertPermission,
  canListAllStudents,
  currentAcademicYear,
  deleteConfigOnlyYearGroupLinks,
  deletionBlockedError,
  includeArchivedRequested,
  isAssignedToClass,
  loadAcademicLifecycle,
  loadTermLifecycle,
  writeAudit,
} from "@schoolapp/core";
import { upsertYearGroupPortalOverride } from "./student-portal";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { academicReadPermissions, withSchoolActor, routeParam } from "../school-context";
import {
  mapAcademicYear,
  mapAcademicClosure,
  mapClass,
  mapHalfTerm,
  mapHouse,
  mapSubject,
  mapTerm,
  mapYearGroup,
} from "../serialize";

const yearSchema = z.object({
  name: z.string().min(1).max(32),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  isCurrent: z.boolean().optional(),
});

const termSchema = z.object({
  key: z.string().min(1).max(32).optional(),
  name: z.string().min(1).max(80),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  sortOrder: z.number().int().min(0).max(20).optional(),
});

const yearGroupSchema = z.object({
  code: z.string().min(1).max(8),
  name: z.string().min(1).max(80).optional(),
  studentLoginEnabled: z.boolean().optional(),
});

const subjectSchema = z.object({
  key: z.string().optional(),
  name: z.string().optional(),
});

const classSchema = z.object({
  name: z.string().min(1).max(80),
  academicYearId: z.string().uuid(),
  yearGroupId: z.string().uuid().nullable().optional(),
  classType: z.enum(["form", "teaching"]).default("form"),
});

export function registerAcademicRoutes(app: SchoolappApi) {
  app.get("/academic-years", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const rows = await client.query(
        `select id, name, starts_on::text, ends_on::text, is_current, status, created_at
         from academic_years
         where organisation_id = $1
           and ($2::boolean or status = 'active')
         order by starts_on desc`,
        [orgId, includeArchivedRequested(c.req.query("includeArchived"))],
      );
      return c.json({ academicYears: rows.rows.map(mapAcademicYear) });
    }),
  );

  app.get("/academic-years/current", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const year = await currentAcademicYear(client, orgId);
      if (!year) {
        throw new AppError(404, "not_found", "This school has no current academic year.");
      }
      const full = await loadAcademicYearRow(client, orgId, year.id);
      return c.json({ academicYear: mapAcademicYear(full ?? year) });
    }),
  );

  app.post("/academic-years", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = yearSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid academic year payload");
      }
      if (parsed.data.endsOn < parsed.data.startsOn) {
        throw new AppError(400, "validation_failed", "Academic year end must be on or after start");
      }
      const existing = await client.query<{ n: string }>(
        `select count(*)::text as n from academic_years where organisation_id = $1`,
        [orgId],
      );
      // First year must be current. Do not silently pick a current year when
      // years already exist with none marked current (legacy / pre-invariant).
      const isCurrent = resolveCreatedAcademicYearCurrent(
        Number(existing.rows[0]?.n ?? 0),
        parsed.data.isCurrent,
      );
      const inserted = await client.query(
        `insert into academic_years (
           organisation_id, name, starts_on, ends_on, is_current
         ) values ($1, $2, $3, $4, $5)
         returning id, name, starts_on::text, ends_on::text, is_current, status, created_at`,
        [orgId, parsed.data.name, parsed.data.startsOn, parsed.data.endsOn, isCurrent],
      );
      const row = inserted.rows[0]!;
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.year.created",
        entityType: "academic_year",
        entityId: String(row.id),
        after: mapAcademicYear(row),
      });
      return c.json({ academicYear: mapAcademicYear(row) }, 201);
    }),
  );

  app.patch("/academic-years/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = yearSchema.partial().safeParse(await c.req.json());
      if (!parsed.success) {
        throw new AppError(400, "validation_failed", "Invalid academic year payload");
      }
      const existing = await client.query(
        `select id, name, starts_on::text, ends_on::text, is_current, status, created_at
         from academic_years where id = $1 and organisation_id = $2`,
        [routeParam(c, "id"), orgId],
      );
      if (!existing.rows[0]) {
        throw new AppError(404, "not_found", "Not found");
      }
      const current = existing.rows[0];
      const clearCurrent = rejectClearCurrentAcademicYear(Boolean(current.is_current), parsed.data.isCurrent);
      if (clearCurrent.reject) {
        throw new AppError(409, clearCurrent.code, clearCurrent.message);
      }
      const status = isAcademicRecordStatus(current.status) ? current.status : "active";
      const archivedCurrent = rejectSetArchivedAcademicYearCurrent(status, parsed.data.isCurrent);
      if (archivedCurrent.reject) {
        throw new AppError(409, archivedCurrent.code, archivedCurrent.message);
      }
      const updated = await client.query(
        `update academic_years
         set name = $3, starts_on = $4, ends_on = $5, is_current = $6
         where id = $1 and organisation_id = $2
         returning id, name, starts_on::text, ends_on::text, is_current, status, created_at`,
        [
          routeParam(c, "id"),
          orgId,
          parsed.data.name ?? current.name,
          parsed.data.startsOn ?? current.starts_on,
          parsed.data.endsOn ?? current.ends_on,
          parsed.data.isCurrent ?? current.is_current,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.year.updated",
        entityType: "academic_year",
        entityId: routeParam(c, "id"),
        before: mapAcademicYear(existing.rows[0]),
        after: mapAcademicYear(updated.rows[0]!),
      });
      return c.json({ academicYear: mapAcademicYear(updated.rows[0]!) });
    }),
  );

  app.get("/academic-years/:id/lifecycle", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const existing = await client.query(
        `select id, name, starts_on::text, ends_on::text, is_current, status, created_at
         from academic_years where id = $1 and organisation_id = $2`,
        [routeParam(c, "id"), orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const status = isAcademicRecordStatus(existing.rows[0].status) ? existing.rows[0].status : "active";
      const extra = existing.rows[0].is_current
        ? ["The current academic year cannot be removed until another year is set as current."]
        : [];
      const lifecycle = await loadAcademicLifecycle(client, "academic_year", routeParam(c, "id"), orgId, status, {
        extraBlockReasons: extra,
        archiveBlockedReasons: extra,
        entityLabel: "This academic year",
      });
      return c.json({ academicYear: mapAcademicYear(existing.rows[0]), lifecycle });
    }),
  );

  app.post("/academic-years/:id/archive", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const existing = await client.query(
        `select id, name, starts_on::text, ends_on::text, is_current, status, created_at
         from academic_years where id = $1 and organisation_id = $2`,
        [routeParam(c, "id"), orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      if (existing.rows[0].is_current) {
        throw new AppError(
          409,
          "cannot_archive",
          "The current academic year cannot be archived. Set another year as current first.",
        );
      }
      await setAcademicStatus(client, {
        table: "academic_years",
        id: routeParam(c, "id"),
        orgId,
        userId,
        status: "archived",
        entityType: "academic_year",
        action: "academic.year.archived",
        mapRow: mapAcademicYear,
      });
      return c.json({ academicYear: mapAcademicYear((await loadAcademicYearRow(client, orgId, routeParam(c, "id")))!) });
    }),
  );

  app.post("/academic-years/:id/restore", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      await setAcademicStatus(client, {
        table: "academic_years",
        id: routeParam(c, "id"),
        orgId,
        userId,
        status: "active",
        entityType: "academic_year",
        action: "academic.year.restored",
        mapRow: mapAcademicYear,
      });
      return c.json({ academicYear: mapAcademicYear((await loadAcademicYearRow(client, orgId, routeParam(c, "id")))!) });
    }),
  );

  app.delete("/academic-years/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const existing = await client.query(
        `select id, name, starts_on::text, ends_on::text, is_current, status, created_at
         from academic_years where id = $1 and organisation_id = $2`,
        [routeParam(c, "id"), orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const extra = existing.rows[0].is_current
        ? ["The current academic year cannot be removed until another year is set as current."]
        : [];
      const status = isAcademicRecordStatus(existing.rows[0].status) ? existing.rows[0].status : "active";
      const lifecycle = await loadAcademicLifecycle(client, "academic_year", routeParam(c, "id"), orgId, status, {
        extraBlockReasons: extra,
        entityLabel: "This academic year",
      });
      if (!lifecycle.canDelete) {
        const blocked = deletionBlockedError("This academic year", lifecycle);
        throw new AppError(409, blocked.code, blocked.message, blocked.details);
      }
      await client.query(`delete from academic_years where id = $1 and organisation_id = $2`, [
        routeParam(c, "id"),
        orgId,
      ]);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.year.deleted",
        entityType: "academic_year",
        entityId: routeParam(c, "id"),
        before: mapAcademicYear(existing.rows[0]),
      });
      return c.json({ ok: true });
    }),
  );

  app.get("/academic-years/:id/terms", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const year = await loadAcademicYearRow(client, orgId, routeParam(c, "id"));
      if (!year) throw new AppError(404, "not_found", "Not found");
      const rows = await listTermsForYear(client, orgId, routeParam(c, "id"));
      const halfTerms = await listHalfTermsForYear(client, orgId, routeParam(c, "id"));
      const closures = await listClosuresForYear(client, orgId, routeParam(c, "id"));
      return c.json({
        academicYear: mapAcademicYear(year),
        terms: rows.map(mapTerm),
        halfTerms: halfTerms.map(mapHalfTerm),
        closures: closures.map(mapAcademicClosure),
      });
    }),
  );

  app.post("/academic-years/:id/terms", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = termSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid term payload");
      const year = await loadAcademicYearRow(client, orgId, routeParam(c, "id"));
      if (!year) throw new AppError(404, "not_found", "Not found");
      const status = isAcademicRecordStatus(year.status) ? year.status : "active";
      if (status === "archived") {
        throw new AppError(409, "cannot_create", "Archived academic years cannot receive new terms.");
      }
      const existingTerms = await listTermsForYear(client, orgId, String(year.id));
      const bounds = validateTermDates({
        startsOn: parsed.data.startsOn,
        endsOn: parsed.data.endsOn,
        yearStartsOn: String(year.starts_on),
        yearEndsOn: String(year.ends_on),
        otherTerms: existingTerms.map((term) => ({
          id: String(term.id),
          startsOn: String(term.starts_on),
          endsOn: String(term.ends_on),
        })),
      });
      if (!bounds.ok) throw new AppError(400, "validation_failed", bounds.error);
      const key = uniqueTermKey(
        parsed.data.key?.trim() || termKeyFromName(parsed.data.name),
        existingTerms.map((term) => String(term.key)),
      );
      const sortOrder =
        parsed.data.sortOrder ??
        existingTerms.reduce((max, term) => Math.max(max, Number(term.sort_order) || 0), 0) + 1;
      const inserted = await client.query(
        `insert into terms (
           organisation_id, academic_year_id, key, name, starts_on, ends_on, sort_order
         ) values ($1, $2, $3, $4, $5, $6, $7)
         returning id, academic_year_id, key, name, starts_on::text, ends_on::text, sort_order`,
        [orgId, year.id, key, parsed.data.name, parsed.data.startsOn, parsed.data.endsOn, sortOrder],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.term.created",
        entityType: "term",
        entityId: String(inserted.rows[0]!.id),
        after: mapTerm(inserted.rows[0]!),
      });
      return c.json({ term: mapTerm(inserted.rows[0]!) }, 201);
    }),
  );

  app.get("/terms/:id/lifecycle", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const term = await loadTermRow(client, orgId, routeParam(c, "id"));
      if (!term) throw new AppError(404, "not_found", "Not found");
      const lifecycle = await loadTermLifecycle(client, orgId, String(term.id));
      return c.json({ term: mapTerm(term), lifecycle });
    }),
  );

  app.patch("/terms/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = termSchema.partial().safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid term payload");
      const existing = await loadTermRow(client, orgId, routeParam(c, "id"));
      if (!existing) throw new AppError(404, "not_found", "Not found");
      const year = await loadAcademicYearRow(client, orgId, String(existing.academic_year_id));
      if (!year) throw new AppError(404, "not_found", "Not found");
      const startsOn = parsed.data.startsOn ?? String(existing.starts_on);
      const endsOn = parsed.data.endsOn ?? String(existing.ends_on);
      const others = await listTermsForYear(client, orgId, String(existing.academic_year_id));
      const bounds = validateTermDates({
        startsOn,
        endsOn,
        yearStartsOn: String(year.starts_on),
        yearEndsOn: String(year.ends_on),
        otherTerms: others.map((term) => ({
          id: String(term.id),
          startsOn: String(term.starts_on),
          endsOn: String(term.ends_on),
        })),
        ignoreTermId: String(existing.id),
      });
      if (!bounds.ok) throw new AppError(400, "validation_failed", bounds.error);
      const updated = await client.query(
        `update terms
         set name = coalesce($3, name),
             key = coalesce($4, key),
             starts_on = $5,
             ends_on = $6,
             sort_order = coalesce($7, sort_order)
         where id = $1 and organisation_id = $2
         returning id, academic_year_id, key, name, starts_on::text, ends_on::text, sort_order`,
        [
          existing.id,
          orgId,
          parsed.data.name ?? null,
          parsed.data.key ?? null,
          startsOn,
          endsOn,
          parsed.data.sortOrder ?? null,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.term.updated",
        entityType: "term",
        entityId: String(existing.id),
        before: mapTerm(existing),
        after: mapTerm(updated.rows[0]!),
      });
      return c.json({ term: mapTerm(updated.rows[0]!) });
    }),
  );

  app.delete("/terms/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const existing = await loadTermRow(client, orgId, routeParam(c, "id"));
      if (!existing) throw new AppError(404, "not_found", "Not found");
      const lifecycle = await loadTermLifecycle(client, orgId, String(existing.id));
      if (!lifecycle.canDelete) {
        throw new AppError(409, "cannot_delete", lifecycle.message, {
          canArchive: false,
          usage: lifecycle.usage,
        });
      }
      await client.query(`delete from terms where id = $1 and organisation_id = $2`, [existing.id, orgId]);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.term.deleted",
        entityType: "term",
        entityId: String(existing.id),
        before: mapTerm(existing),
      });
      return c.json({ ok: true });
    }),
  );

  const halfTermSchema = z.object({
    termId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    startsOn: z.string().date(),
    endsOn: z.string().date(),
    sortOrder: z.number().int().min(0).max(20).optional(),
  });
  const closureSchema = z.object({
    kind: z.enum(["bank_holiday", "inset_day", "school_closure", "other"]),
    title: z.string().trim().min(1).max(160),
    description: z.string().max(400).nullable().optional(),
    startsOn: z.string().date(),
    endsOn: z.string().date(),
  });

  app.post("/academic-years/:id/half-terms", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = halfTermSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid half term");
      const year = await loadAcademicYearRow(client, orgId, routeParam(c, "id"));
      if (!year) throw new AppError(404, "not_found", "Not found");
      const term = await loadTermRow(client, orgId, parsed.data.termId);
      if (!term || String(term.academic_year_id) !== String(year.id)) {
        throw new AppError(404, "not_found", "Not found");
      }
      const others = await listHalfTermsForYear(client, orgId, String(year.id));
      const bounds = validateClosureRange({
        startsOn: parsed.data.startsOn,
        endsOn: parsed.data.endsOn,
        yearStartsOn: String(year.starts_on),
        yearEndsOn: String(year.ends_on),
        termStartsOn: String(term.starts_on),
        termEndsOn: String(term.ends_on),
        otherClosures: others.map((row) => ({
          id: String(row.id),
          startsOn: String(row.starts_on),
          endsOn: String(row.ends_on),
        })),
      });
      if (!bounds.ok) throw new AppError(400, "validation_failed", bounds.error);
      const inserted = await client.query(
        `insert into half_terms (organisation_id, term_id, name, starts_on, ends_on, sort_order)
         values ($1,$2,$3,$4,$5,$6)
         returning id, term_id, name, starts_on::text, ends_on::text, sort_order`,
        [
          orgId,
          parsed.data.termId,
          parsed.data.name,
          parsed.data.startsOn,
          parsed.data.endsOn,
          parsed.data.sortOrder ?? 1,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.half_term.created",
        entityType: "half_term",
        entityId: String(inserted.rows[0]!.id),
        after: mapHalfTerm({ ...inserted.rows[0]!, term_name: term.name }),
      });
      return c.json({ halfTerm: mapHalfTerm({ ...inserted.rows[0]!, term_name: term.name }) }, 201);
    }),
  );

  app.patch("/half-terms/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = halfTermSchema.partial().safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid half term");
      const existing = await client.query(
        `select ht.id, ht.term_id, ht.name, ht.starts_on::text, ht.ends_on::text, ht.sort_order, t.name as term_name,
                t.starts_on::text as term_starts_on, t.ends_on::text as term_ends_on, t.academic_year_id
           from half_terms ht
           join terms t on t.id = ht.term_id
          where ht.id = $1 and ht.organisation_id = $2`,
        [routeParam(c, "id"), orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const row = existing.rows[0];
      const year = await loadAcademicYearRow(client, orgId, String(row.academic_year_id));
      if (!year) throw new AppError(404, "not_found", "Not found");
      const startsOn = parsed.data.startsOn ?? String(row.starts_on);
      const endsOn = parsed.data.endsOn ?? String(row.ends_on);
      const others = await listHalfTermsForYear(client, orgId, String(year.id));
      const bounds = validateClosureRange({
        startsOn,
        endsOn,
        yearStartsOn: String(year.starts_on),
        yearEndsOn: String(year.ends_on),
        termStartsOn: String(row.term_starts_on),
        termEndsOn: String(row.term_ends_on),
        otherClosures: others.map((item) => ({
          id: String(item.id),
          startsOn: String(item.starts_on),
          endsOn: String(item.ends_on),
        })),
        ignoreId: String(row.id),
      });
      if (!bounds.ok) throw new AppError(400, "validation_failed", bounds.error);
      const updated = await client.query(
        `update half_terms
            set name = coalesce($3, name), starts_on = $4, ends_on = $5, sort_order = coalesce($6, sort_order)
          where id = $1 and organisation_id = $2
          returning id, term_id, name, starts_on::text, ends_on::text, sort_order`,
        [row.id, orgId, parsed.data.name ?? null, startsOn, endsOn, parsed.data.sortOrder ?? null],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.half_term.updated",
        entityType: "half_term",
        entityId: String(row.id),
        before: mapHalfTerm(row),
        after: mapHalfTerm({ ...updated.rows[0]!, term_name: row.term_name }),
      });
      return c.json({ halfTerm: mapHalfTerm({ ...updated.rows[0]!, term_name: row.term_name }) });
    }),
  );

  app.delete("/half-terms/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const existing = await client.query(
        `select ht.*, t.name as term_name from half_terms ht join terms t on t.id = ht.term_id
          where ht.id = $1 and ht.organisation_id = $2`,
        [routeParam(c, "id"), orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      await client.query(`delete from half_terms where id = $1 and organisation_id = $2`, [
        existing.rows[0].id,
        orgId,
      ]);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.half_term.deleted",
        entityType: "half_term",
        entityId: String(existing.rows[0].id),
        before: mapHalfTerm(existing.rows[0]),
      });
      return c.json({ ok: true });
    }),
  );

  app.post("/academic-years/:id/closures", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = closureSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid non-teaching date");
      const year = await loadAcademicYearRow(client, orgId, routeParam(c, "id"));
      if (!year) throw new AppError(404, "not_found", "Not found");
      const others = await listClosuresForYear(client, orgId, String(year.id));
      const bounds = validateClosureRange({
        startsOn: parsed.data.startsOn,
        endsOn: parsed.data.endsOn,
        yearStartsOn: String(year.starts_on),
        yearEndsOn: String(year.ends_on),
        otherClosures: others.map((row) => ({
          id: String(row.id),
          startsOn: String(row.starts_on).slice(0, 10),
          endsOn: String(row.ends_on).slice(0, 10),
        })),
      });
      if (!bounds.ok) throw new AppError(400, "validation_failed", bounds.error);
      const eventTypeKey =
        parsed.data.kind === "other"
          ? "non_teaching"
          : parsed.data.kind === "school_closure"
            ? "school_closure"
            : parsed.data.kind;
      const type = await client.query<{ id: string }>(
        `select id from school_event_types where organisation_id = $1 and key = $2`,
        [orgId, eventTypeKey],
      );
      if (!type.rows[0]) throw new AppError(400, "validation_failed", "Unknown calendar type");
      const inserted = await client.query(
        `insert into school_events (
           organisation_id, title, description, event_type_id, starts_at, ends_at, all_day,
           status, publish_at, published_at, related_kind, related_id, created_by, published_by
         ) values ($1,$2,$3,$4,$5,$6,true,'published', now(), now(), 'academic_year', $7, $8, $8)
         returning id, title, description, starts_at::date::text as starts_on, ends_at::date::text as ends_on`,
        [
          orgId,
          parsed.data.title,
          parsed.data.description ?? null,
          type.rows[0].id,
          `${parsed.data.startsOn}T00:00:00.000Z`,
          `${parsed.data.endsOn}T23:59:59.000Z`,
          year.id,
          userId,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.closure.created",
        entityType: "school_event",
        entityId: String(inserted.rows[0]!.id),
        after: { title: parsed.data.title, startsOn: parsed.data.startsOn, endsOn: parsed.data.endsOn },
      });
      return c.json(
        {
          closure: mapAcademicClosure({
            ...inserted.rows[0],
            event_type_key: eventTypeKey,
          }),
        },
        201,
      );
    }),
  );

  app.patch("/closures/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = closureSchema.partial().safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid non-teaching date");
      const existing = await loadClosureRow(client, orgId, routeParam(c, "id"));
      if (!existing) throw new AppError(404, "not_found", "Not found");
      const year = await loadAcademicYearRow(client, orgId, String(existing.related_id));
      if (!year) throw new AppError(404, "not_found", "Not found");
      const startsOn = parsed.data.startsOn ?? String(existing.starts_on).slice(0, 10);
      const endsOn = parsed.data.endsOn ?? String(existing.ends_on).slice(0, 10);
      const others = await listClosuresForYear(client, orgId, String(year.id));
      const bounds = validateClosureRange({
        startsOn,
        endsOn,
        yearStartsOn: String(year.starts_on),
        yearEndsOn: String(year.ends_on),
        otherClosures: others.map((row) => ({
          id: String(row.id),
          startsOn: String(row.starts_on).slice(0, 10),
          endsOn: String(row.ends_on).slice(0, 10),
        })),
        ignoreId: String(existing.id),
      });
      if (!bounds.ok) throw new AppError(400, "validation_failed", bounds.error);
      await client.query(
        `update school_events
            set title = coalesce($3, title),
                description = coalesce($4, description),
                starts_at = $5,
                ends_at = $6
          where id = $1 and organisation_id = $2`,
        [
          existing.id,
          orgId,
          parsed.data.title ?? null,
          parsed.data.description === undefined ? null : parsed.data.description,
          `${startsOn}T00:00:00.000Z`,
          `${endsOn}T23:59:59.000Z`,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.closure.updated",
        entityType: "school_event",
        entityId: String(existing.id),
      });
      const updated = await loadClosureRow(client, orgId, String(existing.id));
      return c.json({ closure: mapAcademicClosure(updated!) });
    }),
  );

  app.delete("/closures/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const existing = await loadClosureRow(client, orgId, routeParam(c, "id"));
      if (!existing) throw new AppError(404, "not_found", "Not found");
      await client.query(`delete from school_events where id = $1 and organisation_id = $2`, [existing.id, orgId]);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.closure.deleted",
        entityType: "school_event",
        entityId: String(existing.id),
        before: mapAcademicClosure(existing),
      });
      return c.json({ ok: true });
    }),
  );

  app.get("/academic-years/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const year = await loadAcademicYearRow(client, orgId, routeParam(c, "id"));
      if (!year) throw new AppError(404, "not_found", "Not found");
      return c.json({ academicYear: mapAcademicYear(year) });
    }),
  );

  app.get("/year-groups", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const rows = await client.query(
        `select yg.id, yg.code, yg.name, yg.key_stage, yg.sort_order, yg.status, yg.origin,
                ovr.enabled as portal_override,
                coalesce(ovr.enabled, pol.default_enabled, false) as student_login_enabled
         from year_groups yg
         left join student_portal_year_group_overrides ovr
           on ovr.year_group_id = yg.id and ovr.organisation_id = yg.organisation_id
         left join student_portal_policies pol on pol.organisation_id = yg.organisation_id
         where yg.organisation_id = $1
           and ($2::boolean or yg.status = 'active')
         order by yg.sort_order, yg.code`,
        [orgId, includeArchivedRequested(c.req.query("includeArchived"))],
      );
      return c.json({ yearGroups: rows.rows.map(mapYearGroup) });
    }),
  );

  app.post("/year-groups", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = yearGroupSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid year group payload");
      if (parsed.data.studentLoginEnabled !== undefined) {
        assertPermission(actor, PERMISSIONS.STUDENTS_PORTAL_ACCESS_MANAGE);
      }
      const inserted = await client.query(
        `insert into year_groups (organisation_id, code, name, student_login_enabled, sort_order, origin)
         values ($1, $2, $3, $4, coalesce((select year_group_code_rank($2)), 0), 'custom')
         returning id, code, name, key_stage, sort_order, student_login_enabled, status, origin`,
        [
          orgId,
          parsed.data.code,
          parsed.data.name ?? defaultYearName(parsed.data.code),
          parsed.data.studentLoginEnabled ?? false,
        ],
      );
      if (parsed.data.studentLoginEnabled !== undefined) {
        await upsertYearGroupPortalOverride(
          client,
          orgId,
          String(inserted.rows[0]!.id),
          parsed.data.studentLoginEnabled,
        );
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.year_group.created",
        entityType: "year_group",
        entityId: String(inserted.rows[0]!.id),
        after: mapYearGroup(inserted.rows[0]!),
      });
      return c.json({ yearGroup: mapYearGroup(inserted.rows[0]!) }, 201);
    }),
  );

  app.post("/year-groups/seed", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const result = await client.query<{ seed_standard_year_groups: number }>(
        "select seed_standard_year_groups($1, $2)",
        [userId, orgId],
      );
      const rows = await client.query(
        `select yg.id, yg.code, yg.name, yg.key_stage, yg.sort_order, yg.status, yg.origin,
                ovr.enabled as portal_override,
                coalesce(ovr.enabled, pol.default_enabled, false) as student_login_enabled
         from year_groups yg
         left join student_portal_year_group_overrides ovr
           on ovr.year_group_id = yg.id and ovr.organisation_id = yg.organisation_id
         left join student_portal_policies pol on pol.organisation_id = yg.organisation_id
         where yg.organisation_id = $1 order by yg.sort_order, yg.code`,
        [orgId],
      );
      return c.json({
        created: result.rows[0]?.seed_standard_year_groups ?? 0,
        yearGroups: rows.rows.map(mapYearGroup),
      });
    }),
  );

  app.patch("/year-groups/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = yearGroupSchema.partial().safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid year group payload");
      if (parsed.data.studentLoginEnabled !== undefined) {
        assertPermission(actor, PERMISSIONS.STUDENTS_PORTAL_ACCESS_MANAGE);
      }
      const existing = await client.query(
        `select id, code, name, key_stage, sort_order, student_login_enabled, status, origin
         from year_groups where id = $1 and organisation_id = $2`,
        [routeParam(c, "id"), orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const updated = await client.query(
        `update year_groups
         set name = coalesce($3, name),
             student_login_enabled = coalesce($4, student_login_enabled)
         where id = $1 and organisation_id = $2
         returning id, code, name, key_stage, sort_order, student_login_enabled, status, origin`,
        [
          routeParam(c, "id"),
          orgId,
          parsed.data.name ?? null,
          parsed.data.studentLoginEnabled ?? null,
        ],
      );
      if (parsed.data.studentLoginEnabled !== undefined) {
        await upsertYearGroupPortalOverride(
          client,
          orgId,
          String(updated.rows[0]!.id),
          parsed.data.studentLoginEnabled,
        );
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.year_group.updated",
        entityType: "year_group",
        entityId: routeParam(c, "id"),
        before: mapYearGroup(existing.rows[0]),
        after: mapYearGroup(updated.rows[0]!),
      });
      return c.json({ yearGroup: mapYearGroup(updated.rows[0]!) });
    }),
  );

  app.get("/year-groups/:id/lifecycle", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const existing = await client.query(
        `select id, code, name, key_stage, sort_order, student_login_enabled, status, origin
         from year_groups where id = $1 and organisation_id = $2`,
        [routeParam(c, "id"), orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const status = isAcademicRecordStatus(existing.rows[0].status) ? existing.rows[0].status : "active";
      const lifecycle = await loadAcademicLifecycle(client, "year_group", routeParam(c, "id"), orgId, status, {
        extraBlockReasons: isSystemYearGroup(existing.rows[0].origin) ? [SYSTEM_YEAR_GROUP_DELETE_REASON] : [],
        entityLabel: "This year group",
      });
      return c.json({ yearGroup: mapYearGroup(existing.rows[0]), lifecycle });
    }),
  );

  app.post("/year-groups/:id/archive", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      return c.json({
        yearGroup: mapYearGroup(
          await setAcademicStatus(client, {
            table: "year_groups",
            id: routeParam(c, "id"),
            orgId,
            userId,
            status: "archived",
            entityType: "year_group",
            action: "academic.year_group.archived",
            mapRow: mapYearGroup,
          }),
        ),
      });
    }),
  );

  app.post("/year-groups/:id/restore", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      return c.json({
        yearGroup: mapYearGroup(
          await setAcademicStatus(client, {
            table: "year_groups",
            id: routeParam(c, "id"),
            orgId,
            userId,
            status: "active",
            entityType: "year_group",
            action: "academic.year_group.restored",
            mapRow: mapYearGroup,
          }),
        ),
      });
    }),
  );

  app.delete("/year-groups/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const existing = await client.query(
        `select id, code, name, key_stage, sort_order, student_login_enabled, status, origin
         from year_groups where id = $1 and organisation_id = $2`,
        [routeParam(c, "id"), orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const status = isAcademicRecordStatus(existing.rows[0].status) ? existing.rows[0].status : "active";
      const lifecycle = await loadAcademicLifecycle(client, "year_group", routeParam(c, "id"), orgId, status, {
        extraBlockReasons: isSystemYearGroup(existing.rows[0].origin) ? [SYSTEM_YEAR_GROUP_DELETE_REASON] : [],
        entityLabel: "This year group",
      });
      if (!lifecycle.canDelete) {
        const blocked = deletionBlockedError("This year group", lifecycle);
        throw new AppError(409, blocked.code, blocked.message, blocked.details);
      }
      await deleteConfigOnlyYearGroupLinks(client, routeParam(c, "id"), orgId);
      await client.query(`delete from year_groups where id = $1 and organisation_id = $2`, [
        routeParam(c, "id"),
        orgId,
      ]);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.year_group.deleted",
        entityType: "year_group",
        entityId: routeParam(c, "id"),
        before: mapYearGroup(existing.rows[0]),
      });
      return c.json({ ok: true });
    }),
  );

  app.get("/subjects", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const rows = await client.query(
        `select id, key, name, status from subjects
         where organisation_id = $1
           and ($2::boolean or status = 'active')
         order by name`,
        [orgId, includeArchivedRequested(c.req.query("includeArchived"))],
      );
      return c.json({ subjects: rows.rows.map(mapSubject) });
    }),
  );

  app.post("/subjects", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = subjectSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid subject payload");
      const subject = parseSubjectCreateInput(parsed.data);
      if (!subject.ok) {
        throw new AppError(400, "validation_failed", subject.error, { fieldKey: subject.field });
      }
      const existing = await client.query(
        "select 1 from subjects where organisation_id = $1 and key = $2",
        [orgId, subject.key],
      );
      if (existing.rows[0]) {
        throw new AppError(409, "conflict", "A subject with this key already exists in this school.", {
          fieldKey: "key",
        });
      }
      const inserted = await client.query(
        `insert into subjects (organisation_id, key, name) values ($1, $2, $3)
         returning id, key, name, status`,
        [orgId, subject.key, subject.name],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.subject.created",
        entityType: "subject",
        entityId: String(inserted.rows[0]!.id),
        after: mapSubject(inserted.rows[0]!),
      });
      return c.json({ subject: mapSubject(inserted.rows[0]!) }, 201);
    }),
  );

  app.patch("/subjects/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = z
        .object({ name: z.string().optional(), key: z.string().optional() })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid subject payload");
      const subject = parseSubjectUpdateInput(parsed.data);
      if (!subject.ok) {
        throw new AppError(400, "validation_failed", subject.error, { fieldKey: subject.field });
      }
      const existing = await client.query(
        `select id, key, name, status from subjects where id = $1 and organisation_id = $2`,
        [routeParam(c, "id"), orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      if (subject.key && subject.key !== existing.rows[0].key) {
        const clash = await client.query(
          "select 1 from subjects where organisation_id = $1 and key = $2 and id <> $3",
          [orgId, subject.key, routeParam(c, "id")],
        );
        if (clash.rows[0]) {
          throw new AppError(409, "conflict", "A subject with this key already exists in this school.", {
            fieldKey: "key",
          });
        }
      }
      const updated = await client.query(
        `update subjects
         set name = coalesce($3, name), key = coalesce($4, key)
         where id = $1 and organisation_id = $2
         returning id, key, name, status`,
        [routeParam(c, "id"), orgId, subject.name ?? null, subject.key ?? null],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.subject.updated",
        entityType: "subject",
        entityId: routeParam(c, "id"),
        before: mapSubject(existing.rows[0]),
        after: mapSubject(updated.rows[0]!),
      });
      return c.json({ subject: mapSubject(updated.rows[0]!) });
    }),
  );

  app.get("/subjects/:id/lifecycle", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const existing = await client.query(
        `select id, key, name, status from subjects where id = $1 and organisation_id = $2`,
        [routeParam(c, "id"), orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const status = isAcademicRecordStatus(existing.rows[0].status) ? existing.rows[0].status : "active";
      const lifecycle = await loadAcademicLifecycle(client, "subject", routeParam(c, "id"), orgId, status, {
        entityLabel: "This subject",
      });
      return c.json({ subject: mapSubject(existing.rows[0]), lifecycle });
    }),
  );

  app.post("/subjects/:id/archive", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      return c.json({
        subject: mapSubject(
          await setAcademicStatus(client, {
            table: "subjects",
            id: routeParam(c, "id"),
            orgId,
            userId,
            status: "archived",
            entityType: "subject",
            action: "academic.subject.archived",
            mapRow: mapSubject,
          }),
        ),
      });
    }),
  );

  app.post("/subjects/:id/restore", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      return c.json({
        subject: mapSubject(
          await setAcademicStatus(client, {
            table: "subjects",
            id: routeParam(c, "id"),
            orgId,
            userId,
            status: "active",
            entityType: "subject",
            action: "academic.subject.restored",
            mapRow: mapSubject,
          }),
        ),
      });
    }),
  );

  app.delete("/subjects/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const existing = await client.query(
        `select id, key, name, status from subjects where id = $1 and organisation_id = $2`,
        [routeParam(c, "id"), orgId],
      );
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const status = isAcademicRecordStatus(existing.rows[0].status) ? existing.rows[0].status : "active";
      const lifecycle = await loadAcademicLifecycle(client, "subject", routeParam(c, "id"), orgId, status, {
        entityLabel: "This subject",
      });
      if (!lifecycle.canDelete) {
        const blocked = deletionBlockedError("This subject", lifecycle);
        throw new AppError(409, blocked.code, blocked.message, blocked.details);
      }
      await client.query(`delete from subjects where id = $1 and organisation_id = $2`, [
        routeParam(c, "id"),
        orgId,
      ]);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.subject.deleted",
        entityType: "subject",
        entityId: routeParam(c, "id"),
        before: mapSubject(existing.rows[0]),
      });
      return c.json({ ok: true });
    }),
  );

  app.get("/houses", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const rows = await client.query(
        `select id, name, short_code, colour, active from houses where organisation_id = $1 order by name`,
        [orgId],
      );
      return c.json({ houses: rows.rows.map(mapHouse) });
    }),
  );

  app.post("/houses", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = z
        .object({
          name: z.string().min(1).max(80),
          shortCode: z.string().min(1).max(12).optional(),
          colour: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid house payload");
      const inserted = await client.query(
        `insert into houses (organisation_id, name, short_code, colour) values ($1, $2, $3, $4)
         returning id, name, short_code, colour, active`,
        [orgId, parsed.data.name, parsed.data.shortCode ?? null, parsed.data.colour ?? null],
      );
      return c.json({ house: mapHouse(inserted.rows[0]!) }, 201);
    }),
  );

  app.get("/classes", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const academicYearId = c.req.query("academicYearId");
      const rows = await client.query(
        `select c.id, c.name, c.class_type, c.academic_year_id, c.year_group_id, c.status,
                yg.name as year_group_name, ay.name as academic_year_name
         from classes c
         join academic_years ay on ay.id = c.academic_year_id
         left join year_groups yg on yg.id = c.year_group_id
         where c.organisation_id = $1
           and ($2::uuid is null or c.academic_year_id = $2)
           and ($3::boolean or c.status = 'active')
         order by ay.starts_on desc, yg.sort_order nulls last, c.name`,
        [orgId, academicYearId || null, includeArchivedRequested(c.req.query("includeArchived"))],
      );
      return c.json({ classes: rows.rows.map(mapClass) });
    }),
  );

  app.post("/classes", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = classSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid class payload");
      const inserted = await client.query(
        `insert into classes (organisation_id, academic_year_id, year_group_id, name, class_type)
         values ($1, $2, $3, $4, $5)
         returning id, name, class_type, academic_year_id, year_group_id, status`,
        [
          orgId,
          parsed.data.academicYearId,
          parsed.data.yearGroupId ?? null,
          parsed.data.name,
          parsed.data.classType,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.class.created",
        entityType: "class",
        entityId: String(inserted.rows[0]!.id),
        after: mapClass(inserted.rows[0]!),
      });
      return c.json({ class: mapClass(inserted.rows[0]!) }, 201);
    }),
  );

  app.patch("/classes/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = z
        .object({
          name: z.string().min(1).max(80).optional(),
          yearGroupId: z.string().uuid().nullable().optional(),
          classType: z.enum(["form", "teaching"]).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid class payload");
      const classId = routeParam(c, "id");
      const existing = await loadClassRow(client, orgId, classId);
      if (!existing) throw new AppError(404, "not_found", "Not found");
      if (parsed.data.yearGroupId) {
        const group = await client.query(
          `select id from year_groups where id = $1 and organisation_id = $2`,
          [parsed.data.yearGroupId, orgId],
        );
        if (!group.rows[0]) throw new AppError(400, "validation_failed", "Year group was not found in this school.");
      }
      const yearGroupId =
        parsed.data.yearGroupId === undefined ? existing.year_group_id : parsed.data.yearGroupId;
      const updated = await client.query(
        `update classes
         set name = coalesce($3, name),
             year_group_id = $4,
             class_type = coalesce($5, class_type)
         where id = $1 and organisation_id = $2
         returning id`,
        [classId, orgId, parsed.data.name ?? null, yearGroupId, parsed.data.classType ?? null],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      const row = await loadClassRow(client, orgId, classId);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.class.updated",
        entityType: "class",
        entityId: classId,
        before: mapClass(existing),
        after: mapClass(row!),
      });
      return c.json({ class: mapClass(row!) });
    }),
  );

  app.get("/classes/:id/lifecycle", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const classId = routeParam(c, "id");
      const existing = await loadClassRow(client, orgId, classId);
      if (!existing) throw new AppError(404, "not_found", "Not found");
      const status = isAcademicRecordStatus(existing.status) ? existing.status : "active";
      const lifecycle = await loadAcademicLifecycle(client, "class", classId, orgId, status, {
        entityLabel: "This class",
      });
      return c.json({ class: mapClass(existing), lifecycle });
    }),
  );

  app.post("/classes/:id/archive", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const classId = routeParam(c, "id");
      await setAcademicStatus(client, {
        table: "classes",
        id: classId,
        orgId,
        userId,
        status: "archived",
        entityType: "class",
        action: "academic.class.archived",
        mapRow: (row) => row,
      });
      return c.json({ class: mapClass((await loadClassRow(client, orgId, classId))!) });
    }),
  );

  app.post("/classes/:id/restore", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const classId = routeParam(c, "id");
      await setAcademicStatus(client, {
        table: "classes",
        id: classId,
        orgId,
        userId,
        status: "active",
        entityType: "class",
        action: "academic.class.restored",
        mapRow: (row) => row,
      });
      return c.json({ class: mapClass((await loadClassRow(client, orgId, classId))!) });
    }),
  );

  app.delete("/classes/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const classId = routeParam(c, "id");
      const existing = await loadClassRow(client, orgId, classId);
      if (!existing) throw new AppError(404, "not_found", "Not found");
      const status = isAcademicRecordStatus(existing.status) ? existing.status : "active";
      const lifecycle = await loadAcademicLifecycle(client, "class", classId, orgId, status, {
        entityLabel: "This class",
      });
      if (!lifecycle.canDelete) {
        const blocked = deletionBlockedError("This class", lifecycle);
        throw new AppError(409, blocked.code, blocked.message, blocked.details);
      }
      await client.query(`delete from classes where id = $1 and organisation_id = $2`, [classId, orgId]);
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.class.deleted",
        entityType: "class",
        entityId: classId,
        before: mapClass(existing),
      });
      return c.json({ ok: true });
    }),
  );

  app.get("/classes/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertAnyPermission(actor, academicReadPermissions);
      const classId = routeParam(c, "id");
      const cls = await client.query(
        `select c.id, c.name, c.class_type, c.academic_year_id, c.year_group_id, c.status,
                yg.name as year_group_name, ay.name as academic_year_name
         from classes c
         join academic_years ay on ay.id = c.academic_year_id
         left join year_groups yg on yg.id = c.year_group_id
         where c.id = $1 and c.organisation_id = $2`,
        [classId, orgId],
      );
      if (!cls.rows[0]) throw new AppError(404, "not_found", "Not found");
      const subjects = await client.query(
        `select s.id, s.key, s.name, s.status
         from class_subjects cs
         join subjects s on s.id = cs.subject_id
         where cs.class_id = $1 and cs.organisation_id = $2
         order by s.name`,
        [classId, orgId],
      );
      const staff = await client.query(
        `select csa.id, csa.staff_profile_id, csa.assignment_role,
                csa.started_on::text, csa.ended_on::text, u.full_name, u.email, sp.job_title
         from class_staff_assignments csa
         join staff_profiles sp on sp.id = csa.staff_profile_id
         join users u on u.id = sp.user_id
         where csa.class_id = $1 and csa.organisation_id = $2
         order by csa.ended_on nulls first, u.full_name`,
        [classId, orgId],
      );
      const canSeeMembers =
        canListAllStudents(actor) ||
        (actor.permissions.has(PERMISSIONS.STUDENTS_PROFILES_READ_ASSIGNED) &&
          (await isAssignedToClass(client, userId, orgId, classId)));
      const members = canSeeMembers
        ? await client.query(
            `select cm.id, cm.student_profile_id, cm.started_on::text, cm.ended_on::text, sp.legal_name
             from class_memberships cm
             join student_profiles sp on sp.id = cm.student_profile_id
             where cm.class_id = $1 and cm.organisation_id = $2
             order by cm.ended_on nulls first, sp.legal_name`,
            [classId, orgId],
          )
        : { rows: [] };
      return c.json({
        class: mapClass(cls.rows[0]),
        subjects: subjects.rows.map(mapSubject),
        staff: staff.rows.map((row) => ({
          id: row.id,
          staffProfileId: row.staff_profile_id,
          assignmentRole: row.assignment_role,
          startedOn: row.started_on,
          endedOn: row.ended_on,
          fullName: row.full_name,
          email: row.email,
          jobTitle: row.job_title,
        })),
        members: members.rows.map((row) => ({
          id: row.id,
          studentProfileId: row.student_profile_id,
          legalName: row.legal_name,
          startedOn: row.started_on,
          endedOn: row.ended_on,
        })),
      });
    }),
  );

  app.post("/classes/:id/subjects", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = z.object({ subjectId: z.string().uuid() }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid class subject payload");
      const inserted = await client.query(
        `insert into class_subjects (organisation_id, class_id, subject_id)
         values ($1, $2, $3)
         returning id, class_id, subject_id`,
        [orgId, routeParam(c, "id"), parsed.data.subjectId],
      );
      return c.json({ classSubject: inserted.rows[0] }, 201);
    }),
  );

  app.delete("/classes/:id/subjects/:subjectId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const deleted = await client.query(
        `delete from class_subjects
         where organisation_id = $1 and class_id = $2 and subject_id = $3
         returning id`,
        [orgId, routeParam(c, "id"), c.req.param("subjectId")],
      );
      if (!deleted.rows[0]) throw new AppError(404, "not_found", "Not found");
      return c.json({ ok: true });
    }),
  );

  app.post("/classes/:id/staff", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = z
        .object({
          staffProfileId: z.string().uuid(),
          assignmentRole: z
            .enum(["form_tutor", "co_tutor", "subject_teacher", "head_of_year", "other"])
            .default("subject_teacher"),
          startedOn: z.string().date().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid staff assignment payload");
      const startedOn =
        parsed.data.startedOn ??
        (await classStartDate(client, orgId, routeParam(c, "id")));
      const inserted = await client.query(
        `insert into class_staff_assignments (
           organisation_id, class_id, staff_profile_id, assignment_role, started_on
         ) values ($1, $2, $3, $4, $5)
         returning id, class_id, staff_profile_id, assignment_role, started_on::text, ended_on::text`,
        [
          orgId,
          routeParam(c, "id"),
          parsed.data.staffProfileId,
          parsed.data.assignmentRole,
          startedOn,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.class_staff.assigned",
        entityType: "class_staff_assignment",
        entityId: String(inserted.rows[0]!.id),
        after: inserted.rows[0],
      });
      return c.json({ assignment: inserted.rows[0] }, 201);
    }),
  );

  app.patch("/class-staff-assignments/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE);
      const parsed = z.object({ endedOn: z.string().date() }).safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid assignment payload");
      const updated = await client.query(
        `update class_staff_assignments
         set ended_on = $3::date
         where id = $1 and organisation_id = $2 and ended_on is null
         returning id, class_id, staff_profile_id, assignment_role, started_on::text, ended_on::text`,
        [routeParam(c, "id"), orgId, parsed.data.endedOn],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "academic.class_staff.ended",
        entityType: "class_staff_assignment",
        entityId: routeParam(c, "id"),
        after: updated.rows[0],
      });
      return c.json({ assignment: updated.rows[0] });
    }),
  );
}

async function loadAcademicYearRow(
  client: import("pg").PoolClient,
  orgId: string,
  yearId: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `select id, name, starts_on::text, ends_on::text, is_current, status, created_at
     from academic_years where id = $1 and organisation_id = $2`,
    [yearId, orgId],
  );
  return result.rows[0] ?? null;
}

async function listTermsForYear(
  client: import("pg").PoolClient,
  orgId: string,
  yearId: string,
): Promise<Record<string, unknown>[]> {
  const rows = await client.query(
    `select id, academic_year_id, key, name, starts_on::text, ends_on::text, sort_order
     from terms
     where academic_year_id = $1 and organisation_id = $2
     order by sort_order, starts_on`,
    [yearId, orgId],
  );
  return rows.rows;
}

async function listHalfTermsForYear(
  client: import("pg").PoolClient,
  orgId: string,
  yearId: string,
): Promise<Record<string, unknown>[]> {
  const rows = await client.query(
    `select ht.id, ht.term_id, ht.name, ht.starts_on::text, ht.ends_on::text, ht.sort_order, t.name as term_name
       from half_terms ht
       join terms t on t.id = ht.term_id
      where ht.organisation_id = $1 and t.academic_year_id = $2
      order by ht.starts_on, ht.sort_order`,
    [orgId, yearId],
  );
  return rows.rows;
}

async function listClosuresForYear(
  client: import("pg").PoolClient,
  orgId: string,
  yearId: string,
): Promise<Record<string, unknown>[]> {
  const rows = await client.query(
    `select se.id, se.title, se.description, se.related_id,
            se.starts_at::date::text as starts_on, se.ends_at::date::text as ends_on,
            st.key as event_type_key
       from school_events se
       join school_event_types st on st.id = se.event_type_id
      where se.organisation_id = $1
        and se.related_kind = 'academic_year'
        and se.related_id = $2
        and se.status in ('published', 'scheduled')
        and st.key = any($3::text[])
      order by se.starts_at`,
    [orgId, yearId, [...NON_TEACHING_EVENT_TYPE_KEYS]],
  );
  return rows.rows;
}

async function loadClosureRow(
  client: import("pg").PoolClient,
  orgId: string,
  eventId: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `select se.id, se.title, se.description, se.related_id, se.related_kind,
            se.starts_at::date::text as starts_on, se.ends_at::date::text as ends_on,
            st.key as event_type_key
       from school_events se
       join school_event_types st on st.id = se.event_type_id
      where se.id = $1 and se.organisation_id = $2
        and se.related_kind = 'academic_year'
        and st.key = any($3::text[])`,
    [eventId, orgId, [...NON_TEACHING_EVENT_TYPE_KEYS]],
  );
  return result.rows[0] ?? null;
}

async function loadTermRow(
  client: import("pg").PoolClient,
  orgId: string,
  termId: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `select id, academic_year_id, key, name, starts_on::text, ends_on::text, sort_order
     from terms where id = $1 and organisation_id = $2`,
    [termId, orgId],
  );
  return result.rows[0] ?? null;
}

async function loadClassRow(
  client: import("pg").PoolClient,
  orgId: string,
  classId: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `select c.id, c.name, c.class_type, c.academic_year_id, c.year_group_id, c.status,
            yg.name as year_group_name, ay.name as academic_year_name
     from classes c
     join academic_years ay on ay.id = c.academic_year_id
     left join year_groups yg on yg.id = c.year_group_id
     where c.id = $1 and c.organisation_id = $2`,
    [classId, orgId],
  );
  return result.rows[0] ?? null;
}

async function setAcademicStatus(
  client: import("pg").PoolClient,
  input: {
    table: "subjects" | "classes" | "year_groups" | "academic_years";
    id: string;
    orgId: string;
    userId: string;
    status: "active" | "archived";
    entityType: string;
    action: string;
    mapRow: (row: Record<string, unknown>) => unknown;
  },
): Promise<Record<string, unknown>> {
  const existing = await client.query(`select * from ${input.table} where id = $1 and organisation_id = $2`, [
    input.id,
    input.orgId,
  ]);
  if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
  const updated = await client.query(
    `update ${input.table} set status = $3 where id = $1 and organisation_id = $2 returning *`,
    [input.id, input.orgId, input.status],
  );
  const row = updated.rows[0]!;
  await writeAudit(client, {
    organisationId: input.orgId,
    actorUserId: input.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.id,
    before: input.mapRow(existing.rows[0]),
    after: input.mapRow(row),
  });
  return row;
}

function defaultYearName(code: string): string {
  if (code === "N") return "Nursery";
  if (code === "R") return "Reception";
  return `Year ${code}`;
}

async function classStartDate(
  client: import("pg").PoolClient,
  orgId: string,
  classId: string,
): Promise<string> {
  const result = await client.query(
    `select ay.starts_on::text
     from classes c
     join academic_years ay on ay.id = c.academic_year_id
     where c.id = $1 and c.organisation_id = $2`,
    [classId, orgId],
  );
  if (!result.rows[0]) throw new AppError(404, "not_found", "Not found");
  return result.rows[0].starts_on as string;
}
