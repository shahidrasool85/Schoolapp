import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

function ownerUrl(): string {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) {
    throw new Error("DATABASE_OWNER_URL is required to run migrations");
  }
  return url;
}

export async function migrate(databaseUrl = ownerUrl()): Promise<void> {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    for (const file of files) {
      const applied = await client.query("select 1 from schema_migrations where filename = $1", [
        file,
      ]);
      if ((applied.rowCount ?? 0) > 0) {
        continue;
      }
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
        console.log(`applied ${file}`);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  migrate().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
