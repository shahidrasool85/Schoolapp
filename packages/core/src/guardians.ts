import type pg from "pg";
import { isPrimaryGuardianContact } from "@schoolapp/domain";

export async function listStudentGuardiansForActor(
  client: pg.PoolClient,
  actorUserId: string,
  organisationId: string,
  studentProfileId: string,
): Promise<Array<Record<string, unknown>>> {
  const result = await client.query(
    `select * from list_student_guardians_for_actor($1, $2, $3)`,
    [actorUserId, organisationId, studentProfileId],
  );
  return result.rows as Array<Record<string, unknown>>;
}

export async function listOrganisationGuardiansForActor(
  client: pg.PoolClient,
  actorUserId: string,
  organisationId: string,
): Promise<Array<Record<string, unknown>>> {
  const result = await client.query(
    `select * from list_organisation_guardians_for_actor($1, $2)`,
    [actorUserId, organisationId],
  );
  return result.rows as Array<Record<string, unknown>>;
}

export async function designatePrimaryGuardian(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
  guardianshipId: string,
): Promise<void> {
  await client.query(
    `update guardianships
     set priority = 2
     where organisation_id = $1
       and student_profile_id = $2
       and ended_on is null
       and id <> $3
       and priority = 1`,
    [organisationId, studentProfileId, guardianshipId],
  );
  await client.query(
    `update guardianships
     set priority = 1
     where organisation_id = $1
       and student_profile_id = $2
       and id = $3`,
    [organisationId, studentProfileId, guardianshipId],
  );
}

export async function applyGuardianPrimaryChoice(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
  guardianshipId: string,
  input: { isPrimary?: boolean; explicitPriority?: number } = {},
): Promise<void> {
  const others = await client.query<{ n: string }>(
    `select count(*)::text as n
     from guardianships
     where organisation_id = $1
       and student_profile_id = $2
       and ended_on is null
       and id <> $3`,
    [organisationId, studentProfileId, guardianshipId],
  );
  const otherCount = Number(others.rows[0]?.n ?? 0);
  const makePrimary =
    input.isPrimary === true ||
    (input.isPrimary !== false && input.explicitPriority === 1) ||
    otherCount === 0;
  if (makePrimary) {
    await designatePrimaryGuardian(client, organisationId, studentProfileId, guardianshipId);
    return;
  }
  await ensureNonPrimaryGuardianPriority(client, organisationId, studentProfileId, guardianshipId);
}

export async function ensureNonPrimaryGuardianPriority(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId: string,
  guardianshipId: string,
): Promise<void> {
  const others = await client.query<{ max_priority: number | null; has_primary: boolean }>(
    `select
       max(priority) as max_priority,
       bool_or(priority = 1) as has_primary
     from guardianships
     where organisation_id = $1
       and student_profile_id = $2
       and ended_on is null
       and id <> $3`,
    [organisationId, studentProfileId, guardianshipId],
  );
  if (!others.rows[0]?.has_primary) return;
  const next = Math.max(Number(others.rows[0].max_priority ?? 1) + 1, 2);
  await client.query(
    `update guardianships
     set priority = $4
     where organisation_id = $1
       and student_profile_id = $2
       and id = $3
       and priority = 1`,
    [organisationId, studentProfileId, guardianshipId, next],
  );
}

export { isPrimaryGuardianContact };
