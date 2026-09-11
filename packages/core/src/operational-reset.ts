import type pg from "pg";
import {
  OPERATIONAL_RESET_CATALOGUE_TABLES,
  OPERATIONAL_RESET_GLOBAL_TABLES,
  OPERATIONAL_RESET_MODE,
  OPERATIONAL_RESET_PRESERVED_CATEGORIES,
  OPERATIONAL_RESET_PRESERVED_TABLES,
  OPERATIONAL_RESET_TABLES,
  confirmationMatchesOrganisation,
  isReservedSubdomain,
  type OperationalResetCountKey,
  type OperationalResetSchoolAdmin,
} from "@schoolapp/domain";
import { AppError, describeUnknownError } from "./errors.js";

export type OperationalResetStorage = {
  deleteObject(key: string): Promise<void>;
};

const IDENT = /^[a-z_][a-z0-9_]*$/;

const CONDITIONAL_ORG_TABLES = [
  "organisation_memberships",
  "staff_profiles",
  "user_login_aliases",
  "notification_preferences",
  "organisation_onboarding_preferences",
  "account_tokens",
  "stored_objects",
  "mail_outbox",
  "roles",
] as const;

/**
 * Delete children of issued invoices / census snapshots before their parents.
 * `school_invoice_lines_immutable_tg` raises 23514 (`invoice_lines_immutable`)
 * for schoolapp_app on issued/void invoices; schoolapp_owner may DELETE
 * (migration 0068). Payment rows must not have invoice_id/charge_id nulled:
 * that violates school_payment_*_target_chk and school_finance_same_org_tg.
 */
const OPERATIONAL_RESET_DELETE_FIRST = [
  "school_payment_provider_events",
  "school_payment_receipts",
  "school_payment_refunds",
  "school_payment_sessions",
  "school_invoice_credits",
  "school_invoice_payments",
  "school_payment_transactions",
  "school_invoice_lines",
  "school_billing_run_items",
  "school_charge_adjustments",
  "census_validation_issues",
  "census_snapshot_pupils",
  "census_snapshot_schools",
] as const;

const PAYMENT_TARGET_TABLES = new Set([
  "school_payment_sessions",
  "school_payment_transactions",
  "school_payment_receipts",
]);
const PAYMENT_TARGET_COLUMNS = new Set(["charge_id", "invoice_id"]);

const CLASSIFIED_TABLES = new Set<string>([
  ...OPERATIONAL_RESET_PRESERVED_TABLES,
  ...OPERATIONAL_RESET_CATALOGUE_TABLES,
  ...OPERATIONAL_RESET_GLOBAL_TABLES,
  ...CONDITIONAL_ORG_TABLES,
  ...OPERATIONAL_RESET_TABLES,
]);

export type OperationalResetCounts = Record<OperationalResetCountKey, number>;

export type OperationalResetPreview = {
  mode: typeof OPERATIONAL_RESET_MODE;
  organisation: {
    id: string;
    slug: string;
    name: string;
    status: string;
  };
  schoolAdminsPreserved: OperationalResetSchoolAdmin[];
  counts: OperationalResetCounts;
  preserved: Array<{ key: string; label: string }>;
  liveFinancialResetBlocked: boolean;
  remainingOperationalRows: number;
  alreadyClean: boolean;
};

export type OperationalResetResult = OperationalResetPreview & {
  deletedCounts: OperationalResetCounts;
  verification: Record<string, boolean>;
  blobsScheduled: number;
  blobsDeleted: number;
  blobsFailed: number;
};

function quoteIdent(name: string): string {
  if (!IDENT.test(name)) {
    throw new AppError(500, "internal_error", "Invalid identifier in reset plan");
  }
  return `"${name}"`;
}

function isFkViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === "23503");
}

function isLockNotAvailable(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === "55P03");
}

function jsonSafeCount(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function chunkIdentifiedTables(tables: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < tables.length; i += size) out.push(tables.slice(i, i + size));
  return out;
}

function logUnexpectedOperationalResetError(
  op: "preview" | "execute" | "preview_serialize",
  context: Record<string, unknown>,
  error: unknown,
): void {
  if (error instanceof AppError && error.status < 500) return;
  if (error instanceof AppError && error.code === "injected_failure" && process.env.VITEST === "true") return;
  console.error("operational_reset_failed", {
    op,
    ...context,
    ...describeUnknownError(error),
    appError:
      error instanceof AppError
        ? { status: error.status, code: error.code, message: error.message }
        : undefined,
  });
}

async function requirePlatformAdmin(client: pg.PoolClient, actorUserId: string): Promise<void> {
  const row = await client.query(
    `select 1
       from platform_admins pa
       join users u on u.id = pa.user_id
      where pa.user_id = $1 and u.status = 'active'`,
    [actorUserId],
  );
  if (!row.rowCount) {
    throw new AppError(403, "forbidden", "Platform administrator required");
  }
}

