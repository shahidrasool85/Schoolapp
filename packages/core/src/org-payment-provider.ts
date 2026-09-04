import type pg from "pg";
import { writeAudit } from "./academic.js";
import {
  SECRETS_ENCRYPTION_ENV,
  assertStripeSecretMatchesMode,
  assertStripeWebhookSecretFormat,
  decryptSecret,
  encryptSecret,
  paymentProviderAuditSafe,
  requireSecretsEncryptionKey,
  stripeSecretHint,
} from "./encrypted-secrets.js";
import { AppError } from "./errors.js";
import { financeUserError } from "./payments.js";
import {
  FakePaymentProvider,
  StripePaymentProvider,
  type PaymentProvider,
  type PaymentRuntimeConfig,
} from "./payment-provider.js";

function throwFinance(code: string): never {
  const error = financeUserError(code);
  throw new AppError(error.status, error.code, error.message);
}

export { SECRETS_ENCRYPTION_ENV };

export type PaymentProviderConnectionStatus =
  | "not_configured"
  | "test_mode_configured"
  | "connected"
  | "attention_required";

export type OrganisationPaymentProviderPublic = {
  provider: "stripe";
  configured: boolean;
  enabled: boolean;
  mode: "test" | "live" | null;
  connectionStatus: PaymentProviderConnectionStatus;
  secretKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  secretKeyHint: string | null;
  providerAccountId: string | null;
  displayName: string | null;
  webhookEndpointId: string | null;
  webhookPath: string | null;
  webhookUrl: string | null;
  lastConnectionTestedAt: string | null;
  lastWebhookAt: string | null;
  lastWebhookEventType: string | null;
  lastWebhookErrorCode: string | null;
  lastConnectionErrorCode: string | null;
};

export type StripeWebhookEndpoint = {
  configId: string;
  organisationId: string;
  mode: "test" | "live";
  enabled: boolean;
  provider: StripePaymentProvider;
};

type ConfigRow = {
  id: string;
  organisation_id: string;
  provider_key: string;
  secret_ref: string;
  is_active: boolean;
  mode: "test" | "live";
  webhook_endpoint_id: string;
  encrypted_secret_key: string | null;
  encrypted_webhook_secret: string | null;
  secret_key_hint: string | null;
  webhook_secret_configured: boolean;
  provider_account_id: string | null;
  display_name: string | null;
  connection_status: PaymentProviderConnectionStatus;
  last_connection_tested_at: Date | string | null;
  last_connection_error_code: string | null;
  last_webhook_at: Date | string | null;
  last_webhook_event_type: string | null;
  last_webhook_error_code: string | null;
};

export function stripeWebhookPath(endpointId: string): string {
  return `/api/v1/webhooks/payments/stripe/${endpointId}`;
}

export function stripeWebhookUrl(origin: string | null | undefined, endpointId: string): string {
  const path = stripeWebhookPath(endpointId);
  if (!origin) return path;
  return `${origin.replace(/\/$/, "")}${path}`;
}

