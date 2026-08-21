# ADR 0015: Attendance marks, student portal policy, and document metadata

**Status:** Accepted  
**Date:** 2026-08-21

## Context

Phase 6 adds school attendance and a stronger student record. Two product rules must not be reversed later:

1. **Student Record ≠ Student Portal Account.** Every pupil has a student record whether or not they can log in. Portal access is a school policy with overrides, not an age prohibition.
2. Attendance history belongs to the **pupil**, not to their current class. Class/year-group on a mark is context at the time of recording.

Binary document storage must remain portable (S3-compatible / self-hosted). Putting file bytes in PostgreSQL would be expensive to reverse.

## Decision

### Attendance

- Sessions are organisation-configurable (`attendance_session_types`). UK AM/PM is the seeded default, not a schema limit.
- Marks use an extensible code catalogue (`attendance_codes`) with categories `present | late | authorised_absence | unauthorised_absence | not_required`. Extra school/UK codes can be added without redesign.
- One active mark per `(organisation, pupil, date, session)`. Updates write `attendance_mark_revisions` and set correction actor/time from `app_current_user_id()`. Clients cannot set `recorded_by` / `last_corrected_*`.
- Percentage = (present + late) / (all marks except `not_required`). Logic lives in `@schoolapp/core` and is tested there.
- Teachers use `attendance.record.manage_assigned` against class assignments. School Admin and Headteacher hold school-wide keys. Ordinary staff do not.
- Parent/student APIs return parent-visible notes only. Internal `note` and recorder identity stay on staff endpoints.

### Student portal policy

Effective access is **pupil override → class override → year-group override → school default**. `null` means inherit. Reception / Year 1 / Year 2 may be enabled.

Aliases and passwords may exist while portal access is off. `local_auth_lookup_alias` still requires a current primary enrolment in the current academic year, then refuses authentication when the effective student-portal policy is disabled. Reception / Year 1 / Year 2 are not banned by age.

Phase 6 School Admin UI covers school default and year-group overrides. Class and pupil override **tables and APIs** exist; their admin UI is deferred.

### Documents

`student_documents` stores metadata and an object-storage key only. `@schoolapp/storage` is an unconfigured port (`UnconfiguredObjectStorage`). Binary upload is deferred until an S3-compatible adapter is chosen. Parent/student visibility is explicit (`staff`, `staff_and_parents`, `staff_parents_and_student`).

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Hard-code AM/PM only | Blocks later extra sessions |
| Free-text attendance marks | No percentage, audit, or census-ready codes |
| Store current class on the student profile | Breaks history when the pupil moves |
| Age-based login ban for Reception–Y2 | Blocks later QR/PIN/picture access |
| File bytes in PostgreSQL | Irreversible storage architecture |

## Consequences

- Census/DfE reporting rules are not implemented.
- Class/pupil portal override UI, binary uploads, announcements, and younger-child learning activities remain later work.
- Attendance and document tables use `install_tenant_isolation` (ENABLE + FORCE RLS).
