# ADR 0019: Announcements, targeting, and school calendar

**Status:** Accepted  
**Date:** 2026-08-23

## Context

Phases 1–9 delivered tenancy, people, portals, LMS targeting, assessments, and public admissions forms. Daily school operations still need a shared communications layer: staff publish a notice or event, the right audience sees it, and read/acknowledgement state is tracked per recipient.

Live chat, email/SMS/push delivery, and marketing automation remain out of scope.

## Decision

### Announcements

Canonical `announcements` rows use controlled statuses: `draft → scheduled → published → expired → archived`. Priority is `normal | important | urgent`. Optional pin, expiry, and acknowledgement-required flags are first-class.

Targets follow the Phase 7 assignment model rather than a single `class_id`: `whole_school`, `staff`, `parents`, `students`, `year_group`, `class`, `student`, `staff_member`. Cross-school IDs fail closed. Publish takes a recipient snapshot (`announcement_recipients`) so later class moves do not erase history. One recipient row exists per announcement + user. One guardian cannot acknowledge for another.

School-wide audiences require `announcements.broadcast`. Teachers with `announcements.manage_assigned` may target assigned classes/pupils only.

### Calendar

`school_events` share the same targeting and snapshot pattern (`school_event_audience`). Event types are a per-school catalogue (system keys plus school-defined keys), not a hardcoded product list. Optional `related_kind` / `related_id` can point at an academic year, term, class, assessment, assignment, or admissions open day without tightly coupling those modules. Assignments and assessments are not auto-created as calendar rows.

### Scheduling

No job queue is introduced. Scheduled rows activate on authorised list/read for that organisation (`publish_at <= now()`), then snapshot and notify. The staff member who scheduled the row remains `published_by`; the first parent/student/staff reader is not recorded as publisher. A later cron can call `activate_due_communications` if schools need notifications before the first request. Expired notices leave active portal lists but remain readable to authorised staff.

### Notifications

Reuse `create_inbox_notification` with idempotency keys `announcement:published:{id}:{userId}` and `calendar:upcoming:{id}:{userId}`. Email/SMS/push are still deferred.

### Visibility

Parent APIs require active guardianship and `portal_access = true` on every request. Publish-time recipient snapshots preserve class-move history, but a revoked or ended guardianship cannot list, open, or acknowledge items that no longer relate to an authorised child. A user who is both staff and a guardian still sees family notices on the parent portal via live child subjects even if the snapshot stored them as staff first. Teachers with assigned-only access cannot read other people's draft or scheduled school-wide notices. Student APIs re-check current primary enrolment and effective Student Portal policy on every request. Staff-only targets never appear on parent/student routes. Storage keys are omitted from API payloads.

## Alternatives considered

| Alternative | Why not now |
| --- | --- |
| Broadcast row + receipts only | Need per-user read/ack and family-related child labels |
| Auto-create events from every assignment/assessment | Tight coupling; schools must opt in later |
| Background job queue for scheduling | Unnecessary for request-time activation in this phase |

## Consequences

- First-request activation may delay inbox notifications until someone in the school hits a communications endpoint.
- Binary attachments remain URL/metadata only until object storage is configured.
