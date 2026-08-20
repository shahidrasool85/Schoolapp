# ADR 0003: Global identity with per-organisation memberships

**Status:** Proposed  
**Date:** 2026-08-20

## Context

Staff usually belong to one school. Parents often have multiple children, sometimes at different schools. Students need their own accounts. The same person might be a teacher at one school and a parent at another.

## Decision

- **`users` is global** (not owned by a school).
- Access is via **`organisation_memberships`** plus **roles on that membership**.
- **Student profiles** and **guardianships** are organisation-scoped.
- API requires **`X-Organisation-Id`** (or equivalent) for school-scoped routes after the client chooses a membership.
- Platform Super Admin is a **platform-level** role, not an organisation membership.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| User belongs to exactly one school | Breaks multi-school parents and staff-who-are-parents |
| Duplicate parent accounts per school | Same person, split passwords, broken mobile UX, duplicate PII |
| Student as a child entity without a user row | Blocks student portal and future student app; harder consent/audit |

## Consequences

- Login is not “log into a school”; it is “log in as a person, then choose context”.
- Invite flows must attach a membership (and possibly create a user).
- Student emails are optional; usernames/aliases are organisation-aware to avoid clashing `johnsmith` across schools.
