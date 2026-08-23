# ADR 0018: Public admissions forms, embeds, and draft tokens

**Status:** Accepted  
**Date:** 2026-08-22

## Context

Phase 4 built the staff enquiry/application workflow. Schools still needed internet-facing data capture without a second admissions database. Two decisions would be expensive to reverse:

1. Creating a parallel public-application store that later has to be reconciled with `admissions_enquiries` / `admissions_applications`.
2. Building an arbitrary no-code app builder whose answers cannot be validated or mapped onto canonical pupil/guardian fields.

Draft continuation also needs an identity model. A public account system would be a large, hard-to-reverse commitment.

## Decision

### Same workflow, not a parallel database

Published public forms write into the existing enquiry and application tables. `admissions_form_submissions` stores the form used, source/campaign, declaration snapshot, and answers. Completeness (`draft` / `submitted` / `missing_documents` / `complete`) is separate from admissions decision status.

### Controlled field catalogue

Forms are sections plus fields. Canonical keys map to Schoolapp models (child, guardians, previous education, emergency, medical). Custom questions are limited to a closed set of types and are never copied into unrelated student columns.

### Host-bound public tenant

Public GET/POST resolve the school from the hostname. `X-Organisation-Id` never selects the tenant. A mismatched header fails closed. Unpublished, unknown, and expired forms return the same 404.

### Draft continuation tokens

Drafts use a 32-byte random token stored as SHA-256. No public account is created. Tokens expire after 7 days and are bound to organisation + form + draft submission. Account-based drafts can be added later without replacing this table.

### Embeds

The first embed is a same-origin iframe of `/admissions/embed/{enquiry|apply}/{slug}`. There is no JavaScript SDK. The embed route sets `Content-Security-Policy: frame-ancestors *` so typical school websites can host it. Submission does not depend on third-party cookies.

### Anti-bot port

`CaptchaPort` defaults to `none`. Deployments may later set `PUBLIC_FORM_CAPTCHA_PROVIDER` without changing form storage. Rate limiting is an in-memory sliding window in this phase.

### Conversion

When an application is enrolled, a trigger copies canonical identity, address, additional needs, and guardian contacts. Custom-question answers stay on the submission.

## Consequences

- Schools configure forms under Admissions → Forms and share URL / embed / QR.
- Medical/additional needs sit in `student_additional_needs` with dedicated permissions.
- Binary uploads remain metadata + storage-port keys until an S3 adapter is configured.
