# ADR 0013: Admissions workflow and applicant-to-student conversion

**Status:** Accepted  
**Date:** 2026-08-20

## Context

Phase 4 adds a school admissions workflow. An applicant must not become an enrolled student until a controlled conversion step. Parent/guardian contacts on an application are not the same as guardianships on an enrolled student. Identity must reuse the existing global user + per-organisation membership model.

## Decision

- Admissions data is organisation-scoped with **FORCE RLS** on every new tenant table.
- Workflow state is an explicit application status machine. Invalid transitions are rejected in application code **and** by a database trigger. Status `enrolled` can only be set by `enrol_admitted_applicant` (GUC `app.admissions_enrol`).
- `deferred` is included alongside the requested states because deferring a year is a distinct UK independent-school outcome from waiting list.
- Enquiry and application records keep a stable human reference (`ENQ-YYYY-NNNN` / `APP-YYYY-NNNN`).
- Additional future fields live in `extra_fields` jsonb. Uploaded files are **not** stored in PostgreSQL; `admissions_documents` holds object-storage metadata (`storage_key`, content type, size) only.
- Application contacts may point at an existing `user_id` when that user is already visible in the organisation. Conversion uses `link_guardian`, which reuses global identities by email and **does not** overwrite passwords, user kind, or existing memberships.
- Guardianships and `portal_access` are created only from an explicit `guardianLinks` payload. An application contact never grants parent-portal access by itself.
- Conversion is idempotent: row lock + unique `converted_student_profile_id` / `admitted_from_application_id`. The application row is retained as history.
- Permissions follow the existing catalogue style: `admissions.read`, existing `admissions.*.manage` keys, plus `admissions.decide` and `admissions.convert`. Teachers, parents, and students receive none of these.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Treat applicants as `student_profiles` with status `prospective` | Would leak into class registers, parent children lists, and teacher assigned-student queries |
| Free-text application status | Invalid jumps (draft → enrolled) would be a support and audit problem |
| Auto-create portal guardianships on conversion | Violates portal-access and restricted-contact isolation |
| New identity table for applicants | Second identity architecture; rejected by Phase 1 ADRs |

## Consequences

- Later LMS/attendance modules must use converted `student_profiles`, not admissions rows.
- Offer payments/deposits, public website enquiry forms, document upload, and ranking algorithms remain later work.
- In-app notifications may be written for contacts who already have a user identity; email/SMS/push are still out of scope.
