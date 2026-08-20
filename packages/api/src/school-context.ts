import type { Context } from "hono";
import type pg from "pg";
import { PERMISSIONS, type Actor, type UserKind } from "@schoolapp/domain";
import { AppError, pgErrorToAppError } from "@schoolapp/core";
import { withTenantContext } from "@schoolapp/db";
import type { ApiEnv } from "./types";
import { requireBoundOrganisationId } from "./tenant-resolver";

export type SchoolCtx = {
  client: pg.PoolClient;
  actor: Actor;
  orgId: string;
  userId: string;
};

export async function loadActor(
  client: pg.PoolClient,
  userId: string,
  orgId: string,
): Promise<Actor> {
  const user = await client.query<{ user_kind: UserKind }>(
    "select user_kind from users where id = $1",
    [userId],
  );
  const perms = await client.query<{ permission_key: string }>(
    "select permission_key from list_permissions_for_membership($1, $2)",
    [userId, orgId],
  );
  const memberships = await client.query<{
    membership_id: string;
    organisation_id: string;
    role_keys: string[];
    status: string;
  }>("select * from list_memberships_for_user($1)", [userId]);
  const current = memberships.rows.find((row) => row.organisation_id === orgId);
  const grant = await client.query<{ id: string }>(
    `select id from support_access_grants
     where actor_user_id = $1 and organisation_id = $2
       and revoked_at is null and expires_at > now() and scope = 'organisation'
     limit 1`,
    [userId, orgId],
  );

  return {
    userId,
    userKind: user.rows[0]?.user_kind ?? "staff",
    isPlatformAdmin: false,
    organisationId: orgId,
    membershipId: current?.status === "active" ? current.membership_id : null,
    roleKeys: current?.role_keys ?? [],
    permissions: new Set(perms.rows.map((row) => row.permission_key)),
    supportAccessGrantId: grant.rows[0]?.id ?? null,
  };
}

export async function withSchoolActor<T>(
  c: Context<ApiEnv>,
  fn: (ctx: SchoolCtx) => Promise<T>,
): Promise<T> {
  const orgId = requireBoundOrganisationId(c);
  const userId = c.get("userId");
  try {
    return await withTenantContext(c.get("config").pools.app, userId, orgId, async (client) => {
      const actor = await loadActor(client, userId, orgId);
      return fn({ client, actor, orgId, userId });
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw pgErrorToAppError(error) ?? error;
  }
}

export const academicReadPermissions = [
  PERMISSIONS.ACADEMIC_STRUCTURE_READ,
  PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE,
] as const;

export const studentListPermissions = [
  PERMISSIONS.STUDENTS_PROFILES_READ,
  PERMISSIONS.STUDENTS_PROFILES_READ_ASSIGNED,
  PERMISSIONS.STUDENTS_PROFILES_MANAGE,
] as const;

export function routeParam(c: { req: { param: (name: string) => string | undefined } }, name: string): string {
  const value = c.req.param(name);
  if (!value) {
    throw new AppError(404, "not_found", "Not found");
  }
  return value;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidRouteParam(
  c: { req: { param: (name: string) => string | undefined } },
  name: string,
): string {
  const value = routeParam(c, name);
  if (!UUID_RE.test(value)) {
    throw new AppError(404, "not_found", "Not found");
  }
  return value;
}
