# ADR 0033 — Per-school Stripe accounts and encrypted credentials

**Status:** Accepted  
**Date:** 2026-09-03

## Context

LuvLearn is a multi-school SaaS. Phase 15 (ADR 0024) used one platform Stripe account from `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`. That would route every school’s payments through a single account. Each organisation must connect and use **its own** Stripe account. Stripe Connect remains out of scope.

No existing credential vault existed. `school_payment_provider_configs.secret_ref` was only a reserved hook.

## Decision

1. **One Stripe configuration per organisation** on `school_payment_provider_configs` (`unique (organisation_id, provider_key)`).
2. **Encrypt secrets at rest** with AES-256-GCM. The master key is `SCHOOLAPP_SECRETS_ENCRYPTION_KEY`. Encrypted blobs are never returned by GET, written to audit, or logged. See **Backup and recovery** below.
3. **Unique webhook path** `POST /api/v1/webhooks/payments/stripe/{webhook_endpoint_id}`. The opaque id only selects which stored webhook secret is used for signature verification. It does not grant refunds or payouts.
4. **Fail closed.** If a school has a Stripe row that is missing, incomplete, or disabled, checkout/refund/settlement does not fall back to a platform Stripe account or to another school. The fake provider is used only when `PAYMENT_PROVIDER=fake` (default) **and** the school has no Stripe row (local/CI).
5. **Authoritative tenant is the invoice/charge/session row**, not metadata, Host, or `X-Organisation-Id`. After signature verification the stored session organisation must match the webhook config organisation.
6. **School Admin** (`finance.settings.manage`) configures credentials on Finance settings. Teachers, parents, and students cannot. GET never includes raw or encrypted secrets.
7. **Manual credential entry** is enough. Stripe Connect/OAuth is deferred.

## Precedence

1. Organisation Stripe row exists → use that school’s decrypted credentials, or fail closed if disabled/incomplete.
2. No organisation row and `PAYMENT_PROVIDER=fake` → FakePaymentProvider.
3. Otherwise fail closed (`payment_provider_not_configured`).

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are not used for school payments. `STRIPE_API_BASE` remains an optional infrastructure default.

## Backup and recovery

`SCHOOLAPP_SECRETS_ENCRYPTION_KEY` is a server-only master key. Production operators must back it up securely in the host secret store, **separately from PostgreSQL / database backups**.

A database restore without the **same** encryption key cannot decrypt organisation Stripe credentials. The ciphertext in `school_payment_provider_configs` is useless without that key.

Never:

- store the master encryption key in PostgreSQL
- commit it to Git
- expose it to the browser, API responses, audit events, or application logs

After any school has stored payment credentials, operators must **preserve the same key**. Changing or losing the key makes existing encrypted school payment credentials unreadable. Checkout, refunds, webhooks, and connection tests for those schools fail closed.

Key rotation is **not** currently implemented. Do not rotate or replace `SCHOOLAPP_SECRETS_ENCRYPTION_KEY` on a server that already has encrypted school Stripe blobs.

## Consequences

- Migration `0052_org_payment_providers.sql` is additive and does not enable Stripe or rewrite historical transactions. It is safe to apply before the encryption key exists, provided no school Stripe credentials have been saved yet.
- A new school starts as Stripe: Not configured and can add its own account later without affecting others.
- Webhook event uniqueness is `(organisation_id, provider_key, event_id)`.
- Database backup alone is not sufficient to restore per-school Stripe credentials.