async function loadOrganisation(
  client: pg.PoolClient,
  organisationId: string,
  forUpdate: boolean,
): Promise<{ id: string; slug: string; name: string; status: string }> {
  const sql = `select id, slug::text as slug, name, status from organisations where id = $1${
    forUpdate ? " for update" : ""
  }`;
  const result = await client.query<{ id: string; slug: string; name: string; status: string }>(sql, [
    organisationId,
  ]);
  const org = result.rows[0];
  if (!org) {
    throw new AppError(404, "not_found", "Not found");
  }
  if (isReservedSubdomain(org.slug)) {
    throw new AppError(400, "forbidden", "The platform or system tenant cannot be reset");
  }
  return org;
}

export async function listActiveSchoolAdmins(
  client: pg.PoolClient | pg.Pool,
  organisationId: string,
): Promise<OperationalResetSchoolAdmin[]> {
  const result = await client.query<OperationalResetSchoolAdmin>(
    `select u.id as "userId",
            u.email::text as email,
            u.full_name as "fullName",
            m.status as "membershipStatus"
       from organisation_memberships m
       join users u on u.id = m.user_id
       join membership_roles mr on mr.membership_id = m.id
       join roles r on r.id = mr.role_id
      where m.organisation_id = $1
        and m.status = 'active'
        and m.ended_at is null
        and u.status = 'active'
        and r.key = 'school.admin'
        and r.organisation_id is null
      order by u.email nulls last, u.full_name`,
    [organisationId],
  );
  return result.rows;
}

async function liveFinancialResetBlockReason(
  client: pg.PoolClient | pg.Pool,
  organisationId: string,
): Promise<"provider_mode_live" | "live_payment_evidence" | null> {
  const liveConfig = await client.query(
    `select 1 from school_payment_provider_configs
      where organisation_id = $1 and mode = 'live'
      limit 1`,
    [organisationId],
  );
  if ((liveConfig.rowCount ?? 0) > 0) return "provider_mode_live";
  const liveEvidence = await client.query(
    `select 1 from school_payment_transactions
      where organisation_id = $1
        and (
          metadata->>'livemode' in ('true', 't', '1')
          or lower(coalesce(metadata->>'mode', '')) = 'live'
        )
      limit 1`,
    [organisationId],
  );
  return (liveEvidence.rowCount ?? 0) > 0 ? "live_payment_evidence" : null;
}

async function liveFinancialResetBlocked(client: pg.PoolClient | pg.Pool, organisationId: string): Promise<boolean> {
  return (await liveFinancialResetBlockReason(client, organisationId)) !== null;
}

async function countOrZero(
  client: pg.PoolClient | pg.Pool,
  sql: string,
  params: unknown[],
): Promise<number> {
  const result = await client.query<{ n: string }>(sql, params);
  return jsonSafeCount(result.rows[0]?.n);
}