export function emptyOrganisationPaymentProvider(): OrganisationPaymentProviderPublic {
  return {
    provider: "stripe",
    configured: false,
    enabled: false,
    mode: null,
    connectionStatus: "not_configured",
    secretKeyConfigured: false,
    webhookSecretConfigured: false,
    secretKeyHint: null,
    providerAccountId: null,
    displayName: null,
    webhookEndpointId: null,
    webhookPath: null,
    webhookUrl: null,
    lastConnectionTestedAt: null,
    lastWebhookAt: null,
    lastWebhookEventType: null,
    lastWebhookErrorCode: null,
    lastConnectionErrorCode: null,
  };
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function mapOrganisationPaymentProvider(
  row: ConfigRow,
  origin?: string | null,
): OrganisationPaymentProviderPublic {
  const secretKeyConfigured = Boolean(row.encrypted_secret_key);
  const webhookSecretConfigured = Boolean(row.webhook_secret_configured && row.encrypted_webhook_secret);
  return {
    provider: "stripe",
    configured: secretKeyConfigured,
    enabled: Boolean(row.is_active),
    mode: row.mode,
    connectionStatus: row.connection_status,
    secretKeyConfigured,
    webhookSecretConfigured,
    secretKeyHint: row.secret_key_hint,
    providerAccountId: row.provider_account_id,
    displayName: row.display_name,
    webhookEndpointId: row.webhook_endpoint_id,
    webhookPath: stripeWebhookPath(row.webhook_endpoint_id),
    webhookUrl: stripeWebhookUrl(origin, row.webhook_endpoint_id),
    lastConnectionTestedAt: iso(row.last_connection_tested_at),
    lastWebhookAt: iso(row.last_webhook_at),
    lastWebhookEventType: row.last_webhook_event_type,
    lastWebhookErrorCode: row.last_webhook_error_code,
    lastConnectionErrorCode: row.last_connection_error_code,
  };
}

export function derivePaymentProviderConnectionStatus(input: {
  secretKeyConfigured: boolean;
  mode: "test" | "live";
  lastTestResult?: "connected" | "authentication_failed" | "configuration_incomplete" | "attention_required" | null;
  lastWebhookError?: boolean;
}): PaymentProviderConnectionStatus {
  if (!input.secretKeyConfigured) return "not_configured";
  if (input.lastTestResult === "authentication_failed" || input.lastTestResult === "attention_required") {
    return "attention_required";
  }
  if (input.lastWebhookError) return "attention_required";
  if (input.lastTestResult === "connected" && input.mode === "live") return "connected";
  if (input.mode === "test") return "test_mode_configured";
  return input.lastTestResult === "connected" ? "connected" : "test_mode_configured";
}

export function paymentProviderAuditPayload(publicConfig: OrganisationPaymentProviderPublic): Record<string, unknown> {
  return paymentProviderAuditSafe({
    provider: publicConfig.provider,
    mode: publicConfig.mode,
    enabled: publicConfig.enabled,
    connectionStatus: publicConfig.connectionStatus,
    secretKeyConfigured: publicConfig.secretKeyConfigured,
    webhookSecretConfigured: publicConfig.webhookSecretConfigured,
  });
}

export async function loadOrganisationPaymentProviderConfig(
  client: pg.PoolClient,
  organisationId: string,
): Promise<ConfigRow | null> {
  const result = await client.query<ConfigRow>(
    `select id, organisation_id, provider_key, secret_ref, is_active, mode, webhook_endpoint_id,
            encrypted_secret_key, encrypted_webhook_secret, secret_key_hint, webhook_secret_configured,
            provider_account_id, display_name, connection_status, last_connection_tested_at,
            last_connection_error_code, last_webhook_at, last_webhook_event_type, last_webhook_error_code
       from school_payment_provider_configs
      where organisation_id = $1 and provider_key = 'stripe'`,
    [organisationId],
  );
  return result.rows[0] ?? null;
}

export async function loadOrganisationPaymentProviderPublic(
  client: pg.PoolClient,
  organisationId: string,
  origin?: string | null,
): Promise<OrganisationPaymentProviderPublic> {
  const row = await loadOrganisationPaymentProviderConfig(client, organisationId);
  if (!row) return emptyOrganisationPaymentProvider();
  return mapOrganisationPaymentProvider(row, origin);
}

export async function upsertOrganisationStripeConfig(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    mode?: "test" | "live";
    secretKey?: string | null;
    webhookSecret?: string | null;
    enabled?: boolean;
    providerAccountId?: string | null;
    origin?: string | null;
  },
): Promise<OrganisationPaymentProviderPublic> {
  const existing = await loadOrganisationPaymentProviderConfig(client, input.organisationId);
  const mode = input.mode ?? existing?.mode ?? "test";
  if (mode !== "test" && mode !== "live") {
    throw new AppError(400, "validation_failed", "Invalid payment provider mode");
  }

  let encryptedSecret = existing?.encrypted_secret_key ?? null;
  let secretHint = existing?.secret_key_hint ?? null;
  if (input.secretKey) {
    assertStripeSecretMatchesMode(input.secretKey, mode);
    const key = requireSecretsEncryptionKey();
    encryptedSecret = encryptSecret(input.secretKey, key);
    secretHint = stripeSecretHint(input.secretKey);
  } else if (existing?.encrypted_secret_key && existing.mode !== mode) {
    throw new AppError(400, "test_live_mismatch", "Save a Stripe secret key that matches the selected mode");
  }

  let encryptedWebhook = existing?.encrypted_webhook_secret ?? null;
  let webhookConfigured = Boolean(existing?.webhook_secret_configured && existing.encrypted_webhook_secret);
  if (input.webhookSecret) {
    assertStripeWebhookSecretFormat(input.webhookSecret);
    const key = requireSecretsEncryptionKey();
    encryptedWebhook = encryptSecret(input.webhookSecret, key);
    webhookConfigured = true;
  }

  const secretConfigured = Boolean(encryptedSecret);
  if (input.enabled && (!secretConfigured || !webhookConfigured)) {
    throw new AppError(409, "payment_provider_not_configured", "Save the Stripe secret key and webhook signing secret before enabling");
  }

  const connectionStatus = derivePaymentProviderConnectionStatus({
    secretKeyConfigured: secretConfigured,
    mode,
    lastTestResult: existing?.last_connection_error_code
      ? existing.last_connection_error_code === "authentication_failed"
        ? "authentication_failed"
        : existing.connection_status === "connected"
          ? "connected"
          : null
      : existing?.connection_status === "connected"
        ? "connected"
        : existing?.connection_status === "attention_required"
          ? "attention_required"
          : null,
    lastWebhookError: Boolean(existing?.last_webhook_error_code),
  });

  const enabled = input.enabled ?? existing?.is_active ?? false;
  const providerAccountId = input.providerAccountId === undefined ? existing?.provider_account_id ?? null : input.providerAccountId;

  const saved = await client.query<ConfigRow>(
    `insert into school_payment_provider_configs (
       organisation_id, provider_key, secret_ref, is_active, mode,
       encrypted_secret_key, encrypted_webhook_secret, secret_key_hint,
       webhook_secret_configured, provider_account_id, display_name, connection_status
     ) values (
       $1, 'stripe', 'encrypted:v1', $2, $3, $4, $5, $6, $7, $8, $9, $10
     )
     on conflict (organisation_id, provider_key) do update set
       secret_ref = 'encrypted:v1',
       is_active = excluded.is_active,
       mode = excluded.mode,
       encrypted_secret_key = excluded.encrypted_secret_key,
       encrypted_webhook_secret = excluded.encrypted_webhook_secret,
       secret_key_hint = excluded.secret_key_hint,
       webhook_secret_configured = excluded.webhook_secret_configured,
       provider_account_id = excluded.provider_account_id,
       connection_status = excluded.connection_status,
       updated_at = now()
     returning id, organisation_id, provider_key, secret_ref, is_active, mode, webhook_endpoint_id,
               encrypted_secret_key, encrypted_webhook_secret, secret_key_hint, webhook_secret_configured,
               provider_account_id, display_name, connection_status, last_connection_tested_at,
               last_connection_error_code, last_webhook_at, last_webhook_event_type, last_webhook_error_code`,
    [
      input.organisationId,
      enabled && secretConfigured && webhookConfigured,
      mode,
      encryptedSecret,
      encryptedWebhook,
      secretHint,
      webhookConfigured,
      providerAccountId,
      existing?.display_name ?? null,
      connectionStatus,
    ],
  );
  const publicConfig = mapOrganisationPaymentProvider(saved.rows[0]!, input.origin);
  const action = !existing || !existing.encrypted_secret_key ? "payment_provider.configured" : "payment_provider.updated";
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action,
    entityType: "school_payment_provider_config",
    entityId: saved.rows[0]!.id,
    before: existing ? paymentProviderAuditPayload(mapOrganisationPaymentProvider(existing, input.origin)) : null,
    after: paymentProviderAuditPayload(publicConfig),
  });
  return publicConfig;
}

