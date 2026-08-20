# ADR 0011: Product-owner decisions for Phase 1

**Status:** Accepted  
**Date:** 2026-08-20

## Context

Outstanding product-owner items from the amended architecture were decided before Phase 1 implementation.

## Decisions

1. **School Admin and Headteacher remain separate roles** with separate permission sets. School Admin: operational administration, configuration, users, school processes. Headteacher: broader educational oversight and reporting, **without** every technical/system-administration permission. The permission catalogue remains the extension point.
2. **Billing boundary** is a **per-school subscription** with configurable pupil/licence bands. Plans, entitlements, limits, and pricing are data (`plans.entitlements`, `plans.pricing`). Do **not** hard-code prices or band sizes (100/250/500/1000) in the domain model.
3. **Phase 1 audit** is append-only `audit_events` with the application role prohibited from UPDATE/DELETE. Columns reserved (`prev_hash`, `row_hash`) so hash chaining, WORM, or external export can be added without redesign.
4. **Year-group enrolment:** normally one **primary** placement per student per academic year. `is_primary` unique index; non-primary `secondary` / `exceptional` rows are allowed.
5. **Teachers without class assignments** do not see pupils. No school-wide `students.profiles.read` on the Teacher role. Assigned access is `students.profiles.read_assigned` (enforced when class assignments exist). Headteacher and other catalogue grants may be broader.
6. **Platform Super Admin** uses **break-glass** support access. No routine browsing of school/pupil data. Grants require a reason, recorded scope, expiry, and a **high-priority** audit event. `set_tenant_context` does not take a client-supplied platform-admin bypass flag. Tenant RLS policies do **not** use `app.is_platform_admin()` as a bypass. Schools can list support-access grants for their organisation (review/notification later).
7. **`restricted_contact`** remains a tightly permissioned placeholder. Not granted to Teacher, Parent, or Student. No safeguarding workflow in Phase 1. Must not appear on ordinary APIs merely because the column exists.
8. **Preferred first production region is the United Kingdom** where available. Still a deployment preference, not an absolute legal requirement in the architecture.

## Consequences

- `app_tenant_matches` is organisation-id equality only.
- Platform listing of organisations is allowed only when platform admin **and** no tenant context is set.
- Entering a tenant as platform staff requires an unexpired, unrevoked `support_access_grants` row.
