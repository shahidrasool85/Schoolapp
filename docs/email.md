# Transactional email

LuvLearn sends **transactional** email only: account invitations, password resets, and admissions acknowledgements. There is no marketing/newsletter sender, and security-critical messages do not include unsubscribe links.

## Architecture

Business modules call `MailProvider.send(...)` (`packages/core/src/mail.ts`). That port:

1. Enqueues a row in `mail_outbox` via `enqueue_transactional_email`.
2. Best-effort delivers that one row in-process.
3. Never fails the parent business action if delivery fails (except `mail_password_forbidden`).

Providers implement `EmailDeliveryProvider.send(...)`. The first production adapter is **SMTP** (`nodemailer`), which also covers Amazon SES SMTP, Postmark SMTP, and Resend SMTP. Domain logic is not coupled to a vendor SDK.

## Environment

| Variable | Purpose |
| --- | --- |
| `EMAIL_PROVIDER` | `none` (default), `log`, or `smtp` |
| `EMAIL_DELIVERY_MODE` | `log` (default), `test`, or `live` |
| `EMAIL_FROM_ADDRESS` | Verified platform From address |
| `EMAIL_FROM_NAME` | Display name, default `LuvLearn` |
| `EMAIL_REPLY_TO` | Optional platform fallback Reply-To |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | SMTP server |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | SMTP credentials |
| `SMTP_URL` | Optional `smtp://` or `smtps://` URL (overrides host/port/user/pass) |
| `EMAIL_WORKER_SECRET` | Optional bearer secret for `POST /api/v1/internal/mail/deliver` |

Live sending requires **all** of:

- `EMAIL_DELIVERY_MODE=live`
- `EMAIL_PROVIDER=smtp`
- `SMTP_HOST` (or `SMTP_URL`)
- `EMAIL_FROM_ADDRESS`

Otherwise messages stay in `mail_outbox` as `queued` and are written to logs (`log` mode) or a fake provider (`test` mode). Automated tests inject `FakeEmailProvider` and must never use live SMTP. When `EMAIL_FROM_ADDRESS` is unset, **log/none** mode uses the sanitizable fallback `notifications@luvlearn.test` so first deploy does not permanently fail and wipe invite/reset `action_url`. **Live** SMTP does not use that fallback: a missing or invalid From stays unconfigured, delivery is retryable, and `action_url` is kept.

Never commit secrets. Never log `SMTP_PASSWORD`, `SMTP_USERNAME`, or raw invite/reset tokens.

## From / Reply-To

Schools cannot spoof arbitrary From addresses in this phase.

- **From:** `{School name} via LuvLearn <EMAIL_FROM_ADDRESS>`
- **Reply-To:** the school's `organisation_settings.contact_email` when present, else `EMAIL_REPLY_TO`

Tenant-specific From addresses wait until that domain is verified with the SMTP provider.

## Outbox, retries, idempotency

`mail_outbox` (extended by `0048_email_delivery.sql`) stores:

- `queued` / `sending` / `sent` / `failed` / `cancelled`
- attempt count, next retry time, redacted last error
- idempotency key (invitation id, reset fingerprint, `admissions.application_received:{applicationId}`)
- short-lived `action_url` for one-time links

`action_url` is **not** selectable by `schoolapp_app` on the table. The delivery worker receives it only as the return value of `claim_mail_outbox_message` / `claim_mail_outbox_messages`, which are `SECURITY DEFINER` functions owned by `schoolapp_owner` with a fixed `search_path`. Ordinary application queries, `GET /onboarding/mail`, and tenant roles cannot read it. After a successful send or a permanent failure it is wiped. Superseded invitation/reset rows are `cancelled` and wiped. Invite rows older than 14 days and reset rows older than 2 days expire and are wiped. Stored `body_text` has `token=` values redacted.

A tenant SQL session cannot claim another organisation's row. The worker uses the app pool without tenant GUC and can claim any queued row. `expire_stale_mail_outbox` is not executable by `schoolapp_app`.

Queued → sending is an atomic `UPDATE ... FOR UPDATE SKIP LOCKED`. Two workers cannot claim the same row. A live `sending` row is not reclaimed; only `sending` rows idle for 5 minutes are returned to `queued`.

Retryable provider failures (timeouts, 4xx rate limits, 5xx) re-queue with bounded backoff (1m / 5m / 25m / 2h / 8h, max 5 attempts) and **keep** `action_url` for the retry. Permanent failures (unknown mailbox, invalid recipient) mark `failed`, wipe `action_url`, and do not retry automatically.

Pre-0048 Phase 20 outbox rows are backfilled to `cancelled` with `provider_key = legacy-phase20` and `legacy_unsent`. They were never SMTP-delivered. Invitation/reset **tokens** remain in `invitations` / `account_tokens` and can still be accepted or reissued. Reissue queues a new deliverable row.

Duplicate application submits reuse the same admissions idempotency key, so one acknowledgement is queued. Drafts, continue-between-steps, and failed submits do not queue acknowledgements.

## Delivery worker

Next.js request handlers are not a reliable queue. This phase:

1. Attempts delivery immediately after enqueue.
2. Leaves retryable rows in `mail_outbox`.
3. Expects production to drain the queue with a cron:

