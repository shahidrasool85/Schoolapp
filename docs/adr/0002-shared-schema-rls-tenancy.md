# ADR 0002: Shared-schema multi-tenancy with RLS

**Status:** Proposed  
**Date:** 2026-08-20

## Context

Multiple schools must use one platform with strict data isolation. Parents may have children at more than one school. We want Postgres Row Level Security as a safety net, and we may self-host a single Postgres instance.

## Decision

- **One database, one schema**, tenant column `organisation_id` on every school-owned table.
- **RLS enabled** on those tables; policies compare `organisation_id` to a session variable set by the API.
- Application code **also** filters by organisation and authorisation (defence in depth).
- No school-to-school queries except future, explicitly modelled features.

## Alternatives considered

| Alternative | Why not now |
| --- | --- |
| Database per school | Operational cost on Plesk; N migrations; pooling; parent-across-schools needs a global identity DB anyway |
| Schema per school | Migration tooling and RLS/reporting become painful; still one cluster to isolate wrongly |
| Totally separate deployments per school | Not a SaaS; kills product operations |

## Consequences

- Every new table in a school module **must** include `organisation_id` and RLS; code review checklist item.
- Indexes should typically lead with `organisation_id`.
- Platform Super Admin bypass is an explicit session flag, audited when used.
- Isolation tests are part of the definition of done for Phase 1.
