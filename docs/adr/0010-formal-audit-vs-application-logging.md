# ADR 0010: Formal audit history vs application logging

**Status:** Accepted  
**Date:** 2026-08-20

## Context

Operational logs (request traces, errors, performance) are not a legal or safeguarding evidence trail. School data needs attributable history for who changed attendance, results, reports, permissions, and student records. Those events must be hard for the application role to alter after the fact.

## Decision

- **Application logging** (stdout/structured logs): diagnostics only. UUIDs not names/emails/UPNs by default. Rotated, not treated as audit. Not written to `audit_events`.
- **Formal audit** (`audit_events`): append-only business evidence. Separate table, separate permissions, FORCE RLS.
- Every formal event records at least: **actor** (`actor_user_id`, optional membership id), **time** (`occurred_at`), **action**, **entity**, **organisation**, **request id**, and **meaningful before/after** snapshots (`before_data` / `after_data`) where a mutation occurred.
- Sensitive domains **must** write formal audit on change (and later, on privileged read where the product requires it):
  - student record changes (profile, enrolment, class membership, guardianship)
  - permissions and role grants/revokes
  - attendance
  - results / assessment marks
  - progress reports
  - organisation feature flags / settings that affect pupil-facing behaviour
- **Tamper resistance (v1):** the runtime DB role may `INSERT` and `SELECT` (with RLS) only. `UPDATE` and `DELETE` are revoked. No application API for editing or erasing audit rows. Table uses FORCE RLS. Backups retain audit with the rest of the database.
- **Stronger tamper evidence (optional later):** hash chain columns (`prev_hash`, `row_hash`) and/or WORM/object-lock copies of audit exports. Not required to start Phase 1 unless the product owner demands it.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| One `logs` table for errors and audit | Operators flush logs; evidence disappears; PII policy conflicts |
| Update-in-place “last changed by” on the student row only | No history, no before/after, no permission-change trail |
| Full hash chain + WORM in Phase 1 | Valuable, but must not block the foundation slice unless mandated |

## Consequences

- Use cases that mutate sensitive entities call an audit writer in the same transaction as the mutation.
- Audit access is itself permissioned (`audit.read`).
- Application log aggregators are not a substitute for `audit_events` in DPIA/security design.
