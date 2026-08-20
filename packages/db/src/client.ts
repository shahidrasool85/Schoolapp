import pg from "pg";

const { Pool } = pg;

export type DbPools = {
  app: pg.Pool;
  owner: pg.Pool;
};

export function createPools(options: {
  appUrl: string;
  ownerUrl: string;
}): DbPools {
  return {
    app: new Pool({ connectionString: options.appUrl, max: 10 }),
    owner: new Pool({ connectionString: options.ownerUrl, max: 4 }),
  };
}

export async function withTenantContext<T>(
  pool: pg.Pool,
  userId: string,
  organisationId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_tenant_context($1, $2)", [userId, organisationId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Connection may already be broken; release will discard it.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePools(pools: DbPools): Promise<void> {
  await Promise.all([pools.app.end(), pools.owner.end()]);
}