export async function setOrganisationStripeEnabled(
  client: pg.PoolClient,
  input: { organisationId: string; actorUserId: string; enabled: boolean; origin?: string | null },
): Promise<OrganisationPaymentProviderPublic> {
  const existing = await loadOrganisationPaymentProviderConfig(client, input.organisationId);
  if (!existing || !existing.encrypted_secret_key || !existing.encrypted_webhook_secret) {
    throw new AppError(409, "payment_provider_not_configured", "Save the Stripe secret key and webhook signing secret before enabling");
  }
  const updated = await client.query<ConfigRow>(
    `update school_payment_provider_configs
        set is_active = $2, updated_at = now()
      where organisation_id = $1 and provider_key = 'stripe'
      returning id, organisation_id, provider_key, secret_ref, is_active, mode, webhook_endpoint_id,
                encrypted_secret_key, encrypted_webhook_secret, secret_key_hint, webhook_secret_configured,
                provider_account_id, display_name, connection_status, last_connection_tested_at,
                last_connection_error_code, last_webhook_at, last_webhook_event_type, last_webhook_error_code`,
    [input.organisationId, input.enabled],
  );
  const publicConfig = mapOrganisationPaymentProvider(updated.rows[0]!, input.origin);
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: input.enabled ? "payment_provider.enabled" : "payment_provider.disabled",
    entityType: "school_payment_provider_config",
    entityId: updated.rows[0]!.id,
    before: paymentProviderAuditPayload(mapOrganisationPaymentProvider(existing, input.origin)),
    after: paymentProviderAuditPayload(publicConfig),
  });
  return publicConfig;
}

