import { createPools, closePools } from "@schoolapp/db";
import { createObjectStorageFromEnv } from "@schoolapp/storage";
import { cleanupStoredObjects } from "./stored-object-cleanup";

const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!ownerUrl) {
  console.error("DATABASE_OWNER_URL is required");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const pools = createPools({
  appUrl: process.env.DATABASE_URL ?? ownerUrl,
  ownerUrl,
});

try {
  const result = await cleanupStoredObjects({
    owner: pools.owner,
    storage: createObjectStorageFromEnv(),
    dryRun,
  });
  console.log(
    JSON.stringify({
      dryRun,
      examined: result.examined,
      purged: result.purged,
      skipped: result.skipped,
    }),
  );
} finally {
  await closePools(pools);
}