export async function loadOperationalResetCounts(
  client: pg.PoolClient | pg.Pool,
  organisationId: string,
  preservedUserIds: string[],
): Promise<OperationalResetCounts> {
  const preserved = preservedUserIds.length > 0 ? preservedUserIds : ["00000000-0000-0000-0000-000000000000"];
  const result = await client.query<{
    pupils: string;
    guardianships: string;
    staffToRemove: string;
    membershipsToRemove: string;
    admissionsEnquiries: string;
    admissionsApplications: string;
    attendanceMarks: string;
    timetableLessons: string;
    assignments: string;
    safeguardingRecords: string;
    pastoralConcerns: string;
    behaviourIncidents: string;
    medications: string;
    invoices: string;
    payments: string;
    receipts: string;
    storedDocuments: string;
    mailOutbox: string;
    academicYears: string;
    classes: string;
    notices: string;
    messages: string;
    notifications: string;
    activities: string;
    rewards: string;
    invitations: string;
    dataImports: string;
    censusRuns: string;
  }>(
    `select
        (select count(*)::text from student_profiles where organisation_id = $1) as "pupils",
        (select count(*)::text from guardianships where organisation_id = $1) as "guardianships",
        (select count(*)::text
           from organisation_memberships m
           join users u on u.id = m.user_id
          where m.organisation_id = $1
            and u.user_kind = 'staff'
            and m.user_id <> all($2::uuid[])) as "staffToRemove",
        (select count(*)::text
           from organisation_memberships
          where organisation_id = $1 and user_id <> all($2::uuid[])) as "membershipsToRemove",
        (select count(*)::text from admissions_enquiries where organisation_id = $1) as "admissionsEnquiries",
        (select count(*)::text from admissions_applications where organisation_id = $1) as "admissionsApplications",
        (select count(*)::text from attendance_marks where organisation_id = $1) as "attendanceMarks",
        (select count(*)::text from timetable_entries where organisation_id = $1) as "timetableLessons",
        (select count(*)::text from learning_assignments where organisation_id = $1) as "assignments",
        (select count(*)::text from safeguarding_concerns where organisation_id = $1) as "safeguardingRecords",
        (select count(*)::text from pastoral_concerns where organisation_id = $1) as "pastoralConcerns",
        (select count(*)::text from behaviour_incidents where organisation_id = $1) as "behaviourIncidents",
        (select count(*)::text from student_medications where organisation_id = $1) as "medications",
        (select count(*)::text from school_invoices where organisation_id = $1) as "invoices",
        (select count(*)::text from school_payment_transactions where organisation_id = $1) as "payments",
        (select count(*)::text from school_payment_receipts where organisation_id = $1) as "receipts",
        (select count(*)::text from stored_objects
          where organisation_id = $1
            and domain not in ('branding', 'transactional_email')) as "storedDocuments",
        (select count(*)::text from mail_outbox where organisation_id = $1) as "mailOutbox",
        (select count(*)::text from academic_years where organisation_id = $1) as "academicYears",
        (select count(*)::text from classes where organisation_id = $1) as "classes",
        (select count(*)::text from announcements where organisation_id = $1) as "notices",
        (select count(*)::text from messages where organisation_id = $1) as "messages",
        (select count(*)::text from notifications where organisation_id = $1) as "notifications",
        (select count(*)::text from school_activities where organisation_id = $1) as "activities",
        (select count(*)::text from pupil_rewards where organisation_id = $1) as "rewards",
        (select count(*)::text from invitations where organisation_id = $1) as "invitations",
        (select count(*)::text from data_imports where organisation_id = $1) as "dataImports",
        (select count(*)::text from census_runs where organisation_id = $1) as "censusRuns"`,
    [organisationId, preserved],
  );
  const row = result.rows[0];
  return {
    pupils: jsonSafeCount(row?.pupils),
    guardianships: jsonSafeCount(row?.guardianships),
    staffToRemove: jsonSafeCount(row?.staffToRemove),
    membershipsToRemove: jsonSafeCount(row?.membershipsToRemove),
    admissionsEnquiries: jsonSafeCount(row?.admissionsEnquiries),
    admissionsApplications: jsonSafeCount(row?.admissionsApplications),
    attendanceMarks: jsonSafeCount(row?.attendanceMarks),
    timetableLessons: jsonSafeCount(row?.timetableLessons),
    assignments: jsonSafeCount(row?.assignments),
    safeguardingRecords: jsonSafeCount(row?.safeguardingRecords),
    pastoralConcerns: jsonSafeCount(row?.pastoralConcerns),
    behaviourIncidents: jsonSafeCount(row?.behaviourIncidents),
    medications: jsonSafeCount(row?.medications),
    invoices: jsonSafeCount(row?.invoices),
    payments: jsonSafeCount(row?.payments),
    receipts: jsonSafeCount(row?.receipts),
    storedDocuments: jsonSafeCount(row?.storedDocuments),
    mailOutbox: jsonSafeCount(row?.mailOutbox),
    academicYears: jsonSafeCount(row?.academicYears),
    classes: jsonSafeCount(row?.classes),
    notices: jsonSafeCount(row?.notices),
    messages: jsonSafeCount(row?.messages),
    notifications: jsonSafeCount(row?.notifications),
    activities: jsonSafeCount(row?.activities),
    rewards: jsonSafeCount(row?.rewards),
    invitations: jsonSafeCount(row?.invitations),
    dataImports: jsonSafeCount(row?.dataImports),
    censusRuns: jsonSafeCount(row?.censusRuns),
  };
}

export async function countRemainingOperationalRows(
  client: pg.PoolClient | pg.Pool,
  organisationId: string,
  preservedUserIds: string[],
): Promise<number> {
  const preserved = preservedUserIds.length > 0 ? preservedUserIds : ["00000000-0000-0000-0000-000000000000"];
  const existing = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [[...OPERATIONAL_RESET_TABLES]],
  );
  const tableParts = existing.rows.map(
    (row) => `(select count(*) from ${quoteIdent(row.table_name)} where organisation_id = $1)`,
  );
  let total = 0;
  for (const chunk of chunkIdentifiedTables(tableParts, 16)) {
    total += await countOrZero(client, `select (${chunk.join(" + ")})::text as n`, [organisationId]);
  }
  total += await countOrZero(
    client,
    `select (
        (select count(*) from mail_outbox where organisation_id = $1)
      + (select count(*) from stored_objects
          where organisation_id = $1 and domain not in ('branding', 'transactional_email'))
      + (select count(*) from organisation_memberships where organisation_id = $1 and user_id <> all($2::uuid[]))
      + (select count(*) from staff_profiles where organisation_id = $1 and user_id <> all($2::uuid[]))
      + (select count(*) from user_login_aliases where organisation_id = $1 and user_id <> all($2::uuid[]))
      + (select count(*) from notification_preferences where organisation_id = $1 and user_id <> all($2::uuid[]))
      + (select count(*) from organisation_onboarding_preferences
          where organisation_id = $1 and user_id <> all($2::uuid[]))
      + (select count(*) from account_tokens where organisation_id = $1 and user_id <> all($2::uuid[]))
      + (select count(*) from roles where organisation_id = $1)
     )::text as n`,
    [organisationId, preserved],
  );
  return total;
}

