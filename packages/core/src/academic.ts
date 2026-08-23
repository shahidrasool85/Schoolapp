import type pg from "pg";

export async function writeAudit(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await client.query(
    `insert into audit_events (
       organisation_id, actor_user_id, action, entity_type, entity_id, before_data, after_data
     ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      input.organisationId,
      input.actorUserId,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
    ],
  );
}

export async function currentAcademicYear(
  client: pg.PoolClient,
  organisationId: string,
): Promise<{ id: string; name: string; starts_on: string; ends_on: string } | null> {
  const result = await client.query<{
    id: string;
    name: string;
    starts_on: string;
    ends_on: string;
  }>(
    `select id, name, starts_on::text, ends_on::text
     from academic_years
     where organisation_id = $1 and is_current
     limit 1`,
    [organisationId],
  );
  return result.rows[0] ?? null;
}

export async function endDatedRow(
  client: pg.PoolClient,
  table: "class_memberships" | "class_staff_assignments" | "student_enrolments" | "guardianships",
  id: string,
  organisationId: string,
  endedOn: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query<Record<string, unknown>>(
    `update ${table}
     set ended_on = $3::date
     where id = $1 and organisation_id = $2 and ended_on is null
     returning *`,
    [id, organisationId, endedOn],
  );
  return result.rows[0] ?? null;
}

export function isoDate(value: Date | string = new Date()): string {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}
