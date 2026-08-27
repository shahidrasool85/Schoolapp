import { z } from "zod";
import { IMPORT_KINDS, PERMISSIONS, portalAccessGranted } from "@schoolapp/domain";
import {
  AppError,
  assertPermission,
  importTemplateCsv,
  parseCsvText,
  pgErrorToAppError,
  rowToRecord,
  validateGuardianImportRow,
  validatePupilImportRow,
  validateStaffImportRow,
  writeAudit,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { withSchoolActor } from "../school-context";
import { mailOf, inviteAcceptPath } from "../mail";
import { parentInviteMail, staffInviteMail } from "@schoolapp/core";

const kindSchema = z.enum(IMPORT_KINDS);

export function registerImportRoutes(app: SchoolappApi) {
  app.get("/imports/templates/:kind", requireUser, async (c) =>
    withSchoolActor(c, async ({ actor }) => {
      assertPermission(actor, PERMISSIONS.IMPORTS_MANAGE);
      const kind = kindSchema.safeParse(c.req.param("kind"));
      if (!kind.success) throw new AppError(404, "not_found", "Not found");
      const csv = importTemplateCsv(kind.data);
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${kind.data}-import-template.csv"`,
        },
      });
    }),
  );

  app.post("/imports/:kind", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.IMPORTS_MANAGE);
      const kind = kindSchema.safeParse(c.req.param("kind"));
      if (!kind.success) throw new AppError(404, "not_found", "Not found");
      const body = await c.req.json().catch(() => null);
      const parsed = z.object({ csv: z.string().min(1).max(2_000_000) }).safeParse(body);
      if (!parsed.success) throw new AppError(400, "validation_failed", "CSV text is required");
      const { headers, rows } = parseCsvText(parsed.data.csv);
      if (rows.length === 0) throw new AppError(400, "validation_failed", "The CSV file has no data rows");
      if (rows.length > 2000) {
        throw new AppError(400, "validation_failed", "Import is limited to 2000 rows");
      }

      const job = await client.query<{ id: string }>(
        `insert into data_imports (organisation_id, kind, status, original_filename, created_by, row_count)
         values ($1, $2, 'parsed', $3, $4, $5)
         returning id`,
        [orgId, kind.data, `${kind.data}.csv`, userId, rows.length],
      );
      const importId = job.rows[0]!.id;
      const preview = [];
      let validCount = 0;
      let errorCount = 0;
      let duplicateCount = 0;

      for (let i = 0; i < rows.length; i += 1) {
        const payload = rowToRecord(headers, rows[i]!);
        const evaluated = await evaluateRow(client, orgId, kind.data, payload);
        await client.query(
          `insert into data_import_rows (
             organisation_id, import_id, row_number, payload, status, issues, match_kind, match_label
           ) values ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8)`,
          [
            orgId,
            importId,
            i + 1,
            JSON.stringify(payload),
            evaluated.status,
            JSON.stringify(evaluated.issues),
            evaluated.matchKind,
            evaluated.matchLabel,
          ],
        );
        if (evaluated.status === "valid") validCount += 1;
        else if (evaluated.status === "duplicate") duplicateCount += 1;
        else errorCount += 1;
        preview.push({
          rowNumber: i + 1,
          payload,
          status: evaluated.status,
          issues: evaluated.issues,
          match: evaluated.matchKind
            ? { kind: evaluated.matchKind, label: evaluated.matchLabel }
            : null,
        });
      }

      await client.query(
        `update data_imports
         set status = 'validated', valid_count = $2, error_count = $3, duplicate_count = $4
         where id = $1 and organisation_id = $5`,
        [importId, validCount, errorCount, duplicateCount, orgId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "import.validated",
        entityType: "data_import",
        entityId: importId,
        after: { kind: kind.data, validCount, errorCount, duplicateCount },
      });
      return c.json(
        {
          importId,
          kind: kind.data,
          headers,
          rowCount: rows.length,
          validCount,
          errorCount,
          duplicateCount,
          rows: preview,
        },
        201,
      );
    }),
  );

  app.get("/imports/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.IMPORTS_MANAGE);
      const job = await client.query(
        `select id, kind, status, original_filename, row_count, valid_count, error_count,
                duplicate_count, imported_count, skipped_count, created_at, completed_at, error_summary
         from data_imports where id = $1 and organisation_id = $2`,
        [c.req.param("id"), orgId],
      );
      if (!job.rows[0]) throw new AppError(404, "not_found", "Not found");
      const rows = await client.query(
        `select row_number, payload, status, issues, match_kind, match_label
         from data_import_rows where import_id = $1 and organisation_id = $2
         order by row_number`,
        [c.req.param("id"), orgId],
      );
      return c.json({
        import: mapImport(job.rows[0]),
        rows: rows.rows.map((row) => ({
          rowNumber: row.row_number,
          payload: row.payload,
          status: row.status,
          issues: row.issues,
          match: row.match_kind ? { kind: row.match_kind, label: row.match_label } : null,
        })),
      });
    }),
  );

  app.post("/imports/:id/confirm", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.IMPORTS_MANAGE);
      const job = await client.query<{ id: string; kind: "staff" | "pupils" | "guardians"; status: string }>(
        `select id, kind, status from data_imports where id = $1 and organisation_id = $2 for update`,
        [c.req.param("id"), orgId],
      );
      const importJob = job.rows[0];
      if (!importJob) throw new AppError(404, "not_found", "Not found");
      if (importJob.status !== "validated") {
        throw new AppError(409, "conflict", "This import cannot be confirmed");
      }
      await client.query(
        `update data_imports set status = 'importing', confirmed_by = $2, confirmed_at = now()
         where id = $1`,
        [importJob.id, userId],
      );
      const rows = await client.query<{
        id: string;
        row_number: number;
        payload: Record<string, string>;
        status: string;
      }>(
        `select id, row_number, payload, status
         from data_import_rows
         where import_id = $1 and organisation_id = $2
         order by row_number`,
        [importJob.id, orgId],
      );
      const org = await client.query<{ name: string }>(
        "select name from organisations where id = $1",
        [orgId],
      );
      const schoolName = org.rows[0]?.name ?? "School";
      let imported = 0;
      let skipped = 0;
      let failed = 0;
      const report: Array<{ rowNumber: number; status: string; detail?: string }> = [];
      const mail = mailOf(c);

      for (const row of rows.rows) {
        if (row.status === "error") {
          skipped += 1;
          report.push({ rowNumber: row.row_number, status: "skipped", detail: "validation error" });
          continue;
        }
        if (row.status === "duplicate") {
          skipped += 1;
          await client.query(`update data_import_rows set status = 'skipped' where id = $1`, [row.id]);
          report.push({ rowNumber: row.row_number, status: "skipped", detail: "duplicate" });
          continue;
        }
        try {
          await client.query("savepoint import_row");
          const result = await importValidRow(client, {
            kind: importJob.kind,
            orgId,
            userId,
            payload: row.payload,
          });
          await client.query("release savepoint import_row");
          imported += 1;
          await client.query(`update data_import_rows set status = 'imported' where id = $1`, [row.id]);
          report.push({ rowNumber: row.row_number, status: "imported" });
          if (result?.invitationToken && result.email) {
            const message =
              importJob.kind === "guardians"
                ? parentInviteMail({
                    organisationId: orgId,
                    organisationName: schoolName,
                    toEmail: result.email,
                    toName: result.name ?? result.email,
                    acceptPath: inviteAcceptPath(result.invitationToken),
                  })
                : staffInviteMail({
                    organisationId: orgId,
                    organisationName: schoolName,
                    toEmail: result.email,
                    toName: result.name ?? result.email,
                    acceptPath: inviteAcceptPath(result.invitationToken),
                  });
            await mail.send(message);
          }
        } catch (error) {
          await client.query("rollback to savepoint import_row");
          failed += 1;
          await client.query(
            `update data_import_rows
             set status = 'error', issues = $2::jsonb
             where id = $1`,
            [
              row.id,
              JSON.stringify([
                {
                  field: "_row",
                  message: error instanceof Error ? error.message : "Import failed",
                  code: "import_failed",
                },
              ]),
            ],
          );
          report.push({
            rowNumber: row.row_number,
            status: "error",
            detail: "Could not import this row",
          });
        }
      }

      await client.query(
        `update data_imports
         set status = 'completed', imported_count = $2, skipped_count = $3, error_count = error_count + $4,
             completed_at = now()
         where id = $1`,
        [importJob.id, imported, skipped, failed],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "import.completed",
        entityType: "data_import",
        entityId: importJob.id,
        after: { imported, skipped, failed, kind: importJob.kind },
      });
      return c.json({ importId: importJob.id, imported, skipped, failed, report });
    }),
  );
}

