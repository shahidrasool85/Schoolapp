# ADR 0030 — Production school onboarding, branding, and account lifecycle

**Status:** Accepted  
**Date:** 2026-08-27

## Context

Earlier phases assumed Greenwood/Oak demo seed for a usable tenant. A newly provisioned school must become operational through the UI: platform creates the organisation, the first School Admin activates, a resumable setup wizard orchestrates existing academic/people/timetable/portal domains, staff/parents/students get secure invitations, and bulk CSV import replaces typing hundreds of pupils. Login branding was a placeholder. Forgot-password did not exist.

## Decision

1. **Wizard orchestrates; it does not duplicate.** `/school/setup` drives existing Academic Years, Year Groups, Classes, Subjects, Timetable, Rooms, Staff, Pupils, and Portal APIs. Progress lives in `organisation_setup_progress`. Readiness is a checklist (Complete / Needs attention / Optional) and does not block the product for optional gaps.
2. **Branding is display-only.** Logo, primary/accent colour, optional login hero, and tagline are authorised school settings. Uploads reuse Phase 13 object storage (`branding` domain). `GET /api/v1/public/tenant` and `/public/branding/{logo|hero}` expose safe URLs/bytes only — never storage keys. Shells fall back to professional defaults. Greenwood is not hard-coded.
3. **Invitations and password resets are hashed, single-use, expiring, tenant-bound.** Staff and parent invites reuse hashed invitation tokens. Password reset and student activation use `account_tokens` with purpose-specific TTLs. Plaintext tokens appear only in the one-time issuing response (or local mail outbox). Forgot-password copy is enumeration-safe.
4. **Mail is a port.** Domain logic calls `MailProvider`. Local/demo uses an inspectable `mail_outbox`. Production adapters are configurable later. CI must not send real email. Passwords never appear in messages.
5. **CSV import is preview-then-confirm.** Staff, pupils, and guardians: upload → parse → validate → surface duplicates (same-org admission number, staff email, parent email, name+DOB) → confirm. Uncertain identities are not merged. `school.admin` cannot be assigned by import. Cross-tenant matching must not leak identities. Templates are formula-injection safe.
6. **Account lifecycle is capability-based.** School Admin (not teachers) manages invites, roles, suspend/reactivate, Parent Portal opt-in (`portalAccess` omitted → false), and Student Portal aliases. Linking an existing parent is same-organisation only. Platform Admin creates schools and first admins; it does not gain pupil browse.
7. **Empty tenants must not crash.** Major lists use EmptyState. Demo seed may mark Greenwood/Oak onboarding complete; a new organisation works without that seed.

## Consequences

- Migration `0039_phase20_onboarding.sql` is additive and does not rewrite 0001–0038.
- Teachers keep assigned-only access; they do not receive `onboarding.manage`, `imports.manage`, `org.members.manage`, or `org.roles.manage`.
- FORCE RLS, same-org constraints, guardian portal checks, student portal policy, safeguarding isolation, and medication/dietary privacy remain unchanged.

## Rejected alternatives

- Duplicating academic/people models inside an onboarding schema.
- Embedding a single email vendor in domain services.
- Returning invitation or reset tokens on later GET.
- Auto-linking matching emails across organisations.
- Blocking the whole product until optional setup (rooms, timetable, statutory) is complete.