export async function assertOperationalResetPlanCoversSchema(
  client: pg.PoolClient | pg.Pool,
): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `select c.table_name
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema
        and t.table_name = c.table_name
      where c.table_schema = 'public'
        and c.column_name = 'organisation_id'
        and t.table_type = 'BASE TABLE'
      order by c.table_name`,
  );
  const unknown: string[] = [];
  for (const row of result.rows) {
    if (!CLASSIFIED_TABLES.has(row.table_name)) {
      unknown.push(row.table_name);
    }
  }
  return unknown;
}

async function loadResetTables(client: pg.PoolClient): Promise<string[]> {
  const unknown = await assertOperationalResetPlanCoversSchema(client);
  if (unknown.length > 0) {
    throw new AppError(
      409,
      "operational_reset_plan_incomplete",
      `Reset plan operational_reset_v1 does not classify: ${unknown.join(", ")}`,
    );
  }
  const existing = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [[...OPERATIONAL_RESET_TABLES]],
  );
  return existing.rows.map((row) => row.table_name);
}

async function loadPreservedStoredObjectIds(
  client: pg.PoolClient,
  organisationId: string,
  preservedUserIds: string[],
): Promise<Set<string>> {
  const ids = new Set<string>();
  const settings = await client.query<{ logo_object_id: string | null; hero_object_id: string | null }>(
    `select logo_object_id, hero_object_id from organisation_settings where organisation_id = $1`,
    [organisationId],
  );
  for (const id of [settings.rows[0]?.logo_object_id, settings.rows[0]?.hero_object_id]) {
    if (id) ids.add(id);
  }
  const finance = await client.query<{ finance_logo_object_id: string | null }>(
    `select finance_logo_object_id from school_finance_settings where organisation_id = $1`,
    [organisationId],
  );
  if (finance.rows[0]?.finance_logo_object_id) ids.add(finance.rows[0].finance_logo_object_id);
  const attachments = await client.query<{ stored_object_id: string }>(
    `select stored_object_id
       from organisation_transactional_email_template_attachments
      where organisation_id = $1`,
    [organisationId],
  );
  for (const row of attachments.rows) ids.add(row.stored_object_id);
  const photos = await client.query<{ profile_photo_stored_object_id: string }>(
    `select profile_photo_stored_object_id
       from organisation_memberships
      where organisation_id = $1
        and user_id = any($2::uuid[])
        and profile_photo_stored_object_id is not null`,
    [organisationId, preservedUserIds],
  );
  for (const row of photos.rows) ids.add(row.profile_photo_stored_object_id);
  const branding = await client.query<{ id: string }>(
    `select id from stored_objects
      where organisation_id = $1 and domain in ('branding', 'transactional_email')`,
    [organisationId],
  );
  for (const row of branding.rows) ids.add(row.id);
  return ids;
}

async function nullifyPreservedFksToResetTables(
  client: pg.PoolClient,
  organisationId: string,
  resetTables: Set<string>,
): Promise<void> {
  const fks = await client.query<{
    table_name: string;
    column_name: string;
    foreign_table_name: string;
    is_nullable: string;
  }>(
    `select kcu.table_name,
            kcu.column_name,
            ccu.table_name as foreign_table_name,
            cols.is_nullable
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on tc.constraint_name = kcu.constraint_name
        and tc.table_schema = kcu.table_schema
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_name = tc.constraint_name
        and ccu.table_schema = tc.table_schema
       join information_schema.columns cols
         on cols.table_schema = kcu.table_schema
        and cols.table_name = kcu.table_name
        and cols.column_name = kcu.column_name
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = 'public'`,
  );
  const preserved = new Set<string>([
    ...OPERATIONAL_RESET_PRESERVED_TABLES,
    ...OPERATIONAL_RESET_CATALOGUE_TABLES,
    ...CONDITIONAL_ORG_TABLES,
  ]);
  for (const fk of fks.rows) {
    if (!preserved.has(fk.table_name) || !resetTables.has(fk.foreign_table_name)) continue;
    if (fk.table_name === "audit_events") continue;
    if (fk.is_nullable !== "YES") {
      throw new AppError(
        409,
        "operational_reset_plan_incomplete",
        `Cannot reset ${fk.foreign_table_name}; ${fk.table_name}.${fk.column_name} is required`,
      );
    }
    const hasOrg = await client.query(
      `select 1 from information_schema.columns
        where table_schema = 'public' and table_name = $1 and column_name = 'organisation_id'`,
      [fk.table_name],
    );
    if ((hasOrg.rowCount ?? 0) > 0) {
      await client.query(
        `update ${quoteIdent(fk.table_name)}
            set ${quoteIdent(fk.column_name)} = null
          where organisation_id = $1
            and ${quoteIdent(fk.column_name)} is not null`,
        [organisationId],
      );
    }
  }
}