function mapImport(row: Record<string, unknown>) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    filename: row.original_filename,
    rowCount: row.row_count,
    validCount: row.valid_count,
    errorCount: row.error_count,
    duplicateCount: row.duplicate_count,
    importedCount: row.imported_count,
    skippedCount: row.skipped_count,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    errorSummary: row.error_summary,
  };
}

async function evaluateRow(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  orgId: string,
  kind: "staff" | "pupils" | "guardians",
  payload: Record<string, string>,
) {
  if (kind === "staff") {
    const { issues, roleKey } = validateStaffImportRow(payload);
    if (!roleKey) {
      return { status: "error" as const, issues, matchKind: null, matchLabel: null };
    }
    const existing = await client.query(
      `select u.id, u.full_name
       from users u
       join organisation_memberships m on m.user_id = u.id and m.organisation_id = $1
       where lower(u.email::text) = lower($2)
       limit 1`,
      [orgId, payload.email],
    );
    if (existing.rows[0]) {
      return {
        status: "duplicate" as const,
        issues: [
          {
            field: "email",
            message: "A staff member with this email already exists in this school",
            code: "duplicate_email",
          },
        ],
        matchKind: "staff_email",
        matchLabel: "Existing staff in this school",
      };
    }
    return {
      status: issues.length ? ("error" as const) : ("valid" as const),
      issues,
      matchKind: null,
      matchLabel: null,
    };
  }
  if (kind === "pupils") {
    const issues = validatePupilImportRow(payload);
    if (payload.admission_number) {
      const existing = await client.query(
        `select id from student_profiles
         where organisation_id = $1 and lower(admission_number) = lower($2)
         limit 1`,
        [orgId, payload.admission_number],
      );
      if (existing.rows[0]) {
        return {
          status: "duplicate" as const,
          issues: [
            {
              field: "admission_number",
              message: "A pupil with this admission number already exists",
              code: "duplicate_admission_number",
            },
          ],
          matchKind: "admission_number",
          matchLabel: "Existing pupil in this school",
        };
      }
    }
    if (payload.legal_name && payload.date_of_birth) {
      const maybe = await client.query(
        `select sp.id
         from student_profiles sp
         join users u on u.id = sp.user_id
         where sp.organisation_id = $1
           and lower(sp.legal_name) = lower($2)
           and u.date_of_birth = $3::date
         limit 1`,
        [orgId, payload.legal_name, payload.date_of_birth],
      );
      if (maybe.rows[0]) {
        return {
          status: "duplicate" as const,
          issues: [
            {
              field: "legal_name",
              message: "A pupil with this name and date of birth already exists",
              code: "possible_duplicate",
            },
          ],
          matchKind: "student_identity",
          matchLabel: "Possible duplicate in this school",
        };
      }
    }
    return {
      status: issues.length ? ("error" as const) : ("valid" as const),
      issues,
      matchKind: null,
      matchLabel: null,
    };
  }
  const issues = validateGuardianImportRow(payload);
  if (payload.email) {
    const existing = await client.query(
      `select u.id
       from users u
       join organisation_memberships m on m.user_id = u.id and m.organisation_id = $1
       where lower(u.email::text) = lower($2)
       limit 1`,
      [orgId, payload.email],
    );
    if (existing.rows[0]) {
      return {
        status: issues.length ? ("error" as const) : ("valid" as const),
        issues,
        matchKind: "parent_email",
        matchLabel: "Existing parent in this school",
      };
    }
  }
  return {
    status: issues.length ? ("error" as const) : ("valid" as const),
    issues,
    matchKind: null,
    matchLabel: null,
  };
}

