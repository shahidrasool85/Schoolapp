import argon2 from "argon2";
import pg from "pg";

const email = process.env.PLATFORM_ADMIN_EMAIL;
const password = process.env.PLATFORM_ADMIN_PASSWORD;
const name = process.env.PLATFORM_ADMIN_NAME ?? "Platform Admin";
const ownerUrl = process.env.DATABASE_OWNER_URL;

if (!email || !password || !ownerUrl) {
  console.error("PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD, and DATABASE_OWNER_URL are required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const existing = await client.query("select id from users where email = $1", [email]);
  let userId: string;
  if (existing.rowCount) {
    userId = existing.rows[0].id as string;
    await client.query(
      `insert into user_credentials (user_id, password_hash)
       values ($1, $2)
       on conflict (user_id) do update set password_hash = excluded.password_hash, updated_at = now()`,
      [userId, hash],
    );
    await client.query(
      "update users set full_name = $2, user_kind = 'platform_admin', status = 'active' where id = $1",
      [userId, name],
    );
  } else {
    const inserted = await client.query(
      `insert into users (email, full_name, user_kind, status)
       values ($1, $2, 'platform_admin', 'active')
       returning id`,
      [email, name],
    );
    userId = inserted.rows[0].id as string;
    await client.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [
      userId,
      hash,
    ]);
  }
  await client.query(
    "insert into platform_admins (user_id) values ($1) on conflict do nothing",
    [userId],
  );
  console.log(`Platform admin ready: ${email}`);
} finally {
  await client.end();
}