async function orderTablesForDelete(client: pg.PoolClient, tables: string[]): Promise<string[]> {
  const remaining = new Set(tables);
  const fks = await client.query<{ child: string; parent: string }>(
    `select kcu.table_name as child, ccu.table_name as parent
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on tc.constraint_name = kcu.constraint_name
        and tc.table_schema = kcu.table_schema
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_name = tc.constraint_name
        and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = 'public'
        and kcu.table_name = any($1::text[])
        and ccu.table_name = any($1::text[])
        and kcu.table_name <> ccu.table_name`,
    [tables],
  );
  const inbound = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const table of tables) inbound.set(table, 0);
  for (const fk of fks.rows) {
    if (!remaining.has(fk.child) || !remaining.has(fk.parent)) continue;
    inbound.set(fk.parent, (inbound.get(fk.parent) ?? 0) + 1);
    const list = children.get(fk.child) ?? [];
    list.push(fk.parent);
    children.set(fk.child, list);
  }
  const ready = tables.filter((table) => (inbound.get(table) ?? 0) === 0);
  const ordered: string[] = [];
  while (ready.length > 0) {
    const table = ready.shift()!;
    ordered.push(table);
    for (const parent of children.get(table) ?? []) {
      const next = (inbound.get(parent) ?? 0) - 1;
      inbound.set(parent, next);
      if (next === 0) ready.push(parent);
    }
  }
  for (const table of tables) {
    if (!ordered.includes(table)) ordered.push(table);
  }
  return ordered;
}

function preferOperationalResetDeleteOrder(tables: string[]): string[] {
  const preferred = new Set<string>(OPERATIONAL_RESET_DELETE_FIRST);
  return [...tables.filter((table) => preferred.has(table)), ...tables.filter((table) => !preferred.has(table))];
}

async function deleteResetTables(
  client: pg.PoolClient,
  tables: string[],
  organisationId: string,
): Promise<void> {
  const remaining = new Set(preferOperationalResetDeleteOrder(await orderTablesForDelete(client, tables)));
  let lastError: unknown = null;
  for (let pass = 0; pass < 24 && remaining.size > 0; pass += 1) {
    const failed = new Set<string>();
    for (const table of [...remaining]) {
      try {
        await client.query("savepoint operational_reset_delete");
        await client.query(`delete from ${quoteIdent(table)} where organisation_id = $1`, [organisationId]);
        await client.query("release savepoint operational_reset_delete");
        remaining.delete(table);
      } catch (error) {
        await client.query("rollback to savepoint operational_reset_delete").catch(() => undefined);
        if (!isFkViolation(error)) throw error;
        lastError = error;
        failed.add(table);
      }
    }
    if (failed.size === remaining.size && remaining.size > 0 && pass > 0) {
      const fks = await client.query<{ table_name: string; column_name: string; is_nullable: string }>(
        `select kcu.table_name, kcu.column_name, cols.is_nullable
           from information_schema.table_constraints tc
           join information_schema.key_column_usage kcu
             on tc.constraint_name = kcu.constraint_name
            and tc.table_schema = kcu.table_schema
           join information_schema.columns cols
             on cols.table_schema = kcu.table_schema
            and cols.table_name = kcu.table_name
            and cols.column_name = kcu.column_name
          where tc.constraint_type = 'FOREIGN KEY'
            and tc.table_schema = 'public'
            and kcu.table_name = any($1::text[])
            and cols.is_nullable = 'YES'`,
        [[...remaining]],
      );
      for (const fk of fks.rows) {
        if (!remaining.has(fk.table_name)) continue;
        if (PAYMENT_TARGET_TABLES.has(fk.table_name) && PAYMENT_TARGET_COLUMNS.has(fk.column_name)) continue;
        await client.query(
          `update ${quoteIdent(fk.table_name)}
              set ${quoteIdent(fk.column_name)} = null
            where organisation_id = $1
              and ${quoteIdent(fk.column_name)} is not null`,
          [organisationId],
        );
      }
    }
  }
  if (remaining.size > 0) {
    const detail = lastError instanceof Error ? lastError.message : "foreign key remains";
    throw new AppError(
      409,
      "operational_reset_blocked",
      `Could not delete ${[...remaining].join(", ")}: ${detail}`,
    );
  }
}

async function cancelAndDeleteMail(
  client: pg.PoolClient,
  organisationId: string,
): Promise<void> {
  try {
    const locked = await client.query<{ id: string; status: string }>(
      `select id, status from mail_outbox where organisation_id = $1 for update nowait`,
      [organisationId],
    );
    if (locked.rows.some((row) => row.status === "sending")) {
      throw new AppError(
        409,
        "mail_delivery_in_progress",
        "Mail is currently sending for this school. Retry the reset after delivery finishes.",
      );
    }
    await client.query(
      `update mail_outbox
          set status = 'cancelled',
              action_url = null,
              last_error_code = coalesce(last_error_code, 'operational_reset'),
              last_error_redacted = 'Cancelled because school operational data was reset',
              updated_at = now()
        where organisation_id = $1
          and status in ('queued', 'failed')`,
      [organisationId],
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isLockNotAvailable(error)) {
      throw new AppError(
        409,
        "mail_delivery_in_progress",
        "Mail is currently sending for this school. Retry the reset after delivery finishes.",
      );
    }
    throw error;
  }
}

