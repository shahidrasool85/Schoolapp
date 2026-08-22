import { AppError } from "./errors.js";
import { PUBLIC_FORM_MAX_BODY_BYTES } from "./admissions-forms.js";

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export interface RateLimitPort {
  consume(key: string, limit: number, windowMs: number): RateLimitDecision;
}

export class MemoryRateLimiter implements RateLimitPort {
  private readonly buckets = new Map<string, number[]>();

  consume(key: string, limit: number, windowMs: number): RateLimitDecision {
    const now = Date.now();
    const current = (this.buckets.get(key) ?? []).filter((ts) => now - ts < windowMs);
    if (current.length >= limit) {
      const oldest = current[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
      };
    }
    current.push(now);
    this.buckets.set(key, current);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export const defaultPublicFormRateLimiter = new MemoryRateLimiter();

export type CaptchaVerifyInput = {
  token: string | null | undefined;
  remoteIp?: string | null;
  action?: string;
};

export interface CaptchaPort {
  readonly provider: string;
  isRequired(): boolean;
  verify(input: CaptchaVerifyInput): Promise<boolean>;
}

export class DisabledCaptcha implements CaptchaPort {
  readonly provider = "none";
  isRequired(): boolean {
    return false;
  }
  async verify(): Promise<boolean> {
    return true;
  }
}

export const defaultCaptcha: CaptchaPort = new DisabledCaptcha();

export function createCaptchaFromEnv(env: NodeJS.ProcessEnv = process.env): CaptchaPort {
  const provider = (env.PUBLIC_FORM_CAPTCHA_PROVIDER ?? "none").trim().toLowerCase();
  if (provider === "none" || provider === "") return defaultCaptcha;
  // Provider adapters (Turnstile/reCAPTCHA) are configured at deploy time.
  return defaultCaptcha;
}

export function assertPublicFormPayloadSize(input: {
  contentLength?: string | null;
  bodyText?: string | null;
  maxBytes?: number;
}): void {
  const max = input.maxBytes ?? PUBLIC_FORM_MAX_BODY_BYTES;
  const declared = Number(input.contentLength ?? 0);
  if (Number.isFinite(declared) && declared > max) {
    throw new AppError(413, "payload_too_large", "Request is too large");
  }
  if (input.bodyText && Buffer.byteLength(input.bodyText, "utf8") > max) {
    throw new AppError(413, "payload_too_large", "Request is too large");
  }
}

export function assertNotRateLimited(decision: RateLimitDecision): void {
  if (!decision.allowed) {
    throw new AppError(429, "rate_limited", "Too many submissions. Please try again later.");
  }
}

export function publicFormRateLimitKey(input: {
  organisationId: string;
  formId: string;
  ipHash: string | null;
  action: "submit" | "draft" | "read";
}): string {
  return `${input.action}:${input.organisationId}:${input.formId}:${input.ipHash ?? "anon"}`;
}
