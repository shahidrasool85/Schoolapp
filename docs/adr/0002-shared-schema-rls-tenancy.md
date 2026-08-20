# ADR 0002: Shared-schema multi-tenancy with RLS

**Status:** Accepted (amended 2026-08-20)  
**Date:** 2026-08-20

## Context

Multiple schools must use one platform with strict data isolation. Parents may have children at more than one school. Postgres Row Level Security is the database safety net. Table owners and pooled connections can silently bypass or leak tenant context unless the runtime rules are strict.

## Decision

- **One database, one schema**, tenant column `organisation_id` on every school-owned table.
- Application code **always** filters by organisation and authorisation (defence in depth). RLS is not the only control.
- **No school-to-school queries** except future, explicitly modelled features with their own governance.

### Tenant context (mandatory runtime rules)

1. Tenant context is set **transaction-locally only** (`set_config(..., is_local := true)` / `SET LOCAL`), never as a session-lasting setting. This is required so connection pooling cannot leak School A’s context into School B’s request.
2. Only **trusted server code** may set context, via a single `set_tenant_context` database function (or equivalent API helper that calls it). Clients, SQL editors, and mobile apps must not set `app.organisation_id`.
3. **`X-Organisation-Id` and any JWT org claims are hints, not authority.** The API reloads the user’s memberships from the database on every school-scoped request and rejects the request unless an **active** membership exists for that organisation (or the caller is a verified platform Super Admin on an explicit platform/break-glass path).
4. After membership revalidation, the server opens a transaction, sets local context, runs queries, and commits. Context dies with the transaction.
5. School-scoped routes **do not guess** a tenant if the header is missing (`org_context_required`).
6. Suitable tenant tables use **`ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`** so the table owner cannot accidentally bypass policies. The runtime database role is **not** the table owner and does **not** have `BYPASSRLS`.
7. **Automated cross-tenant security tests are mandatory** in Phase 1 and remain a merge gate for later modules that add tenant tables. See architecture §4.5.

## Alternatives considered

| Alternative | Why not now |
| --- | --- |
| Database per school | Operational cost on Plesk; N migrations; pooling; parent-across-schools needs a global identity DB anyway |
| Schema per school | Migration tooling and RLS/reporting become painful; still one cluster to isolate wrongly |
| Totally separate deployments per school | Not a SaaS; kills product operations |
| Trust client org header or JWT `org_id` without DB revalidation | Memberships are revoked; tokens outlive suspensions |
| Session-level `SET` of tenant GUCs | Leaks across pooled connections |
| RLS without `FORCE` | Table-owner connections (migrations user reused at runtime) bypass policies |

## Consequences

- Every new school-owned table **must** include `organisation_id`, RLS, and FORCE RLS; code review checklist item.
- Indexes should typically lead with `organisation_id`.
- Platform Super Admin bypass is an explicit flag, revalidated against `platform_admins`, and audited when used to enter tenant data.
- Isolation tests are part of the definition of done for Phase 1 — not optional hardening.
