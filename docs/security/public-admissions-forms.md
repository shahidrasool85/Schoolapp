# Public admissions forms — security and deployment

Internet-facing data capture. Fail closed. Do not treat client-supplied organisation headers as tenant authority.

## Tenant binding

- Organisation is resolved from `Host` (and trusted forwarded host only when `TRUST_PROXY` is correctly configured).
- `X-Organisation-Id` never selects the tenant for public form routes.
- A mismatched header returns `403 org_host_mismatch`.
- Unknown hosts, unknown slugs, unpublished forms, and outside open/close dates all return `404`.

## Identifiers

- Public continuation tokens are 32-byte random values stored as SHA-256.
- Public submission IDs are UUIDs, not sequential database keys.
- QR codes encode only the public HTTPS/HTTP form URL.

## Validation

- Server-side Zod + controlled field types.
- Helper/success/privacy text is sanitised (no stored HTML/JS).
- JSON bodies over 64 KiB are rejected (`413 payload_too_large`).
- File metadata: PDF/JPEG/PNG/WebP/DOCX, 8 MiB max. Bytes are not stored in PostgreSQL.

## Abuse controls

- In-memory sliding-window rate limit per IP hash + form (read/draft/submit).
- `CaptchaPort` defaults to `none`. Set `PUBLIC_FORM_CAPTCHA_PROVIDER` when a provider is wired (Turnstile/reCAPTCHA adapters are not hardcoded).
- Optional `idempotencyKey` prevents duplicate final submissions of the same client retry.

## Data protection

- Audit events record form id, type, slug, completeness, and campaign code — not medical or free-text child content.
- Parent-submitted files must not be publicly readable; metadata is tenant-scoped with FORCE RLS.
- Medical/additional needs use `students.additional_needs.read` / `manage` after conversion.

## Deployment checklist

1. `PLATFORM_DOMAIN` is the real apex; school forms are served on school hosts only.
2. Reverse proxies overwrite `X-Forwarded-Host`; do not pass client values through.
3. Enable a captcha provider before exposing forms on a public marketing site if bot traffic is expected.
4. Configure object storage before accepting production document binaries.
5. Review privacy notice text/URL on each published form; submissions snapshot the wording at submit time.
