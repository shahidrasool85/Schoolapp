# ADR 0004: RBAC with an extensible permission catalogue

**Status:** Accepted  
**Date:** 2026-08-20

## Context

Roles include Platform Super Admin, School Admin, Headteacher, Teacher, Admissions, other staff, Parent, Student. More roles will appear (e.g. Head of Year, SENCO). Hardcoding role names in every feature will freeze the product.

## Decision

- Stable **permission keys** (`admissions.applications.manage`).
- **Roles** are bundles of permissions; system roles are seeded; custom roles may be added per organisation.
- Users receive roles **through a membership** (or platform assignment).
- Use cases authorise on **permissions**, not on role display names.
- Multiple roles per membership are allowed.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Single enum role per user | Cannot express teacher+parent or custom jobs |
| ABAC/ReBAC from day one | Needed later for “this teacher, these classes”; start with RBAC + explicit relation checks (class enrolment, guardianship) |
| Check `role === 'teacher'` in UI only | Insecure; mobile and API would diverge |

## Consequences

- New modules ship new permission keys and a default grant matrix for system roles.
- UI hides actions by permission, but the API still enforces.
- Class-level and child-level constraints are additional checks (`assertOwnChild`), not a replacement for RBAC.
