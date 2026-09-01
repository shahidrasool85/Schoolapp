import { createPools, closePools } from "@schoolapp/db";
import { createFileScannerFromEnv, createObjectStorageFromEnv } from "@schoolapp/storage";
import { createEmailDeliveryProvider, emailConfigFromEnv } from "@schoolapp/core";
import { deliverQueuedMail } from "./email-delivery";

const appUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!appUrl || !ownerUrl) {
  console.error("DATABASE_URL and DATABASE_OWNER_URL are required");
  process.exit(1);
}

const limitRaw = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8) ?? 20);
const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 20;
const email = emailConfigFromEnv();
const pools = createPools({ appUrl, ownerUrl });

try {
  const result = await deliverQueuedMail(
    {
      pools,
      authSecret: process.env.AUTH_SECRET ?? "unused",
      tokenTtlSeconds: 60,
      platformDomain: (process.env.PLATFORM_DOMAIN ?? "localhost").trim().toLowerCase(),
      trustProxy: process.env.TRUST_PROXY === "true",
      storage: createObjectStorageFromEnv(),
      fileScanner: createFileScannerFromEnv(),
      email,
      emailDeliveryProvider: createEmailDeliveryProvider(email),
    },
    { limit },
  );
  console.log(JSON.stringify(result));
} finally {
  await closePools(pools);
}