```bash
pnpm email:deliver
# or
pnpm --filter @schoolapp/api deliver-mail -- --limit=20
```

If `EMAIL_WORKER_SECRET` is set, a trusted scheduler may call:

`POST /api/v1/internal/mail/deliver`  
`Authorization: Bearer $EMAIL_WORKER_SECRET`

That endpoint is disabled (404) when the secret is unset. It requires `Authorization: Bearer $EMAIL_WORKER_SECRET` (constant-time compare). It is not an open relay: it ignores request bodies, only drains already-queued outbox rows, caps `limit` at 50, and returns `{ processed, sent, failed }` only — never `action_url` or message content.

School admins inspect status at **School settings → Email delivery** and retry eligible rows for their organisation only: any `queued` row, plus `failed` admissions acknowledgements. Permanent invite/reset failures wipe `action_url` and do not show Retry. That page shows delivery status, recipient, subject, purpose, fixture template previews, and redacted last-error codes. It does **not** show SMTP credentials, worker secrets, action URLs, or live tokens. SMTP is platform/server env, not tenant configuration. Ordinary teachers cannot open the page or the API.

## Connected product events

| Event | Template |
| --- | --- |
| First School Admin invitation / reissue | `account_invitation` |
| Staff invitation / reissue | `account_invitation` |
| Parent invitation / reissue | `account_invitation` |
| Forgot password | `password_reset` |
| Admissions application submitted | `admissions_application_received` |

Student activation mail is composed in core but **not** wired yet (separate `account_tokens` flow). Finance, attendance, homework, notices, and messaging are out of scope.

Admissions **staff** notification is not sent. There is no canonical admissions inbox yet — `contact_email` is used as Reply-To only. Do not invent a recipient.

## Templates

Reusable HTML + plain-text templates live in `packages/core/src/email-templates.ts`. Tenant strings are escaped; arbitrary HTML from school settings is never interpolated. Preview uses fixture data (`GET /api/v1/onboarding/mail/preview`) and never live tokens.

Admissions acknowledgement includes child preferred/legal name, public application reference, and intended entry only. It never includes medical details, safeguarding notes, date of birth, full address, or organisation UUIDs.

## Domain authentication (DNS)

Do **not** change DNS from this application. After choosing a verified sending domain, configure records with your DNS host and SMTP provider:

1. **Sending domain** — add and verify the domain in SES / Postmark / Resend / your SMTP vendor.
2. **SPF** — include the provider on the envelope domain, for example:
   - Amazon SES: `v=spf1 include:amazonses.com ~all`
   - Postmark: `v=spf1 include:spf.mtasv.net ~all`
   - Resend: `v=spf1 include:_spf.resend.com ~all`
3. **DKIM** — publish the CNAME or TXT records the provider shows after domain verification. Do not put private DKIM keys in application env.
4. **DMARC** — start with monitoring, for example:
   `v=DMARC1; p=none; rua=mailto:dmarc@your-domain;`
   Tighten to `p=quarantine` then `p=reject` once SPF/DKIM align.
5. **Return-path / MAIL FROM** — if the provider uses a bounce subdomain, add that CNAME/MX as documented.

Until those records pass the provider's verification, keep `EMAIL_DELIVERY_MODE=log`.

## Production install

`nodemailer` is a **production** dependency of `@schoolapp/core` (not a devDependency). This PR adds it and updates `pnpm-lock.yaml`.

Recommended production order after Plesk Pull / Deploy:

```bash
cd /var/www/vhosts/app.luvlearn.co.uk/httpdocs
export PATH="/opt/plesk/node/22/bin:/usr/local/bin:$PATH"   # use the server's Node/pnpm path
set -a; source .env; set +a
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
systemctl restart schoolapp
systemctl status schoolapp --no-pager
```

If `OBJECT_STORAGE_DRIVER=filesystem` (the current Plesk default unless S3 is configured), set `OBJECT_STORAGE_FS_ROOT` to an absolute persistent directory **outside** `/var/www/vhosts/app.luvlearn.co.uk/httpdocs` before `next start`. Production refuses an unset, relative, `/tmp`, or in-checkout root. See [storage.md](./storage.md).

Install must run **before** build so `nodemailer` is present. Migrate applies `0048_email_delivery.sql` once against production currently at `0047`. Keep `EMAIL_DELIVERY_MODE` unset or `log` (and do not set `EMAIL_PROVIDER=smtp` with `live`) until SMTP is ready. First deployment then queues/log-delivers only and does **not** send real mail.

Skipping install leaves `nodemailer` missing; live SMTP then fails closed (`smtp_unavailable`) rather than sending.

Missing `EMAIL_DELIVERY_MODE` / `EMAIL_PROVIDER` defaults to log-only. Live SMTP also requires `SMTP_HOST` (or `SMTP_URL`) and `EMAIL_FROM_ADDRESS`. Tests inject `FakeEmailProvider` and never open a real SMTP connection.

## Abuse protection

- Forgot-password is enumeration-safe and rate-limited per host + IP.
- Public admissions submit/draft is rate-limited; acknowledgement is a side-effect of a successful submit, not an open mail endpoint.
- There is no public API that accepts arbitrary `to` / `subject` / `html`.
- Client requests cannot set `organisation_id` for mail; it comes from the authenticated tenant or school hostname.
