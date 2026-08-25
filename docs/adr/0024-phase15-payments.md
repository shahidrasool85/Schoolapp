# ADR 0024 — School charges, provider-neutral payments, and webhook authority

**Status:** Accepted  
**Date:** 2026-08-25  
**Phase:** 15

## Context

Schools need to request money for trips, clubs, lost items, and miscellaneous charges, and parents need to pay for authorised children. Schoolapp must not become a general ledger, collect card data, or trust browser redirects. Phase 14 already separated consent from any future fee status.

## Decision

### Charge vs transaction

A **charge** is the pupil-owned payment request (amount due, status, optional activity). A **transaction** is an immutable-history attempt to settle part of that charge (provider or offline). Receipts snapshot a successful transaction. Adjustments reduce `amount_due_minor` and never rewrite `original_amount_minor` or historical paid amounts.

Money is stored as **integer minor units** plus an ISO 4217 `currency`. Outstanding is `max(0, amount_due - (gross_paid - refunded))` in integer arithmetic.

### Provider abstraction

`PaymentProvider` is a port: create session, retrieve status, refund, verify webhook. Phase 15 ships:

- `FakePaymentProvider` for local/demo/CI
- `StripePaymentProvider` as the first production adapter (Checkout Sessions + webhook HMAC)

Application routes never import Stripe-specific types. `PAYMENT_PROVIDER=fake` is the default.

### Webhook authority

Provider webhooks are authoritative for asynchronous success. The success URL is not trusted. Settlement:

1. Verifies the provider signature
2. Resolves organisation from the stored session/payment reference via SECURITY DEFINER functions
3. Claims `provider_key + event_id` idempotently
4. Locks the charge and credits only if amount/currency match and the credit does not exceed outstanding

`X-Organisation-Id`, Host, and client-selected tenant are ignored for webhook tenant selection. Unknown references fail closed.

### Fake provider

Demo checkout posts a signed event to the same webhook handler. Replay of the same event id does not double-credit.

### PCI-minimising approach

Schoolapp never collects or stores PAN, CVC, expiry, or raw payment-method details. Hosted Checkout / Payment Element keeps card data at the provider. Secrets stay in environment variables and are never serialised to clients or audit payloads.

### Activity relationship

Consent/registration and payment remain separate. Default `charge_policy = on_confirmed`: a charge is created when a place is confirmed. Waitlisted pupils are not charged unless policy is explicitly `on_consent`. Declining/withdrawing cancels an unpaid charge; paid charges are not auto-refunded when an activity is cancelled.

### Organisation vs platform provider accounts

Phase 15 uses **one platform provider configuration** (environment variables). `school_payment_provider_configs.secret_ref` is the extension point for later per-school accounts: it stores a vault/env key name, never a live secret. Stripe Connect is not implemented.

### Admissions extension point

`source_kind = admissions` is reserved so a later application/registration fee can reuse the same charge/transaction/receipt model. Phase 15 does not implement admissions fees.

## Deployment / provider configuration

Local and CI default to the fake provider. Do not commit credentials.

```text
PAYMENT_PROVIDER=fake
FAKE_PAYMENT_WEBHOOK_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PUBLISHABLE_KEY=
STRIPE_API_BASE=https://api.stripe.com
```

Set `PAYMENT_PROVIDER=stripe` only when the Stripe secret key and webhook secret are present on the server. Success/cancel URLs are derived from the request origin, not from client-supplied tenant hosts. The webhook endpoint is `POST /api/v1/webhooks/payments/{provider}`.

## Consequences

- Finance capabilities are permission-keyed; teachers see only operational payment status on activities.
- Parents re-check guardianship + `portal_access` on every request.
- Concurrent settlement and refunds lock the charge/transaction row so two successes cannot over-credit or over-refund.
