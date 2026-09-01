# ADR 0031 — Central transactional email delivery

**Status:** Accepted  
**Date:** 2026-09-01

## Context

Phase 20 introduced a `MailProvider` port and an inspectable `mail_outbox` that recorded text bodies locally. Invitations and password resets generated one-time links but did not deliver email. Product now needs real transactional delivery without coupling admissions, auth, or people modules to a vendor SDK, and without storing live invite/reset tokens in audit tables.

## Decision

1. **One delivery architecture.** Business code keeps calling `MailProvider`. An `EmailDeliveryProvider` adapter (`log` / `fake` / `smtp`) performs the actual send. SMTP is the first production adapter because the repo is self-hostable and SES/Postmark/Resend all offer SMTP.
2. **Outbox then send.** `enqueue_transactional_email` commits with the business transaction. Delivery is best-effort afterwards. Application submit/invite/reset **succeeds** if enqueue or SMTP fails; the row remains `queued`/`failed` for retry.
3. **Live sending is explicit.** `EMAIL_DELIVERY_MODE=live` + `EMAIL_PROVIDER=smtp` + host + From address. Tests use `FakeEmailProvider`. Default is log-only.
4. **Platform From, school Reply-To.** `"School via LuvLearn" <EMAIL_FROM_ADDRESS>`. Schools cannot set arbitrary From addresses until domain verification exists.
5. **Hash-only tokens remain.** Raw tokens appear only in the one-time URL at send time. `mail_outbox.action_url` is column-revoked from `schoolapp_app` and is returned only by owner-definer claim functions to the delivery worker. It is wiped after send, permanent failure, cancel/supersede, or expiry.
6. **Idempotency keys** prevent duplicate invitation, reset, and admissions-acknowledgement sends.
7. **Atomic claim.** `queued` → `sending` uses `FOR UPDATE SKIP LOCKED`. In-request delivery and cron cannot double-send the same row.

## Consequences

- Migration `0048_email_delivery.sql` is additive on `mail_outbox`. It is the complete unreleased email-delivery migration. There are no 0049+ repair files. It does not rewrite 0047 or earlier.
- Immediate in-request send is not a durable queue. Production must run `pnpm email:deliver` (or the worker secret endpoint) on a schedule.
- ADR 0030's "plaintext tokens appear in the local mail outbox" is superseded for stored rows after send; tokens remain in the live SMTP payload only.
- Production deploys that do not currently run `pnpm install` must run `pnpm install --frozen-lockfile` once because `nodemailer` is a new runtime dependency.

## Rejected alternatives

- Direct Nodemailer/Resend/SES calls from admissions and auth routes.
- A second mail table alongside `mail_outbox`.
- Tenant-controlled From addresses before provider domain verification.
- Failing application submit because acknowledgement email failed.