async function removeNonAdminPeople(
  client: pg.PoolClient,
  organisationId: string,
  preservedUserIds: string[],
): Promise<void> {
  const preserved = preservedUserIds.length > 0 ? preservedUserIds : ["00000000-0000-0000-0000-000000000000"];
  const removed = await client.query<{ user_id: string }>(
    `select user_id from organisation_memberships
      where organisation_id = $1 and user_id <> all($2::uuid[])`,
    [organisationId, preserved],
  );
  const removedUserIds = removed.rows.map((row) => row.user_id);
  await client.query(
    `update organisation_memberships
        set profile_photo_stored_object_id = null
      where organisation_id = $1
        and user_id <> all($2::uuid[])`,
    [organisationId, preserved],
  );
  await client.query("savepoint operational_reset_audit_membership");
  try {
    await client.query(
      `update audit_events
          set actor_membership_id = null
        where organisation_id = $1
          and actor_membership_id in (
            select id from organisation_memberships
             where organisation_id = $1 and user_id <> all($2::uuid[])
          )`,
      [organisationId, preserved],
    );
    await client.query("release savepoint operational_reset_audit_membership");
  } catch {
    await client.query("rollback to savepoint operational_reset_audit_membership");
  }
  await client.query(
    `delete from staff_profiles
      where organisation_id = $1 and user_id <> all($2::uuid[])`,
    [organisationId, preserved],
  );
  await client.query(
    `delete from user_login_aliases
      where organisation_id = $1 and user_id <> all($2::uuid[])`,
    [organisationId, preserved],
  );
  await client.query(
    `delete from notification_preferences
      where organisation_id = $1 and user_id <> all($2::uuid[])`,
    [organisationId, preserved],
  );
  await client.query(
    `delete from organisation_onboarding_preferences
      where organisation_id = $1 and user_id <> all($2::uuid[])`,
    [organisationId, preserved],
  );
  await client.query(
    `delete from account_tokens
      where organisation_id = $1 and user_id <> all($2::uuid[])`,
    [organisationId, preserved],
  );
  await client.query(
    `delete from organisation_memberships
      where organisation_id = $1 and user_id <> all($2::uuid[])`,
    [organisationId, preserved],
  );
  await client.query(
    `delete from membership_roles
      where role_id in (select id from roles where organisation_id = $1)`,
    [organisationId],
  );
  await client.query(`delete from roles where organisation_id = $1`, [organisationId]);
  if (removedUserIds.length === 0) return;
  await client.query(
    `update auth_sessions s
        set revoked_at = coalesce(s.revoked_at, now())
      where s.revoked_at is null
        and s.user_id = any($1::uuid[])
        and s.user_id not in (select user_id from platform_admins)
        and s.user_id <> all($2::uuid[])
        and not exists (
          select 1 from organisation_memberships m
           where m.user_id = s.user_id
             and m.status = 'active'
             and m.ended_at is null
        )`,
    [removedUserIds, preserved],
  );
}

async function updateSetupProgress(client: pg.PoolClient, organisationId: string): Promise<void> {
  await client.query(
    `update organisation_setup_progress
        set completed_steps = kept.steps,
            current_step = case
              when 'branding' = any(kept.steps) then 'academic_year'
              when 'school_details' = any(kept.steps) then 'branding'
              else 'school_details'
            end,
            completed_at = null,
            ready_marked_at = null,
            updated_at = now()
       from (
         select organisation_id,
                coalesce(
                  (select array_agg(step)
                     from unnest(completed_steps) as step
                    where step in ('school_details', 'branding')),
                  '{}'::text[]
                ) as steps
           from organisation_setup_progress
          where organisation_id = $1
       ) kept
      where organisation_setup_progress.organisation_id = kept.organisation_id`,
    [organisationId],
  );
}

