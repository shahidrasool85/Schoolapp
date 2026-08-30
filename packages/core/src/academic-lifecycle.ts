import type pg from "pg";
import {
  academicLifecycleFromUsage,
  summarizeAcademicUsage,
  type AcademicLifecycle,
  type AcademicRecordStatus,
  type AcademicUsageCount,
} from "@schoolapp/domain";

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

const USAGE_LABELS: Record<string, string> = {
  class_subjects: "class links",
  timetable_entries: "timetable entries",
  timetable_exceptions: "timetable replacements",
  learning_assignments: "assignments",
  learning_assignment_targets: "assignment targets",
  learning_activity_definitions: "learning activities",
  academic_assessments: "assessments",
  academic_assessment_classes: "assessment classes",
  academic_targets: "academic targets",
  academic_report_sections: "report sections",
  academic_reporting_periods: "reporting periods",
  academic_reports: "reports",
  class_memberships: "pupil enrolments",
  class_staff_assignments: "teacher assignments",
  classes: "classes",
  student_enrolments: "pupil enrolments",
  attendance_marks: "attendance marks",
  terms: "terms",
  half_terms: "half terms",
  fee_schedules: "fee schedules",
  invoices: "invoices",
  billing_runs: "billing runs",
  charges: "charges",
  census_runs: "census runs",
  admissions_applications: "admissions applications",
  admissions_enquiries: "admissions enquiries",
  admissions_offers: "admissions offers",
  activity_targets: "activity targets",
};

const CONFIG_ONLY_TABLES = new Set(["student_portal_year_group_overrides"]);

export type AcademicEntityKind = "subject" | "class" | "year_group" | "academic_year";

const TARGET_TABLE: Record<AcademicEntityKind, string> = {
  subject: "subjects",
  class: "classes",
  year_group: "year_groups",
  academic_year: "academic_years",
};

export async function countForeignKeyUsage(
  client: Queryable,
  entityKind: AcademicEntityKind,
  entityId: string,
  organisationId: string,
): Promise<AcademicUsageCount[]> {
  const target = TARGET_TABLE[entityKind];
  const refs = await client.query(
    `select c.conrelid::regclass::text as table_name, a.attname as column_name
     from pg_constraint c
     join pg_attribute a
       on a.attrelid = c.conrelid
      and a.attnum = any (c.conkey)
     where c.contype = 'f'
       and c.confrelid = $1::regclass`,
    [target],
  );
  const counts = new Map<string, AcademicUsageCount>();
  for (const ref of refs.rows) {
    const table = String(ref.table_name).replace(/^public\./, "");
    if (table.includes(".") || CONFIG_ONLY_TABLES.has(table)) continue;
    const column = String(ref.column_name);
    if (!/^[a-z_][a-z0-9_]*$/.test(table) || !/^[a-z_][a-z0-9_]*$/.test(column)) continue;
    const hasOrg = await client.query(
      `select 1 from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = 'organisation_id'`,
      [table],
    );
    const sql = hasOrg.rows[0]
      ? `select count(*)::int as n from ${table} where ${column} = $1 and organisation_id = $2`
      : `select count(*)::int as n from ${table} where ${column} = $1`;
    const counted = await client.query(sql, hasOrg.rows[0] ? [entityId, organisationId] : [entityId]);
    const count = Number(counted.rows[0]?.n ?? 0);
    const existing = counts.get(table);
    if (existing) existing.count += count;
    else {
      counts.set(table, {
        key: table,
        label: USAGE_LABELS[table] ?? table.replace(/_/g, " "),
        count,
      });
    }
  }
  return [...counts.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export async function loadAcademicLifecycle(
  client: Queryable,
  entityKind: AcademicEntityKind,
  entityId: string,
  organisationId: string,
  status: AcademicRecordStatus,
  extras?: { extraBlockReasons?: string[]; archiveBlockedReasons?: string[]; entityLabel?: string },
): Promise<AcademicLifecycle> {
  const usage = await countForeignKeyUsage(client, entityKind, entityId, organisationId);
  return academicLifecycleFromUsage({
    status,
    usage,
    extraBlockReasons: extras?.extraBlockReasons,
    archiveBlockedReasons: extras?.archiveBlockedReasons,
    entityLabel: extras?.entityLabel,
  });
}

export function deletionBlockedError(entityLabel: string, lifecycle: AcademicLifecycle) {
  return {
    code: "cannot_delete" as const,
    message: lifecycle.message || summarizeAcademicUsage(lifecycle.usage, entityLabel),
    details: {
      canArchive: lifecycle.canArchive,
      usage: lifecycle.usage.filter((item) => item.count > 0),
    },
  };
}

export async function deleteConfigOnlyYearGroupLinks(
  client: pg.PoolClient,
  yearGroupId: string,
  organisationId: string,
): Promise<void> {
  await client.query(
    `delete from student_portal_year_group_overrides
     where year_group_id = $1 and organisation_id = $2`,
    [yearGroupId, organisationId],
  );
}

export function includeArchivedRequested(value: string | undefined): boolean {
  return value === "1" || value === "true";
}
