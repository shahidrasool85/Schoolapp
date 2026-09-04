import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "./errors.js";

/** Server-side master key for per-organisation credential encryption. Never commit a value. */
export const SECRETS_ENCRYPTION_ENV = "SCHOOLAPP_SECRETS_ENCRYPTION_KEY";

const VERSION_PREFIX = "v1:";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function parseSecretsEncryptionKey(raw: string): Buffer {
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }
  const encoded = value.startsWith("base64:") ? value.slice("base64:".length) : value;
  const fromBase64 = Buffer.from(encoded, "base64");
  if (fromBase64.length === 32) {
    return fromBase64;
  }
  throw new AppError(503, "provider_unavailable", "Payment credential encryption is not configured");
}

export function secretsEncryptionKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env[SECRETS_ENCRYPTION_ENV]?.trim();
  if (!raw) return null;
  return parseSecretsEncryptionKey(raw);
}

export function requireSecretsEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const key = secretsEncryptionKeyFromEnv(env);
  if (!key) {
    throw new AppError(503, "provider_unavailable", "Payment credential encryption is not configured");
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new AppError(503, "provider_unavailable", "Payment credential encryption is not configured");
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION_PREFIX}${Buffer.concat([iv, ciphertext, tag]).toString("base64")}`;
}

export function decryptSecret(blob: string, key: Buffer): string {
  if (key.length !== 32 || !blob.startsWith(VERSION_PREFIX)) {
    throw new AppError(503, "provider_unavailable", "Stored payment credentials could not be read");
  }
  const packed = Buffer.from(blob.slice(VERSION_PREFIX.length), "base64");
  if (packed.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new AppError(503, "provider_unavailable", "Stored payment credentials could not be read");
  }
  try {
    const iv = packed.subarray(0, IV_LENGTH);
    const tag = packed.subarray(packed.length - TAG_LENGTH);
    const ciphertext = packed.subarray(IV_LENGTH, packed.length - TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError(503, "provider_unavailable", "Stored payment credentials could not be read");
  }
}

export function detectStripeSecretMode(secretKey: string): "test" | "live" | null {
  if (secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")) return "test";
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) return "live";
  return null;
}

export function assertStripeSecretMatchesMode(secretKey: string, mode: "test" | "live"): void {
  const detected = detectStripeSecretMode(secretKey);
  if (!detected) {
    throw new AppError(400, "validation_failed", "The Stripe secret key format is not recognised");
  }
  if (detected !== mode) {
    throw new AppError(400, "test_live_mismatch", "The Stripe secret key does not match the selected mode");
  }
}

export function assertStripeWebhookSecretFormat(secret: string): void {
  if (!secret.startsWith("whsec_")) {
    throw new AppError(400, "validation_failed", "The webhook signing secret format is not recognised");
  }
}

export function stripeSecretHint(secretKey: string): string {
  const prefix = secretKey.startsWith("sk_live_")
    ? "sk_live"
    : secretKey.startsWith("sk_test_")
      ? "sk_test"
      : "sk";
  const last4 = secretKey.slice(-4);
  return `${prefix}_••••${last4}`;
}

const BLOCKED_AUDIT_KEY = /secret|password|token|webhook|encrypted|authorization|apikey|api[_-]?key|credential|cipher/i;

export function paymentProviderAuditSafe(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value) return {};
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (BLOCKED_AUDIT_KEY.test(key)) continue;
    if (typeof item === "string") {
      if (looksLikeSecret(item)) continue;
      out[key] = item;
    } else if (typeof item === "number" || typeof item === "boolean" || item == null) {
      out[key] = item;
    }
  }
  return out;
}

export function looksLikeSecret(value: string): boolean {
  return (
    value.startsWith("sk_test_") ||
    value.startsWith("sk_live_") ||
    value.startsWith("rk_test_") ||
    value.startsWith("rk_live_") ||
    value.startsWith("whsec_") ||
    value.startsWith("v1:")
  );
}

export function payloadContainsSecret(value: unknown): boolean {
  if (typeof value === "string") return looksLikeSecret(value);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => {
    if (BLOCKED_AUDIT_KEY.test(key)) return true;
    return payloadContainsSecret(item);
  });
}