async function importValidRow(
  client: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  },
  input: {
    kind: "staff" | "pupils" | "guardians";
    orgId: string;
    userId: string;
    payload: Record<string, string>;
  },
): Promise<{ invitationToken?: string; email?: string; name?: string } | null> {
  if (input.kind === "staff") {
    const { roleKey } = validateStaffImportRow(input.payload);
    if (!roleKey) throw new AppError(400, "validation_failed", "Invalid staff role");
    const email = input.payload.email?.toLowerCase();
    if (!email) throw new AppError(400, "validation_failed", "A valid email is required");
    const created = await client.query(
      "select * from provision_staff($1, $2, $3, $4, $5, $6, $7, $8::date)",
      [
        input.userId,
        input.orgId,
        email,
        input.payload.full_name,
        input.payload.job_title || null,
        null,
        [roleKey],
        null,
      ],
    );
    const row = created.rows[0] as { invitation_token?: string };
    return {
      invitationToken: row.invitation_token,
      email,
      name: input.payload.full_name,
    };
  }
  if (input.kind === "pupils") {
    const year = input.payload.academic_year
      ? await client.query(
          `select id from academic_years where organisation_id = $1 and name = $2 limit 1`,
          [input.orgId, input.payload.academic_year],
        )
      : await client.query(
          `select id from academic_years where organisation_id = $1 and is_current limit 1`,
          [input.orgId],
        );
    const yearGroup = input.payload.year_group
      ? await client.query(
          `select id from year_groups where organisation_id = $1 and (code = $2 or name = $2) limit 1`,
          [input.orgId, input.payload.year_group],
        )
      : { rows: [] as Array<Record<string, unknown>> };
    const formClass = input.payload.form_class
      ? await client.query(
          `select id from classes where organisation_id = $1 and name = $2 limit 1`,
          [input.orgId, input.payload.form_class],
        )
      : { rows: [] as Array<Record<string, unknown>> };
    const created = await client.query<{ provision_student: string }>(
      "select provision_student($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12)",
      [
        input.userId,
        input.orgId,
        input.payload.legal_name,
        input.payload.preferred_name || null,
        input.payload.admission_number || null,
        input.payload.date_of_birth || null,
        year.rows[0]?.id ?? null,
        yearGroup.rows[0]?.id ?? null,
        formClass.rows[0]?.id ?? null,
        null,
        null,
        null,
      ],
    );
    const studentId = created.rows[0]?.provision_student;
    if (!studentId) throw new AppError(400, "validation_failed", "The pupil could not be created");
    if (input.payload.address_line1 || input.payload.address_town || input.payload.address_postcode) {
      await client.query(
        `update student_profiles
         set address_line1 = coalesce($3, address_line1),
             address_town = coalesce($4, address_town),
             address_postcode = coalesce($5, address_postcode)
         where id = $1 and organisation_id = $2`,
        [
          studentId,
          input.orgId,
          input.payload.address_line1 || null,
          input.payload.address_town || null,
          input.payload.address_postcode || null,
        ],
      );
    }
    return null;
  }

  const pupil = input.payload.admission_number
    ? await client.query(
        `select id from student_profiles where organisation_id = $1 and admission_number = $2 limit 1`,
        [input.orgId, input.payload.admission_number],
      )
    : await client.query(
        `select id from student_profiles where organisation_id = $1 and lower(legal_name) = lower($2) limit 1`,
        [input.orgId, input.payload.pupil_legal_name],
      );
  const studentId = pupil.rows[0]?.id as string | undefined;
  if (!studentId) throw new AppError(400, "validation_failed", "The linked pupil was not found");
  const email = input.payload.email?.toLowerCase();
  if (!email) throw new AppError(400, "validation_failed", "A valid email is required");
  const parental = ["true", "yes", "1", "y"].includes(
    (input.payload.parental_responsibility ?? "").trim().toLowerCase(),
  );
  const created = await client.query(
    `select * from link_guardian($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.userId,
      input.orgId,
      studentId,
      email,
      input.payload.guardian_name,
      input.payload.relationship || "other",
      parental,
      false,
      false,
      portalAccessGranted(false),
      1,
    ],
  );
  const row = created.rows[0] as { invitation_token?: string | null };
  return {
    invitationToken: row.invitation_token ?? undefined,
    email,
    name: input.payload.guardian_name,
  };
}

export { pgErrorToAppError };