export async function testOrganisationStripeConnection(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actorUserId: string;
    runtime: PaymentRuntimeConfig;
    origin?: string | null;
  },
): Promise<{
  result: "connected" | "authentication_failed" | "configuration_incomplete";
  paymentProvider: OrganisationPaymentProviderPublic;
}> {
  const existing = await loadOrganisationPaymentProviderConfig(client, input.organisationId);
  if (!existing?.encrypted_secret_key) {
    return {
      result: "configuration_incomplete",
      paymentProvider: existing
        ? mapOrganisationPaymentProvider(existing, input.origin)
        : emptyOrganisationPaymentProvider(),
    };
  }
  let secretKey: string;
  try {
    secretKey = decryptSecret(existing.encrypted_secret_key, requireSecretsEncryptionKey());
  } catch {
    return {
      result: "configuration_incomplete",
      paymentProvider: mapOrganisationPaymentProvider(existing, input.origin),
    };
  }
  const tested = await testStripeSecretKey({
    secretKey,
    apiBase: input.runtime.stripeApiBase,
    fetchImpl: input.runtime.fetchImpl,
  });
  const connectionStatus = derivePaymentProviderConnectionStatus({
    secretKeyConfigured: true,
    mode: existing.mode,
    lastTestResult: tested.result,
  });
  const updated = await client.query<ConfigRow>(
    `update school_payment_provider_configs
        set connection_status = $2,
            last_connection_tested_at = now(),
            last_connection_error_code = $3,
            provider_account_id = coalesce($4, provider_account_id),
            display_name = coalesce($5, display_name),
            updated_at = now()
      where organisation_id = $1 and provider_key = 'stripe'
      returning id, organisation_id, provider_key, secret_ref, is_active, mode, webhook_endpoint_id,
                encrypted_secret_key, encrypted_webhook_secret, secret_key_hint, webhook_secret_configured,
                provider_account_id, display_name, connection_status, last_connection_tested_at,
                last_connection_error_code, last_webhook_at, last_webhook_event_type, last_webhook_error_code`,
    [
      input.organisationId,
      connectionStatus,
      tested.result === "connected" ? null : tested.result,
      tested.accountId,
      tested.displayName,
    ],
  );
  const publicConfig = mapOrganisationPaymentProvider(updated.rows[0]!, input.origin);
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "payment_provider.connection_tested",
    entityType: "school_payment_provider_config",
    entityId: updated.rows[0]!.id,
    after: paymentProviderAuditSafe({
      provider: "stripe",
      result: tested.result,
      mode: existing.mode,
      connectionStatus,
    }),
  });
  return {
    result: tested.result === "attention_required" ? "authentication_failed" : tested.result,
    paymentProvider: publicConfig,
  };
}

