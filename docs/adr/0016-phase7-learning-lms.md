# ADR 0016: Teaching & Learning / LMS core

**Status:** Accepted  
**Date:** 2026-08-22

## Context

Phase 7 adds the first reusable LMS workflow: a teacher creates learning work, assigns it, a pupil sees and submits it, the teacher marks it, and the pupil/parent see status and released feedback.

This must not become a homework-only module, a formal assessment engine, or an AI activity system. Those later products should reuse the same work, target, submission, and resource models where appropriate.

Two product rules would be expensive to reverse:

1. Baking a single `class_id` onto the assignment as the only targeting model.
2. Treating “currently in this class” as the identity of assigned work, so a later class move silently drops the pupil’s work.

## Decision

### Assignment vs targets vs recipients

- `learning_assignments` is canonical learning work. It has no `class_id`.
- `learning_assignment_targets` records **intent**: one or more classes, a year group, and/or selected pupils.
- `learning_assignment_recipients` is a **snapshot** of pupils at publish (and when a target is added while published). Class/year moves later do not remove that relationship. New joiners are not auto-added.

Year-group targeting requires school-wide `lms.assignments.manage` (Headteacher / School Admin). Teachers with `lms.assignments.manage_assigned` may only target assigned classes and pupils in those classes.

**Manage vs mark:** sharing a pupil or class with another teacher does **not** grant assignment lifecycle control. Publish, close, archive, edit, and resource attach require school-wide `lms.assignments.manage` **or** `created_by = actor`. Marking and reading submissions still use `canSeeLearningRecipient` (current assigned pupils, or the recipient snapshot class the teacher still teaches).

### Work types

Work is not hardcoded as “Homework”. Each organisation has a catalogue (`homework`, `classwork`, `revision`, `project`, `reading`, `practice`, `assessment_preparation`) plus room for later keys. AI activities and challenges should attach to this work model later rather than inventing a parallel homework table.

### Submissions and marks

- One logical pupil submission per assignment (`learning_submissions`).
- Pupil text is append-only in `learning_submission_revisions`.
- `learning_marks` is LMS/work-specific marking (score, written feedback, release flags, resubmission). It is **not** the Phase 8 assessment/results engine.
- Clients cannot set `marked_by` / `marked_at` / `submitted_by`. Session `app_current_user_id()` wins.

### Visibility

- Pupils see work only via recipient snapshot + published/closed/archived + available-from.
- Teacher-private notes never appear on pupil/parent APIs.
- Marks/feedback appear for pupils only when `released_to_student`, and for parents only when `released_to_parent`. Unreleased `completed` is shown as submitted, not as completed.
- Close blocks new first submissions. A requested resubmission (or an in-progress draft of one) may still be submitted on a closed assignment.
- Parent access still requires `portal_access = true`. Parents cannot submit.
- Student APIs still require current primary enrolment and effective Student Portal policy. No student email/password login.

### Resources and files

Resources are metadata + http(s) URL, with object-storage key builders on the existing port. Binary upload remains deferred (`UnconfiguredObjectStorage`). File bytes are not stored in PostgreSQL.

### Notifications

Reuse `create_inbox_notification` with an optional idempotency key. Bodies contain the work title only — not private notes, scores, or restricted contact data.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Single `class_id` on the assignment | Blocks multi-class, year-group, and selected-pupil work |
| Live class-membership targeting with no snapshot | Pupils lose work when they change class |
| Free-text statuses | Breaks lifecycle, reporting, and later AI/assessment reuse |
| Marks as Phase 8 assessment rows | Mixes homework marking with formal results |
| File bytes in PostgreSQL | Irreversible storage architecture |

## Consequences

- Formal exams, report cards, rubrics, AI generation, games, chat, and video conferencing remain later phases.
- Binary resource/submission upload waits for an S3-compatible adapter.
- Teachers do not receive school-wide LMS access merely from the Teacher role.