export async function verifyOperationalReset(
  client: pg.PoolClient | pg.Pool,
  organisationId: string,
  preservedUserIds: string[],
): Promise<Record<string, boolean>> {
  const org = await client.query(`select id, slug, status from organisations where id = $1`, [organisationId]);
  const admins = await listActiveSchoolAdmins(client, organisationId);
  const preservedStillPresent = preservedUserIds.every((id) => admins.some((admin) => admin.userId === id));
  const pupils = await countOrZero(client, "select count(*)::text as n from student_profiles where organisation_id = $1", [
    organisationId,
  ]);
  const guardianships = await countOrZero(
    client,
    "select count(*)::text as n from guardianships where organisation_id = $1",
    [organisationId],
  );
  const enquiries = await countOrZero(
    client,
    "select count(*)::text as n from admissions_enquiries where organisation_id = $1",
    [organisationId],
  );
  const applications = await countOrZero(
    client,
    "select count(*)::text as n from admissions_applications where organisation_id = $1",
    [organisationId],
  );
  const timetable = await countOrZero(
    client,
    "select count(*)::text as n from timetable_entries where organisation_id = $1",
    [organisationId],
  );
  const attendance = await countOrZero(
    client,
    "select count(*)::text as n from attendance_marks where organisation_id = $1",
    [organisationId],
  );
  const assignments = await countOrZero(
    client,
    "select count(*)::text as n from learning_assignments where organisation_id = $1",
    [organisationId],
  );
  const safeguarding = await countOrZero(
    client,
    "select count(*)::text as n from safeguarding_concerns where organisation_id = $1",
    [organisationId],
  );
  const invoices = await countOrZero(
    client,
    "select count(*)::text as n from school_invoices where organisation_id = $1",
    [organisationId],
  );
  const payments = await countOrZero(
    client,
    "select count(*)::text as n from school_payment_transactions where organisation_id = $1",
    [organisationId],
  );
  const receipts = await countOrZero(
    client,
    "select count(*)::text as n from school_payment_receipts where organisation_id = $1",
    [organisationId],
  );
  const queuedMail = await countOrZero(
    client,
    `select count(*)::text as n from mail_outbox
      where organisation_id = $1 and status in ('queued', 'sending', 'failed')`,
    [organisationId],
  );
  const operationalFiles = await countOrZero(
    client,
    `select count(*)::text as n from stored_objects
      where organisation_id = $1
        and domain not in ('branding', 'transactional_email')
        and status <> 'deleted'`,
    [organisationId],
  );
  const host = await client.query(
    `select 1 from organisations where id = $1 and slug is not null and btrim(slug::text) <> ''`,
    [organisationId],
  );
  return {
    organisationExists: (org.rowCount ?? 0) === 1,
    hostnameResolves: (host.rowCount ?? 0) === 1,
    atLeastOneSchoolAdmin: admins.length >= 1,
    preservedSchoolAdminsRemain: preservedStillPresent && admins.length >= preservedUserIds.length,
    noPupils: pupils === 0,
    noGuardianships: guardianships === 0,
    noAdmissions: enquiries === 0 && applications === 0,
    noTimetableAttendanceLms: timetable === 0 && attendance === 0 && assignments === 0,
    noSafeguarding: safeguarding === 0,
    noFinanceOperational: invoices === 0 && payments === 0 && receipts === 0,
    noQueuedMail: queuedMail === 0,
    noOperationalFiles: operationalFiles === 0,
  };
}

async function buildPreviewFromClient(
  client: pg.PoolClient | pg.Pool,
  organisationId: string,
): Promise<OperationalResetPreview> {
  const org = (
    await client.query<{ id: string; slug: string; name: string; status: string }>(
      `select id, slug::text as slug, name, status from organisations where id = $1`,
      [organisationId],
    )
  ).rows[0];
  if (!org) throw new AppError(404, "not_found", "Not found");
  if (isReservedSubdomain(org.slug)) {
    throw new AppError(400, "forbidden", "The platform or system tenant cannot be reset");
  }
  const unknown = await assertOperationalResetPlanCoversSchema(client);
  if (unknown.length > 0) {
    throw new AppError(
      409,
      "operational_reset_plan_incomplete",
      `Reset plan operational_reset_v1 does not classify: ${unknown.join(", ")}`,
    );
  }
  const schoolAdminsPreserved = await listActiveSchoolAdmins(client, organisationId);
  const preservedUserIds = schoolAdminsPreserved.map((admin) => admin.userId);
  const counts = await loadOperationalResetCounts(client, organisationId, preservedUserIds);
  const remainingOperationalRows = await countRemainingOperationalRows(client, organisationId, preservedUserIds);
  const liveBlockReason = await liveFinancialResetBlockReason(client, organisationId);
  if (process.env.VITEST !== "true") {
    console.info("operational_reset_preview", {
      organisationId,
      liveFinancialResetBlocked: liveBlockReason !== null,
      liveFinancialResetBlockReason: liveBlockReason,
      schoolAdminCount: schoolAdminsPreserved.length,
      remainingOperationalRows,
    });
  }
  return {
    mode: OPERATIONAL_RESET_MODE,
    organisation: org,
    schoolAdminsPreserved,
    counts,
    preserved: OPERATIONAL_RESET_PRESERVED_CATEGORIES.map((item) => ({ key: item.key, label: item.label })),
    liveFinancialResetBlocked: liveBlockReason !== null,
    remainingOperationalRows,
    alreadyClean: remainingOperationalRows === 0,
  };
}

export async function previewOperationalReset(input: {
  owner: pg.Pool;
  organisationId: string;
  actorUserId: string;
}): Promise<OperationalResetPreview> {
  let client: pg.PoolClient;
  try {
    client = await input.owner.connect();
  } catch (error) {
    logUnexpectedOperationalResetError(
      "preview",
      { organisationId: input.organisationId, actorUserId: input.actorUserId, phase: "connect" },
      error,
    );
    throw error;
  }
  try {
    await client.query("begin read only");
    try {
      await client.query("set local statement_timeout = '30s'");
      await requirePlatformAdmin(client, input.actorUserId);
      await loadOrganisation(client, input.organisationId, false);
      const preview = await buildPreviewFromClient(client, input.organisationId);
      await client.query("commit");
      return preview;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      logUnexpectedOperationalResetError(
        "preview",
        { organisationId: input.organisationId, actorUserId: input.actorUserId },
        error,
      );
      throw error;
    }
  } finally {
    client.release();
  }
}

