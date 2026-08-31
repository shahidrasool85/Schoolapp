import type pg from "pg";
import {
  recurrenceLifecycleFromState,
  todayInTimeZone,
  DEFAULT_SCHOOL_TIMEZONE,
  type RecurrenceLifecycle,
  type RecurrenceUsageCount,
} from "@schoolapp/domain";

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export async function loadOrganisationTimezone(
  client: Queryable,
  organisationId: string,
): Promise<string> {
  const result = await client.query(`select timezone from organisations where id = $1`, [organisationId]);
  const timezone = String(result.rows[0]?.timezone ?? "").trim();
  return timezone || DEFAULT_SCHOOL_TIMEZONE;
}

export async function schoolToday(client: Queryable, organisationId: string, now = new Date()): Promise<string> {
  return todayInTimeZone(await loadOrganisationTimezone(client, organisationId), now);
}

export async function countRecurrenceUsage(
  client: Queryable,
  organisationId: string,
  entry: { id: string; classId: string; weekday: number; effectiveFrom: string; effectiveUntil: string | null },
): Promise<RecurrenceUsageCount[]> {
  const exceptions = await client.query(
    `select count(*)::int as n from timetable_exceptions
     where organisation_id = $1 and timetable_entry_id = $2`,
    [organisationId, entry.id],
  );
  const covers = await client.query(
    `select count(*)::int as n from timetable_covers
     where organisation_id = $1 and timetable_entry_id = $2`,
    [organisationId, entry.id],
  );
  const attendance = await client.query(
    `select count(*)::int as n from attendance_marks
     where organisation_id = $1
       and class_id = $2
       and mark_date >= $3::date
       and ($4::date is null or mark_date <= $4::date)
       and extract(isodow from mark_date)::int = $5`,
    [organisationId, entry.classId, entry.effectiveFrom, entry.effectiveUntil, entry.weekday],
  );
  return [
    { key: "timetable_exceptions", label: "cover or timetable changes", count: Number(exceptions.rows[0]?.n ?? 0) },
    { key: "timetable_covers", label: "cover assignments", count: Number(covers.rows[0]?.n ?? 0) },
    { key: "attendance_marks", label: "attendance marks", count: Number(attendance.rows[0]?.n ?? 0) },
  ];
}

export async function loadRecurrenceLifecycle(
  client: Queryable,
  organisationId: string,
  entry: {
    id: string;
    classId: string;
    weekday: number;
    effectiveFrom: string;
    effectiveUntil: string | null;
    isActive: boolean;
  },
  today?: string,
): Promise<RecurrenceLifecycle> {
  const asOf = today ?? (await schoolToday(client, organisationId));
  const usage = await countRecurrenceUsage(client, organisationId, entry);
  return recurrenceLifecycleFromState({
    effectiveFrom: entry.effectiveFrom,
    effectiveUntil: entry.effectiveUntil,
    isActive: entry.isActive,
    today: asOf,
    usage,
  });
}

export async function loadTermLifecycle(
  client: pg.PoolClient,
  organisationId: string,
  termId: string,
): Promise<{ canDelete: boolean; usage: RecurrenceUsageCount[]; message: string }> {
  const entries = await client.query(
    `select count(*)::int as n from timetable_entries where organisation_id = $1 and term_id = $2`,
    [organisationId, termId],
  );
  const halfTerms = await client.query(
    `select count(*)::int as n from half_terms where organisation_id = $1 and term_id = $2`,
    [organisationId, termId],
  );
  const reporting = await client.query(
    `select count(*)::int as n from academic_reporting_periods where organisation_id = $1 and term_id = $2`,
    [organisationId, termId],
  );
  const assessments = await client.query(
    `select count(*)::int as n from academic_assessments
     where organisation_id = $1 and reporting_period_id in (
       select id from academic_reporting_periods where organisation_id = $1 and term_id = $2
     )`,
    [organisationId, termId],
  );
  const usage: RecurrenceUsageCount[] = [
    { key: "timetable_entries", label: "timetable entries", count: Number(entries.rows[0]?.n ?? 0) },
    { key: "half_terms", label: "half terms", count: Number(halfTerms.rows[0]?.n ?? 0) },
    { key: "academic_reporting_periods", label: "reporting periods", count: Number(reporting.rows[0]?.n ?? 0) },
    { key: "academic_assessments", label: "assessments", count: Number(assessments.rows[0]?.n ?? 0) },
  ].filter((item) => item.count > 0);
  if (usage.length === 0) {
    return {
      canDelete: true,
      usage,
      message: "This term has not been used anywhere and can be permanently deleted.",
    };
  }
  const parts = usage.map((item) => `${item.count} ${item.label}`);
  const last = parts[parts.length - 1];
  const joined = parts.length === 1 ? last : `${parts.slice(0, -1).join(", ")} and ${last}`;
  return {
    canDelete: false,
    usage,
    message: `This term cannot be deleted because it has ${joined}. Leave it in place so history is kept.`,
  };
}