export async function testStripeSecretKey(input: {
  secretKey: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  result: "connected" | "authentication_failed" | "configuration_incomplete" | "attention_required";
  accountId: string | null;
  displayName: string | null;
}> {
  if (!input.secretKey) {
    return { result: "configuration_incomplete", accountId: null, displayName: null };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiBase = input.apiBase ?? "https://api.stripe.com";
  try {
    const response = await fetchImpl(`${apiBase}/v1/account`, {
      method: "GET",
      headers: { Authorization: `Bearer ${input.secretKey}` },
    });
    if (response.status === 401 || response.status === 403) {
      return { result: "authentication_failed", accountId: null, displayName: null };
    }
    if (!response.ok) {
      return { result: "attention_required", accountId: null, displayName: null };
    }
    const json = (await response.json()) as {
      id?: string;
      business_profile?: { name?: string };
      settings?: { dashboard?: { display_name?: string } };
    };
    const displayName = json.business_profile?.name || json.settings?.dashboard?.display_name || null;
    return {
      result: "connected",
      accountId: json.id ? String(json.id) : null,
      displayName,
    };
  } catch {
    return { result: "attention_required", accountId: null, displayName: null };
  }
}

function stripeProviderFromSecrets(
  secretKey: string,
  webhookSecret: string | null,
  runtime: PaymentRuntimeConfig,
): StripePaymentProvider {
  return new StripePaymentProvider({
    providerKey: "stripe",
    fakeWebhookSecret: runtime.fakeWebhookSecret,
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret,
    stripeApiBase: runtime.stripeApiBase,
    fetchImpl: runtime.fetchImpl,
  });
}

export async function resolveOrganisationPaymentProvider(
  client: pg.PoolClient,
  organisationId: string,
  runtime: PaymentRuntimeConfig,
): Promise<PaymentProvider> {
  const row = await loadOrganisationPaymentProviderConfig(client, organisationId);
  if (row) {
    if (!row.is_active) throwFinance("payment_provider_disabled");
    if (!row.encrypted_secret_key || !row.encrypted_webhook_secret) {
      throwFinance("payment_provider_not_configured");
    }
    const master = requireSecretsEncryptionKey();
    return stripeProviderFromSecrets(
      decryptSecret(row.encrypted_secret_key, master),
      decryptSecret(row.encrypted_webhook_secret, master),
      runtime,
    );
  }
  if (runtime.providerKey === "fake") {
    return new FakePaymentProvider(runtime.fakeWebhookSecret);
  }
  throwFinance("payment_provider_not_configured");
}

export async function resolveOrganisationPaymentProviderForRefund(
  client: pg.PoolClient,
  organisationId: string,
  runtime: PaymentRuntimeConfig,
  transactionProviderKey: string,
): Promise<PaymentProvider> {
  if (transactionProviderKey === "fake") {
    return new FakePaymentProvider(runtime.fakeWebhookSecret);
  }
  if (transactionProviderKey !== "stripe") {
    throwFinance("refund_failed");
  }
  const row = await loadOrganisationPaymentProviderConfig(client, organisationId);
  if (!row?.encrypted_secret_key) {
    throwFinance("payment_provider_not_configured");
  }
  const master = requireSecretsEncryptionKey();
  return stripeProviderFromSecrets(
    decryptSecret(row.encrypted_secret_key, master),
    row.encrypted_webhook_secret ? decryptSecret(row.encrypted_webhook_secret, master) : null,
    runtime,
  );
}

export async function loadStripeWebhookEndpoint(
  pool: pg.Pool,
  endpointId: string,
  runtime: PaymentRuntimeConfig,
): Promise<StripeWebhookEndpoint | null> {
  if (!/^[a-f0-9]{32,64}$/i.test(endpointId)) return null;
  const result = await pool.query<{
    config_id: string;
    organisation_id: string;
    provider_key: string;
    mode: "test" | "live";
    is_active: boolean;
    encrypted_webhook_secret: string | null;
    webhook_secret_configured: boolean;
  }>("select * from load_payment_provider_webhook_endpoint($1)", [endpointId]);
  const row = result.rows[0];
  if (!row || !row.webhook_secret_configured || !row.encrypted_webhook_secret) {
    return null;
  }
  const webhookSecret = decryptSecret(row.encrypted_webhook_secret, requireSecretsEncryptionKey());
  return {
    configId: row.config_id,
    organisationId: row.organisation_id,
    mode: row.mode,
    enabled: row.is_active,
    provider: stripeProviderFromSecrets("unused", webhookSecret, runtime),
  };
}

export async function recordOrganisationWebhookResult(
  pool: pg.Pool,
  input: { configId: string; eventType: string; ok: boolean; errorCode?: string | null },
): Promise<void> {
  await pool.query("select record_payment_provider_webhook_result($1, $2, $3, $4)", [
    input.configId,
    input.eventType,
    input.ok,
    input.errorCode ?? null,
  ]);
}