export async function executeOperationalReset(input: {
  owner: pg.Pool;
  storage: OperationalResetStorage;
  actorUserId: string;
  organisationId: string;
  confirmationText: string;
  backupConfirmed: boolean;
  understandPermanent: boolean;
  resetMode: string;
  testOnlyFailBeforeCommit?: boolean;
}): Promise<OperationalResetResult> {
  if (input.resetMode !== OPERATIONAL_RESET_MODE) {
    throw new AppError(400, "validation_failed", "Unsupported reset mode");
  }
  if (input.backupConfirmed !== true) {
    throw new AppError(400, "backup_not_confirmed", "A current backup must be confirmed before reset");
  }
  if (input.understandPermanent !== true) {
    throw new AppError(
      400,
      "confirmation_required",
      "You must confirm that this permanently deletes operational data",
    );
  }

  const client = await input.owner.connect();
  let blobKeys: string[] = [];
  try {
    await client.query("begin");
    await requirePlatformAdmin(client, input.actorUserId);
    const org = await loadOrganisation(client, input.organisationId, true);
    if (!confirmationMatchesOrganisation({ typed: input.confirmationText, slug: org.slug, name: org.name })) {
      throw new AppError(400, "confirmation_mismatch", "Confirmation text does not match this school");
    }
    const schoolAdmins = await listActiveSchoolAdmins(client, org.id);
    if (schoolAdmins.length < 1) {
      throw new AppError(
        409,
        "school_admin_required",
        "Reset cannot run because this school has no active School Admin to preserve",
      );
    }
    const preservedUserIds = schoolAdmins.map((admin) => admin.userId);
    if (await liveFinancialResetBlocked(client, org.id)) {
      throw new AppError(
        409,
        "live_financial_reset_blocked",
        "Reset is blocked because this school has live Stripe mode or live payment evidence",
      );
    }

    const beforePreview = await buildPreviewFromClient(client, org.id);
    await cancelAndDeleteMail(client, org.id);

    const resetTables = await loadResetTables(client);
    await nullifyPreservedFksToResetTables(client, org.id, new Set(resetTables));

    const preservedObjects = await loadPreservedStoredObjectIds(client, org.id, preservedUserIds);
    const toDelete = await client.query<{ storage_key: string }>(
      `select storage_key from stored_objects
        where organisation_id = $1
          and not (id = any($2::uuid[]))`,
      [org.id, [...preservedObjects]],
    );
    blobKeys = toDelete.rows.map((row) => row.storage_key);

    await deleteResetTables(client, resetTables, org.id);
    await removeNonAdminPeople(client, org.id, preservedUserIds);
    await client.query(
      `delete from stored_objects
        where organisation_id = $1
          and not (id = any($2::uuid[]))`,
      [org.id, [...preservedObjects]],
    );
    await client.query(`delete from mail_outbox where organisation_id = $1`, [org.id]);
    await updateSetupProgress(client, org.id);

    const preview = await buildPreviewFromClient(client, org.id);
    const verification = await verifyOperationalReset(client, org.id, preservedUserIds);
    const failed = Object.entries(verification).filter(([, ok]) => !ok).map(([key]) => key);
    if (failed.length > 0) {
      throw new AppError(500, "reset_verification_failed", `Post-reset verification failed: ${failed.join(", ")}`);
    }

    await client.query(
      `insert into audit_events (
         organisation_id, actor_user_id, action, entity_type, entity_id, after_data, priority
       ) values ($1, $2, 'platform.organisation.operational_reset', 'organisation', $1, $3::jsonb, 'high')`,
      [
        org.id,
        input.actorUserId,
        JSON.stringify({
          mode: OPERATIONAL_RESET_MODE,
          slug: org.slug,
          deletedCounts: beforePreview.counts,
          preservedCategories: OPERATIONAL_RESET_PRESERVED_CATEGORIES.map((item) => item.key),
          preservedSchoolAdminCount: schoolAdmins.length,
          alreadyClean: beforePreview.alreadyClean,
        }),
      ],
    );

    if (input.testOnlyFailBeforeCommit && process.env.VITEST === "true") {
      throw new AppError(500, "injected_failure", "Injected failure before commit");
    }

    await client.query("commit");

    let blobsDeleted = 0;
    let blobsFailed = 0;
    for (const key of blobKeys) {
      try {
        await input.storage.deleteObject(key);
        blobsDeleted += 1;
      } catch {
        blobsFailed += 1;
      }
    }

    return {
      ...preview,
      deletedCounts: beforePreview.counts,
      verification,
      blobsScheduled: blobKeys.length,
      blobsDeleted,
      blobsFailed,
    };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Connection may already be broken.
    }
    logUnexpectedOperationalResetError(
      "execute",
      { organisationId: input.organisationId, actorUserId: input.actorUserId },
      error,
    );
    throw error;
  } finally {
    client.release();
  }
}
